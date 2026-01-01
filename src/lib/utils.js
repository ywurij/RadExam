/**
 * Parses the question text to determine how many options should be selected.
 * Looks for patterns like "1つ選べ", "2つ選べ".
 * @param {string} questionText 
 * @returns {number} The number of options to select (default 1).
 */
export const getSelectionCount = (questionText) => {
    if (!questionText) return 1;
    const match = questionText.match(/([0-9]+)つ選べ/);
    if (match && match[1]) {
        return parseInt(match[1], 10);
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
