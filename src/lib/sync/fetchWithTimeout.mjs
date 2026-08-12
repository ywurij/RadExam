export const DEFAULT_SYNC_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
export const DEFAULT_SYNC_TRANSFER_TIMEOUT_MS = 15 * 60 * 1000;

const normalizeTimeout = value => {
    const timeout = Number(value);
    return Number.isFinite(timeout) && timeout > 0 ? timeout : 0;
};

export const fetchWithTimeout = async ({
    fetchImpl,
    url,
    options = {},
    timeoutMs,
}) => {
    const timeout = normalizeTimeout(timeoutMs);
    if (!timeout || typeof AbortController !== 'function') {
        return fetchImpl(url, options);
    }

    const controller = new AbortController();
    const upstreamSignal = options.signal;
    const forwardAbort = () => controller.abort(upstreamSignal?.reason);
    if (upstreamSignal?.aborted) forwardAbort();
    else upstreamSignal?.addEventListener?.('abort', forwardAbort, { once: true });

    const timer = setTimeout(() => {
        const error = new Error('クラウド通信が制限時間を超えました。');
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
