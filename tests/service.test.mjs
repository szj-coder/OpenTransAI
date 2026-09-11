import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../extension/lib/service.js';
import { DEFAULT_SETTINGS } from '../extension/lib/core.js';

const contentSender = { id: 'extension-id', tab: { id: 7 }, frameId: 0, url: 'https://example.com/' };
const optionsSender = { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' };
function setup({ configured = true, allowed = true, enabled = true, fetchImpl, permissionCheck } = {}) {
  let stored = configured ? { ...DEFAULT_SETTINGS, apiKey: 'private-key', enabled } : undefined;
  let access;
  const opened = [];
  const api = {
    runtime: { id: 'extension-id', getURL: p => 'chrome-extension://extension-id/' + p, openOptionsPage: async () => {} },
    tabs: { create: async options => { opened.push(options.url); } },
    storage: { local: {
      setAccessLevel: async level => { access = level; },
      get: async () => ({ settings: stored }),
      set: async value => { stored = value.settings; },
    } },
    permissions: { contains: permissionCheck || (async () => allowed) },
  };
  const service = createService(api, { fetchImpl });
  return { service, stored: () => stored, access: () => access, opened };
}

test('不再提供跳转独立配置页面的消息入口', async () => {
  const { service, opened } = setup();
  await assert.rejects(service.handle({ type: 'OPEN_ADVANCED' }, optionsSender), /不支持/);
  await assert.rejects(service.handle({ type: 'OPEN_OPTIONS' }, contentSender), /不支持/);
  assert.deepEqual(opened, []);
});

test('内容脚本状态不暴露 Key；设置只允许扩展自己的页面读取和修改', async () => {
  const { service, stored, access } = setup();
  const status = await service.handle({ type: 'STATUS' }, contentSender);
  assert.equal(status.configured, true);
  assert.equal(JSON.stringify(status).includes('private-key'), false);
  assert.deepEqual(access(), { accessLevel: 'TRUSTED_CONTEXTS' });
  for (const type of ['SETTINGS_GET', 'SETTINGS_SAVE', 'TEST', 'SET_ENABLED']) {
    await assert.rejects(service.handle({ type, settings: { apiKey: 'evil' } }, contentSender), /权限/);
  }
  assert.equal(stored().apiKey, 'private-key');
  assert.equal((await service.handle({ type: 'SETTINGS_GET' }, optionsSender)).apiKey, 'private-key');
  await assert.rejects(service.handle({ type: 'STATUS' }, { ...contentSender, id: 'foreign' }), /权限/);
});

test('保存设置需要域名授权，保存失败时原 Key 不变', async () => {
  const { service, stored } = setup({ allowed: false });
  await assert.rejects(service.handle({ type: 'SETTINGS_SAVE', settings: { ...DEFAULT_SETTINGS, apiKey: 'new-key' } }, optionsSender), /授权/);
  assert.equal(stored().apiKey, 'private-key');
});

test('翻译只使用已保存配置，忽略内容脚本伪造的服务和 Key', async () => {
  let request;
  const { service } = setup({ fetchImpl: async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好' }) } }] }));
  } });
  const result = await service.handle({ type: 'TRANSLATE', requestId: 'one', text: 'Hello', settings: { baseUrl: 'https://evil.example', apiKey: 'evil-key' } }, contentSender);
  assert.equal(result.translation, '你好');
  assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(request.options.headers.Authorization, 'Bearer private-key');
});

test('未配置和关闭时不允许发出翻译请求', async () => {
  await assert.rejects(setup({ configured: false }).service.handle({ type: 'TRANSLATE', text: 'Hello', requestId: 'one' }, contentSender), /配置/);
  await assert.rejects(setup({ enabled: false }).service.handle({ type: 'TRANSLATE', text: 'Hello', requestId: 'one' }, contentSender), /关闭/);
});

test('连接测试不持久化未保存配置，切换开关保留其他设置', async () => {
  const { service, stored } = setup({ fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好' }) } }] })) });
  await service.handle({ type: 'TEST', settings: { ...DEFAULT_SETTINGS, apiKey: 'draft-key' } }, optionsSender);
  assert.equal(stored().apiKey, 'private-key');
  await service.handle({ type: 'SET_ENABLED', enabled: false }, optionsSender);
  assert.equal(stored().enabled, false);
  assert.equal(stored().apiKey, 'private-key');
});

test('设置页保存旧表单不能重新打开已关闭的划词开关', async () => {
  const { service, stored } = setup();
  const oldForm = await service.handle({ type: 'SETTINGS_GET' }, optionsSender);
  await service.handle({ type: 'SET_ENABLED', enabled: false }, optionsSender);
  await service.handle({ type: 'SETTINGS_SAVE', settings: { ...oldForm, model: 'new-model' } }, optionsSender);
  assert.equal(stored().enabled, false);
  assert.equal(stored().model, 'new-model');
});

test('同一页面新请求取消旧请求，其他页面无法取消它', async () => {
  let calls = 0;
  let firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const { service } = setup({ fetchImpl: async (_url, options) => {
    calls++;
    if (calls === 1) return new Promise((_, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      firstStarted();
    });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sourceLanguage: 'zh', targetLanguage: 'en', translation: 'New result' }) } }] }));
  } });
  const first = service.handle({ type: 'TRANSLATE', text: 'Hello', requestId: 'one' }, contentSender);
  const rejection = assert.rejects(first, /取消/);
  await started;
  await service.handle({ type: 'CANCEL', requestId: 'one' }, { ...contentSender, tab: { id: 8 } });
  const second = await service.handle({ type: 'TRANSLATE', text: '你好', requestId: 'two' }, contentSender);
  await rejection;
  assert.equal(second.translation, 'New result');
});

