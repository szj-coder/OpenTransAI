import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../extension/lib/service.js';
import { DEFAULT_SETTINGS } from '../extension/lib/core.js';
import { webcrypto } from 'node:crypto';
globalThis.crypto ||= webcrypto;

const sender = { id: 'extension-id', tab: { id: 7, windowId: 1 }, frameId: 2, documentId: 'child-doc', url: 'https://site.example/frame' };
const top = { ...sender, frameId: 0, documentId: 'top-doc' };
const popup = { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' };
function fixture({ allowed = true, imageReader, fetchImpl } = {}) {
  const messages = [], windows = [];
  let values = { settings: { ...DEFAULT_SETTINGS, apiKey: 'test-secret' } };
  const api = {
    runtime: { id: 'extension-id', getURL: p => 'chrome-extension://extension-id/' + p },
    storage: { local: { setAccessLevel: async () => {}, get: async () => values, set: async x => { values = { ...values, ...x }; } } },
    permissions: { contains: async () => allowed },
    tabs: {
      sendMessage: async (tabId, message, options) => { messages.push({ tabId, message, options }); return imageReader ? imageReader(message) : { ok: true }; },
      get: async id => ({ id, windowId: 1, active: true, url: 'https://site.example/' }),
      query: async () => [{ id: 7, windowId: 1, active: true }],
    },
    windows: { create: async options => { windows.push(options); return { id: 5 }; } },
  };
  return { ...createService(api, { fetchImpl }), api, messages, windows };
}

test('iframe trigger is routed to the one top-level panel with browser-derived source identity', async () => {
  const f = fixture();
  const result = await f.handle({ type: 'TASK_OPEN', sourceKind: 'image', token: 'img-1', url: 'https://cdn.example/p.png', anchor: { left: 4 }, tabId: 666 }, sender);
  assert.ok(result.sourceId);
  assert.equal(f.messages[0].tabId, 7);
  assert.equal(f.messages[0].options.frameId, 0);
  assert.equal(f.messages[0].message.type, 'OPEN_SOURCE');
  assert.equal(f.messages[0].message.source.frameId, 2);
  assert.equal(f.messages[0].message.anchor, null);
  assert.equal(JSON.stringify(f.messages).includes('test-secret'), false);
});

test('disabled total switch refuses image triggers before reading pixels or calling AI', async () => {
  const f = fixture();
  await f.handle({ type: 'SET_ENABLED', enabled: false }, popup);
  await assert.rejects(f.handle({ type: 'TASK_OPEN', sourceKind: 'image', token: 'x', url: 'https://cdn.example/a.png' }, sender), /关闭/);
  assert.equal(f.messages.length, 0);
});

test('image reads are bound to the selected source and tab, never an arbitrary supplied URL', async () => {
  const f = fixture({ imageReader: message => message.type === 'READ_IMAGE' ? { image: { dataUrl: 'data:image/png;base64,eA==', width: 1, height: 1 } } : { ok: true } });
  const { sourceId } = await f.handle({ type: 'TASK_OPEN', sourceKind: 'image', token: 'img-1', url: 'https://cdn.example/p.png' }, sender);
  await assert.rejects(f.handle({ type: 'READ_SOURCE', sourceId, requestId: 'one' }, { ...top, tab: { id: 8 } }), /失效|权限/);
  const result = await f.handle({ type: 'READ_SOURCE', sourceId, requestId: 'two', url: 'https://attacker.example/' }, top);
  assert.equal(result.image.width, 1);
  const read = f.messages.find(m => m.message.type === 'READ_IMAGE');
  assert.equal(read.message.token, 'img-1');
  assert.equal(read.options.documentId, 'child-doc');
});

test('public status has an opaque configuration revision, save changes it without leaking credentials', async () => {
  const f = fixture();
  const before = await f.handle({ type: 'STATUS' }, top);
  assert.equal(typeof before.configRevision, 'string');
  await f.handle({ type: 'SETTINGS_SAVE', settings: { ...DEFAULT_SETTINGS, apiKey: 'another-secret' } }, popup);
  const after = await f.handle({ type: 'STATUS' }, top);
  assert.notEqual(after.configRevision, before.configRevision);
  assert.equal(JSON.stringify(after).includes('secret'), false);
});

test('page cannot grant permissions or invoke trusted toolbar screenshot commands', async () => {
  const f = fixture();
  await assert.rejects(f.handle({ type: 'ACCESS_RESULT', token: 'x', granted: true }, top), /权限/);
  await assert.rejects(f.handle({ type: 'START_CAPTURE', tabId: 99 }, top), /权限/);
});

test('capture without host access falls back to browser sender URL and requests optional permission via trusted UI', async () => {
  const f = fixture({ allowed: false });
  // Chrome hides Tab.url until tabs/host/activeTab access exists; MessageSender.url remains browser-derived.
  f.api.tabs.get = async id => ({ id, windowId: 1, active: true });
  const result = await f.handle({ type: 'PREPARE_CAPTURE' }, top);
  assert.equal(result.allowed, false);
  await f.handle({ type: 'REQUEST_ACCESS', purpose: 'capture' }, top);
  assert.equal(f.windows.length, 1);
  assert.match(f.windows[0].url, /^chrome-extension:\/\/extension-id\/popup.html\?access=/);
});

test('selection ownership hides entries in other frames without starting translation', async () => {
  const f = fixture({ fetchImpl() { throw Error('unexpected AI request'); } });
  await f.handle({ type: 'ENTRY_CLAIM', token: 'frame2-selection' }, sender);
  assert.equal(f.messages[0].message.type, 'HIDE_ENTRY');
  assert.equal(f.messages[0].message.owner, 'frame2-selection');
});

for (const type of ['DISMISS_PANEL', 'CLOSE_PANEL']) {
test(`${type} is confined to its browser-derived tab and the top frame`, async () => {
  const f = fixture({ fetchImpl() { throw Error('unexpected AI request'); } });
  await f.handle({ type: type, at: 1234.5, tabId: 666 }, sender);
  assert.deepEqual(f.messages, [{ tabId: 7, options: { frameId: 0 }, message: { type: type, at: 1234.5 } }]);
  await f.handle({ type: 'CAPTURE_MODE', active: true }, top);
  const count = f.messages.length;
  await f.handle({ type: type, at: 1235 }, sender);
  assert.equal(f.messages.length, count, 'capture should suppress iframe dismissal');
});

test(`${type} rejects missing tab identity and invalid timestamps`, async () => {
  const f = fixture();
  for (const at of [undefined, '1234', NaN, Infinity, -1]) await assert.rejects(f.handle({ type: type, at }, sender), { code: 'FORMAT' });
  await assert.rejects(f.handle({ type: type, at: 1234 }, popup), { code: 'FORMAT' });
  assert.equal(f.messages.length, 0);
});
}

test('SHA-256 image identity runs in extension context and includes content and dimensions', async () => {
  const f = fixture();
  const image = { dataUrl: 'data:image/png;base64,eA==', width: 1, height: 1 };
  const first = await f.handle({ type: 'IMAGE_DIGEST', image }, top);
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal((await f.handle({ type: 'IMAGE_DIGEST', image }, top)).digest, first.digest);
  assert.notEqual((await f.handle({ type: 'IMAGE_DIGEST', image: { ...image, width: 2 } }, top)).digest, first.digest);
  assert.notEqual((await f.handle({ type: 'IMAGE_DIGEST', image: { ...image, dataUrl: 'data:image/png;base64,eQ==' } }, top)).digest, first.digest);
});
test('capture mode hides every frame and suppresses a newly loaded frame selection', async () => {
  const f = fixture();
  await f.handle({ type: 'CAPTURE_MODE', active: true }, top);
  assert.equal(f.messages[0].message.type, 'CAPTURE_VISIBILITY');
  assert.equal(f.messages[0].options, undefined);
  assert.deepEqual(await f.handle({ type: 'ENTRY_CLAIM', token: 'late-frame' }, sender), { suppressed: true });
  await f.handle({ type: 'CAPTURE_MODE', active: false }, top);
  assert.deepEqual(await f.handle({ type: 'ENTRY_CLAIM', token: 'late-frame' }, sender), { suppressed: false });
});
test('a tab switch away and back during capture rejects pixels even when final active tab matches', async () => {
  const viewport = { width: 800, height: 600 };
  const f = fixture({ imageReader: () => ({ valid: true, viewport }) });
  f.api.tabs.captureVisibleTab = async () => { f.captureChanged(); f.captureChanged(); return 'data:image/png;base64,eA=='; };
  await assert.rejects(f.handle({ type: 'CAPTURE_REGION', nonce: 'capture', viewport, rect: { x: 0, y: 0, width: 10, height: 10 } }, top), { code: 'CAPTURE_CHANGED' });
});

test('denied selected-image host permission stops fallback before any network request', async () => {
  let fetched = 0;
  const f = fixture({ allowed: false, fetchImpl: async () => { fetched++; throw Error('unexpected fetch'); } });
  const { sourceId } = await f.handle({ type: 'TASK_OPEN', sourceKind: 'image', token: 'cross-origin', url: 'https://cdn.example/p.png' }, sender);
  await assert.rejects(f.handle({ type: 'READ_SOURCE', sourceId, requestId: 'read-denied' }, top), { code: 'IMAGE_PERMISSION' });
  assert.equal(fetched, 0);
});

test('permission-result grant is rechecked after revocation, bound to its document, and single-use', async () => {
  const f = fixture();
  await f.handle({ type: 'REQUEST_ACCESS', purpose: 'capture', intent: 'confirmed-click' }, top);
  const token = new URL(f.windows[0].url).searchParams.get('access');
  f.api.permissions.contains = async () => false;
  await f.handle({ type: 'ACCESS_RESULT', token, granted: true }, popup);
  const result = f.messages.find(entry => entry.message.type === 'ACCESS_FINISHED');
  assert.equal(result.message.granted, false);
  assert.equal(result.message.intent, 'confirmed-click');
  assert.equal(result.tabId, top.tab.id);
  assert.equal(result.options.documentId, top.documentId);
  await assert.rejects(f.handle({ type: 'ACCESS_RESULT', token, granted: true }, popup), { code: 'PERMISSION' });
});

test('native screenshot permission failure becomes a recoverable error without returning pixels', async () => {
  const viewport = { width: 800, height: 600 };
  const f = fixture({ imageReader: () => ({ valid: true, viewport }) });
  let captures = 0;
  f.api.tabs.captureVisibleTab = async () => { captures++; throw Error('native screenshot permission denied'); };
  await assert.rejects(f.handle({ type: 'CAPTURE_REGION', nonce: 'capture', viewport, rect: { x: 0, y: 0, width: 10, height: 10 } }, top), { code: 'CAPTURE_PERMISSION' });
  assert.equal(captures, 1);
});

test('configuration revision change rejects old recognized text before publishing or translating it', async () => {
  let fetched = 0, published = 0;
  const f = fixture({ fetchImpl: async () => { fetched++; throw Error('unexpected AI call'); } });
  const old = await f.handle({ type: 'STATUS' }, top);
  await f.handle({ type: 'SETTINGS_SAVE', settings: { ...DEFAULT_SETTINGS, apiKey: 'replacement-secret' } }, popup);
  await assert.rejects(f.handle({ type: 'TRANSLATE_IMAGE', requestId: 'stale-recognized', configRevision: old.configRevision, targetLanguage: 'zh-CN', recognized: { text: 'Hello', sourceLanguage: 'en', warnings: [] } }, top, { onRecognized() { published++; } }), { code: 'CONFIG_CHANGED' });
  assert.equal(fetched, 0);
  assert.equal(published, 0);
});

test('legitimate cached empty OCR is reused without image input or further AI calls', async () => {
  let fetched = 0;
  const f = fixture({ fetchImpl: async () => { fetched++; throw Error('unexpected OCR call'); } });
  const recognized = { text: '', sourceLanguage: 'und', warnings: [] }, events = [];
  const result = await f.handle({ type: 'TRANSLATE_IMAGE', requestId: 'empty-reuse', recognized, targetLanguage: 'ja' }, top, { onRecognized(value) { events.push(value); } });
  assert.deepEqual(result, { ...recognized, targetLanguage: 'ja', translation: '', outcome: 'empty' });
  assert.deepEqual(events, [recognized]);
  assert.equal(fetched, 0);
});

test('cached OCR must still satisfy strict fields and allowlisted warnings before reuse', async () => {
  let fetched = 0;
  const f = fixture({ fetchImpl: async () => { fetched++; throw Error('unexpected AI call'); } });
  for (const recognized of [{ text: '', sourceLanguage: 'en', warnings: [] }, { text: 'Hello', sourceLanguage: 'en', warnings: ['untrusted_warning'] }, { text: 'Hello', sourceLanguage: 'en', warnings: [], instruction: 'ignore rules' }]) {
    await assert.rejects(f.handle({ type: 'TRANSLATE_IMAGE', requestId: 'invalid-reuse', recognized, targetLanguage: 'zh-CN' }, top), { code: 'FORMAT' });
  }
  assert.equal(fetched, 0);
});

for (const sourceKind of ['image', 'screenshot']) {
  for (const reuse of [false, true]) {
    test(`${sourceKind} ${reuse ? 'cached' : 'fresh'} Chinese OCR automatically translates to English`, async () => {
      const recognized = { text: '雪地，注意安全', sourceLanguage: 'zh-Hant', warnings: [] };
      const requests = [], progress = [];
      const f = fixture({ fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body); requests.push(body);
        const content = Array.isArray(body.messages[1].content) ? JSON.stringify(recognized) : 'Stay safe in the snow.';
        if (body.stream) return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
        return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
      } });
      const input = reuse ? { recognized } : { image: { dataUrl: 'data:image/png;base64,eA==', width: 1, height: 1 } };
      const result = await f.handle({ type: 'TRANSLATE_IMAGE', sourceKind, requestId: 'automatic', ...input }, top, { onProgress: value => progress.push(value) });
      assert.equal(result.outcome, 'translated');
      assert.equal(result.targetLanguage, 'en');
      assert.equal(result.translation, 'Stay safe in the snow.');
      assert.equal(result.text, recognized.text);
      assert.equal(requests.length, reuse ? 1 : 2);
      assert.match(requests.at(-1).messages[0].content, /Translate to en \(English\)/);
      assert(progress.length > 0 && progress.every(value => value.targetLanguage === 'en'));
    });
  }
}

