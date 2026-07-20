export const APP_TARGET = process.env.NEXT_PUBLIC_APP_TARGET === 'mobile' ? 'mobile' : 'desktop';

export const APP_FEATURES = Object.freeze({
    pdfImport: APP_TARGET === 'desktop',
    examManagement: APP_TARGET === 'desktop',
    questionEditing: APP_TARGET === 'desktop',
    answerEditing: true,
    dataTransfer: true,
    explanationEditing: true,
    genreEditing: true,
});

export const isMobileTarget = APP_TARGET === 'mobile';
