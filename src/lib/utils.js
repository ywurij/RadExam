/**
 * Parses the question text to determine how many options should be selected.
 * Looks for patterns like "1つ選べ", "2つ選べ".
 * Registered answers take priority. When no answer is registered, the count is
 * inferred from instructions such as "2つ選べ", "２ つ選べ", or "二つ選べ".
 * @param {string} questionText
 * @param {string|string[]} answer
 * @returns {number} The number of options to select (default 1).
 */
export const getSelectionCount = (questionText, answer = []) => {
    const registeredAnswers = (Array.isArray(answer) ? answer : [answer])
        .flatMap(value => String(value || '').split(/[,、\s]+/))
        .map(value => value.trim())
        .filter(Boolean);

    if (registeredAnswers.length > 0) {
        return registeredAnswers.length;
    }

    if (!questionText) return 1;

    const normalizedText = String(questionText)
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;|&#160;/gi, ' ')
        .replace(/[０-９]/g, digit => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0));
    const numericMatch = normalizedText.match(/([0-9]+)\s*[つ個]\s*(?:選べ|選び|選択)/);
    if (numericMatch?.[1]) {
        return Math.max(1, parseInt(numericMatch[1], 10));
    }

    const japaneseNumerals = {
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
        十: 10,
    };
    const japaneseMatch = normalizedText.match(/([一二三四五六七八九十])\s*つ\s*(?:選べ|選び|選択)/);
    if (japaneseMatch?.[1]) {
        return japaneseNumerals[japaneseMatch[1]] || 1;
    }

    return 1;
};

/**
 * Checks if a user is whitelisted or has a valid invite code.
 * (Placeholder for now, actual logic will be in Auth context)
 */
export const validateInviteCode = (code) => {
    // TODO: Check against Firestore
    return true;
};
