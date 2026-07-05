import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
const DEFAULT_MODEL = 'qwen3-vl:2b-instruct';
const REQUEST_TIMEOUT_MS = 180000;
const HEALTH_TIMEOUT_MS = 3000;
const MAX_IMAGE_DATA_URL_LENGTH = 18_000_000;
const MAX_OBJECTS = 180;

const VLM_RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        groups: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    groupId: { type: 'string' },
                    questionAnchorId: { type: 'string' },
                    imageIds: {
                        type: 'array',
                        items: { type: 'string' },
                        minItems: 1
                    },
                    legendIds: {
                        type: 'array',
                        items: { type: 'string' }
                    },
                    mergeReason: {
                        type: 'string',
                        enum: [
                            'single_image',
                            'fragmented_single_image',
                            'shared_frame',
                            'shared_legend',
                            'labeled_composite',
                            'continuous_composition'
                        ]
                    },
                    confidence: {
                        type: 'number',
                        minimum: 0,
                        maximum: 1
                    }
                },
                required: ['groupId', 'questionAnchorId', 'imageIds', 'legendIds', 'mergeReason', 'confidence'],
                additionalProperties: false
            }
        }
    },
    required: ['groups'],
    additionalProperties: false
};

const getOllamaConfig = () => ({
    baseUrl: String(process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL).replace(/\/$/, ''),
    model: process.env.NUCLEAR_VLM_MODEL || DEFAULT_MODEL
});

const fetchWithTimeout = async (url, options, timeoutMs) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            cache: 'no-store'
        });
    } finally {
        clearTimeout(timeoutId);
    }
};

const normalizeInstalledModelName = (name) => String(name || '').trim().toLowerCase();

const isRequestedModelInstalled = (models, requestedModel) => {
    const normalizedRequested = normalizeInstalledModelName(requestedModel);
    return models.some(entry => {
        const installedName = normalizeInstalledModelName(entry?.name || entry?.model);
        return installedName === normalizedRequested
            || installedName.startsWith(`${normalizedRequested}:`)
            || normalizedRequested.startsWith(`${installedName}:`);
    });
};

const validateObjects = (objects) => {
    if (!Array.isArray(objects) || objects.length === 0 || objects.length > MAX_OBJECTS) {
        throw new Error(`objects must contain between 1 and ${MAX_OBJECTS} entries`);
    }

    const seenIds = new Set();
    objects.forEach(object => {
        if (!object || typeof object.id !== 'string' || seenIds.has(object.id)) {
            throw new Error('Each object must have a unique string id');
        }
        if (!['question_anchor', 'image', 'text'].includes(object.type)) {
            throw new Error(`Unsupported object type for ${object.id}`);
        }
        if (!Array.isArray(object.bbox) || object.bbox.length !== 4 || object.bbox.some(value => !Number.isFinite(value))) {
            throw new Error(`Invalid bbox for ${object.id}`);
        }
        seenIds.add(object.id);
    });

    if (!objects.some(object => object.type === 'question_anchor') || !objects.some(object => object.type === 'image')) {
        throw new Error('objects must include at least one question anchor and one image');
    }

    const anchorIds = new Set(objects.filter(object => object.type === 'question_anchor').map(object => object.id));
    objects.filter(object => object.type === 'image').forEach(object => {
        if (!anchorIds.has(object.defaultQuestionAnchorId)) {
            throw new Error(`Image ${object.id} has an invalid default question anchor`);
        }
    });
};

