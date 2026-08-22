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

const GLUED_QUESTION_UNIT_PREFIX = /^(?:mSv|Sv|Gy|mGy|cGy|mm|cm|mL|kg|%|歳|年|か月|ヶ月|月|日|週|時間|min|hr)\b/i;
const PLAIN_NUMBER_QUESTION_DISQUALIFIER = /^(?:[a-eA-Eａ-ｅＡ-Ｅ][\.．\s\)）]|mSv|Sv|Gy|mGy|cGy|mm|cm|mL|kg|%|歳|年|か月|ヶ月|月|日|週|時間|min|hr)\b/i;
const PLAIN_NUMBER_QUESTION_HINT = /(?:次の|以下|最も|正しい|誤って|適切|どれか|選べ|患者|症例|図|画像|所見|疾患|診断|治療|検査|読影|について|に関して|Which|What|Choose|Select|Regarding|About)/i;
const SELECTION_COUNT_LINE_PATTERN = /^[0-9０-９]+\s*つ選べ(?:。)?$/;
const QUESTION_RANGE_HEADER_PATTERN = /^問\s*[0-9０-９]{1,3}\s*[～~〜-]\s*[0-9０-９]{1,3}\s*(?:が|は)/;
const LEADING_COUNTER_CONTINUATION_PATTERN = /^(?:つ(?:選べ)?|本|個|枚|回|例|人|台|枝|歳|年|か月|ヶ月|月|日|週|時間|min|hr)(?:$|\s|の|を|は|で|に)/i;

const normalizeFullWidthDigits = value => String(value || '')
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));

