const normalizeIdentifier = value => String(value ?? '').trim().toLowerCase();

export const getQuestionSearchIdentifiers = question => {
    const identifiers = [
        question?.id,
        question?.questionNumber,
    ];

    if (question?.year != null && question?.questionNumber != null) {
        identifiers.push(`${question.year}${String(question.questionNumber).padStart(3, '0')}`);
    }

    if (question?.examId && question?.id != null) {
        identifiers.push(`test_${question.examId}_${question.id}`);
    }

    return new Set(identifiers.map(normalizeIdentifier).filter(Boolean));
};

export const prioritizeExactQuestionIdMatches = (questions, query) => {
    const normalizedQuery = normalizeIdentifier(query);
    if (!normalizedQuery) return [];

    return questions.filter(question => (
        getQuestionSearchIdentifiers(question).has(normalizedQuery)
    ));
};
