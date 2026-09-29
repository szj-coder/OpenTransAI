import { showEntryDialog } from './entry-dialog.js';

const reasons = {
  receiver_missing: ['PAGE_CONNECTION', '未连接到网页中的翻译脚本。', '请刷新原网页后重试；如果刚更新或重新加载过扩展，已有网页也需要刷新。'],
  message_closed: ['PAGE_CONNECTION', '网页翻译入口的消息连接已中断。', '页面或扩展可能正在重新加载，请等待页面加载完成后重试。'],
  frame_missing: ['PAGE_CONNECTION', '图片所在的页面框架已失效。', '请在当前页面重新右键选择图片；如果页面刚跳转，请等待加载完成。'],
  tab_missing: ['PAGE_CHANGED', '原网页标签页已关闭或不可访问。', '请回到要翻译的网页，重新选择图片。'],
  extension_context: ['EXTENSION_CONTEXT', '网页中的扩展连接已失效。', '请确认扩展已启用，然后刷新原网页重试。'],
  page_restricted: ['PAGE_RESTRICTED', '当前页面不允许显示网页翻译浮窗。', '请在普通 HTTP(S) 网页中使用；浏览器内置页面、扩展页面和扩展商店等受限页面无法注入翻译浮窗。'],
  site_access_denied: ['PAGE_PERMISSION', '浏览器拒绝了扩展对当前页面的访问。', '请检查扩展的“网站访问权限”，允许访问当前网站后刷新网页重试。'],
  disabled: ['DISABLED', '翻译功能已关闭。', '请点击扩展图标，在设置中开启翻译功能后重试。'],
  invalid_source: ['IMAGE_READ', '浏览器提供的图片来源无效。', '请重新右键选择图片，或从扩展图标的右键菜单使用框选截图翻译。'],
  entry_failed: ['ENTRY_FAILED', '翻译入口未能启动。', '请刷新网页重试；若仍失败，请复制诊断信息以便排查。'],
  entry_timeout: ['ENTRY_TIMEOUT', '网页翻译入口未及时响应。', '请等待网页加载完成后重试；若仍无响应，请刷新网页。'],
  page_connection_failed: ['PAGE_CONNECTION', '网页与扩展之间的通信失败。', '请刷新原网页重试；若仍失败，请复制诊断信息以便排查。'],
};
export function entryReason(error) {
  if (error?.code === 'ENTRY_TIMEOUT') return 'entry_timeout';
  if (error?.code === 'EXTENSION_CONTEXT') return 'extension_context';
  if (error?.code === 'CONNECTION') return 'page_connection_failed';
  if (error?.code === 'DISABLED') return 'disabled';
  if (['FORMAT', 'IMAGE_READ'].includes(error?.code)) return 'invalid_source';
  const message = String(error?.message || '');
  if (/receiving end does not exist|could not establish connection/i.test(message)) return 'receiver_missing';
  if (/message (?:port|channel).*closed|port.*disconnected/i.test(message)) return 'message_closed';
  if (/no (?:frame|document) with|frame.*removed/i.test(message)) return 'frame_missing';
  if (/no tab with|tab.*closed/i.test(message)) return 'tab_missing';
  if (/extension context invalidated/i.test(message)) return 'extension_context';
  if (/cannot access|permission|not allowed|extensions gallery|web store/i.test(message)) return 'site_access_denied';
  return 'entry_failed';
}
function pageKind(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return 'restricted';
    if (parsed.hostname === 'chromewebstore.google.com' || (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) || (parsed.hostname === 'microsoftedge.microsoft.com' && parsed.pathname.startsWith('/addons'))) return 'restricted';
    return parsed.protocol.slice(0, -1);
  } catch { return 'unknown'; }
}
const steps = { context_image: '联系图片所在框架', open_panel: '打开网页翻译浮窗', begin_capture: '启动框选截图', entry_validation: '检查翻译入口' };
function detail(error) {
  const d = error.diagnostic;
  return `OpenTransAI 翻译入口异常\n错误编号：${error.requestId}\n错误代码：${error.code}\n失败阶段：${steps[d.step] || d.step}\n原因：${d.reason}${d.previousReason ? '\n前一步原因：' + d.previousReason : ''}${d.displayReason ? '\n浮窗展示失败：' + d.displayReason : ''}\n页面类型：${d.pageKind}\n标签页：${d.tabId} · 来源框架：${d.frameId}\n${error.message}\n${error.hint}`;
}

