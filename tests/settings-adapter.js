// Browser-only test fixture. Production popup.js never imports this adapter.
import { DEFAULT_SETTINGS } from '/extension/lib/core.js';
import { createService } from '/extension/lib/service.js';
const settingsKey = 'opentransai-test-settings', revisionKey = 'opentransai-test-revision', draftKey = 'opentransai-test-session';
const readSettings = () => JSON.parse(sessionStorage.getItem(settingsKey) || 'null') || { ...DEFAULT_SETTINGS };
const settingsApi = {
  runtime: { id: 'preview-only', getURL: path => `${location.origin}/preview/${path}` },
  permissions: { contains: async () => true },
  storage: {
    local: {
      setAccessLevel: async () => {},
      get: async () => ({ settings: readSettings(), configurationRevision: sessionStorage.getItem(revisionKey) || 'legacy' }),
      set: async next => { if (next.settings) sessionStorage.setItem(settingsKey, JSON.stringify(next.settings)); if (next.configurationRevision) sessionStorage.setItem(revisionKey, next.configurationRevision); },
    },
    session: {
      setAccessLevel: async () => {}, get: async () => JSON.parse(sessionStorage.getItem(draftKey) || '{}'),
      set: async next => { if (scenario === 'draft-error') throw Error('simulated draft failure'); sessionStorage.setItem(draftKey, JSON.stringify(next)); },
      remove: async () => sessionStorage.removeItem(draftKey),
    },
  },
};
const settingsService = createService(settingsApi, { fetchImpl: async (_url, options) => {
  await new Promise(resolve => setTimeout(resolve, 80));
  const body = JSON.parse(options.body);
  const prompt = body.messages?.[0]?.content || body.system || body.system_instruction?.parts?.[0]?.text || '';
  const targetLanguage = /default language is ([\w-]+)/.exec(prompt)?.[1] || 'zh-CN';
  const result = JSON.stringify({ sourceLanguage: 'en', targetLanguage, translation: '你好，世界！（测试响应）' });
  return new Response(JSON.stringify({ choices: [{ message: { content: result } }], content: [{ type: 'text', text: result }], candidates: [{ content: { parts: [{ text: result }] } }] }));
} });
const banner = document.createElement('p');
banner.textContent = '界面测试预览 · 请勿填写真实 Key · 连接测试使用模拟响应';
banner.style.cssText = 'position:fixed;right:12px;bottom:8px;z-index:-1;font:11px/1.6 system-ui;color:#69707e;margin:0;';
document.body.prepend(banner);
const scenario = new URLSearchParams(location.search).get('scenario');
let entryPreviewReady;
if (new URLSearchParams(location.search).has('entryError')) {
  const tab = { id: 7, windowId: 1, active: true, url: 'chrome://settings/' };
  settingsApi.tabs = { get: async () => tab, sendMessage: async () => { throw Error('Receiving end does not exist.'); } };
  settingsApi.action = { setPopup: async () => {}, setBadgeText: async () => {}, setTitle: async () => {}, openPopup: async () => {} };
  entryPreviewReady = settingsService.contextClicked({ menuItemId: 'image-translation', srcUrl: 'https://example.test/image.png' }, tab);
}
// Exercise the real diagnostic service/storage boundary with disposable fixture data.
let diagnosticsReady;
if (location.pathname.endsWith('/diagnostics.html')) {
  const values = { settings: { ...DEFAULT_SETTINGS, apiKey: 'fixture-key', model: '<b>fixture-model</b>' } };
  const api = {
    runtime: { id: 'preview-only', getURL: path => `chrome-extension://preview-only/${path}` },
    permissions: { contains: async () => true },
    storage: { local: {
      setAccessLevel: async () => {}, get: async () => structuredClone(values),
      set: async next => Object.assign(values, structuredClone(next)),
    } },
  };
  const service = createService(api, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '```json\n{}\n```' } }] })) });
  diagnosticsReady = (async () => {
    if (scenario !== 'diagnostics-empty') await service.handle({ type: 'TRANSLATE_IMAGE', requestId: 'fixture-request', sourceKind: 'image', image: { dataUrl: 'data:image/png;base64,eA==', width: 1, height: 1 } }, { id: 'preview-only', tab: { id: 1 } }).catch(() => {});
    return message => {
      if (scenario === 'diagnostics-error') throw Error('simulated storage failure');
      return service.handle(message, { id: 'preview-only', url: api.runtime.getURL('diagnostics.html') });
    };
  })();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => {
    if (scenario === 'diagnostics-copy-fail') throw Error('simulated clipboard failure');
    document.body.dataset.copiedEntryCount = String(JSON.parse(text).entries.length);
  } } });
}
window.close = () => {
  document.querySelector('main').hidden = true;
  const closed = document.createElement('p');
  closed.id = 'popup-preview-closed';
  closed.setAttribute('role', 'status');
  closed.textContent = '配置已保存，弹窗已关闭（预览验证）';
  document.body.append(closed);
};
Object.defineProperty(window, 'chrome', { value: {
  windows: {
    getCurrent: async () => ({ id: 1, type: ['standalone', 'toolbar'].includes(scenario) ? 'popup' : 'normal' }),
    update: async (_id, { height }) => { document.body.dataset.requestedWindowHeight = String(height); },
  },
  permissions: { request: async () => scenario !== 'permission-denied', contains: async () => false, remove: async () => true },
  tabs: {
    getCurrent: async () => scenario === 'toolbar' ? undefined : { id: 1, windowId: 1 },
    create: async ({ url }) => { location.href = url; },
  },
  runtime: {
    id: 'preview-only',
    getURL: path => `${location.origin}/preview/${path}`,
    sendMessage: async message => {
      if (['ENTRY_ERROR_GET', 'ENTRY_ERROR_CLEAR'].includes(message.type)) {
        await entryPreviewReady;
        return { ok: true, data: await settingsService.handle(message, { id: 'preview-only', url: settingsApi.runtime.getURL('popup.html') }) };
      }
      if (message.type.startsWith('DIAGNOSTICS_')) {
        try { return { ok: true, data: await (await diagnosticsReady)(message) }; }
        catch { return { ok: false, error: '模拟读取失败' }; }
      }
      if (['SETTINGS_GET', 'SETTINGS_EDIT', 'SETTINGS_DRAFT_SAVE', 'SETTINGS_SAVE', 'STATUS', 'SET_ENABLED', 'TEST'].includes(message.type)) {
        if (scenario === 'save-error' && message.type === 'SETTINGS_SAVE') return { ok: false, error: '模拟保存失败，请重试。' };
        try { return { ok: true, data: await settingsService.handle(message, { id: 'preview-only', url: settingsApi.runtime.getURL('popup.html') }) }; }
        catch (error) { return { ok: false, error: error.message }; }
      }
      return { ok: false, error: 'Unsupported test message' };
    },
  },
}, configurable: true });
