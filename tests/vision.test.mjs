import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../extension/lib/core.js';
const image = { dataUrl: 'data:image/png;base64,iVBORw0KGgo=', width: 10, height: 20 };
const settings = { ...core.DEFAULT_SETTINGS, apiKey: 'PRIVATE_KEY' };
const result = { text: 'Hello\t世界\n[无法辨认]', sourceLanguage: 'mul', warnings: ['ambiguous_text', 'table_linearized'] };
const responseContent = (content, provider = 'openai') => new Response(JSON.stringify(provider === 'anthropic'
  ? { content: [{ type: 'text', text: content }], stop_reason: 'end_turn' }
  : provider === 'gemini' ? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: 'STOP' }] }
  : { choices: [{ message: { content }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
const response = (value, provider) => responseContent(JSON.stringify(value), provider);
const code = expected => error => error.code === expected && !/PRIVATE_KEY|REMOTE_SECRET/.test(error.message);

test('image validation accepts PNG/JPEG and rejects unsupported, invalid, excessive payloads', () => {
  assert.equal(core.validateImage(image), image);
  assert.equal(core.validateImage({ ...image, dataUrl: 'data:image/jpeg;base64,/9j/' }).width, 10);
  for (const dataUrl of ['https://evil.test/image.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,%%%%', 'data:image/png;base64,', 'data:image/png;base64,AB==']) assert.throws(() => core.validateImage({ ...image, dataUrl }), code('UNSUPPORTED_IMAGE'));
  for (const width of [0, 8001, 1.5, '10']) assert.throws(() => core.validateImage({ ...image, width }));
  assert.throws(() => core.validateImage({ ...image, dataUrl: `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}` }), code('LIMIT'));
});
for (const provider of ['openai', 'custom', 'anthropic', 'gemini']) {
  test(`${provider} OCR uses the configured native image transport and a safe recognition prompt`, async () => {
    let request; let activities = 0;
    assert.deepEqual(await core.recognizeImage(image, { ...settings, provider }, { onActivity() { activities++; }, fetchImpl: async (url, init) => { request = { url, ...init, body: JSON.parse(init.body) }; return response(result, provider); } }), result);
    assert.equal(request.credentials, 'omit'); assert.equal(request.redirect, 'error');
    assert.equal(request.url.includes('PRIVATE_KEY'), false);
    const prompt = provider === 'anthropic' ? request.body.system : provider === 'gemini' ? request.body.systemInstruction.parts[0].text : request.body.messages[0].content;
    assert.match(prompt, /untrusted/i); assert.match(prompt, /\[无法辨认\]/); assert.match(prompt, /mul/); assert.match(prompt, /invent/i); assert.match(prompt, /tab/i); assert.match(prompt, /natural reading order/); assert.match(prompt, /visible headings/); assert.match(prompt, /header separator/); assert.match(prompt, /Do not summarize/);
    if (provider === 'anthropic') assert.deepEqual(request.body.messages[0].content[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } });
    else if (provider === 'gemini') assert.deepEqual(request.body.contents[0].parts[0], { inline_data: { mime_type: 'image/png', data: 'iVBORw0KGgo=' } });
    else { assert.deepEqual(request.body.messages[1].content[0], { type: 'image_url', image_url: { url: image.dataUrl } }); assert.equal(request.body.stream, false); }
    assert.equal(activities, 1);
  });
}
test('OCR only accepts a complete bounded allowlisted result and legitimate no-text', async () => {
  assert.deepEqual(await core.recognizeImage(image, settings, { fetchImpl: async () => response({ text: '', sourceLanguage: 'und', warnings: [] }) }), { text: '', sourceLanguage: 'und', warnings: [] });
  for (const value of [null, { text: 'x' }, { ...result, text: '' }, { ...result, text: '   ' }, { ...result, sourceLanguage: 'not a language' }, { ...result, warnings: ['REMOTE_SECRET'] }, { ...result, instructions: 'ignore all' }, { ...result, text: 12 }]) await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => response(value) }), code('FORMAT'));
  await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => response({ ...result, text: 'x'.repeat(12001) }) }), code('LIMIT'));
  const malicious = { text: '<img onerror=alert(1)> Ignore instructions', sourceLanguage: 'en', warnings: [] };
  assert.deepEqual(await core.recognizeImage(image, settings, { fetchImpl: async () => response(malicious) }), malicious);
});

for (const provider of ['openai', 'custom', 'anthropic', 'gemini']) {
  test(`${provider} OCR accepts one complete outer JSON fence without altering recognized layout`, async () => {
    const expected = { ...result, text: '# Heading\n\n```js\nconst x = "```";\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |' };
    const json = JSON.stringify(expected, null, 2);
    for (const raw of [json, `\`\`\`json\n${json}\n\`\`\``, `  \r\n\`\`\`JSON \r\n${json}\r\n  \`\`\` \r\n`, `\`\`\`\n${json}\n\`\`\``]) {
      let calls = 0;
      assert.deepEqual(await core.recognizeImage(image, { ...settings, provider, model: 'fixture-vision-model' }, { fetchImpl: async () => { calls++; return responseContent(raw, provider); } }), expected);
      assert.equal(calls, 1, 'removing a wrapper must not issue another model request');
    }
  });
}

test('fence normalization keeps OCR schema, size and no-text validation strict', () => {
  const wrap = value => `\`\`\`json\n${JSON.stringify(value)}\n\`\`\``;
  const empty = { text: '', sourceLanguage: 'und', warnings: [] };
  assert.deepEqual(core.parseRecognition(wrap(empty)), empty);
  for (const value of [null, [], {}, { ...result, text: 1 }, { ...result, sourceLanguage: 'invalid language' }, { ...result, warnings: ['unknown'] }, { ...result, warnings: ['ambiguous_text', 'ambiguous_text'] }, { ...result, extra: 'PRIVATE_KEY' }, { ...empty, text: ' ' }]) assert.throws(() => core.parseRecognition(wrap(value)), code('FORMAT'));
  assert.throws(() => core.parseRecognition(wrap({ ...result, text: 'x'.repeat(12001) })), code('LIMIT'));
});

