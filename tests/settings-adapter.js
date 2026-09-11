// Browser-only test fixture. Production popup.js never imports this adapter.
import { DEFAULT_SETTINGS } from '/extension/lib/core.js';
let settings = JSON.parse(sessionStorage.getItem('opentransai-test-settings') || 'null') || { ...DEFAULT_SETTINGS };
const banner = document.createElement('p');
banner.textContent = '界面测试预览 · 请勿填写真实 Key · 连接测试使用模拟响应';
banner.style.cssText = 'position:fixed;right:12px;bottom:8px;z-index:-1;font:11px/1.6 system-ui;color:#69707e;margin:0;';
document.body.prepend(banner);
const scenario = new URLSearchParams(location.search).get('scenario');
window.close = () => {
  document.querySelector('main').hidden = true;
  const closed = document.createElement('p');
  closed.id = 'popup-preview-closed';
  closed.setAttribute('role', 'status');
  closed.textContent = '配置已保存，弹窗已关闭（预览验证）';
  document.body.append(closed);
};
Object.defineProperty(window, 'chrome', { value: {
  permissions: { request: async () => scenario !== 'permission-denied' },
  runtime: {
    id: 'preview-only',
    sendMessage: async message => {
      if (message.type === 'SETTINGS_GET') return { ok: true, data: settings };
      if (message.type === 'SETTINGS_SAVE') {
        if (scenario === 'save-error') return { ok: false, error: '模拟保存失败，请重试。' };
        settings = message.settings;
        sessionStorage.setItem('opentransai-test-settings', JSON.stringify(settings));
        return { ok: true, data: {} };
      }
      if (message.type === 'STATUS') return { ok: true, data: { ...settings, apiKey: undefined, configured: Boolean(settings.apiKey) } };
      if (message.type === 'SET_ENABLED') { settings.enabled = message.enabled; sessionStorage.setItem('opentransai-test-settings', JSON.stringify(settings)); return { ok: true, data: { enabled: settings.enabled } }; }
      if (message.type === 'TEST') {
        await new Promise(resolve => setTimeout(resolve, 800));
        return { ok: true, data: { translation: '你好，世界！（测试响应）', elapsedMs: 800 } };
      }
      return { ok: false, error: 'Unsupported test message' };
    },
  },
}, configurable: true });
