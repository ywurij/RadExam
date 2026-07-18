const normalizeFullWidthAscii = value => String(value || '').replace(/[！-～]/g, character => (
    String.fromCharCode(character.charCodeAt(0) - 0xFEE0)
));

const buildPageText = page => (page?.textItems || [])
    .map(item => item?.text || item?.str || '')
    .join(' ');

const extractNoNumbers = text => {
    const numbers = [];
    const pattern = /(?:^|[^A-Za-z])No\.?\s*([0-9０-９]{1,3})/gi;
    let match;
    while ((match = pattern.exec(normalizeFullWidthAscii(text))) !== null) {
        const number = Number(match[1]);
        if (Number.isInteger(number) && !numbers.includes(number)) numbers.push(number);
    }
    return numbers;
};

const extractQuestionReferences = question => {
    const text = question?.question || '';
    const references = [];
    const pattern = /別紙[\s\S]{0,24}?No\.?\s*([0-9０-９]{1,3})/gi;
    let match;
    while ((match = pattern.exec(normalizeFullWidthAscii(text))) !== null) {
        const number = Number(match[1]);
        if (Number.isInteger(number) && !references.includes(number)) references.push(number);
    }
    return references;
};

const findAppendixStartPage = (questions, pages, totalPages) => {
    const lastQuestionStartPage = Math.max(
        0,
        ...(questions || []).map(question => Number(question?.startPage) || 0)
    );
    const pagesAfterLastQuestionStart = (pages || [])
        .filter(page => Number(page.pageNum) > lastQuestionStartPage)
        .sort((first, second) => Number(first.pageNum) - Number(second.pageNum));

    const appendixHeaderPage = pagesAfterLastQuestionStart.find(page => {
        const text = buildPageText(page);
        return /別紙/.test(text) && (/(?:核医学専門医試験|設問)/.test(text) || extractNoNumbers(text).length > 0);
    });

    if (appendixHeaderPage) return Number(appendixHeaderPage.pageNum);
    if (lastQuestionStartPage > 0 && lastQuestionStartPage < totalPages) return lastQuestionStartPage + 1;
    return null;
};

export const buildNuclearSourcePageAssignments = ({
    questions,
    pages,
    pdfName,
    pdfYear,
    totalPages
}) => {
    const appendixStartPage = findAppendixStartPage(questions, pages, totalPages);
    const appendixPages = appendixStartPage === null
        ? []
        : (pages || []).filter(page => (
            Number(page.pageNum) >= appendixStartPage && Number(page.pageNum) <= totalPages
        ));
    const pagesByFigureNumber = new Map();

    appendixPages.forEach(page => {
        extractNoNumbers(buildPageText(page)).forEach(figureNumber => {
            const matchedPages = pagesByFigureNumber.get(figureNumber) || [];
            matchedPages.push(page);
            pagesByFigureNumber.set(figureNumber, matchedPages);
        });
    });

    return (questions || []).map(question => {
        const explicitReferences = extractQuestionReferences(question);
        const referenceNumbers = explicitReferences;
        const matchedPages = referenceNumbers
            .flatMap(referenceNumber => pagesByFigureNumber.get(referenceNumber) || [])
            .filter((page, index, allPages) => (
                allPages.findIndex(candidate => Number(candidate.pageNum) === Number(page.pageNum)) === index
            ))
            .sort((first, second) => Number(first.pageNum) - Number(second.pageNum));

        return {
            questionNumber: question.questionNumber,
            sourcePages: matchedPages.map(page => ({
                pdfName,
                pdfYear: Number(pdfYear) || null,
                pageNumber: Number(page.pageNum),
                rotation: Number(page.rotation) || 0,
                focusRect: null,
                sourceType: 'nuclear-appendix',
                referenceNumbers
            }))
        };
    });
};