const normalizeGroupingResponse = (result, objects) => {
    if (!result || !Array.isArray(result.groups)) return result;

    const imageById = new Map(
        objects
            .filter(object => object.type === 'image')
            .map(object => [object.id, object])
    );

    const sectionNormalizedGroups = result.groups.flatMap(group => {
        if (!group || !Array.isArray(group.imageIds)) return [group];

        const imageIdsByAnchor = new Map();
        group.imageIds.forEach(imageId => {
            const anchorId = imageById.get(imageId)?.defaultQuestionAnchorId || group.questionAnchorId;
            if (!imageIdsByAnchor.has(anchorId)) imageIdsByAnchor.set(anchorId, []);
            imageIdsByAnchor.get(anchorId).push(imageId);
        });

        const partitions = [...imageIdsByAnchor.entries()];
        return partitions.map(([anchorId, imageIds], index) => ({
            ...group,
            groupId: partitions.length > 1 ? `${group.groupId}-section-${index + 1}` : group.groupId,
            questionAnchorId: anchorId,
            imageIds,
            legendIds: partitions.length > 1 ? [] : group.legendIds,
            mergeReason: imageIds.length === 1 ? 'single_image' : group.mergeReason
        }));
    });

    const mergeNormalizedGroups = sectionNormalizedGroups.flatMap(group => {
        if (
            group?.mergeReason !== 'single_image'
            || !Array.isArray(group.imageIds)
            || group.imageIds.length <= 1
        ) {
            return [group];
        }
        if (Array.isArray(group.legendIds) && group.legendIds.length > 0) {
            return [group];
        }

        return group.imageIds.map((imageId, index) => ({
            ...group,
            groupId: `${group.groupId}-${index + 1}`,
            imageIds: [imageId],
            legendIds: [],
            mergeReason: 'single_image'
        }));
    });

    const winningGroupByImageId = new Map();
    mergeNormalizedGroups.forEach((group, groupIndex) => {
        (group?.imageIds || []).forEach(imageId => {
            const current = winningGroupByImageId.get(imageId);
            const candidate = { group, groupIndex };
            if (
                !current
                || group.imageIds.length < current.group.imageIds.length
                || (
                    group.imageIds.length === current.group.imageIds.length
                    && (group.confidence || 0) > (current.group.confidence || 0)
                )
            ) {
                winningGroupByImageId.set(imageId, candidate);
            }
        });
    });

    const deduplicatedGroups = mergeNormalizedGroups
        .map((group, groupIndex) => {
            const imageIds = (group?.imageIds || []).filter(imageId => (
                winningGroupByImageId.get(imageId)?.groupIndex === groupIndex
            ));
            if (imageIds.length === 0) return null;
            return {
                ...group,
                imageIds,
                mergeReason: imageIds.length === 1 ? 'single_image' : group.mergeReason
            };
        })
        .filter(Boolean);

    return {
        ...result,
        groups: deduplicatedGroups
    };
};

