import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../extension/lib/service.js';
import { DEFAULT_SETTINGS } from '../extension/lib/core.js';
import { webcrypto } from 'node:crypto';
globalThis.crypto ||= webcrypto;
const sender = { id: 'extension', tab: { id: 7 }, frameId: 0, url: 'https://x.com/home' };
const trusted = { id: 'extension', url: 'chrome-extension://extension/popup.html' };
const request = (taskId, requestId = taskId) => ({ type: 'TRANSLATE', scope: 'x-post', taskId, requestId, text: 'Hello' });
function fixture() {
  let settings = { ...DEFAULT_SETTINGS, apiKey: 'secret-fixture' }, revision = 'initial';
  const calls = [], notifications = [];
  const api = { runtime: { id: 'extension', getURL: p => 'chrome-extension://extension/' + p },
    storage: { local: { setAccessLevel: async () => {}, get: async () => ({ settings, configurationRevision: revision }), set: async value => { settings = value.settings; revision = value.configurationRevision; } } },
    permissions: { contains: async () => true },
    tabs: { sendMessage: async (...args) => notifications.push(args) },
  };
  const service = createService(api, { fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
    calls.push({ signal: init.signal, finish: () => resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好' }) } }] }))) });
    init.signal.addEventListener('abort', () => reject(Object.assign(Error('cancel'), { name: 'AbortError' })), { once: true });
  }) });
  return { service, calls, notifications, start: (message, origin = sender) => service.handle(message, origin).then(data => ({ data }), error => ({ error })) };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('different X posts and the ordinary panel can translate without cancelling each other', async () => {
  const f = fixture();
  const a = f.start(request('post-a')); await flush();
  const b = f.start(request('post-b')); await flush();
  const panel = f.start({ type: 'TRANSLATE', requestId: 'panel', text: 'Hello' }); await flush();
  const aborted = f.calls.map(call => call.signal.aborted);
  f.calls.forEach(call => call.finish());
  const results = await Promise.all([a, b, panel]);
  assert.deepEqual(aborted, [false, false, false]);
  assert(results.every(result => result.data?.translation === '你好'));
});

test('scoped cancellation cannot cancel another post, frame, tab or ordinary panel', async () => {
  const f = fixture(); const a = f.start(request('post-a', 'req')); await flush();
  for (const [taskId, origin] of [['post-b', sender], ['post-a', { ...sender, frameId: 1 }], ['post-a', { ...sender, tab: { id: 8 } }]]) {
    await f.service.handle({ type: 'CANCEL', scope: 'x-post', taskId, requestId: 'req' }, origin);
    assert.equal(f.calls[0].signal.aborted, false);
  }
  await f.service.handle({ type: 'CANCEL', requestId: 'req' }, sender);
  assert.equal(f.calls[0].signal.aborted, false);
  await f.service.handle({ type: 'CANCEL', scope: 'x-post', taskId: 'post-a', requestId: 'req' }, sender);
  const aborted = f.calls[0].signal.aborted; f.calls[0].finish(); await a;
  assert.equal(aborted, true);
});

test('X scope rejects non-X origins, spoofed hosts, unknown scopes and invalid task identifiers before fetch', async () => {
  const f = fixture();
  for (const url of ['https://example.com/', 'https://x.com.evil.test/', 'http://x.com/']) {
    const result = f.start(request('post'), { ...sender, url }); await flush(); f.calls.forEach(call => call.finish());
    assert((await result).error, url);
  }
  for (const fields of [{ taskId: '' }, { taskId: '../other' }, { scope: 'other' }]) {
    const result = f.start({ ...request('post'), ...fields }); await flush(); f.calls.forEach(call => call.finish());
    assert((await result).error);
  }
  assert.equal(f.calls.length, 0);
});

test('five active task limit is shared and tab cleanup cancels every scoped request', async () => {
  const f = fixture(), pending = [];
  for (let i = 0; i < 5; i++) { pending.push(f.start(request('post-' + i))); await flush(); }
  const sixth = f.start(request('sixth')); await flush();
  f.service.forgetTab(7); const aborted = f.calls.map(call => call.signal.aborted);
  f.calls.forEach(call => call.finish()); const last = await sixth; await Promise.all(pending);
  assert(last.error); assert.equal(f.calls.length, 5); assert(aborted.every(Boolean));
});

test('settings and enable changes notify registered X pages using public status only', async () => {
  const f = fixture();
  await f.service.handle({ type: 'STATUS' }, sender);
  await f.service.handle({ type: 'STATUS' }, { ...sender, tab: { id: 8 }, url: 'https://example.com/' });
  await f.service.handle({ type: 'SET_ENABLED', enabled: false }, trusted);
  await f.service.handle({ type: 'SETTINGS_SAVE', settings: { ...DEFAULT_SETTINGS, apiKey: 'second-secret', model: 'new-model' } }, trusted);
  assert.equal(f.notifications.length, 2);
  assert(f.notifications.every(([tab, msg]) => tab === 7 && msg.type === 'STATUS_CHANGED' && msg.data.enabled === false));
  assert.notEqual(f.notifications[0][1].data.configRevision, f.notifications[1][1].data.configRevision);
  assert.doesNotMatch(JSON.stringify(f.notifications), /secret|apiKey|baseUrl/);
  f.service.forgetTab(7);
  await f.service.handle({ type: 'SET_ENABLED', enabled: true }, trusted);
  assert.equal(f.notifications.length, 2);
});