export const parsePdfQuestionStart = (lineText, questionPattern) => {
    const sourceLineText = String(lineText || '');
    const digitNormalizedLineText = normalizeFullWidthDigits(sourceLineText);
    const normalizedLineText = digitNormalizedLineText.replace(/\s+/g, ' ').trim();
    if (!normalizedLineText) return null;

    if (SELECTION_COUNT_LINE_PATTERN.test(normalizedLineText) || QUESTION_RANGE_HEADER_PATTERN.test(normalizedLineText)) {
        return null;
    }

    const standardMatch = digitNormalizedLineText.match(questionPattern);
    if (standardMatch) {
        const qNum = Number.parseInt(standardMatch[1] || standardMatch[2], 10);
        const questionText = sourceLineText.substring(standardMatch[0].length).trim();
        if (!questionText || /^[～~〜-]/.test(questionText)) return null;
        return { qNum, questionText };
    }

    const gluedMatch = digitNormalizedLineText.match(/^\s*(\d{1,3})(?=[A-Za-z(（［【])/);
    if (gluedMatch) {
        const trailingText = sourceLineText.substring(gluedMatch[0].length).trim();
        if (
            GLUED_QUESTION_UNIT_PREFIX.test(trailingText)
            || (!PLAIN_NUMBER_QUESTION_HINT.test(trailingText) && trailingText.length < 12)
        ) return null;
        return { qNum: Number.parseInt(gluedMatch[1], 10), questionText: trailingText };
    }

    const spacedMatch = digitNormalizedLineText.match(/^\s*(\d{1,3})\s+(.+)$/);
    if (spacedMatch) {
        const prefixLength = spacedMatch[0].length - spacedMatch[2].length;
        const trailingText = sourceLineText.substring(prefixLength).trim();
        const hasQuestionHint = PLAIN_NUMBER_QUESTION_HINT.test(trailingText);
        if (
            !trailingText
            || PLAIN_NUMBER_QUESTION_DISQUALIFIER.test(trailingText)
            || SELECTION_COUNT_LINE_PATTERN.test(normalizedLineText)
            || (LEADING_COUNTER_CONTINUATION_PATTERN.test(trailingText) && !hasQuestionHint)
        ) {
            return null;
        }
        if (!hasQuestionHint && trailingText.length < 12) return null;
        return { qNum: Number.parseInt(spacedMatch[1], 10), questionText: trailingText };
    }

    return null;
};

export const shouldUseRadiationLayoutHeuristics = parserName => parserName === 'radiation';

export const groupPdfTextItemsIntoLines = (textItems = []) => {
    if (!Array.isArray(textItems) || textItems.length === 0) return [];

    const heights = textItems
        .map(item => Number(item.height) || 0)
        .filter(height => height > 0)
        .sort((a, b) => a - b);
    const referenceHeight = heights.length > 0
        ? heights[Math.floor(heights.length / 2)]
        : 10;
    const baselineCandidates = textItems.filter(item => {
        const height = Number(item.height) || 0;
        return height > 0 && height >= referenceHeight * 0.7;
    });
    const candidates = baselineCandidates.length > 0 ? baselineCandidates : textItems;
    const baselines = [];

    [...candidates]
        .sort((a, b) => (Number(b.y) || 0) - (Number(a.y) || 0))
        .forEach(item => {
            const itemY = Number(item.y) || 0;
            const closeBaseline = baselines.find(baseline => Math.abs(baseline.y - itemY) < 4);
            if (closeBaseline) {
                closeBaseline.samples.push(itemY);
                closeBaseline.y = closeBaseline.samples.reduce((sum, y) => sum + y, 0) / closeBaseline.samples.length;
            } else {
                baselines.push({ y: itemY, samples: [itemY], items: [] });
            }
        });

    const attachmentThreshold = Math.max(6, referenceHeight * 0.75);
    textItems.forEach(item => {
        const itemY = Number(item.y) || 0;
        let bestLine = null;
        let minimumDifference = Infinity;

        baselines.forEach(line => {
            const difference = Math.abs(line.y - itemY);
            if (difference < minimumDifference) {
                minimumDifference = difference;
                bestLine = line;
            }
        });

        if (bestLine && minimumDifference <= attachmentThreshold) {
            bestLine.items.push(item);
        } else {
            baselines.push({ y: itemY, samples: [itemY], items: [item] });
        }
    });

    return baselines
        .filter(line => line.items.length > 0)
        .sort((a, b) => b.y - a.y)
        .map(line => [...line.items].sort((a, b) => (Number(a.x) || 0) - (Number(b.x) || 0)));
};

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

export const shouldConsumeOptionColumnHeaders = (headers = [], optionsStarted = false) => (
    Array.isArray(headers) && headers.length >= 2 && !optionsStarted
);

export const isLikelyLegendContinuationText = (value, previousValue = '') => {
    const text = String(value || '').trim();
    const previousText = String(previousValue || '').trim();
    if (!text || !previousText) return false;

    return /^(?:\([^()]+\)|（[^（）]+）|\[[^\[\]]+\]|［[^［］]+］)$/.test(text);
};

const hasUnclosedLegendBracket = (value) => {
    const text = String(value || '');
    const pairs = [
        ['(', ')'],
        ['（', '）'],
        ['[', ']'],
        ['［', '］'],
    ];
    return pairs.some(([opening, closing]) => (
        text.split(opening).length - 1 > text.split(closing).length - 1
    ));
};

export const groupNearbyLegendItems = (
    items = [],
    { lineTolerance = 4, minimumSplitGap = 18, gapHeightRatio = 2.2 } = {},
) => {
    const tokens = meaningfulItems(items).map(item => ({
        ...item,
        y: Number(item.y) || 0,
        height: Number(item.height) || 0,
    }));
    const lines = [];

    // 基準行を先に作り、上付き・下付きの小さい文字を後から近接行へ結合する。
    [...tokens].sort((first, second) => (
        second.height - first.height || second.y - first.y || first.x - second.x
    )).forEach(token => {
        const line = lines.find(candidate => (
            Math.abs(candidate.y - token.y) <= lineTolerance
            || candidate.items.some(item => {
                const horizontalGap = getRectGap(
                    Number(item.x) || 0,
                    (Number(item.x) || 0) + (Number(item.width) || 0),
                    Number(token.x) || 0,
                    (Number(token.x) || 0) + (Number(token.width) || 0),
                );
                const itemCenterY = (Number(item.y) || 0) + (Number(item.height) || 0) / 2;
                const tokenCenterY = token.y + token.height / 2;
                const compatibleHeight = Math.max(Number(item.height) || 0, token.height, 1);
                return horizontalGap <= 12 && Math.abs(itemCenterY - tokenCenterY) <= compatibleHeight * 0.8;
            })
        ));
        if (line) {
            line.items.push(token);
            line.y = line.items.reduce((sum, item) => sum + item.y, 0) / line.items.length;
        } else {
            lines.push({ y: token.y, items: [token] });
        }
    });

    return lines.flatMap(line => {
        const sorted = [...line.items].sort((first, second) => first.x - second.x);
        const groups = [];
        sorted.forEach(token => {
            const group = groups[groups.length - 1];
            if (!group) {
                groups.push([token]);
                return;
            }
            const previous = group[group.length - 1];
            const gap = token.x - (previous.x + previous.width);
            const height = Math.max(token.height, previous.height, 1);
            const splitThreshold = Math.max(minimumSplitGap, height * gapHeightRatio);
            const groupText = group.map(item => item.text).join('');
            const keepsParentheticalContinuation = hasUnclosedLegendBracket(groupText)
                && gap <= Math.max(64, height * 6);
            if (gap > splitThreshold && !keepsParentheticalContinuation) {
                groups.push([token]);
            } else {
                group.push(token);
            }
        });

        return groups.map(group => {
            const minX = Math.min(...group.map(item => item.x));
            const maxX = Math.max(...group.map(item => item.x + item.width));
            const minY = Math.min(...group.map(item => item.y));
            const maxY = Math.max(...group.map(item => item.y + item.height));
            return {
                items: group,
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                text: group.map(item => item.text).join('').trim(),
            };
        });
    });
};

export const hasSingleNearbyLegendGroup = (items = []) => (
    groupNearbyLegendItems(items).length === 1
);

export const hasNearbyOptionPrefix = (item, allItems = [], maxGap = 24) => {
    if (!item) return false;
    const optionPattern = /^[a-eA-Eａ-ｅＡ-Ｅ][.．\s)）]?$/;
    return allItems.some(other => {
        const gap = (Number(item.x) || 0) - ((Number(other.x) || 0) + (Number(other.width) || 0));
        return Math.abs((Number(other.y) || 0) - (Number(item.y) || 0)) <= 3
            && gap >= 0
            && gap <= maxGap
            && optionPattern.test(String(other.text || '').trim());
    });
};

export const spreadPositionedLegendLabels = (labels = [], minimumSeparation = 0.12) => {
    const result = labels.map(label => ({ ...label }));
    const positions = new Map();
    result.forEach((label, index) => {
        const position = String(label.position || 'bottom');
        if (!positions.has(position)) positions.set(position, []);
        positions.get(position).push({ label, index, offset: Math.max(0, Math.min(1, Number(label.offset) || 0)) });
    });

    positions.forEach(entries => {
        entries.sort((first, second) => first.offset - second.offset || first.index - second.index);
        let cluster = [];
        const flushCluster = () => {
            if (cluster.length <= 1) {
                cluster = [];
                return;
            }
            const center = cluster.reduce((sum, entry) => sum + entry.offset, 0) / cluster.length;
            const firstOffset = Math.max(0.05, Math.min(
                0.95 - minimumSeparation * (cluster.length - 1),
                center - minimumSeparation * (cluster.length - 1) / 2,
            ));
            cluster.forEach((entry, index) => {
                result[entry.index].offset = firstOffset + minimumSeparation * index;
            });
            cluster = [];
        };

        entries.forEach(entry => {
            const previous = cluster[cluster.length - 1];
            if (previous && entry.offset - previous.offset >= minimumSeparation) flushCluster();
            cluster.push(entry);
        });
        flushCluster();
    });

    return result;
};

