"use client";

import { useState, useEffect } from 'react';
import styles from '../login/login.module.scss';
import { useRouter } from 'next/navigation';

import { initializeLocalExams, getExamTypes } from '@/lib/data';
import { saveLocalExam, deleteLocalExam, exportAllLocalData, importLocalData, getLocalExam } from '@/lib/localDb';
import {
    buildNuclearVlmPageRequest,
    convertNuclearVlmResultToGroups,
    requestNuclearVlmGrouping
} from '@/lib/nuclearVlmClient';
import {
    buildNuclearDisplayLegend,
    mergeNuclearImageFragments
} from '@/lib/nuclearFigureGeometry.mjs';

const FOOTER_DASH_CLASS = 'ー―－\\-−–—';
const FOOTER_PAGE_PATTERN = new RegExp(`^[${FOOTER_DASH_CLASS}]?\\s*[0-9０-９]+\\s*[${FOOTER_DASH_CLASS}]?$`);
const FOOTER_PAGE_SUFFIX_PATTERN = new RegExp(`\\s*[${FOOTER_DASH_CLASS}]?\\s*[0-9０-９]+\\s*[${FOOTER_DASH_CLASS}]?\\s*$`, 'g');
const FOOTER_DASH_ONLY_PATTERN = new RegExp(`^[${FOOTER_DASH_CLASS}]+$`);
const IMAGE_ORIENTATION_LABEL_PATTERN = /^(?:右前斜位|左前斜位|右後斜位|左後斜位|前斜位|後斜位|正面|前面|後面|側面|右側面|左側面|右|左|前|後|上|下|矢状|冠状|横断|軸位|長軸|短軸)(?:像|位)?$/i;
const WEAK_IMAGE_DESCRIPTOR_PATTERN = /^(?:[①-⑳]|\(?\s*[0-9０-９]+\s*\)?|[0-9０-９]+(?:\.[0-9０-９]+)?)$/;
const TEMPORAL_IMAGE_LABEL_PATTERN = /^(?:入院直後|初診時|来院時|治療前|治療後|術前|術後|退院時|発症時|当日|翌日|前回|今回|現在|過去|[0-9０-９]+\s*(?:日|週|か月|ヶ月|月|年)(?:前|後)?|[0-9０-９]+\s*(?:時間|min|hr)\s*(?:前|後)?)$/i;
const DEFAULT_IMAGE_QUESTION_LABEL_PATTERN = /(?:問|問題)\s*(?:番号)?\s*(\d{1,3})/i;
const NO_QUESTION_LABEL_PATTERN = /^[\s\[\]［］【】]*(?:No\.?|NO\.?)\s*[0-9０-９]{1,3}[\s\[\]［］【】]*$/i;
const FIGURE_HEADER_PATTERN = /図\s*[0-9０-９]+/;
const INLINE_NO_QUESTION_PREFIX_PATTERN = /^[\s\[\]［］【】]*(?:No\.?|NO\.?)\s*[0-9０-９]{1,3}(?:\s*[-ー−‐–―]\s*[0-9０-９A-Za-z]+)?\s*/i;

// レジェンドとして適切かどうかを判定する関数
const isValidLegendText = (text, item = null, allPageTextItems = []) => {
    if (!text) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length > 50) return false; // レジェンドとしては50文字超は長すぎる

    // フッター（ページ番号）や単なる数値は無条件で除外する (二重の安全弁)
    const isFooterOrPageNum = FOOTER_PAGE_PATTERN.test(trimmed) || /^[0-9０-９]+$/.test(trimmed);
    if (isFooterOrPageNum) {
        return false;
    }
    if (NO_QUESTION_LABEL_PATTERN.test(trimmed)) {
        return false;
    }
    if (/^(?:別紙|別冊|別図|付図|参考図|設問|試験問題|筆記)$/i.test(trimmed)) {
        return false;
    }

    // 1. 問題文によくある表現が含まれている場合は除外
    // ※ "病変", "所見" などの名詞は有効なレジェンドに含まりうるため除外キーワードから削除し、指示表現のみに制限
    const questionKeywords = /どれか|選べ|を示|はどれ|次の|のうち|最も適切|選べ。|どれか。/;
    if (questionKeywords.test(trimmed)) {
        return false;
    }

    // 2. 明らかな文末表現（文章）は除外
    if (/(?:である|する|した|れる|られる|おく|いく|ない|いる|ある|得る|挙げる|認める|みられる|伴う|考える|考えられる|行う|行った|認めた|みられた|伴った)(?:\s*[。.]?)$/.test(trimmed)) {
        return false;
    }

    // 3. 選択肢と思われるパターン（a. 〜〜）は除外
    // 単に "a" や "b" や "a)" などは画像記号としてのレジェンドの可能性があるので、
    // 選択肢の記号から始まって、かつ後ろに文章が続いているものを除外する
    if (/^[a-eA-Eａ-ｅＡ-Ｅ][\.．\s\)\)）].{2,}/.test(trimmed)) {
        return false;
    }

    // Left-side option prefix check
    if (item && allPageTextItems.length > 0) {
        const optionPattern = /^[a-eA-E\uff41-\uff45\uff21-\uff25][\.\uff0e\s\)\)\uff09]?$/;
        const sameLineLeftItems = allPageTextItems.filter(other => 
            Math.abs(other.y - item.y) <= 3 && other.x < item.x
        );
        const hasOptionPrefix = sameLineLeftItems.some(other => optionPattern.test(other.text.trim()));
        if (hasOptionPrefix) {
            return false;
        }
    }

    // 4. 英数字・スペース・カンマ・ピリオド・ハイフンのみで構成される英語レジェンド表現（例: time intensity curve）
    // は、ある程度の長さ（35文字以下）であれば、キーワードの有無に関わらず無条件で許可する
    if (/^[a-zA-Z0-9-+\s()\/.,]+$/.test(trimmed) && trimmed.length <= 35) {
        return true;
    }

    // 5. レジェンドらしいキーワード（図番、またはモダリティ・画像用語）が含まれているか
    // ※ 15文字以下の短いテキストであれば、問題文や選択肢の除外チェックをパスした時点で有効とみなす
    if (trimmed.length <= 15) {
        return true;
    }

    const hasLegendIndicator = /(?:図|画像|写真|Fig|photo|label|panel|表)\s*\d+/i.test(trimmed) || 
                              /^[a-gA-G]\b/.test(trimmed) || // 先頭が a〜g, A〜G のラベル
                              /(?:CT|MRI|T1|T2|FLAIR|DWI|ADC|PET|MRA|シンチ|エコー|超音波|X線|レントゲン|シネ|造影|強調|矢状|冠状|横断|水平|正面|側面|像|写真|図|グラフ|チャート|マップ|map|SPECT|ブルズアイ|心筋|負荷|安静|遅延|早期|curve|スタディ|ダイナミック)/i.test(trimmed);

    return hasLegendIndicator;
};

// プレフィックスを除去する関数
const convertLegendMarkupToUnicode = (text) => String(text || '')
    .replace(/<sup>(.*?)<\/sup>/gi, (_match, value) => (
        String(value)
            .split('')
            .map(char => ({
                0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴',
                5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹',
                '+': '⁺', '-': '⁻'
            }[char] || char))
            .join('')
    ))
    .replace(/<sub>(.*?)<\/sub>/gi, (_match, value) => (
        String(value)
            .split('')
            .map(char => ({
                0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄',
                5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉',
                '+': '₊', '-': '₋'
            }[char] || char))
            .join('')
    ));

const normalizeFullWidthDigits = (text) => String(text || '')
    .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0));

const extractFigureNumber = (text) => {
    const normalized = normalizeFullWidthDigits(convertLegendMarkupToUnicode(text)).trim();
    const match = normalized.match(/(?:図|画像|Fig\.?)\s*([0-9]+)/i);
    if (!match) return null;

    const parsed = Number.parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const buildFigureLegend = (text) => {
    const figureNumber = extractFigureNumber(text);
    return figureNumber !== null ? `図${figureNumber}` : '';
};

const cleanLegendPrefix = (text) => {
    if (!text) return '';
    let cleaned = convertLegendMarkupToUnicode(text).trim();

    cleaned = cleaned.replace(INLINE_NO_QUESTION_PREFIX_PATTERN, '');
    
    // 「図1」「図 1」「Fig. 1」「Fig1」「画像1」などのプレフィックスパターン
    // および、それに続くコロン、ドット、スペースなどを除去
    cleaned = cleaned.replace(/^(?:図|画像|Fig\.?|photo|panel|label|表)\s*\d+[\s.:：．]*\s*/i, '');
    
    // 先頭の「a.」「b)」「A - 」「①」などの記号パターンを除去
    cleaned = cleaned.replace(/^[a-gA-G①-⑦]\s*[-.:：．)]\s*/, '');
    cleaned = cleaned.replace(/^[a-gA-G①-⑦]\s+/, '');
    
    // トリミング
    cleaned = cleaned.trim();
    
    // もしクリーンアップした結果、無効な名前（「図1」などの残り、あるいは単なる記号など）や空になった場合は空文字列を返す
    const isInvalid = (val) => {
        if (!val) return true;
        const trimmed = val.trim();
        return /^(null|none|図\d+|画像\d+|Fig\.?\d+|[a-g]\)?)$/i.test(trimmed);
    };
    
    if (isInvalid(cleaned)) {
        return '';
    }
    
    return cleaned;
};

const compareImportedImages = (a, b) => {
    if (a.page !== b.page) return a.page - b.page;

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

    if (Math.abs(a.y - b.y) > 20) return b.y - a.y;
    return a.x - b.x;
};

const resolveImportedImageLegend = (img, idx) => {
    if (img.legendResolved) {
        return String(img.displayLegend ?? img.detectedLegend ?? '');
    }

    const explicitFigureLegend = img.figureLabel || buildFigureLegend(img.detectedLegendRaw || img.detectedLegend || '');
    if (explicitFigureLegend) {
        return explicitFigureLegend;
    }

    const cleaned = cleanLegendPrefix(img.detectedLegend);
    return cleaned || `図${idx + 1}`;
};

const buildViewportFigureAnchors = (anchors, viewport) => (
    anchors
        .filter(anchor => Number.isFinite(anchor.figureNumber))
        .map(anchor => {
            const [vx, vy] = viewport.convertToViewportPoint(anchor.x, anchor.y);
            return {
                ...anchor,
                viewportX: vx,
                viewportY: vy
            };
        })
);

const assignFigureAnchorsToNuclearImages = (images, anchors, viewport) => {
    const viewportAnchors = buildViewportFigureAnchors(anchors, viewport);
    const imagesWithBounds = images.filter(image => image.viewportBounds);

    if (viewportAnchors.length === 0 || imagesWithBounds.length === 0) {
        return;
    }

    const candidatePairs = [];
    imagesWithBounds.forEach((image, imageIndex) => {
        const bounds = image.viewportBounds;
        const cropLeft = bounds.x;
        const cropRight = bounds.x + bounds.w;
        const cropTop = bounds.y;
        const cropCenterX = bounds.x + (bounds.w / 2);

        viewportAnchors.forEach((anchor, anchorIndex) => {
            const horizontalSlack = 48;
            const horizontalOverflow = anchor.viewportX < cropLeft - horizontalSlack
                ? (cropLeft - horizontalSlack) - anchor.viewportX
                : anchor.viewportX > cropRight + horizontalSlack
                    ? anchor.viewportX - (cropRight + horizontalSlack)
                    : 0;
            const verticalGap = cropTop - anchor.viewportY;
            const maxGap = Math.max(bounds.h * 0.35, 140);
            const minGap = -36;

            if (verticalGap < minGap || verticalGap > maxGap) {
                return;
            }

            const score = (horizontalOverflow * 8)
                + Math.abs(cropCenterX - anchor.viewportX)
                + Math.abs(verticalGap - 18);

            candidatePairs.push({
                imageIndex,
                anchorIndex,
                score
            });
        });
    });

    candidatePairs.sort((a, b) => a.score - b.score);

    const usedImages = new Set();
    const usedAnchors = new Set();

    candidatePairs.forEach(({ imageIndex, anchorIndex }) => {
        if (usedImages.has(imageIndex) || usedAnchors.has(anchorIndex)) {
            return;
        }

        const image = imagesWithBounds[imageIndex];
        const anchor = viewportAnchors[anchorIndex];

        image.figureNumber = anchor.figureNumber;
        if (!image.legendResolved) {
            image.figureLabel = anchor.figureLabel || buildFigureLegend(anchor.rawText || '');
            image.detectedLegendRaw = anchor.rawText || image.detectedLegendRaw || '';
            image.detectedLegend = cleanLegendPrefix(anchor.rawText || image.detectedLegend || '');
        }

        usedImages.add(imageIndex);
        usedAnchors.add(anchorIndex);
    });
};

const buildQuestionId = (year, questionNumber) => {
    const numericYear = Number(year);
    const numericQuestionNumber = Number(questionNumber);
    if (!Number.isInteger(numericYear) || !Number.isInteger(numericQuestionNumber)) {
        return String(questionNumber ?? '');
    }
    return `${numericYear}${String(numericQuestionNumber).padStart(3, '0')}`;
};

const buildTextItemKeySet = (items = []) => new Set(items.map(item => buildTextItemKey(item)));

const isRectContainedWithin = (outer, inner, tolerance = 4) => {
    const outerMinX = outer.x - tolerance;
    const outerMinY = outer.y - tolerance;
    const outerMaxX = outer.x + outer.w + tolerance;
    const outerMaxY = outer.y + outer.h + tolerance;
    const innerMinX = inner.x;
    const innerMinY = inner.y;
    const innerMaxX = inner.x + inner.w;
    const innerMaxY = inner.y + inner.h;

    return (
        innerMinX >= outerMinX &&
        innerMaxX <= outerMaxX &&
        innerMinY >= outerMinY &&
        innerMaxY <= outerMaxY
    );
};

const mergeNestedImageRects = (rects) => {
    if (rects.length <= 1) return rects;

    const uniqueRects = [];
    rects.forEach(rect => {
        const duplicate = uniqueRects.some(existing =>
            Math.abs(existing.x - rect.x) < 1 &&
            Math.abs(existing.y - rect.y) < 1 &&
            Math.abs(existing.w - rect.w) < 1 &&
            Math.abs(existing.h - rect.h) < 1
        );
        if (!duplicate) {
            uniqueRects.push(rect);
        }
    });

    const sortedByArea = [...uniqueRects].sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const independentRects = [];

    sortedByArea.forEach(rect => {
        const rectArea = rect.w * rect.h;
        const hasContainer = independentRects.some(parent => {
            const parentArea = parent.w * parent.h;
            if (parentArea <= rectArea * 1.2) return false;
            return isRectContainedWithin(parent, rect);
        });

        if (!hasContainer) {
            independentRects.push(rect);
        }
    });

    return independentRects;
};

const getRectGap = (aMin, aMax, bMin, bMax) => {
    if (aMax < bMin) return bMin - aMax;
    if (bMax < aMin) return aMin - bMax;
    return 0;
};

const unionRects = (rects) => {
    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.w));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.h));

    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY
    };
};

const shouldMergeNuclearRects = (a, b) => {
    if (a.matchedQNum === null || b.matchedQNum === null || a.matchedQNum !== b.matchedQNum) {
        return false;
    }

    const aMinX = a.x;
    const aMaxX = a.x + a.w;
    const aMinY = a.y;
    const aMaxY = a.y + a.h;
    const bMinX = b.x;
    const bMaxX = b.x + b.w;
    const bMinY = b.y;
    const bMaxY = b.y + b.h;

    const horizontalGap = getRectGap(aMinX, aMaxX, bMinX, bMaxX);
    const verticalGap = getRectGap(aMinY, aMaxY, bMinY, bMaxY);
    const xOverlap = Math.max(0, Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX));
    const yOverlap = Math.max(0, Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY));
    const minWidth = Math.min(a.w, b.w);
    const minHeight = Math.min(a.h, b.h);

    const horizontallyAligned = yOverlap >= minHeight * 0.35 && horizontalGap <= 36;
    const verticallyAligned = xOverlap >= minWidth * 0.35 && verticalGap <= 36;
    const nearlyTouching = horizontalGap <= 10 && verticalGap <= 10;

    return horizontallyAligned || verticallyAligned || nearlyTouching;
};

const mergeNuclearImageRects = (rects) => {
    if (rects.length <= 1) return rects;

    const visited = new Set();
    const merged = [];

    rects.forEach((rect, index) => {
        if (visited.has(index)) return;

        const stack = [index];
        const cluster = [];
        visited.add(index);

        while (stack.length > 0) {
            const currentIndex = stack.pop();
            const currentRect = rects[currentIndex];
            cluster.push(currentRect);

            rects.forEach((candidate, candidateIndex) => {
                if (visited.has(candidateIndex)) return;
                if (!shouldMergeNuclearRects(currentRect, candidate)) return;
                visited.add(candidateIndex);
                stack.push(candidateIndex);
            });
        }

        const mergedRect = unionRects(cluster);
        merged.push({
            ...mergedRect,
            matchedQNum: cluster[0].matchedQNum
        });
    });

    return merged;
};

const shouldMergeDenseNuclearSectionRects = (a, b) => {
    const aMinX = a.x;
    const aMaxX = a.x + a.w;
    const aMinY = a.y;
    const aMaxY = a.y + a.h;
    const bMinX = b.x;
    const bMaxX = b.x + b.w;
    const bMinY = b.y;
    const bMaxY = b.y + b.h;

    const horizontalGap = getRectGap(aMinX, aMaxX, bMinX, bMaxX);
    const verticalGap = getRectGap(aMinY, aMaxY, bMinY, bMaxY);
    const xOverlap = Math.max(0, Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX));
    const yOverlap = Math.max(0, Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY));
    const minWidth = Math.min(a.w, b.w);
    const minHeight = Math.min(a.h, b.h);

    const sameRowTouching = yOverlap >= minHeight * 0.4 && horizontalGap <= 1;
    const stackedTouching = xOverlap >= minWidth * 0.2 && verticalGap <= 1;
    const overlapping = xOverlap > 0 && yOverlap > 0;

    return sameRowTouching || stackedTouching || overlapping;
};

const mergeDenseNuclearSectionRects = (rects) => {
    if (rects.length <= 1) return rects;

    const visited = new Set();
    const merged = [];

    rects.forEach((rect, index) => {
        if (visited.has(index)) return;
        visited.add(index);

        const stack = [index];
        const cluster = [];

        while (stack.length > 0) {
            const currentIndex = stack.pop();
            const currentRect = rects[currentIndex];
            cluster.push(currentRect);

            rects.forEach((candidate, candidateIndex) => {
                if (visited.has(candidateIndex)) return;
                if (!shouldMergeDenseNuclearSectionRects(currentRect, candidate)) return;
                visited.add(candidateIndex);
                stack.push(candidateIndex);
            });
        }

        merged.push(unionRects(cluster));
    });

    return merged;
};

const stripLeadingQuestionLabel = (text) => String(text || '')
    .replace(INLINE_NO_QUESTION_PREFIX_PATTERN, '')
    .trim();

const getRectCenterY = (rect) => rect.y + (rect.h / 2);
const getRectCenterX = (rect) => rect.x + (rect.w / 2);
const isNuclearSideLabelText = (text) => /^(?:右|左|前|後|上|下|上段|下段|術前|術後|水平断面|冠状断面|矢状断面|短軸像|垂直長軸像|水平長軸像|安静時|負荷時)$/i.test(text);
const isPotentialNuclearTopCaption = (text) => /^(?:安静時|負荷時|アセタゾラミド負荷時|術前|術後|18.?F.*|201Tl.*|99mTc.*|123I.*|MRI.*|CT.*|PET.*|PYP.*|FDG.*|BMIPP.*|MIBG.*|IMP.*|T2WI.*|T1WI.*|FLAIR.*|DWI.*)$/i.test(String(text || '').trim());

const collectNuclearSideLabelItems = (rect, textItems, excludedKeys = new Set()) => {
    const sideMargin = Math.max(90, Math.min(160, rect.w * 0.35));
    const verticalPadding = Math.max(24, Math.min(60, rect.h * 0.12));

    return textItems.filter(item => {
        const key = buildTextItemKey(item);
        if (excludedKeys.has(key)) return false;

        const text = stripLeadingQuestionLabel(item.text.trim());
        if (!text) return false;
        if (NO_QUESTION_LABEL_PATTERN.test(text) || FIGURE_HEADER_PATTERN.test(text)) return false;
        if (!isNuclearSideLabelText(text)) return false;

        const centerX = item.x + item.width / 2;
        const centerY = item.y + item.height / 2;
        const withinVerticalBand = centerY >= (rect.y - verticalPadding) && centerY <= (rect.y + rect.h + verticalPadding);
        const inLeftBand = centerX < rect.x && centerX >= (rect.x - sideMargin);
        const inRightBand = centerX > (rect.x + rect.w) && centerX <= (rect.x + rect.w + sideMargin);

        return withinVerticalBand && (inLeftBand || inRightBand);
    });
};

const NUCLEAR_CHILD_SECTION_PATTERN = /^(?:図\s*([0-9０-９]+)(?:-[0-9０-９]+)?|(?:No\.?|NO\.?)\s*([0-9０-９]{1,3})\s*[-ー−‐–―]\s*([0-9０-９]+))/i;

const isNuclearChildAnchorText = (text, questionNumber = null) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    const match = trimmed.match(NUCLEAR_CHILD_SECTION_PATTERN);
    if (!match) return false;
    if (match[2] && questionNumber !== null && parseInt(match[2], 10) !== questionNumber) return false;
    return true;
};

const doesLineOverlapRect = (line, rect, minOverlap = 18) => {
    const items = line.items || [];
    if (items.length === 0) return false;
    const lineMinX = Math.min(...items.map(item => item.x));
    const lineMaxX = Math.max(...items.map(item => item.x + item.width));
    const overlap = Math.min(lineMaxX, rect.x + rect.w) - Math.max(lineMinX, rect.x);
    return overlap >= Math.min(minOverlap, rect.w * 0.8);
};

const buildNuclearChildAnchors = (sectionLines, sectionRects, questionNumber) => {
    const anchors = [];

    sectionLines.forEach(line => {
        const items = line.items || [];
        if (items.length === 0) return;

        const wholeLineText = buildInlineTextFromItems(items) || line.text || '';
        const wholeLineTrimmed = wholeLineText.trim();
        if (isNuclearChildAnchorText(wholeLineTrimmed, questionNumber)) {
            const lineMinX = Math.min(...items.map(item => item.x));
            anchors.push({
                y: line.y,
                x: lineMinX,
                text: cleanLegendPrefix(stripLeadingQuestionLabel(wholeLineTrimmed)),
                rawText: wholeLineTrimmed,
                items
            });
            return;
        }

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            const itemText = item.text.trim();
            if (!isNuclearChildAnchorText(itemText, questionNumber)) continue;

            const anchorItems = [item];
            for (let nextIndex = itemIndex + 1; nextIndex < items.length; nextIndex++) {
                const nextItem = items[nextIndex];
                const nextText = nextItem.text.trim();
                if (!nextText) continue;
                if (NO_QUESTION_LABEL_PATTERN.test(nextText)) break;
                if (isNuclearChildAnchorText(nextText, questionNumber)) break;
                anchorItems.push(nextItem);
            }

            const rawText = buildInlineTextFromItems(anchorItems) || anchorItems.map(entry => entry.text).join(' ').trim();
            anchors.push({
                y: line.y,
                x: item.x,
                text: cleanLegendPrefix(stripLeadingQuestionLabel(rawText)),
                rawText,
                items: anchorItems
            });
        }
    });

    const topCaptionAnchors = sectionLines
        .map(line => {
            const captionText = stripLeadingQuestionLabel(buildInlineTextFromItems(line.items || []) || line.text);
            return {
                ...line,
                captionText,
                x: Math.min(...(line.items || []).map(item => item.x))
            };
        })
        .filter(line => {
            if (!line.captionText) return false;
            if (NO_QUESTION_LABEL_PATTERN.test(line.captionText)) return false;
            if (FIGURE_HEADER_PATTERN.test(line.captionText)) return false;
            if (line.captionText.length > 30) return false;
            if (!isPotentialNuclearTopCaption(line.captionText)) return false;
            return sectionRects.some(rect => {
                if (!doesLineOverlapRect(line, rect, 24)) return false;
                const topGap = line.y - (rect.y + rect.h);
                return topGap >= 0 && topGap <= 42;
            });
        })
        .map(line => ({
            y: line.y,
            x: line.x,
            text: cleanLegendPrefix(line.captionText),
            rawText: line.captionText,
            items: line.items || []
        }));

    return [...anchors, ...topCaptionAnchors]
        .filter((anchor, index, array) => {
            const normalized = `${Math.round(anchor.x)}_${Math.round(anchor.y)}_${anchor.rawText}`;
            return array.findIndex(candidate => `${Math.round(candidate.x)}_${Math.round(candidate.y)}_${candidate.rawText}` === normalized) === index;
        })
        .sort((a, b) => {
            if (Math.abs(b.y - a.y) > 8) return b.y - a.y;
            return a.x - b.x;
        });
};

