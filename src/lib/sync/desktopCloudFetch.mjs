const bodyBytes = async body => {
    if (body == null) return null;
    if (typeof body === 'string') return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
    throw new Error('クラウドへ送信するデータ形式に対応していません。');
};

const requestHeaders = headers => [...new Headers(headers || {}).entries()];

const responseBodyBytes = body => {
    if (body == null) return new Uint8Array();
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    // Electron/NodeのBufferがプレーンオブジェクトとして複製された場合にも対応する。
    if (body?.type === 'Buffer' && Array.isArray(body.data)) {
        return Uint8Array.from(body.data);
    }
    if (Array.isArray(body)) return Uint8Array.from(body);
    throw new Error('Mac/PC版アプリが受信したクラウドデータの形式が不正です。');
};

export const createDesktopCloudFetch = bridge => {
    if (typeof bridge?.fetch !== 'function') {
        throw new Error('Mac/PC版アプリのクラウド通信機能を利用できません。');
    }
    return async (url, options = {}) => {
        const signal = options.signal;
        if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
        const request = bridge.fetch({
            url: String(url),
            method: options.method || 'GET',
            headers: requestHeaders(options.headers),
            body: await bodyBytes(options.body),
        });
        let abortHandler;
        const abort = signal && new Promise((_, reject) => {
            abortHandler = () => reject(signal.reason || new DOMException('Aborted', 'AbortError'));
            signal.addEventListener('abort', abortHandler, { once: true });
        });
        try {
            const result = await (abort ? Promise.race([request, abort]) : request);
            const bytes = responseBodyBytes(result.body);
            return new Response(bytes.byteLength ? bytes : null, {
                status: result.status,
                statusText: result.statusText,
                headers: result.headers,
            });
        } finally {
            if (abortHandler) signal.removeEventListener('abort', abortHandler);
        }
    };
};
