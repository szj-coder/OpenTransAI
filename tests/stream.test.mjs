import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { translate, DEFAULT_SETTINGS } from '../extension/lib/core.js';
const settings = { ...DEFAULT_SETTINGS, apiKey: 'test-only' };
const result = { sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好，世界。\n"流式" 😀' };
const raw = JSON.stringify(result);
const event = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\r\n\r\n`;
function events(provider, text, done = true) {
  const parts = [text.slice(0, 72), text.slice(72, 77), text.slice(77)];
  if (provider === 'anthropic') return parts.map(text => event({ type: 'content_block_delta', delta: { type: 'text_delta', text } })).join('') + (done ? event({ type: 'message_stop' }) : '');
  if (provider === 'gemini') return parts.map((text, i) => event({ candidates: [{ content: { parts: [{ text }] }, ...(done && i === 2 ? { finishReason: 'STOP' } : {}) }] })).join('');
  return parts.map(content => event({ choices: [{ delta: { content } }] })).join('') + (done ? event('[DONE]') : '');
}
function response(wire) {
  const bytes = new TextEncoder().encode(wire); let i = 0;
  return new Response(new ReadableStream({ pull(controller) { if (i === bytes.length) return controller.close(); controller.enqueue(bytes.slice(i, ++i)); } }), { headers: { 'Content-Type': 'text/event-stream' } });
}
for (const provider of ['openai', 'anthropic', 'gemini']) {
  test(`${provider} 流处理跨字节中文、JSON 转义、分片并在结束前输出`, async () => {
    const updates = []; let request;
    const actual = await translate('hello', { ...settings, provider }, { onProgress: value => updates.push(value), fetchImpl: async (url, init) => { request = { url, body: JSON.parse(init.body) }; return response(events(provider, raw)); } });
    assert.deepEqual(actual, result);
    assert(updates.some(value => value.translation.length > 0 && value.translation.length < result.translation.length));
    assert(updates.every(value => !value.translation.includes('sourceLanguage')));
    if (provider === 'gemini') assert.match(request.url, /:streamGenerateContent\?alt=sse$/);
    else assert.equal(request.body.stream, true);
  });
}
test('错误方向不泄出临时译文；缺失流结束标记明确失败', async () => {
  const updates = [];
  await assert.rejects(translate('hello', settings, { onProgress: v => updates.push(v), fetchImpl: async () => response(events('openai', JSON.stringify({ ...result, targetLanguage: 'ja' }))) }), /方向/);
  assert.equal(updates.length, 0);
  await assert.rejects(translate('hello', settings, { onProgress() {}, fetchImpl: async () => response(events('openai', raw, false)) }), /中断|完整/);
});
test('流内错误不回显远端消息；截断不能算成功', async () => {
  await assert.rejects(translate('hello', settings, { onProgress() {}, fetchImpl: async () => response(event({ error: { message: 'secret-key', type: 'error' } })) }), error => !error.message.includes('secret-key') && /服务/.test(error.message));
  await assert.rejects(translate('hello', settings, { onProgress() {}, fetchImpl: async () => response(event({ choices: [{ delta: {}, finish_reason: 'length' }] })) }), /截断/);
});
test('真实 HTTP SSE 首段显示时服务尚未结束；可主动中止', async t => {
  let finish; let ended = false;
  const barrier = new Promise(resolve => { finish = resolve; });
  const server = createServer(async (req, res) => {
    for await (const ignored of req) { void ignored; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(event({ choices: [{ delta: { content: '{"sourceLanguage":"en","targetLanguage":"zh-CN","translation":"你好' } }] }));
    await barrier; ended = true; res.end(event('[DONE]'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { finish(); server.closeAllConnections(); server.close(); });
  const controller = new AbortController(); let partial;
  const pending = translate('hello', { ...settings, baseUrl: `http://127.0.0.1:${server.address().port}/v1` }, { signal: controller.signal, onProgress(value) { partial = value.translation; assert.equal(ended, false); controller.abort(); } });
  await assert.rejects(pending, /取消/);
  assert.equal(partial, '你好');
});
test('兼容服务忽略 stream 时仍解析完整 JSON，不伪造分片', async () => {
  const updates = [];
  const actual = await translate('hello', settings, { onProgress: v => updates.push(v), fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } }) });
  assert.deepEqual(actual, result); assert.deepEqual(updates, []);
});
test('已开始的流停止传输也会超时并取消 reader', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { content: '{"sourceLanguage":"en","targetLanguage":"zh-CN","translation":"你' } }] }))); }, cancel() { cancelled = true; } });
  await assert.rejects(translate('hello', settings, { timeoutMs: 20, onProgress() {}, fetchImpl: async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }) }), /超时/);
  assert.equal(cancelled, true);
});

test('阶段由真实思考和正文事件驱动，去重且不暴露内部推理文本', async () => {
  const phases = [], updates = [];
  const thought = event({ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING_ONLY' } }] });
  const wire = thought + thought + events('openai', raw);
  const actual = await translate('hello', settings, {
    onPhase: value => phases.push(value), onProgress: value => updates.push(value),
    fetchImpl: async () => response(wire),
  });
  assert.deepEqual(phases, ['waiting', 'thinking', 'translating']);
  assert.deepEqual(actual, result);
  assert.equal(JSON.stringify({ phases, updates, actual }).includes('PRIVATE_REASONING_ONLY'), false);
});

test('没有思考事件时不伪造思考阶段，取消后不发送后续状态', async () => {
  const phases = [];
  await translate('hello', settings, { onPhase: value => phases.push(value), onProgress() {}, fetchImpl: async () => response(events('openai', raw)) });
  assert.deepEqual(phases, ['waiting', 'translating']);
  const controller = new AbortController(), cancelledPhases = [];
  await assert.rejects(translate('hello', settings, {
    signal: controller.signal,
    onPhase(value) { cancelledPhases.push(value); if (value === 'thinking') controller.abort(); },
    onProgress() { assert.fail('取消后仍更新译文'); },
    fetchImpl: async () => response(event({ choices: [{ delta: { reasoning_content: 'private' } }] }) + events('openai', raw)),
  }), /取消/);
  assert.deepEqual(cancelledPhases, ['waiting', 'thinking']);
});