const buildNuclearTopCaptionAnchors = (sectionLines, sectionRects) => (
    sectionLines
        .map(line => {
            const items = line.items || [];
            if (items.length === 0) return null;

            const captionText = stripLeadingQuestionLabel(buildInlineTextFromItems(items) || line.text);
            if (!captionText) return null;
            if (NO_QUESTION_LABEL_PATTERN.test(captionText)) return null;
            if (FIGURE_HEADER_PATTERN.test(captionText)) return null;
            if (captionText.length > 30) return null;
            if (!isPotentialNuclearTopCaption(captionText)) return null;

            const lineMinX = Math.min(...items.map(item => item.x));
            const overlapsAnyRect = sectionRects.some(rect => {
                if (!doesLineOverlapRect(line, rect, 24)) return false;
                const topGap = line.y - (rect.y + rect.h);
                return topGap >= 0 && topGap <= 42;
            });

            if (!overlapsAnyRect) return null;

            return {
                y: line.y,
                x: lineMinX,
                text: cleanLegendPrefix(captionText),
                rawText: captionText,
                items
            };
        })
        .filter(Boolean)
        .filter((anchor, index, array) => {
            const normalized = `${Math.round(anchor.x)}_${Math.round(anchor.y)}_${anchor.rawText}`;
            return array.findIndex(candidate => `${Math.round(candidate.x)}_${Math.round(candidate.y)}_${candidate.rawText}` === normalized) === index;
        })
        .sort((a, b) => {
            if (Math.abs(b.y - a.y) > 8) return b.y - a.y;
            return a.x - b.x;
        })
);

const buildNuclearSubsections = (sectionStart, nextSection, sectionLines, sectionRects, parserProfile) => {
    const sectionTopY = sectionStart.y + 18;
    const sectionBottomY = nextSection ? nextSection.y + 18 : parserProfile.footerMinY;
    const childAnchors = buildNuclearChildAnchors(sectionLines, sectionRects, sectionStart.questionNumber);

    if (childAnchors.length === 0) {
        return [{
            topY: sectionTopY,
            bottomY: sectionBottomY,
            leftX: -Infinity,
            rightX: Infinity,
            anchor: null,
            questionNumber: sectionStart.questionNumber
        }];
    }

    const rows = [];
    childAnchors.forEach(anchor => {
        const existingRow = rows.find(row => Math.abs(row.y - anchor.y) <= 8);
        if (existingRow) {
            existingRow.anchors.push(anchor);
        } else {
            rows.push({ y: anchor.y, anchors: [anchor] });
        }
    });
    rows.sort((a, b) => b.y - a.y);

    const subsections = [];
    rows.forEach((row, rowIndex) => {
        const nextRow = rows[rowIndex + 1] || null;
        row.anchors.sort((a, b) => a.x - b.x);

        row.anchors.forEach((anchor, anchorIndex) => {
            const leftX = anchorIndex === 0
                ? -Infinity
                : (row.anchors[anchorIndex - 1].x + anchor.x) / 2;
            const rightX = anchorIndex === row.anchors.length - 1
                ? Infinity
                : (anchor.x + row.anchors[anchorIndex + 1].x) / 2;

            subsections.push({
                topY: anchor.y + 16,
                bottomY: nextRow ? nextRow.y + 16 : sectionBottomY,
                leftX,
                rightX,
                anchor,
                questionNumber: sectionStart.questionNumber
            });
        });
    });

    return subsections;
};

const buildNuclearLegendBlocks = (sectionLines, candidateRects, excludedTextKeys) => {
    const legendLines = sectionLines
        .map(line => {
            const items = (line.items || []).filter(item => !excludedTextKeys.has(buildTextItemKey(item)));
            if (items.length === 0) return null;
            const text = cleanLegendPrefix(stripLeadingQuestionLabel(buildInlineTextFromItems(items) || line.text));
            if (!text) return null;
            if (!isValidLegendText(text, items[0], sectionLines.flatMap(entry => entry.items || []))) return null;

            const lineMinX = Math.min(...items.map(item => item.x));
            const lineMaxX = Math.max(...items.map(item => item.x + item.width));
            const lineMinY = Math.min(...items.map(item => item.y));
            const lineMaxY = Math.max(...items.map(item => item.y + item.height));

            const overlapsRect = candidateRects.some(rect => (
                lineMaxX > rect.x &&
                lineMinX < (rect.x + rect.w) &&
                lineMaxY > rect.y &&
                lineMinY < (rect.y + rect.h)
            ));
            if (overlapsRect) return null;

            return {
                y: line.y,
                text,
                items,
                minX: lineMinX,
                maxX: lineMaxX,
                minY: lineMinY,
                maxY: lineMaxY
            };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (Math.abs(b.y - a.y) > 10) return b.y - a.y;
            return a.minX - b.minX;
        });

    const blocks = [];
    legendLines.forEach(line => {
        const previous = blocks[blocks.length - 1];
        if (!previous) {
            blocks.push({
                text: line.text,
                items: [...line.items],
                minX: line.minX,
                maxX: line.maxX,
                minY: line.minY,
                maxY: line.maxY,
                centerX: (line.minX + line.maxX) / 2,
                centerY: (line.minY + line.maxY) / 2
            });
            return;
        }

        const verticalGap = Math.abs(previous.minY - line.maxY);
        const horizontalOverlap = Math.min(previous.maxX, line.maxX) - Math.max(previous.minX, line.minX);
        const shouldMerge = verticalGap <= 18 && horizontalOverlap >= -12;

        if (!shouldMerge) {
            blocks.push({
                text: line.text,
                items: [...line.items],
                minX: line.minX,
                maxX: line.maxX,
                minY: line.minY,
                maxY: line.maxY,
                centerX: (line.minX + line.maxX) / 2,
                centerY: (line.minY + line.maxY) / 2
            });
            return;
        }

        previous.text = `${previous.text} ${line.text}`.trim();
        previous.items.push(...line.items);
        previous.minX = Math.min(previous.minX, line.minX);
        previous.maxX = Math.max(previous.maxX, line.maxX);
        previous.minY = Math.min(previous.minY, line.minY);
        previous.maxY = Math.max(previous.maxY, line.maxY);
        previous.centerX = (previous.minX + previous.maxX) / 2;
        previous.centerY = (previous.minY + previous.maxY) / 2;
    });

    return blocks;
};

const buildNuclearGroupsFromSubsection = (subsection, sectionLines, sectionRects) => {
    const subsectionRects = sectionRects.filter(rect => {
        const centerY = getRectCenterY(rect);
        const centerX = getRectCenterX(rect);
        return centerY < subsection.topY
            && centerY > subsection.bottomY
            && centerX >= subsection.leftX
            && centerX < subsection.rightX;
    });

    if (subsectionRects.length === 0) {
        return [];
    }

    const firstCropRects = mergeDenseNuclearSectionRects(subsectionRects).sort((a, b) => {
        if (Math.abs(getRectCenterY(b) - getRectCenterY(a)) > 20) return getRectCenterY(b) - getRectCenterY(a);
        return getRectCenterX(a) - getRectCenterX(b);
    });

    const subsectionLines = sectionLines.filter(line => {
        const centerY = line.y;
        const items = line.items || [];
        if (items.length === 0) return false;
        const centerX = (Math.min(...items.map(item => item.x)) + Math.max(...items.map(item => item.x + item.width))) / 2;
        return centerY <= subsection.topY && centerY > subsection.bottomY && centerX >= subsection.leftX && centerX < subsection.rightX;
    });

    const excludedTextKeys = new Set(buildTextItemKeySet(subsection.anchor?.items || []));
    firstCropRects.forEach(rect => {
        subsectionLines.forEach(line => {
            (line.items || []).forEach(item => {
                const txCenter = item.x + item.width / 2;
                const tyCenter = item.y + item.height / 2;
                if (txCenter >= rect.x && txCenter <= rect.x + rect.w && tyCenter >= rect.y && tyCenter <= rect.y + rect.h) {
                    excludedTextKeys.add(buildTextItemKey(item));
                }
            });
        });
    });

    const legendBlocks = buildNuclearLegendBlocks(subsectionLines, firstCropRects, excludedTextKeys);

    if (legendBlocks.length === firstCropRects.length) {
        return firstCropRects.map(rect => {
            const bestLegend = legendBlocks.reduce((closest, candidate) => {
                if (!closest) return candidate;
                const currentDistance = Math.abs(candidate.centerX - getRectCenterX(rect)) + Math.abs(candidate.centerY - getRectCenterY(rect));
                const bestDistance = Math.abs(closest.centerX - getRectCenterX(rect)) + Math.abs(closest.centerY - getRectCenterY(rect));
                return currentDistance < bestDistance ? candidate : closest;
            }, null);

            return {
                rect,
                matchedQNum: subsection.questionNumber,
                legend: subsection.anchor?.text || cleanLegendPrefix(bestLegend?.text || ''),
                headerItems: subsection.anchor?.items || [],
                forceLegendOutsideCrop: true
            };
        });
    }

    if (legendBlocks.length <= 1) {
        return [{
            rect: unionRects(firstCropRects),
            matchedQNum: subsection.questionNumber,
            legend: subsection.anchor?.text || cleanLegendPrefix(legendBlocks[0]?.text || ''),
            headerItems: subsection.anchor?.items || [],
            forceLegendOutsideCrop: true
        }];
    }

    if (legendBlocks.length > firstCropRects.length) {
        return [{
            rect: unionRects(firstCropRects),
            matchedQNum: subsection.questionNumber,
            legend: subsection.anchor?.text || '',
            headerItems: subsection.anchor?.items || [],
            forceLegendOutsideCrop: true
        }];
    }

    const sortedLegends = [...legendBlocks].sort((a, b) => {
        if (Math.abs(b.centerY - a.centerY) > 20) return b.centerY - a.centerY;
        return a.centerX - b.centerX;
    });

    const rectGroups = sortedLegends.map(() => []);
    firstCropRects.forEach(rect => {
        let bestIndex = 0;
        let bestDistance = Infinity;
        sortedLegends.forEach((legend, legendIndex) => {
            const distance = Math.abs(legend.centerX - getRectCenterX(rect)) + Math.abs(legend.centerY - getRectCenterY(rect));
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = legendIndex;
            }
        });
        rectGroups[bestIndex].push(rect);
    });

    return rectGroups
        .map((rectGroup, legendIndex) => {
            if (rectGroup.length === 0) return null;
            return {
                rect: unionRects(rectGroup),
                matchedQNum: subsection.questionNumber,
                legend: subsection.anchor?.text || cleanLegendPrefix(sortedLegends[legendIndex]?.text || ''),
                headerItems: subsection.anchor?.items || [],
                forceLegendOutsideCrop: true
            };
        })
        .filter(Boolean);
};

const buildNuclearSectionImageGroups = (textItems, imageRects, parserProfile) => {
    const lines = buildTextLineEntriesFromItems(textItems);
    const sectionStarts = lines
        .map(line => ({
            ...line,
            questionNumber: extractQuestionNumberFromText(line.text, [parserProfile.imageLabelPattern])
        }))
        .filter(line => line.questionNumber !== null)
        .sort((a, b) => b.y - a.y);

    if (sectionStarts.length === 0 || imageRects.length === 0) {
        return [];
    }

    const groups = [];

    sectionStarts.forEach((sectionStart, index) => {
        const nextSection = sectionStarts[index + 1] || null;
        const sectionTopY = sectionStart.y + 18;
        const sectionBottomY = nextSection ? nextSection.y + 18 : parserProfile.footerMinY;
        const rawSectionRects = imageRects.filter(rect => {
            const centerY = getRectCenterY(rect);
            if (!(centerY < sectionTopY && centerY > sectionBottomY)) return false;
            if (Math.abs(centerY - sectionStart.y) <= (rect.h / 2)) {
                return centerY < sectionStart.y;
            }
            return true;
        });
        const sectionRects = mergeDenseNuclearSectionRects(rawSectionRects);

        if (sectionRects.length === 0) {
            return;
        }

        const sectionLines = lines.filter(line => line.y <= sectionTopY && line.y > sectionBottomY);
        const subsections = buildNuclearSubsections(sectionStart, nextSection, sectionLines, sectionRects, parserProfile);
        const usedSectionRects = new Set();

        subsections.forEach(subsection => {
            const subsectionGroups = buildNuclearGroupsFromSubsection(subsection, sectionLines, sectionRects);
            subsectionGroups.forEach(group => {
                groups.push(group);
                sectionRects.forEach(rect => {
                    const centerY = getRectCenterY(rect);
                    const centerX = getRectCenterX(rect);
                    if (centerY < subsection.topY
                        && centerY > subsection.bottomY
                        && centerX >= subsection.leftX
                        && centerX < subsection.rightX) {
                        usedSectionRects.add(rect);
                    }
                });
            });
        });

        sectionRects
            .filter(rect => !usedSectionRects.has(rect))
            .sort((a, b) => {
                if (Math.abs(getRectCenterY(b) - getRectCenterY(a)) > 20) return getRectCenterY(b) - getRectCenterY(a);
                return getRectCenterX(a) - getRectCenterX(b);
            })
            .forEach(rect => {
                groups.push({
                    rect,
                    matchedQNum: sectionStart.questionNumber,
                    legend: '',
                    headerItems: [],
                    forceLegendOutsideCrop: false
                });
            });
    });

    return groups;
};

const NUCLEAR_FIGURE_TOKEN_ONLY_PATTERN = /^図\s*(?:[0-9０-９]+|[A-Za-z])$/i;
const NUCLEAR_FIGURE_WITH_CAPTION_PATTERN = /^図\s*(?:[0-9０-９]+|[A-Za-z]).*/i;
const NUCLEAR_LETTER_CAPTION_PATTERN = /^(?:[A-Ea-e])[：:].+$/;
const NUCLEAR_SECTION_PREFIX_PATTERN = /^(?:No\.?|NO\.?)\s*[0-9０-９]{1,3}(?:\s*[-ー−‐–―]\s*[0-9０-９A-Za-z]+)?\s*/i;

const isValidRect = (rect) => rect && Number.isFinite(rect.x) && Number.isFinite(rect.y) && rect.w > 0 && rect.h > 0;

const unionRectList = (rects) => {
    const validRects = rects.filter(isValidRect);
    if (validRects.length === 0) return null;

    const minX = Math.min(...validRects.map(rect => rect.x));
    const minY = Math.min(...validRects.map(rect => rect.y));
    const maxX = Math.max(...validRects.map(rect => rect.x + rect.w));
    const maxY = Math.max(...validRects.map(rect => rect.y + rect.h));

    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY
    };
};

const expandRect = (rect, paddingX = 0, paddingY = paddingX) => ({
    x: rect.x - paddingX,
    y: rect.y - paddingY,
    w: rect.w + paddingX * 2,
    h: rect.h + paddingY * 2
});

const getRectCenter = (rect) => ({
    x: rect.x + rect.w / 2,
    y: rect.y + rect.h / 2
});

const buildTextBlockRect = (block) => ({
    x: block.minX,
    y: block.minY,
    w: block.maxX - block.minX,
    h: block.maxY - block.minY
});

const doesRectOverlap = (a, b) => (
    a.x < (b.x + b.w)
    && (a.x + a.w) > b.x
    && a.y < (b.y + b.h)
    && (a.y + a.h) > b.y
);

const isNuclearContextLikeText = (text) => (
    isPotentialNuclearTopCaption(text)
    || isNuclearSideLabelText(text)
    || IMAGE_ORIENTATION_LABEL_PATTERN.test(text)
    || TEMPORAL_IMAGE_LABEL_PATTERN.test(text)
);

const isNuclearTextBlockNearAnyImageRect = (blockRect, imageRects) => (
    imageRects.some(rect => {
        const horizontalGap = getRectGap(blockRect.x, blockRect.x + blockRect.w, rect.x, rect.x + rect.w);
        const verticalGap = getRectGap(blockRect.y, blockRect.y + blockRect.h, rect.y, rect.y + rect.h);
        const xOverlap = Math.min(blockRect.x + blockRect.w, rect.x + rect.w) - Math.max(blockRect.x, rect.x);
        const yOverlap = Math.min(blockRect.y + blockRect.h, rect.y + rect.h) - Math.max(blockRect.y, rect.y);

        return doesRectOverlap(blockRect, rect)
            || (xOverlap > 0 && verticalGap <= 48)
            || (yOverlap > 0 && horizontalGap <= 48)
            || (horizontalGap <= 24 && verticalGap <= 24);
    })
);

const isAttachedNuclearTextBlock = (block, imageRects) => {
    const text = String(block.text || '').trim();
    if (!text) return false;

    const blockRect = buildTextBlockRect(block);
    const shortContextText = text.length <= 18 || isNuclearContextLikeText(text);
    if (!shortContextText) return false;

    return imageRects.some(rect => {
        const horizontalGap = getRectGap(blockRect.x, blockRect.x + blockRect.w, rect.x, rect.x + rect.w);
        const verticalGap = getRectGap(blockRect.y, blockRect.y + blockRect.h, rect.y, rect.y + rect.h);
        const xOverlap = Math.min(blockRect.x + blockRect.w, rect.x + rect.w) - Math.max(blockRect.x, rect.x);
        const yOverlap = Math.min(blockRect.y + blockRect.h, rect.y + rect.h) - Math.max(blockRect.y, rect.y);

        const topOrBottomAttached = xOverlap >= Math.min(blockRect.w * 0.6, rect.w * 0.8) && verticalGap <= 28;
        const sideAttached = yOverlap >= Math.min(blockRect.h * 0.6, rect.h * 0.2) && horizontalGap <= 24;

        return topOrBottomAttached || sideAttached;
    });
};

const buildNuclearContextBlocks = (textItems, imageRects, anchorItems = []) => {
    if (!textItems || textItems.length === 0 || imageRects.length === 0) {
        return [];
    }

    const sectionLines = buildTextLineEntriesFromItems(textItems);
    const excludedTextKeys = new Set(buildTextItemKeySet(anchorItems));
    const rawBlocks = buildNuclearLegendBlocks(sectionLines, imageRects, excludedTextKeys);

    return rawBlocks
        .map(block => {
            const rect = buildTextBlockRect(block);
            return {
                ...block,
                rect,
                attached: isAttachedNuclearTextBlock(block, imageRects)
            };
        })
        .filter(block => (
            isNuclearTextBlockNearAnyImageRect(block.rect, imageRects)
            || block.attached
        ));
};

const resolveNuclearGroupCrop = (group) => {
    const imageBounds = unionRectList(group.imageRects || []);
    if (!imageBounds) {
        return null;
    }

    const contextBlocks = buildNuclearContextBlocks(group.textItems || [], group.imageRects || [], group.anchorItems || []);
    const detachedBlocks = contextBlocks.filter(block => !block.attached);
    const includeContextRects = group.imageRects.length > 1
        ? contextBlocks.map(block => block.rect)
        : contextBlocks.filter(block => block.attached).map(block => block.rect);

    const cropBounds = unionRectList([
        ...group.imageRects,
        ...includeContextRects
    ]) || imageBounds;

    return {
        bounds: expandRect(cropBounds, 8, 8),
        supplementalLegend: cleanLegendPrefix(detachedBlocks[0]?.text || ''),
        contextBlocks
    };
};

const isNuclearFigureAnchorStart = (text) => {
    const trimmed = String(text || '').trim();
    if (!trimmed) return false;
    return NUCLEAR_FIGURE_TOKEN_ONLY_PATTERN.test(trimmed)
        || NUCLEAR_LETTER_CAPTION_PATTERN.test(trimmed);
};

const extractNuclearSectionLegend = (text) => {
    const trimmed = String(text || '').replace(NUCLEAR_SECTION_PREFIX_PATTERN, '').trim();
    if (!trimmed) return '';

    const figureMatch = trimmed.match(/図\s*(?:[0-9０-９]+|[A-Za-z])/i);
    if (figureMatch) {
        return cleanLegendPrefix(figureMatch[0]);
    }

    const letterCaptionMatch = trimmed.match(/(?:[A-Ea-e])[：:].{0,20}/);
    if (letterCaptionMatch) {
        return cleanLegendPrefix(letterCaptionMatch[0]);
    }

    return '';
};

const buildNuclearFigureAnchors = (sectionLines) => {
    const anchors = [];

    sectionLines.forEach(line => {
        const items = line.items || [];
        if (items.length === 0) return;

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            const item = items[itemIndex];
            const itemText = item.text.trim();
            if (!isNuclearFigureAnchorStart(itemText)) continue;

            const anchorItems = [item];

            if (!NUCLEAR_LETTER_CAPTION_PATTERN.test(itemText)) {
                for (let nextIndex = itemIndex + 1; nextIndex < items.length; nextIndex++) {
                    const nextItem = items[nextIndex];
                    const nextText = nextItem.text.trim();
                    if (!nextText) continue;
                    if (NO_QUESTION_LABEL_PATTERN.test(nextText)) break;
                    if (isNuclearFigureAnchorStart(nextText)) break;
                    anchorItems.push(nextItem);
                }
            }

            const rawText = buildInlineTextFromItems(anchorItems) || anchorItems.map(entry => entry.text).join(' ').trim();
            anchors.push({
                y: line.y,
                x: item.x,
                rawText,
                text: cleanLegendPrefix(stripLeadingQuestionLabel(rawText)),
                figureNumber: extractFigureNumber(rawText),
                figureLabel: buildFigureLegend(rawText),
                items: anchorItems
            });
        }
    });

    return anchors
        .filter(anchor => anchor.text || anchor.rawText)
        .filter((anchor, index, array) => {
            const normalized = `${Math.round(anchor.x)}_${Math.round(anchor.y)}_${anchor.rawText}`;
            return array.findIndex(candidate => `${Math.round(candidate.x)}_${Math.round(candidate.y)}_${candidate.rawText}` === normalized) === index;
        })
        .sort((a, b) => {
            if (Math.abs(b.y - a.y) > 10) return b.y - a.y;
            return a.x - b.x;
        });
};

const buildNuclearAnchorSubsections = (anchors, sectionTopY, sectionBottomY) => {
    const rows = [];

    anchors.forEach(anchor => {
        const existingRow = rows.find(row => Math.abs(row.y - anchor.y) <= 10);
        if (existingRow) {
            existingRow.anchors.push(anchor);
        } else {
            rows.push({ y: anchor.y, anchors: [anchor] });
        }
    });

    rows.sort((a, b) => b.y - a.y);

    const subsections = [];
    rows.forEach((row, rowIndex) => {
        const nextRow = rows[rowIndex + 1] || null;
        row.anchors.sort((a, b) => a.x - b.x);

        row.anchors.forEach((anchor, anchorIndex) => {
            const leftX = anchorIndex === 0
                ? -Infinity
                : (row.anchors[anchorIndex - 1].x + anchor.x) / 2;
            const rightX = anchorIndex === row.anchors.length - 1
                ? Infinity
                : (anchor.x + row.anchors[anchorIndex + 1].x) / 2;

            subsections.push({
                anchor,
                topY: anchor.y + 24,
                bottomY: nextRow ? nextRow.y + 16 : sectionBottomY,
                leftX,
                rightX
            });
        });
    });

    return subsections.filter(subsection => subsection.topY > subsection.bottomY);
};

