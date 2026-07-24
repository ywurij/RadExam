import localforage from 'localforage';
import {
    collectReferencedImageKeys,
    collectReferencedPdfKeys,
    findMissingBackupImageKeys,
    findMissingBackupPdfKeys,
} from '@/lib/backupData.mjs';

// --- インスタンスの設定 ---

// 既存ユーザーのIndexedDBを引き続き読めるよう、内部DB名は旧名称のまま維持する。
// この値は画面表示やエクスポートファイル名には使用しない。

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

// 画像データを問題JSONから分離して保存するためのストア
const imageStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'exam_images',
    description: 'ローカル試験画像を保存するストア'
});

const pdfStore = localforage.createInstance({
    name: 'RadTestLocal',
    storeName: 'exam_pdfs',
    description: '試験登録に使用したPDFを保存するストア'
});

const LOCAL_IMAGE_PREFIX = 'local-image://';

const isDataUrl = (value) => typeof value === 'string' && value.startsWith('data:');
const isLocalImageRef = (value) => typeof value === 'string' && value.startsWith(LOCAL_IMAGE_PREFIX);
const buildLocalImageRef = (key) => `${LOCAL_IMAGE_PREFIX}${key}`;
const extractLocalImageKey = (value) => isLocalImageRef(value) ? value.slice(LOCAL_IMAGE_PREFIX.length) : '';
const buildExamImageKeyPrefix = (examId) => `${examId}::`;
const buildExamPdfKeyPrefix = (examId) => `${examId}::`;
const resolveImageLegend = (source) => (
    Object.prototype.hasOwnProperty.call(source, 'legend')
        ? String(source.legend ?? '')
        : ''
);
const buildExamImageKey = (examId, questionId, imageIndex) => {
    const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    return `${buildExamImageKeyPrefix(examId)}${questionId}::${imageIndex}::${suffix}`;
};

const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    return response.blob();
};

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
        if (typeof reader.result === 'string') {
            resolve(reader.result);
            return;
        }
        reject(new Error('Failed to convert blob to data URL.'));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read blob.'));
    reader.readAsDataURL(blob);
});

const binaryValueToDataUrl = async (value, label = '保存データ') => {
    if (isDataUrl(value)) return value;
    if (value instanceof Blob) return blobToDataUrl(value);
    if (value instanceof ArrayBuffer) return blobToDataUrl(new Blob([value]));
    if (ArrayBuffer.isView(value)) {
        return blobToDataUrl(new Blob([
            value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
        ]));
    }
    throw new Error(`${label}をバックアップ用データへ変換できませんでした。`);
};

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

const normalizeStoredImage = async (examId, questionId, image, imageIndex) => {
    const source = image && typeof image === 'object' ? image : {};
    const legend = resolveImageLegend(source);
    const metadata = {
        ...(source.layout ? { layout: source.layout } : {}),
        ...(source.legendLayout ? { legendLayout: source.legendLayout } : {})
    };
    const storageKey = source.storageKey || extractLocalImageKey(source.path);
    const originalPath = typeof source.path === 'string' ? source.path : '';

    if (storageKey) {
        return {
            path: buildLocalImageRef(storageKey),
            legend,
            storageKey,
            ...metadata
        };
    }

    if (isDataUrl(originalPath)) {
        const imageKey = buildExamImageKey(examId, questionId, imageIndex);
        const blob = await dataUrlToBlob(originalPath);
        await imageStore.setItem(imageKey, blob);
        return {
            path: buildLocalImageRef(imageKey),
            legend,
            storageKey: imageKey,
            ...metadata
        };
    }

    return {
        path: originalPath,
        legend,
        storageKey: '',
        ...metadata
    };
};

const prepareQuestionsForStorage = async (examId, questions) => {
    const usedImageKeys = new Set();

    const preparedQuestions = await Promise.all(
        questions.map(async (question) => {
            const normalizedQuestion = normalizeQuestionId(question);
            const images = Array.isArray(normalizedQuestion.images) ? normalizedQuestion.images : [];

            const preparedImages = await Promise.all(
                images.map((image, imageIndex) => normalizeStoredImage(examId, normalizedQuestion.id, image, imageIndex))
            );

            preparedImages.forEach((image) => {
                if (image.storageKey) {
                    usedImageKeys.add(image.storageKey);
                }
            });

            return {
                ...normalizedQuestion,
                images: preparedImages.map(({ storageKey: _storageKey, ...image }) => image)
            };
        })
    );

    return { preparedQuestions, usedImageKeys };
};

