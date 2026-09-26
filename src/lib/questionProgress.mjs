export const getExamProgressKeyPrefix = examId => `test_${String(examId)}_`;

export const isProgressKeyForExam = (progressKey, examId) => (
    String(progressKey || '').startsWith(getExamProgressKeyPrefix(examId))
);

export const collectExamProgressDeletionKeys = ({
    examId,
    progressKeys = [],
    deletedQuestionIds = [],
    remainingQuestionIds = [],
} = {}) => {
    const deletedIds = new Set(deletedQuestionIds.map(String));
    const remainingIds = new Set(remainingQuestionIds.map(String));
    return [...new Set(progressKeys.map(String).filter(key => (
        isProgressKeyForExam(key, examId)
        || (deletedIds.has(key) && !remainingIds.has(key))
    )))];
};

export const getQuestionProgressKey = question => (
    question?.examId && question?.id != null
        ? `${getExamProgressKeyPrefix(question.examId)}${question.id}`
        : String(question?.id ?? '')
);

export const resolveQuestionProgress = (progress, question) => {
    if (!progress || !question) return {};
    const scopedKey = getQuestionProgressKey(question);
    return progress[scopedKey] || (!question.examId ? progress[question.id] : null) || {};
};