const getTextItemRect = (item) => ({
    x: item.x,
    y: item.y,
    w: Math.max(1, item.width || 0),
    h: Math.max(1, item.height || 12)
});

const buildTextItemsBounds = (items = []) => unionRectList(items.map(getTextItemRect));

const dedupeNuclearAnchors = (anchors = []) => (
    anchors
        .filter(Boolean)
        .filter((anchor, index, array) => {
            const normalized = `${Math.round(anchor.x)}_${Math.round(anchor.y)}_${anchor.rawText || anchor.text || ''}`;
            return array.findIndex(candidate => `${Math.round(candidate.x)}_${Math.round(candidate.y)}_${candidate.rawText || candidate.text || ''}` === normalized) === index;
        })
        .sort((a, b) => {
            if (Math.abs(b.y - a.y) > 10) return b.y - a.y;
            return a.x - b.x;
        })
);

const buildNuclearQuestionOwners = (textItems, parserProfile) => {
    const lines = buildTextLineEntriesFromItems(textItems);
    const pageMaxY = Math.max(
        parserProfile.footerMinY + 400,
        ...textItems.map(item => item.y + (item.height || 0))
    );

    const anchors = lines
        .map(line => ({
            ...line,
            questionNumber: extractQuestionNumberFromText(line.text, [parserProfile.imageLabelPattern]),
            sectionLegend: extractNuclearSectionLegend(buildInlineTextFromItems(line.items || []) || line.text || '')
        }))
        .filter(line => line.questionNumber !== null)
        .sort((a, b) => b.y - a.y);

    return anchors.map((anchor, index) => {
        const next = anchors[index + 1] || null;
        return {
            ...anchor,
            ownerKey: `${anchor.questionNumber}:${Math.round(anchor.y)}:${index}:${anchor.text || anchor.sectionLegend || ''}`,
            ownerTopY: Math.min(pageMaxY, anchor.y + 48),
            ownerBottomY: next ? next.y + 24 : parserProfile.footerMinY
        };
    });
};

const scoreNuclearOwnerForRect = (rect, owner) => {
    const rectTopY = rect.y + rect.h;
    const rectBottomY = rect.y;
    const centerY = getRectCenterY(rect);
    const bandTopY = owner.ownerTopY;
    const bandBottomY = owner.ownerBottomY;
    const overlapHeight = Math.max(0, Math.min(rectTopY, bandTopY) - Math.max(rectBottomY, bandBottomY));
    const overlapRatio = overlapHeight / Math.max(1, rect.h);
    const clampedCenterY = Math.max(bandBottomY, Math.min(centerY, bandTopY));

    return (overlapRatio * 1000) - (Math.abs(centerY - clampedCenterY) * 6);
};

const assignNuclearItemsToOwners = (items, owners, toRect) => {
    if (owners.length === 0) return new Map();

    const grouped = new Map(owners.map(owner => [owner.ownerKey, []]));
    items.forEach(item => {
        const rect = toRect(item);
        const bestOwner = owners.reduce((best, owner) => {
            const score = scoreNuclearOwnerForRect(rect, owner);
            if (!best || score > best.score) {
                return { owner, score };
            }
            return best;
        }, null)?.owner;

        if (bestOwner) {
            grouped.get(bestOwner.ownerKey)?.push(item);
        }
    });

    return grouped;
};

const assignNuclearImageClustersToOwners = (rects, owners) => {
    const pageClusters = buildNuclearImageRectClusters(rects);
    const groupedClusters = assignNuclearItemsToOwners(pageClusters, owners, cluster => cluster.bounds);

    return {
        pageClusters,
        groupedClusters
    };
};

const shouldLinkNuclearFigureRects = (a, b) => {
    const aMinX = a.x;
    const aMaxX = a.x + a.w;
    const aMinY = a.y;
    const aMaxY = a.y + a.h;
    const bMinX = b.x;
    const bMaxX = b.x + b.w;
    const bMinY = b.y;
    const bMaxY = b.y + b.h;

    const xOverlap = Math.max(0, Math.min(aMaxX, bMaxX) - Math.max(aMinX, bMinX));
    const yOverlap = Math.max(0, Math.min(aMaxY, bMaxY) - Math.max(aMinY, bMinY));
    const intersectionArea = xOverlap * yOverlap;
    const minimumArea = Math.min(a.w * a.h, b.w * b.h);

    return intersectionArea / Math.max(1, minimumArea) >= 0.65;
};

const buildNuclearImageRectClusters = (rects) => {
    if (rects.length === 0) return [];

    const visited = new Set();
    const clusters = [];

    rects.forEach((rect, index) => {
        if (visited.has(index)) return;
        visited.add(index);

        const stack = [index];
        const clusterRects = [];

        while (stack.length > 0) {
            const currentIndex = stack.pop();
            const currentRect = rects[currentIndex];
            clusterRects.push(currentRect);

            rects.forEach((candidate, candidateIndex) => {
                if (visited.has(candidateIndex)) return;
                if (!shouldLinkNuclearFigureRects(currentRect, candidate)) return;
                visited.add(candidateIndex);
                stack.push(candidateIndex);
            });
        }

        const bounds = unionRects(clusterRects);
        clusters.push({
            imageRects: clusterRects,
            bounds,
            centerX: getRectCenterX(bounds),
            centerY: getRectCenterY(bounds)
        });
    });

    return clusters.sort((a, b) => {
        if (Math.abs(b.centerY - a.centerY) > 20) return b.centerY - a.centerY;
        return a.centerX - b.centerX;
    });
};

const buildNuclearQuestionFigureAnchors = (questionLines, questionRects, _questionNumber) => {
    const explicitFigureAnchors = buildNuclearFigureAnchors(questionLines);
    if (explicitFigureAnchors.length > 0) {
        return dedupeNuclearAnchors(explicitFigureAnchors);
    }

    const topCaptionAnchors = buildNuclearTopCaptionAnchors(questionLines, questionRects);
    const rectClusters = buildNuclearImageRectClusters(questionRects);
    const shouldUseTopCaptions = topCaptionAnchors.length === 2
        && rectClusters.length === topCaptionAnchors.length;

    return shouldUseTopCaptions
        ? dedupeNuclearAnchors(topCaptionAnchors)
        : [];
};

const pickNearestLegendBlock = (cluster, legendBlocks, usedLegendIndexes = new Set()) => {
    let bestLegend = null;
    let bestIndex = -1;
    let bestScore = Infinity;

    legendBlocks.forEach((block, index) => {
        if (usedLegendIndexes.has(index)) return;
        const dx = Math.abs(block.centerX - cluster.centerX);
        const dy = Math.abs(block.centerY - cluster.centerY);
        const score = dx + (dy * 0.9);
        if (score < bestScore) {
            bestScore = score;
            bestLegend = block;
            bestIndex = index;
        }
    });

    return { legend: bestLegend, index: bestIndex };
};

const buildGroupsWithoutExplicitSeeds = (clusters, legendBlocks) => {
    if (clusters.length === 0) return [];
    if (clusters.length === 1) {
        return [{ clusters, legendBlock: legendBlocks[0] || null, seed: null }];
    }

    // Structural fragments have already been merged. Without explicit evidence,
    // keep complete image rectangles independent instead of joining a nearby grid.
    const usedLegendIndexes = new Set();
    return clusters.map(cluster => {
        const { legend, index } = pickNearestLegendBlock(cluster, legendBlocks, usedLegendIndexes);
        if (index >= 0) usedLegendIndexes.add(index);
        return {
            clusters: [cluster],
            legendBlock: legend,
            seed: null
        };
    });

};

const buildNuclearAnchorCells = (seeds, ownerTopY, ownerBottomY) => {
    const rows = [];

    seeds.forEach(seed => {
        const existingRow = rows.find(row => Math.abs(row.y - seed.y) <= 10);
        if (existingRow) {
            existingRow.anchors.push(seed);
        } else {
            rows.push({ y: seed.y, anchors: [seed] });
        }
    });

    rows.sort((a, b) => b.y - a.y);

    const cells = [];
    rows.forEach((row, rowIndex) => {
        const previousRow = rows[rowIndex - 1] || null;
        const nextRow = rows[rowIndex + 1] || null;
        const topY = previousRow ? (previousRow.y + row.y) / 2 : ownerTopY;
        const bottomY = nextRow ? (row.y + nextRow.y) / 2 : ownerBottomY;

        row.anchors.sort((a, b) => a.x - b.x);
        row.anchors.forEach((anchor, anchorIndex) => {
            const previousAnchor = row.anchors[anchorIndex - 1] || null;
            const nextAnchor = row.anchors[anchorIndex + 1] || null;
            const leftX = previousAnchor ? (previousAnchor.x + anchor.x) / 2 : -Infinity;
            const rightX = nextAnchor ? (anchor.x + nextAnchor.x) / 2 : Infinity;

            cells.push({
                anchor,
                topY,
                bottomY,
                leftX,
                rightX
            });
        });
    });

    return cells;
};

const buildGroupsWithSeeds = (clusters, seeds, ownerTopY, ownerBottomY) => {
    if (clusters.length === 0) return [];
    if (seeds.length === 0) return [];
    if (seeds.length === 1) {
        if (clusters.length === 1) {
            return [{ clusters, seed: seeds[0], legendBlock: null }];
        }
        const nearestCluster = [...clusters].sort((first, second) => (
            Math.hypot(first.centerX - seeds[0].x, first.centerY - seeds[0].y)
            - Math.hypot(second.centerX - seeds[0].x, second.centerY - seeds[0].y)
        ))[0];
        return clusters.map(cluster => ({
            clusters: [cluster],
            seed: cluster === nearestCluster ? seeds[0] : null,
            legendBlock: null
        }));
    }

    const cells = buildNuclearAnchorCells(seeds, ownerTopY, ownerBottomY);
    const groups = cells.map(cell => ({
        clusters: [],
        seed: cell.anchor,
        cell,
        legendBlock: null
    }));

    const assignedClusterIndexes = new Set();
    clusters.forEach((cluster, index) => {
        const matchedGroup = groups.find(group => (
            cluster.centerY <= group.cell.topY
            && cluster.centerY > group.cell.bottomY
            && cluster.centerX >= group.cell.leftX
            && cluster.centerX < group.cell.rightX
        ));

        if (matchedGroup) {
            assignedClusterIndexes.add(index);
            matchedGroup.clusters.push(cluster);
            return;
        }
    });

    clusters.forEach((cluster, index) => {
        if (assignedClusterIndexes.has(index)) return;
        groups.push({
            clusters: [cluster],
            seed: null,
            legendBlock: null
        });
    });

    return groups.filter(group => group.clusters.length > 0);
};

const buildGroupsWithSeedsFromRects = (rects, seeds, ownerTopY, ownerBottomY) => {
    if (rects.length === 0 || seeds.length === 0) return [];
    if (seeds.length === 1) {
        return buildGroupsWithSeeds(
            buildNuclearImageRectClusters(rects),
            seeds,
            ownerTopY,
            ownerBottomY
        );
    }

    const cells = buildNuclearAnchorCells(seeds, ownerTopY, ownerBottomY);
    const groups = cells.map(cell => ({
        rects: [],
        clusters: [],
        seed: cell.anchor,
        cell,
        legendBlock: null
    }));
    const assignedRectIndexes = new Set();

    rects.forEach((rect, index) => {
        const centerY = getRectCenterY(rect);
        const centerX = getRectCenterX(rect);
        const matchedGroup = groups.find(group => (
            centerY <= group.cell.topY
            && centerY > group.cell.bottomY
            && centerX >= group.cell.leftX
            && centerX < group.cell.rightX
        ));

        if (!matchedGroup) return;
        assignedRectIndexes.add(index);
        matchedGroup.rects.push(rect);
    });

    groups.forEach(group => {
        if (group.rects.length === 0) return;
        group.clusters = buildNuclearImageRectClusters(group.rects);
    });

    const unassignedRects = rects.filter((_rect, index) => !assignedRectIndexes.has(index));
    const unassignedGroups = buildNuclearImageRectClusters(unassignedRects).map(cluster => ({
        clusters: [cluster],
        seed: null,
        legendBlock: null
    }));

    return [...groups, ...unassignedGroups]
        .filter(group => group.clusters.length > 0)
        .map(group => {
            if (!('rects' in group)) return group;
            const { rects: _rects, cell: _cell, ...rest } = group;
            return rest;
        });
};

const buildNuclearGroupFromClusters = (group, questionOwner, questionTextItems) => {
    const imageRects = group.clusters.flatMap(cluster => cluster.imageRects);
    const anchorItems = [
        ...(questionOwner.items || []),
        ...(group.seed?.items || [])
    ];
    const contextBlocks = buildNuclearContextBlocks(questionTextItems, imageRects, anchorItems);
    const attachedRects = contextBlocks.filter(block => block.attached).map(block => block.rect);
    const seedRect = buildTextItemsBounds(group.seed?.items || []);
    const detachedBlock = group.legendBlock || contextBlocks.find(block => !block.attached) || null;
    const bounds = unionRectList([
        ...imageRects,
        ...attachedRects,
        ...(seedRect ? [seedRect] : [])
    ]);

    if (!bounds) return null;

    const contextTextItems = contextBlocks.flatMap(block => block.items || []);
    const textItems = [
        ...(group.seed?.items || []),
        ...contextTextItems
    ].filter((item, index, array) => {
        const key = buildTextItemKey(item);
        return array.findIndex(candidate => buildTextItemKey(candidate) === key) === index;
    });

    const legendRaw = group.seed?.rawText || detachedBlock?.text || questionOwner.sectionLegend || '';
    const legend = cleanLegendPrefix(group.seed?.text || detachedBlock?.text || questionOwner.sectionLegend || '');
    const displayLegend = buildNuclearDisplayLegend(textItems.map(item => ({
        text: item.text,
        viewportRect: getTextItemRect(item)
    })));

    return {
        matchedQNum: questionOwner.questionNumber,
        legend,
        legendRaw,
        displayLegend,
        figureNumber: group.seed?.figureNumber ?? extractFigureNumber(legendRaw || legend),
        figureLabel: group.seed?.figureLabel || buildFigureLegend(legendRaw || legend),
        imageRects,
        textItems,
        anchorItems: (questionOwner.items || []).filter(item => (
            NO_QUESTION_LABEL_PATTERN.test(String(item.text || '').trim())
            || INLINE_NO_QUESTION_PREFIX_PATTERN.test(String(item.text || '').trim())
        )),
        bounds: expandRect(bounds, 8, 8),
        ownerTopY: questionOwner.ownerTopY,
        ownerBottomY: questionOwner.ownerBottomY
    };
};

const buildNuclearSemanticGroups = (textItems, imageRects, parserProfile) => {
    const questionOwners = buildNuclearQuestionOwners(textItems, parserProfile);
    if (questionOwners.length === 0 || imageRects.length === 0) {
        return [];
    }

    const rectsByQuestion = assignNuclearItemsToOwners(imageRects, questionOwners, rect => rect);
    const textItemsByQuestion = assignNuclearItemsToOwners(
        textItems.filter(item => !FOOTER_PAGE_PATTERN.test(item.text.trim())),
        questionOwners,
        getTextItemRect
    );

    return questionOwners.flatMap(questionOwner => {
        const ownedImageRects = rectsByQuestion.get(questionOwner.ownerKey) || [];
        if (ownedImageRects.length === 0) return [];

        const ownedTextItems = textItemsByQuestion.get(questionOwner.ownerKey) || [];
        const questionLines = buildTextLineEntriesFromItems(ownedTextItems);
        const clusters = buildNuclearImageRectClusters(ownedImageRects);
        const figureAnchors = buildNuclearQuestionFigureAnchors(questionLines, ownedImageRects, questionOwner.questionNumber);
        const legendBlocks = buildNuclearLegendBlocks(
            questionLines,
            ownedImageRects,
            new Set(buildTextItemKeySet([
                ...(questionOwner.items || []),
                ...figureAnchors.flatMap(anchor => anchor.items || [])
            ]))
        );

        const rawGroups = figureAnchors.length > 0
            ? buildGroupsWithSeedsFromRects(ownedImageRects, figureAnchors, questionOwner.ownerTopY, questionOwner.ownerBottomY)
            : buildGroupsWithoutExplicitSeeds(clusters, legendBlocks);

        return rawGroups
            .map(group => {
                const enrichedGroup = group.seed || group.legendBlock
                    ? group
                    : {
                        ...group,
                        legendBlock: pickNearestLegendBlock(group.clusters[0], legendBlocks).legend
                    };
                return buildNuclearGroupFromClusters(enrichedGroup, questionOwner, ownedTextItems);
            })
            .filter(Boolean);
    });
};

const collectInkComponentsInCanvasRegion = (canvas, region, options = {}) => {
    const {
        threshold = 245,
        minDarkPixelCount = 80,
        minComponentWidth = 20,
        minComponentHeight = 20,
        maxThinAspectRatio = 18,
        maxThinMinorSize = 24
    } = options;
    const x = Math.max(0, Math.floor(region.x));
    const y = Math.max(0, Math.floor(region.y));
    const w = Math.max(1, Math.min(canvas.width - x, Math.ceil(region.w)));
    const h = Math.max(1, Math.min(canvas.height - y, Math.ceil(region.h)));

    if (w <= 1 || h <= 1) return null;

    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(x, y, w, h);

    const darkMask = new Uint8Array(w * h);

    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            const idx = (py * w + px) * 4;
            const alpha = data[idx + 3];
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];

            if (alpha > 0 && (r < threshold || g < threshold || b < threshold)) {
                darkMask[py * w + px] = 1;
            }
        }
    }

    const visited = new Uint8Array(w * h);
    const significantComponents = [];
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
            const startIndex = py * w + px;
            if (!darkMask[startIndex] || visited[startIndex]) continue;

            const stack = [startIndex];
            visited[startIndex] = 1;

            let componentMinX = px;
            let componentMinY = py;
            let componentMaxX = px;
            let componentMaxY = py;
            let componentDarkPixelCount = 0;

            while (stack.length > 0) {
                const currentIndex = stack.pop();
                const cx = currentIndex % w;
                const cy = Math.floor(currentIndex / w);

                componentDarkPixelCount++;
                if (cx < componentMinX) componentMinX = cx;
                if (cy < componentMinY) componentMinY = cy;
                if (cx > componentMaxX) componentMaxX = cx;
                if (cy > componentMaxY) componentMaxY = cy;

                neighbors.forEach(([dx, dy]) => {
                    const nx = cx + dx;
                    const ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
                    const neighborIndex = ny * w + nx;
                    if (!darkMask[neighborIndex] || visited[neighborIndex]) return;
                    visited[neighborIndex] = 1;
                    stack.push(neighborIndex);
                });
            }

            const componentWidth = componentMaxX - componentMinX + 1;
            const componentHeight = componentMaxY - componentMinY + 1;
            if (
                componentDarkPixelCount < minDarkPixelCount
                || componentWidth < minComponentWidth
                || componentHeight < minComponentHeight
            ) {
                continue;
            }
            const aspectRatio = Math.max(componentWidth, componentHeight) / Math.max(1, Math.min(componentWidth, componentHeight));
            if (aspectRatio >= maxThinAspectRatio && Math.min(componentWidth, componentHeight) <= maxThinMinorSize) {
                continue;
            }

            significantComponents.push({
                x: x + componentMinX,
                y: y + componentMinY,
                w: componentWidth,
                h: componentHeight,
                darkPixelCount: componentDarkPixelCount
            });
        }
    }

    return significantComponents;
};

const findInkBoundsInCanvasRegion = (canvas, region, options = {}) => {
    const {
        strategy = 'largest'
    } = options;
    const significantComponents = collectInkComponentsInCanvasRegion(canvas, region, options);

    if (significantComponents.length === 0) {
        return null;
    }

    const targetComponent = strategy === 'union'
        ? significantComponents.reduce((acc, component) => {
            if (!acc) {
                return {
                    minX: component.x,
                    minY: component.y,
                    maxX: component.x + component.w - 1,
                    maxY: component.y + component.h - 1,
                    darkPixelCount: component.darkPixelCount
                };
            }

            acc.minX = Math.min(acc.minX, component.x);
            acc.minY = Math.min(acc.minY, component.y);
            acc.maxX = Math.max(acc.maxX, component.x + component.w - 1);
            acc.maxY = Math.max(acc.maxY, component.y + component.h - 1);
            acc.darkPixelCount += component.darkPixelCount;
            return acc;
        }, null)
        : significantComponents.reduce((best, component) => (
            !best || component.darkPixelCount > best.darkPixelCount ? component : best
        ), null);

    const bounds = strategy === 'union'
        ? {
            x: targetComponent.minX,
            y: targetComponent.minY,
            w: targetComponent.maxX - targetComponent.minX + 1,
            h: targetComponent.maxY - targetComponent.minY + 1,
            darkPixelCount: targetComponent.darkPixelCount
        }
        : {
            x: targetComponent.x,
            y: targetComponent.y,
            w: targetComponent.w,
            h: targetComponent.h,
            darkPixelCount: targetComponent.darkPixelCount
        };

    if (bounds.w < 20 || bounds.h < 20) {
        return null;
    }

    return bounds;
};

const chooseConservativeCropRegion = (rawRegion, candidateRegion) => {
    if (!candidateRegion) {
        return rawRegion;
    }

    const rawArea = Math.max(1, rawRegion.w * rawRegion.h);
    const candidateArea = Math.max(1, candidateRegion.w * candidateRegion.h);
    const widthRatio = candidateRegion.w / Math.max(1, rawRegion.w);
    const heightRatio = candidateRegion.h / Math.max(1, rawRegion.h);
    const areaRatio = candidateArea / rawArea;

    const leftTrimRatio = (candidateRegion.x - rawRegion.x) / Math.max(1, rawRegion.w);
    const topTrimRatio = (candidateRegion.y - rawRegion.y) / Math.max(1, rawRegion.h);
    const rightTrimRatio = ((rawRegion.x + rawRegion.w) - (candidateRegion.x + candidateRegion.w)) / Math.max(1, rawRegion.w);
    const bottomTrimRatio = ((rawRegion.y + rawRegion.h) - (candidateRegion.y + candidateRegion.h)) / Math.max(1, rawRegion.h);

    const isTooAggressive = (
        widthRatio < 0.9
        || heightRatio < 0.9
        || areaRatio < 0.78
        || leftTrimRatio > 0.12
        || topTrimRatio > 0.12
        || rightTrimRatio > 0.12
        || bottomTrimRatio > 0.12
    );

    return isTooAggressive ? rawRegion : candidateRegion;
};

const convertPdfRectToViewportRect = (rect, viewport) => {
    const pt1 = viewport.convertToViewportPoint(rect.x, rect.y);
    const pt2 = viewport.convertToViewportPoint(rect.x + rect.w, rect.y + rect.h);
    return {
        x: Math.min(pt1[0], pt2[0]),
        y: Math.min(pt1[1], pt2[1]),
        w: Math.abs(pt1[0] - pt2[0]),
        h: Math.abs(pt1[1] - pt2[1])
    };
};

const convertViewportRectToPdfRect = (rect, viewport) => {
    const pt1 = viewport.convertToPdfPoint(rect.x, rect.y);
    const pt2 = viewport.convertToPdfPoint(rect.x + rect.w, rect.y + rect.h);
    return {
        x: Math.min(pt1[0], pt2[0]),
        y: Math.min(pt1[1], pt2[1]),
        w: Math.abs(pt1[0] - pt2[0]),
        h: Math.abs(pt1[1] - pt2[1])
    };
};

const cloneCanvas = (sourceCanvas) => {
    const clone = document.createElement('canvas');
    clone.width = sourceCanvas.width;
    clone.height = sourceCanvas.height;
    const ctx = clone.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0);
    return clone;
};

const buildMaskedCanvasExcludingText = (pageCanvas, textItems, viewport) => {
    const maskedCanvas = cloneCanvas(pageCanvas);
    const ctx = maskedCanvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';

    textItems.forEach(item => {
        const rect = convertPdfRectToViewportRect(getTextItemRect(item), viewport);
        ctx.fillRect(
            Math.floor(rect.x) - 1,
            Math.floor(rect.y) - 1,
            Math.ceil(rect.w) + 2,
            Math.ceil(rect.h) + 2
        );
    });

    return maskedCanvas;
};