for (const action of ['CANCEL', 'SET_ENABLED']) {
  test(`等待权限检查时 ${action} 仍可阻止尚未发出的请求`, async () => {
    let entered;
    const checking = new Promise(resolve => { entered = resolve; });
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let calls = 0;
    const { service } = setup({ permissionCheck: async () => { entered(); await barrier; return true; }, fetchImpl: async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好' }) } }] }));
    } });
    const pending = service.handle({ type: 'TRANSLATE', text: 'Hello', requestId: 'pending' }, contentSender);
    const outcome = pending.then(() => 'completed', error => error.message);
    await checking;
    await service.handle({ type: action, requestId: 'pending', enabled: false }, action === 'CANCEL' ? contentSender : optionsSender);
    release();
    assert.match(await outcome, /取消|关闭/);
    assert.equal(calls, 0);
  });
}

function mockPort(sender = contentSender) {
  const listeners = { message: [], disconnect: [] };
  const sent = [];
  let closed = false;
  return { name: 'translation', sender, sent,
    onMessage: { addListener: fn => listeners.message.push(fn) },
    onDisconnect: { addListener: fn => listeners.disconnect.push(fn) },
    postMessage: value => sent.push(value),
    receive: value => listeners.message.forEach(fn => fn(value)),
    disconnect() { if (!closed) { closed = true; listeners.disconnect.forEach(fn => fn()); } },
  };
}
test('端口断开在等待权限期间取消，不能发出 AI 请求', async () => {
  let release, entered; let calls = 0;
  const waiting = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const { service } = setup({ permissionCheck: async () => { entered(); await barrier; return true; }, fetchImpl: async () => { calls++; } });
  const port = mockPort(); service.connect(port);
  port.receive({ type: 'TRANSLATE', text: 'Hello', requestId: 'disconnected' });
  await waiting; port.disconnect(); release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 0); assert.equal(port.sent.length, 0);
});
test('翻译端口仅接受翻译一次，不能读取设置或替换 Key', async () => {
  let calls = 0;
  const { service } = setup({ fetchImpl: async (url, init) => {
    calls++; assert.equal(init.headers.Authorization, 'Bearer private-key');
    const raw = JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好' });
    return new Response('data: '+JSON.stringify({ choices: [{ delta: { content: raw } }] })+'\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const port = mockPort(); service.connect(port);
  port.receive({ type: 'SETTINGS_GET' });
  assert.equal(port.sent.length, 0);
  port.receive({ type: 'TRANSLATE', requestId: 'stream', text: 'hello', settings: { apiKey: 'fake' } });
  port.receive({ type: 'TRANSLATE', requestId: 'duplicate', text: 'hello' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls, 1);
  assert.deepEqual(port.sent.map(item => item.type), ['PHASE', 'PHASE', 'PROGRESS', 'DONE']);
  assert.deepEqual(port.sent.filter(item => item.type === 'PHASE').map(item => item.phase), ['waiting', 'translating']);
  assert(port.sent.every(item => item.requestId === 'stream'));
  assert(!JSON.stringify(port.sent).includes('private-key'));
});

test('保存并重读思考开关，翻译仅采用保存值，阶段消息不含推理文本', async () => {
  let thinking;
  const result = { sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好' };
  const { service } = setup({ fetchImpl: async (_url, init) => {
    thinking = JSON.parse(init.body).thinking;
    const events = [{ choices: [{ delta: { reasoning_content: 'PRIVATE_REASONING_ONLY' } }] }, { choices: [{ delta: { content: JSON.stringify(result) } }] }];
    return new Response(events.map(data => `data: ${JSON.stringify(data)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const settings = { ...DEFAULT_SETTINGS, baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'private-key', thinking: true };
  await service.handle({ type: 'SETTINGS_SAVE', settings }, optionsSender);
  assert.equal((await service.handle({ type: 'SETTINGS_GET' }, optionsSender)).thinking, true);
  const port = mockPort(); service.connect(port);
  port.receive({ type: 'TRANSLATE', requestId: 'thinking', text: 'hello', settings: { thinking: false } });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(thinking, { type: 'enabled' });
  assert.deepEqual(port.sent.filter(item => item.type === 'PHASE').map(item => item.phase), ['waiting', 'thinking', 'translating']);
  assert.equal(port.sent.at(-1).type, 'DONE');
  assert.equal(JSON.stringify(port.sent).includes('PRIVATE_REASONING_ONLY'), false);
  assert.equal(JSON.stringify(port.sent).includes('private-key'), false);
});