const validateGroupingResponse = (result, objects) => {
    if (!result || !Array.isArray(result.groups) || result.groups.length === 0) {
        throw new Error('VLM returned no groups');
    }

    const objectById = new Map(objects.map(object => [object.id, object]));
    const expectedImageIds = objects.filter(object => object.type === 'image').map(object => object.id);
    const assignedImageIds = [];
    const assignedLegendIds = [];
    const seenGroupIds = new Set();

    result.groups.forEach(group => {
        if (!group || typeof group.groupId !== 'string' || !group.groupId || seenGroupIds.has(group.groupId)) {
            throw new Error('VLM returned an invalid or duplicate groupId');
        }
        seenGroupIds.add(group.groupId);

        const anchor = objectById.get(group.questionAnchorId);
        if (!anchor || anchor.type !== 'question_anchor') {
            throw new Error(`Unknown question anchor: ${group.questionAnchorId}`);
        }
        if (!Array.isArray(group.imageIds) || group.imageIds.length === 0) {
            throw new Error(`Group ${group.groupId} has no images`);
        }
        group.imageIds.forEach(id => {
            const image = objectById.get(id);
            if (image?.type !== 'image') {
                throw new Error(`Unknown image id: ${id}`);
            }
            if (image.defaultQuestionAnchorId !== group.questionAnchorId) {
                throw new Error(`Image ${id} was moved outside its algorithmic question section`);
            }
            assignedImageIds.push(id);
        });
        if (!Array.isArray(group.legendIds)) {
            throw new Error(`Group ${group.groupId} has invalid legendIds`);
        }
        group.legendIds.forEach(id => {
            if (objectById.get(id)?.type !== 'text') {
                throw new Error(`Unknown legend id: ${id}`);
            }
            assignedLegendIds.push(id);
        });
        const allowedMergeReasons = new Set([
            'single_image',
            'fragmented_single_image',
            'shared_frame',
            'shared_legend',
            'labeled_composite',
            'continuous_composition'
        ]);
        if (!allowedMergeReasons.has(group.mergeReason)) {
            throw new Error(`Group ${group.groupId} has an invalid mergeReason`);
        }
        if (group.imageIds.length === 1 && group.mergeReason !== 'single_image') {
            throw new Error(`Single-image group ${group.groupId} must use single_image`);
        }
        if (group.imageIds.length > 1 && group.mergeReason === 'single_image') {
            throw new Error(`Multi-image group ${group.groupId} requires explicit merge evidence`);
        }
        if (!Number.isFinite(group.confidence) || group.confidence < 0 || group.confidence > 1) {
            throw new Error(`Group ${group.groupId} has invalid confidence`);
        }
    });

    const uniqueAssigned = new Set(assignedImageIds);
    if (uniqueAssigned.size !== assignedImageIds.length) {
        throw new Error('An image was assigned to multiple groups');
    }
    if (uniqueAssigned.size !== expectedImageIds.length || expectedImageIds.some(id => !uniqueAssigned.has(id))) {
        throw new Error('VLM response did not assign every image exactly once');
    }
    if (new Set(assignedLegendIds).size !== assignedLegendIds.length) {
        throw new Error('A legend was assigned to multiple groups');
    }

    return result;
};

const buildPrompt = (objects, pageNumber) => `
You are grouping figures in a Japanese nuclear medicine board examination appendix page.
The page image contains colored boxes with stable IDs:
- A*: question anchors such as No.56 or No.52-1
- I*: image objects extracted from the PDF
- T*: nearby text objects that may be figure labels or legends

Return only data matching the supplied JSON schema.

Tasks:
1. Keep every I* object under its supplied defaultQuestionAnchorId. Question ownership was already resolved algorithmically and must not be changed.
2. Within each question, divide the images into the figures that should be registered separately.
3. Attach only T* objects whose position or wording is meaningful to that figure.
4. Set mergeReason to single_image for one I* object. For multiple I* objects, select the concrete visual evidence that justifies merging them.

Grouping rules:
- Do not group by distance alone. Use the visible layout, frames, alignment, labels, and whitespace.
- Default to one registered figure per I* object. Merge multiple I* objects only when there is positive visual evidence that they are fragments of one figure, such as a shared outer frame, shared legend, internal panel labels, dividers, overlap, or a continuous composition.
- A group represents one registered figure, not one question. A question with four independent I* objects should produce four groups with the same questionAnchorId. Producing exactly one group per question is usually incorrect.
- Separate different clinical views or modalities into different groups when each I* is already a complete rectangular image, even when they are aligned or touching.
- continuous_composition means image content visibly continues across object boundaries. It does not mean merely adjacent CT, PET, MRI, planar, or MIP views.
- Alignment in a row or grid alone does not make images one figure. Keep individually separable panels apart unless a shared frame, shared legend, or internal labels make their relative layout meaningful.
- The appendix normally follows top-to-bottom reading order: an A* anchor starts a question section, and its figures follow below it until the next A* anchor. An image above the next anchor normally belongs to the preceding anchor, even if it is physically closer to the next anchor.
- A figure may cross a midpoint between anchors. An anchor can exceptionally be below its own figure, but use that exception only when labels or composition clearly support it; never assign by proximity alone.
- No.XX and No.XX-Y are question anchors, not legends. Never include A* in legendIds.
- Text such as 図1, 術前, 術後, 安静時, 負荷時, 左, 右, modality names, and panel labels can be legends when spatially attached.
- Do not invent IDs, text, coordinates, or images.
- Use lower confidence when the grouping is ambiguous.

PDF page: ${pageNumber ?? 'unknown'}
Objects (bbox uses normalized [left, top, right, bottom], range 0-1000):
${JSON.stringify(objects)}
`.trim();