const getLineGeometry = (items = []) => {
    const tokens = meaningfulItems(items);
    if (tokens.length === 0) return null;
    const pageNum = tokens.find(token => Number.isFinite(token.pageNum))?.pageNum ?? null;
    const y = tokens.reduce((sum, token) => sum + (Number(token.y) || 0), 0) / tokens.length;
    const minX = Math.min(...tokens.map(token => token.x));
    const optionPrefixIndex = tokens.findIndex(token => /^[a-eａ-ｅ][.．)）]?$/i.test(token.text));
    const contentTokens = optionPrefixIndex >= 0 ? tokens.slice(optionPrefixIndex + 1) : tokens;
    const contentMinX = contentTokens.length > 0 ? Math.min(...contentTokens.map(token => token.x)) : minX;
    const maxHeight = Math.max(...tokens.map(token => Number(token.height) || 0), 0);
    return { pageNum, y, minX, contentMinX, maxHeight };
};

export const isLikelyOptionContinuationLine = (previousLine, candidateLine) => {
    const previous = getLineGeometry(previousLine);
    const candidate = getLineGeometry(candidateLine);
    if (!previous || !candidate) return true;
    if (previous.pageNum !== null && candidate.pageNum !== null && previous.pageNum !== candidate.pageNum) return false;

    const verticalGap = previous.y - candidate.y;
    const maxLineGap = Math.max(26, previous.maxHeight * 2.4, candidate.maxHeight * 2.4);
    if (verticalGap < -4 || verticalGap > maxLineGap) return false;

    const alignmentTolerance = Math.max(28, previous.maxHeight * 2.6, candidate.maxHeight * 2.6);
    return Math.abs(candidate.minX - previous.contentMinX) <= alignmentTolerance;
};

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

