const DATA_URL_PATTERN = /^data:([^,]*),(.*)$/s;

const decodeBase64 = value => {
    const decoded = globalThis.atob(String(value || '').replace(/\s/g, ''));
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
        bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
};

export const dataUrlToBlob = dataUrl => {
    const match = String(dataUrl || '').match(DATA_URL_PATTERN);
    if (!match) throw new Error('画像・PDFデータの形式が不正です。');

    const metadata = match[1].split(';');
    const mediaType = metadata[0].includes('/')
        ? metadata.shift()
        : 'text/plain';
    const isBase64 = metadata.some(value => value.toLowerCase() === 'base64');
    const type = [mediaType, ...metadata.filter(value => value.toLowerCase() !== 'base64')]
        .filter(Boolean)
        .join(';');

    try {
        const bytes = isBase64
            ? decodeBase64(match[2])
            : new TextEncoder().encode(decodeURIComponent(match[2]));
        return new Blob([bytes], { type });
    } catch (cause) {
        const error = new Error('画像・PDFデータを復元できませんでした。');
        error.cause = cause;
        throw error;
    }
};