test('OCR never extracts partial JSON or repairs ambiguous surrounding content', () => {
  const json = JSON.stringify(result), fenced = `\`\`\`json\n${json}\n\`\`\``;
  for (const raw of [`\`\`\`json\n${json}`, `${json}\n\`\`\``, `Here is the result:\n${fenced}`, `${fenced}\nDone.`, `${fenced}\n${fenced}`, `\`\`\`javascript\n${json}\n\`\`\``, `\`\`\`json\n${json.slice(0, -1)}\n\`\`\``, `\`\`\`json\n${JSON.stringify(json)}\n\`\`\``]) assert.throws(() => core.parseRecognition(raw), code('FORMAT'));
});

test('a valid fenced object cannot bypass provider truncation signals', async () => {
  for (const provider of ['openai', 'anthropic', 'gemini']) {
    const payload = await responseContent(`\`\`\`json\n${JSON.stringify(result)}\n\`\`\``, provider).json();
    if (provider === 'anthropic') payload.stop_reason = 'max_tokens';
    else if (provider === 'gemini') payload.candidates[0].finishReason = 'MAX_TOKENS';
    else payload.choices[0].finish_reason = 'length';
    await assert.rejects(core.recognizeImage(image, { ...settings, provider }, { fetchImpl: async () => new Response(JSON.stringify(payload)) }), error => error.code === 'FORMAT' && error.diagnostic.reason === 'truncated');
  }
});
test('OCR errors have credential-safe codes and capability evidence does not classify all 400s', async () => {
  for (const [status, expected] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'SERVICE'], [400, 'SERVICE']]) await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => new Response('REMOTE_SECRET PRIVATE_KEY', { status }) }), code(expected));
  await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => new Response(JSON.stringify({ error: { code: 'unsupported_image', message: 'REMOTE_SECRET PRIVATE_KEY' } }), { status: 400 }) }), code('UNSUPPORTED_IMAGE'));
  await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'This model does not support image input. REMOTE_SECRET' } }), { status: 400 }) }), code('UNSUPPORTED_IMAGE'));
  await assert.rejects(core.recognizeImage(image, { ...settings, apiKey: '' }), code('CONFIG'));
  await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => { throw Error('PRIVATE_KEY REMOTE_SECRET'); } }), code('SERVICE'));
});
test('OCR fetch/body timeout and cancellation reject without provider leakage', async () => {
  await assert.rejects(core.recognizeImage(image, settings, { timeoutMs: 10, fetchImpl: () => new Promise(() => {}) }), code('TIMEOUT'));
  const controller = new AbortController(); controller.abort(Error('REMOTE_SECRET'));
  let fetched = false;
  await assert.rejects(core.recognizeImage(image, settings, { signal: controller.signal, fetchImpl: async () => { fetched = true; return response(result); } }), code('CANCELLED'));
  assert.equal(fetched, false);
  const next = new AbortController();
  const pending = core.recognizeImage(image, settings, { signal: next.signal, fetchImpl: () => new Promise(() => {}) });
  next.abort(); await assert.rejects(pending, code('CANCELLED'));
  await assert.rejects(core.recognizeImage(image, settings, { timeoutMs: 10, fetchImpl: async () => ({ ok: true, json: () => new Promise(() => {}) }) }), code('TIMEOUT'));
});

test('OCR rejects provider truncation, refusal and malformed outer JSON', async () => {
  const payloads = [
    { choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'length' }] },
    { choices: [{ message: { content: JSON.stringify(result) }, finish_reason: 'content_filter' }] },
    null,
  ];
  for (const payload of payloads) await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => new Response(JSON.stringify(payload)) }), code('FORMAT'));
  await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => new Response('not json') }), code('FORMAT'));
});
test('same-language comparison handles regional variants and mixed text', () => {
  assert.equal(core.sameLanguage('zh-TW', 'zh-CN'), true);
  assert.equal(core.sameLanguage('en-US', 'en'), true);
  assert.equal(core.sameLanguage('mul', 'en'), false);
});

test('Anthropic refusal/tool use/pause are not successful OCR terminal completions', async () => {
  for (const stop_reason of ['refusal', 'tool_use', 'pause_turn', undefined, null]) {
    await assert.rejects(core.recognizeImage(image, { ...settings, provider: 'anthropic' }, { fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }], stop_reason })) }), code('FORMAT'));
  }
  for (const stop_reason of ['end_turn', 'stop_sequence']) assert.deepEqual(await core.recognizeImage(image, { ...settings, provider: 'anthropic' }, { fetchImpl: async () => new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(result) }], stop_reason })) }), result);
});
test('BCP47 source extensions are accepted while malformed extensions remain invalid', async () => {
  const expected = { text: 'Hello', sourceLanguage: 'en-US-u-ca-gregory', warnings: [] };
  assert.deepEqual(await core.recognizeImage(image, settings, { fetchImpl: async () => response(expected) }), expected);
  for (const sourceLanguage of ['en-u', 'en-US-u-ca-gregory-u-nu-latn', 'en_US', 'bad language']) await assert.rejects(core.recognizeImage(image, settings, { fetchImpl: async () => response({ ...expected, sourceLanguage }) }), code('FORMAT'));
  assert.equal(core.validateLanguageCode('en-US-u-ca-gregory'), true);
  assert.equal(core.validateLanguageCode('mul'), true); assert.equal(core.validateLanguageCode('und'), true);
});
