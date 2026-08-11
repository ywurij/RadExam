import Fuse from 'fuse.js';
import { repairLegacySequentialComparisonOptions } from '@/lib/pdfImportText';
import { prioritizeExactQuestionIdMatches } from '@/lib/questionSearch.mjs';
import { 
    getLocalProgress, 
    getAllLocalExams, 
    getLocalExam 
} from '@/lib/localDb';

// メモリ上のキャッシュ
const CACHE = {};
let LOCAL_METADATA = {};
let IS_INITIALIZED = false;

export const LOCAL_EXAMS_CHANGED_EVENT = 'radexam-local-exams-changed';

const clearExamDataCache = () => {
    Object.keys(CACHE).forEach(examId => {
        delete CACHE[examId];
    });
};

/**
 * IndexedDBからローカルのカスタム試験メタデータをロードし、キャッシュを初期化する
 */
export const initializeLocalExams = async (force = false) => {
    if (IS_INITIALIZED && !force) return true;
    try {
        const localExams = await getAllLocalExams();
        const newMetadata = {};
        localExams.forEach(exam => {
            newMetadata[exam.id] = {
                name: exam.name,
                count: exam.count,
                years: exam.years || [],
                genres: exam.genres || []
            };
        });
        if (force) clearExamDataCache();
        LOCAL_METADATA = newMetadata;
        IS_INITIALIZED = true;
        return true;
    } catch (e) {
        console.error("Failed to initialize local exams:", e);
        return false;
    }
};

/**
 * クラウド同期などでIndexedDBが外部更新された後、画面用キャッシュを読み直す。
 */
export const refreshLocalExamData = async () => {
    const refreshed = await initializeLocalExams(true);
    if (
        refreshed
        && typeof window !== 'undefined'
        && typeof window.dispatchEvent === 'function'
    ) {
        window.dispatchEvent(new CustomEvent(LOCAL_EXAMS_CHANGED_EVENT));
    }
    return refreshed;
};

export const getExamTypes = () => {
    // キャッシュされたローカルカスタム試験を返す
    const localTypes = Object.entries(LOCAL_METADATA).map(([id, meta]) => ({
        id: id,
        name: meta.name,
        count: meta.count,
        isLocal: true
    }));

    return localTypes;
};

// 非同期でローカルIndexedDBのデータを取得
export const getExamData = async (examId) => {
    if (CACHE[examId]) return CACHE[examId];

    // まずローカル IndexedDB からの取得を試みる
    try {
        const localQuestions = await getLocalExam(examId);
        if (localQuestions && localQuestions.length > 0) {
            const data = localQuestions.map(q => ({
                ...q,
                options: repairLegacySequentialComparisonOptions(q.options),
                examId,
            }));
            CACHE[examId] = data;
            return data;
        }
    } catch (e) {
        console.error(`Failed to load local exam data for ${examId}`, e);
    }

    return [];
};

// 検索などのためにすべての問題をロードする (ローカル試験のみ)
export const getAllQuestions = async () => {
    // メタデータのキャッシュが初期化されているか確認
    if (!IS_INITIALIZED) {
        await initializeLocalExams();
    }
    const localIds = Object.keys(LOCAL_METADATA);
    
    const promises = localIds.map(id => getExamData(id));
    const results = await Promise.all(promises);
    return results.flatMap(r => r);
};

// ローカル試験データを基に検索を行う
export const searchQuestions = async (query, examId = null, customKeys = null) => {
    const rawData = examId ? await getExamData(examId) : await getAllQuestions();
    const data = rawData;

    const keys = customKeys || ['id', 'questionNumber', 'question', 'options.a', 'options.b', 'options.c', 'options.d', 'options.e', 'explanation', 'genre', 'year'];

    const options = {
        keys: keys,
        threshold: 0.3,
        ignoreLocation: true,
        useExtendedSearch: true
    };

    const fuse = new Fuse(data, options);
    const formattedQuery = query.trim().split(/[\s　]+/).map(term => `'${term}`).join(' ');
    const exactIdMatches = prioritizeExactQuestionIdMatches(data, query);
    const fuzzyMatches = fuse.search(formattedQuery).map(result => result.item);
    const seen = new Set(exactIdMatches);

    return [
        ...exactIdMatches,
        ...fuzzyMatches.filter(question => !seen.has(question)),
    ];
};

export const getYears = (examId) => {
    return LOCAL_METADATA[examId]?.years || [];
};

export const getGenres = (examId) => {
    return LOCAL_METADATA[examId]?.genres || [];
};

export const getExamName = (examId) => {
    return LOCAL_METADATA[examId]?.name || examId;
};

export const getQuestionsByYear = async (examId, yearFilter) => {
    const data = await getExamData(examId);
    if (!yearFilter || yearFilter === 'all') return data;

    if (!isNaN(yearFilter)) {
        return data.filter(q => q.year.toString() === yearFilter.toString());
    }

    // メタデータのキャッシュが初期化されているか確認
    if (!IS_INITIALIZED) {
        await initializeLocalExams();
    }

    const allYears = LOCAL_METADATA[examId]?.years || [];

    if (yearFilter === 'last3') {
        const targetYears = allYears.slice(0, 3);
        return data.filter(q => targetYears.includes(q.year));
    }
    if (yearFilter === 'last5') {
        const targetYears = allYears.slice(0, 5);
        return data.filter(q => targetYears.includes(q.year));
    }

    return data;
};

export const getGlobalQuestionId = (examId, questionId) => {
    return `test_${examId}_${questionId}`;
};
