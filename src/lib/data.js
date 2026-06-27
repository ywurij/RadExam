import Fuse from 'fuse.js';
import metadata from '@/data/metadata.json';
import { 
    getLocalProgress, 
    getAllLocalExams, 
    getLocalExam 
} from '@/lib/localDb';

const EXAM_LOADERS = {
    radiology: () => import('@/data/test_radiology.json'),
    diagnostic: () => import('@/data/test_diagnostic.json'),
    nuclear: () => import('@/data/test_nuclear.json'),
    ivr: () => import('@/data/test_ivr.json'),
};

const EXAM_NAMES = {
    radiology: '放射線科専門医試験',
    diagnostic: '診断専門医試験',
    nuclear: '核医学専門医試験',
    ivr: 'IVR専門医試験',
};

// メモリ上のキャッシュ
const CACHE = {};
let LOCAL_METADATA = {};
let IS_INITIALIZED = false;

/**
 * IndexedDBからローカルのカスタム試験メタデータをロードし、キャッシュを初期化する
 */
export const initializeLocalExams = async (force = false) => {
    if (IS_INITIALIZED && !force) return;
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
            if (force) {
                // キャッシュされている問題データをクリアして再読込を強制する
                delete CACHE[exam.id];
            }
        });
        LOCAL_METADATA = newMetadata;
        IS_INITIALIZED = true;
    } catch (e) {
        console.error("Failed to initialize local exams:", e);
    }
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

// 非同期でデータを取得 (静的またはローカルIndexedDB)
export const getExamData = async (examId) => {
    if (CACHE[examId]) return CACHE[examId];

    // まずローカル IndexedDB からの取得を試みる
    try {
        const localQuestions = await getLocalExam(examId);
        if (localQuestions && localQuestions.length > 0) {
            const data = localQuestions.map(q => ({ ...q, examId }));
            CACHE[examId] = data;
            return data;
        }
    } catch (e) {
        console.error(`Failed to load local exam data for ${examId}`, e);
    }

    // ローカルに存在しない（または空）の場合のみ、静的ファイルのローダーを使う
    const loader = EXAM_LOADERS[examId];
    if (loader) {
        try {
            const loadedModule = await loader();
            const rawData = loadedModule.default || loadedModule;

            // examId を各問題オブジェクトに注入
            const data = rawData.map(q => ({ ...q, examId }));

            CACHE[examId] = data;
            return data;
        } catch (e) {
            console.error(`Failed to load static data for ${examId}`, e);
        }
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

    const keys = customKeys || ['question', 'options.a', 'options.b', 'options.c', 'options.d', 'options.e', 'explanation', 'genre', 'year'];

    const options = {
        keys: keys,
        threshold: 0.3,
        ignoreLocation: true,
        useExtendedSearch: true
    };

    const fuse = new Fuse(data, options);
    const formattedQuery = query.trim().split(/[\s　]+/).map(term => `'${term}`).join(' ');

    return fuse.search(formattedQuery).map(result => result.item);
};

export const getYears = (examId) => {
    return LOCAL_METADATA[examId]?.years || [];
};

export const getGenres = (examId) => {
    return LOCAL_METADATA[examId]?.genres || [];
};

export const getExamName = (examId) => {
    return LOCAL_METADATA[examId]?.name || EXAM_NAMES[examId] || examId;
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