const cleanupOrphanExamImages = async (examId, usedImageKeys) => {
    const prefix = buildExamImageKeyPrefix(examId);
    const deleteTargets = [];

    await imageStore.iterate((_value, key) => {
        if (key.startsWith(prefix) && !usedImageKeys.has(key)) {
            deleteTargets.push(key);
        }
    });

    await Promise.all(deleteTargets.map((key) => imageStore.removeItem(key)));
};

const hydrateQuestionImages = async (question) => {
    const images = Array.isArray(question.images) ? question.images : [];

    const hydratedImages = await Promise.all(images.map(async (image) => {
        const source = image && typeof image === 'object' ? image : {};
        const metadata = {
            ...(source.layout ? { layout: source.layout } : {}),
            ...(source.legendLayout ? { legendLayout: source.legendLayout } : {})
        };
        const storageKey = extractLocalImageKey(source.path);
        if (!storageKey) {
            return {
                path: source.path || '',
                legend: resolveImageLegend(source),
                ...metadata
            };
        }

        const blob = await imageStore.getItem(storageKey);
        if (!blob) {
            return {
                path: '',
                legend: resolveImageLegend(source),
                storageKey,
                ...metadata
            };
        }

        const path = await blobToDataUrl(blob);
        return {
            path,
            legend: resolveImageLegend(source),
            storageKey,
            ...metadata
        };
    }));

    return {
        ...question,
        images: hydratedImages
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
    const { preparedQuestions, usedImageKeys } = await prepareQuestionsForStorage(examId, finalQuestions);
    await cleanupOrphanExamImages(examId, usedImageKeys);

    const years = [...new Set(preparedQuestions.map(q => q.year).filter(Boolean))].map(Number).sort((a, b) => b - a);
    const genres = [...new Set(preparedQuestions.map(q => q.genre).filter(Boolean))].sort();
    
    const examData = {
        id: examId,
        name: finalName,
        questions: preparedQuestions,
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
        if (!examData || !Array.isArray(examData.questions)) return [];
        return Promise.all(examData.questions.map((question) => hydrateQuestionImages(question)));
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
    await cleanupOrphanExamImages(examId, new Set());
    const pdfKeys = [];
    await pdfStore.iterate((_value, key) => {
        if (key.startsWith(buildExamPdfKeyPrefix(examId))) pdfKeys.push(key);
    });
    await Promise.all(pdfKeys.map(key => pdfStore.removeItem(key)));
};

export const saveExamPdf = async (examId, year, file) => {
    if (!examId || !file) return;
    const name = file.name || `${year || 'unknown'}.pdf`;
    const key = `${buildExamPdfKeyPrefix(examId)}${year || 'unknown'}::${name}`;
    await pdfStore.setItem(key, {
        examId,
        year: Number(year) || null,
        name,
        type: file.type || 'application/pdf',
        size: file.size || 0,
        blob: file instanceof Blob ? file : new Blob([file], { type: 'application/pdf' }),
        updatedAt: new Date().toISOString(),
    });
};

export const getExamPdfs = async (examId) => {
    const records = [];
    await pdfStore.iterate((value, key) => {
        if (key.startsWith(buildExamPdfKeyPrefix(examId))) records.push({ key, ...value });
    });
    return records.sort((a, b) => (b.year || 0) - (a.year || 0) || a.name.localeCompare(b.name, 'ja'));
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

    const { preparedQuestions, usedImageKeys } = await prepareQuestionsForStorage(examId, nextQuestions);
    await cleanupOrphanExamImages(examId, usedImageKeys);

    const years = [...new Set(preparedQuestions.map(q => q.year).filter(Boolean))].map(Number).sort((a, b) => b - a);
    const genres = [...new Set(preparedQuestions.map(q => q.genre).filter(Boolean))].sort();

    await examsStore.setItem(examId, {
        ...examData,
        questions: preparedQuestions,
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
export const exportAllLocalData = async ({ includePdfs = true } = {}) => {
    const backup = {
        version: 3,
        timestamp: Date.now(),
        exams: {},
        progress: {},
        images: {},
        pdfs: {}
    };

    // 試験データをエクスポート用に追加
    await examsStore.iterate((value, key) => {
        backup.exams[key] = value;
    });

    // 進捗データをエクスポート用に追加
    await progressStore.iterate((value, key) => {
        backup.progress[key] = value;
    });

    // 問題データが実際に参照している画像をキー指定で取得する。
    // imageStore.iterate()だけに依存すると、一部環境でBlobが列挙されず、
    // 参照だけが残った不完全なバックアップになることがある。
    const referencedImageKeys = collectReferencedImageKeys(backup.exams);
    const missingImageKeys = [];
    for (const key of referencedImageKeys) {
        const value = await imageStore.getItem(key);
        if (value == null) {
            missingImageKeys.push(key);
            continue;
        }
        backup.images[key] = await binaryValueToDataUrl(value);
    }

    if (missingImageKeys.length > 0) {
        throw new Error(
            `問題が参照している画像${referencedImageKeys.length}件のうち`
            + `${missingImageKeys.length}件を読み出せませんでした。`
            + '元データが表示できる環境で再度エクスポートしてください。'
        );
    }

    if (includePdfs) {
        const pdfRecords = new Map();
        await pdfStore.iterate((value, key) => {
            pdfRecords.set(key, value);
        });

        // PDFストアの全件走査だけに依存すると、Blobを含むレコードが環境によって
        // 取りこぼされるため、問題のsourcePagesが参照する保存キーを直接取得する。
        const referencedPdfKeys = collectReferencedPdfKeys(backup.exams);
        const missingPdfKeys = [];
        for (const key of referencedPdfKeys) {
            const value = await pdfStore.getItem(key);
            if (value == null) {
                missingPdfKeys.push(key);
                continue;
            }
            pdfRecords.set(key, value);
        }

        if (missingPdfKeys.length > 0) {
            throw new Error(
                `問題が参照しているPDF${referencedPdfKeys.length}件のうち`
                + `${missingPdfKeys.length}件を読み出せませんでした。`
                + '元のPDFを再登録してからエクスポートしてください。'
            );
        }

        await Promise.all([...pdfRecords].map(async ([key, value]) => {
            backup.pdfs[key] = {
                ...value,
                blob: await binaryValueToDataUrl(value?.blob, `PDF「${value?.name || key}」`),
            };
        }));
    }

    return backup;
};

/**
 * バックアップJSONデータをローカルにインポートする
 * @param {Object} jsonData - インポートするバックアップデータ
 * @param {string} strategy - 'overwrite' (上書き)
 */
export const importLocalData = async (jsonData, strategy = 'overwrite', { includePdfs = true } = {}) => {
    if (!jsonData || typeof jsonData !== 'object') {
        throw new Error("Invalid backup data format");
    }

    if (strategy !== 'overwrite') {
        throw new Error("Unsupported import strategy");
    }

    const { exams, progress, images, pdfs } = jsonData;
    const missingImageKeys = findMissingBackupImageKeys(exams, images);
    if (missingImageKeys.length > 0) {
        throw new Error(
            `バックアップ内の画像が${missingImageKeys.length}件不足しています。`
            + '現在のデータは変更していません。元の端末から新しくエクスポートしてください。'
        );
    }
    const missingPdfKeys = includePdfs ? findMissingBackupPdfKeys(exams, pdfs) : [];
    if (missingPdfKeys.length > 0) {
        throw new Error(
            `バックアップ内の参照PDFが${missingPdfKeys.length}件不足しています。`
            + '現在のデータは変更していません。元の端末から新しくエクスポートしてください。'
        );
    }

    // 現在のデータを消去する前に、すべての画像・PDFを復元可能な形式へ変換する。
    const preparedImages = [];
    for (const [key, value] of Object.entries(images || {})) {
        preparedImages.push([key, isDataUrl(value) ? await dataUrlToBlob(value) : value]);
    }

    const preparedPdfs = [];
    if (includePdfs && pdfs && typeof pdfs === 'object') {
        for (const [key, value] of Object.entries(pdfs)) {
            preparedPdfs.push([key, {
                ...value,
                blob: isDataUrl(value?.blob) ? await dataUrlToBlob(value.blob) : value?.blob,
            }]);
        }
    }

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

    // 3. 画像データのインポート
    await imageStore.clear();
    for (const [key, value] of preparedImages) {
        await imageStore.setItem(key, value);
    }

    await pdfStore.clear();
    for (const [key, value] of preparedPdfs) {
        await pdfStore.setItem(key, value);
    }
};
