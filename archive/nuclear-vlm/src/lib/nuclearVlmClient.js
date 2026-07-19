import {
    assignRectToQuestionAnchor,
    buildNuclearStructuralGroups,
    expandFigureRectWithinOwner,
    getRectDistance,
    getNuclearTextQuestionAnchorId,
    mergeNuclearImageFragments,
    resolveNuclearDisplayLegend
} from '../../../../src/lib/nuclearFigureGeometry.mjs';

const MIN_GROUP_CONFIDENCE = 0.45;
const MAX_TEXT_OBJECTS = 120;
const MAX_OBJECTS = 180;
const MAX_VLM_OVERLAY_EDGE = 1024;

const getItemKey = (item) => [
    Math.round((item.x || 0) * 10),
    Math.round((item.y || 0) * 10),
    String(item.text || '')
].join(':');

const unionRects = (rects) => {
    if (!rects.length) return null;
    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.h));
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const getItemsRect = (items) => unionRects(items.map(item => ({
    x: item.x,
    y: item.y,
    w: Math.max(1, item.width || 0),
    h: Math.max(1, item.height || 12)
})));

const buildTextRun = (items) => ({
    items,
    text: items.map(item => String(item.text || '')).join('').trim()
});

const splitItemsIntoSpatialRuns = (items = []) => {
    const sortedItems = [...items].sort((a, b) => a.x - b.x);
    if (sortedItems.length <= 1) return sortedItems.length ? [buildTextRun(sortedItems)] : [];

    const runs = [];
    let currentRun = [];
    sortedItems.forEach(item => {
        const previous = currentRun[currentRun.length - 1];
        const itemHeight = Math.max(8, item.height || 12);
        const previousRight = previous ? previous.x + Math.max(1, previous.width || 0) : null;
        const horizontalGap = previous ? item.x - previousRight : 0;
        const splitThreshold = Math.max(14, itemHeight * 1.25);

        if (previous && horizontalGap > splitThreshold) {
            runs.push(buildTextRun(currentRun));
            currentRun = [];
        }
        currentRun.push(item);
    });
    if (currentRun.length) runs.push(buildTextRun(currentRun));

    return runs.filter(run => run.text);
};

const extractQuestionAnchorItems = (items = []) => {
    const sortedItems = [...items].sort((first, second) => first.x - second.x);
    const startIndex = sortedItems.findIndex(item => /(?:No\.?|NO\.?)/i.test(String(item.text || '')));
    if (startIndex < 0) return [];

    const anchorItems = [sortedItems[startIndex]];
    if (/[0-9０-９]{1,3}/.test(String(sortedItems[startIndex].text || ''))) {
        return anchorItems;
    }

    for (let index = startIndex + 1; index < sortedItems.length; index++) {
        const item = sortedItems[index];
        const previous = anchorItems[anchorItems.length - 1];
        const gap = item.x - (previous.x + Math.max(1, previous.width || 0));
        if (gap > Math.max(12, item.height || 12)) break;
        anchorItems.push(item);
        if (/[0-9０-９]{1,3}/.test(String(item.text || ''))) break;
    }

    return anchorItems;
};

const pdfRectToViewportRect = (rect, viewport) => {
    const first = viewport.convertToViewportPoint(rect.x, rect.y);
    const second = viewport.convertToViewportPoint(rect.x + rect.w, rect.y + rect.h);
    return {
        x: Math.min(first[0], second[0]),
        y: Math.min(first[1], second[1]),
        w: Math.abs(first[0] - second[0]),
        h: Math.abs(first[1] - second[1])
    };
};

const normalizeViewportRect = (rect, canvas) => ([
    (rect.x / canvas.width) * 1000,
    (rect.y / canvas.height) * 1000,
    ((rect.x + rect.w) / canvas.width) * 1000,
    ((rect.y + rect.h) / canvas.height) * 1000
]);