const buildNuclearOwnerViewportRegion = (owner, viewport, canvasWidth) => {
    const topPoint = viewport.convertToViewportPoint(0, owner.ownerTopY);
    const bottomPoint = viewport.convertToViewportPoint(0, owner.ownerBottomY);
    const minY = Math.max(0, Math.min(topPoint[1], bottomPoint[1]));
    const maxY = Math.max(topPoint[1], bottomPoint[1]);

    return {
        x: 0,
        y: minY,
        w: canvasWidth,
        h: Math.max(1, maxY - minY)
    };
};

const buildNuclearVisualAtomsForOwner = (maskedCanvas, owner, viewport) => {
    const ownerRegion = buildNuclearOwnerViewportRegion(owner, viewport, maskedCanvas.width);
    const components = collectInkComponentsInCanvasRegion(maskedCanvas, ownerRegion, {
        threshold: 245,
        minDarkPixelCount: 48,
        minComponentWidth: 14,
        minComponentHeight: 14,
        maxThinAspectRatio: 22,
        maxThinMinorSize: 20
    }).filter(component => component.w * component.h >= 500);

    if (components.length === 0) {
        return [];
    }

    return components
        .map(component => convertViewportRectToPdfRect(component, viewport))
        .filter(isValidRect)
        .map(rect => ({
            imageRects: [rect],
            bounds: rect,
            centerX: getRectCenterX(rect),
            centerY: getRectCenterY(rect)
        }))
        .sort((a, b) => {
            if (Math.abs(b.centerY - a.centerY) > 20) return b.centerY - a.centerY;
            return a.centerX - b.centerX;
        });
};

const buildNuclearVisualGroups = (textItems, parserProfile, pageCanvas, viewport, fallbackImageRects = []) => {
    const questionOwners = buildNuclearQuestionOwners(textItems, parserProfile);
    if (questionOwners.length === 0) {
        return [];
    }

    const usableTextItems = textItems.filter(item => !FOOTER_PAGE_PATTERN.test(item.text.trim()));
    const textItemsByQuestion = assignNuclearItemsToOwners(usableTextItems, questionOwners, getTextItemRect);
    const { groupedClusters: fallbackClustersByQuestion } = assignNuclearImageClustersToOwners(fallbackImageRects, questionOwners);
    const maskedCanvas = buildMaskedCanvasExcludingText(pageCanvas, usableTextItems, viewport);

    return questionOwners.flatMap(questionOwner => {
        const ownedTextItems = textItemsByQuestion.get(questionOwner.ownerKey) || [];
        const fallbackClusters = fallbackClustersByQuestion.get(questionOwner.ownerKey) || [];
        const fallbackRects = fallbackClusters.flatMap(cluster => cluster.imageRects || []);
        const questionLines = buildTextLineEntriesFromItems(ownedTextItems);
        const figureAnchors = buildNuclearQuestionFigureAnchors(questionLines, fallbackRects, questionOwner.questionNumber);
        const visualAtoms = fallbackClusters.length === 0
            ? buildNuclearVisualAtomsForOwner(maskedCanvas, questionOwner, viewport)
            : [];
        const clusters = fallbackClusters.length > 0 ? fallbackClusters : visualAtoms;

        if (clusters.length === 0) {
            return [];
        }

        const clusterBoundsRects = clusters.map(cluster => cluster.bounds);
        const legendBlocks = buildNuclearLegendBlocks(
            questionLines,
            clusterBoundsRects,
            new Set(buildTextItemKeySet([
                ...(questionOwner.items || []),
                ...figureAnchors.flatMap(anchor => anchor.items || [])
            ]))
        );

        const rawGroups = figureAnchors.length > 0
            ? (
                fallbackRects.length > 0
                    ? buildGroupsWithSeedsFromRects(fallbackRects, figureAnchors, questionOwner.ownerTopY, questionOwner.ownerBottomY)
                    : buildGroupsWithSeeds(clusters, figureAnchors, questionOwner.ownerTopY, questionOwner.ownerBottomY)
            )
            : buildGroupsWithoutExplicitSeeds(clusters, legendBlocks);

        return rawGroups
            .map(group => {
                const enrichedGroup = group.seed || group.legendBlock
                    ? group
                    : {
                        ...group,
                        legendBlock: pickNearestLegendBlock(group.clusters[0], legendBlocks).legend
                    };
                return buildNuclearGroupFromClusters(enrichedGroup, questionOwner, ownedTextItems);
            })
            .filter(Boolean);
    });
};

const getPdfParserProfile = (examCategory) => {
    if (examCategory === '3') {
        return {
            name: 'nuclear',
            questionPattern: /^\s*(\d{2})\s*[\.．:：\)）]/,
            optionPattern: /^[a-eA-Eａ-ｅＡ-Ｅ][\.．\s\)\)）]/,
            minQuestionLineLength: 3,
            minOptionCount: 3,
            maxQuestionNumber: 99,
            footerMinY: 45,
            fixedFirstQuestionPage: 3,
            imageAssignmentStrategy: 'label-only',
            imageLabelPattern: /(?:[\[［【]?\s*No\.?\s*([0-9]{2,3})\s*[\]］】]?)/i,
        };
    }

    if (examCategory === '4') {
        return {
            name: 'ivr',
            questionPattern: /^\s*(?:(?:問|問題|No\.?)\s*(\d{1,3})|(\d{1,3})\s*[\.．:：\)）])/i,
            optionPattern: /^[a-eA-Eａ-ｅＡ-Ｅ][\.．\s\)\)）]/,
            minQuestionLineLength: 4,
            minOptionCount: 3,
            maxQuestionNumber: 150,
            footerMinY: 45,
            imageAssignmentStrategy: 'nearest-preceding-question'
        };
    }

    return {
        name: 'default',
        questionPattern: /^\s*(?:(?:問|問題|No\.?)\s*(\d{1,3})|(\d{1,3})\s*[\.．:：\)）])/i,
        optionPattern: /^[a-eA-Eａ-ｅＡ-Ｅ][\.．\s\)\)）]/,
        minQuestionLineLength: 5,
        minOptionCount: 3,
        maxQuestionNumber: 150,
        footerMinY: 60,
        imageAssignmentStrategy: 'page-last-question'
    };
};

const buildTextLineEntriesFromItems = (textItems) => {
    if (!textItems || textItems.length === 0) return [];

    const sortedItems = [...textItems].sort((a, b) => {
        if (Math.abs(b.y - a.y) > 4) return b.y - a.y;
        return a.x - b.x;
    });

    const lines = [];
    sortedItems.forEach(item => {
        const existingLine = lines.find(line => Math.abs(line.y - item.y) <= 4);
        if (existingLine) {
            existingLine.items.push(item);
            existingLine.y = existingLine.items.reduce((sum, current) => sum + current.y, 0) / existingLine.items.length;
        } else {
            lines.push({ y: item.y, items: [item] });
        }
    });

    return lines
        .map(line => {
            const sortedLineItems = [...line.items].sort((a, b) => a.x - b.x);
            return {
                y: line.y,
                text: sortedLineItems.map(item => item.text).join('').trim(),
                items: sortedLineItems,
            };
        })
        .filter(line => line.text.length > 0)
        .sort((a, b) => b.y - a.y);
};

const buildTextLinesFromItems = (textItems) => buildTextLineEntriesFromItems(textItems).map(({ y, text }) => ({ y, text }));

const buildInlineTextFromItems = (items) => {
    if (!items || items.length === 0) return '';

    const sortedItems = [...items].sort((a, b) => a.x - b.x);
    const heights = sortedItems.map(item => item.height || 0).filter(h => h > 0);
    if (heights.length === 0) {
        return sortedItems.map(item => item.text).join('').trim();
    }

    const normalHeight = Math.max(...heights);
    const normalYItems = sortedItems.filter(item => Math.abs((item.height || 0) - normalHeight) < 2);
    const normalY = normalYItems.length > 0
        ? normalYItems.reduce((sum, item) => sum + item.y, 0) / normalYItems.length
        : sortedItems[0].y;

    return sortedItems.map(item => {
        const text = item.text;
        if (!text.trim()) return text;

        const itemHeight = item.height || 0;
        const diffY = item.y - normalY;
        const isSizeSmaller = normalHeight > 4 && (itemHeight / normalHeight < 0.85);
        const isPosShifted = Math.abs(diffY) > 1.5;

        if (isSizeSmaller && isPosShifted && text.length < 10) {
            if (diffY > 1.0) {
                return `<sup>${text}</sup>`;
            }
            if (diffY < -1.0) {
                return `<sub>${text}</sub>`;
            }
        }

        return text;
    }).join('').trim();
};

const extractQuestionNumberFromText = (text, patterns = []) => {
    for (const pattern of patterns) {
        if (!pattern) continue;
        const match = text.match(pattern);
        if (!match) continue;

        const value = parseInt(match[1], 10);
        if (Number.isInteger(value)) {
            return value;
        }
    }

    return null;
};

const detectImageMatchedQuestionNumber = (rect, textItems, parserProfile) => {
    const patterns = [parserProfile.imageLabelPattern, DEFAULT_IMAGE_QUESTION_LABEL_PATTERN];
    const xPadding = parserProfile?.name === 'nuclear' ? 180 : 80;
    const bottomPadding = parserProfile?.name === 'nuclear' ? 90 : 50;
    const topPadding = parserProfile?.name === 'nuclear' ? 50 : 30;

    const containedText = textItems
        .filter(item => {
            const txCenter = item.x + item.width / 2;
            const tyCenter = item.y + item.height / 2;
            return (
                txCenter >= rect.x &&
                txCenter <= rect.x + rect.w &&
                tyCenter >= rect.y &&
                tyCenter <= rect.y + rect.h
            );
        })
        .map(item => item.text)
        .join(' ');
    const containedMatch = extractQuestionNumberFromText(containedText, patterns);
    if (containedMatch !== null) {
        return containedMatch;
    }

    const nearbyItems = textItems.filter(item => {
        const txCenter = item.x + item.width / 2;
        const tyCenter = item.y + item.height / 2;
        return (
            txCenter >= rect.x - xPadding &&
            txCenter <= rect.x + rect.w + xPadding &&
            tyCenter >= rect.y - topPadding &&
            tyCenter <= rect.y + rect.h + bottomPadding
        );
    });

    const nearbyLines = buildTextLinesFromItems(nearbyItems);
    for (const line of nearbyLines) {
        const matched = extractQuestionNumberFromText(line.text, patterns);
        if (matched !== null) {
            return matched;
        }
    }

    return null;
};

const buildTextItemKey = (item) => `${item.pageNum}_${item.x}_${item.y}_${item.text.trim()}`;

const stripFooterSuffix = (text) => text.replace(FOOTER_PAGE_SUFFIX_PATTERN, '').trim();

const canonicalizeOptionKey = (key) => {
    const normalized = String(key || '').trim();
    const map = {
        a: 'a', A: 'a', ａ: 'a', Ａ: 'a',
        b: 'b', B: 'b', ｂ: 'b', Ｂ: 'b',
        c: 'c', C: 'c', ｃ: 'c', Ｃ: 'c',
        d: 'd', D: 'd', ｄ: 'd', Ｄ: 'd',
        e: 'e', E: 'e', ｅ: 'e', Ｅ: 'e',
    };
    return map[normalized] || normalized.toLowerCase();
};

const normalizeQuestionOptions = (options) => {
    const source = options && typeof options === 'object' ? options : {};
    const normalizedEntries = {};
    Object.entries(source).forEach(([key, value]) => {
        normalizedEntries[canonicalizeOptionKey(key)] = value;
    });
    return {
        a: normalizedEntries.a ?? '',
        b: normalizedEntries.b ?? '',
        c: normalizedEntries.c ?? '',
        d: normalizedEntries.d ?? '',
        e: normalizedEntries.e ?? '',
    };
};

const getFilledOptionCount = (options) => {
    const normalized = normalizeQuestionOptions(options);
    return Object.values(normalized).filter(value => String(value || '').trim().length > 0).length;
};

const GLUED_QUESTION_UNIT_PREFIX = /^(?:mSv|Sv|Gy|mGy|cGy|mm|cm|mL|kg|%|歳|年|か月|ヶ月|月|日|週|時間|min|hr)\b/i;
const PLAIN_NUMBER_QUESTION_DISQUALIFIER = /^(?:[a-eA-Eａ-ｅＡ-Ｅ][\.．\s\)）]|mSv|Sv|Gy|mGy|cGy|mm|cm|mL|kg|%|歳|年|か月|ヶ月|月|日|週|時間|min|hr)\b/i;
const PLAIN_NUMBER_QUESTION_HINT = /(?:次の|以下|最も|正しい|誤って|適切|どれか|選べ|患者|症例|図|画像|所見|疾患|診断|治療|検査|読影|について|に関して|Which|What|Choose|Select|Regarding|About)/i;
const SELECTION_COUNT_LINE_PATTERN = /^[0-9０-９]+\s*つ選べ(?:。)?$/;
const QUESTION_RANGE_HEADER_PATTERN = /^問\s*[0-9０-９]{1,3}\s*[～~〜-]\s*[0-9０-９]{1,3}\s*(?:が|は)/;
const LEADING_COUNTER_CONTINUATION_PATTERN = /^(?:つ(?:選べ)?|本|個|枚|回|例|人|台|枝|歳|年|か月|ヶ月|月|日|週|時間|min|hr)(?:$|\s|の|を|は|で|に)/i;
const IVR_SECTION_TRANSITION_PATTERN = /(?:共通問題は以上です|次ページ以降も解答してください|IVR専門医試験受験者)/;

