export const DEFAULT_NUCLEAR_VLM_MODEL = 'qwen3-vl:2b-instruct';
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_EMBEDDED_VLM_URL = 'http://127.0.0.1:11435';

const normalizeBaseUrl = value => String(value || '').trim().replace(/\/$/, '');
const normalizeModelName = value => String(value || '').trim().toLowerCase();

export const isRequestedModelInstalled = (models, requestedModel) => {
    const normalizedRequested = normalizeModelName(requestedModel);
    return models.some(entry => {
        const installedName = normalizeModelName(entry?.name || entry?.model || entry?.id);
        return installedName === normalizedRequested
            || installedName.startsWith(`${normalizedRequested}:`)
            || normalizedRequested.startsWith(`${installedName}:`);
    });
};

export const resolveNuclearVlmProviderConfig = (env = process.env) => {
    const requestedProvider = String(env.NUCLEAR_VLM_PROVIDER || 'auto').trim().toLowerCase();
    const embeddedUrl = normalizeBaseUrl(env.NUCLEAR_VLM_EMBEDDED_URL);
    const useEmbedded = requestedProvider === 'embedded'
        || (requestedProvider === 'auto' && Boolean(embeddedUrl));

    if (useEmbedded) {
        return {
            kind: 'embedded',
            label: '組み込みVLM',
            baseUrl: embeddedUrl || DEFAULT_EMBEDDED_VLM_URL,
            model: env.NUCLEAR_VLM_EMBEDDED_MODEL
                || env.NUCLEAR_VLM_MODEL
                || DEFAULT_NUCLEAR_VLM_MODEL,
            managed: env.NUCLEAR_VLM_EMBEDDED_MANAGED === '1'
        };
    }

    return {
        kind: 'ollama',
        label: 'Ollama',
        baseUrl: normalizeBaseUrl(env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_URL),
        model: env.NUCLEAR_VLM_MODEL || DEFAULT_NUCLEAR_VLM_MODEL,
        managed: false
    };
};

export const fetchWithTimeout = async (url, options, timeoutMs) => {
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

export const checkNuclearVlmProvider = async (config, timeoutMs) => {
    if (config.kind === 'embedded') {
        const response = await fetchWithTimeout(`${config.baseUrl}/v1/models`, {}, timeoutMs);
        if (!response.ok) throw new Error(`組み込みVLMがHTTP ${response.status}を返しました`);
        const payload = await response.json();
        const models = Array.isArray(payload?.data) ? payload.data : [];
        const installed = isRequestedModelInstalled(models, config.model) || models.length === 1;
        return {
            available: installed,
            serverAvailable: true,
            message: installed
                ? `${config.model} is ready`
                : `組み込みVLMに${config.model}が読み込まれていません`
        };
    }

    const response = await fetchWithTimeout(`${config.baseUrl}/api/tags`, {}, timeoutMs);
    if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}`);
    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models : [];
    const installed = isRequestedModelInstalled(models, config.model);
    return {
        available: installed,
        serverAvailable: true,
        message: installed
            ? `${config.model} is ready`
            : `${config.model} is not installed. Run: ollama pull ${config.model}`
    };
};

export const buildNuclearVlmRequest = (config, { prompt, imageDataUrl, imageBase64, schema }) => {
    if (config.kind === 'embedded') {
        return {
            url: `${config.baseUrl}/v1/chat/completions`,
            body: {
                model: config.model,
                stream: false,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'text', text: prompt },
                        { type: 'image_url', image_url: { url: imageDataUrl } }
                    ]
                }],
                response_format: {
                    type: 'json_schema',
                    schema
                },
                chat_template_kwargs: { enable_thinking: false },
                reasoning_format: 'none',
                temperature: 0,
                seed: 42,
                max_tokens: 1200
            }
        };
    }

    return {
        url: `${config.baseUrl}/api/chat`,
        body: {
            model: config.model,
            stream: false,
            think: false,
            messages: [{
                role: 'user',
                content: prompt,
                images: [imageBase64]
            }],
            format: schema,
            options: {
                temperature: 0,
                seed: 42,
                num_predict: 1200
            }
        }
    };
};

export const parseNuclearVlmCompletion = (config, payload) => {
    if (config.kind === 'embedded') {
        return {
            content: payload?.choices?.[0]?.message?.content,
            doneReason: payload?.choices?.[0]?.finish_reason || 'unknown'
        };
    }

    return {
        content: payload?.message?.content,
        doneReason: payload?.done_reason || 'unknown'
    };
};

export const requestNuclearVlmCompletion = async (config, requestData, timeoutMs) => {
    const providerRequest = buildNuclearVlmRequest(config, requestData);
    const response = await fetchWithTimeout(providerRequest.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(providerRequest.body)
    }, timeoutMs);

    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`${config.label} returned HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }

    return parseNuclearVlmCompletion(config, await response.json());
};
