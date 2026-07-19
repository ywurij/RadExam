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

export const hasExplicitFigureCue = (questionText) => {
    const text = String(questionText || '').replace(/[\s　]+/g, ' ');
    if (!text) return false;

    return /(?:図|シェーマ|模式図|先端形状)/.test(text)
        || /(?:画像|写真).{0,16}(?:を|に|で)(?:示す|示した|示される|示している)/.test(text)
        || /(?:この|次の|以下の|上の|下の|右の|左の)(?:画像|写真)/.test(text)
        || /造影.{0,8}(?:を|に|で)(?:示す|示した|示される)/.test(text);
};

export const isUsableFallbackFigureCrop = (width, height) => {
    const cropWidth = Number(width);
    const cropHeight = Number(height);
    if (!Number.isFinite(cropWidth) || !Number.isFinite(cropHeight)) return false;
    if (cropWidth < 20 || cropHeight < 20) return false;

    // 問題番号枠や小さな文字断片だけを拾ったクロップを除外する。
    // 細長いグラフ・スケールは、十分な面積があれば維持する。
    return cropWidth * cropHeight >= 10000;
};

export const joinOptionContinuation = (optionText, continuationText) => (
    [String(optionText || '').trim(), String(continuationText || '').trim()]
        .filter(Boolean)
        .join(' ')
);

export const isStandaloneImageLegendText = (value) => {
    const text = String(value || '').replace(/[\s　]+/g, ' ').trim();
    if (!text || text.length > 50) return false;
    if (/[。！？!?]$/.test(text)) return false;
    if (/(?:である|ではない|を示す|がみられる|を認める|を用いる|を行う)$/.test(text)) return false;

    if (/(?:CT|MRI|像|写真|図|曲線|シンチ|造影|エコー|DWI|FLAIR|PET)/i.test(text)) {
        return true;
    }

    // 選択肢の後に置かれる撮像時点・撮像相は、文章ではなく画像レジェンドとして扱う。
    // 複数画像のレジェンドがPDF上で同じ行に並ぶ場合や、テキスト要素間に空白が
    // 入らない場合（例: 「発症当日発症10日後」）にも対応する。
    const compactText = text.replace(/[\s　]/g, '');
    const temporalPoint = '(?:当日|直後|前|後|半(?:年|か月|ヶ月)(?:前|後)|[0-9０-９]+(?:分|時間|日|週|か月|ヶ月|月|年)(?:前|後)?)';
    const temporalLegendSequence = new RegExp(`^(?:(?:負荷時|安静時)|(?:発症|治療|手技|術|撮像|検査)?${temporalPoint}[、,/・]*)+$`);
    const temporalLegendWithPlotLabels = new RegExp(`^(?:発症|治療|手技|術|撮像|検査)?${temporalPoint}(?:[A-Za-z]+[0-9０-９]+)+$`);
    const plotLabelSequence = /^(?:(?:H|L)[0-9０-９]+|(?:[A-Za-z]+[0-9０-９]+){2,})$/i;
    const phaseLegendSequence = /^(?:(?:CT|MRI|EOB|造影)?(?:早期|後期|遅延|動脈|門脈|門脈優位|静脈|平衡|肝細胞|後期動脈)?相[、,/・]*)+$/i;

    return temporalLegendSequence.test(compactText)
        || temporalLegendWithPlotLabels.test(compactText)
        || plotLabelSequence.test(compactText)
        || phaseLegendSequence.test(compactText);
};

const getImageVisualTop = image => (Number(image?.y) || 0) + (Number(image?.h) || 0);
const getImageVisualBottom = image => Number(image?.y) || 0;

export const compareImageReadingOrder = (a, b, rowTolerance = 20) => {
    if ((a.page ?? 0) !== (b.page ?? 0)) return (a.page ?? 0) - (b.page ?? 0);

    const aFigureNumber = Number.isFinite(a.figureNumber) ? a.figureNumber : null;
    const bFigureNumber = Number.isFinite(b.figureNumber) ? b.figureNumber : null;
    if (
        a.matchedQNum !== null
        && b.matchedQNum !== null
        && a.matchedQNum === b.matchedQNum
        && aFigureNumber !== null
        && bFigureNumber !== null
        && aFigureNumber !== bFigureNumber
    ) {
        return aFigureNumber - bFigureNumber;
    }

    // PDFのyは画像下端を表す。高さの異なる左右画像は、上端または下端の
    // どちらかが揃っていれば同じ行とみなし、PDF上の左右順を維持する。
    const topDifference = getImageVisualTop(b) - getImageVisualTop(a);
    const bottomDifference = getImageVisualBottom(b) - getImageVisualBottom(a);
    const sameVisualRow = Math.abs(topDifference) <= rowTolerance
        || Math.abs(bottomDifference) <= rowTolerance;
    if (sameVisualRow) return (Number(a.x) || 0) - (Number(b.x) || 0);
    return topDifference;
};

const getRectGap = (firstMin, firstMax, secondMin, secondMax) => {
    if (firstMax < secondMin) return secondMin - firstMax;
    if (secondMax < firstMin) return firstMin - secondMax;
    return 0;
};