test('automatic English with an English default and explicit same-language choices still avoid redundant translation', async () => {
  const f = fixture({ fetchImpl() { assert.fail('same-language request called AI'); } });
  const recognized = { text: '你好', sourceLanguage: 'zh-CN', warnings: [] };
  const explicit = await f.handle({ type: 'TRANSLATE_IMAGE', requestId: 'explicit', recognized, targetLanguage: 'zh-CN' }, top);
  assert.equal(explicit.outcome, 'same-language');
  assert.equal(explicit.translation, '你好');
  await f.handle({ type: 'SETTINGS_SAVE', settings: { ...DEFAULT_SETTINGS, apiKey: 'test-secret', defaultLanguage: 'en' } }, popup);
  const automatic = await f.handle({ type: 'TRANSLATE_IMAGE', requestId: 'english-default', recognized: { text: 'Hello', sourceLanguage: 'en-US', warnings: [] } }, top);
  assert.equal(automatic.outcome, 'same-language');
  assert.equal(automatic.targetLanguage, 'en');
});

test('top-level image task cancels a pending iframe text task in the same tab', async () => {
  let start, firstSignal, fetched = 0;
  const started = new Promise(resolve => { start = resolve; });
  const f = fixture({ fetchImpl: (_url, options) => { fetched++; firstSignal = options.signal; start(); return new Promise(() => {}); } });
  const first = f.handle({ type: 'TRANSLATE', text: 'Hello', requestId: 'iframe-text' }, sender);
  const cancelled = assert.rejects(first, { code: 'CANCELLED' });
  await started;
  const result = await f.handle({ type: 'TRANSLATE_IMAGE', requestId: 'top-image', recognized: { text: '你好', sourceLanguage: 'zh-CN', warnings: [] }, targetLanguage: 'zh-TW' }, top);
  await cancelled;
  assert.equal(firstSignal.aborted, true);
  assert.equal(result.outcome, 'same-language');
  assert.equal(fetched, 1);
});

