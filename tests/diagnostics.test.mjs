import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createService } from '../extension/lib/service.js';
import { DEFAULT_SETTINGS, recognizeImage, translate } from '../extension/lib/core.js';
import { createDiagnostics, DIAGNOSTIC_TTL } from '../extension/lib/diagnostics.js';
globalThis.crypto ||= webcrypto;
const settings = { ...DEFAULT_SETTINGS, apiKey: 'PRIVATE_KEY' };
const image = { dataUrl: 'data:image/png;base64,eA==', width: 1, height: 1 };
const sender = { id: 'test', tab: { id: 7 }, url: 'https://page.example/private' };
const viewer = { id: 'test', url: 'chrome-extension://test/diagnostics.html' };
const popup = { id: 'test', url: 'chrome-extension://test/popup.html' };
const response = content => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));

test('OCR format errors describe content shape without retaining content or parser excerpts', async () => {
  for (const [raw, reason] of [[undefined, 'missing_content'], ['', 'empty_content'], ['```json\n{}', 'markdown_fence'], ['```json\n{}\n```', 'invalid_schema'], ['PRIVATE_KEY sensitive OCR', 'invalid_json'], ['{"text":123}', 'invalid_schema']]) {
    await assert.rejects(recognizeImage(image, settings, { fetchImpl: async () => response(raw) }), error => {
      assert.equal(error.diagnostic?.stage, 'recognition');
      assert.equal(error.diagnostic?.reason, reason);
      assert.equal(error.diagnostic?.httpStatus, 200);
      assert.doesNotMatch(JSON.stringify(error.diagnostic), /PRIVATE_KEY|sensitive OCR/);
      return error.code === 'FORMAT';
    });
  }
});

test('transport diagnostics distinguish HTTP, outer JSON, truncation, network and timeout', async () => {
  const cases = [
    [async () => new Response('PRIVATE_KEY', { status: 429 }), 'http_error', 429],
    [async () => new Response('<html>PRIVATE_KEY</html>'), 'response_json', 200],
    [async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length' }] })), 'truncated', 200],
    [async () => { throw Error('PRIVATE_KEY'); }, 'network', undefined],
    [() => new Promise(() => {}), 'timeout', undefined],
  ];
  for (const [fetchImpl, reason, status] of cases) await assert.rejects(recognizeImage(image, settings, { fetchImpl, timeoutMs: 20 }), error => {
    assert.equal(error.diagnostic?.reason, reason);
    assert.equal(error.diagnostic?.httpStatus, status);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_KEY/);
    return true;
  });
});

test('translation parsing and stream failures carry their own stage', async () => {
  for (const [fetchImpl, reason, extra] of [
    [async () => response('PRIVATE_KEY invalid'), 'invalid_json', {}],
    [async () => response('```json\n{}\n```'), 'invalid_schema', {}],
    [async () => new Response('data: invalid\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), 'stream_error', { onProgress() {} }],
  ]) await assert.rejects(translate('private original', settings, { fetchImpl, ...extra }), error => {
    assert.equal(error.diagnostic?.stage, 'translation');
    assert.equal(error.diagnostic?.reason, reason);
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_KEY|private original/);
    return true;
  });
});

function fixture(fetchImpl = async () => response('```json\n{}\n```')) {
  const values = { settings: { ...settings }, configurationRevision: 'revision-1' };
  const api = {
    runtime: { id: 'test', getURL: p => 'chrome-extension://test/' + p },
    storage: { local: { setAccessLevel: async () => {}, get: async () => structuredClone(values), set: async next => Object.assign(values, structuredClone(next)) } },
    permissions: { contains: async () => true },
  };
  return { values, api, service: createService(api, { fetchImpl }) };
}

test('errors survive service restart and correlate with requests without exposing private data', async () => {
  const f = fixture();
  await assert.rejects(f.service.handle({ type: 'TRANSLATE_IMAGE', requestId: 'request-1', taskId: 'task-1', image, sourceKind: 'image' }, sender));
  const restarted = createService(f.api);
  const { entries } = await restarted.handle({ type: 'DIAGNOSTICS_GET' }, viewer);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].requestId, 'request-1');
  assert.equal(entries[0].reason, 'invalid_schema');
  assert.equal(entries[0].provider, 'openai');
  assert.equal(entries[0].configRevision, 'revision-1');
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_KEY|data:image|private|```/);
  assert.equal(f.values.settings.apiKey, 'PRIVATE_KEY');
  await restarted.handle({ type: 'DIAGNOSTICS_CLEAR' }, viewer);
  assert.deepEqual((await restarted.handle({ type: 'DIAGNOSTICS_GET' }, viewer)).entries, []);
});

test('fenced OCR diagnostics classify the inner failure while retaining only safe metadata', async () => {
  for (const [content, reason] of [
    ['{"text":123,"sourceLanguage":"en","warnings":[],"PRIVATE_KEY":"private OCR"}', 'invalid_schema'],
    ['{"text":"private OCR" "sourceLanguage":"en","warnings":[]}', 'invalid_json'],
  ]) {
    const raw = `\`\`\`json\n${content}\n\`\`\``;
    await assert.rejects(recognizeImage(image, settings, { fetchImpl: async () => response(raw) }), error => {
      assert.equal(error.diagnostic.reason, reason);
      assert.equal(error.diagnostic.responseChars, raw.length);
      if (reason === 'invalid_schema') { assert.equal(error.diagnostic.textType, 'number'); assert.equal(error.diagnostic.fieldCount, 4); }
      assert.doesNotMatch(JSON.stringify(error.diagnostic), /PRIVATE_KEY|private OCR/);
      return error.code === 'FORMAT';
    });
  }
});