export const buildSourceGridLayouts = (images = [], { columns = 12, rowTolerance = 20 } = {}) => {
    if (images.length === 0) return [];

    const layouts = new Array(images.length);
    let rowOffset = 0;
    const pageGroups = new Map();
    images.forEach((image, index) => {
        const page = Number(image?.page) || 0;
        if (!pageGroups.has(page)) pageGroups.set(page, []);
        pageGroups.get(page).push({ image, index });
    });

    [...pageGroups.entries()].sort(([firstPage], [secondPage]) => firstPage - secondPage).forEach(([, entries]) => {
        const minX = Math.min(...entries.map(({ image }) => Number(image.x) || 0));
        const maxX = Math.max(...entries.map(({ image }) => (Number(image.x) || 0) + (Number(image.w) || 0)));
        const sourceWidth = Math.max(1, maxX - minX);
        const rows = [];

        // 行の開始位置は上端だけで決める。下端も行判定に使うと、左の縦長画像と
        // 右下画像の下端が揃うレイアウトで、右上・右下が同じ行に潰れてしまう。
        [...entries].sort((first, second) => compareImageReadingOrder(first.image, second.image, rowTolerance)).forEach(entry => {
            const top = getImageVisualTop(entry.image);
            const bottom = getImageVisualBottom(entry.image);
            const row = rows.find(candidate => Math.abs(candidate.top - top) <= rowTolerance);
            if (row) {
                row.entries.push(entry);
                row.top = Math.max(row.top, top);
                row.bottom = Math.min(row.bottom, bottom);
            } else {
                rows.push({ top, bottom, entries: [entry] });
            }
        });

        rows.sort((first, second) => second.top - first.top);
        rows.forEach((row, rowIndex) => {
            row.entries.sort((first, second) => (Number(first.image.x) || 0) - (Number(second.image.x) || 0));
            row.entries.forEach(({ image, index }) => {
                const relativeX = ((Number(image.x) || 0) - minX) / sourceWidth;
                const columnStart = Math.max(1, Math.min(columns, Math.round(relativeX * columns) + 1));
                const relativeEnd = (((Number(image.x) || 0) + (Number(image.w) || 0)) - minX) / sourceWidth;
                const columnEnd = Math.max(columnStart, Math.min(columns, Math.round(relativeEnd * columns)));
                const columnSpan = columnEnd - columnStart + 1;
                const imageBottom = getImageVisualBottom(image);
                const rowSpan = Math.max(1, rows.slice(rowIndex + 1).filter(candidate => (
                    candidate.top > imageBottom + rowTolerance
                )).length + 1);
                layouts[index] = {
                    type: 'source-grid',
                    row: rowOffset + rowIndex + 1,
                    rowSpan,
                    columnStart,
                    columnSpan,
                    columns,
                };
            });
        });
        rowOffset += rows.length;
    });

    return layouts;
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

export const mergeHorizontalImagePairsBySharedLegend = (
    rects = [],
    { textItems = [], rowTolerance = 20, maxGap = 36, legendBand = 60 } = {},
) => {
    if (rects.length < 2) return rects;

    const consumed = new Set();
    const mergedByIndex = new Map();
    const entries = rects.map((rect, index) => ({ rect, index }));

    entries.forEach(({ rect: left, index: leftIndex }) => {
        if (consumed.has(leftIndex) || left.preserveCompositeRow || left.preserveGridCell) return;

        const rightEntry = entries
            .filter(({ rect: candidate, index }) => {
                if (index === leftIndex || consumed.has(index)) return false;
                if (candidate.preserveCompositeRow || candidate.preserveGridCell) return false;
                if (!Number.isFinite(left.matchedQNum) || left.matchedQNum !== candidate.matchedQNum) return false;
                if ((Number(candidate.x) || 0) <= (Number(left.x) || 0)) return false;

                const sameRow = Math.abs(getImageVisualTop(left) - getImageVisualTop(candidate)) <= rowTolerance
                    || Math.abs(getImageVisualBottom(left) - getImageVisualBottom(candidate)) <= rowTolerance;
                const horizontalGap = getRectGap(
                    left.x,
                    left.x + left.w,
                    candidate.x,
                    candidate.x + candidate.w,
                );
                return sameRow && horizontalGap <= maxGap;
            })
            .sort((first, second) => first.rect.x - second.rect.x)[0];

        if (!rightEntry) return;
        const right = rightEntry.rect;
        const union = unionImageRects([left, right]);
        const lowerImageBottom = Math.min(getImageVisualBottom(left), getImageVisualBottom(right));
        const legendItems = textItems.filter(item => {
            const centerX = (Number(item.x) || 0) + (Number(item.width) || 0) / 2;
            const centerY = (Number(item.y) || 0) + (Number(item.height) || 0) / 2;
            return centerX >= union.x
                && centerX <= union.x + union.w
                && centerY < lowerImageBottom + 8
                && centerY >= lowerImageBottom - legendBand;
        });
        const legendGroups = groupNearbyLegendItems(legendItems).filter(group => {
            const text = String(group.text || '').trim();
            return text && text.length <= 50 && !/^[0-9０-９ー―－\-−–—\s]+$/.test(text);
        });
        if (legendGroups.length === 0) return;

        const legendMinX = Math.min(...legendGroups.map(group => group.x));
        const legendMaxX = Math.max(...legendGroups.map(group => group.x + group.width));
        const legendCenterYs = legendGroups.map(group => group.y + group.height / 2);
        const sameLegendLine = Math.max(...legendCenterYs) - Math.min(...legendCenterYs) <= 8;
        const compactSharedLine = legendGroups.length <= 3
            && sameLegendLine
            && legendMaxX - legendMinX <= union.w * 0.42;
        if (legendGroups.length > 1 && !compactSharedLine) return;

        const legendCenterX = (legendMinX + legendMaxX) / 2;
        const unionCenterX = union.x + union.w / 2;
        if (Math.abs(legendCenterX - unionCenterX) > Math.max(24, union.w * 0.18)) return;

        consumed.add(leftIndex);
        consumed.add(rightEntry.index);
        mergedByIndex.set(Math.min(leftIndex, rightEntry.index), {
            ...union,
            preserveCompositeRow: true,
        });
    });

    return rects.flatMap((rect, index) => {
        if (mergedByIndex.has(index)) return [mergedByIndex.get(index)];
        if (consumed.has(index)) return [];
        return [rect];
    });
};

export const mergeVerticallyAdjacentImageRects = (
    rects = [],
    { maxGap = 8, minHorizontalOverlapRatio = 0.85 } = {},
) => {
    if (rects.length <= 1) return rects;

    const shouldMerge = (first, second) => {
        if (first.preserveCompositeRow || second.preserveCompositeRow || first.preserveGridCell || second.preserveGridCell) return false;
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

export const mergeTwoByTwoImageGridRects = (
    rects = [],
    { rowTolerance = 20, columnTolerance = 20, textItems = [] } = {},
) => {
    if (rects.length < 4) return rects;

    const ownerGroups = new Map();
    rects.forEach((rect, index) => {
        const owner = rect.matchedQNum ?? (rects.length === 4 ? '__single-page-grid__' : `__unmatched-${index}`);
        if (!ownerGroups.has(owner)) ownerGroups.set(owner, []);
        ownerGroups.get(owner).push({ rect, index });
    });

    const mergedIndexes = new Set();
    const mergedByFirstIndex = new Map();
    ownerGroups.forEach(entries => {
        if (entries.length !== 4) return;
        const averageHeight = entries.reduce((sum, { rect }) => sum + (Number(rect.h) || 0), 0) / 4;
        const effectiveRowTolerance = Math.max(rowTolerance, averageHeight * 0.12);
        const rows = [];

        [...entries].sort((first, second) => getImageVisualTop(second.rect) - getImageVisualTop(first.rect)).forEach(entry => {
            const top = getImageVisualTop(entry.rect);
            const row = rows.find(candidate => Math.abs(candidate.top - top) <= effectiveRowTolerance);
            if (row) row.entries.push(entry);
            else rows.push({ top, entries: [entry] });
        });
        rows.sort((first, second) => second.top - first.top);
        if (rows.length !== 2 || rows.some(row => row.entries.length !== 2)) return;

        rows.forEach(row => row.entries.sort((first, second) => first.rect.x - second.rect.x));
        const [topLeft, topRight] = rows[0].entries;
        const [bottomLeft, bottomRight] = rows[1].entries;
        const leftAligned = Math.abs(topLeft.rect.x - bottomLeft.rect.x) <= columnTolerance;
        const rightAligned = Math.abs(topRight.rect.x - bottomRight.rect.x) <= columnTolerance;
        const horizontalGap = Math.min(
            getRectGap(topLeft.rect.x, topLeft.rect.x + topLeft.rect.w, topRight.rect.x, topRight.rect.x + topRight.rect.w),
            getRectGap(bottomLeft.rect.x, bottomLeft.rect.x + bottomLeft.rect.w, bottomRight.rect.x, bottomRight.rect.x + bottomRight.rect.w),
        );
        const verticalGap = Math.min(
            getRectGap(topLeft.rect.y, topLeft.rect.y + topLeft.rect.h, bottomLeft.rect.y, bottomLeft.rect.y + bottomLeft.rect.h),
            getRectGap(topRight.rect.y, topRight.rect.y + topRight.rect.h, bottomRight.rect.y, bottomRight.rect.y + bottomRight.rect.h),
        );
        const averageWidth = entries.reduce((sum, { rect }) => sum + (Number(rect.w) || 0), 0) / 4;
        if (
            !leftAligned
            || !rightAligned
            || horizontalGap > Math.max(36, averageWidth * 0.35)
            || verticalGap > Math.max(36, averageHeight * 0.35)
        ) return;

        const gridMinX = Math.min(...entries.map(({ rect }) => rect.x));
        const gridMaxX = Math.max(...entries.map(({ rect }) => rect.x + rect.w));
        const bottomRowTop = Math.max(...rows[1].entries.map(({ rect }) => rect.y + rect.h));
        const topRowBottom = Math.min(...rows[0].entries.map(({ rect }) => rect.y));
        const betweenRowItems = textItems.filter(item => {
            const centerX = (Number(item.x) || 0) + (Number(item.width) || 0) / 2;
            const centerY = (Number(item.y) || 0) + (Number(item.height) || 0) / 2;
            return centerX >= gridMinX
                && centerX <= gridMaxX
                && centerY >= bottomRowTop
                && centerY <= topRowBottom;
        });
        const betweenRowGroups = groupNearbyLegendItems(betweenRowItems);
        const sideMargin = Math.max(60, averageWidth * 0.5);
        const sideRowItems = textItems.filter(item => {
            const centerX = (Number(item.x) || 0) + (Number(item.width) || 0) / 2;
            const centerY = (Number(item.y) || 0) + (Number(item.height) || 0) / 2;
            const gridMinY = Math.min(...entries.map(({ rect }) => rect.y));
            const gridMaxY = Math.max(...entries.map(({ rect }) => rect.y + rect.h));
            return centerX < gridMinX
                && centerX >= gridMinX - sideMargin
                && centerY >= gridMinY
                && centerY <= gridMaxY;
        });
        const sideRowGroups = groupNearbyLegendItems(sideRowItems);
        const hasBetweenRowCaptions = betweenRowGroups.length >= 2;
        const preserveRows = hasBetweenRowCaptions && sideRowGroups.length >= 2;

        const indexes = entries.map(entry => entry.index).sort((first, second) => first - second);
        if (preserveRows) {
            rows.forEach(row => {
                const rowIndexes = row.entries.map(entry => entry.index).sort((first, second) => first - second);
                mergedByFirstIndex.set(rowIndexes[0], {
                    ...unionImageRects(row.entries.map(entry => entry.rect)),
                    preserveCompositeRow: true,
                });
            });
        } else if (!hasBetweenRowCaptions) {
            mergedByFirstIndex.set(indexes[0], unionImageRects(entries.map(entry => entry.rect)));
        } else {
            entries.forEach(entry => {
                mergedByFirstIndex.set(entry.index, { ...entry.rect, preserveGridCell: true });
            });
        }
        indexes.forEach(index => mergedIndexes.add(index));
    });

    return rects.flatMap((rect, index) => {
        if (mergedByFirstIndex.has(index)) return [mergedByFirstIndex.get(index)];
        if (mergedIndexes.has(index)) return [];
        return [rect];
    });
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

export const extractOptionColumnHeading = (items = []) => {
    const tokens = meaningfulItems(items).sort((a, b) => a.x - b.x);
    if (tokens.length < 2) return null;

    const optionColumnHeaders = extractOptionColumnHeaders(tokens);
    if (optionColumnHeaders.length >= 2 && optionColumnHeaders.length <= 3) {
        return {
            headers: optionColumnHeaders.map(header => header.label),
            columns: optionColumnHeaders,
        };
    }
    if (optionColumnHeaders.length > 3) return null;

    // A real option row can have exactly the same multi-column geometry as a
    // semantic heading. Never consume a row beginning with a-e as one.
    if (/^[a-eａ-ｅ][.．)）]?$/.test(tokens[0].text)) return null;

    const gaps = [];
    for (let index = 1; index < tokens.length; index++) {
        const gap = tokens[index].x - (tokens[index - 1].x + tokens[index - 1].width);
        if (gap >= 24) gaps.push({ index, gap });
    }
    const splitIndexes = gaps
        .sort((first, second) => second.gap - first.gap)
        .slice(0, 2)
        .map(entry => entry.index)
        .sort((first, second) => first - second);
    if (splitIndexes.length === 0) return null;

    const groups = [];
    let groupStart = 0;
    [...splitIndexes, tokens.length].forEach(groupEnd => {
        groups.push(tokens.slice(groupStart, groupEnd));
        groupStart = groupEnd;
    });
    if (groups.length < 2 || groups.length > 3 || groups.some(group => group.length === 0)) return null;

    const headers = groups.map(group => group.map(item => item.text).join('').replace(/[\s　]/g, ''));
    if (headers.some(header => !header || header.length > 20)) return null;
    const combined = headers.join('');
    if (/[。！？!?]/.test(combined) || /(?:どれか|選べ|正しい|誤って)/.test(combined)) return null;

    const headingKeyword = /(?:項目|指標|遺伝子|応答|測定器|線種|疾患|腫瘍|原発巣|進展範囲|治療|所見|検査|薬剤|作用|分類|部位|線量|時期|方法|因子|結果|年齢|グレード|方針|病期|リンパ節|レベル|不確定要素|対策|マージン)/;
    const matchingHeaderCount = headers.filter(header => headingKeyword.test(header)).length;
    if (matchingHeaderCount < Math.min(2, headers.length)) return null;

    return {
        headers,
        columns: groups.map((group, index) => ({
            label: headers[index],
            x: (Math.min(...group.map(item => item.x))
                + Math.max(...group.map(item => item.x + item.width))) / 2,
        })),
    };
};

export const extractPairedOptionHeading = (items = []) => {
    const heading = extractOptionColumnHeading(items);
    return heading?.headers?.length === 2 ? { headers: heading.headers } : null;
};

export const isPairedOptionHeadingLine = (items = []) => Boolean(extractPairedOptionHeading(items));

export const splitOptionItemsByColumns = (items, headers) => {
    if (!headers || headers.length < 2) return [];
    const tokens = normalizeOptionRowItems(items)
        .filter(item => !OPTION_COLUMN_LEADER_PATTERN.test(item.text));
    return headers.map((header, index) => {
        const left = index === 0 ? -Infinity : (headers[index - 1].x + header.x) / 2;
        const right = index === headers.length - 1 ? Infinity : (header.x + headers[index + 1].x) / 2;
        return tokens.filter(item => {
            const center = item.x + item.width / 2;
            return center >= left && center < right;
        });
    });
};

const OPTION_COLUMN_LEADER_PATTERN = /^([…⋯・･.．·•\-‐‑‒–—―ー－−_＿])\1{1,}$/;
const OPTION_MARKER_PATTERN = /^[a-eａ-ｅ][.．)）]?$/i;
const EMBEDDED_OPTION_MARKER_PATTERN = /^([a-eａ-ｅ])(?:[.．)）]|[\s\u3000]+)(.*)$/i;
const LEADER_RUN_PATTERN = /([…⋯・･.．·•\-‐‑‒–—―ー－−_＿])\1{1,}/;

const resizeTextItem = (item, text, startRatio, endRatio) => ({
    ...item,
    text,
    x: item.x + item.width * startRatio,
    width: item.width * Math.max(0, endRatio - startRatio),
});

const splitEmbeddedLeader = item => {
    const match = String(item.text || '').match(LEADER_RUN_PATTERN);
    if (!match) return [item];

    const start = match.index || 0;
    const end = start + match[0].length;
    const sourceLength = Math.max(item.text.length, 1);
    const before = item.text.slice(0, start).trimEnd();
    const after = item.text.slice(end).trimStart();
    return [
        before ? resizeTextItem(item, before, 0, start / sourceLength) : null,
        resizeTextItem(item, match[0], start / sourceLength, end / sourceLength),
        after ? resizeTextItem(item, after, end / sourceLength, 1) : null,
    ].filter(Boolean);
};

export const splitOptionItemsByLeaders = (items = []) => {
    const tokens = normalizeOptionRowItems(items);
    const groups = [[]];
    tokens.forEach(token => {
        if (OPTION_COLUMN_LEADER_PATTERN.test(token.text)) {
            if (groups[groups.length - 1].length > 0) groups.push([]);
            return;
        }
        groups[groups.length - 1].push(token);
    });
    return groups.filter(group => group.length > 0);
};

export const extractOptionKeyFromItems = (items = []) => {
    const first = meaningfulItems(items).sort((a, b) => a.x - b.x)[0];
    if (!first) return '';
    const exactMatch = first.text.match(/^([a-eａ-ｅ])[.．)）]?$/i);
    if (exactMatch) return exactMatch[1];
    return first.text.match(EMBEDDED_OPTION_MARKER_PATTERN)?.[1] || '';
};

