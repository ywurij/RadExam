const normalizeAssetPath = path => `/${String(path || '').replace(/^\/+/, '')}`;

export const filterUnavailableStaticImages = (question, availableImagePaths = []) => {
    const availablePaths = availableImagePaths instanceof Set
        ? availableImagePaths
        : new Set(availableImagePaths);
    const images = Array.isArray(question?.images) ? question.images : [];

    return {
        ...question,
        images: images.filter(image => {
            const path = String(image?.path || '');
            if (!path) return false;
            if (!/^\/?assets\/images\//.test(path)) return true;
            return availablePaths.has(normalizeAssetPath(path));
        })
    };
};
