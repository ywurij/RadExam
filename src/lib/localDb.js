import localforage from 'localforage';

// --- インスタンスの設定 ---

// カスタム試験データを保存するためのストア
const examsStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'custom_exams',
    description: 'ユーザーが独自に追加した試験データを保存するストア'
});

// ユーザーの回答状況、いいね、メモ（ノート）を保存するためのストア
const progressStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'user_progress',
    description: 'ユーザーの演習進捗、お気に入り、ノートを保存するストア'
});

const normalizeQuestionId = (question) => {
    if (!question || typeof question !== 'object') return question;

    const year = Number(question.year);
    const rawId = String(question.id ?? '').trim();
    if (!rawId) return question;

    if (/^\d{7}$/.test(rawId)) {
        return question;
    }

    const questionNumber = Number(question.questionNumber ?? rawId);
    if (!Number.isInteger(year) || !Number.isInteger(questionNumber)) {
        return question;
    }

    return {
        ...question,
        id: `${year}${String(questionNumber).padStart(3, '0')}`,
        questionNumber,
    };
};

// --- カスタム試験 (Custom Exams) 関連のAPI ---

/**
 * カスタム試験データを保存する
 * @param {string} examId - 試験ID (例: 'my_exam_2026')
 * @param {string} name - 試験の表示名 (例: '2026年 独自試験')
 * @param {Array} questions - 問題データの配列
 */
export const saveLocalExam = async (examId, name, questions, isMerge = false) => {
    if (!examId || !questions) return;
    
    let finalName = name;
    let finalQuestions = questions.map(normalizeQuestionId);
    
    // マージ（追加）モードの場合、既存の試験データを取得してマージする
    if (isMerge) {
        try {
            const existingExam = await examsStore.getItem(examId);
            if (existingExam) {
                // 既存の表示名 (name) を最優先で維持する
                if (existingExam.name) {
                    finalName = existingExam.name;
                }
                if (Array.isArray(existingExam.questions)) {
                    const normalizedExistingQuestions = existingExam.questions.map(normalizeQuestionId);
                    // 重複問題の排除（同じ問題IDがある場合は新データを優先または無視）
                    const existingIds = new Set(normalizedExistingQuestions.map(q => q.id));
                    const newQuestions = finalQuestions.filter(q => !existingIds.has(q.id));
                    finalQuestions = [...normalizedExistingQuestions, ...newQuestions];
                }
            }
        } catch (e) {
            console.error("Failed to merge with existing exam data:", e);
        }
    }
    
    // ユニークな年度とジャンルを抽出してメタデータとして保存
    const years = [...new Set(finalQuestions.map(q => q.year).filter(Boolean))].map(Number).sort((a, b) => b - a);
    const genres = [...new Set(finalQuestions.map(q => q.genre).filter(Boolean))].sort();
    
    const examData = {
        id: examId,
        name: finalName,
        questions: finalQuestions,
        years: years,
        genres: genres,
        updatedAt: new Date().toISOString()
    };
    
    await examsStore.setItem(examId, examData);
};

/**
 * 指定されたカスタム試験のデータを取得する
 * @param {string} examId 
 * @returns {Promise<Array>} 問題データの配列
 */
export const getLocalExam = async (examId) => {
    try {
        const examData = await examsStore.getItem(examId);
        return examData ? examData.questions : [];
    } catch (e) {
        console.error(`Failed to get local exam: ${examId}`, e);
        return [];
    }
};

/**
 * 保存されているすべてのカスタム試験のメタデータ（IDと名前）を取得する
 * @returns {Promise<Array<{id: string, name: string, count: number}>>}
 */
export const getAllLocalExams = async () => {
    const exams = [];
    try {
        await examsStore.iterate((value, key) => {
            exams.push({
                id: key,
                name: value.name || key,
                count: value.questions ? value.questions.length : 0,
                years: value.years || [],
                genres: value.genres || []
            });
        });
    } catch (e) {
        console.error("Failed to iterate local exams:", e);
    }
    return exams;
};

/**
 * カスタム試験を削除する
 * @param {string} examId 
 */
export const deleteLocalExam = async (examId) => {
    await examsStore.removeItem(examId);
};

