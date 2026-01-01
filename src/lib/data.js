import Fuse from 'fuse.js';
import diagnostic from '@/data/test_diagnostic.json';
import ivr from '@/data/test_ivr.json';
import nuclear from '@/data/test_nuclear.json';
import radiology from '@/data/test_radiology.json';

const EXAMS = {
    radiology: { name: '放射線科専門医試験', data: radiology },
    diagnostic: { name: '診断専門医試験', data: diagnostic },
    nuclear: { name: '核医学専門医試験', data: nuclear },
    ivr: { name: 'IVR専門医試験', data: ivr },
};

export const getExamTypes = () => {
    // Return in specific order: Radiology, Diagnostic, Nuclear, IVR
    const order = ['radiology', 'diagnostic', 'nuclear', 'ivr'];
    return order.map(key => ({
        id: key,
        name: EXAMS[key].name,
        count: EXAMS[key].data.length
    }));
};

export const getExamData = (examId) => {
    return EXAMS[examId]?.data || [];
};

export const getAllQuestions = () => {
    return Object.values(EXAMS).flatMap(exam => exam.data);
};

// Client-side search using Fuse.js
export const searchQuestions = (query, examId = null) => {
    const data = examId ? getExamData(examId) : getAllQuestions();

    const options = {
        keys: ['question', 'options.a', 'options.b', 'options.c', 'options.d', 'options.e', 'explanation', 'genre', 'year'],
        threshold: 0.3, // Fuzzy matching threshold
        ignoreLocation: true
    };

    const fuse = new Fuse(data, options);
    return fuse.search(query).map(result => result.item);
};

export const getYears = (examId) => {
    const data = getExamData(examId);
    const years = new Set(data.map(q => q.year));
    return Array.from(years).sort((a, b) => b - a); // Descending
};

export const getQuestionsByYear = (examId, yearFilter) => {
    const data = getExamData(examId);
    if (!yearFilter || yearFilter === 'all') return data;

    // Explicit year
    if (!isNaN(yearFilter)) {
        return data.filter(q => q.year.toString() === yearFilter.toString());
    }

    // Recent years logic
    const allYears = Array.from(new Set(data.map(q => q.year))).sort((a, b) => b - a);
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

export const getGenres = (examId) => {
    const data = getExamData(examId);
    const genres = new Set();
    data.forEach(q => {
        // JSON might have "genre": "A" or "A・B" or array? 
        // Based on file view, it's a string like "基礎・物理"
        // We might want to split if needed, but for now exact match.
        if (q.genre) genres.add(q.genre);
    });
    return Array.from(genres).sort();
};

export const getGlobalQuestionId = (examId, questionId) => {
    // Legacy app used 'test_' prefix.
    // e.g. examId='radiology' -> 'test_radiology_2015001'
    return `test_${examId}_${questionId}`;
};
