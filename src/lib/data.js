import Fuse from 'fuse.js';
import metadata from '@/data/metadata.json';
import { getAllOverrides, getUserExamProgress } from '@/lib/db'; // Import DB
import { auth } from '@/lib/firebase';

// ... (EXAM_LOADERS, EXAM_NAMES, CACHE remain same)

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
        const loadedModule = await loader();
        // default export for JSON is the data itself in some bundlers, or module.default
        const rawData = loadedModule.default || loadedModule;

        // Inject examId
        const data = rawData.map(q => ({ ...q, examId }));

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
export const searchQuestions = async (query, examId = null, customKeys = null) => {
    const rawData = examId ? await getExamData(examId) : await getAllQuestions();

    // 1. Fetch Overrides (Global)
    let globalOverrides = {};
    try {
        globalOverrides = await getAllOverrides();
    } catch (e) {
        console.error("Search global override fetch failed:", e);
    }

    // 2. Fetch User Progress (Personal Notes/Edits)
    let userProgress = {};
    const currentUser = auth.currentUser;
    if (currentUser) {
        try {
            userProgress = await getUserExamProgress(currentUser.uid);
        } catch (e) {
            console.error("Search user progress fetch failed:", e);
        }
    }

    // 3. Merge Data (Priority: User Note > Global Override > Original)
    const data = rawData.map(q => {
        // Start with the original question
        let merged = q;

        // Apply Global Override (if any)
        const gov = globalOverrides[q.id];
        if (gov) {
            merged = { ...merged, ...gov };
        }

        // Apply User Progress (if any)
        // We need the global ID to match user progress.
        // `q.examId` is now injected by `getExamData` or `getAllQuestions`.
        const globalId = getGlobalQuestionId(q.examId, q.id);
        const prog = userProgress[globalId];
        if (prog) {
            // Merge user progress fields, prioritizing user's note as explanation
            merged = { ...merged, ...prog };
            if (prog.note) {
                merged.explanation = prog.note; // User's note takes precedence for explanation
            }
        }

        return merged;
    });

    const keys = customKeys || ['question', 'options.a', 'options.b', 'options.c', 'options.d', 'options.e', 'explanation', 'genre', 'year'];

    const options = {
        keys: keys,
        threshold: 0.3, // Fuzzy matching threshold (applies if not using extended syntax)
        ignoreLocation: true,
        useExtendedSearch: true
    };

    const fuse = new Fuse(data, options);

    // Transform query for "AND" search with exact substrings
    // e.g. "MRI 脳" -> "'MRI '脳"
    // Split by half/full width space
    const formattedQuery = query.trim().split(/[\s　]+/).map(term => `'${term}`).join(' ');

    return fuse.search(formattedQuery).map(result => result.item);
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
