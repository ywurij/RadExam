const LOCAL_IMAGE_PREFIX = 'local-image://';

const buildExamPdfKey = (examId, sourcePage) => {
    if (typeof sourcePage?.pdfKey === 'string' && sourcePage.pdfKey) {
        return sourcePage.pdfKey;
    }

    const pdfName = typeof sourcePage?.pdfName === 'string' ? sourcePage.pdfName.trim() : '';
    const pdfYear = Number(sourcePage?.pdfYear);
    if (!examId || !pdfName) return '';

    return `${examId}::${Number.isFinite(pdfYear) && pdfYear > 0 ? pdfYear : 'unknown'}::${pdfName}`;
};

export const collectReferencedImageKeys = exams => {
    const keys = new Set();

    Object.values(exams || {}).forEach(exam => {
        (Array.isArray(exam?.questions) ? exam.questions : []).forEach(question => {
            (Array.isArray(question?.images) ? question.images : []).forEach(image => {
                const path = typeof image?.path === 'string' ? image.path : '';
                const pathKey = path.startsWith(LOCAL_IMAGE_PREFIX)
                    ? path.slice(LOCAL_IMAGE_PREFIX.length)
                    : '';
                const key = pathKey || (typeof image?.storageKey === 'string' ? image.storageKey : '');
                if (key) keys.add(key);
            });
        });
    });

    return [...keys];
};

export const collectReferencedPdfKeys = exams => {
    const keys = new Set();

    Object.entries(exams || {}).forEach(([examId, exam]) => {
        (Array.isArray(exam?.questions) ? exam.questions : []).forEach(question => {
            (Array.isArray(question?.sourcePages) ? question.sourcePages : []).forEach(sourcePage => {
                const key = buildExamPdfKey(examId, sourcePage);
                if (key) keys.add(key);
            });
        });
    });

    return [...keys];
};

export const findMissingBackupImageKeys = (exams, images) => {
    const imageEntries = images && typeof images === 'object' ? images : {};
    return collectReferencedImageKeys(exams).filter(key => (
        typeof imageEntries[key] !== 'string' || !imageEntries[key].startsWith('data:')
    ));
};

export const findMissingBackupPdfKeys = (exams, pdfs) => {
    const pdfEntries = pdfs && typeof pdfs === 'object' ? pdfs : {};
    return collectReferencedPdfKeys(exams).filter(key => (
        typeof pdfEntries[key]?.blob !== 'string'
        || !pdfEntries[key].blob.startsWith('data:application/pdf')
    ));
};
