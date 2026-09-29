import { imageOrigin, readRemoteImage, cropCapture } from './images.js';
import { entryReason, sendEntryMessage } from './entry-errors.js';

const fail = (message, code) => { throw Object.assign(new Error(message), { code }); };
const uid = () => crypto.randomUUID();
export function createBrowserActions(api, { readStatus, requireTrusted, runOperation, fetchImpl }) {
  const sources = new Map(), pending = new Map(), temporary = new Map(), capturing = new Set();
  let captureRevision = 0;
  const captureChanged = () => { captureRevision++; };
  const topMessage = (tabId, message) => api.tabs.sendMessage(tabId, message, { frameId: 0 });
  const entryMessage = (tabId, message, frameId = 0) => sendEntryMessage(api, tabId, message, frameId);
  const sourceFor = (id, sender) => {
    const source = sources.get(id);
    if (!source || source.tabId !== sender.tab?.id || sender.frameId !== 0) fail('图片来源已失效，请重新选择图片。', 'IMAGE_READ');
    return source;
  };
  const enabled = async () => { if (!(await readStatus()).enabled) fail('翻译功能已关闭，请在扩展菜单中开启。', 'DISABLED'); };
  async function open(message, sender, nativeEntry = false) {
    await enabled();
    if (!sender.tab?.id || !['text', 'image'].includes(message.sourceKind)) fail('无效的翻译来源。', 'FORMAT');
    if (message.sourceKind === 'text' && (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 100000)) fail('请重新选择要翻译的文字。', 'LIMIT');
    if (message.sourceKind === 'image' && (typeof message.url !== 'string' || message.url.length > 6_000_000 || typeof message.token !== 'string' || message.token.length > 100)) fail('无效的图片来源。', 'IMAGE_READ');
    let source = [...sources.values()].find(s => s.tabId === sender.tab.id && s.documentId === sender.documentId && s.token === message.token && s.url === message.url && s.kind === 'image');
    if (!source) {
      source = { id: uid(), tabId: sender.tab.id, frameId: sender.frameId || 0, documentId: sender.documentId, token: message.token, url: message.url, text: message.text, kind: message.sourceKind };
      // Keep only a few current source handles; image/text bytes live in the page, not a history store.
      const previous = [...sources.values()].filter(s => s.tabId === sender.tab.id);
      for (const old of previous.slice(0, Math.max(0, previous.length - 3))) sources.delete(old.id);
      sources.set(source.id, source);
    }
    const notification = { type: 'OPEN_SOURCE', source, anchor: sender.frameId ? null : message.anchor || null };
    if (nativeEntry) {
      const response = await entryMessage(sender.tab.id, notification);
      if (!response?.ok) fail('The message port closed before a response was received.', 'PAGE_CONNECTION');
    } else await topMessage(sender.tab.id, notification);
    return { sourceId: source.id };
  }
  async function activeTab(sender) {
    const tab = await api.tabs.get(sender.tab.id);
    const [active] = await api.tabs.query({ active: true, windowId: tab.windowId });
    if (!tab.active || active?.id !== tab.id) fail('页面已切换，请返回原标签页重新框选。', 'CAPTURE_CHANGED');
    // tabs.get omits URL without tabs/host/activeTab permission; sender.url is browser-derived.
    const url = tab.url || sender.url;
    if (!/^https?:/.test(url || '')) fail('当前页面不支持框选截图翻译。', 'CAPTURE_UNAVAILABLE');
    return { ...tab, url };
  }
  async function handle(message, sender) {
    if (message.type === 'TASK_OPEN') return open(message, sender);
    if (['DISMISS_PANEL', 'CLOSE_PANEL'].includes(message.type)) {
      if (!sender.tab || !Number.isFinite(message.at) || message.at < 0) fail('无效关闭请求。', 'FORMAT');
      if (!capturing.has(sender.tab.id)) await topMessage(sender.tab.id, { type: message.type, at: message.at }).catch(() => {});
      return {};
    }
    if (message.type === 'CAPTURE_MODE') {
      if (!sender.tab || sender.frameId !== 0 || typeof message.active !== 'boolean') fail('无效截图状态。', 'FORMAT');
      if (message.active) capturing.add(sender.tab.id); else capturing.delete(sender.tab.id);
      await api.tabs.sendMessage(sender.tab.id, { type: 'CAPTURE_VISIBILITY', active: message.active });
      return {};
    }
    if (message.type === 'ENTRY_CLAIM') {
      if (typeof message.token !== 'string' || !sender.tab) fail('无效入口。', 'FORMAT');
      const suppressed = capturing.has(sender.tab.id);
      await api.tabs.sendMessage(sender.tab.id, { type: 'HIDE_ENTRY', owner: suppressed ? null : message.token }).catch(() => {});
      return { suppressed };
    }
    if (message.type === 'READ_SOURCE') {
      const source = sourceFor(message.sourceId, sender);
      return runOperation(message, sender, async signal => {
        let result;
        try {
          result = await api.tabs.sendMessage(source.tabId, { type: 'READ_IMAGE', token: source.token, url: source.url }, source.documentId ? { documentId: source.documentId } : { frameId: source.frameId });
        } catch { /* A removed frame may still have a usable explicitly selected image URL. */ }
        if (signal.aborted) fail('图片读取已取消。', 'CANCELLED');
        if (result?.image) return result;
        if (result?.code === 'LIMIT') fail(result.error, 'LIMIT');
        const origin = imageOrigin(source.url);
        if (!await api.permissions.contains({ origins: [origin] })) fail('无法读取跨域图片，可授权读取或使用框选截图。', 'IMAGE_PERMISSION');
        return { image: await readRemoteImage(source.url, { fetchImpl, signal }) };
      });
    }
    if (message.type === 'OPEN_SETTINGS') {
      await api.windows.create({ url: api.runtime.getURL('popup.html'), type: 'popup', width: 430, height: 680 });
      return {};
    }
    if (message.type === 'START_CAPTURE') {
      requireTrusted(sender); await enabled();
      const tab = await api.tabs.get(message.tabId);
      if (!/^https?:/.test(tab.url || '')) fail('当前页面不支持框选截图翻译。', 'CAPTURE_UNAVAILABLE');
      temporary.set(tab.id, tab.url);
      await topMessage(tab.id, { type: 'BEGIN_CAPTURE' });
      return {};
    }
    if (message.type === 'PREPARE_CAPTURE') {
      await enabled();
      const tab = await activeTab(sender);
      return { allowed: await api.permissions.contains({ origins: ['<all_urls>'] }) || temporary.get(tab.id) === tab.url };
    }
    if (message.type === 'REQUEST_ACCESS') {
      if (!sender.tab || sender.frameId !== 0 || !['capture', 'image'].includes(message.purpose)) fail('无效权限请求。', 'FORMAT');
      const origins = message.purpose === 'capture' ? ['<all_urls>'] : [imageOrigin(sourceFor(message.sourceId, sender).url)];
      const token = uid();
      for (const [key, value] of pending) if (value.created < Date.now() - 300000 || value.tabId === sender.tab.id) pending.delete(key);
      pending.set(token, { tabId: sender.tab.id, documentId: sender.documentId, purpose: message.purpose, intent: message.intent, sourceId: message.sourceId, origins, created: Date.now() });
      await api.windows.create({ url: api.runtime.getURL(`popup.html?access=${token}`), type: 'popup', width: 430, height: 430 });
      return {};
    }
    if (['ACCESS_GET', 'ACCESS_RESULT'].includes(message.type)) {
      requireTrusted(sender);
      const access = pending.get(message.token);
      if (!access || Date.now() - access.created > 300000) fail('授权请求已失效，请返回网页重试。', 'PERMISSION');
      if (message.type === 'ACCESS_GET') return { purpose: access.purpose, origins: access.origins };
      pending.delete(message.token);
      const granted = message.granted === true && await api.permissions.contains({ origins: access.origins });
      await api.tabs.sendMessage(access.tabId, { type: 'ACCESS_FINISHED', purpose: access.purpose, intent: access.intent, sourceId: access.sourceId, granted }, access.documentId ? { documentId: access.documentId } : { frameId: 0 }).catch(() => {});
      return {};
    }
    if (message.type === 'CAPTURE_REGION') {
      const revision = captureRevision;
      await enabled();
      if (sender.frameId !== 0) fail('截图须由顶层页面发起。', 'PERMISSION');
      const tab = await activeTab(sender);
      const before = await api.tabs.sendMessage(tab.id, { type: 'CAPTURE_VERIFY', nonce: message.nonce }, { documentId: sender.documentId });
      if (!before?.valid || JSON.stringify(before.viewport) !== JSON.stringify(message.viewport)) fail('页面已变化，请重新框选。', 'CAPTURE_CHANGED');
      if (captureRevision !== revision) fail('页面已切换或缩放，请重新框选。', 'CAPTURE_CHANGED');
      let data;
      try { data = await api.tabs.captureVisibleTab(tab.windowId, { format: 'png' }); }
      catch { fail('无法截图，请授权全站访问或从右键菜单重新启动。', 'CAPTURE_PERMISSION'); }
      await activeTab(sender);
      if (captureRevision !== revision) fail('页面已切换或缩放，请重新框选。', 'CAPTURE_CHANGED');
      const after = await api.tabs.sendMessage(tab.id, { type: 'CAPTURE_VERIFY', nonce: message.nonce }, { documentId: sender.documentId });
      if (!after?.valid || JSON.stringify(after.viewport) !== JSON.stringify(message.viewport)) fail('页面已变化，请重新框选。', 'CAPTURE_CHANGED');
      return { image: await cropCapture(data, message.rect, message.viewport) };
    }
    return undefined;
  }
  function forgetTab(tabId) {
    captureChanged(); capturing.delete(tabId);
    for (const [id, source] of sources) if (source.tabId === tabId) sources.delete(id);
    for (const [id, request] of pending) if (request.tabId === tabId) pending.delete(id);
    temporary.delete(tabId);
  }
  async function contextClicked(info, tab) {
    if (!tab?.id) return;
    temporary.set(tab.id, tab.url);
    if (!['image-translation', 'capture-translation'].includes(info.menuItemId)) return;
    try { await enabled(); } catch (error) { throw Object.assign(error, { entryStep: 'entry_validation' }); }
    if (info.menuItemId === 'capture-translation') {
      try {
        const response = await entryMessage(tab.id, { type: 'BEGIN_CAPTURE' });
        if (!response?.ok) fail('The message port closed before a response was received.', 'PAGE_CONNECTION');
      } catch (error) { throw Object.assign(error, { entryStep: 'begin_capture' }); }
      return;
    }
    if (!info.srcUrl) return;
    let previousReason;
    try {
      const response = await entryMessage(tab.id, { type: 'CONTEXT_IMAGE', url: info.srcUrl }, info.frameId || 0);
      if (response?.ok) return;
      if (response?.error) throw Object.assign(new Error(response.error), { code: response.code, entryStep: 'context_image' });
      previousReason = 'message_closed';
    } catch (error) {
      if (error.entryStep) throw error;
      // An unanswered message may already have opened a task. Do not replay it.
      if (error.code === 'ENTRY_TIMEOUT') throw Object.assign(error, { entryStep: 'context_image' });
      previousReason = entryReason(error);
    }
    try { await open({ sourceKind: 'image', token: `native-${uid()}`, url: info.srcUrl }, { id: api.runtime.id, tab, frameId: info.frameId || 0 }, true); }
    catch (error) { throw Object.assign(error, { entryStep: 'open_panel', entryPreviousReason: previousReason }); }
  }
  return { handle, forgetTab, contextClicked, captureChanged };
}
