const axisGap = (firstMin, firstMax, secondMin, secondMax) => {
    if (firstMax < secondMin) return secondMin - firstMax;
    if (secondMax < firstMin) return firstMin - secondMax;
    return 0;
};

export const unionFigureRects = (rects) => {
    if (!Array.isArray(rects) || rects.length === 0) return null;

    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.h));

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
    const sections = visualAnchors.map((anchor, index) => {
        const anchorCenter = anchor.viewportRect.y + anchor.viewportRect.h / 2;
        const nextAnchor = visualAnchors[index + 1];
        const nextCenter = nextAnchor
            ? nextAnchor.viewportRect.y + nextAnchor.viewportRect.h / 2
            : pageHeight;
        const sectionTop = index === 0 ? 0 : anchorCenter;
        const overlap = Math.max(0, Math.min(imageBottom, nextCenter) - Math.max(imageTop, sectionTop));
        return { anchor, index, overlap };
    });

    const bestSection = sections.reduce((best, section) => (
        !best || section.overlap > best.overlap ? section : best
    ), null);
    const defaultAnchor = bestSection?.anchor || visualAnchors[0];
    const defaultIndex = Math.max(0, visualAnchors.findIndex(anchor => anchor.id === defaultAnchor.id));
    const candidateAnchorIds = [defaultIndex - 1, defaultIndex, defaultIndex + 1]
        .filter(index => index >= 0 && index < visualAnchors.length)
        .map(index => visualAnchors[index].id);

    return { defaultAnchor, candidateAnchorIds };
};
