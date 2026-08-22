export const EXAM_IMPORT_DEFAULTS = Object.freeze({
    '1': Object.freeze({ id: 'radiology', name: '放射線科専門医' }),
    '2': Object.freeze({ id: 'diagnostic', name: '放射線科診断専門医' }),
    '3': Object.freeze({ id: 'nuclear', name: '核医学専門医' }),
    '4': Object.freeze({ id: 'IVR', name: 'IVR専門医' }),
    '5': Object.freeze({ id: 'radiation', name: '放射線治療専門医' }),
});

export const EXAM_IMPORT_CATEGORY_OPTIONS = Object.freeze([
    Object.freeze({ id: '1', label: '1. 放射線科専門医試験' }),
    Object.freeze({ id: '2', label: '2. 放射線診断専門医試験' }),
    Object.freeze({ id: '5', label: '3. 放射線治療専門医試験' }),
    Object.freeze({ id: '3', label: '4. 核医学専門医試験' }),
    Object.freeze({ id: '4', label: '5. IVR専門医試験' }),
]);

export const getExamImportDefaults = category => (
    EXAM_IMPORT_DEFAULTS[String(category)] || EXAM_IMPORT_DEFAULTS['1']
);