/**
 * 指定したローカル試験内の1問を更新する
 * @param {string} examId
 * @param {string|number} questionId
 * @param {Object} updates
 */
export const updateLocalQuestion = async (examId, questionId, updates) => {
    if (!examId || !questionId || !updates || typeof updates !== 'object') return;

    const examData = await examsStore.getItem(examId);
    if (!examData || !Array.isArray(examData.questions)) {
        throw new Error('編集対象の試験データが見つかりません。');
    }

    const targetId = String(questionId);
    let found = false;

    const nextQuestions = examData.questions.map((question) => {
        if (String(question.id) !== targetId) {
            return normalizeQuestionId(question);
        }

        found = true;
        const mergedQuestion = normalizeQuestionId({
            ...question,
            ...updates,
        });
        return mergedQuestion;
    });

    if (!found) {
        throw new Error('編集対象の問題が見つかりません。');
    }

    const years = [...new Set(nextQuestions.map(q => q.year).filter(Boolean))].map(Number).sort((a, b) => b - a);
    const genres = [...new Set(nextQuestions.map(q => q.genre).filter(Boolean))].sort();

    await examsStore.setItem(examId, {
        ...examData,
        questions: nextQuestions,
        years,
        genres,
        updatedAt: new Date().toISOString(),
    });
};


// --- ユーザー進捗 (User Progress) 関連のAPI ---

/**
 * ユーザーの進捗状況をローカルに保存（マージ）する
 * @param {string|number} questionId - グローバルな問題ID (例: 'test_ivr_2016001')
 * @param {Object} data - 保存するデータ (status, isLiked など)
 */
export const saveLocalProgress = async (questionId, data) => {
    if (!questionId) return;
    
    const strId = questionId.toString();
    try {
        const existing = await progressStore.getItem(strId) || {};
        const updated = {
            ...existing,
            ...data,
            updatedAt: new Date().toISOString()
        };
        await progressStore.setItem(strId, updated);
    } catch (e) {
        console.error(`Failed to save local progress for ${questionId}:`, e);
    }
};

/**
 * すべてのユーザー進捗データを取得する
 * 既存の `getUserExamProgress` と同じフォーマットで返します。
 * @returns {Promise<Object>} キーが questionId、値が進捗オブジェクトのマップ
 */
export const getLocalProgress = async () => {
    const progress = {};
    try {
        await progressStore.iterate((value, key) => {
            progress[key] = value;
        });
    } catch (e) {
        console.error("Failed to iterate local progress:", e);
    }
    return progress;
};

// --- バックアップと復元 (Backup & Restore) ---

/**
 * すべてのローカルデータをエクスポート用JSONオブジェクトとして取得する
 * @returns {Promise<Object>}
 */
export const exportAllLocalData = async () => {
    const backup = {
        version: 1,
        timestamp: Date.now(),
        exams: {},
        progress: {}
    };

    // 試験データをエクスポート用に追加
    await examsStore.iterate((value, key) => {
        backup.exams[key] = value;
    });

    // 進捗データをエクスポート用に追加
    await progressStore.iterate((value, key) => {
        backup.progress[key] = value;
    });

    return backup;
};

/**
 * バックアップJSONデータをローカルにインポートする
 * @param {Object} jsonData - インポートするバックアップデータ
 * @param {string} strategy - 'overwrite' (上書き)
 */
export const importLocalData = async (jsonData, strategy = 'overwrite') => {
    if (!jsonData || typeof jsonData !== 'object') {
        throw new Error("Invalid backup data format");
    }

    if (strategy !== 'overwrite') {
        throw new Error("Unsupported import strategy");
    }

    const { exams, progress } = jsonData;

    // 1. 試験データのインポート
    if (exams && typeof exams === 'object') {
        await examsStore.clear();
        for (const [key, value] of Object.entries(exams)) {
            await examsStore.setItem(key, value);
        }
    }

    // 2. 進捗データのインポート
    if (progress && typeof progress === 'object') {
        await progressStore.clear();
        for (const [key, value] of Object.entries(progress)) {
            await progressStore.setItem(key, value);
        }
    }
};