export const normalizeOptionRowItems = (items = []) => {
    const tokens = meaningfulItems(items).sort((first, second) => first.x - second.x);
    if (tokens.length === 0) return [];

    const normalized = [...tokens];
    if (OPTION_MARKER_PATTERN.test(normalized[0].text)) {
        normalized.shift();
    } else {
        const embeddedMarker = normalized[0].text.match(EMBEDDED_OPTION_MARKER_PATTERN);
        if (embeddedMarker) {
            const markerLength = normalized[0].text.length - embeddedMarker[2].length;
            if (embeddedMarker[2].trim()) {
                normalized[0] = resizeTextItem(
                    normalized[0],
                    embeddedMarker[2].trimStart(),
                    markerLength / Math.max(normalized[0].text.length, 1),
                    1,
                );
            } else {
                normalized.shift();
            }
        }
    }

    // 核医学PDFでは選択肢記号と全角ピリオドが別々の項目になる。
    // 記号だけでなく「．本文」の形も、本文の位置を保ったまま除去する。
    if (normalized.length > 0) {
        const punctuationMatch = normalized[0].text.match(/^[.．)）]+\s*(.*)$/);
        if (punctuationMatch) {
            const prefixLength = normalized[0].text.length - punctuationMatch[1].length;
            if (punctuationMatch[1]) {
                normalized[0] = resizeTextItem(
                    normalized[0],
                    punctuationMatch[1],
                    prefixLength / Math.max(normalized[0].text.length, 1),
                    1,
                );
            } else {
                normalized.shift();
            }
        }
    }

    return normalized.flatMap(splitEmbeddedLeader);
};

