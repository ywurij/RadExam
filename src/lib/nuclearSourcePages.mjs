const normalizeFullWidthAscii = value => String(value || '').replace(/[！-～]/g, character => (
    String.fromCharCode(character.charCodeAt(0) - 0xFEE0)
));

const buildPageText = page => (page?.textItems || [])
    .map(item => item?.text || item?.str || '')
    .join(' ');

const extractNoNumbers = text => {
    const numbers = [];
    const pattern = /No\.?\s*([0-9０-９]{1,3})/gi;
    let match;
    while ((match = pattern.exec(normalizeFullWidthAscii(text))) !== null) {
        const number = Number(match[1]);
        if (Number.isInteger(number) && !numbers.includes(number)) numbers.push(number);
    }
    return numbers;
};

const extractNoNumbersFromPage = page => {
    const items = page?.textItems || [];
    const numbers = [];

    items.forEach((item, itemIndex) => {
        const text = normalizeFullWidthAscii(item?.text || item?.str || '');
        const directNumbers = extractNoNumbers(text);
        directNumbers.forEach(number => {
            if (!numbers.includes(number)) numbers.push(number);
        });
        if (directNumbers.length > 0 || !/No\.?\s*$/i.test(text)) return;

        let joinedDigits = '';
        for (let nextIndex = itemIndex + 1; nextIndex < Math.min(items.length, itemIndex + 6); nextIndex += 1) {
            const nextText = normalizeFullWidthAscii(items[nextIndex]?.text || items[nextIndex]?.str || '').trim();
            if (!nextText) continue;
            if (!/^\d{1,2}$/.test(nextText)) break;
            joinedDigits += nextText;
            if (joinedDigits.length >= 2 || nextText.length >= 2) break;
        }
        const number = Number(joinedDigits);
        if (Number.isInteger(number) && number > 0 && !numbers.includes(number)) numbers.push(number);
    });

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
        extractNoNumbersFromPage(page).forEach(figureNumber => {
            const matchedPages = pagesByFigureNumber.get(figureNumber) || [];
            matchedPages.push(page);
            pagesByFigureNumber.set(figureNumber, matchedPages);
        });
    });

    return (questions || []).map(question => {
        const explicitReferences = extractQuestionReferences(question);
        const matchedExplicitReferences = explicitReferences.filter(referenceNumber => (
            pagesByFigureNumber.has(referenceNumber)
        ));
        const questionNumber = Number(question.questionNumber);
        const hasAppendixReference = /別紙/.test(normalizeFullWidthAscii(question.question || ''));
        const referenceNumbers = matchedExplicitReferences.length > 0
            ? matchedExplicitReferences
            : hasAppendixReference && pagesByFigureNumber.has(questionNumber)
                ? [questionNumber]
                : [];
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