const drawObjectOverlay = (pageCanvas, objects) => {
    const overlayCanvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_VLM_OVERLAY_EDGE / Math.max(pageCanvas.width, pageCanvas.height));
    overlayCanvas.width = Math.max(1, Math.round(pageCanvas.width * scale));
    overlayCanvas.height = Math.max(1, Math.round(pageCanvas.height * scale));
    const context = overlayCanvas.getContext('2d');
    context.drawImage(pageCanvas, 0, 0, overlayCanvas.width, overlayCanvas.height);
    context.lineWidth = Math.max(2, Math.round(overlayCanvas.width / 600));
    context.font = `bold ${Math.max(14, Math.round(overlayCanvas.width / 65))}px sans-serif`;
    context.textBaseline = 'top';

    const colors = {
        question_anchor: '#d000ff',
        image: '#00b8d9',
        text: '#ff8a00'
    };

    objects.forEach(object => {
        const color = colors[object.type];
        const rect = {
            x: object.viewportRect.x * scale,
            y: object.viewportRect.y * scale,
            w: object.viewportRect.w * scale,
            h: object.viewportRect.h * scale
        };
        context.strokeStyle = color;
        context.setLineDash(object.type === 'text' ? [5, 3] : []);
        context.strokeRect(rect.x, rect.y, rect.w, rect.h);

        const labelWidth = context.measureText(object.id).width + 8;
        const labelHeight = Math.max(18, Math.round(overlayCanvas.width / 55));
        const labelY = Math.max(0, rect.y - labelHeight);
        context.fillStyle = color;
        context.fillRect(rect.x, labelY, labelWidth, labelHeight);
        context.fillStyle = '#ffffff';
        context.fillText(object.id, rect.x + 4, labelY + 1);
    });
    context.setLineDash([]);

    return overlayCanvas.toDataURL('image/jpeg', 0.82);
};

export const buildNuclearVlmPageRequest = ({
    pageNumber,
    pageCanvas,
    viewport,
    imageRects,
    textLines,
    questionOwners,
    forceQuestionComposite = false
}) => {
    if (!pageCanvas || imageRects.length === 0 || questionOwners.length === 0) {
        return null;
    }

    const sourceById = new Map();
    const objects = [];
    const anchorItemKeys = new Set();
    const pageWidth = viewport.width / viewport.scale;
    const normalizedImageRects = mergeNuclearImageFragments(imageRects, pageWidth);

    questionOwners.forEach((owner, index) => {
        const anchorItems = extractQuestionAnchorItems(owner.items || []);
        const rect = getItemsRect(anchorItems);
        if (!rect) return;
        anchorItems.forEach(item => anchorItemKeys.add(getItemKey(item)));
        const id = `A${index + 1}`;
        const viewportRect = pdfRectToViewportRect(rect, viewport);
        const object = {
            id,
            type: 'question_anchor',
            text: buildTextRun(anchorItems).text || `No.${owner.questionNumber}`,
            questionNumber: owner.questionNumber,
            bbox: normalizeViewportRect(viewportRect, pageCanvas),
            viewportRect
        };
        objects.push(object);
        sourceById.set(id, { ...object, owner, rect, items: anchorItems });
    });

    const visualAnchors = objects
        .filter(object => object.type === 'question_anchor')
        .sort((a, b) => a.viewportRect.y - b.viewportRect.y);

    [...normalizedImageRects]
        .sort((a, b) => (Math.abs(b.y - a.y) > 12 ? b.y - a.y : a.x - b.x))
        .forEach((rect, index) => {
            const id = `I${index + 1}`;
            const viewportRect = pdfRectToViewportRect(rect, viewport);
            const { defaultAnchor, candidateAnchorIds } = assignRectToQuestionAnchor(
                viewportRect,
                visualAnchors,
                pageCanvas.height
            );
            const object = {
                id,
                type: 'image',
                defaultQuestionAnchorId: defaultAnchor?.id,
                candidateQuestionAnchorIds: candidateAnchorIds,
                bbox: normalizeViewportRect(viewportRect, pageCanvas),
                viewportRect
            };
            objects.push(object);
            sourceById.set(id, { ...object, rect });
        });

    if (forceQuestionComposite) {
        const structuralGrouping = buildNuclearStructuralGroups(objects, pageCanvas.height, {
            forceQuestionComposite
        });
        if (structuralGrouping.complete) {
            const publicObjects = objects.map(({ viewportRect: _viewportRect, ...object }) => object);
            return {
                pageNumber,
                pageCanvasHeight: pageCanvas.height,
                imageDataUrl: '',
                objects: publicObjects,
                sourceById,
                structuralGroups: structuralGrouping.groups,
                structuralGroupingComplete: true
            };
        }
    }

    if (objects.length > MAX_OBJECTS) {
        return null;
    }

    const availableTextSlots = Math.min(MAX_TEXT_OBJECTS, MAX_OBJECTS - objects.length);

    textLines
        .flatMap(line => splitItemsIntoSpatialRuns(line.items || []))
        .filter(line => {
            const text = String(line.text || '').trim();
            if (!text || /^[-ー―－−–—]?\s*[0-9０-９]+\s*[-ー―－−–—]?$/.test(text)) return false;
            return !(line.items || []).some(item => anchorItemKeys.has(getItemKey(item)));
        })
        .slice(0, availableTextSlots)
        .forEach((line, index) => {
            const rect = getItemsRect(line.items || []);
            if (!rect) return;
            const id = `T${index + 1}`;
            const viewportRect = pdfRectToViewportRect(rect, viewport);
            const object = {
                id,
                type: 'text',
                text: String(line.text || '').trim().slice(0, 120),
                bbox: normalizeViewportRect(viewportRect, pageCanvas),
                viewportRect
            };
            objects.push(object);
            sourceById.set(id, { ...object, rect, items: line.items || [] });
        });

    const structuralGrouping = buildNuclearStructuralGroups(objects, pageCanvas.height, {
        forceQuestionComposite
    });
    const publicObjects = objects.map(({ viewportRect: _viewportRect, ...object }) => object);
    return {
        pageNumber,
        pageCanvasHeight: pageCanvas.height,
        imageDataUrl: structuralGrouping.complete ? '' : drawObjectOverlay(pageCanvas, objects),
        objects: publicObjects,
        sourceById,
        structuralGroups: structuralGrouping.groups,
        structuralGroupingComplete: structuralGrouping.complete
    };
};