export async function sendEntryMessage(api, tabId, message, frameId = 0) {
  let timer;
  try {
    return await Promise.race([
      api.tabs.sendMessage(tabId, message, { frameId }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('网页翻译入口响应超时。'), { code: 'ENTRY_TIMEOUT' })), 3000); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function createEntryErrors(api, diagnostics) {
  const attempts = new Map(), cached = new Map(), mutations = new Map();
  const serial = (tabId, operation) => {
    const next = (mutations.get(tabId) || Promise.resolve()).then(operation);
    const settled = next.catch(() => {}).finally(() => { if (mutations.get(tabId) === settled) mutations.delete(tabId); });
    mutations.set(tabId, settled); return next;
  };
  const key = tabId => `entryError:${tabId}`;
  const bestEffort = async fn => { try { return await fn(); } catch { return undefined; } };
  const resetAction = tabId => Promise.all([
    bestEffort(() => api.action?.setBadgeText({ tabId, text: '' })),
    bestEffort(() => api.action?.setTitle({ tabId, title: 'OpenTransAI · AI 翻译' })),
    bestEffort(() => api.action?.setPopup({ tabId, popup: 'popup.html' })),
  ]);
  function clear(tabId, attempt) {
    return serial(tabId, async () => {
      if (attempt && !current(tabId, attempt)) return;
      cached.delete(tabId);
      await bestEffort(() => api.storage.session?.remove(key(tabId)));
      await resetAction(tabId);
    });
  }
  const current = (tabId, attempt) => attempts.get(tabId) === attempt;
  return {
    clear,
    begin(tabId) { const attempt = crypto.randomUUID(); attempts.set(tabId, attempt); void clear(tabId, attempt); return attempt; },
    forget(tabId) { attempts.delete(tabId); void clear(tabId); },
    async success(tabId, attempt) { await clear(tabId, attempt); },
    async get(tabId) {
      const stored = cached.get(tabId) || (await bestEffort(() => api.storage.session?.get(key(tabId))))?.[key(tabId)];
      if (!stored || Date.now() - stored.timestamp > 300000) { await clear(tabId); return { error: null }; }
      return { error: stored.error };
    },
    async report(failure, info, tab, attempt) {
      const kind = pageKind(tab.url), reason = kind === 'restricted' ? 'page_restricted' : entryReason(failure);
      const [code, message, hint] = reasons[reason];
      const diagnostic = { operation: info.menuItemId === 'capture-translation' ? 'ENTRY_CAPTURE' : 'ENTRY_IMAGE', sourceKind: info.menuItemId === 'capture-translation' ? 'screenshot' : 'image', stage: 'entry', step: steps[failure?.entryStep] ? failure.entryStep : 'entry_validation', reason, code, pageKind: kind, tabId: tab.id, frameId: info.frameId || 0, requestId: attempt };
      if (failure?.entryPreviousReason) diagnostic.previousReason = failure.entryPreviousReason;
      const error = { requestId: attempt, code, message, hint, sourceKind: diagnostic.sourceKind, diagnostic };
      error.details = detail(error);
      const valid = async () => {
        if (!current(tab.id, attempt)) return false;
        try { const latest = await api.tabs.get(tab.id); return current(tab.id, attempt) && Boolean(tab.url) && latest.url === tab.url; }
        catch { return false; }
      };
      try {
        if (!await valid()) { diagnostic.display = 'suppressed'; return; }
        if (kind !== 'restricted') {
          try {
            const response = await sendEntryMessage(api, tab.id, { type: 'ENTRY_ERROR', error, expectedUrl: tab.url });
            if (response?.ok) { diagnostic.display = 'translation_panel'; return; }
          } catch { /* The fallback dialog does not depend on content scripts. */ }
          if (!await valid()) { diagnostic.display = 'suppressed'; return; }
          try {
            const results = await api.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, func: showEntryDialog, args: [error, tab.url] });
            if (results?.some(result => result.frameId === 0 && result.result === true)) { diagnostic.display = 'injected_dialog'; return; }
            diagnostic.displayReason = 'page_changed';
          } catch (displayFailure) { diagnostic.displayReason = entryReason(displayFailure); }
        }
        if (!await valid()) { diagnostic.display = 'suppressed'; return; }
        // A browser-controlled page cannot host injected UI. Use the existing
        // extension action popup; never open a window or a new browser tab.
        if (diagnostic.displayReason === 'site_access_denied') error.hint += ' 浏览器也拒绝显示网页错误浮窗，请检查扩展的网站访问权限。';
        await serial(tab.id, async () => {
          if (!await valid()) { diagnostic.display = 'suppressed'; return; }
          diagnostic.display = 'toolbar_popup'; error.details = detail(error);
          const remember = async () => { const value = { timestamp: Date.now(), error }; cached.set(tab.id, value); await bestEffort(() => api.storage.session?.set({ [key(tab.id)]: value })); };
          await remember();
          if (!await valid()) { diagnostic.display = 'suppressed'; return; }
          await bestEffort(() => api.action?.setPopup({ tabId: tab.id, popup: `popup.html?entryError=${tab.id}` }));
          await bestEffort(() => api.action?.setBadgeText({ tabId: tab.id, text: '!' }));
          await bestEffort(() => api.action?.setTitle({ tabId: tab.id, title: `OpenTransAI：${message} 点击查看详情` }));
          const latest = await api.tabs.get(tab.id);
          try {
            if (!latest.active || !current(tab.id, attempt) || latest.url !== tab.url || !api.action?.openPopup) throw Error('popup unavailable');
            await api.action.openPopup({ windowId: latest.windowId });
          } catch { diagnostic.display = 'toolbar_badge'; }
          if (current(tab.id, attempt)) await remember();
        });
      } catch (displayFailure) {
        diagnostic.display = 'suppressed'; diagnostic.displayReason = entryReason(displayFailure);
      } finally { await diagnostics.add(diagnostic); }
    },
  };
}
