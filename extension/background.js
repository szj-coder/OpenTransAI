import { createService } from './lib/service.js';

const service = createService(chrome);
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Pages opened before an extension reload may still contain the legacy UI.
  // Never turn those one-shot messages into silently non-streaming requests.
  if (message?.type === 'TRANSLATE') {
    sendResponse({ ok: false, error: '插件已更新，请刷新当前网页后重新选择文字。' });
    return false;
  }
  service.handle(message, sender).then(
    data => sendResponse({ ok: true, data }),
    error => sendResponse({ ok: false, error: error.message || '操作失败，请重试。' }),
  );
  return true;
});

chrome.runtime.onConnect.addListener(port => service.connect(port));