const withoutOptionMarkerAndLeaders = (items = []) => normalizeOptionRowItems(items)
    .filter(item => !OPTION_COLUMN_LEADER_PATTERN.test(item.text));

export const splitOptionItemsByStarts = (items, starts = [], alignmentTolerance = 8) => {
    const normalizedStarts = [...starts]
        .map(Number)
        .filter(Number.isFinite)
        .sort((first, second) => first - second);
    if (normalizedStarts.length === 0) return [];

    const columns = Array.from({ length: normalizedStarts.length + 1 }, () => []);
    withoutOptionMarkerAndLeaders(items).forEach(item => {
        const columnIndex = normalizedStarts.reduce((index, start) => (
            item.x >= start - alignmentTolerance ? index + 1 : index
        ), 0);
        columns[Math.min(columnIndex, columns.length - 1)].push(item);
    });
    return columns;
};

export const buildPositionedInlineHtml = (items = []) => {
    const tokens = meaningfulItems(items).sort((first, second) => first.x - second.x);
    if (tokens.length === 0) return '';

    const normalHeight = Math.max(...tokens.map(item => Number(item.height) || 0), 0);
    const baselineTokens = normalHeight > 0
        ? tokens.filter(item => (Number(item.height) || 0) >= normalHeight * 0.85)
        : tokens;
    const normalY = baselineTokens.length > 0
        ? baselineTokens.reduce((sum, item) => sum + (Number(item.y) || 0), 0) / baselineTokens.length
        : Number(tokens[0].y) || 0;

    const isScriptToken = item => {
        const itemHeight = Number(item?.height) || 0;
        const yDifference = (Number(item?.y) || 0) - normalY;
        return normalHeight > 4
            && itemHeight > 0
            && itemHeight < normalHeight * 0.85
            && Math.abs(yDifference) > 1;
    };

    return tokens.map((item, index) => {
        const previous = tokens[index - 1];
        const next = tokens[index + 1];
        const gap = previous
            ? item.x - (previous.x + previous.width)
            : 0;
        const previousText = String(previous?.text || '');
        const currentText = String(item.text || '');
        // PDF.js は英文の語間空白を独立した極小テキスト項目として返す。
        // 空白項目を除いた後も、英数字同士の座標差から語間を復元する。
        const needsLatinWordSpace = previous
            && gap >= Math.max(1.5, normalHeight * 0.15)
            && /[A-Za-z0-9]$/.test(previousText)
            && /^[A-Za-z0-9]/.test(currentText);

        const yDifference = (Number(item.y) || 0) - normalY;
        const isScript = isScriptToken(item);
        // 上付き・下付き要素の直後はブラウザの改行候補になり得る。
        // 核種の質量数や化学式を途中で分断しないよう word joiner で結合する。
        const keepsPreviousScriptWithBase = previous
            && isScriptToken(previous)
            && gap <= Math.max(1.5, normalHeight * 0.15);
        const nextGap = next
            ? next.x - (item.x + item.width)
            : Infinity;
        const startsScriptGroup = isScript
            && next
            && !isScriptToken(next)
            && nextGap <= Math.max(1.5, normalHeight * 0.15);
        const escapedText = escapeHtml(currentText);
        let richText = isScript
            ? yDifference > 0
                ? `<sup>${escapedText}</sup>`
                : `<sub>${escapedText}</sub>`
            : escapedText;
        if (startsScriptGroup) richText = `<span class="pdf-script-group">${richText}`;
        if (keepsPreviousScriptWithBase) richText = `${richText}</span>`;
        const prefix = needsLatinWordSpace ? ' ' : keepsPreviousScriptWithBase ? '\u2060' : '';
        return `${prefix}${richText}`;
    }).join('');
};

