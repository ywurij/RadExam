import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildNuclearVlmRequest,
    isRequestedModelInstalled,
    parseNuclearVlmCompletion,
    resolveNuclearVlmProviderConfig
} from '../src/lib/server/nuclearVlmProvider.mjs';

const schema = {
    type: 'object',
    properties: { groups: { type: 'array' } },
    required: ['groups']
};

test('uses Ollama by default and keeps the 2B model', () => {
    const config = resolveNuclearVlmProviderConfig({});
    assert.equal(config.kind, 'ollama');
    assert.equal(config.model, 'qwen3-vl:2b-instruct');
});

test('auto-selects an embedded provider when Electron supplies its URL', () => {
    const config = resolveNuclearVlmProviderConfig({
        NUCLEAR_VLM_PROVIDER: 'auto',
        NUCLEAR_VLM_EMBEDDED_URL: 'http://127.0.0.1:11999/',
        NUCLEAR_VLM_EMBEDDED_MODEL: 'qwen3-vl:2b-instruct'
    });
    assert.equal(config.kind, 'embedded');
    assert.equal(config.baseUrl, 'http://127.0.0.1:11999');
});

test('builds an OpenAI-compatible multimodal request for the embedded runtime', () => {
    const config = resolveNuclearVlmProviderConfig({ NUCLEAR_VLM_PROVIDER: 'embedded' });
    const request = buildNuclearVlmRequest(config, {
        prompt: 'group these figures',
        imageDataUrl: 'data:image/jpeg;base64,abc',
        imageBase64: 'abc',
        schema
    });
    assert.equal(request.url, 'http://127.0.0.1:11435/v1/chat/completions');
    assert.equal(request.body.messages[0].content[1].type, 'image_url');
    assert.deepEqual(request.body.response_format.schema, schema);
    assert.equal(request.body.chat_template_kwargs.enable_thinking, false);
});

test('keeps the Ollama request shape for backwards compatibility', () => {
    const config = resolveNuclearVlmProviderConfig({ NUCLEAR_VLM_PROVIDER: 'ollama' });
    const request = buildNuclearVlmRequest(config, {
        prompt: 'group these figures',
        imageDataUrl: 'data:image/jpeg;base64,abc',
        imageBase64: 'abc',
        schema
    });
    assert.equal(request.url, 'http://127.0.0.1:11434/api/chat');
    assert.deepEqual(request.body.messages[0].images, ['abc']);
    assert.deepEqual(request.body.format, schema);
});

test('parses both provider response formats', () => {
    assert.deepEqual(
        parseNuclearVlmCompletion({ kind: 'embedded' }, {
            choices: [{ message: { content: '{"groups":[]}' }, finish_reason: 'stop' }]
        }),
        { content: '{"groups":[]}', doneReason: 'stop' }
    );
    assert.equal(isRequestedModelInstalled([{ id: 'qwen3-vl:2b-instruct' }], 'qwen3-vl:2b-instruct'), true);
});
