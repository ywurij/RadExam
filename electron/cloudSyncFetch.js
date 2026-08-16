const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
const MAX_RESPONSE_BODY_BYTES = 512 * 1024 * 1024;

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
  if (url.protocol !== 'https:' || url.username || url.password) {
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
    throw new Error('許可されていないクラウド通信先です。');
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
  const bytes = body instanceof Uint8Array
    ? body
    : new Uint8Array(body);
  if (bytes.byteLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error('一度に送信するクラウドデータが大きすぎます。');
  }
  return bytes;
};

const responseHeaders = headers => [...headers.entries()]
  .filter(([name]) => name.toLowerCase() !== 'set-cookie');

const performCloudSyncFetch = async (request, {
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!request || typeof request !== 'object') {
    throw new Error('クラウド通信要求の形式が不正です。');
  }
  const url = assertAllowedCloudUrl(request.url);
  const method = String(request.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(method)) {
    throw new Error('許可されていないクラウド通信方法です。');
  }
  const response = await fetchImpl(url, {
    method,
    headers: normalizeHeaders(request.headers),
    body: ['GET', 'HEAD'].includes(method) ? undefined : normalizeBody(request.body),
    redirect: 'follow',
  });
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BODY_BYTES) {
    throw new Error('クラウド上のファイルがMac/PC版で取得できるサイズを超えています。');
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > MAX_RESPONSE_BODY_BYTES) {
    throw new Error('クラウド上のファイルがMac/PC版で取得できるサイズを超えています。');
  }
  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response.headers),
    // ArrayBufferとしてIPCへ渡す。Node側のUint8Arrayを直接返すと、Electronの
    // structured clone後に環境によって通常のオブジェクトとして見えることがある。
    body: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
};

module.exports = {
  assertAllowedCloudUrl,
  performCloudSyncFetch,
};