export const requestNuclearVlmGrouping = async (pageRequest) => {
    if (pageRequest.structuralGroupingComplete) {
        return {
            model: 'pdf-structural-anchors',
            elapsedMs: 0,
            deterministic: true,
            result: { groups: pageRequest.structuralGroups }
        };
    }

    const response = await fetch('/api/nuclear-vlm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            pageNumber: pageRequest.pageNumber,
            imageDataUrl: pageRequest.imageDataUrl,
            objects: pageRequest.objects
        })
    });
    const payload = await response.json();
    if (!response.ok) {
        throw new Error(payload.error || `VLM grouping failed with HTTP ${response.status}`);
    }
    return payload;
};

const isLikelyLegendText = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed || trimmed.length > 50) return false;
    if (/^(?:No\.?|NO\.?)\s*[0-9０-９]{1,3}(?:\s*[-ー−‐–―]\s*[0-9０-９]+)?$/i.test(trimmed)) return false;
    if (/^[-ー―－−–—]?\s*[0-9０-９]+\s*[-ー―－−–—]?$/.test(trimmed)) return false;
    if (/^(?:別紙|別冊|別図|付図|参考図|設問|試験問題|筆記)$/i.test(trimmed)) return false;
    if (trimmed.length <= 24) return true;

    return /(?:画像|断面|断層|前面|後面|術前|術後|安静|負荷|PET|CT|MRI|SPECT|MIP|FDG|BMIPP|PYP|MIBG|Tl|Tc|I-?123|I-?131)/i.test(trimmed);
};

const getOverlapLength = (firstMin, firstMax, secondMin, secondMax) => (
    Math.max(0, Math.min(firstMax, secondMax) - Math.max(firstMin, secondMin))
);

const getTextAttachmentScore = (textRect, imageRects) => {
    let bestScore = Infinity;

    imageRects.forEach(imageRect => {
        const { horizontalGap, verticalGap, distance } = getRectDistance(textRect, imageRect);
        const xOverlap = getOverlapLength(
            textRect.x,
            textRect.x + textRect.w,
            imageRect.x,
            imageRect.x + imageRect.w
        );
        const yOverlap = getOverlapLength(
            textRect.y,
            textRect.y + textRect.h,
            imageRect.y,
            imageRect.y + imageRect.h
        );
        const topOrBottom = xOverlap >= Math.min(textRect.w * 0.45, imageRect.w * 0.18)
            && verticalGap <= 72;
        const side = yOverlap >= Math.min(textRect.h * 0.45, imageRect.h * 0.12)
            && horizontalGap <= 72;
        const corner = horizontalGap <= 32 && verticalGap <= 32;

        if (topOrBottom || side || corner || distance === 0) {
            const alignmentPenalty = topOrBottom ? horizontalGap : verticalGap;
            bestScore = Math.min(bestScore, distance + alignmentPenalty * 0.25);
        }
    });

    return bestScore;
};

const getCaptionBelowScore = (textRect, imageRects) => {
    let bestScore = Infinity;

    imageRects.forEach(imageRect => {
        const textBottom = textRect.y + textRect.h;
        const verticalGap = imageRect.y - textBottom;
        const xOverlap = getOverlapLength(
            textRect.x,
            textRect.x + textRect.w,
            imageRect.x,
            imageRect.x + imageRect.w
        );
        const minimumOverlap = Math.min(textRect.w * 0.45, imageRect.w * 0.15);
        if (verticalGap < -8 || verticalGap > 90 || xOverlap < minimumOverlap) return;

        const horizontalOffset = Math.abs(
            (textRect.x + textRect.w / 2) - (imageRect.x + imageRect.w / 2)
        );
        bestScore = Math.min(bestScore, Math.abs(verticalGap) * 4 + horizontalOffset * 0.12);
    });

    return bestScore;
};

