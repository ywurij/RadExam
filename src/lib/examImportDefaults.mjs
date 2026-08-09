export const EXAM_IMPORT_DEFAULTS = Object.freeze({
    '1': Object.freeze({ id: 'radiology', name: '放射線科専門医' }),
    '2': Object.freeze({ id: 'diagnostic', name: '放射線科診断専門医' }),
    '3': Object.freeze({ id: 'nuclear', name: '核医学専門医' }),
    '4': Object.freeze({ id: 'IVR', name: 'IVR専門医' }),
});

export const getExamImportDefaults = category => (
    EXAM_IMPORT_DEFAULTS[String(category)] || EXAM_IMPORT_DEFAULTS['1']
);