export const buildOptionContentText = (
    items,
    { positionedRichText = false } = {},
) => {
    const tokens = withoutOptionMarkerAndLeaders(items);
    return positionedRichText
        ? buildPositionedInlineHtml(tokens)
        : tokens.map(item => item.text).join('');
};

export const buildPairedOptionText = (
    items,
    { italicizeLeft = false, minimumGap = 16, positionedRichText = false } = {},
) => {
    const tokens = normalizeOptionRowItems(items)
        .filter(item => !OPTION_COLUMN_LEADER_PATTERN.test(item.text));
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

    if (splitIndex < 1 || largestGap < minimumGap) return '';
    const rawLeft = positionedRichText
        ? buildPositionedInlineHtml(tokens.slice(0, splitIndex))
        : tokens.slice(0, splitIndex).map(item => item.text).join('');
    const right = positionedRichText
        ? buildPositionedInlineHtml(tokens.slice(splitIndex))
        : tokens.slice(splitIndex).map(item => item.text).join('');
    if (!rawLeft || !right) return '';
    const left = italicizeLeft
        ? `<em>${positionedRichText ? rawLeft : escapeHtml(rawLeft)}</em>`
        : rawLeft;
    return `${left} ― ${right}`;
};

export const buildColumnOptionText = (
    items,
    {
        headers = [],
        starts = [],
        splitOnLeaders = false,
        italicizeFirst = false,
        positionedRichText = false,
    } = {},
) => {
    const groups = headers.length >= 2
        ? splitOptionItemsByColumns(
            normalizeOptionRowItems(items).filter(item => !OPTION_COLUMN_LEADER_PATTERN.test(item.text)),
            headers,
        )
        : splitOnLeaders
            ? splitOptionItemsByLeaders(items)
        : splitOptionItemsByStarts(items, starts);
    if (groups.length < 2 || groups.some(group => group.length === 0)) return '';

    return groups.map((group, index) => {
        const text = positionedRichText
            ? buildPositionedInlineHtml(group)
            : group.map(item => item.text).join('');
        if (!text) return '';
        return index === 0 && italicizeFirst
            ? `<em>${positionedRichText ? text : escapeHtml(text)}</em>`
            : text;
    }).filter(Boolean).join(' ― ');
};

export const inferOptionColumnLayout = (
    lines = [],
    {
        minimumGap = 24,
        alignmentTolerance = 8,
        minimumRows = 3,
        maximumColumns = 3,
        requireLeader = false,
    } = {},
) => {
    const optionRows = (lines || []).map(items => {
        if (!extractOptionKeyFromItems(items)) return null;
        const contentTokens = normalizeOptionRowItems(items);
        if (contentTokens.length < 2) return { candidates: [] };

        const candidates = [];
        let leaderCount = 0;
        contentTokens.forEach((token, index) => {
            if (!OPTION_COLUMN_LEADER_PATTERN.test(token.text)) return;
            leaderCount += 1;
            const next = contentTokens.slice(index + 1)
                .find(candidate => !OPTION_COLUMN_LEADER_PATTERN.test(candidate.text));
            if (next) candidates.push(next.x);
        });

        for (let index = 1; index < contentTokens.length; index++) {
            const previous = contentTokens[index - 1];
            const current = contentTokens[index];
            if (OPTION_COLUMN_LEADER_PATTERN.test(previous.text) || OPTION_COLUMN_LEADER_PATTERN.test(current.text)) {
                continue;
            }
            const gap = current.x - (previous.x + previous.width);
            if (gap >= minimumGap) candidates.push(current.x);
        }
        return requireLeader && leaderCount === 0
            ? null
            : { candidates: [...new Set(candidates)], leaderCount };
    }).filter(Boolean);

    if (optionRows.length < minimumRows) return null;
    if (requireLeader) {
        const leaderCounts = new Map();
        optionRows.forEach(row => {
            if (row.leaderCount > 0 && row.leaderCount < maximumColumns) {
                leaderCounts.set(row.leaderCount, (leaderCounts.get(row.leaderCount) || 0) + 1);
            }
        });
        const repeatedLeaderLayout = [...leaderCounts.entries()]
            .filter(([, count]) => count >= minimumRows && count / optionRows.length >= 0.6)
            .sort((first, second) => second[1] - first[1] || first[0] - second[0])[0];
        if (repeatedLeaderLayout) {
            return {
                columnCount: repeatedLeaderLayout[0] + 1,
                starts: [],
                leaderSeparated: true,
            };
        }
    }
    const observations = optionRows.flatMap((row, rowIndex) => (
        row.candidates.map(position => ({ position, rowIndex }))
    ));
    const clusters = [];
    [...observations].sort((first, second) => first.position - second.position).forEach(observation => {
        const cluster = clusters.find(candidate => (
            Math.abs(candidate.center - observation.position) <= alignmentTolerance
        ));
        if (cluster) {
            cluster.observations.push(observation);
            cluster.center = cluster.observations.reduce((sum, item) => sum + item.position, 0)
                / cluster.observations.length;
        } else {
            clusters.push({ center: observation.position, observations: [observation] });
        }
    });

    const starts = clusters
        .filter(cluster => {
            const matchingRows = new Set(cluster.observations.map(item => item.rowIndex)).size;
            return matchingRows >= minimumRows && matchingRows / optionRows.length >= 0.6;
        })
        .sort((first, second) => first.center - second.center)
        .slice(0, Math.max(1, maximumColumns - 1))
        .map(cluster => cluster.center);

    return starts.length > 0
        ? { columnCount: starts.length + 1, starts }
        : null;
};

