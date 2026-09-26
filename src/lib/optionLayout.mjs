export const getOptionLayoutMode = (layout) => {
    if (!['columns', 'paired'].includes(layout?.type)) return 'normal';
    const count = Number(layout.columnCount) || (layout.type === 'paired' ? 2 : layout.headers?.length) || 2;
    return count >= 3 ? 'columns3' : 'columns2';
};

export const getOptionColumnCount = (layout) => (
    getOptionLayoutMode(layout) === 'columns3' ? 3 : 2
);

export const changeOptionLayoutMode = (layout, mode) => {
    if (mode === 'normal') return null;
    const columnCount = mode === 'columns3' ? 3 : 2;
    return {
        ...(layout && typeof layout === 'object' ? layout : {}),
        type: 'columns',
        columnCount,
        headers: Array.from({ length: columnCount }, (_, index) => layout?.headers?.[index] || ''),
    };
};

export const getEditableOptionCells = (value, columnCount) => {
    const cells = String(value ?? '').split(/\s*―\s*/s);
    if (cells.length > columnCount) return null;
    return Array.from({ length: columnCount }, (_, index) => cells[index] || '');
};

export const updateOptionCell = (value, columnCount, columnIndex, text) => {
    const cells = getEditableOptionCells(value, columnCount);
    if (!cells) return String(value ?? '');
    cells[columnIndex] = text;
    return cells.join(' ― ');
};

export const getOptionLayoutError = (options, layout) => {
    if (getOptionLayoutMode(layout) === 'normal') return '';
    const count = getOptionColumnCount(layout);
    const invalidKey = Object.entries(options || {}).find(([, value]) => {
        const text = String(value ?? '');
        if (!text.trim()) return false;
        const cells = text.split(/\s*―\s*/s);
        if (cells.every(cell => !cell.trim())) return false;
        return cells.length !== count || cells.some(cell => !cell.trim());
    })?.[0];
    return invalidKey ? `選択肢 ${invalidKey} は ${count} 列すべてに内容を入力してください。` : '';
};