const unionImageRects = rects => {
    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.h));
    const matchedQuestionNumbers = new Set(rects.map(rect => rect.matchedQNum).filter(Number.isFinite));

    return {
        ...rects[0],
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        matchedQNum: matchedQuestionNumbers.size === 1 ? [...matchedQuestionNumbers][0] : null,
    };
};

export const mergeVerticallyAdjacentImageRects = (
    rects = [],
    { maxGap = 8, minHorizontalOverlapRatio = 0.85 } = {},
) => {
    if (rects.length <= 1) return rects;

    const shouldMerge = (first, second) => {
        const overlapX = Math.max(0, Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x));
        const minWidth = Math.min(first.w, second.w);
        if (minWidth <= 0 || overlapX / minWidth < minHorizontalOverlapRatio) return false;

        const verticalGap = getRectGap(first.y, first.y + first.h, second.y, second.y + second.h);
        const overlapsVertically = Math.min(first.y + first.h, second.y + second.h) > Math.max(first.y, second.y);
        return !overlapsVertically && verticalGap <= maxGap;
    };

    const visited = new Set();
    const merged = [];
    rects.forEach((rect, index) => {
        if (visited.has(index)) return;
        visited.add(index);
        const stack = [index];
        const cluster = [];

        while (stack.length > 0) {
            const currentIndex = stack.pop();
            const current = rects[currentIndex];
            cluster.push(current);
            rects.forEach((candidate, candidateIndex) => {
                if (visited.has(candidateIndex) || !shouldMerge(current, candidate)) return;
                visited.add(candidateIndex);
                stack.push(candidateIndex);
            });
        }

        merged.push(cluster.length > 1 ? unionImageRects(cluster) : cluster[0]);
    });

    return merged;
};

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

const distanceFromPointToRect = (point, rect) => {
    const minX = Number(rect.minX ?? rect.x) || 0;
    const minY = Number(rect.minY ?? rect.y) || 0;
    const maxX = Number(rect.maxX ?? (minX + (Number(rect.w) || 0))) || minX;
    const maxY = Number(rect.maxY ?? (minY + (Number(rect.h) || 0))) || minY;
    const x = Number(point.x) + (Number(point.width) || 0) / 2;
    const y = Number(point.y) + (Number(point.height) || 0) / 2;
    const dx = x < minX ? minX - x : x > maxX ? x - maxX : 0;
    const dy = y < minY ? minY - y : y > maxY ? y - maxY : 0;
    return Math.hypot(dx, dy);
};

export const assignNearestUniqueLabels = (rects = [], labels = [], maxDistance = 180) => {
    const candidates = [];
    rects.forEach((rect, rectIndex) => {
        labels.forEach((label, labelIndex) => {
            const distance = distanceFromPointToRect(label, rect);
            if (distance <= maxDistance) candidates.push({ rectIndex, labelIndex, distance });
        });
    });
    candidates.sort((first, second) => (
        first.distance - second.distance
        || first.rectIndex - second.rectIndex
        || first.labelIndex - second.labelIndex
    ));

    const usedRects = new Set();
    const usedLabels = new Set();
    return candidates.filter(candidate => {
        if (usedRects.has(candidate.rectIndex) || usedLabels.has(candidate.labelIndex)) return false;
        usedRects.add(candidate.rectIndex);
        usedLabels.add(candidate.labelIndex);
        return true;
    });
};

export const isRepeatedOptionOrFigureLabel = (optionKey, parsedOptions, optionsStarted) => (
    Boolean(optionsStarted) && (
        Object.prototype.hasOwnProperty.call(parsedOptions || {}, optionKey)
        || Object.prototype.hasOwnProperty.call(parsedOptions || {}, 'e')
    )
);

export const restoreTruncatedOptionText = (rebuiltOptions, originalOptions) => {
    const restored = { ...(rebuiltOptions || {}) };

    Object.entries(originalOptions || {}).forEach(([key, originalText]) => {
        const rebuiltText = String(restored[key] || '').trim();
        const fullText = String(originalText || '').trim();
        const removedSuffix = fullText.startsWith(rebuiltText)
            ? fullText.slice(rebuiltText.length).trim()
            : '';

        // 画像領域を除外して選択肢を再構築する際、PDF上で別テキスト要素に
        // 分かれた末尾（例: 「≧」に続く数字）だけが失われることがある。
        // 初回抽出結果が再構築結果の完全な続きになっている場合に限り復元する。
        if (
            rebuiltText
            && fullText.length > rebuiltText.length
            && fullText.startsWith(rebuiltText)
            && !isStandaloneImageLegendText(removedSuffix)
        ) {
            restored[key] = fullText;
        }
    });

    return restored;
};

export const repairLegacySequentialComparisonOptions = (options) => {
    const optionKeys = ['a', 'b', 'c', 'd', 'e'];
    const values = optionKeys.map(key => String(options?.[key] || '').trim());
    const comparisonMark = values[0];

    if (!/^[≧≥≦≤]$/.test(comparisonMark) || !values.every(value => value === comparisonMark)) {
        return options;
    }

    return optionKeys.reduce((repaired, key, index) => ({
        ...repaired,
        [key]: `${comparisonMark}${index + 1}`,
    }), { ...(options || {}) });
};

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