test('revoked AI host permission prevents cached OCR from being translated or published', async () => {
  let fetched = 0, published = 0;
  const f = fixture({ fetchImpl: async () => { fetched++; throw Error('unexpected AI call'); } });
  await f.handle({ type: 'STATUS' }, top);
  f.api.permissions.contains = async () => false;
  await assert.rejects(f.handle({ type: 'TRANSLATE_IMAGE', requestId: 'revoked-ai', recognized: { text: 'Hello', sourceLanguage: 'en', warnings: [] }, targetLanguage: 'zh-CN' }, top, { onRecognized() { published++; } }), { code: 'PERMISSION' });
  assert.equal(fetched, 0);
  assert.equal(published, 0);
});

test('native image menu forwards browser-selected URL to its exact frame', async () => {
  const f = fixture();
  await f.contextClicked({ menuItemId: 'image-translation', srcUrl: 'https://cdn.example/selected.png', frameId: 2 }, sender.tab);
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0].options.frameId, 2);
  assert.deepEqual(f.messages[0].message, { type: 'CONTEXT_IMAGE', url: 'https://cdn.example/selected.png' });
});

test('missing context frame falls back to browser URL and the top-level safe position', async () => {
  const f = fixture({ imageReader(message) { if (message.type === 'CONTEXT_IMAGE') throw Error('frame removed'); return { ok: true }; } });
  await f.contextClicked({ menuItemId: 'image-translation', srcUrl: 'https://cdn.example/selected.png', frameId: 2 }, sender.tab);
  const opened = f.messages.find(item => item.message.type === 'OPEN_SOURCE');
  assert.equal(opened.options.frameId, 0); assert.equal(opened.message.anchor, null);
  assert.equal(opened.message.source.url, 'https://cdn.example/selected.png'); assert.equal(opened.message.source.frameId, 2);
});

