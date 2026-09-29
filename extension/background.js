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
    error => sendResponse({ ok: false, error: error.message || '操作失败，请重试。', code: error.code || 'SERVICE' }),
  );
  return true;
});

chrome.runtime.onConnect.addListener(port => service.connect(port));

chrome.runtime.onInstalled?.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'image-translation', title: 'OpenTransAI · 翻译图片', contexts: ['image'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
    chrome.contextMenus.create({ id: 'capture-translation', title: '框选截图翻译', contexts: ['action'], documentUrlPatterns: ['http://*/*', 'https://*/*'] });
  });
});
chrome.contextMenus?.onClicked.addListener((info, tab) => {
  void service.contextClicked(info, tab).catch(() => { /* The entry handler records and presents failures; never open a separate error window. */ });
});
chrome.tabs?.onRemoved?.addListener(tabId => service.forgetTab(tabId));
chrome.tabs?.onUpdated?.addListener((tabId, change) => { if (change.status === 'loading') service.forgetTab(tabId); });

// Remember intermediate switches too: returning to the original tab cannot validate another tab's pixels.
chrome.tabs?.onActivated?.addListener(() => service.captureChanged());
chrome.tabs?.onZoomChange?.addListener(() => service.captureChanged());