test('valid fenced recognition continues to translation without recording a format error', async () => {
  let calls = 0;
  const recognized = { text: 'Hello', sourceLanguage: 'en', warnings: [] }, seen = [];
  const f = fixture(async () => response(++calls === 1 ? `\`\`\`json\n${JSON.stringify(recognized)}\n\`\`\`` : '你好'));
  const result = await f.service.handle({ type: 'TRANSLATE_IMAGE', requestId: 'fenced', taskId: 'fenced-task', image, sourceKind: 'image' }, sender, { onRecognized(value) { seen.push(value); } });
  assert.deepEqual(seen, [recognized]); assert.equal(result.translation, '你好'); assert.equal(result.outcome, 'translated'); assert.equal(calls, 2);
  assert.deepEqual((await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer)).entries, []);
});

test('diagnostics are restricted to the viewer and popup; viewer cannot read settings', async () => {
  const f = fixture();
  for (const type of ['DIAGNOSTICS_GET', 'DIAGNOSTICS_CLEAR']) {
    for (const attacker of [sender, { ...viewer, id: 'foreign' }, { ...viewer, url: viewer.url + '/evil' }]) await assert.rejects(f.service.handle({ type }, attacker), /权限/);
    await f.service.handle({ type }, popup);
  }
  await assert.rejects(f.service.handle({ type: 'SETTINGS_GET' }, viewer), /权限/);
});

test('logging failure never replaces the original failure and successful/cancelled tasks add no entries', async () => {
  const f = fixture(async () => response(JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好' })));
  await f.service.handle({ type: 'TRANSLATE', requestId: 'ok', text: 'Hello' }, sender);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.service.handle({ type: 'TRANSLATE', requestId: 'cancel', text: 'Hello' }, sender, { signal: controller.signal }));
  assert.deepEqual((await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer)).entries, []);
  f.api.storage.local.set = async () => { throw Error('storage failure'); };
  await assert.rejects(f.service.handle({ type: 'TRANSLATE_IMAGE', requestId: 'bad', image }, sender), /格式不完整/);
});

test('bounded logs serialize concurrent writes, expire old entries and clear in order', async () => {
  let timestamp = Date.now();
  const values = { settings: { apiKey: 'untouched' } };
  const storage = { get: async () => structuredClone(values), set: async next => { await Promise.resolve(); Object.assign(values, structuredClone(next)); } };
  const log = createDiagnostics(storage, { now: () => timestamp });
  await Promise.all(Array.from({ length: 115 }, (_, i) => log.add({ requestId: `request-${i}`, reason: 'invalid_json' })));
  const entries = (await log.list()).entries;
  assert.equal(entries.length, 100);
  assert.equal(entries[0].requestId, 'request-114');
  assert.equal(entries.at(-1).requestId, 'request-15');
  assert.equal(values.settings.apiKey, 'untouched');
  timestamp += DIAGNOSTIC_TTL + 1;
  assert.deepEqual((await log.list()).entries, []);
  await Promise.all([log.add({ requestId: 'before' }), log.clear(), log.add({ requestId: 'after' })]);
  assert.deepEqual((await log.list()).entries.map(entry => entry.requestId), ['after']);
});