export const inferPairedOptionLayout = (
    lines = [],
    { minimumGap = 24, alignmentTolerance = 8, minimumRows = 3 } = {},
) => {
    return inferOptionColumnLayout(lines, {
        minimumGap,
        alignmentTolerance,
        minimumRows,
        maximumColumns: 2,
    }) !== null;
};

const selectQuestionFigureSupportingText = ({
    imageRects = [],
    textItems = [],
    sectionTopY = Infinity,
    sectionBottomY = -Infinity,
} = {}) => {
    const validImages = imageRects.filter(rect => (
        Number.isFinite(rect?.x)
        && Number.isFinite(rect?.y)
        && Number(rect?.w) > 0
        && Number(rect?.h) > 0
    ));
    if (validImages.length === 0) return { validImages, supportingText: [] };

    const imageMinX = Math.min(...validImages.map(rect => rect.x));
    const imageMinY = Math.min(...validImages.map(rect => rect.y));
    const imageMaxX = Math.max(...validImages.map(rect => rect.x + rect.w));
    const imageMaxY = Math.max(...validImages.map(rect => rect.y + rect.h));
    const imageWidth = imageMaxX - imageMinX;
    const imageHeight = imageMaxY - imageMinY;
    const marginX = Math.max(36, Math.min(120, imageWidth * 0.25));
    const marginY = Math.max(30, Math.min(100, imageHeight * 0.35));

    const supportingText = textItems.filter(item => {
        const centerX = Number(item?.x) + (Number(item?.width) || 0) / 2;
        const centerY = Number(item?.y) + (Number(item?.height) || 0) / 2;
        return Number.isFinite(centerX)
            && Number.isFinite(centerY)
            && centerY <= sectionTopY
            && centerY >= sectionBottomY
            && centerX >= imageMinX - marginX
            && centerX <= imageMaxX + marginX
            && centerY >= imageMinY - marginY
            && centerY <= imageMaxY + marginY;
    });

    return { validImages, supportingText };
};

export const hasQuestionFigureSupportingText = (options = {}) => {
    const { validImages, supportingText } = selectQuestionFigureSupportingText(options);
    return supportingText.some(item => {
        const centerX = Number(item.x) + (Number(item.width) || 0) / 2;
        const centerY = Number(item.y) + (Number(item.height) || 0) / 2;
        return !validImages.some(rect => (
            centerX >= rect.x
            && centerX <= rect.x + rect.w
            && centerY >= rect.y
            && centerY <= rect.y + rect.h
        ));
    });
};

export const buildQuestionFigureCompositeBounds = ({
    imageRects = [],
    textItems = [],
    sectionTopY = Infinity,
    sectionBottomY = -Infinity,
    pageWidth = Infinity,
    pageHeight = Infinity,
    padding = 4,
} = {}) => {
    const { validImages, supportingText } = selectQuestionFigureSupportingText({
        imageRects,
        textItems,
        sectionTopY,
        sectionBottomY,
    });
    if (validImages.length === 0) return null;
    const rects = [
        ...validImages,
        ...supportingText.map(item => ({
            x: Number(item.x) || 0,
            y: Number(item.y) || 0,
            w: Math.max(0, Number(item.width) || 0),
            h: Math.max(0, Number(item.height) || 0),
        })),
    ];

    const minX = Math.max(0, Math.min(...rects.map(rect => rect.x)) - padding);
    const minY = Math.max(0, Math.min(...rects.map(rect => rect.y)) - padding);
    const maxX = Math.min(pageWidth, Math.max(...rects.map(rect => rect.x + rect.w)) + padding);
    const maxY = Math.min(pageHeight, Math.max(...rects.map(rect => rect.y + rect.h)) + padding);
    if (maxX <= minX || maxY <= minY) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

export const extractQuestionTable = (lineEntries) => {
    const tableRows = (lineEntries || [])
        .map((entry, index) => {
            const items = meaningfulItems(entry.items);
            const numericItems = items.filter(item => numericCellPattern.test(item.text));
            return { index, items, numericItems };
        })
        .filter(row => (
            row.numericItems.length >= 3
            // 問題文中の年齢・検査値・撮像条件など、数値を複数含む文章を
            // 数値表として誤認しない。実表は見出しを含め各行の主体が数値セルになる。
            && row.numericItems.length >= Math.ceil(row.items.length / 2)
        ));

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
