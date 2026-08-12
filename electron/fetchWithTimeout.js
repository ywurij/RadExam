const DEFAULT_OAUTH_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

const fetchWithTimeout = async (fetchImpl, url, options = {}, timeoutMs = DEFAULT_OAUTH_REQUEST_TIMEOUT_MS) => {
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0 || typeof AbortController !== 'function') {
    return fetchImpl(url, options);
  }
  const controller = new AbortController();
  const upstreamSignal = options.signal;
  const forwardAbort = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) forwardAbort();
  else upstreamSignal?.addEventListener?.('abort', forwardAbort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error('認証サーバーとの通信が制限時間を超えました。');
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeout);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener?.('abort', forwardAbort);
  }
};

module.exports = {
  DEFAULT_OAUTH_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
};
