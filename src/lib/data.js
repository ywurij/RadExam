import Fuse from 'fuse.js';
import metadata from '@/data/metadata.json';

// Map for dynamic imports
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

// Cached data in memory after loading
const CACHE = {};

export const getExamTypes = () => {
    // Return in specific order: Radiology, Diagnostic, Nuclear, IVR
    const order = ['radiology', 'diagnostic', 'nuclear', 'ivr'];
    return order.map(key => ({
        id: key,
        name: EXAM_NAMES[key] || key,
        count: metadata[key]?.count || 0
    }));
};

// Now ASYNC
export const getExamData = async (examId) => {
    if (CACHE[examId]) return CACHE[examId];

    const loader = EXAM_LOADERS[examId];
    if (!loader) return [];

    try {
        const module = await loader();
        // default export for JSON is the data itself in some bundlers, or module.default
        const data = module.default || module;
        CACHE[examId] = data;
        return data;
    } catch (e) {
        console.error(`Failed to load data for ${examId}`, e);
        return [];
    }
};

// Needed for search across ALL exams
// This operation is inherently heavy and will trigger loading of all chunks
export const getAllQuestions = async () => {
    const promises = Object.keys(EXAM_LOADERS).map(id => getExamData(id));
    const results = await Promise.all(promises);
    return results.flatMap(r => r);
};

// Client-side search using Fuse.js
// Make Async
export const searchQuestions = async (query, examId = null) => {
    const data = examId ? await getExamData(examId) : await getAllQuestions();

    const options = {
        keys: ['question', 'options.a', 'options.b', 'options.c', 'options.d', 'options.e', 'explanation', 'genre', 'year'],
        threshold: 0.3, // Fuzzy matching threshold
        ignoreLocation: true
    };

    const fuse = new Fuse(data, options);
    return fuse.search(query).map(result => result.item);
};

// Use Metadata (Sync)
export const getYears = (examId) => {
    return metadata[examId]?.years || [];
};

export const getGenres = (examId) => {
    return metadata[examId]?.genres || [];
};

// This needs actual data for "filtering" by default logic, but 
// we can keep it sync if we accept it might return empty if not loaded?
// Better to make it async OR rely on the fact that if we use this, we likely entered the exam and loaded data.
// However, ExamSelector used getYears/getGenres (now via metadata), but did NOT use getQuestionsByYear.
// getQuestionsByYear is likely used in the Quiz component.
export const getQuestionsByYear = async (examId, yearFilter) => {
    const data = await getExamData(examId);
    if (!yearFilter || yearFilter === 'all') return data;

    // Explicit year
    if (!isNaN(yearFilter)) {
        return data.filter(q => q.year.toString() === yearFilter.toString());
    }

    // Recent years logic
    // We can use metadata for "allYears" to avoid processing full data just for finding top 3
    const allYears = metadata[examId]?.years || [];

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
    // Legacy app used 'test_' prefix.
    // e.g. examId='radiology' -> 'test_radiology_2015001'
    return `test_${examId}_${questionId}`;
};