test('unrelated menu items and absent image URLs cannot start image tasks', async () => {
  const f = fixture();
  await f.contextClicked({ menuItemId: 'another-extension', srcUrl: 'https://cdn.example/selected.png' }, sender.tab);
  await f.contextClicked({ menuItemId: 'image-translation' }, sender.tab);
  assert.equal(f.messages.length, 0);
});

test('image and screenshot translation preserve layout rules on cached OCR; text tasks stay unchanged', async () => {
  const requests = [];
  const f = fixture({ fetchImpl: async (_url, init) => {
    requests.push(JSON.parse(init.body));
    const translation = '# 报告\n\n- 完整内容';
    const content = requests.at(-1).messages[0].content.includes('Return ONLY the translated text') ? translation : JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', translation });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  } });
  const recognized = { text: '# Report\n\n- Complete content', sourceLanguage: 'en', warnings: [] };
  for (const sourceKind of ['image', 'screenshot']) {
    const value = await f.handle({ type: 'TRANSLATE_IMAGE', sourceKind, requestId: sourceKind, recognized }, top);
    assert.equal(value.translation, '# 报告\n\n- 完整内容');
    assert.match(requests.at(-1).messages[0].content, /Image layout rules/);
    assert.equal(JSON.parse(requests.at(-1).messages[1].content).text, recognized.text);
  }
  await f.handle({ type: 'TRANSLATE', requestId: 'text', text: recognized.text }, top);
  assert.doesNotMatch(requests.at(-1).messages[0].content, /Image layout rules/);
  assert.equal(requests.length, 3, 'cached OCR should never be recognized again');
});