export async function GET() {
    const { baseUrl, model } = getOllamaConfig();

    try {
        const response = await fetchWithTimeout(`${baseUrl}/api/tags`, {}, HEALTH_TIMEOUT_MS);
        if (!response.ok) {
            throw new Error(`Ollama returned HTTP ${response.status}`);
        }
        const payload = await response.json();
        const models = Array.isArray(payload.models) ? payload.models : [];
        const installed = isRequestedModelInstalled(models, model);

        return NextResponse.json({
            available: installed,
            serverAvailable: true,
            model,
            message: installed
                ? `${model} is ready`
                : `${model} is not installed. Run: ollama pull ${model}`
        });
    } catch (error) {
        return NextResponse.json({
            available: false,
            serverAvailable: false,
            model,
            message: `Ollama is unavailable: ${error.message}`
        });
    }
}

export async function POST(request) {
    const startedAt = Date.now();
    const { baseUrl, model } = getOllamaConfig();

    try {
        const body = await request.json();
        const imageDataUrl = String(body?.imageDataUrl || '');
        const imageMatch = imageDataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,(.+)$/);
        if (!imageMatch || imageDataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
            return NextResponse.json({ error: 'Invalid or oversized page image' }, { status: 400 });
        }

        validateObjects(body.objects);
        const publicObjects = body.objects.map(object => ({
            id: object.id,
            type: object.type,
            text: typeof object.text === 'string' ? object.text.slice(0, 120) : undefined,
            questionNumber: Number.isInteger(object.questionNumber) ? object.questionNumber : undefined,
            defaultQuestionAnchorId: typeof object.defaultQuestionAnchorId === 'string'
                ? object.defaultQuestionAnchorId
                : undefined,
            bbox: object.bbox.map(value => Math.round(value))
        }));

        const ollamaResponse = await fetchWithTimeout(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                stream: false,
                think: false,
                messages: [{
                    role: 'user',
                    content: buildPrompt(publicObjects, body.pageNumber),
                    images: [imageMatch[1]]
                }],
                format: VLM_RESPONSE_SCHEMA,
                options: {
                    temperature: 0,
                    num_predict: 1200
                }
            })
        }, REQUEST_TIMEOUT_MS);

        if (!ollamaResponse.ok) {
            const detail = await ollamaResponse.text();
            throw new Error(`Ollama returned HTTP ${ollamaResponse.status}: ${detail.slice(0, 300)}`);
        }

        const ollamaPayload = await ollamaResponse.json();
        const content = ollamaPayload?.message?.content;
        let parsed = content;
        if (typeof content === 'string') {
            try {
                parsed = JSON.parse(content);
            } catch {
                const diagnostic = content.trim().slice(0, 240) || '(empty content)';
                throw new Error(`VLM returned invalid JSON: ${diagnostic}; done reason: ${ollamaPayload?.done_reason || 'unknown'}`);
            }
        }
        const result = validateGroupingResponse(normalizeGroupingResponse(parsed, publicObjects), publicObjects);

        return NextResponse.json({
            model,
            elapsedMs: Date.now() - startedAt,
            result
        });
    } catch (error) {
        const isTimeout = error?.name === 'AbortError';
        return NextResponse.json({
            error: isTimeout ? 'VLM request timed out' : error.message,
            model,
            elapsedMs: Date.now() - startedAt
        }, { status: isTimeout ? 504 : 502 });
    }
}