test('storage allowlist strips secrets, raw responses, headers, stacks and unknown fields', async () => {
  const values = {};
  const log = createDiagnostics({ get: async () => values, set: async next => Object.assign(values, next) });
  await log.add({ reason: 'invalid_json', model: 'vision-PRIVATE_KEY', requestId: 'PRIVATE_KEY', apiKey: 'PRIVATE_KEY', headers: { Authorization: 'PRIVATE_KEY' }, stack: 'secret stack', response: 'private OCR', sourceUrl: 'https://secret.example', unexpected: 'private text' }, 'PRIVATE_KEY');
  assert.doesNotMatch(JSON.stringify(values), /PRIVATE_KEY|secret|private|Authorization/);
  assert.equal((await log.list()).entries[0].model, 'vision-[redacted]');
});

test('schema diagnostics expose only known field types and numeric parser location', async () => {
  for (const provider of ['openai', 'anthropic', 'gemini']) {
    const raw = '{"text":123,"sourceLanguage":"en","warnings":[],"PRIVATE_KEY":"private OCR"}';
    const body = provider === 'openai' ? { choices: [{ message: { content: raw } }] }
      : provider === 'anthropic' ? { stop_reason: 'end_turn', content: [{ type: 'text', text: raw }] }
        : { candidates: [{ content: { parts: [{ text: raw }] }, finishReason: 'STOP' }] };
    await assert.rejects(recognizeImage(image, { ...settings, provider }, { fetchImpl: async () => new Response(JSON.stringify(body)) }), error => {
      assert.equal(error.diagnostic.textType, 'number');
      assert.equal(error.diagnostic.fieldCount, 4);
      assert.doesNotMatch(JSON.stringify(error.diagnostic), /PRIVATE_KEY|private OCR/);
      return true;
    });
  }
  const raw = '{"text":"private OCR" "sourceLanguage":"en"}';
  await assert.rejects(recognizeImage(image, settings, { fetchImpl: async () => response(raw) }), error => {
    assert.equal(error.diagnostic.reason, 'invalid_json');
    assert.ok(Number.isInteger(error.diagnostic.jsonErrorOffset));
    assert.doesNotMatch(JSON.stringify(error.diagnostic), /private OCR/);
    return true;
  });
});

test('connection tests log draft model metadata while image translation logs only the failing second stage', async () => {
  const f = fixture();
  await assert.rejects(f.service.handle({ type: 'TEST', settings: { ...settings, model: 'draft-model' } }, popup));
  assert.equal((await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer)).entries[0].model, 'draft-model');
  let calls = 0;
  const next = fixture(async () => response(++calls === 1 ? JSON.stringify({ text: 'private OCR', sourceLanguage: 'en', warnings: [] }) : ''));
  await assert.rejects(next.service.handle({ type: 'TRANSLATE_IMAGE', requestId: 'two-step', sourceKind: 'screenshot', image }, sender));
  const entries = (await next.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer)).entries;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].stage, 'translation');
  assert.equal(entries[0].sourceKind, 'screenshot');
  assert.equal(entries[0].step, 'result_text');
  assert.equal(entries[0].reason, 'empty_content');
  assert.equal(calls, 2);
});

test('HTTP failures and image read failures receive safe operation context', async () => {
  const f = fixture(async () => new Response('PRIVATE_KEY provider error', { status: 503 }));
  await assert.rejects(f.service.handle({ type: 'TRANSLATE', requestId: 'http', text: 'Hello' }, sender));
  await assert.rejects(f.service.handle({ type: 'READ_SOURCE', requestId: 'read', sourceId: 'missing' }, sender));
  const { entries } = await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].stage, 'image_read');
  assert.equal(entries[1].httpStatus, 503);
  assert.equal(entries[1].reason, 'http_error');
  assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_KEY|provider error|Hello/);
});
