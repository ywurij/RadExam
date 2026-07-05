const MIN_GROUP_CONFIDENCE = 0.45;
const MAX_TEXT_OBJECTS = 120;
const MAX_OBJECTS = 180;

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

const expandRect = (rect, padding = 8) => ({
    x: rect.x - padding,
    y: rect.y - padding,
    w: rect.w + padding * 2,
    h: rect.h + padding * 2
});

const doRectsOverlap = (first, second) => (
    first.x < second.x + second.w
    && first.x + first.w > second.x
    && first.y < second.y + second.h
    && first.y + first.h > second.y
);

const getAxisGap = (firstMin, firstMax, secondMin, secondMax) => {
    if (firstMax < secondMin) return secondMin - firstMax;
    if (secondMax < firstMin) return firstMin - secondMax;
    return 0;
};

const mergeWideVerticalPdfSlices = (rects, pageWidth) => {
    if (!Number.isFinite(pageWidth) || rects.length <= 1) return rects;

    const minimumSliceWidth = pageWidth * 0.52;
    const pending = [...rects].sort((a, b) => b.y - a.y);
    const merged = [];

    pending.forEach(rect => {
        const matchIndex = merged.findIndex(existing => {
            const verticalGap = getAxisGap(
                existing.y,
                existing.y + existing.h,
                rect.y,
                rect.y + rect.h
            );
            return existing.w >= minimumSliceWidth
                && rect.w >= minimumSliceWidth
                && Math.abs(existing.x - rect.x) <= 3
                && Math.abs(existing.w - rect.w) <= 3
                && verticalGap <= 3;
        });

        if (matchIndex === -1) {
            merged.push({ ...rect });
            return;
        }

        merged[matchIndex] = unionRects([merged[matchIndex], rect]);
    });

    return merged;
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
    overlayCanvas.width = pageCanvas.width;
    overlayCanvas.height = pageCanvas.height;
    const context = overlayCanvas.getContext('2d');
    context.drawImage(pageCanvas, 0, 0);
    context.lineWidth = Math.max(2, Math.round(pageCanvas.width / 600));
    context.font = `bold ${Math.max(14, Math.round(pageCanvas.width / 65))}px sans-serif`;
    context.textBaseline = 'top';

    const colors = {
        question_anchor: '#d000ff',
        image: '#00b8d9',
        text: '#ff8a00'
    };

    objects.forEach(object => {
        const color = colors[object.type];
        const rect = object.viewportRect;
        context.strokeStyle = color;
        context.setLineDash(object.type === 'text' ? [5, 3] : []);
        context.strokeRect(rect.x, rect.y, rect.w, rect.h);

        const labelWidth = context.measureText(object.id).width + 8;
        const labelHeight = Math.max(18, Math.round(pageCanvas.width / 55));
        const labelY = Math.max(0, rect.y - labelHeight);
        context.fillStyle = color;
        context.fillRect(rect.x, labelY, labelWidth, labelHeight);
        context.fillStyle = '#ffffff';
        context.fillText(object.id, rect.x + 4, labelY + 1);
    });
    context.setLineDash([]);

    return overlayCanvas.toDataURL('image/jpeg', 0.9);
};

export const buildNuclearVlmPageRequest = ({
    pageNumber,
    pageCanvas,
    viewport,
    imageRects,
    textLines,
    questionOwners
}) => {
    if (!pageCanvas || imageRects.length === 0 || questionOwners.length === 0) {
        return null;
    }

    const sourceById = new Map();
    const objects = [];
    const anchorItemKeys = new Set();
    const pageWidth = viewport.width / viewport.scale;
    const normalizedImageRects = mergeWideVerticalPdfSlices(imageRects, pageWidth);

    questionOwners.forEach((owner, index) => {
        const ownerRuns = splitItemsIntoSpatialRuns(owner.items || []);
        const anchorRun = ownerRuns.find(run => /(?:No\.?|NO\.?)\s*[0-9０-９]{1,3}/i.test(run.text))
            || buildTextRun(owner.items || []);
        const anchorItems = anchorRun.items || [];
        const rect = getItemsRect(anchorItems);
        if (!rect) return;
        anchorItems.forEach(item => anchorItemKeys.add(getItemKey(item)));
        const id = `A${index + 1}`;
        const viewportRect = pdfRectToViewportRect(rect, viewport);
        const object = {
            id,
            type: 'question_anchor',
            text: anchorRun.text || owner.text || owner.rawText || `No.${owner.questionNumber}`,
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
            const centerY = viewportRect.y + viewportRect.h / 2;
            const precedingAnchors = visualAnchors.filter(anchor => (
                anchor.viewportRect.y + anchor.viewportRect.h / 2 <= centerY
            ));
            const defaultAnchor = precedingAnchors[precedingAnchors.length - 1] || visualAnchors[0];
            const object = {
                id,
                type: 'image',
                defaultQuestionAnchorId: defaultAnchor?.id,
                bbox: normalizeViewportRect(viewportRect, pageCanvas),
                viewportRect
            };
            objects.push(object);
            sourceById.set(id, { ...object, rect });
        });

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

    const publicObjects = objects.map(({ viewportRect: _viewportRect, ...object }) => object);
    return {
        pageNumber,
        imageDataUrl: drawObjectOverlay(pageCanvas, objects),
        objects: publicObjects,
        sourceById
    };
};

export const requestNuclearVlmGrouping = async (pageRequest) => {
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

export const convertNuclearVlmResultToGroups = (pageRequest, payload) => {
    const groups = payload?.result?.groups;
    if (!Array.isArray(groups) || groups.length === 0) return [];

    const expectedImageIds = pageRequest.objects
        .filter(object => object.type === 'image')
        .map(object => object.id);
    const assignedImageIds = groups.flatMap(group => group.imageIds || []);
    if (assignedImageIds.length !== expectedImageIds.length || new Set(assignedImageIds).size !== expectedImageIds.length) {
        return [];
    }
    if (expectedImageIds.some(id => !assignedImageIds.includes(id))) {
        return [];
    }
    if (groups.some(group => !Number.isFinite(group.confidence) || group.confidence < MIN_GROUP_CONFIDENCE)) {
        return [];
    }

    return groups.map(group => {
        const anchorSource = pageRequest.sourceById.get(group.questionAnchorId);
        const imageSources = group.imageIds.map(id => pageRequest.sourceById.get(id));
        const legendSources = group.legendIds.map(id => pageRequest.sourceById.get(id));
        if (!anchorSource?.owner || imageSources.some(source => !source?.rect) || legendSources.some(source => !source?.rect)) {
            return null;
        }

        const imageRects = imageSources.map(source => source.rect);
        const legendRects = legendSources.map(source => source.rect);
        const imageBounds = unionRects(imageRects);
        const allowedLegendRegion = imageBounds ? expandRect(imageBounds, 90) : null;
        if (!allowedLegendRegion || legendRects.some(rect => !doRectsOverlap(allowedLegendRegion, rect))) {
            return null;
        }
        const bounds = unionRects([...imageRects, ...legendRects]);
        if (!bounds) return null;

        const legendRaw = legendSources
            .map(source => source.text)
            .filter(Boolean)
            .join(' ')
            .trim();

        return {
            bounds: expandRect(bounds),
            matchedQNum: anchorSource.owner.questionNumber,
            legend: legendRaw,
            legendRaw,
            figureNumber: null,
            figureLabel: '',
            textItems: legendSources.flatMap(source => source.items || []),
            imageRects,
            anchorItems: anchorSource.items || [],
            vlmConfidence: group.confidence,
            vlmGroupId: group.groupId
        };
    }).filter(Boolean);
};
