const axisGap = (firstMin, firstMax, secondMin, secondMax) => {
    if (firstMax < secondMin) return secondMin - firstMax;
    if (secondMax < firstMin) return firstMin - secondMax;
    return 0;
};

export const extractPdfImageRectFromTransform = (transform = []) => {
    const [
        a = 0,
        b = 0,
        c = 0,
        d = 0,
        e = 0,
        f = 0
    ] = transform;
    const corners = [
        [e, f],
        [a + e, b + f],
        [c + e, d + f],
        [a + c + e, b + d + f]
    ];
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([_x, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY
    };
};

export const detectNuclearContentRotation = (items = []) => {
    const anchorItems = items.filter(item => /(?:No\.?|NO\.?)/i.test(String(item.str || '')));
    const isClockwiseVertical = item => {
        const transform = item.transform || [];
        return Math.abs(transform[1] || 0) > Math.abs(transform[0] || 0)
            && (transform[1] || 0) < 0;
    };
    const isCounterClockwiseVertical = item => {
        const transform = item.transform || [];
        return Math.abs(transform[1] || 0) > Math.abs(transform[0] || 0)
            && (transform[1] || 0) > 0;
    };

    if (anchorItems.length > 0) {
        const verticalClockwiseCount = anchorItems.filter(isClockwiseVertical).length;
        if (verticalClockwiseCount > anchorItems.length / 2) return 270;
    }

    const significantItems = items.filter(item => String(item.str || '').trim().length > 0);
    if (significantItems.length < 3) return 0;

    const clockwiseCount = significantItems.filter(isClockwiseVertical).length;
    const counterClockwiseCount = significantItems.filter(isCounterClockwiseVertical).length;
    const verticalCount = clockwiseCount + counterClockwiseCount;
    return (
        clockwiseCount > counterClockwiseCount
        && verticalCount >= Math.max(3, significantItems.length * 0.6)
    ) ? 270 : 0;
};

export const normalizeNuclearTextItemGeometry = (item, pageHeight, rotation, pageNum) => {
    const base = {
        text: item.str,
        width: item.width || (item.str.length * (item.height || item.transform[3] || 10) * 0.8),
        height: item.height || Math.abs(item.transform[3]) || Math.abs(item.transform[0]) || 0,
        pageNum
    };

    if (rotation === 270) {
        return {
            ...base,
            x: pageHeight - item.transform[5],
            y: item.transform[4]
        };
    }
    return {
        ...base,
        x: item.transform[4],
        y: item.transform[5]
    };
};

export const normalizeNuclearPdfRect = (rect, pageHeight, rotation) => {
    if (rotation !== 270) return { ...rect };
    return {
        x: pageHeight - rect.y - rect.h,
        y: rect.x,
        w: rect.h,
        h: rect.w
    };
};

export const buildNuclearCanvasRotationPlan = (width, height, rotation) => {
    if (rotation !== 270) {
        return {
            width,
            height,
            translateX: 0,
            translateY: 0,
            radians: 0
        };
    }

    const sourceWidth = Math.ceil(width);
    const sourceHeight = Math.ceil(height);
    return {
        width: sourceHeight,
        height: sourceWidth,
        translateX: 0,
        translateY: sourceWidth,
        radians: -Math.PI / 2
    };
};

export const unionFigureRects = (rects) => {
    if (!Array.isArray(rects) || rects.length === 0) return null;

    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.h));

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

