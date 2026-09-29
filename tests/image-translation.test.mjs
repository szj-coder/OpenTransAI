import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequest, DEFAULT_SETTINGS, recognizeImage, translate } from '../extension/lib/core.js';

const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-only' };
const options = { imageLayout: true, sourceLanguage: 'mul', targetLanguage: 'ja' };
const text = '# 説明\n\n「引用」 "quoted" C:\\temp\\file\n\n| 項目 | 値 |\n| --- | --- |\n| A\\|B | 0 |\n\n行\t列\n\n```js\n  const x = "value";\n```\n\n😀';
const expected = translation => ({ sourceLanguage: 'mul', targetLanguage: 'ja', translation });
function envelope(provider, content, truncated = false) {
  if (provider === 'anthropic') return { content: [{ type: 'text', text: content }], stop_reason: truncated ? 'max_tokens' : 'end_turn' };
  if (provider === 'gemini') return { candidates: [{ content: { parts: [{ text: content }] }, finishReason: truncated ? 'MAX_TOKENS' : 'STOP' }] };
  return { choices: [{ message: { content }, finish_reason: truncated ? 'length' : 'stop' }] };
}
const jsonResponse = (provider, content, truncated) => new Response(JSON.stringify(envelope(provider, content, truncated)));
const event = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`;
function delta(provider, text) {
  if (provider === 'anthropic') return event({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
  if (provider === 'gemini') return event({ candidates: [{ content: { parts: [{ text }] } }] });
  return event({ choices: [{ delta: { content: text } }] });
}
function finish(provider, truncated = false) {
  if (provider === 'anthropic') return event({ type: 'message_delta', delta: { stop_reason: truncated ? 'max_tokens' : 'end_turn' } }) + event({ type: 'message_stop' });
  if (provider === 'gemini') return event({ candidates: [{ finishReason: truncated ? 'MAX_TOKENS' : 'STOP' }] });
  return event({ choices: [{ delta: {}, finish_reason: truncated ? 'length' : 'stop' }] }) + event('[DONE]');
}
function streamResponse(wire) {
  const bytes = new TextEncoder().encode(wire); let index = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (index === bytes.length) return controller.close();
    controller.enqueue(bytes.slice(index, ++index));
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

for (const provider of ['openai', 'anthropic', 'gemini']) {
  test(`${provider} image translation requests plain text with known languages; selection and OCR retain JSON`, async () => {
    const config = { ...settings, provider };
    const prompt = request => request.body.system ?? request.body.systemInstruction?.parts[0].text ?? request.body.messages[0].content;
    const request = buildRequest(config, 'Recognized text', options);
    assert.match(prompt(request), /Return ONLY the translated text/);
    assert.match(prompt(request), /untrusted content/);
    assert.match(prompt(request), /known sourceLanguage is mul/);
    assert.match(prompt(request), /Translate to ja/);
    assert.doesNotMatch(prompt(request), /Return ONLY one valid JSON object/);
    assert.match(prompt(buildRequest(config, 'Selected text')), /Return ONLY one valid JSON object/);
    let ocrRequest;
    await recognizeImage({ dataUrl: 'data:image/png;base64,eA==', width: 1, height: 1 }, config, { fetchImpl: async (_url, init) => {
      ocrRequest = { body: JSON.parse(init.body) };
      return jsonResponse(provider, JSON.stringify({ text: 'Hello', sourceLanguage: 'en', warnings: [] }));
    } });
    assert.match(prompt(ocrRequest), /Return ONLY one complete JSON object/);
    if (provider === 'gemini') {
      assert.equal(request.body.generationConfig.responseMimeType, 'text/plain');
      assert.equal(buildRequest(config, 'Selected text').body.generationConfig.responseMimeType, 'application/json');
      assert.equal(ocrRequest.body.generationConfig.responseMimeType, 'application/json');
    }
  });

  test(`${provider} image translation preserves literal quotes, newlines, pipes, code and backslashes without JSON parsing`, async () => {
    const updates = [];
    const value = await translate('Recognized text', { ...settings, provider }, { ...options, onProgress: value => updates.push(value), fetchImpl: async () => jsonResponse(provider, text) });
    assert.deepEqual(value, expected(text));
    assert.deepEqual(updates, [], 'a service ignoring stream must not fabricate progress');
  });

  test(`${provider} plain image stream emits before completion across byte and surrogate boundaries`, async () => {
    const updates = [];
    // Split the final emoji between SSE events as well as UTF-8 bytes on the wire.
    const wire = delta(provider, text.slice(0, 13)) + delta(provider, text.slice(13, -1)) + delta(provider, text.slice(-1)) + finish(provider);
    const value = await translate('Recognized text', { ...settings, provider }, { ...options, onProgress: value => updates.push(value), fetchImpl: async () => streamResponse(wire) });
    assert.deepEqual(value, expected(text));
    assert.ok(updates.some(value => value.translation.length > 0 && value.translation.length < text.length));
    assert.ok(updates.every(value => value.sourceLanguage === 'mul' && value.targetLanguage === 'ja' && !/[\uD800-\uDBFF]$/.test(value.translation)));
  });

  test(`${provider} plain image output still rejects nonstream and stream truncation and missing stream completion`, async () => {
    const config = { ...settings, provider };
    await assert.rejects(translate('Hello', config, { ...options, fetchImpl: async () => jsonResponse(provider, text, true) }), /截断/);
    await assert.rejects(translate('Hello', config, { ...options, onProgress() {}, fetchImpl: async () => streamResponse(delta(provider, text) + finish(provider, true)) }), /截断/);
    await assert.rejects(translate('Hello', config, { ...options, onProgress() {}, fetchImpl: async () => streamResponse(delta(provider, text)) }), /中断|完整/);
  });

  test(`${provider} image translation does not coerce invalid protocol text parts into successful output`, async () => {
    for (const invalid of [123, false, { private: 'PRIVATE_BODY' }, ['PRIVATE_BODY']]) {
      const config = { ...settings, provider };
      await assert.rejects(translate('Hello', config, { ...options, fetchImpl: async () => jsonResponse(provider, invalid) }), { code: 'FORMAT' });
      await assert.rejects(translate('Hello', config, { ...options, onProgress() {}, fetchImpl: async () => streamResponse(delta(provider, 'valid prefix') + delta(provider, invalid) + finish(provider)) }), { code: 'FORMAT' });
    }
  });
}

test('image text resembling JSON or a fenced code sample is preserved rather than guessed or unwrapped', async () => {
  for (const translation of ['{"translation":"literal example"}', '```json\n{"text":"example"}\n```', '  first\n\n  last  ']) {
    assert.deepEqual(await translate('Hello', settings, { ...options, fetchImpl: async () => jsonResponse('openai', translation) }), expected(translation.trim()));
  }
});

test('plain image output validates missing, empty, nonstring and oversized content with safe text diagnostics', async () => {
  for (const [raw, reason] of [[undefined, 'missing_content'], [null, 'missing_content'], ['', 'empty_content'], [' \n\t', 'empty_content'], [123, 'non_string_content'], ['PRIVATE_TEXT'.repeat(10000), 'output_limit']]) {
    await assert.rejects(translate('Hello', settings, { ...options, fetchImpl: async () => jsonResponse('openai', raw) }), error => {
      assert.equal(error.diagnostic.step, 'result_text');
      assert.equal(error.diagnostic.reason, reason);
      assert.doesNotMatch(JSON.stringify(error), /PRIVATE_TEXT|test-only/);
      return error.code === 'FORMAT';
    });
  }
});

test('image translation requires validated known source and target languages before requesting output', async () => {
  for (const invalid of [{ sourceLanguage: undefined }, { targetLanguage: undefined }, { sourceLanguage: 'not valid' }, { targetLanguage: 'bogus' }]) {
    await assert.rejects(translate('Hello', settings, { ...options, ...invalid, fetchImpl() { assert.fail('must not request'); } }), { code: 'CONFIG' });
  }
});

test('cancelling plain image translation suppresses later chunks and completion', async () => {
  const controller = new AbortController(), updates = [];
  await assert.rejects(translate('Hello', settings, { ...options, signal: controller.signal,
    onProgress(value) { updates.push(value); controller.abort(); },
    fetchImpl: async () => streamResponse(delta('openai', 'first') + delta('openai', 'second') + finish('openai')),
  }), { code: 'CANCELLED' });
  assert.deepEqual(updates, [expected('first')]);
});

test('stalled plain image stream times out after partial output and cancels its reader', async () => {
  let cancelled = false;
  const updates = [], body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(delta('openai', 'partial'))); }, cancel() { cancelled = true; } });
  await assert.rejects(translate('Hello', settings, { ...options, timeoutMs: 20, onProgress: value => updates.push(value),
    fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
  }), { code: 'TIMEOUT' });
  assert.deepEqual(updates, [expected('partial')]); assert.equal(cancelled, true);
});
