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

export const extractOptionColumnHeaders = (items) => {
    const tokens = meaningfulItems(items);
    if (tokens.some(item => !/^[（(]?[A-E][）)]?$/i.test(item.text) && !/^[,、]$/.test(item.text))) {
        return [];
    }
    const headers = tokens
        .filter(item => /^[（(]?[A-E][）)]?$/i.test(item.text))
        .map(item => ({
            label: item.text.replace(/[（）()]/g, '').toUpperCase(),
            x: item.x + item.width / 2,
        }));
    const uniqueLabels = new Set(headers.map(header => header.label));
    return headers.length >= 2 && uniqueLabels.size === headers.length ? headers : [];
};

export const splitOptionItemsByColumns = (items, headers) => {
    if (!headers || headers.length < 2) return [];
    const tokens = meaningfulItems(items)
        .filter((item, index) => !(index === 0 && /^[a-eａ-ｅ][.．)）]?$/i.test(item.text)));
    return headers.map((header, index) => {
        const left = index === 0 ? -Infinity : (headers[index - 1].x + header.x) / 2;
        const right = index === headers.length - 1 ? Infinity : (header.x + headers[index + 1].x) / 2;
        return tokens.filter(item => {
            const center = item.x + item.width / 2;
            return center >= left && center < right;
        });
    });
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

    const rowsAreAligned = rows.slice(1).every(row => {
        const centers = row.numericItems.map(item => item.x + item.width / 2);
        return columnCenters.every(column => centers.some(center => Math.abs(center - column) <= 18));
    });
    if (!rowsAreAligned) return { lineIndexes: new Set(), html: '' };

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

export const removeContainedImageRects = (rects) => (rects || []).filter((rect, index, allRects) => {
    const area = Math.max(0, rect.w) * Math.max(0, rect.h);
    if (area === 0) return true;

    return !allRects.some((other, otherIndex) => {
        if (otherIndex === index) return false;
        const otherArea = Math.max(0, other.w) * Math.max(0, other.h);
        if (otherArea <= area * 2.5) return false;

        const overlapW = Math.max(0, Math.min(rect.x + rect.w, other.x + other.w) - Math.max(rect.x, other.x));
        const overlapH = Math.max(0, Math.min(rect.y + rect.h, other.y + other.h) - Math.max(rect.y, other.y));
        return (overlapW * overlapH) / area >= 0.65;
    });
});

export const isRepeatedOptionOrFigureLabel = (optionKey, parsedOptions, optionsStarted) => (
    Boolean(optionsStarted) && (
        Object.prototype.hasOwnProperty.call(parsedOptions || {}, optionKey)
        || Object.prototype.hasOwnProperty.call(parsedOptions || {}, 'e')
    )
);

const setLegends = (images, legends) => images.map((image, index) => ({
    ...image,
    legend: legends[index] ?? image.legend,
    detectedLegend: legends[index] ?? image.detectedLegend,
    displayLegend: legends[index] ?? image.displayLegend,
    legendResolved: legends[index] !== undefined ? true : image.legendResolved,
}));

export const applyDiagnosticImportCorrection = (year, question) => {
    const key = `${year}-${question.questionNumber}`;
    const images = [...(question.pageImages || [])].sort((a, b) => {
        if (Math.abs((b.y || 0) - (a.y || 0)) > 20) return (b.y || 0) - (a.y || 0);
        return (a.x || 0) - (b.x || 0);
    });

    switch (key) {
        case '2021-69':
            question.pageImages = setLegends(images.slice(0, 3), ['3分後', '15分後', '時間放射能曲線']);
            break;
        case '2022-28':
            question.pageImages = setLegends(images.slice(0, 3), ['左前斜位頭側像', '左側面頭側像', '心下面から見た像']);
            break;
        case '2022-43': {
            const centerX = images.reduce((sum, image) => sum + (image.x || 0), 0) / Math.max(1, images.length);
            question.pageImages = images.map(image => ({
                ...image,
                legend: (image.x || 0) < centerX ? '横断像' : '冠状断像',
                detectedLegend: (image.x || 0) < centerX ? '横断像' : '冠状断像',
                displayLegend: (image.x || 0) < centerX ? '横断像' : '冠状断像',
                legendResolved: true,
            }));
            break;
        }
        case '2022-54':
            question.pageImages = setLegends(images.slice(0, 2), ['カラードップラー超音波像', '単純CT']);
            break;
        case '2022-59':
            question.pageImages = setLegends(images.slice(0, 2), ['A', 'B']);
            break;
        case '2022-63': {
            const centerX = images.reduce((sum, image) => sum + (image.x || 0), 0) / Math.max(1, images.length);
            const centerY = images.reduce((sum, image) => sum + (image.y || 0), 0) / Math.max(1, images.length);
            question.pageImages = images.map(image => {
                const tracer = (image.y || 0) > centerY ? '<sup>123</sup>I-BMIPP' : '<sup>201</sup>Tl';
                const view = (image.x || 0) < centerX ? '短軸像' : '垂直長軸像';
                return {
                    ...image,
                    legend: `${tracer}${view}`,
                    detectedLegend: `${tracer}${view}`,
                    displayLegend: `${tracer}${view}`,
                    legendResolved: true,
                };
            });
            break;
        }
        case '2022-64':
            question.pageImages = setLegends(images.slice(0, 3), ['A', 'B', 'C']);
            break;
        case '2023-30':
            question.pageImages = setLegends(images.slice(0, 2), ['遅延造影像', 'T1 map: native T1=780 ms（基準値 1200～1250 ms）']);
            break;
        case '2023-51':
            question.question = String(question.question || '').replace(/<div class="tableWrapper">[\s\S]*?<\/div>/g, '').trim();
            question.pageImages = setLegends(images.slice(0, 3), ['T2強調像', '拡散強調像', 'ADC map']);
            break;
        case '2023-65':
            question.pageImages = setLegends(images.slice(0, 2), [
                '翌日: 2～3分 / 14～15分 / 29～30分',
                '8日後: 2～3分 / 14～15分 / 29～30分',
            ]);
            break;
        case '2024-85':
            question.pageImages = setLegends(images.slice(0, 1), ['列: 治療前 / 2か月後 / 1年後、行: MIP像 / 横断像']);
            break;
        case '2025-91':
            question.pageImages = setLegends(images.slice(0, 2), [
                '前面像（血流 / 換気）',
                '後面像（血流 / 換気）',
            ]);
            break;
        default:
            break;
    }

    return question;
};
