export const getQuestionProgressKey = question => (
    question?.examId && question?.id != null
        ? `test_${question.examId}_${question.id}`
        : String(question?.id ?? '')
);

export const resolveQuestionProgress = (progress, question) => {
    if (!progress || !question) return {};
    return progress[getQuestionProgressKey(question)] || progress[question.id] || {};
};
