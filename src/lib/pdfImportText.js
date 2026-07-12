const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const meaningfulItems = (items = []) => items
    .filter(item => String(item?.text || '').trim())
    .map(item => ({
        ...item,
        text: String(item.text).trim(),
        x: Number(item.x) || 0,
        width: Number(item.width) || 0,
    }));

const numericCellPattern = /^(?:[0-9]+(?:\.[0-9]+)?|[①-⑳])$/;

export const isPairedOptionHeader = (text) => {
    const normalized = String(text || '')
        .replace(/[\s　]/g, '')
        .replace(/[（]/g, '(')
        .replace(/[）]/g, ')');
    return /^\(A\)\(B\)$/i.test(normalized);
};

export const buildPairedOptionText = (items) => {
    const tokens = meaningfulItems(items)
        .filter((item, index) => !(index === 0 && /^[a-eａ-ｅ][.．)）]?$/i.test(item.text)));
    if (tokens.length < 2) return '';

    let splitIndex = -1;
    let largestGap = 0;
    for (let index = 1; index < tokens.length; index++) {
        const previousEnd = tokens[index - 1].x + tokens[index - 1].width;
        const gap = tokens[index].x - previousEnd;
        if (gap > largestGap) {
            largestGap = gap;
            splitIndex = index;
        }
    }

    if (splitIndex < 1 || largestGap < 16) return '';
    const left = tokens.slice(0, splitIndex).map(item => item.text).join('');
    const right = tokens.slice(splitIndex).map(item => item.text).join('');
    return left && right ? `${left} ― ${right}` : '';
};

export const extractQuestionTable = (lineEntries) => {
    const tableRows = (lineEntries || [])
        .map((entry, index) => {
            const items = meaningfulItems(entry.items);
            const numericItems = items.filter(item => numericCellPattern.test(item.text));
            return { index, items, numericItems };
        })
        .filter(row => row.numericItems.length >= 3);

    if (tableRows.length < 2) return { lineIndexes: new Set(), html: '' };

    const groups = [];
    tableRows.forEach(row => {
        const current = groups[groups.length - 1];
        if (current && row.index === current[current.length - 1].index + 1) {
            current.push(row);
        } else {
            groups.push([row]);
        }
    });
    const rows = groups.sort((a, b) => b.length - a.length)[0];
    if (!rows || rows.length < 2) return { lineIndexes: new Set(), html: '' };

    const columnCenters = rows[0].numericItems.map(item => item.x + item.width / 2);
    if (columnCenters.length < 3) return { lineIndexes: new Set(), html: '' };

    const firstColumnBoundary = columnCenters[0] - 14;
    const renderedRows = rows.map((row, rowIndex) => {
        const label = row.items
            .filter(item => item.x + item.width / 2 < firstColumnBoundary)
            .map(item => item.text)
            .join('');
        const cells = columnCenters.map((center, columnIndex) => {
            const left = columnIndex === 0 ? firstColumnBoundary : (columnCenters[columnIndex - 1] + center) / 2;
            const right = columnIndex === columnCenters.length - 1 ? Infinity : (center + columnCenters[columnIndex + 1]) / 2;
            return row.items
                .filter(item => {
                    const itemCenter = item.x + item.width / 2;
                    return itemCenter >= left && itemCenter < right;
                })
                .map(item => item.text)
                .join('');
        });
        const cellTag = rowIndex === 0 ? 'th' : 'td';
        return `<tr><${cellTag}>${escapeHtml(label)}</${cellTag}>${cells.map(cell => `<${cellTag}>${escapeHtml(cell)}</${cellTag}>`).join('')}</tr>`;
    });

    return {
        lineIndexes: new Set(rows.map(row => row.index)),
        html: `<div class="tableWrapper"><table><tbody>${renderedRows.join('')}</tbody></table></div>`,
    };
};

export const findNearestPrecedingQuestion = (questions, imageY) => {
    const candidates = (questions || []).filter(question => question.anchorY >= imageY - 5);
    if (candidates.length > 0) {
        return candidates.reduce((closest, candidate) => (
            (candidate.anchorY - imageY) < (closest.anchorY - imageY) ? candidate : closest
        ));
    }
    return (questions || [])[questions.length - 1] || null;
};