const attachLegendSources = (groupRecords, pageRequest) => {
    const visualAnchors = pageRequest.objects
        .filter(object => object.type === 'question_anchor')
        .map(object => pageRequest.sourceById.get(object.id))
        .filter(Boolean)
        .sort((first, second) => first.viewportRect.y - second.viewportRect.y);
    const textSources = pageRequest.objects
        .filter(object => object.type === 'text')
        .map(object => pageRequest.sourceById.get(object.id))
        .filter(source => source?.rect && source?.viewportRect && isLikelyLegendText(source.text));
    const assignedTextIds = new Set();
    const preferredRecordByLegendId = new Map();

    groupRecords.forEach(record => {
        record.legendSources = [];
        record.requestedLegendIds.forEach(id => {
            if (!preferredRecordByLegendId.has(id)) {
                preferredRecordByLegendId.set(id, record);
            }
        });
    });

    const figureSources = textSources.filter(source => (
        /^(?:図|画像|Fig\.?)\s*[0-9０-９]+/i.test(String(source.text || '').trim())
    ));
    const recordsWithFigureCaption = new Set();
    figureSources.forEach(source => {
        const textAnchorId = getNuclearTextQuestionAnchorId(
            source,
            visualAnchors,
            pageRequest.pageCanvasHeight
        );
        const candidates = groupRecords
            .filter(record => (
                record.questionAnchorId === textAnchorId
                && !recordsWithFigureCaption.has(record.groupId)
            ))
            .map(record => ({
                record,
                score: getCaptionBelowScore(
                    source.viewportRect,
                    record.imageSources.map(image => image.viewportRect)
                )
            }))
            .filter(candidate => Number.isFinite(candidate.score))
            .sort((first, second) => first.score - second.score);

        if (candidates.length === 0) return;
        const selected = candidates[0].record;
        selected.legendSources.push(source);
        recordsWithFigureCaption.add(selected.groupId);
        assignedTextIds.add(source.id);
    });

    textSources.forEach(source => {
        if (assignedTextIds.has(source.id)) return;
        const textAnchorId = getNuclearTextQuestionAnchorId(
            source,
            visualAnchors,
            pageRequest.pageCanvasHeight
        );
        const candidates = groupRecords
            .filter(record => record.questionAnchorId === textAnchorId)
            .map(record => ({
                record,
                score: getTextAttachmentScore(
                    source.viewportRect,
                    record.imageSources.map(image => image.viewportRect)
                )
            }))
            .filter(candidate => Number.isFinite(candidate.score))
            .sort((first, second) => first.score - second.score);

        if (candidates.length === 0) return;
        const preferredRecord = preferredRecordByLegendId.get(source.id);
        const preferredCandidate = candidates.find(candidate => candidate.record === preferredRecord);
        const selectedCandidate = preferredCandidate && preferredCandidate.score <= candidates[0].score + 12
            ? preferredCandidate
            : candidates[0];
        assignedTextIds.add(source.id);
        selectedCandidate.record.legendSources.push(source);
    });
};

const applyStructuralGrouping = (groupRecords, pageRequest) => {
    const structuralGroups = Array.isArray(pageRequest.structuralGroups)
        ? pageRequest.structuralGroups
        : [];
    if (structuralGroups.length === 0) return groupRecords;

    const structurallyAssignedIds = new Set(structuralGroups.flatMap(group => group.imageIds || []));
    const remainingRecords = groupRecords
        .map(record => ({
            ...record,
            imageSources: record.imageSources.filter(source => !structurallyAssignedIds.has(source.id))
        }))
        .filter(record => record.imageSources.length > 0);
    const structuralRecords = structuralGroups.map(group => ({
        groupId: group.groupId,
        questionAnchorId: group.questionAnchorId,
        imageSources: (group.imageIds || [])
            .map(id => pageRequest.sourceById.get(id))
            .filter(Boolean),
        requestedLegendIds: Array.isArray(group.legendIds) ? group.legendIds : [],
        confidence: 1,
        usedVlm: false,
        isStructural: true
    })).filter(record => record.imageSources.length > 0);

    return [...remainingRecords, ...structuralRecords];
};

