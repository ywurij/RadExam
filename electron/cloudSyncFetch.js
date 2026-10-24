const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 512 * 1024 * 1024;
const CLOUD_TRANSFER_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const allowedRequestHeaders = new Set([
  'accept',
  'authorization',
  'content-range',
  'content-type',
  'if-match',
  'if-none-match',
  'range',
]);

const isHostOrSubdomain = (hostname, domain) => (
  hostname === domain || hostname.endsWith(`.${domain}`)
);

// OneDriveのcreateUploadSessionはGraphとは別の、Microsoft管理下の一時URLを返す。
// 個人向けOneDriveでは1drv.comのほか、地域や保存先によってLive Storage系も使われる。
const MICROSOFT_STORAGE_DOMAINS = [
  '1drv.com',
  'onedrive.com',
  'onedrive.live.com',
  'storage.live.com',
  'livefilestore.com',
  // 個人向けOneDriveの新しい保存基盤。Microsoft Graphが返す一時
  // アップロードURLとダウンロードURLの両方で使用される。
  'microsoftpersonalcontent.com',
  'sharepoint.com',
  'sharepoint-df.com',
];

const isMicrosoftStorageHost = hostname => (
  MICROSOFT_STORAGE_DOMAINS.some(domain => isHostOrSubdomain(hostname, domain))
);

const assertAllowedCloudUrl = rawUrl => {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    throw new Error('クラウド通信先URLの形式が不正です。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) {
    throw new Error('許可されていないクラウド通信先です。');
  }
  const googleApi = (
    (url.hostname === 'www.googleapis.com' || url.hostname === 'content.googleapis.com')
    && (
      url.pathname.startsWith('/drive/v3/')
      || url.pathname.startsWith('/upload/drive/v3/')
      || url.pathname === '/batch/drive/v3'
    )
  );
  const microsoftApi = (
    url.hostname === 'graph.microsoft.com'
    && url.pathname.startsWith('/v1.0/')
  );
  if (!googleApi && !microsoftApi && !isMicrosoftStorageHost(url.hostname)) {
    // 一時URLには認証情報が含まれるためURL全体は表示せず、診断に必要な
    // ホスト名だけを返す。
    throw new Error(`許可されていないクラウド通信先です（ホスト: ${url.hostname}）。`);
  }
  return url.toString();
};

const normalizeHeaders = rawHeaders => {
  const headers = new Headers();
  for (const entry of Array.isArray(rawHeaders) ? rawHeaders : []) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const name = String(entry[0] || '').toLowerCase();
    if (!allowedRequestHeaders.has(name)) continue;
    headers.append(name, String(entry[1] || ''));
  }
  return headers;
};

const normalizeBody = body => {
  if (body == null) return undefined;
  if (!(body instanceof ArrayBuffer) && !ArrayBuffer.isView(body)) {
    throw new Error('クラウドへ送信するデータ形式が不正です。');
  }
  if (body.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error('一度に送信するクラウドデータが大きすぎます。');
  }
  return body instanceof ArrayBuffer
    ? new Uint8Array(body)
    : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
};

const responseHeaders = headers => [...headers.entries()]
  .filter(([name]) => name.toLowerCase() !== 'set-cookie');

const cancelBody = response => {
  void response.body?.cancel().catch(() => {});
};

const readLimitedBody = async (response, signal, maxBytes) => {
  const tooLarge = () => new Error('クラウド上のファイルがMac/PC版で取得できるサイズを超えています。');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    cancelBody(response);
    throw tooLarge();
  }
  if (!response.body) return new ArrayBuffer(0);

  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        void reader.cancel().catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes.buffer;
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
};

const performCloudSyncFetch = async (request, {
  fetchImpl = globalThis.fetch,
  timeoutMs = CLOUD_TRANSFER_TIMEOUT_MS,
  maxResponseBodyBytes = MAX_RESPONSE_BODY_BYTES,
} = {}) => {
  if (!request || typeof request !== 'object') {
    throw new Error('クラウド通信要求の形式が不正です。');
  }
  let url = assertAllowedCloudUrl(request.url);
  let method = String(request.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    throw new Error('許可されていないクラウド通信方法です。');
  }
  const headers = normalizeHeaders(request.headers);
  let body = ['GET', 'HEAD'].includes(method) ? undefined : normalizeBody(request.body);
  const controller = new AbortController();
  // リダイレクトと本文の読み取りを含む通信全体を制限する。
  const timer = setTimeout(() => {
    const error = new Error('クラウド通信が制限時間を超えました。');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);
  try {
    for (let redirects = 0; ; redirects += 1) {
      controller.signal.throwIfAborted();
      const response = await fetchImpl(url, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = response.headers.get('location');
      if (REDIRECT_STATUSES.has(response.status) && location) {
        cancelBody(response);
        if (redirects >= MAX_REDIRECTS) {
          throw new Error('クラウド通信のリダイレクト回数が上限を超えています。');
        }
        // 自動追跡すると最初のURLしか検証できないため、各段で検証する。
        const nextUrl = assertAllowedCloudUrl(new URL(location, url).toString());
        if (new URL(nextUrl).origin !== new URL(url).origin) {
          headers.delete('authorization');
        }
        if ((response.status === 303 && method !== 'HEAD')
          || ([301, 302].includes(response.status) && method === 'POST')) {
          method = 'GET';
          body = undefined;
          headers.delete('content-type');
          headers.delete('content-range');
        }
        url = nextUrl;
        continue;
      }
      const responseBody = await readLimitedBody(response, controller.signal, maxResponseBodyBytes);
      return {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders(response.headers),
        // Windowsを含め、IPCへは通常のArrayBufferを渡す。
        body: responseBody,
      };
    }
  } finally {
    clearTimeout(timer);
  }
};

module.exports = {
  assertAllowedCloudUrl,
  performCloudSyncFetch,
};