const parseQuestionStartText = (lineText, questionPattern) => {
    const normalizedLineText = String(lineText || '').replace(/\s+/g, ' ').trim();
    if (!normalizedLineText) {
        return null;
    }

    if (SELECTION_COUNT_LINE_PATTERN.test(normalizedLineText) || QUESTION_RANGE_HEADER_PATTERN.test(normalizedLineText)) {
        return null;
    }

    const standardMatch = lineText.match(questionPattern);
    if (standardMatch) {
        const qNum = parseInt(standardMatch[1] || standardMatch[2], 10);
        const questionText = lineText.substring(standardMatch[0].length).trim();
        if (!questionText || /^[～~〜-]/.test(questionText)) {
            return null;
        }
        return {
            qNum,
            questionText,
        };
    }

    const gluedMatch = lineText.match(/^\s*(\d{1,3})(?=[A-Za-z(（［【])/);
    if (gluedMatch) {
        const trailingText = lineText.substring(gluedMatch[0].length).trim();
        if (GLUED_QUESTION_UNIT_PREFIX.test(trailingText)) {
            return null;
        }
        return {
            qNum: parseInt(gluedMatch[1], 10),
            questionText: trailingText,
        };
    }

    const spacedMatch = lineText.match(/^\s*(\d{1,3})\s+(.+)$/);
    if (spacedMatch) {
        const trailingText = spacedMatch[2].trim();
        if (
            !trailingText
            || PLAIN_NUMBER_QUESTION_DISQUALIFIER.test(trailingText)
            || SELECTION_COUNT_LINE_PATTERN.test(normalizedLineText)
            || LEADING_COUNTER_CONTINUATION_PATTERN.test(trailingText)
        ) {
            return null;
        }
        if (!PLAIN_NUMBER_QUESTION_HINT.test(trailingText) && trailingText.length < 12) {
            return null;
        }
        return {
            qNum: parseInt(spacedMatch[1], 10),
            questionText: trailingText,
        };
    }

    return null;
};

const detectFirstQuestionPage = (lines, parserProfile) => {
    const questionLineIndex = lines.findIndex(line => {
        const parsed = parseQuestionStartText(line.text, parserProfile.questionPattern);
        if (!parsed) return false;
        return parsed.qNum === 1 && line.text.length >= parserProfile.minQuestionLineLength;
    });

    if (questionLineIndex === -1) return false;

    if (parserProfile.name !== 'ivr') return true;

    const tailLines = lines.slice(questionLineIndex);
    const optionCount = tailLines.filter(line => parserProfile.optionPattern.test(line.text)).length;
    return optionCount >= 1;
};

// 画像の境界とテキスト要素のリストからレジェンドを抽出する関数
// limits: { leftLimit, rightLimit, topLimit, bottomLimit } を受け取り、探索範囲を制限する
const extractLegendForImage = (rect, textItems, limits = {}, allPageTextItems = [], parserProfile = null) => {
    const origMinX = rect.x;
    const origMinY = rect.y;
    const origMaxX = rect.x + rect.w;
    const origMaxY = rect.y + rect.h;

    const imageWidth = origMaxX - origMinX;
    const preferTopLegend = parserProfile?.name === 'nuclear';

    // X軸の探索マージン (左右)
    const xMargin = Math.max(15, Math.min(50, imageWidth * 0.1));
    let searchMinX = origMinX - xMargin;
    let searchMaxX = origMaxX + xMargin;

    // 隣接画像との干渉限界（limits）による探索範囲の制限
    if (limits.leftLimit !== undefined) {
        searchMinX = Math.max(searchMinX, limits.leftLimit);
    }
    if (limits.rightLimit !== undefined) {
        searchMaxX = Math.min(searchMaxX, limits.rightLimit);
    }

    // Y軸の探索マージン (上下)
    const searchMarginY = parserProfile?.name === 'nuclear' ? 70 : 150;
    const yTolerance = 5;

    // Y軸方向の探索限界のクランプ
    let searchMaxYLimit = origMinY - searchMarginY;
    if (limits.bottomLimit !== undefined) {
        searchMaxYLimit = Math.max(searchMaxYLimit, limits.bottomLimit);
    }
    
    let searchMinYLimit = origMaxY + searchMarginY;
    if (limits.topLimit !== undefined) {
        searchMinYLimit = Math.min(searchMinYLimit, limits.topLimit);
    }

    const collectLegendLines = (items, direction = 'down') => {
        if (items.length === 0) return { lines: [], used: [] };

        const sortedItems = [...items].sort((a, b) => direction === 'down' ? b.y - a.y : a.y - b.y);
        let currentY = sortedItems[0].y;
        let cumulativeHeight = 0;
        const lines = [];
        const used = [];

        while (currentY && cumulativeHeight < 80) {
            const lineItems = items.filter(item => Math.abs(item.y - currentY) <= yTolerance);
            if (lineItems.length === 0) break;

            lineItems.sort((a, b) => a.x - b.x);
            const lineText = lineItems.map(t => t.text).join(' ').trim();
            if (lineText && isValidLegendText(lineText, lineItems[0], allPageTextItems)) {
                lines.push(lineText);
                lineItems.forEach(item => used.push(item));
            }

            const nextCandidates = items.filter(item => (
                direction === 'down'
                    ? item.y < (currentY - yTolerance)
                    : item.y > (currentY + yTolerance)
            ));

            if (nextCandidates.length === 0) break;

            nextCandidates.sort((a, b) => direction === 'down' ? b.y - a.y : a.y - b.y);
            const nextY = nextCandidates[0].y;
            const gap = Math.abs(currentY - nextY);
            if (gap > 25) break;
            cumulativeHeight += gap;
            currentY = nextY;
        }

        return { lines, used };
    };

    // --- 1. メインタイトルの探索 ---
    let mainTitle = '';
    const usedItems = [];
    
    // (a) 画像直下の探索
    const textBelow = textItems.filter(item => {
        const tyCenter = item.y + item.height / 2;
        const txCenter = item.x + item.width / 2;
        const yMatch = tyCenter < (origMinY + 10) && tyCenter >= searchMaxYLimit;
        const xMatch = txCenter >= searchMinX && txCenter <= searchMaxX;
        return yMatch && xMatch;
    });

    const belowResult = collectLegendLines(textBelow, 'down');
    const belowLines = preferTopLegend ? [] : belowResult.lines;

    // (b) 画像直上の探索
    let aboveLines = [];
    const textAbove = textItems.filter(item => {
        const tyCenter = item.y + item.height / 2;
        const txCenter = item.x + item.width / 2;
        const yMatch = tyCenter > (origMaxY - 10) && tyCenter <= searchMinYLimit;
        const xMatch = txCenter >= searchMinX && txCenter <= searchMaxX;
        return yMatch && xMatch;
    });
    const aboveResult = collectLegendLines(textAbove, 'up');
    aboveLines = aboveResult.lines;

    // 複数行を結合してメインタイトルを作成
    if (preferTopLegend && aboveLines.length > 0) {
        mainTitle = aboveLines.join(' ');
        aboveResult.used.forEach(item => usedItems.push(item));
    } else if (!preferTopLegend && belowLines.length > 0) {
        mainTitle = belowLines.join(' ');
        belowResult.used.forEach(item => usedItems.push(item));
    } else if (aboveLines.length > 0) {
        mainTitle = aboveLines.join(' ');
        aboveResult.used.forEach(item => usedItems.push(item));
    }

    const pickSideLegend = (side = 'right') => {
        const sideMarginX = Math.max(50, Math.min(150, imageWidth * 0.35));
        const candidates = textItems.filter(item => {
            const txCenter = item.x + item.width / 2;
            const tyCenter = item.y + item.height / 2;
            const xMatch = side === 'right'
                ? txCenter >= origMaxX && txCenter <= (origMaxX + sideMarginX)
                : txCenter <= origMinX && txCenter >= (origMinX - sideMarginX);
            const yMatch = tyCenter >= (origMinY - 20) && tyCenter <= (origMaxY + 20);
            return xMatch && yMatch;
        });

        if (candidates.length === 0) return null;

        const linesMap = new Map();
        candidates.forEach(item => {
            const lineKey = Math.round(item.y / 3) * 3;
            const existing = linesMap.get(lineKey) || [];
            existing.push(item);
            linesMap.set(lineKey, existing);
        });

        const lines = Array.from(linesMap.values())
            .map(lineItems => {
                const sorted = [...lineItems].sort((a, b) => a.x - b.x);
                const lineText = sorted.map(t => t.text).join(' ').trim();
                return { lineItems: sorted, lineText };
            })
            .filter(({ lineText, lineItems }) => lineText && isValidLegendText(lineText, lineItems[0], allPageTextItems))
            .sort((a, b) => {
                const aOrientation = IMAGE_ORIENTATION_LABEL_PATTERN.test(a.lineText) ? 1 : 0;
                const bOrientation = IMAGE_ORIENTATION_LABEL_PATTERN.test(b.lineText) ? 1 : 0;
                if (aOrientation !== bOrientation) return bOrientation - aOrientation;
                return a.lineItems[0].y - b.lineItems[0].y;
            });

        return lines[0] || null;
    };

    if (!mainTitle) {
        const preferredOrder = preferTopLegend ? ['left', 'right'] : ['right', 'left'];
        for (const side of preferredOrder) {
            const picked = pickSideLegend(side);
            if (!picked) continue;
            mainTitle = picked.lineText;
            picked.lineItems.forEach(item => usedItems.push(item));
            break;
        }
    }

    // --- 2. 四辺および内部の記述子（ラベル）の回収 ---
    const descriptorsSet = new Set();
    const shortLabelLimit = 15; // 記述子とする最大文字数

    const usedWords = mainTitle ? mainTitle.split(/\s+/) : [];
    
    // (a) 画像の外側近傍 (上下20px, 左右40pxに制限し、隣接画像との干渉限界 limits でX座標を制限)
    const marginY = parserProfile?.name === 'nuclear' ? 12 : 20;
    const marginX = parserProfile?.name === 'nuclear'
        ? Math.max(24, Math.min(72, imageWidth * 0.15))
        : Math.max(40, Math.min(120, imageWidth * 0.25));
    
    let descMinX = origMinX - marginX;
    let descMaxX = origMaxX + marginX;
    let descMinY = origMinY - marginY;
    let descMaxY = origMaxY + marginY;

    if (limits.leftLimit !== undefined) {
        descMinX = Math.max(descMinX, limits.leftLimit);
    }
    if (limits.rightLimit !== undefined) {
        descMaxX = Math.min(descMaxX, limits.rightLimit);
    }
    if (limits.bottomLimit !== undefined) {
        descMinY = Math.max(descMinY, limits.bottomLimit);
    }
    if (limits.topLimit !== undefined) {
        descMaxY = Math.min(descMaxY, limits.topLimit);
    }

    const outsideText = textItems.filter(item => {
        const txCenter = item.x + item.width / 2;
        const tyCenter = item.y + item.height / 2;
        const inExtendedX = txCenter >= descMinX && txCenter <= descMaxX;
        const inExtendedY = tyCenter >= descMinY && tyCenter <= descMaxY;
        const isInside = txCenter >= origMinX && txCenter <= origMaxX && tyCenter >= origMinY && tyCenter <= origMaxY;
        return inExtendedX && inExtendedY && !isInside;
    });

    // 画像オブジェクト枠内（内部）のテキストは測定数値（7mm等）を含みやすいため除外し、
    // 画像の外側近傍のみを探索範囲とする
    const labelCandidates = outsideText;

    const orientationDescriptors = [];
    const genericDescriptors = [];

    labelCandidates.forEach(item => {
        const text = item.text.trim();
        if (text.length > 0 && text.length <= shortLabelLimit) {
            if (WEAK_IMAGE_DESCRIPTOR_PATTERN.test(text)) {
                return;
            }

            const isOrientationLabel = IMAGE_ORIENTATION_LABEL_PATTERN.test(text);
            const isLabelLike = /^[a-zA-Z0-9-+\s()\/]+$/.test(text) || 
                                /^(?:右|左|前|後|上|下|側面|正面|前面|後面|造影|シネ|遅延|早期|矢状|横断|冠状|エコー|シンチ|図|表|画像|負荷|安静|運動|ストレス|レスト)(?:時|像)?\d*$/i.test(text) ||
                                /^(?:anterior|posterior|lateral|coronal|sagittal|transverse|axial|min|hour|hr|sec|iv|pre|post|delay|early|Right|Left|L|R|A|P|H|F|sup|inf)\d*$/i.test(text);

            if (NO_QUESTION_LABEL_PATTERN.test(text)) {
                return;
            }

            if (isLabelLike && !usedWords.includes(text) && !mainTitle.includes(text)) {
                if (isOrientationLabel) {
                    orientationDescriptors.push(text);
                } else {
                    genericDescriptors.push(text);
                }
                usedItems.push(item);
            }
        }
    });

    const descriptorSource = orientationDescriptors.length > 0 ? orientationDescriptors : genericDescriptors;
    descriptorSource.forEach(text => descriptorsSet.add(text));
    const descriptors = Array.from(descriptorsSet);

    let finalLegend = mainTitle.trim();
    if (descriptors.length > 0) {
        const descString = descriptors.join(', ');
        if (finalLegend) {
            finalLegend = `${finalLegend} (${descString})`;
        } else {
            finalLegend = descString;
        }
    }

    return {
        legendStr: finalLegend,
        usedItems: usedItems
    };
};

export default function AdminPage() {
    const router = useRouter();

    // --- PDF Parser State Vars ---
    const [localExams, setLocalExams] = useState([]);
    const [isParsingPdf, setIsParsingPdf] = useState(false);
    const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, status: '' });
    const [parsedQuestions, setParsedQuestions] = useState([]);
    const [parsedYearInput, setParsedYearInput] = useState('');
    const [imageMap, setImageMap] = useState({});
    const [errorMsg, setErrorMsg] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [examId, setExamId] = useState('');
    const [examName, setExamName] = useState('');
    const [previewImageModal, setPreviewImageModal] = useState(null);
    const [importMode, setImportMode] = useState('new'); // 'new' or 'existing'
    const [examCategory, setExamCategory] = useState('1'); // '1': 放射線科, '2': 放射線診断, '3': 核医学, '4': IVR
    const [activeTab, setActiveTab] = useState('import'); // 'import', 'manage'
    const [editingExamId, setEditingExamId] = useState('');
    const [editingExamName, setEditingExamName] = useState('');
    const [editingQuestions, setEditingQuestions] = useState([]);
    const [editingYearFilter, setEditingYearFilter] = useState('all');
    const [nuclearVlmEnabled, setNuclearVlmEnabled] = useState(true);
    const [nuclearVlmStatus, setNuclearVlmStatus] = useState({
        state: 'unchecked',
        model: 'qwen3-vl:2b-instruct',
        message: '未確認'
    });

    const loadLocalExams = async () => {
        await initializeLocalExams();
        const exams = getExamTypes();
        setLocalExams(exams);
    };

    useEffect(() => {
        loadLocalExams();
    }, []);

    useEffect(() => {
        if (!previewImageModal) return undefined;

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                setPreviewImageModal(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [previewImageModal]);

    const checkNuclearVlmStatus = async () => {
        setNuclearVlmStatus(prev => ({ ...prev, state: 'checking', message: 'Ollamaを確認中...' }));
        try {
            const response = await fetch('/api/nuclear-vlm', { cache: 'no-store' });
            const payload = await response.json();
            const nextStatus = {
                state: payload.available ? 'ready' : 'unavailable',
                model: payload.model || 'qwen3-vl:2b-instruct',
                message: payload.message || 'VLMの状態を確認できませんでした。'
            };
            setNuclearVlmStatus(nextStatus);
            return payload;
        } catch (error) {
            const nextStatus = {
                state: 'unavailable',
                model: 'qwen3-vl:2b-instruct',
                message: `VLM接続確認に失敗しました: ${error.message}`
            };
            setNuclearVlmStatus(nextStatus);
            return { available: false, ...nextStatus };
        }
    };

    const handleImageChange = (questionIndex, file) => {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const imagePath = event.target?.result;
            if (typeof imagePath !== 'string') return;

            setImageMap((prev) => {
                const currentImages = prev[questionIndex] || [];
                return {
                    ...prev,
                    [questionIndex]: [
                        ...currentImages,
                        {
                            path: imagePath,
                            legend: `図${currentImages.length + 1}`,
                        },
                    ],
                };
            });
        };
        reader.onerror = (error) => {
            console.error('Image load error:', error);
            setErrorMsg('画像の読み込みに失敗しました。');
        };
        reader.readAsDataURL(file);
    };

    const handleRemoveImage = (questionIndex, imageIndex) => {
        setImageMap((prev) => {
            const currentImages = prev[questionIndex] || [];
            const nextImages = currentImages.filter((_, idx) => idx !== imageIndex);
            if (nextImages.length === 0) {
                const { [questionIndex]: _removed, ...rest } = prev;
                return rest;
            }
            return {
                ...prev,
                [questionIndex]: nextImages,
            };
        });
    };

    const loadExamForEditing = async (exam) => {
        try {
            const questions = await getLocalExam(exam.id);
            const normalizedQuestions = questions.map((q, index) => {
                const year = Number(q.year) || new Date().getFullYear();
                const questionNumber = Number(q.questionNumber ?? String(q.id ?? '').slice(-3) ?? index + 1) || (index + 1);
                const id = buildQuestionId(year, questionNumber);
                return {
                    id,
                    year,
                    questionNumber,
                    genre: q.genre || '',
                    question: q.question || '',
                    options: normalizeQuestionOptions(q.options),
                    answer: q.answer || '',
                    explanation: q.explanation || '',
                    images: Array.isArray(q.images) ? q.images.map((img, imgIdx) => ({
                        path: img.path || 'image_placeholder',
                        legend: img.legend ?? `図${imgIdx + 1}`,
                        storageKey: img.storageKey || '',
                    })) : [],
                };
            });

            setEditingExamId(exam.id);
            setEditingExamName(exam.name);
            setEditingQuestions(normalizedQuestions);
            const availableYears = [...new Set(normalizedQuestions.map(q => Number(q.year)).filter(Boolean))].sort((a, b) => b - a);
            setEditingYearFilter(availableYears[0] ? String(availableYears[0]) : 'all');
            setSuccessMsg(`試験「${exam.name}」を編集モードで読み込みました。`);
            setErrorMsg('');
        } catch (e) {
            console.error(e);
            setErrorMsg(`試験データの読み込みに失敗しました: ${e.message}`);
        }
    };

    const updateEditingQuestion = (questionIndex, updater) => {
        setEditingQuestions((prev) => prev.map((question, index) => (
            index === questionIndex ? updater(question) : question
        )));
    };

    const handleEditingQuestionMetaChange = (questionIndex, field, value) => {
        updateEditingQuestion(questionIndex, (question) => {
            const nextQuestion = {
                ...question,
                [field]: value,
            };
            const nextYear = field === 'year' ? Number(value) || question.year : question.year;
            const nextQuestionNumber = field === 'questionNumber' ? Number(value) || question.questionNumber : question.questionNumber;
            return {
                ...nextQuestion,
                year: nextYear,
                questionNumber: nextQuestionNumber,
                id: buildQuestionId(nextYear, nextQuestionNumber),
            };
        });
    };

    const handleEditingQuestionFieldChange = (questionIndex, field, value) => {
        updateEditingQuestion(questionIndex, (question) => ({
            ...question,
            [field]: value,
        }));
    };

    const handleEditingOptionChange = (questionIndex, optionKey, value) => {
        updateEditingQuestion(questionIndex, (question) => ({
            ...question,
            options: {
                ...question.options,
                [optionKey]: value,
            },
        }));
    };

    const handleEditingImageLegendChange = (questionIndex, imageIndex, value) => {
        updateEditingQuestion(questionIndex, (question) => ({
            ...question,
            images: question.images.map((image, idx) => (
                idx === imageIndex ? { ...image, legend: value } : image
            )),
        }));
    };

    const handleEditingImageAdd = (questionIndex, file) => {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const imagePath = event.target?.result;
            if (typeof imagePath !== 'string') return;

            updateEditingQuestion(questionIndex, (question) => ({
                ...question,
                images: [
                    ...question.images,
                    {
                        path: imagePath,
                        legend: `図${question.images.length + 1}`,
                    },
                ],
            }));
        };
        reader.onerror = (error) => {
            console.error('Editing image load error:', error);
            setErrorMsg('画像の読み込みに失敗しました。');
        };
        reader.readAsDataURL(file);
    };

    const handleEditingImageRemove = (questionIndex, imageIndex) => {
        updateEditingQuestion(questionIndex, (question) => ({
            ...question,
            images: question.images.filter((_, idx) => idx !== imageIndex),
        }));
    };

    const handleParsedQuestionsYearChange = (value) => {
        setParsedYearInput(value);

        if (!/^\d{4}$/.test(value)) {
            return;
        }

        const numericYear = Number(value);
        setParsedQuestions((prev) => prev.map((question) => ({
            ...question,
            year: numericYear,
            id: buildQuestionId(numericYear, question.questionNumber),
        })));
    };

    const handleAddEditingQuestion = () => {
        const currentYear = editingQuestions[0]?.year || new Date().getFullYear();
        const nextQuestionNumber = editingQuestions.reduce((max, question) => (
            Math.max(max, Number(question.questionNumber) || 0)
        ), 0) + 1;

        setEditingQuestions((prev) => [
            ...prev,
            {
                id: buildQuestionId(currentYear, nextQuestionNumber),
                year: currentYear,
                questionNumber: nextQuestionNumber,
                genre: '',
                question: '',
                options: { a: '', b: '', c: '', d: '', e: '' },
                answer: '',
                explanation: '',
                images: [],
            },
        ]);
    };

    const handleDeleteEditingQuestion = (questionIndex) => {
        if (!confirm('この問題を削除しますか？')) return;
        setEditingQuestions((prev) => prev.filter((_, index) => index !== questionIndex));
    };

    const handleSaveEditedExam = async () => {
        if (!editingExamId || !editingExamName.trim()) {
            setErrorMsg('編集対象の試験IDと試験名が必要です。');
            return;
        }

        try {
            await saveLocalExam(editingExamId, editingExamName, editingQuestions, false);
            await initializeLocalExams(true);
            await loadLocalExams();
            setSuccessMsg(`試験「${editingExamName}」の編集内容を保存しました。`);
        } catch (e) {
            console.error(e);
            setErrorMsg(`編集内容の保存に失敗しました: ${e.message}`);
        }
    };

    const handlePdfImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsParsingPdf(true);
        setErrorMsg('');
        setSuccessMsg('');
        setPdfProgress({ current: 0, total: 0, status: 'PDFファイルを読み込んでいます...' });

        try {
            const parserProfile = getPdfParserProfile(examCategory);
            let nuclearVlmReady = false;
            let nuclearVlmPageCount = 0;
            let nuclearVlmFailureCount = 0;
            let nuclearVlmConsecutiveFailureCount = 0;
            let nuclearVlmPartialPageCount = 0;
            let nuclearRuleFallbackPageCount = 0;

            if (parserProfile.name === 'nuclear' && nuclearVlmEnabled) {
                setPdfProgress({ current: 0, total: 0, status: 'ローカルVLMの接続とモデルを確認中...' });
                const status = await checkNuclearVlmStatus();
                nuclearVlmReady = Boolean(status.available);
            }

            // pdfjs-dist の ESM モジュールを動的インポート
            const pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({
                data: arrayBuffer,
                cMapUrl: '/cmaps/',
                cMapPacked: true,
                standardFontDataUrl: '/standard_fonts/',
                wasmUrl: '/'
            });

            const pdf = await loadingTask.promise;
            const totalPages = pdf.numPages;
            setPdfProgress({ current: 0, total: totalPages, status: `PDFを解析中 (全 ${totalPages} ページ)...` });

            // -------------------------------------------------------------
            // A. PDFから「年度」および「最初の問題開始ページ」をスキャン・同定
            // -------------------------------------------------------------
            let detectedYear = new Date().getFullYear();
            let firstQuestionPage = parserProfile.fixedFirstQuestionPage || 1;
            let foundFirstPage = Boolean(parserProfile.fixedFirstQuestionPage);

            const questionPattern = parserProfile.questionPattern;
            const quizStartHeaderPattern = /(?:第\s*\d+\s*回[\s　]*[^\n]*(?:試験問題|筆記|試験)|放射線科専門医認定試験|核医学専門医試験|筆記試験)/i;

            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                try {
                    const page = await pdf.getPage(pageNum);
                    const textContent = await page.getTextContent();
                    const textStr = textContent.items.map(item => item.str).join(' ');
                    const scanTextItems = textContent.items.map(item => ({
                        text: item.str,
                        x: item.transform[4],
                        y: item.transform[5],
                    }));
                    const scanLines = buildTextLinesFromItems(scanTextItems);

                    // 1. 年度自動検出 (最初の3ページのみ)
                    if (pageNum <= 3) {
                        const yearMatch = textStr.match(/(20[2-9]\d)[\s　]*(?:年|年度)/);
                        if (yearMatch) {
                            detectedYear = parseInt(yearMatch[1]);
                        } else {
                            const reiwaMatch = textStr.match(/令和\s*(\d+)[\s　]*年/);
                            if (reiwaMatch) {
                                const rYear = parseInt(reiwaMatch[1]);
                                detectedYear = 2018 + rYear;
                            }
                        }
                    }

                    // 2. 問題開始ページ (firstQuestionPage) の検出
                    if (!foundFirstPage) {
                        if (detectFirstQuestionPage(scanLines, parserProfile)) {
                            firstQuestionPage = pageNum;
                            foundFirstPage = true;
                        }
                    }
                } catch (err) {
                    console.error(`Error scanning page ${pageNum} for year/page:`, err);
                }
            }

            const rawPagesTextData = [];

            // 1. 【第1パス】各ページからテキストコンテンツのみを抽出
            for (let pageNum = firstQuestionPage; pageNum <= totalPages; pageNum++) {
                setPdfProgress(prev => ({ ...prev, status: `ページ ${pageNum}/${totalPages} のテキストを読み込み中...` }));
                const page = await pdf.getPage(pageNum);
                const textContent = await page.getTextContent();
                const textItems = textContent.items.map(item => ({
                    text: item.str,
                    x: item.transform[4],
                    y: item.transform[5],
                    width: item.width || (item.str.length * (item.height || item.transform[3] || 10) * 0.8),
                    height: item.height || item.transform[3] || 0,
                    pageNum: pageNum
                }));

                rawPagesTextData.push({
                    pageNum,
                    textItems
                });
            }
            // 2. 問題分割ロジック
            setPdfProgress(prev => ({ ...prev, status: '問題の分割処理を行っています...' }));
            let parsedQuestionsList = [];

            let currentQuestion = null;
            const extractLegendsRuleBased = (questionText, imgCount) => {
                const legends = [];
                // 医学画像モダリティや撮像法に関するキーワードパターン
                const pattern = /([A-Za-z0-9亜-熙ぁ-んァ-ヶ\-\s]+?(?:強調横断像|強調像|T1強調|T2強調|FLAIR|DWI|ADC|MRA|CT|MRI|シンチ|造影|X線|レントゲン|血管造影|超音波|エコー)(?:\s*[A-Z]|\s*[0-9]+)?)/gi;
                
                let match;
                const matches = [];
                const seenText = new Set();
                
                while ((match = pattern.exec(questionText)) !== null) {
                    const text = match[1].trim();
                    if (text.length >= 3 && text.length < 30 && 
                        !text.includes('示す') && !text.includes('どれか') && 
                        !text.includes('選べ') && !text.includes('診断') && !text.includes('疾患')) {
                        
                        if (!seenText.has(text)) {
                            seenText.add(text);
                            matches.push(text);
                        }
                    }
                }

                for (let i = 0; i < imgCount; i++) {
                    if (matches[i]) {
                        legends.push({ legend: matches[i] });
                    } else {
                        let guess = '画像';
                        const lowerText = questionText.toLowerCase();
                        if (lowerText.includes('mri')) guess = 'MRI像';
                        else if (lowerText.includes('ct')) guess = 'CT像';
                        else if (lowerText.includes('シンチ') || lowerText.includes('scintigraphy')) guess = 'シンチグラフィ';
                        else if (lowerText.includes('造影') || lowerText.includes('angiography')) guess = '造影写真';
                        else if (lowerText.includes('超音波') || lowerText.includes('エコー') || lowerText.includes('ultrasound')) guess = '超音波像';
                        else if (lowerText.includes('x線') || lowerText.includes('レントゲン') || lowerText.includes('radiograph')) guess = 'X線写真';
                        
                        legends.push({ legend: `${guess}${i + 1}` });
                    }
                }
                return legends;
            };

            const addPageImage = (q, img) => {
                if (!q) return;
                if (!q.pageImages.some(existing => existing.path === img.path)) {
                    q.pageImages.push(img);
                }
            };

            const parseQuestionStart = (lineText) => parseQuestionStartText(lineText, questionPattern);

            const buildLineText = (line) => {
                if (line.length === 0) return '';
                const heights = line.map(item => item.height || 0).filter(h => h > 0);
                if (heights.length === 0) {
                    return line.map(item => item.text).join('');
                }
                const normalHeight = Math.max(...heights);
                const normalYItems = line.filter(item => Math.abs((item.height || 0) - normalHeight) < 2);
                const normalY = normalYItems.length > 0 
                    ? normalYItems.reduce((sum, item) => sum + item.y, 0) / normalYItems.length
                    : line[0].y;

                return line.map(item => {
                    const text = item.text;
                    if (!text.trim()) return text;
                    const itemHeight = item.height || 0;
                    const itemY = item.y;
                    const diffY = itemY - normalY;
                    
                    // 上付き・下付き判定のしきい値調整
                    // 高さが標準の 90% 未満、または Y座標のズレが標準の 15% 以上の場合
                    const isSizeSmaller = normalHeight > 4 && (itemHeight / normalHeight < 0.85);
                    const isPosShifted = Math.abs(diffY) > 1.5;

                    if (isSizeSmaller && isPosShifted && text.length < 10) {
                        if (diffY > 1.0) {
                            return `<sup>${text}</sup>`;
                        } else if (diffY < -1.0) {
                            return `<sub>${text}</sub>`;
                        }
                    }
                    return text;
                }).join('');
            };

            const populateQuestionOptionsAndText = (questionList) => {
                questionList.forEach(q => {
                    let optionsStarted = false;
                    let lastOptionKey = '';
                    const cleanQuestionLines = [];
                    q.options = {};
                    q.finalUsedLines = [];

                    q.rawTextLines.forEach((lineStr, idx) => {
                        const originalLine = q.usedLines[idx];
                        const trimmed = String(lineStr || '').trim();
                        if (!trimmed) return;

                        const match = trimmed.match(optionPattern);
                        if (match) {
                            optionsStarted = true;
                            const optKey = canonicalizeOptionKey(trimmed[0][0]);
                            const optText = trimmed.substring(match[0].length).trim();
                            q.options[optKey] = optText;
                            lastOptionKey = optKey;
                            if (originalLine) q.finalUsedLines.push(originalLine);
                            return;
                        }

                        if (optionsStarted) {
                            const isFooter = FOOTER_PAGE_PATTERN.test(trimmed);
                            const isLegendLike = /(CT|MRI|像|写真|図|シンチ|造影|エコー|DWI|FLAIR|PET)/i.test(trimmed);

                            if (isFooter || isLegendLike || lastOptionKey === 'e') {
                                return;
                            }

                            if (lastOptionKey) {
                                q.options[lastOptionKey] += ` ${trimmed}`;
                                if (originalLine) q.finalUsedLines.push(originalLine);
                            }
                            return;
                        }

                        cleanQuestionLines.push(lineStr);
                        if (originalLine) q.finalUsedLines.push(originalLine);
                    });

                    q.question = cleanQuestionLines.join('\n').trim();
                });
            };

            const buildFallbackQuestionsFromSimpleLines = () => {
                const fallbackQuestions = [];
                let fallbackCurrentQuestion = null;

                rawPagesTextData.forEach((page) => {
                    const pageLines = buildTextLineEntriesFromItems(page.textItems);
                    pageLines.forEach(({ items, text, y }) => {
                        let lineText = buildInlineTextFromItems(items) || text;
                        lineText = stripFooterSuffix(String(lineText || '').trim());

                        if (!lineText) return;
                        if (FOOTER_PAGE_PATTERN.test(lineText)) return;

                        const parsedStart = parseQuestionStart(lineText);
                        if (parsedStart) {
                            const qNum = parsedStart.qNum;
                            const isSequential = !fallbackCurrentQuestion || qNum > fallbackCurrentQuestion.questionNumber;
                            if (qNum >= 1 && qNum <= parserProfile.maxQuestionNumber && isSequential) {
                                if (fallbackCurrentQuestion) {
                                    fallbackQuestions.push(fallbackCurrentQuestion);
                                }
                                fallbackCurrentQuestion = {
                                    id: qNum,
                                    questionNumber: qNum,
                                    rawQuestionNumber: qNum,
                                    question: parsedStart.questionText,
                                    options: {},
                                    images: [],
                                    rawTextLines: [parsedStart.questionText],
                                    pageImages: [],
                                    startPage: page.pageNum,
                                    anchorY: y,
                                    usedLines: [items]
                                };
                                return;
                            }
                        }

                        if (!fallbackCurrentQuestion) return;
                        fallbackCurrentQuestion.rawTextLines.push(lineText);
                        fallbackCurrentQuestion.question += `\n${lineText}`;
                        fallbackCurrentQuestion.usedLines.push(items);
                    });
                });

                if (fallbackCurrentQuestion) {
                    fallbackQuestions.push(fallbackCurrentQuestion);
                }

                populateQuestionOptionsAndText(fallbackQuestions);
                const qualifiedFallbackQuestions = fallbackQuestions.filter(q => getFilledOptionCount(q.options) >= parserProfile.minOptionCount);
                if (qualifiedFallbackQuestions.length > 0) {
                    return qualifiedFallbackQuestions;
                }
                return fallbackQuestions.filter(q => String(q.question || '').trim().length > 0);
            };

            let ivrQuestionNumberOffset = 0;
            let ivrSectionTransitionPending = false;

            rawPagesTextData.forEach((page) => {
                // 1. 各テキストアイテムから、標準サイズに近い文字（ベースライン候補）のY座標を集める
                const heights = page.textItems.map(item => item.height || 0).filter(h => h > 0);
                const maxPercentileHeight = heights.length > 0 ? Math.max(...heights) : 10;
                
                const baselineCandidates = page.textItems.filter(item => {
                    const h = item.height || 0;
                    return h > 0 && (h / maxPercentileHeight >= 0.8);
                });

                const baselines = [];
                const sortedCandidates = [...baselineCandidates].sort((a, b) => b.y - a.y);
                
                sortedCandidates.forEach(item => {
                    const closeBaseline = baselines.find(b => Math.abs(b.y - item.y) < 4);
                    if (closeBaseline) {
                        closeBaseline.items.push(item);
                        closeBaseline.y = closeBaseline.items.reduce((sum, it) => sum + it.y, 0) / closeBaseline.items.length;
                    } else {
                        baselines.push({
                            y: item.y,
                            items: [item]
                        });
                    }
                });

                if (baselines.length === 0 && page.textItems.length > 0) {
                    const sortedAll = [...page.textItems].sort((a, b) => b.y - a.y);
                    sortedAll.forEach(item => {
                        const closeBaseline = baselines.find(b => Math.abs(b.y - item.y) < 5);
                        if (closeBaseline) {
                            closeBaseline.items.push(item);
                            closeBaseline.y = closeBaseline.items.reduce((sum, it) => sum + it.y, 0) / closeBaseline.items.length;
                        } else {
                            baselines.push({
                                y: item.y,
                                items: [item]
                            });
                        }
                    });
                }

                baselines.sort((a, b) => b.y - a.y);

                const lineGroups = baselines.map(b => ({
                    baselineY: b.y,
                    items: []
                }));

                page.textItems.forEach(item => {
                    let bestGroup = null;
                    let minDiff = Infinity;

                    lineGroups.forEach(group => {
                        const diff = Math.abs(group.baselineY - item.y);
                        if (diff < minDiff) {
                            minDiff = diff;
                            bestGroup = group;
                        }
                    });

                    // 許容範囲（標準文字の高さの 60% 程度）
                    const threshold = Math.max(5, maxPercentileHeight * 0.6);
                    if (bestGroup && minDiff < threshold) {
                        bestGroup.items.push(item);
                    } else {
                        // 離れているものは別行として独立させる（強制マージ廃止）
                        lineGroups.push({
                            baselineY: item.y,
                            items: [item]
                        });
                    }
                });

                const lines = lineGroups
                    .filter(g => g.items.length > 0)
                    .map(g => g.items.sort((a, b) => a.x - b.x));

                 lines.forEach(line => {
                     const lineText = buildLineText(line).trim();
                     if (!lineText) return;

                     if (parserProfile.name === 'ivr' && IVR_SECTION_TRANSITION_PATTERN.test(lineText)) {
                         ivrSectionTransitionPending = true;
                         return;
                     }

                     const parsedStart = parseQuestionStart(lineText);
                     if (parsedStart) {
                         const rawQNum = parsedStart.qNum;
                         let qNum = rawQNum;
                         if (parserProfile.name === 'ivr') {
                             if (currentQuestion && rawQNum <= (currentQuestion.rawQuestionNumber || currentQuestion.questionNumber)) {
                                 ivrQuestionNumberOffset = currentQuestion.questionNumber;
                             }
                             qNum = ivrQuestionNumberOffset + rawQNum;
                             ivrSectionTransitionPending = false;
                         }
                         // ガード条件: 
                         // 1. 問題番号が1〜150の範囲内
                         // 2. 行の長さが5文字以上
                         // 3. 問題番号が昇順であること (前のアクティブな問題番号より大きい)
                         const isSequential = !currentQuestion || qNum > currentQuestion.questionNumber;
                         if (qNum >= 1 && qNum <= parserProfile.maxQuestionNumber && lineText.length >= parserProfile.minQuestionLineLength && isSequential) {
                             if (currentQuestion) {
                                 parsedQuestionsList.push(currentQuestion);
                             }
                             const questionText = parsedStart.questionText;
                             currentQuestion = {
                                 id: qNum,
                                 questionNumber: qNum,
                                 rawQuestionNumber: rawQNum,
                                 question: questionText,
                                 options: {},
                                 images: [],
                                 rawTextLines: [questionText],
                                 pageImages: [],
                                 startPage: page.pageNum,
                                 anchorY: Math.max(...line.map(item => item.y)),
                                 usedLines: [line]
                             };
                         } else if (currentQuestion) {
                             currentQuestion.rawTextLines.push(lineText);
                             currentQuestion.question += '\n' + lineText;
                             currentQuestion.usedLines.push(line);
                         }
                     } else if (currentQuestion) {
                         currentQuestion.rawTextLines.push(lineText);
                         currentQuestion.question += '\n' + lineText;
                         currentQuestion.usedLines.push(line);
                     }
                 });
             });


            if (currentQuestion) {
                parsedQuestionsList.push(currentQuestion);
            }

            // 選択肢の簡易抽出
            const optionPattern = parserProfile.optionPattern;
            populateQuestionOptionsAndText(parsedQuestionsList);

            // 選択肢が3つ未満の問題（シラバスや説明文など、誤検出されたもの）を除外
            const optionQualifiedQuestions = parsedQuestionsList.filter(q => {
                const optCount = getFilledOptionCount(q.options);
                return optCount >= parserProfile.minOptionCount;
             });

            if (optionQualifiedQuestions.length > 0) {
                parsedQuestionsList = optionQualifiedQuestions;
            } else {
                parsedQuestionsList = parsedQuestionsList.filter(q => String(q.question || '').trim().length > 0);
            }

            if (parsedQuestionsList.length === 0) {
                parsedQuestionsList = buildFallbackQuestionsFromSimpleLines();
            }

             // 2.3 確定した問題文と選択肢のテキスト要素キーを Set に登録
             const assignedTextKeys = new Set();
             parsedQuestionsList.forEach(q => {
                 if (q.finalUsedLines) {
                     q.finalUsedLines.forEach(line => {
                         line.forEach(item => {
                            assignedTextKeys.add(buildTextItemKey(item));
                        });
                    });
                }
            });

            // 2.4 【第2パス】各ページから画像を抽出し、確定したテキストを除外してレジェンド探索
            const allExtractedImagesPool = [];
            const imageContainedTextKeys = new Set();
            let imageCounter = 0;

             for (let pageNum = firstQuestionPage; pageNum <= totalPages; pageNum++) {
                 setPdfProgress(prev => ({ ...prev, status: `ページ ${pageNum}/${totalPages} の画像を抽出・解析中...` }));
                 const page = await pdf.getPage(pageNum);

                 const pageData = rawPagesTextData.find(p => p.pageNum === pageNum);
                 const textItems = pageData ? pageData.textItems : [];

                 const filteredTextItems = textItems.filter(item => {
                     const key = buildTextItemKey(item);
                     // ページ最下部のフッター領域（y < 60）のテキストアイテムは探索前に除外する
                     return !assignedTextKeys.has(key) && item.y >= parserProfile.footerMinY;
                 });

                 // 画像オブジェクトの位置情報を収集
                 const opList = await page.getOperatorList();
                 const { fnArray, argsArray } = opList;
                 const rawImageRects = [];
                 
                 let transformStack = [];
                 let currentTransform = [1, 0, 0, 1, 0, 0];

                 for (let j = 0; j < fnArray.length; j++) {
                     const fn = fnArray[j];
                     const args = argsArray[j];
                     
                     if (fn === pdfjsLib.OPS.save) {
                         transformStack.push([...currentTransform]);
                     } else if (fn === pdfjsLib.OPS.restore) {
                         if (transformStack.length > 0) {
                             currentTransform = transformStack.pop();
                         }
                     } else if (fn === pdfjsLib.OPS.transform) {
                         const [a1, b1, c1, d1, e1, f1] = currentTransform;
                         const [a2, b2, c2, d2, e2, f2] = args;
                         currentTransform = [
                             a1 * a2 + c1 * b2,
                             b1 * a2 + d1 * b2,
                             a1 * c2 + c1 * d2,
                             b1 * c2 + d1 * d2,
                             a1 * e2 + c1 * f2 + e1,
                             b1 * e2 + d1 * f2 + f1
                         ];
                     } else if (fn === pdfjsLib.OPS.paintImageXObject || fn === pdfjsLib.OPS.paintInlineImageXObject) {
                         const imgX = currentTransform[4];
                         const imgY = currentTransform[5];
                         const imgW = Math.abs(currentTransform[0]);
                         const imgH = Math.abs(currentTransform[3]);
                         
                         if (imgW > 5 && imgH > 5) {
                             rawImageRects.push({
                                 x: imgX,
                                 y: imgY,
                                 w: imgW,
                                 h: imgH
                             });
                         }
                     }
                 }

                 const pageImages = [];
                 const mergedImageRects = mergeNestedImageRects(rawImageRects);

                 if (parserProfile.name === 'nuclear') {
                      const scale = 1.5;
                      const viewport = page.getViewport({ scale });
                      const pageFigureAnchors = buildNuclearFigureAnchors(buildTextLineEntriesFromItems(filteredTextItems));
                      const pageCanvas = document.createElement('canvas');
                      pageCanvas.width = viewport.width;
                      pageCanvas.height = viewport.height;
                      const canvasCtx = pageCanvas.getContext('2d');

                      await page.render({
                          canvasContext: canvasCtx,
                          viewport
                      }).promise;

                      let nuclearGroups = [];
                      let pageUsedRuleFallback = false;
                      const nuclearImageRects = mergeNuclearImageFragments(
                          mergedImageRects,
                          viewport.width / viewport.scale
                      );

                      if (nuclearVlmReady && nuclearImageRects.length > 0) {
                          const questionOwners = buildNuclearQuestionOwners(filteredTextItems, parserProfile);
                          const pageRequest = buildNuclearVlmPageRequest({
                              pageNumber: pageNum,
                              pageCanvas,
                              viewport,
                              imageRects: nuclearImageRects,
                              textLines: buildTextLineEntriesFromItems(filteredTextItems),
                              questionOwners
                          });

                          if (pageRequest) {
                              setPdfProgress(prev => ({
                                  ...prev,
                                  status: `ページ ${pageNum}/${totalPages} をQwen3-VLでグルーピング中...`
                              }));
                              try {
                                  const vlmPayload = await requestNuclearVlmGrouping(pageRequest);
                                  const conversion = convertNuclearVlmResultToGroups(pageRequest, vlmPayload);
                                  nuclearGroups = conversion.groups;
                                  nuclearVlmConsecutiveFailureCount = 0;
                                  if (conversion.vlmGroupCount > 0) {
                                      nuclearVlmPageCount += 1;
                                  }
                                  if (conversion.fallbackGroupCount > 0) {
                                      pageUsedRuleFallback = true;
                                      nuclearRuleFallbackPageCount += 1;
                                      if (conversion.vlmGroupCount > 0) {
                                          nuclearVlmPartialPageCount += 1;
                                      }
                                  }
                                  if (conversion.vlmGroupCount === 0) {
                                      nuclearVlmFailureCount += 1;
                                      console.warn(`Nuclear VLM result used only algorithmic groups on page ${pageNum}`);
                                  }
                              } catch (vlmError) {
                                  nuclearVlmFailureCount += 1;
                                  nuclearVlmConsecutiveFailureCount += 1;
                                  console.warn(`Nuclear VLM grouping failed on page ${pageNum}:`, vlmError);
                                  if (nuclearVlmConsecutiveFailureCount >= 2) {
                                      nuclearVlmReady = false;
                                      setNuclearVlmStatus(prev => ({
                                          ...prev,
                                          state: 'degraded',
                                          message: 'VLM判定が連続して失敗したため、残りは従来方式で処理します。'
                                      }));
                                  }
                              }
                          }
                      }

                      if (nuclearGroups.length === 0) {
                          if (nuclearImageRects.length > 0 && !pageUsedRuleFallback) {
                              nuclearRuleFallbackPageCount += 1;
                              pageUsedRuleFallback = true;
                          }
                          nuclearGroups = buildNuclearVisualGroups(
                              filteredTextItems,
                              parserProfile,
                              pageCanvas,
                              viewport,
                              nuclearImageRects
                          );
                      }

                      if (nuclearGroups.length > 0) {
                          nuclearGroups.forEach((group, idx) => {
                              const currentGroupContainedTextKeys = buildTextItemKeySet(group.textItems || []);
                              const bounds = group.bounds;
                              const rawPt1 = viewport.convertToViewportPoint(bounds.x, bounds.y);
                              const rawPt2 = viewport.convertToViewportPoint(bounds.x + bounds.w, bounds.y + bounds.h);
                              const rawRegion = {
                                  x: Math.min(rawPt1[0], rawPt2[0]),
                                  y: Math.min(rawPt1[1], rawPt2[1]),
                                  w: Math.abs(rawPt1[0] - rawPt2[0]),
                                  h: Math.abs(rawPt1[1] - rawPt2[1])
                              };
                              const inkBounds = findInkBoundsInCanvasRegion(pageCanvas, rawRegion, {
                                  strategy: 'union',
                                  minDarkPixelCount: 24,
                                  minComponentWidth: 8,
                                  minComponentHeight: 8
                              });
                              const chosenRegion = chooseConservativeCropRegion(rawRegion, inkBounds);

                              let cropX = chosenRegion.x;
                              let cropY = chosenRegion.y;
                              let cropW = chosenRegion.w;
                              let cropH = chosenRegion.h;

                              const safeX = Math.max(0, Math.min(cropX, pageCanvas.width));
                              const safeY = Math.max(0, Math.min(cropY, pageCanvas.height));
                              const safeW = Math.max(1, Math.min(cropW, pageCanvas.width - safeX));
                              const safeH = Math.max(1, Math.min(cropH, pageCanvas.height - safeY));

                              const cropCanvas = document.createElement('canvas');
                              cropCanvas.width = safeW;
                              cropCanvas.height = safeH;
                              const cropCtx = cropCanvas.getContext('2d');
                              cropCtx.drawImage(pageCanvas, safeX, safeY, safeW, safeH, 0, 0, safeW, safeH);
                              cropCtx.fillStyle = '#FFFFFF';
                              (group.anchorItems || []).forEach(item => {
                                  const anchorRect = convertPdfRectToViewportRect(getTextItemRect(item), viewport);
                                  const maskX = Math.floor(anchorRect.x - safeX) - 8;
                                  const maskY = Math.floor(anchorRect.y - safeY) - 8;
                                  const maskW = Math.ceil(anchorRect.w) + 16;
                                  const maskH = Math.ceil(anchorRect.h) + 16;
                                  if (
                                      maskX < safeW
                                      && maskY < safeH
                                      && maskX + maskW > 0
                                      && maskY + maskH > 0
                                  ) {
                                      cropCtx.fillRect(maskX, maskY, maskW, maskH);
                                  }
                              });

                              const cropPdfPoint1 = viewport.convertToPdfPoint(safeX, safeY);
                              const cropPdfPoint2 = viewport.convertToPdfPoint(safeX + safeW, safeY + safeH);
                              const origMinX = Math.min(cropPdfPoint1[0], cropPdfPoint2[0]);
                              const origMinY = Math.min(cropPdfPoint1[1], cropPdfPoint2[1]);
                              currentGroupContainedTextKeys.forEach(key => imageContainedTextKeys.add(key));

                              imageCounter++;
                              const detectedLegend = cleanLegendPrefix(group.legend || '');
                              const legendResolved = Object.prototype.hasOwnProperty.call(group, 'displayLegend');
                              const displayLegend = legendResolved ? String(group.displayLegend || '') : null;

                              const imgObj = {
                                  path: cropCanvas.toDataURL('image/png'),
                                  x: origMinX,
                                  y: origMinY,
                                  legend: legendResolved ? displayLegend : (group.figureLabel || detectedLegend || `図${idx + 1}`),
                                  detectedLegend: legendResolved ? displayLegend : (detectedLegend || null),
                                  detectedLegendRaw: group.legendRaw || '',
                                  figureNumber: group.figureNumber ?? extractFigureNumber(group.legendRaw || group.legend || ''),
                                  figureLabel: legendResolved ? '' : (group.figureLabel || buildFigureLegend(group.legendRaw || group.legend || '')),
                                  displayLegend,
                                  legendResolved,
                                  viewportBounds: { x: safeX, y: safeY, w: safeW, h: safeH },
                                  page: pageNum,
                                  matchedQNum: group.matchedQNum
                              };

                              pageImages.push(imgObj);
                              allExtractedImagesPool.push(imgObj);
                          });

                          assignFigureAnchorsToNuclearImages(pageImages, pageFigureAnchors, viewport);
                          pageImages.sort(compareImportedImages);

                          pageImages.forEach((img, idx) => {
                              img.legend = resolveImportedImageLegend(img, idx);
                              delete img.viewportBounds;
                          });

                          continue;
                      }
                 }

                 if (mergedImageRects.length > 0) {

                      const combinedCrops = [];
                      
                      // Sort images: Y desc, X asc
                      const sortedRects = [...mergedImageRects].sort((a, b) => {
                          if (Math.abs(b.y - a.y) > 20) return b.y - a.y;
                          return a.x - b.x;
                      });
                      const preMatchedRects = sortedRects.map(rect => ({
                          ...rect,
                          matchedQNum: detectImageMatchedQuestionNumber(rect, textItems, parserProfile)
                      }));
                      const effectiveRects = parserProfile.name === 'nuclear'
                          ? mergeNuclearImageRects(preMatchedRects)
                          : preMatchedRects;

                      const usedLegendTextKeys = new Set();

                          const pageImageContainedTextKeys = new Set();
                          effectiveRects.forEach(rect => {
                             const origMinX = rect.x - 2;
                             const origMinY = rect.y - 2;
                             const origMaxX = rect.x + rect.w + 2;
                             const origMaxY = rect.y + rect.h + 2;

                             textItems.forEach(item => {
                                 const txCenter = item.x + item.width / 2;
                                 const tyCenter = item.y + item.height / 2;
                                 if (txCenter >= origMinX && txCenter <= origMaxX && tyCenter >= origMinY && tyCenter <= origMaxY) {
                                     pageImageContainedTextKeys.add(buildTextItemKey(item));
                                 }
                             });
                          });

                          effectiveRects.forEach(rect => {
                         const origMinX = rect.x;
                         const origMinY = rect.y;
                         const origMaxX = rect.x + rect.w;
                         const origMaxY = rect.y + rect.h;

                         const containedTexts = textItems.filter(item => {
                             const txCenter = item.x + item.width / 2;
                             const tyCenter = item.y + item.height / 2;
                             return txCenter >= origMinX && txCenter <= origMaxX && tyCenter >= origMinY && tyCenter <= origMaxY;
                         });
                         containedTexts.forEach(item => {
                             imageContainedTextKeys.add(buildTextItemKey(item));
                         });

                         const containedText = containedTexts.map(t => t.text).join(' ');
                         const matchedQNum = rect.matchedQNum ?? detectImageMatchedQuestionNumber(rect, textItems, parserProfile);

                          // Find adjacent limits
                          let leftLimit = undefined;
                          let rightLimit = undefined;

                          effectiveRects.forEach(other => {
                              if (other === rect) return;
                              const otherMinX = other.x;
                              const otherMaxX = other.x + other.w;
                              const otherMinY = other.y;
                              const otherMaxY = other.y + other.h;

                              const yOverlaps = Math.max(origMinY, otherMinY) <= Math.min(origMaxY, otherMaxY);
                              if (yOverlaps) {
                                  if (otherMaxX <= origMinX) {
                                      const mid = (otherMaxX + origMinX) / 2;
                                      leftLimit = leftLimit === undefined ? mid : Math.max(leftLimit, mid);
                                  } else if (otherMinX >= origMaxX) {
                                      const mid = (origMaxX + otherMinX) / 2;
                                      rightLimit = rightLimit === undefined ? mid : Math.min(rightLimit, mid);
                                  }
                              }
                          });

                          const limits = { leftLimit, rightLimit };

                          const availableTextItems = filteredTextItems.filter(item => {
                              const key = buildTextItemKey(item);
                              return !usedLegendTextKeys.has(key) && !pageImageContainedTextKeys.has(key);
                          });

                          const result = extractLegendForImage(rect, availableTextItems, limits, textItems);
                          const legendStr = result.legendStr;

                          result.usedItems.forEach(item => {
                              usedLegendTextKeys.add(buildTextItemKey(item));
                          });

                         combinedCrops.push({
                             minX: origMinX,
                             minY: origMinY,
                             maxX: origMaxX,
                             maxY: origMaxY,
                             w: rect.w,
                             h: rect.h,
                             text: containedText,
                             legendStr: legendStr,
                             matchedQNum
                         });
                     });

                      // Share column legends for grid-arranged images
                      if (combinedCrops.length >= 2) {
                          const colGroups = [];
                          combinedCrops.forEach(crop => {
                              let added = false;
                              for (const group of colGroups) {
                                  const representative = group[0];
                                  const overlapX = Math.min(crop.maxX, representative.maxX) - Math.max(crop.minX, representative.minX);
                                  const minW = Math.min(crop.w, representative.w);
                                  if (overlapX >= minW * 0.8) {
                                      group.push(crop);
                                      added = true;
                                      break;
                                  }
                              }
                              if (!added) {
                                  colGroups.push([crop]);
                              }
                          });

                          colGroups.forEach(group => {
                              if (group.length < 2) return;
                              group.sort((a, b) => b.minY - a.minY);

                              const groupNeedsSharing = group.some(crop => {
                                  const legend = (crop.legendStr || '').trim();
                                  if (!legend) return true;

                                  const legendMatch = legend.match(/^([^(]+)\(([^)]+)\)$/);
                                  if (legendMatch) {
                                      return false;
                                  }

                                  return IMAGE_ORIENTATION_LABEL_PATTERN.test(legend);
                              });

                              if (!groupNeedsSharing) return;

                              const bottomCrop = group[group.length - 1];
                              const bottomLegend = bottomCrop.legendStr || '';
                              if (!bottomLegend) return;

                              let mainPart = bottomLegend;
                              let descPart = '';
                              const match = bottomLegend.match(/^([^(]+)\(([^)]+)\)$/);
                              if (match) {
                                  mainPart = match[1].trim();
                                  descPart = match[2].trim();
                              }

                              const hasModalityOrColumnIndicator = !TEMPORAL_IMAGE_LABEL_PATTERN.test(mainPart) &&
                                  /(?:CT|MRI|PET|SPECT|US|X線|レントゲン|シンチ|造影|エコー|超音波|血流|換気|負荷|安静|運動|ストレス|レスト)/i.test(mainPart);
                              if (!hasModalityOrColumnIndicator) return;

                              group.forEach(crop => {
                                  const origLegend = crop.legendStr || '';
                                  let currentMain = origLegend;
                                  let currentDesc = '';
                                  const currentMatch = origLegend.match(/^([^(]+)\(([^)]+)\)$/);
                                  if (currentMatch) {
                                      currentMain = currentMatch[1].trim();
                                      currentDesc = currentMatch[2].trim();
                                  } else if (origLegend) {
                                      const isLabelLike = /^(?:\u524d\u9762\u50cf|\u5f8c\u9762\u50cf|\u53f3|\u5de6|\u524d|\u5f8c|\u4e0a|\u4e0b|\u5074\u9762|\u6b63\u9762)/.test(origLegend);
                                      if (isLabelLike) {
                                          currentDesc = origLegend;
                                          currentMain = '';
                                      }
                                  }

                                  const finalDesc = currentDesc || (crop === bottomCrop ? descPart : '');
                                  if (finalDesc) {
                                      crop.legendStr = `${mainPart} (${finalDesc})`;
                                  } else {
                                      crop.legendStr = mainPart;
                                  }
                              });
                          });
                      }

                     // ページ全体のレンダリングを実行（Canvas切り出し用）
                     const scale = 1.5;
                     const viewport = page.getViewport({ scale });
                     const pageCanvas = document.createElement('canvas');
                     pageCanvas.width = viewport.width;
                     pageCanvas.height = viewport.height;
                     const canvasCtx = pageCanvas.getContext('2d');
                     
                     await page.render({
                         canvasContext: canvasCtx,
                         viewport
                     }).promise;

                     // 統合バウンディングボックスに基づいて Canvas からクロップ実行
                     combinedCrops.forEach((crop, idx) => {
                         const pt1 = viewport.convertToViewportPoint(crop.minX, crop.minY);
                         const pt2 = viewport.convertToViewportPoint(crop.maxX, crop.maxY);

                         const cropX = Math.min(pt1[0], pt2[0]);
                         const cropY = Math.min(pt1[1], pt2[1]);
                         const cropW = Math.abs(pt1[0] - pt2[0]);
                         const cropH = Math.abs(pt1[1] - pt2[1]);

                         const safeX = Math.max(0, Math.min(cropX, pageCanvas.width));
                         const safeY = Math.max(0, Math.min(cropY, pageCanvas.height));
                         const safeW = Math.max(1, Math.min(cropW, pageCanvas.width - safeX));
                         const safeH = Math.max(1, Math.min(cropH, pageCanvas.height - safeY));

                         const cropCanvas = document.createElement('canvas');
                         cropCanvas.width = safeW;
                         cropCanvas.height = safeH;
                         const cropCtx = cropCanvas.getContext('2d');
                         cropCtx.drawImage(pageCanvas, safeX, safeY, safeW, safeH, 0, 0, safeW, safeH);

                         const base64Data = cropCanvas.toDataURL('image/png');
                         
                         imageCounter++;
                         
                         const imgObj = {
                             path: base64Data,
                             x: crop.minX,
                             y: crop.minY,
                             legend: crop.legendStr || `図${idx + 1}`,
                             detectedLegend: crop.legendStr || null,
                             page: pageNum,
                             matchedQNum: crop.matchedQNum
                         };

                         pageImages.push(imgObj);
                         allExtractedImagesPool.push(imgObj);
                     });
                 }

                 pageImages.sort((a, b) => {
                     if (Math.abs(a.y - b.y) > 20) {
                         return b.y - a.y;
                     }
                     return a.x - b.x;
                 });

                 pageImages.forEach((img, idx) => {
                     const cleaned = cleanLegendPrefix(img.detectedLegend);
                     img.legend = cleaned || `図${idx + 1}`;
                 });
             }

             // 2.4.5 画像内テキストとフッター断片を除外した上で、問題文・選択肢を再構築
             parsedQuestionsList.forEach(q => {
                 const originalOptions = normalizeQuestionOptions(q.options);
                 let optionsStarted = false;
                 let lastOptionKey = '';
                 const cleanQuestionLines = [];
                 const rebuiltOptions = {};
                 const rebuiltUsedLines = [];

                 q.usedLines.forEach(line => {
                     const sanitizedLineItems = line.filter(item => {
                         if (imageContainedTextKeys.has(buildTextItemKey(item))) return false;
                         const trimmed = item.text.trim();
                         const isFooterFragment = item.y < (parserProfile.footerMinY + 8) && (
                             FOOTER_DASH_ONLY_PATTERN.test(trimmed) ||
                             /^[0-9０-９]+$/.test(trimmed)
                         );
                         return !isFooterFragment;
                     });

                     if (sanitizedLineItems.length === 0) return;

                     let lineText = buildLineText(sanitizedLineItems).trim();
                     if (!lineText) return;
                     lineText = stripFooterSuffix(lineText);
                     if (!lineText) return;

                     const match = lineText.match(optionPattern);
                     if (match) {
                         optionsStarted = true;
                         const optKey = canonicalizeOptionKey(lineText[0][0]);
                         const optText = stripFooterSuffix(lineText.substring(match[0].length).trim());
                         rebuiltOptions[optKey] = optText;
                         lastOptionKey = optKey;
                         rebuiltUsedLines.push(sanitizedLineItems);
                     } else if (optionsStarted) {
                         const isFooter = FOOTER_PAGE_PATTERN.test(lineText);
                         const isLegendLike = /(CT|MRI|像|写真|図|シンチ|造影|エコー|DWI|FLAIR|PET)/i.test(lineText);

                         if (isFooter || isLegendLike || lastOptionKey === 'e') {
                             return;
                         }

                         if (lastOptionKey) {
                             rebuiltOptions[lastOptionKey] += ` ${lineText}`;
                             rebuiltUsedLines.push(sanitizedLineItems);
                         }
                     } else {
                         const parsedStart = parseQuestionStart(lineText);
                         cleanQuestionLines.push(parsedStart ? parsedStart.questionText : lineText);
                         rebuiltUsedLines.push(sanitizedLineItems);
                     }
                 });

                 q.question = cleanQuestionLines.join('\n').trim();
                 q.options = getFilledOptionCount(rebuiltOptions) > 0
                     ? normalizeQuestionOptions(rebuiltOptions)
                     : originalOptions;
                 q.finalUsedLines = rebuiltUsedLines;
             });

             parsedQuestionsList = parsedQuestionsList.filter(q => {
                 const optCount = getFilledOptionCount(q.options);
                 return optCount >= parserProfile.minOptionCount;
             });

              // 2.5 全体の画像プールから問題へのマッピング・紐付け処理
             parsedQuestionsList.forEach(q => {
                 q.pageImages = [];
             });

             const assignedImages = new Set(); // 割り当て済みの画像を記録して重複を防ぐ

             // 優先順位1：No.Xラベルが一致する画像をダイレクトにマッピングする
             allExtractedImagesPool.forEach(img => {
                 if (img.matchedQNum !== null && !assignedImages.has(img)) {
                     const targetQ = parsedQuestionsList.find(q => q.questionNumber === img.matchedQNum);
                     if (targetQ) {
                         targetQ.pageImages.push(img);
                         assignedImages.add(img);
                     }
                 }
             });

             // 優先順位2：同一ページ内で出現した画像を、そのページ内の「最後の問題」に割り当てる
             // （試験4など「問題文→選択肢→画像」の順番になるため、ページ下部の画像は直前の問題に属する）
             const questionsByPage = {};
             parsedQuestionsList.forEach(q => {
                 if (!questionsByPage[q.startPage]) questionsByPage[q.startPage] = [];
                 questionsByPage[q.startPage].push(q);
             });

             Object.keys(questionsByPage).forEach(pageNumStr => {
                 const pageNum = parseInt(pageNumStr);
                 const qs = questionsByPage[pageNum].sort((a, b) => b.anchorY - a.anchorY);
                 
                 // そのページの未割り当て画像を取得し、Y座標（上から下）でソート
                 const pageImgs = allExtractedImagesPool
                     .filter(img => img.page === pageNum && !assignedImages.has(img))
                     .sort((a, b) => b.y - a.y); // Y座標降順 (PDFのY軸は下から上なので、大きい方が上)

                 if (pageImgs.length > 0 && qs.length > 0) {
                     if (parserProfile.imageAssignmentStrategy === 'label-only') {
                         return;
                     }

                     if (parserProfile.imageAssignmentStrategy === 'nearest-preceding-question') {
                         pageImgs.forEach(img => {
                             const precedingQuestions = qs.filter(q => q.anchorY >= img.y - 5);
                             const targetQ = precedingQuestions.length > 0
                                 ? precedingQuestions.reduce((closest, candidate) => (
                                     (candidate.anchorY - img.y) < (closest.anchorY - img.y) ? candidate : closest
                                 ))
                                 : qs[qs.length - 1];
                             targetQ.pageImages.push(img);
                             assignedImages.add(img);
                         });
                     } else {
                         // ページ内で最後に出現した問題に全ての余った画像を割り当てる
                         const lastQ = qs[qs.length - 1];
                         pageImgs.forEach(img => {
                             lastQ.pageImages.push(img);
                             assignedImages.add(img);
                         });
                     }
                 }
             });

             // 各問題ごとに紐づいた画像を位置順（ページ順 -> Y座標降順 -> X座標昇順）にソートし、legendを再設定
             parsedQuestionsList.forEach(q => {
                 q.pageImages.sort(compareImportedImages);
                 q.pageImages.forEach((img, idx) => {
                     img.legend = resolveImportedImageLegend(img, idx);
                 });
             });

             // 2.5.5 ベクタ図形など画像オブジェクトとして検出できない図へのフォールバック
             const figureCuePattern = /(?:図|画像|写真|シェーマ|模式図|図に示|画像を示|写真を示|造影を示|先端形状)/;
             const renderedPageCache = new Map();

             if (parserProfile.imageAssignmentStrategy !== 'label-only') {
                 for (const [pageNumStr, pageQuestions] of Object.entries(questionsByPage)) {
                     const pageNum = parseInt(pageNumStr, 10);
                     const fallbackTargets = pageQuestions
                         .filter(q => q.pageImages.length === 0 && figureCuePattern.test(q.question))
                         .sort((a, b) => b.anchorY - a.anchorY);

                     if (fallbackTargets.length === 0) continue;

                     let rendered = renderedPageCache.get(pageNum);
                     if (!rendered) {
                         const page = await pdf.getPage(pageNum);
                         const scale = 1.5;
                         const viewport = page.getViewport({ scale });
                         const pageCanvas = document.createElement('canvas');
                         pageCanvas.width = viewport.width;
                         pageCanvas.height = viewport.height;
                         const canvasCtx = pageCanvas.getContext('2d');

                         await page.render({
                             canvasContext: canvasCtx,
                             viewport
                         }).promise;

                         rendered = { page, viewport, pageCanvas };
                         renderedPageCache.set(pageNum, rendered);
                     }

                     const { page, viewport, pageCanvas } = rendered;
                     const sortedPageQuestions = [...pageQuestions].sort((a, b) => b.anchorY - a.anchorY);
                     const pageWidthPdf = page.view?.[2] || page.getViewport({ scale: 1 }).width;
                     const scanLeftPdfX = pageWidthPdf * 0.08;
                     const scanRightPdfX = pageWidthPdf * 0.92;

                     fallbackTargets.forEach(q => {
                         const sourceLines = q.finalUsedLines?.length ? q.finalUsedLines : q.usedLines;
                         const allLineItems = sourceLines.flat();
                         if (allLineItems.length === 0) return;

                         const questionBottomY = Math.min(...allLineItems.map(item => item.y));
                         const currentIndex = sortedPageQuestions.findIndex(candidate => candidate === q);
                         const nextQuestion = currentIndex >= 0 ? sortedPageQuestions[currentIndex + 1] : null;
                         const scanTopPdfY = questionBottomY - 6;
                         const footerExclusionY = parserProfile.footerMinY + 28;
                         const scanBottomPdfY = nextQuestion
                             ? Math.max(footerExclusionY, nextQuestion.anchorY + 10)
                             : footerExclusionY;

                         if (scanTopPdfY <= scanBottomPdfY + 12) return;

                         const pointA = viewport.convertToViewportPoint(scanLeftPdfX, scanTopPdfY);
                         const pointB = viewport.convertToViewportPoint(scanRightPdfX, scanBottomPdfY);
                         const scanRegion = {
                             x: Math.min(pointA[0], pointB[0]),
                             y: Math.min(pointA[1], pointB[1]),
                             w: Math.abs(pointB[0] - pointA[0]),
                             h: Math.abs(pointB[1] - pointA[1])
                         };

                         const inkBounds = findInkBoundsInCanvasRegion(pageCanvas, scanRegion);
                         if (!inkBounds) return;

                         const padding = 6;
                         const cropX = Math.max(0, inkBounds.x - padding);
                         const cropY = Math.max(0, inkBounds.y - padding);
                         const cropW = Math.min(pageCanvas.width - cropX, inkBounds.w + padding * 2);
                         const cropH = Math.min(pageCanvas.height - cropY, inkBounds.h + padding * 2);

                         if (cropW < 20 || cropH < 20) return;

                         const cropCanvas = document.createElement('canvas');
                         cropCanvas.width = cropW;
                         cropCanvas.height = cropH;
                         const cropCtx = cropCanvas.getContext('2d');
                         cropCtx.drawImage(pageCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

                         const pdfPoint1 = viewport.convertToPdfPoint(cropX, cropY);
                         const pdfPoint2 = viewport.convertToPdfPoint(cropX + cropW, cropY + cropH);
                         const minPdfX = Math.min(pdfPoint1[0], pdfPoint2[0]);
                         const minPdfY = Math.min(pdfPoint1[1], pdfPoint2[1]);

                         q.pageImages.push({
                             path: cropCanvas.toDataURL('image/png'),
                             x: minPdfX,
                             y: minPdfY,
                             legend: `図${q.pageImages.length + 1}`,
                             detectedLegend: null,
                             page: pageNum,
                             matchedQNum: q.questionNumber
                         });
                     });
                 }
             }

             parsedQuestionsList.forEach(q => {
                 q.pageImages.sort(compareImportedImages);
                 q.pageImages.forEach((img, idx) => {
                     img.legend = resolveImportedImageLegend(img, idx);
                 });
             });

            const totalQs = parsedQuestionsList.length;
            if (totalQs === 0) {
                throw new Error('PDFから問題を検出できませんでした。フォーマットを確認してください。');
            }

            // 3. 各問題をルールベースで整形
            const finalQuestions = new Array(totalQs);
            const finalImageMap = {};
            parsedQuestionsList.forEach((q, idx) => {
                finalQuestions[idx] = {
                    id: buildQuestionId(detectedYear, q.questionNumber),
                    year: detectedYear,
                    questionNumber: q.questionNumber,
                    genre: '',
                    question: q.question,
                    options: normalizeQuestionOptions(q.options),
                    answer: '',
                    explanation: '',
                    images: q.pageImages.map((img, imgIdx) => ({
                        path: 'image_placeholder',
                        legend: img.legend ?? `図${imgIdx + 1}`
                    }))
                };

                if (q.pageImages.length > 0) {
                    finalImageMap[idx] = q.pageImages.map((img, imgIdx) => ({
                        path: img.path,
                        legend: img.legend ?? `図${imgIdx + 1}`
                    }));
                }
            });

            setParsedQuestions(finalQuestions);
            setParsedYearInput(String(detectedYear));
            setImageMap(finalImageMap);
            const vlmSummary = parserProfile.name === 'nuclear' && nuclearVlmEnabled
                ? ` VLM採用: ${nuclearVlmPageCount}ページ（部分採用: ${nuclearVlmPartialPageCount}ページ）、従来方式併用: ${nuclearRuleFallbackPageCount}ページ、VLM応答不採用: ${nuclearVlmFailureCount}ページ。`
                : '';
            setSuccessMsg(`PDFの自動パースが完了しました！合計 ${finalQuestions.length} 問の問題と画像を登録しました。${vlmSummary}内容を確認して保存してください。`);
        } catch (err) {
            console.error('PDF Import Error:', err);
            setErrorMsg(`PDFのインポートに失敗しました: ${err.message}`);
        } finally {
            setIsParsingPdf(false);
        }
    };

    // 保存処理の実行
    const handleSaveExam = async () => {
        setErrorMsg('');
        setSuccessMsg('');

        if (!examId.trim() || !examName.trim()) {
            setErrorMsg('試験IDと試験名を入力してください。');
            return;
        }

        // 半角英数字とアンダースコアのみを許可
        if (!/^[a-zA-Z0-9_-]+$/.test(examId)) {
            setErrorMsg('試験IDは半角英数字、ハイフン、アンダースコアのみ使用可能です。');
            return;
        }
        if (!/^\d{4}$/.test(String(parsedQuestions[0]?.year ?? ''))) {
            setErrorMsg('取り込み年度は4桁の西暦で入力してください。');
            return;
        }
        try {
            // 画像マッピングを統合した問題リストを作成
            const finalQuestions = parsedQuestions.map((q, idx) => {
                const localImages = imageMap[idx] || [];
                return {
                    ...q,
                    // AIがプレースホルダを生成したか、あるいは空配列である場合、ローカルで紐付けた画像で上書き
                    images: localImages.length > 0 ? localImages : (q.images || [])
                };
            });

            // 既存IDの重複をチェック
            const isExistingExam = localExams.some(e => e.id === examId);
            if (importMode === 'new' && isExistingExam) {
                setErrorMsg('この試験IDは既に使われています。既存の試験に追加する場合は「既存の試験に追加 (マージ)」を選択してください。');
                return;
            }

            // 保存を実行（マージは既存試験への追加モードに限定）
            const finalIsMerge = importMode === 'existing';
            await saveLocalExam(examId, examName, finalQuestions, finalIsMerge);
            
            // data.js のメモリキャッシュを更新
            await initializeLocalExams(true);

            setSuccessMsg(`試験「${examName}」をローカルに正常に保存しました！`);
            setExamId('');
            setExamName('');
            setParsedQuestions([]);
            setParsedYearInput('');
            setImageMap({});
            loadLocalExams();
        } catch (e) {
            setErrorMsg(`保存に失敗しました: ${e.message}`);
        }
    };

    // 試験の削除
    const handleDeleteExam = async (id, name) => {
        if (!confirm(`試験「${name}」を完全に削除しますか？\n（この操作は取り消せません）`)) return;
        
        try {
            await deleteLocalExam(id);
            await initializeLocalExams(true);
            loadLocalExams();
            setSuccessMsg('試験を削除しました。');
        } catch (e) {
            setErrorMsg(`削除に失敗しました: ${e.message}`);
        }
    };

    // エクスポート (バックアップダウンロード)
    const handleExportBackup = async () => {
        try {
            const data = await exportAllLocalData();
            if (Object.keys(data.exams).length === 0 && Object.keys(data.progress).length === 0) {
                alert("バックアップするデータがありません。");
                return;
            }
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `radtest_local_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            alert(`バックアップの作成に失敗しました: ${e.message}`);
        }
    };

    // インポート (バックアップ復元)
    const handleImportBackup = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!confirm('バックアップデータを復元しますか？\n※現在のローカル試験データと学習進捗はすべて消去され、バックアップファイルの内容で完全に置き換えられます。')) {
            e.target.value = '';
            return;
        }

        try {
            const text = await file.text();
            const json = JSON.parse(text);
            await importLocalData(json);
            await initializeLocalExams(true);
            loadLocalExams();
            alert("データを復元しました。画面を再読み込みします。");
            window.location.reload();
        } catch (e) {
            alert(`復元に失敗しました。正しいJSONファイルか確認してください: ${e.message}`);
        } finally {
            e.target.value = '';
        }
    };


    return (
        <>
        <div style={{
            maxWidth: '1200px',
            margin: '0 auto',
            padding: '2rem 1rem',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
            color: '#2d3748',
            backgroundColor: '#f7fafc',
            minHeight: '100vh'
        }}>
            {/* Header */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '2rem',
                borderBottom: '1px solid #e2e8f0',
                paddingBottom: '1rem'
            }}>
                <div>
                    <h1 style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0, color: '#1a202c' }}>
                        ⚙️ 試験管理ダッシュボード
                    </h1>
                    <p style={{ margin: '0.2rem 0 0 0', color: '#718096', fontSize: '0.9rem' }}>
                        PDFから抽出した試験問題の追加、管理、バックアップをアプリ上で行います。
                    </p>
                </div>
                <button
                    onClick={() => router.push('/')}
                    style={{
                        padding: '0.5rem 1rem',
                        background: '#fff',
                        border: '1px solid #cbd5e0',
                        borderRadius: '0.375rem',
                        cursor: 'pointer'
                    }}
                >
                    戻る
                </button>
            </div>

            {/* Tab Navigation */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
                <button
                    onClick={() => setActiveTab('import')}
                    style={{
                        padding: '0.5rem 1rem',
                        background: activeTab === 'import' ? '#3182ce' : '#fff',
                        color: activeTab === 'import' ? '#fff' : '#4a5568',
                        border: '1px solid #cbd5e0',
                        borderRadius: '0.375rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                    }}
                >
                    📥 試験データインポート
                </button>
                <button
                    onClick={() => setActiveTab('manage')}
                    style={{
                        padding: '0.5rem 1rem',
                        background: activeTab === 'manage' ? '#3182ce' : '#fff',
                        color: activeTab === 'manage' ? '#fff' : '#4a5568',
                        border: '1px solid #cbd5e0',
                        borderRadius: '0.375rem',
                        fontWeight: 'bold',
                        cursor: 'pointer'
                    }}
                >
                    🛠 データ管理 / バックアップ
                </button>
            </div>

            {activeTab === 'import' && (
                parsedQuestions.length === 0 ? (
                    <div style={{
                        background: '#fff',
                        padding: '1.5rem',
                        borderRadius: '0.5rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        marginBottom: '1.5rem'
                    }}>
                            {isParsingPdf ? (
                                /* パース進捗表示画面 */
                                <div style={{ padding: '2rem 1rem', textAlign: 'center' }}>
                                    <div style={{ fontSize: '2.5rem', marginBottom: '1rem', animation: 'spin 2s linear infinite' }}>⏳</div>
                                    <h3 style={{ marginBottom: '0.5rem' }}>PDFファイルを自動解析中...</h3>
                                    <p style={{ color: '#4a5568', fontWeight: 'bold', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
                                        {pdfProgress.status}
                                    </p>
                                    
                                    {pdfProgress.total > 0 && (
                                        <div style={{ width: '100%', maxWidth: '500px', margin: '0 auto' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: '#718096', marginBottom: '0.3rem' }}>
                                                <span>進捗: {pdfProgress.current} / {pdfProgress.total}</span>
                                                <span>{Math.round((pdfProgress.current / pdfProgress.total) * 100)}%</span>
                                            </div>
                                            <div style={{ width: '100%', height: '12px', background: '#e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                                                <div style={{
                                                    width: `${(pdfProgress.current / pdfProgress.total) * 100}%`,
                                                    height: '100%',
                                                    background: '#3182ce',
                                                    transition: 'width 0.3s ease'
                                                }} />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                /* 新規：PDF 自動インポート表示 */
                                <>
                                    <h3 style={{ margin: 0, marginBottom: '1rem' }}>過去問PDFから自動登録</h3>
                                    <p style={{ color: '#718096', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                                        試験過去問PDFファイルを選択すると、アプリ上で問題文、選択肢、埋め込み画像を抽出し、登録用データを自動作成します。
                                    </p>

                                    {/* Exam Category Selection */}
                                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: '#ebf8fa', borderRadius: '0.375rem', border: '1px solid #bee3f8' }}>
                                        <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.95rem', color: '#2c5282', marginBottom: '0.5rem' }}>
                                            対象の試験を選択してください
                                        </label>
                                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                            {[
                                                { id: '1', label: '1. 放射線科専門医試験' },
                                                { id: '2', label: '2. 放射線診断専門医試験' },
                                                { id: '3', label: '3. 核医学専門医試験' },
                                                { id: '4', label: '4. IVR専門医試験' }
                                            ].map(cat => (
                                                <label key={cat.id} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: '0.9rem', color: '#4a5568' }}>
                                                    <input
                                                        type="radio"
                                                        name="examCategory"
                                                        value={cat.id}
                                                        checked={examCategory === cat.id}
                                                        onChange={() => setExamCategory(cat.id)}
                                                        style={{ marginRight: '0.4rem' }}
                                                    />
                                                    {cat.label}
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {examCategory === '3' && (
                                        <div style={{
                                            marginBottom: '1.5rem',
                                            padding: '1rem',
                                            background: '#fffaf0',
                                            borderRadius: '0.375rem',
                                            border: '1px solid #fbd38d'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: '700', color: '#7b341e', cursor: 'pointer' }}>
                                                    <input
                                                        type="checkbox"
                                                        checked={nuclearVlmEnabled}
                                                        onChange={(event) => setNuclearVlmEnabled(event.target.checked)}
                                                    />
                                                    Qwen3-VLによる図グルーピングを使用
                                                </label>
                                                <button
                                                    type="button"
                                                    onClick={checkNuclearVlmStatus}
                                                    disabled={nuclearVlmStatus.state === 'checking'}
                                                    style={{
                                                        padding: '0.45rem 0.8rem',
                                                        border: '1px solid #dd6b20',
                                                        borderRadius: '0.375rem',
                                                        color: '#9c4221',
                                                        background: '#fff',
                                                        fontWeight: '700',
                                                        cursor: nuclearVlmStatus.state === 'checking' ? 'wait' : 'pointer'
                                                    }}
                                                >
                                                    接続確認
                                                </button>
                                            </div>
                                            <p style={{
                                                margin: '0.65rem 0 0',
                                                color: nuclearVlmStatus.state === 'ready' ? '#276749' : '#744210',
                                                fontSize: '0.82rem',
                                                lineHeight: 1.5
                                            }}>
                                                モデル: {nuclearVlmStatus.model} / {nuclearVlmStatus.message}
                                            </p>
                                            <p style={{ margin: '0.35rem 0 0', color: '#975a16', fontSize: '0.78rem', lineHeight: 1.5 }}>
                                                VLMが利用できない場合や応答検証に失敗したページは、従来のアルゴリズムで処理します。
                                            </p>
                                        </div>
                                    )}

                                    <div style={{
                                        border: '2px dashed #cbd5e0',
                                        borderRadius: '0.5rem',
                                        padding: '3rem 1.5rem',
                                        textAlign: 'center',
                                        background: '#f8fafc',
                                        cursor: 'pointer',
                                        position: 'relative'
                                    }}
                                    onClick={() => document.getElementById('pdf-file-selector').click()}
                                    >
                                        <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>📁</div>
                                        <div style={{ fontWeight: 'bold', color: '#2d3748', fontSize: '1.05rem', marginBottom: '0.3rem' }}>
                                            ここに過去問PDFファイルをドロップ、またはクリックして選択
                                        </div>
                                        <input
                                            id="pdf-file-selector"
                                            type="file"
                                            accept=".pdf"
                                            style={{ display: 'none' }}
                                            onChange={handlePdfImport}
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <div>
                            {/* Exam Configuration Card */}
                            <div style={{
                                background: '#fff',
                                padding: '1.5rem',
                                borderRadius: '0.5rem',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                                marginBottom: '1.5rem'
                            }}>
                                <h3 style={{ marginTop: 0, marginBottom: '1rem' }}>ステップ2: 試験の設定と画像の紐付け</h3>
                                <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.4rem',
                                    marginBottom: '1rem',
                                    padding: '0.35rem 0.7rem',
                                    borderRadius: '9999px',
                                    background: '#ebf8ff',
                                    color: '#2b6cb0',
                                    fontSize: '0.85rem',
                                    fontWeight: '700'
                                }}>
                                    <span>取り込み問題数</span>
                                    <span>{parsedQuestions.length}問</span>
                                </div>
                                {localExams.length > 0 && (
                                    <div style={{
                                        display: 'flex',
                                        gap: '1.5rem',
                                        marginBottom: '1rem',
                                        borderBottom: '1px solid #edf2f7',
                                        paddingBottom: '0.75rem'
                                    }}>
                                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', color: importMode === 'existing' ? '#3182ce' : '#4a5568' }}>
                                            <input
                                                type="radio"
                                                name="importMode"
                                                value="existing"
                                                checked={importMode === 'existing'}
                                                onChange={() => {
                                                    setImportMode('existing');
                                                    if (localExams.length > 0) {
                                                        setExamId(localExams[0].id);
                                                        setExamName(localExams[0].name);
                                                    }
                                                }}
                                                style={{ marginRight: '0.4rem', cursor: 'pointer' }}
                                            />
                                            既存の試験に追加 (マージ) 【推奨】
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', color: importMode === 'new' ? '#3182ce' : '#4a5568' }}>
                                            <input
                                                type="radio"
                                                name="importMode"
                                                value="new"
                                                checked={importMode === 'new'}
                                                onChange={() => {
                                                    setImportMode('new');
                                                    setExamId('');
                                                    setExamName('');
                                                }}
                                                style={{ marginRight: '0.4rem', cursor: 'pointer' }}
                                            />
                                            新しい試験として登録
                                        </label>
                                    </div>
                                )}

                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: '1fr 1fr',
                                    gap: '1rem',
                                    marginBottom: '1.5rem'
                                }}>
                                    {importMode === 'existing' ? (
                                        <div style={{ gridColumn: '1 / -1' }}>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                                追加（マージ）先とする登録済みの試験を選択してください
                                            </label>
                                            <select
                                                value={examId}
                                                onChange={(e) => {
                                                    const selected = localExams.find(ex => ex.id === e.target.value);
                                                    if (selected) {
                                                        setExamId(selected.id);
                                                        setExamName(selected.name);
                                                    }
                                                }}
                                                style={{
                                                    width: '100%',
                                                    padding: '0.6rem',
                                                    borderRadius: '0.375rem',
                                                    border: '1px solid #cbd5e0',
                                                    background: '#fff',
                                                    fontSize: '0.95rem',
                                                    fontWeight: '600',
                                                    color: '#2d3748'
                                                }}
                                            >
                                                {localExams.map(ex => (
                                                    <option key={ex.id} value={ex.id}>
                                                        {ex.name} ({ex.id} - {ex.count}問)
                                                    </option>
                                                ))}
                                            </select>
                                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#718096' }}>
                                                ※マージの際、登録済みの表示名（試験名）が優先して維持されます。
                                            </p>
                                        </div>
                                    ) : (
                                        <>
                                            <div>
                                                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                                    試験ID (半角英数字・アンダースコアのみ)
                                                </label>
                                                <input
                                                    type="text"
                                                    value={examId}
                                                    onChange={(e) => setExamId(e.target.value)}
                                                    placeholder="例: custom_exam"
                                                    style={{
                                                        width: '100%',
                                                        padding: '0.5rem',
                                                        borderRadius: '0.25rem',
                                                        border: '1px solid #cbd5e0'
                                                    }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                                    試験名 (表示名)
                                                </label>
                                                <input
                                                    type="text"
                                                    value={examName}
                                                    onChange={(e) => setExamName(e.target.value)}
                                                    placeholder="例: 独自追加試験"
                                                    style={{
                                                        width: '100%',
                                                        padding: '0.5rem',
                                                        borderRadius: '0.25rem',
                                                        border: '1px solid #cbd5e0'
                                                    }}
                                                />
                                            </div>
                                            {localExams.some(e => e.id === examId) && (
                                                <div style={{
                                                    gridColumn: '1 / -1',
                                                    background: '#fffaf0',
                                                    border: '1px solid #f6ad55',
                                                    padding: '0.75rem',
                                                    borderRadius: '0.25rem',
                                                    fontSize: '0.9rem',
                                                    color: '#c05621',
                                                    marginTop: '0.5rem'
                                                }}>
                                                    この試験IDは既に使われています。追加登録する場合は「既存の試験に追加 (マージ)」を選択してください。
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                <div style={{ marginBottom: '1.5rem' }}>
                                    <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.4rem' }}>
                                        取り込み年度
                                    </label>
                                    <input
                                        type="number"
                                        min="2000"
                                        max="2999"
                                        inputMode="numeric"
                                        value={parsedYearInput}
                                        onChange={(e) => handleParsedQuestionsYearChange(e.target.value)}
                                        onBlur={() => {
                                            if (!/^\d{4}$/.test(parsedYearInput)) {
                                                setParsedYearInput(String(parsedQuestions[0]?.year ?? ''));
                                            }
                                        }}
                                        placeholder="例: 2025"
                                        style={{
                                            width: '100%',
                                            padding: '0.6rem',
                                            borderRadius: '0.375rem',
                                            border: '1px solid #cbd5e0',
                                            background: '#fff',
                                            fontSize: '0.95rem',
                                            fontWeight: '600',
                                            color: '#2d3748'
                                        }}
                                    />
                                    <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#718096' }}>
                                        年度を変更すると、プレビュー中の全問題の年度と問題IDに一括反映されます。
                                    </p>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem' }}>
                                    <button
                                        onClick={handleSaveExam}
                                        style={{
                                            flex: 1,
                                            padding: '0.75rem',
                                            background: '#48bb78',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer',
                                            fontSize: '1.1rem'
                                        }}
                                    >
                                        💾 この内容で保存
                                    </button>
                                    <button
                                        onClick={() => {
                                            setParsedQuestions([]);
                                            setParsedYearInput('');
                                            setImageMap({});
                                        }}
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            background: '#cbd5e0',
                                            color: '#4a5568',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        キャンセル
                                    </button>
                                </div>
                            </div>

                            {/* Question List with Image Drop */}
                            <h3 style={{ marginBottom: '1rem' }}>📋 問題リスト (画像の登録)</h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {parsedQuestions.map((q, qIdx) => {
                                    const localImages = imageMap[qIdx] || [];
                                    return (
                                        <div key={qIdx} style={{
                                            background: '#fff',
                                            padding: '1.2rem',
                                            borderRadius: '0.5rem',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                                            border: '1px solid #e2e8f0',
                                            display: 'flex',
                                            gap: '1.5rem',
                                            alignItems: 'flex-start'
                                        }}>
                                            {/* Left Column: Question Details */}
                                            <div style={{ flex: 1 }}>
                                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                                                    <span style={{
                                                        background: '#e2e8f0',
                                                        padding: '0.2rem 0.5rem',
                                                        borderRadius: '0.25rem',
                                                        fontSize: '0.8rem',
                                                        fontWeight: 'bold'
                                                    }}>
                                                        問 {q.id}
                                                    </span>
                                                </div>

                                                {/* Question Text */}
                                                <div style={{ fontSize: '0.9rem', marginBottom: '1rem', whiteSpace: 'pre-wrap', lineHeight: '1.5', color: '#2d3748' }}>
                                                    {q.question}
                                                </div>
                                                
                                                {/* Question Options */}
                                                {q.options && Object.keys(q.options).length > 0 && (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginBottom: '1rem', background: '#f7fafc', padding: '0.75rem', borderRadius: '0.375rem' }}>
                                                        {Object.entries(q.options).map(([key, val]) => (
                                                            <div key={key} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem' }}>
                                                                <span style={{ fontWeight: 'bold', minWidth: '20px', color: '#4a5568' }}>{key}.</span>
                                                                <span style={{ color: '#2d3748' }}>{val}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                            </div>

                                            {/* Right Column: Image Drop Area */}
                                            <div style={{
                                                width: '280px',
                                                borderLeft: '1px solid #edf2f7',
                                                paddingLeft: '1.5rem',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: '0.5rem'
                                            }}>
                                                <div style={{ fontWeight: 'bold', fontSize: '0.8rem', color: '#4a5568' }}>
                                                    🖼 この問題の画像
                                                </div>
                                                
                                                {/* File Upload Drop Area */}
                                                <div 
                                                    style={{
                                                        border: '2px dashed #cbd5e0',
                                                        borderRadius: '0.375rem',
                                                        padding: '1rem',
                                                        textAlign: 'center',
                                                        background: '#f8fafc',
                                                        cursor: 'pointer',
                                                        fontSize: '0.75rem',
                                                        color: '#718096',
                                                        position: 'relative'
                                                    }}
                                                    onClick={() => document.getElementById(`file-input-${qIdx}`).click()}
                                                >
                                                    ファイルをドロップまたはクリックして追加
                                                    <input
                                                        id={`file-input-${qIdx}`}
                                                        type="file"
                                                        accept="image/*"
                                                        style={{ display: 'none' }}
                                                        onChange={(e) => handleImageChange(qIdx, e.target.files[0])}
                                                    />
                                                </div>

                                                {/* Image Previews */}
                                                {localImages.length > 0 && (
                                                    <div style={{
                                                        display: 'flex',
                                                        flexDirection: 'column',
                                                        gap: '0.4rem',
                                                        marginTop: '0.5rem'
                                                    }}>
                                                        {localImages.map((img, imgIdx) => (
                                                            <div key={imgIdx} style={{
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                background: '#edf2f7',
                                                                padding: '0.3rem',
                                                                borderRadius: '0.25rem',
                                                                fontSize: '0.75rem'
                                                            }}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setPreviewImageModal({ path: img.path, legend: img.legend })}
                                                                    style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.4rem',
                                                                        overflow: 'hidden',
                                                                        flex: 1,
                                                                        background: 'transparent',
                                                                        border: 'none',
                                                                        padding: 0,
                                                                        textAlign: 'left',
                                                                        cursor: 'zoom-in'
                                                                    }}
                                                                >
                                                                    <img src={img.path} alt={img.legend} style={{ width: '30px', height: '30px', objectFit: 'cover', borderRadius: '2px' }} />
                                                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '160px' }}>{img.legend}</span>
                                                                </button>
                                                                <button 
                                                                    onClick={() => handleRemoveImage(qIdx, imgIdx)}
                                                                    style={{
                                                                        background: 'none',
                                                                        border: 'none',
                                                                        color: '#e53e3e',
                                                                        cursor: 'pointer',
                                                                        fontWeight: 'bold',
                                                                        fontSize: '0.9rem'
                                                                    }}
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )
                )}

            {/* Tab Content 2: Manage */}
            {activeTab === 'manage' && (
                <div>
                    {/* Backup Section */}
                    <div style={{
                        background: '#fff',
                        padding: '1.5rem',
                        borderRadius: '0.5rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                        marginBottom: '1.5rem'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid #edf2f7', paddingBottom: '1rem', marginBottom: '1rem' }}>
                            <div>
                                <h3 style={{ marginTop: 0, marginBottom: '0.2rem' }}>💾 ローカルデータの管理（エクスポート & インポート）</h3>
                                <p style={{ color: '#718096', fontSize: '0.85rem', margin: 0 }}>
                                    全てのカスタム試験データと学習の進捗（正誤、お気に入り、メモ）をまとめてJSONファイルとしてバックアップ・復元できます。
                                </p>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <button
                                    onClick={handleExportBackup}
                                    style={{
                                        padding: '0.6rem 1.2rem',
                                        background: '#3182ce',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '0.375rem',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        fontSize: '0.9rem'
                                    }}
                                >
                                    📤 エクスポート (バックアップ)
                                </button>
                                <label style={{
                                    padding: '0.6rem 1.2rem',
                                    background: '#38a169',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '0.375rem',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    display: 'inline-block'
                                }}>
                                    📥 インポート (完全復元)
                                    <input
                                        type="file"
                                        accept=".json"
                                        style={{ display: 'none' }}
                                        onChange={handleImportBackup}
                                    />
                                </label>
                            </div>
                        </div>

                        <div style={{
                            background: '#f7fafc',
                            padding: '1rem',
                            borderRadius: '0.375rem',
                            border: '1px solid #e2e8f0',
                            fontSize: '0.9rem'
                        }}>
                            <div style={{ fontWeight: 'bold', color: '#4a5568', marginBottom: '0.5rem' }}>
                                バックアップ復元の動作
                            </div>
                            <div style={{ color: '#2d3748' }}>
                                バックアップファイルに含まれる試験データ、問題文、選択肢、画像、画像レジェンド、学習進捗を復元します。
                            </div>
                            <div style={{ marginTop: '0.4rem', fontSize: '0.8rem', color: '#c05621' }}>
                                ※復元時は現在のローカルデータをすべて消去し、バックアップ内容で完全に置き換えます。
                            </div>
                        </div>
                    </div>

                    {/* Custom Exam List */}
                    <div style={{
                        background: '#fff',
                        padding: '1.5rem',
                        borderRadius: '0.5rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                    }}>
                        <h3 style={{ marginTop: 0, marginBottom: '1.2rem' }}>📋 追加されたカスタム試験一覧</h3>
                        {localExams.length === 0 ? (
                            <div style={{ textAlign: 'center', color: '#a0aec0', padding: '3rem 0' }}>
                                追加された独自の試験はありません。
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {localExams.map((exam) => (
                                    <div key={exam.id} style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        padding: '1rem',
                                        borderRadius: '0.375rem',
                                        border: '1px solid #e2e8f0',
                                        background: '#f8fafc'
                                    }}>
                                        <div>
                                            <h4 style={{ margin: 0, fontSize: '1rem', color: '#2d3748' }}>{exam.name}</h4>
                                            <span style={{ fontSize: '0.8rem', color: '#718096' }}>
                                                ID: {exam.id} | 問題数: {exam.count}問
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                onClick={() => loadExamForEditing(exam)}
                                                style={{
                                                    padding: '0.4rem 0.8rem',
                                                    background: '#fff',
                                                    border: '1px solid #3182ce',
                                                    borderRadius: '0.25rem',
                                                    color: '#3182ce',
                                                    fontWeight: 'bold',
                                                    fontSize: '0.8rem',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                編集
                                            </button>
                                            <button
                                                onClick={() => handleDeleteExam(exam.id, exam.name)}
                                                style={{
                                                    padding: '0.4rem 0.8rem',
                                                    background: '#fff',
                                                    border: '1px solid #e53e3e',
                                                    borderRadius: '0.25rem',
                                                    color: '#e53e3e',
                                                    fontWeight: 'bold',
                                                    fontSize: '0.8rem',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                                onMouseEnter={e => {
                                                    e.target.style.background = '#e53e3e';
                                                    e.target.style.color = '#fff';
                                                }}
                                                onMouseLeave={e => {
                                                    e.target.style.background = '#fff';
                                                    e.target.style.color = '#e53e3e';
                                                }}
                                            >
                                                削除
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {editingExamId && (
                        <div style={{
                            background: '#fff',
                            padding: '1.5rem',
                            borderRadius: '0.5rem',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                            marginTop: '1.5rem'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                <div>
                                    <h3 style={{ margin: 0 }}>📝 保存済み試験の編集</h3>
                                    <p style={{ margin: '0.35rem 0 0 0', fontSize: '0.85rem', color: '#718096' }}>
                                        問題文、選択肢、画像レジェンド、問題追加・削除、画像追加・削除をここで直接修正できます。
                                    </p>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        onClick={handleAddEditingQuestion}
                                        style={{
                                            padding: '0.5rem 0.9rem',
                                            background: '#38a169',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        ＋ 問題を追加
                                    </button>
                                    <button
                                        onClick={handleSaveEditedExam}
                                        style={{
                                            padding: '0.5rem 0.9rem',
                                            background: '#3182ce',
                                            color: '#fff',
                                            border: 'none',
                                            borderRadius: '0.375rem',
                                            fontWeight: 'bold',
                                            cursor: 'pointer'
                                        }}
                                    >
                                        保存
                                    </button>
                                </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem', marginBottom: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.35rem' }}>試験ID</label>
                                    <input value={editingExamId} disabled style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0', background: '#edf2f7' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.35rem' }}>試験名</label>
                                    <input value={editingExamName} onChange={(e) => setEditingExamName(e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }} />
                                </div>
                            </div>

                            <div style={{ marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: 'minmax(220px, 320px)', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '0.35rem' }}>表示年度</label>
                                    <select
                                        value={editingYearFilter}
                                        onChange={(e) => setEditingYearFilter(e.target.value)}
                                        style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0', background: '#fff' }}
                                    >
                                        <option value="all">全年度を表示</option>
                                        {[...new Set(editingQuestions.map(q => Number(q.year)).filter(Boolean))].sort((a, b) => b - a).map((year) => (
                                            <option key={year} value={String(year)}>
                                                {year}年
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {editingQuestions
                                    .map((question, questionIndex) => ({ question, questionIndex }))
                                    .filter(({ question }) => editingYearFilter === 'all' || String(question.year) === editingYearFilter)
                                    .map(({ question, questionIndex }) => (
                                    <div key={`${question.id}-${questionIndex}`} style={{
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '0.5rem',
                                        padding: '1rem',
                                        background: '#f8fafc'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))', gap: '0.75rem', flex: 1 }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>年度</label>
                                                    <input type="number" value={question.year} onChange={(e) => handleEditingQuestionMetaChange(questionIndex, 'year', e.target.value)} style={{ width: '100%', padding: '0.45rem', borderRadius: '0.25rem', border: '1px solid #cbd5e0' }} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>問題番号</label>
                                                    <input type="number" value={question.questionNumber} onChange={(e) => handleEditingQuestionMetaChange(questionIndex, 'questionNumber', e.target.value)} style={{ width: '100%', padding: '0.45rem', borderRadius: '0.25rem', border: '1px solid #cbd5e0' }} />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '0.25rem' }}>問題ID</label>
                                                    <input value={question.id} disabled style={{ width: '100%', padding: '0.45rem', borderRadius: '0.25rem', border: '1px solid #cbd5e0', background: '#edf2f7' }} />
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => handleDeleteEditingQuestion(questionIndex)}
                                                style={{
                                                    padding: '0.45rem 0.8rem',
                                                    background: '#fff',
                                                    border: '1px solid #e53e3e',
                                                    borderRadius: '0.25rem',
                                                    color: '#e53e3e',
                                                    fontWeight: 'bold',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                問題を削除
                                            </button>
                                        </div>

                                        <div style={{ marginBottom: '1rem' }}>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '0.35rem' }}>ジャンル</label>
                                            <input value={question.genre} onChange={(e) => handleEditingQuestionFieldChange(questionIndex, 'genre', e.target.value)} style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }} />
                                        </div>

                                        <div style={{ marginBottom: '1rem' }}>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '0.35rem' }}>問題文</label>
                                            <textarea value={question.question} onChange={(e) => handleEditingQuestionFieldChange(questionIndex, 'question', e.target.value)} style={{ width: '100%', minHeight: '100px', padding: '0.65rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0', resize: 'vertical' }} />
                                        </div>

                                        <div style={{ marginBottom: '1rem' }}>
                                            <label style={{ display: 'block', fontWeight: 'bold', fontSize: '0.8rem', marginBottom: '0.5rem' }}>選択肢</label>
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.5rem' }}>
                                                {['a', 'b', 'c', 'd', 'e'].map((optionKey) => (
                                                    <div key={optionKey} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: '0.5rem', alignItems: 'center' }}>
                                                        <span style={{ fontWeight: 'bold' }}>{optionKey}.</span>
                                                        <input value={question.options?.[optionKey] || ''} onChange={(e) => handleEditingOptionChange(questionIndex, optionKey, e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
                                                <label style={{ fontWeight: 'bold', fontSize: '0.8rem' }}>画像とレジェンド</label>
                                                <label style={{
                                                    padding: '0.45rem 0.8rem',
                                                    background: '#2d3748',
                                                    color: '#fff',
                                                    borderRadius: '0.25rem',
                                                    cursor: 'pointer',
                                                    fontSize: '0.8rem',
                                                    fontWeight: 'bold'
                                                }}>
                                                    ＋ 画像を追加
                                                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleEditingImageAdd(questionIndex, e.target.files?.[0])} />
                                                </label>
                                            </div>
                                            {question.images.length === 0 ? (
                                                <div style={{ color: '#718096', fontSize: '0.8rem' }}>この問題に画像はありません。</div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                    {question.images.map((image, imageIndex) => (
                                                        <div key={`${question.id}-image-${imageIndex}`} style={{ display: 'grid', gridTemplateColumns: '72px 1fr auto', gap: '0.75rem', alignItems: 'center', background: '#fff', padding: '0.6rem', borderRadius: '0.375rem', border: '1px solid #e2e8f0' }}>
                                                            <img src={image.path} alt={image.legend || `image-${imageIndex + 1}`} style={{ width: '72px', height: '72px', objectFit: 'cover', borderRadius: '0.25rem', background: '#edf2f7' }} />
                                                            <input value={image.legend || ''} onChange={(e) => handleEditingImageLegendChange(questionIndex, imageIndex, e.target.value)} placeholder="画像レジェンド" style={{ width: '100%', padding: '0.55rem', borderRadius: '0.375rem', border: '1px solid #cbd5e0' }} />
                                                            <button
                                                                onClick={() => handleEditingImageRemove(questionIndex, imageIndex)}
                                                                style={{
                                                                    padding: '0.45rem 0.75rem',
                                                                    background: '#fff',
                                                                    border: '1px solid #e53e3e',
                                                                    borderRadius: '0.25rem',
                                                                    color: '#e53e3e',
                                                                    fontWeight: 'bold',
                                                                    cursor: 'pointer'
                                                                }}
                                                            >
                                                                削除
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

        </div>
        {previewImageModal && (
            <div
                onClick={() => setPreviewImageModal(null)}
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(15, 23, 42, 0.82)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '2rem',
                    zIndex: 2000
                }}
            >
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        maxWidth: 'min(96vw, 1200px)',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#fff', gap: '1rem' }}>
                        <div style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {previewImageModal.legend || '画像プレビュー'}
                        </div>
                        <button
                            type="button"
                            onClick={() => setPreviewImageModal(null)}
                            style={{
                                background: 'rgba(255,255,255,0.12)',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.18)',
                                borderRadius: '0.375rem',
                                padding: '0.4rem 0.75rem',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                        >
                            閉じる
                        </button>
                    </div>
                    <img
                        src={previewImageModal.path}
                        alt={previewImageModal.legend || '拡大画像'}
                        style={{
                            maxWidth: '100%',
                            maxHeight: 'calc(90vh - 3rem)',
                            objectFit: 'contain',
                            borderRadius: '0.5rem',
                            background: '#fff',
                            boxShadow: '0 12px 40px rgba(0,0,0,0.35)'
                        }}
                    />
                </div>
            </div>
        )}
        </>
    );
}