export const convertNuclearVlmResultToGroups = (pageRequest, payload) => {
    const expectedImageIds = pageRequest.objects
        .filter(object => object.type === 'image')
        .map(object => object.id);
    const expectedImageIdSet = new Set(expectedImageIds);
    const rawGroups = Array.isArray(payload?.result?.groups) ? payload.result.groups : [];
    const assignedImageIds = new Set();
    const groupRecords = [];

    rawGroups.forEach(group => {
        const imageIds = (group?.imageIds || []).filter(id => (
            expectedImageIdSet.has(id) && !assignedImageIds.has(id)
        ));
        if (imageIds.length === 0) return;

        const accepted = Number.isFinite(group.confidence) && group.confidence >= MIN_GROUP_CONFIDENCE;
        if (!accepted) {
            imageIds.forEach(imageId => {
                const imageSource = pageRequest.sourceById.get(imageId);
                if (!imageSource) return;
                assignedImageIds.add(imageId);
                groupRecords.push({
                    groupId: `fallback-${imageId}`,
                    questionAnchorId: imageSource.defaultQuestionAnchorId,
                    imageSources: [imageSource],
                    requestedLegendIds: [],
                    confidence: group.confidence || 0,
                    usedVlm: false
                });
            });
            return;
        }

        const imageSources = imageIds.map(id => pageRequest.sourceById.get(id)).filter(Boolean);
        const anchorSource = pageRequest.sourceById.get(group.questionAnchorId);
        if (!anchorSource?.owner || imageSources.length !== imageIds.length) return;
        imageIds.forEach(id => assignedImageIds.add(id));
        groupRecords.push({
            groupId: group.groupId,
            questionAnchorId: group.questionAnchorId,
            imageSources,
            requestedLegendIds: Array.isArray(group.legendIds) ? group.legendIds : [],
            confidence: group.confidence,
            usedVlm: !payload?.deterministic,
            isStructural: Boolean(payload?.deterministic)
        });
    });

    expectedImageIds.forEach(imageId => {
        if (assignedImageIds.has(imageId)) return;
        const imageSource = pageRequest.sourceById.get(imageId);
        if (!imageSource) return;
        groupRecords.push({
            groupId: `fallback-${imageId}`,
            questionAnchorId: imageSource.defaultQuestionAnchorId,
            imageSources: [imageSource],
            requestedLegendIds: [],
            confidence: 0,
            usedVlm: false
        });
    });

    const finalGroupRecords = applyStructuralGrouping(groupRecords, pageRequest);
    attachLegendSources(finalGroupRecords, pageRequest);

    const groups = finalGroupRecords.map(record => {
        const anchorSource = pageRequest.sourceById.get(record.questionAnchorId);
        if (!anchorSource?.owner) return null;
        const imageRects = record.imageSources.map(source => source.rect);
        const legendSources = [...record.legendSources].sort((first, second) => {
            if (Math.abs(first.viewportRect.y - second.viewportRect.y) > 8) {
                return first.viewportRect.y - second.viewportRect.y;
            }
            return first.viewportRect.x - second.viewportRect.x;
        });
        const legendRaw = legendSources.map(source => source.text).filter(Boolean).join(' ').trim();
        const displayLegendResolution = resolveNuclearDisplayLegend(legendSources);
        const displayLegend = displayLegendResolution.legend;
        const displayLegendSourceIds = new Set(displayLegendResolution.sources.map(source => source.id));
        const contextualLegendSources = legendSources.filter(source => !displayLegendSourceIds.has(source.id));
        const keepContextInFigure = contextualLegendSources.length > 0;
        const bounds = unionRects([
            ...imageRects,
            ...contextualLegendSources.map(source => source.rect)
        ]);
        if (!bounds) return null;

        return {
            bounds: expandFigureRectWithinOwner(bounds, imageRects, anchorSource.owner),
            matchedQNum: anchorSource.owner.questionNumber,
            legend: displayLegend,
            legendRaw,
            displayLegend,
            displayLegendTextItems: displayLegendResolution.sources.flatMap(source => source.items || []),
            keepContextInFigure,
            figureNumber: null,
            figureLabel: '',
            textItems: legendSources.flatMap(source => source.items || []),
            imageRects,
            anchorItems: anchorSource.items || [],
            vlmConfidence: record.confidence,
            vlmGroupId: record.groupId,
            usedVlm: record.usedVlm
        };
    }).filter(Boolean);

    return {
        groups,
        vlmGroupCount: finalGroupRecords.filter(record => record.usedVlm).length,
        fallbackGroupCount: finalGroupRecords.filter(record => !record.usedVlm && !record.isStructural).length,
        structuralGroupCount: finalGroupRecords.filter(record => record.isStructural).length,
        structuralGroupingComplete: Boolean(pageRequest.structuralGroupingComplete)
    };
};