export const expandFigureRectWithinOwner = (rect, imageRects, owner, padding = 8) => {
    const expanded = {
        x: rect.x - padding,
        y: rect.y - padding,
        w: rect.w + padding * 2,
        h: rect.h + padding * 2
    };
    const imageBounds = unionFigureRects(imageRects);
    if (!imageBounds || !owner) return expanded;

    const imageMaxX = imageBounds.x + imageBounds.w;
    const imageMaxY = imageBounds.y + imageBounds.h;
    const expandedMaxX = expanded.x + expanded.w;
    const expandedMaxY = expanded.y + expanded.h;
    const minX = Number.isFinite(owner.ownerLeftX)
        ? Math.min(imageBounds.x, Math.max(expanded.x, owner.ownerLeftX))
        : expanded.x;
    const maxX = Number.isFinite(owner.ownerRightX)
        ? Math.max(imageMaxX, Math.min(expandedMaxX, owner.ownerRightX))
        : expandedMaxX;
    const minY = Number.isFinite(owner.ownerBottomY)
        ? Math.min(imageBounds.y, Math.max(expanded.y, owner.ownerBottomY))
        : expanded.y;
    const maxY = Number.isFinite(owner.ownerTopY)
        ? Math.max(imageMaxY, Math.min(expandedMaxY, owner.ownerTopY))
        : expandedMaxY;

    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

const shouldMergeVerticalFragments = (first, second, pageWidth) => {
    const minimumWidth = pageWidth * 0.45;
    if (first.w < minimumWidth || second.w < minimumWidth) return false;

    const widthTolerance = Math.max(4, Math.min(first.w, second.w) * 0.03);
    const xTolerance = Math.max(4, Math.min(first.w, second.w) * 0.02);
    if (Math.abs(first.x - second.x) > xTolerance || Math.abs(first.w - second.w) > widthTolerance) {
        return false;
    }

    const firstAspect = first.w / Math.max(1, first.h);
    const secondAspect = second.w / Math.max(1, second.h);
    if (Math.max(firstAspect, secondAspect) < 2.2) return false;

    const verticalGap = axisGap(first.y, first.y + first.h, second.y, second.y + second.h);
    const horizontalOverlap = Math.min(first.x + first.w, second.x + second.w) - Math.max(first.x, second.x);
    const minimumOverlap = Math.min(first.w, second.w) * 0.94;
    const maximumGap = Math.max(18, pageWidth * 0.04);

    return horizontalOverlap >= minimumOverlap && verticalGap <= maximumGap;
};

// Some publishing tools store a visually continuous wide figure as stacked image strips.
// Merge only that structural pattern; adjacent complete panels remain independent figures.
export const mergeNuclearImageFragments = (rects, pageWidth) => {
    if (!Array.isArray(rects) || rects.length <= 1 || !Number.isFinite(pageWidth)) {
        return Array.isArray(rects) ? rects.map(rect => ({ ...rect })) : [];
    }

    const visited = new Set();
    const merged = [];

    rects.forEach((_rect, index) => {
        if (visited.has(index)) return;

        const stack = [index];
        const fragmentGroup = [];
        visited.add(index);

        while (stack.length > 0) {
            const currentIndex = stack.pop();
            const current = rects[currentIndex];
            fragmentGroup.push(current);

            rects.forEach((candidate, candidateIndex) => {
                if (visited.has(candidateIndex)) return;
                if (!shouldMergeVerticalFragments(current, candidate, pageWidth)) return;
                visited.add(candidateIndex);
                stack.push(candidateIndex);
            });
        }

        merged.push(unionFigureRects(fragmentGroup));
    });

    return merged.sort((first, second) => {
        const firstTop = first.y + first.h;
        const secondTop = second.y + second.h;
        if (Math.abs(secondTop - firstTop) > 12) return secondTop - firstTop;
        return first.x - second.x;
    });
};

export const getRectDistance = (first, second) => {
    const horizontalGap = axisGap(first.x, first.x + first.w, second.x, second.x + second.w);
    const verticalGap = axisGap(first.y, first.y + first.h, second.y, second.y + second.h);
    return { horizontalGap, verticalGap, distance: Math.hypot(horizontalGap, verticalGap) };
};

export const assignRectToQuestionAnchor = (viewportRect, visualAnchors, pageHeight) => {
    if (!Array.isArray(visualAnchors) || visualAnchors.length === 0) {
        return { defaultAnchor: null, candidateAnchorIds: [] };
    }

    const imageTop = viewportRect.y;
    const imageBottom = viewportRect.y + viewportRect.h;
    const imageCenterX = viewportRect.x + viewportRect.w / 2;
    const rows = [];
    visualAnchors.forEach(anchor => {
        const centerY = anchor.viewportRect.y + anchor.viewportRect.h / 2;
        const row = rows.find(candidate => Math.abs(candidate.centerY - centerY) <= 12);
        if (row) {
            row.anchors.push(anchor);
            row.centerY = row.anchors.reduce((sum, item) => (
                sum + item.viewportRect.y + item.viewportRect.h / 2
            ), 0) / row.anchors.length;
        } else {
            rows.push({ centerY, anchors: [anchor] });
        }
    });
    rows.sort((first, second) => first.centerY - second.centerY);

    const sections = rows.map((row, index) => {
        const nextRow = rows[index + 1];
        const sectionTop = index === 0 ? 0 : row.centerY;
        const sectionBottom = nextRow ? nextRow.centerY : pageHeight;
        const overlap = Math.max(0, Math.min(imageBottom, sectionBottom) - Math.max(imageTop, sectionTop));
        return { row, index, overlap };
    });
    const bestSection = sections.reduce((best, section) => (
        !best || section.overlap > best.overlap ? section : best
    ), null);
    const selectedRow = bestSection?.row || rows[0];
    const rowAnchors = [...selectedRow.anchors].sort((first, second) => (
        first.viewportRect.x - second.viewportRect.x
    ));
    const defaultAnchor = rowAnchors.reduce((best, anchor) => {
        const centerX = anchor.viewportRect.x + anchor.viewportRect.w / 2;
        const distance = Math.abs(imageCenterX - centerX);
        return !best || distance < best.distance ? { anchor, distance } : best;
    }, null)?.anchor || visualAnchors[0];
    const defaultRowIndex = bestSection?.index || 0;
    const strongestOverlap = Math.max(1, bestSection?.overlap || 0);
    const candidateAnchorIds = [defaultAnchor.id];

    sections.forEach(section => {
        if (Math.abs(section.index - defaultRowIndex) !== 1) return;
        const immediatelyBeforeRow = imageBottom <= section.row.centerY
            && section.row.centerY - imageBottom <= 32;
        if (section.overlap < strongestOverlap * 0.5 && !immediatelyBeforeRow) return;
        section.row.anchors.forEach(anchor => {
            if (!candidateAnchorIds.includes(anchor.id)) candidateAnchorIds.push(anchor.id);
        });
    });

    return { defaultAnchor, candidateAnchorIds };
};

const STRUCTURAL_FIGURE_PATTERN = /^(?:図|画像|Fig\.?)\s*(?:[0-9０-９]+|[A-Za-z])(?:\s|$|[.:：．])/i;
const SUBSECTION_ANCHOR_PATTERN = /^(?:No\.?|NO\.?)\s*[0-9０-９]{1,3}\s*[-ー−‐–―]\s*[0-9０-９A-Za-z]+/i;

export const getNuclearTextQuestionAnchorId = (source, visualAnchors, pageHeight) => {
    const textRect = source?.viewportRect;
    if (!textRect) return null;

    const textCenterY = textRect.y + textRect.h / 2;
    const sameRowAnchor = visualAnchors
        .filter(anchor => {
            const anchorRect = anchor.viewportRect;
            const anchorCenterY = anchorRect.y + anchorRect.h / 2;
            const tolerance = Math.max(18, textRect.h, anchorRect.h);
            return Math.abs(textCenterY - anchorCenterY) <= tolerance
                && textRect.x >= anchorRect.x + anchorRect.w - 8;
        })
        .sort((first, second) => {
            const firstGap = Math.abs(textRect.x - (first.viewportRect.x + first.viewportRect.w));
            const secondGap = Math.abs(textRect.x - (second.viewportRect.x + second.viewportRect.w));
            return firstGap - secondGap;
        })[0];

    return sameRowAnchor?.id || assignRectToQuestionAnchor(
        textRect,
        visualAnchors,
        pageHeight
    ).defaultAnchor?.id || null;
};

const buildStructuralFigureRows = sources => {
    const rows = [];

    [...sources]
        .sort((first, second) => (
            Math.abs(first.viewportRect.y - second.viewportRect.y) > 32
                ? first.viewportRect.y - second.viewportRect.y
                : first.viewportRect.x - second.viewportRect.x
        ))
        .forEach(source => {
            const centerY = source.viewportRect.y + source.viewportRect.h / 2;
            const row = rows.find(candidate => Math.abs(candidate.centerY - centerY) <= 32);
            if (row) {
                row.sources.push(source);
                row.centerY = row.sources.reduce((sum, item) => (
                    sum + item.viewportRect.y + item.viewportRect.h / 2
                ), 0) / row.sources.length;
                return;
            }
            rows.push({ centerY, sources: [source] });
        });

    return rows
        .sort((first, second) => first.centerY - second.centerY)
        .map(row => ({
            ...row,
            sources: row.sources.sort((first, second) => first.viewportRect.x - second.viewportRect.x)
        }));
};

const getStructuralFigureOrder = source => {
    const token = String(source?.text || '').trim().match(
        /^(?:図|画像|Fig\.?)\s*([0-9０-９]+|[A-Za-z])/i
    )?.[1] || '';
    const normalizedDigits = token.replace(/[０-９]/g, char => String(char.charCodeAt(0) - 0xFEE0));
    if (/^\d+$/.test(normalizedDigits)) return Number(normalizedDigits);
    if (/^[A-Za-z]$/.test(token)) return 1000 + token.toUpperCase().charCodeAt(0);
    return Number.MAX_SAFE_INTEGER;
};

const shouldLinkStructuralImages = (first, second) => {
    const firstRect = first.viewportRect;
    const secondRect = second.viewportRect;
    const horizontalGap = axisGap(
        firstRect.x,
        firstRect.x + firstRect.w,
        secondRect.x,
        secondRect.x + secondRect.w
    );
    const verticalGap = axisGap(
        firstRect.y,
        firstRect.y + firstRect.h,
        secondRect.y,
        secondRect.y + secondRect.h
    );
    const horizontalOverlap = Math.max(0, Math.min(
        firstRect.x + firstRect.w,
        secondRect.x + secondRect.w
    ) - Math.max(firstRect.x, secondRect.x));
    const verticalOverlap = Math.max(0, Math.min(
        firstRect.y + firstRect.h,
        secondRect.y + secondRect.h
    ) - Math.max(firstRect.y, secondRect.y));
    const minimumWidth = Math.min(firstRect.w, secondRect.w);
    const minimumHeight = Math.min(firstRect.h, secondRect.h);
    const heightRatio = Math.max(firstRect.h, secondRect.h) / Math.max(1, minimumHeight);
    const widthRatio = Math.max(firstRect.w, secondRect.w) / Math.max(1, minimumWidth);

    const sameRow = verticalOverlap >= minimumHeight * 0.62
        && heightRatio <= 1.35
        && horizontalGap <= Math.max(8, minimumWidth * 0.08);
    const sameColumn = horizontalOverlap >= minimumWidth * 0.62
        && widthRatio <= 1.35
        && verticalGap <= Math.max(8, minimumHeight * 0.08);
    return sameRow || sameColumn || (horizontalGap === 0 && verticalGap === 0);
};

const buildStructuralImageComponents = imageSources => {
    const visited = new Set();
    const components = [];

    imageSources.forEach((_source, index) => {
        if (visited.has(index)) return;
        const stack = [index];
        const images = [];
        visited.add(index);

        while (stack.length > 0) {
            const currentIndex = stack.pop();
            const current = imageSources[currentIndex];
            images.push(current);
            imageSources.forEach((candidate, candidateIndex) => {
                if (visited.has(candidateIndex)) return;
                if (!shouldLinkStructuralImages(current, candidate)) return;
                visited.add(candidateIndex);
                stack.push(candidateIndex);
            });
        }

        const sortedImages = images.sort((first, second) => (
            Math.abs(first.viewportRect.y - second.viewportRect.y) > 12
                ? first.viewportRect.y - second.viewportRect.y
                : first.viewportRect.x - second.viewportRect.x
        ));
        components.push({
            images: sortedImages,
            bounds: unionFigureRects(images.map(image => image.viewportRect))
        });
    });

    return components.sort((first, second) => (
        Math.abs(first.bounds.y - second.bounds.y) > 12
            ? first.bounds.y - second.bounds.y
            : first.bounds.x - second.bounds.x
    ));
};

const isAlignedRowComposite = imageSources => {
    if (imageSources.length < 3) return false;
    const sorted = [...imageSources].sort((first, second) => (
        first.viewportRect.x - second.viewportRect.x
    ));
    const widths = sorted.map(source => source.viewportRect.w).sort((a, b) => a - b);
    const medianWidth = widths[Math.floor(widths.length / 2)];
    const tops = sorted.map(source => source.viewportRect.y);
    const bottoms = sorted.map(source => source.viewportRect.y + source.viewportRect.h);
    const aligned = Math.max(...tops) - Math.min(...tops) <= 18
        && Math.max(...bottoms) - Math.min(...bottoms) <= 18;
    const gapsAreCompact = sorted.slice(1).every((source, index) => {
        const previous = sorted[index].viewportRect;
        return source.viewportRect.x - (previous.x + previous.w) <= medianWidth * 0.85;
    });
    return aligned && gapsAreCompact;
};

const assignImagesToFigureRows = (imageSources, figureSources) => {
    const rows = buildStructuralFigureRows(figureSources);
    const groups = new Map(figureSources.map(source => [source.id, []]));
    const components = buildStructuralImageComponents(imageSources);

    for (const component of components) {
        const centerX = component.bounds.x + component.bounds.w / 2;
        const row = rows.reduce((best, candidate) => {
            const distance = Math.abs(component.bounds.y - candidate.centerY);
            return !best || distance < best.distance ? { row: candidate, distance } : best;
        }, null)?.row;
        if (!row) return null;

        const selectedSource = row.sources.reduce((best, source) => {
            const sourceCenterX = source.viewportRect.x + source.viewportRect.w / 2;
            const distance = Math.abs(centerX - sourceCenterX);
            return !best || distance < best.distance ? { source, distance } : best;
        }, null)?.source;
        if (!selectedSource) return null;
        groups.get(selectedSource.id)?.push(...component.images);
    }

    const populatedGroups = [...figureSources]
        .sort((first, second) => (
            getStructuralFigureOrder(first) - getStructuralFigureOrder(second)
        ))
        .map(source => ({ source, images: groups.get(source.id) || [] }))
        .filter(group => group.images.length > 0);
    return populatedGroups.length > 0 ? populatedGroups : null;
};

// Strong PDF anchors are more reliable than VLM proximity for composite figures.
// Only complete figure bands are emitted; ambiguous images remain available to VLM.
export const buildNuclearStructuralGroups = (objects = [], pageHeight = 0, options = {}) => {
    const { forceQuestionComposite = false } = options;
    const visualAnchors = objects
        .filter(object => object.type === 'question_anchor' && object.viewportRect)
        .sort((first, second) => first.viewportRect.y - second.viewportRect.y);
    const imageSources = objects.filter(object => object.type === 'image' && object.viewportRect);
    const figureSources = objects.filter(object => (
        object.type === 'text'
        && object.viewportRect
        && STRUCTURAL_FIGURE_PATTERN.test(String(object.text || '').trim())
    ));
    const groups = [];
    const assignedImageIds = new Set();
    const anchorsWithFigureSources = new Set();

    if (forceQuestionComposite) {
        visualAnchors.forEach(anchor => {
            const ownedImages = imageSources.filter(image => image.defaultQuestionAnchorId === anchor.id);
            if (ownedImages.length === 0) return;
            ownedImages.forEach(image => assignedImageIds.add(image.id));
            groups.push({
                groupId: `structural-${anchor.id}-rotated-page`,
                questionAnchorId: anchor.id,
                imageIds: ownedImages.map(image => image.id),
                legendIds: [],
                mergeReason: ownedImages.length > 1 ? 'continuous_composition' : 'single_image',
                confidence: 1
            });
        });
        return {
            groups,
            complete: imageSources.length > 0 && assignedImageIds.size === imageSources.length,
            assignedImageIds: [...assignedImageIds]
        };
    }

    visualAnchors.forEach(anchor => {
        const ownedImages = imageSources.filter(image => image.defaultQuestionAnchorId === anchor.id);
        if (ownedImages.length === 0) return;

        const ownedFigureSources = figureSources.filter(source => (
            getNuclearTextQuestionAnchorId(source, visualAnchors, pageHeight) === anchor.id
        ));
        if (ownedFigureSources.length > 0) anchorsWithFigureSources.add(anchor.id);
        const figureBands = ownedFigureSources.length > 0
            ? assignImagesToFigureRows(ownedImages, ownedFigureSources)
            : null;

        if (figureBands && figureBands.flatMap(group => group.images).length === ownedImages.length) {
            figureBands.forEach((band, index) => {
                band.images.forEach(image => assignedImageIds.add(image.id));
                groups.push({
                    groupId: `structural-${anchor.id}-figure-${index + 1}`,
                    questionAnchorId: anchor.id,
                    imageIds: band.images.map(image => image.id),
                    legendIds: [band.source.id],
                    mergeReason: band.images.length > 1 ? 'labeled_composite' : 'single_image',
                    confidence: 1
                });
            });
            return;
        }

        if (ownedFigureSources.length > 0) return;
        if (!SUBSECTION_ANCHOR_PATTERN.test(String(anchor.text || '').trim())) return;
        ownedImages.forEach(image => assignedImageIds.add(image.id));
        groups.push({
            groupId: `structural-${anchor.id}-subsection`,
            questionAnchorId: anchor.id,
            imageIds: ownedImages.map(image => image.id),
            legendIds: [],
            mergeReason: ownedImages.length > 1 ? 'labeled_composite' : 'single_image',
            confidence: 1
        });
        return;
    });

    visualAnchors.forEach(anchor => {
        if (anchorsWithFigureSources.has(anchor.id)) return;
        const ownedImages = imageSources.filter(image => (
            image.defaultQuestionAnchorId === anchor.id && !assignedImageIds.has(image.id)
        ));
        if (ownedImages.length === 0) return;
        const components = buildStructuralImageComponents(ownedImages);
        const hasCompositeComponent = components.some(component => component.images.length > 1);

        if (hasCompositeComponent) {
            components.forEach((component, index) => {
                component.images.forEach(image => assignedImageIds.add(image.id));
                groups.push({
                    groupId: `structural-${anchor.id}-component-${index + 1}`,
                    questionAnchorId: anchor.id,
                    imageIds: component.images.map(image => image.id),
                    legendIds: [],
                    mergeReason: component.images.length > 1 ? 'continuous_composition' : 'single_image',
                    confidence: 1
                });
            });
            return;
        }

        if (!isAlignedRowComposite(ownedImages)) return;
        ownedImages.forEach(image => assignedImageIds.add(image.id));
        groups.push({
            groupId: `structural-${anchor.id}-aligned-row`,
            questionAnchorId: anchor.id,
            imageIds: ownedImages.map(image => image.id),
            legendIds: [],
            mergeReason: 'labeled_composite',
            confidence: 1
        });
    });

    return {
        groups,
        complete: imageSources.length > 0 && assignedImageIds.size === imageSources.length,
        assignedImageIds: [...assignedImageIds]
    };
};

const normalizeCaptionText = text => String(text || '')
    .replace(/^[\s\[\]［］【】]*(?:No\.?|NO\.?)\s*[0-9０-９]{1,3}(?:\s*[-ー−‐–―]\s*[0-9０-９A-Za-z]+)?\s*/i, '')
    .replace(/^(?:図|画像|Fig\.?)\s*[0-9０-９]+[\s.:：．]*\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

export const resolveNuclearDisplayLegend = (textSources = []) => {
    const validSources = textSources.filter(source => source?.text && source?.viewportRect);
    const figureSource = validSources.find(source => (
        /^(?:図|画像|Fig\.?)\s*[0-9０-９]+/i.test(String(source.text).trim())
    ));
    if (figureSource) {
        const figureRect = figureSource.viewportRect;
        const figureCenterY = figureRect.y + figureRect.h / 2;
        const sameCaptionLineSources = validSources
            .filter(source => {
                const rect = source.viewportRect;
                const centerY = rect.y + rect.h / 2;
                const verticalTolerance = Math.max(12, figureRect.h, rect.h);
                const horizontalGap = rect.x > figureRect.x
                    ? rect.x - (figureRect.x + figureRect.w)
                    : figureRect.x - (rect.x + rect.w);
                return Math.abs(centerY - figureCenterY) <= verticalTolerance
                    && horizontalGap <= 90;
            })
            .sort((first, second) => first.viewportRect.x - second.viewportRect.x);
        const captionText = sameCaptionLineSources.map(source => source.text).join(' ');
        const semanticLegend = normalizeCaptionText(captionText);
        const figureToken = String(figureSource.text).trim().match(/^(?:図|画像|Fig\.?)\s*[0-9０-９]+/i)?.[0] || '';
        const legend = semanticLegend || figureToken.replace(/\s+/g, '');

        if (/^(?:別紙|別冊|別図|付図|参考図)(?:\s*No\.?\s*[0-9０-９-]+)?$/i.test(legend)) {
            return { legend: '', sources: [] };
        }
        return { legend, sources: sameCaptionLineSources };
    }

    if (validSources.length !== 1) {
        return { legend: '', sources: [] };
    }

    const source = validSources[0];
    const legend = normalizeCaptionText(source.text);
    if (
        !legend
        || /^(?:別紙|別冊|別図|付図|参考図|設問|試験問題|筆記)$/i.test(legend)
    ) {
        return { legend: '', sources: [] };
    }
    return { legend, sources: [source] };
};

export const buildNuclearDisplayLegend = textSources => (
    resolveNuclearDisplayLegend(textSources).legend
);
