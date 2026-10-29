import { DEFAULT_SETTINGS, validateSettings, validateText, validateImage, parseRecognition, permissionOrigin, translate, recognizeImage, chooseTargetLanguage, sameLanguage, LANGUAGES } from './core.js';
import { createBrowserActions } from './browser-actions.js';
import { createDiagnostics } from './diagnostics.js';
import { createEntryErrors } from './entry-errors.js';

export function createService(api, { fetchImpl = globalThis.fetch } = {}) {
  const ready = api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const diagnostics = createDiagnostics(api.storage.local, { ready });
  const entryErrors = createEntryErrors(api, diagnostics);
  const active = new Map(), xTabs = new Set();
  const isXSender = sender => {
    try { const url = new URL(sender.url); return Number.isSafeInteger(sender.tab?.id) && url.protocol === 'https:' && ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname); } catch { return false; }
  };
  let configRevision = 'legacy';
  const read = async () => {
    const values = await api.storage.local.get(['settings', 'configurationRevision']);
    configRevision = values.configurationRevision || 'legacy';
    const { thinking: _thinking, ...settings } = values.settings || {};
    return { ...DEFAULT_SETTINGS, ...settings };
  };
  let writes = Promise.resolve();
  const enqueueWrite = operation => {
    const task = writes.then(operation);
    writes = task.catch(() => {});
    return task;
  };
  let draftReady;
  const draftStorage = async () => {
    const storage = api.storage.session;
    if (!storage) throw new Error('暂时无法保留配置草稿，请保存配置后再关闭。');
    draftReady ||= storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(error => { draftReady = null; throw error; });
    await draftReady;
    return storage;
  };
  const updateSettings = (update, revise = false) => {
    return enqueueWrite(async () => {
      const settings = update(await read());
      const revision = revise ? crypto.randomUUID() : configRevision;
      await api.storage.local.set({ settings, configurationRevision: revision });
      configRevision = revision;
      await Promise.all([...xTabs].map(tabId => api.tabs.sendMessage(tabId, { type: 'STATUS_CHANGED', data: publicStatus(settings) }, { frameId: 0 }).catch(() => { xTabs.delete(tabId); })));
      // Revision checking also prevents stale restoration if cleanup fails.
      if (revise && api.storage.session) await api.storage.session.remove('settingsDraft').catch(() => {});
      return settings;
    });
  };
  const trusted = sender => ['popup.html'].some(path => sender.url?.split(/[?#]/)[0] === api.runtime.getURL(path));
  const requireTrusted = sender => { if (!trusted(sender)) throw new Error('没有操作设置的权限。'); };
  const authorize = async settings => {
    if (!await api.permissions.contains({ origins: [permissionOrigin(settings.baseUrl)] })) {
      throw Object.assign(new Error('尚未授权访问 AI 服务，请打开设置，点击保存配置并允许访问。'), { code: 'PERMISSION' });
    }
  };
  const publicStatus = settings => ({
    enabled: settings.enabled, defaultLanguage: settings.defaultLanguage, provider: settings.provider,
    configured: Boolean(settings.apiKey && settings.model && settings.baseUrl),
    configRevision,
  });

  const channelFor = (sender, message = {}) => {
    const channel = `${sender.tab?.id ?? sender.url}`;
    if (message.scope === undefined) return channel;
    if (message.scope !== 'x-post' || !isXSender(sender) || !['TRANSLATE', 'CANCEL'].includes(message.type) ||
        typeof message.taskId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(message.taskId)) throw Object.assign(new Error('无效的帖子翻译任务。'), { code: 'FORMAT' });
    return `${channel}:x:${sender.frameId || 0}:${message.taskId}`;
  };
  async function runOperation(message, sender, operation, externalSignal) {
    if (typeof message.requestId !== 'string' || !message.requestId || message.requestId.length > 100) throw new Error('无效请求编号。');
    const channel = channelFor(sender, message);
    active.get(channel)?.controller.abort();
    if (!active.has(channel) && active.size >= 5) throw Object.assign(new Error('同时进行的翻译较多，请稍后重试。'), { code: 'RATE_LIMIT' });
    const controller = new AbortController();
    const entry = { id: message.requestId, controller, tabId: sender.tab?.id };
    active.set(channel, entry);
    const abort = () => controller.abort();
    externalSignal?.addEventListener('abort', abort, { once: true });
    if (externalSignal?.aborted) abort();
    try {
      if (controller.signal.aborted) throw Object.assign(new Error('翻译已取消。'), { code: 'CANCELLED' });
      return await operation(controller.signal);
    } finally {
      externalSignal?.removeEventListener('abort', abort);
      if (active.get(channel) === entry) active.delete(channel);
    }
  }
  const browser = createBrowserActions(api, { requireTrusted, readStatus: async () => publicStatus(await read()), runOperation, fetchImpl });

  async function handleRequest(message, sender, { signal, onProgress, onPhase, onRecognized, onActivity } = {}, context = {}) {
    if (sender?.id !== api.runtime.id) throw new Error('没有访问扩展的权限。');
    await ready;
    if (signal?.aborted) throw new Error('翻译已取消。');
    if (!message || typeof message.type !== 'string') throw new Error('无效请求。');
    if (['ENTRY_ERROR_GET', 'ENTRY_ERROR_CLEAR'].includes(message.type)) {
      requireTrusted(sender);
      if (!Number.isSafeInteger(message.tabId) || message.tabId < 0) throw new Error('无效标签页。');
      if (message.type === 'ENTRY_ERROR_GET') return entryErrors.get(message.tabId);
      await entryErrors.clear(message.tabId); return {};
    }
    if (['DIAGNOSTICS_GET', 'DIAGNOSTICS_CLEAR'].includes(message.type)) {
      if (!trusted(sender) && sender.url?.split(/[?#]/)[0] !== api.runtime.getURL('diagnostics.html')) throw new Error('没有读取诊断日志的权限。');
      return message.type === 'DIAGNOSTICS_GET' ? diagnostics.list() : diagnostics.clear();
    }
    if (message.type === 'IMAGE_DIGEST') {
      validateImage(message.image);
      const bytes = Uint8Array.from(atob(message.image.dataUrl.split(',')[1]), char => char.charCodeAt(0));
      const header = new TextEncoder().encode(`${message.image.width}x${message.image.height}:`);
      const payload = new Uint8Array(header.length + bytes.length); payload.set(header); payload.set(bytes, header.length);
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', payload))].map(n => n.toString(16).padStart(2, '0')).join('');
      return { digest };
    }
    if (message.type === 'STATUS') { if (isXSender(sender)) xTabs.add(sender.tab.id); return publicStatus(await read()); }
    if (message.type === 'SETTINGS_GET') { requireTrusted(sender); return read(); }
    if (message.type === 'SETTINGS_EDIT') {
      requireTrusted(sender);
      return enqueueWrite(async () => {
        const settings = await read();
        let stored, draftUnavailable = false;
        try { stored = (await (await draftStorage()).get('settingsDraft')).settingsDraft; }
        catch { draftUnavailable = true; }
        const { thinking: _thinking, ...draft } = stored?.draft || {};
        return { settings, configRevision, draft: stored?.configRevision === configRevision ? draft : null, draftUnavailable };
      });
    }
    if (message.type === 'SETTINGS_DRAFT_SAVE') {
      requireTrusted(sender);
      const raw = message.draft;
      let draft = null;
      if (raw !== null) {
        if (!raw || !['openai', 'deepseek', 'custom', 'anthropic', 'gemini'].includes(raw.provider) ||
            !Object.hasOwn(LANGUAGES, raw.defaultLanguage) ||
            Object.entries({ baseUrl: 2048, model: 200, apiKey: 2000 }).some(([key, limit]) => typeof raw[key] !== 'string' || raw[key].length > limit)) throw new Error('无效配置草稿。');
        draft = Object.fromEntries(['provider', 'baseUrl', 'model', 'apiKey', 'defaultLanguage'].map(key => [key, raw[key]]));
      }
      return enqueueWrite(async () => {
        await read();
        if (message.configRevision !== configRevision) throw new Error('已保存配置已变化，请重新打开设置后再修改。');
        const storage = await draftStorage();
        if (draft) await storage.set({ settingsDraft: { configRevision, draft } });
        else await storage.remove('settingsDraft');
        return {};
      });
    }
    if (message.type === 'SETTINGS_SAVE') {
      requireTrusted(sender);
      const settings = validateSettings(message.settings);
      await authorize(settings);
      const saved = await updateSettings(current => ({ ...settings, enabled: current.enabled }), true);
      return publicStatus(saved);
    }
    if (message.type === 'SET_ENABLED') {
      requireTrusted(sender);
      if (typeof message.enabled !== 'boolean') throw new Error('无效开关状态。');
      const settings = await updateSettings(current => ({ ...current, enabled: message.enabled }));
      if (!settings.enabled) for (const entry of active.values()) entry.controller.abort();
      return publicStatus(settings);
    }
    if (message.type === 'TEST') {
      requireTrusted(sender);
      context.settings = message.settings;
      const settings = validateSettings(message.settings);
      await authorize(settings);
      const start = Date.now();
      const result = await translate('Hello, world!', settings, { fetchImpl, onProgress() {} });
      return { ...result, elapsedMs: Date.now() - start };
    }
    const channel = channelFor(sender, message);
    if (message.type === 'CANCEL') {
      const previous = active.get(channel);
      if (previous?.id === message.requestId) previous.controller.abort();
      return {};
    }
    if (!['TRANSLATE', 'TRANSLATE_IMAGE'].includes(message.type)) {
      const result = await browser.handle(message, sender);
      if (result !== undefined) return result;
      throw new Error('不支持的请求。');
    }
    if (message.type === 'TRANSLATE') validateText(message.text);
    return runOperation(message, sender, async operationSignal => {
      // Register before async storage/permission checks so CANCEL and newer requests
      // cover the entire lifecycle, including requests that have not reached fetch.
      const settings = await read();
      context.settings = settings;
      context.configRevision = configRevision;
      if (operationSignal.aborted) throw Object.assign(new Error('翻译已取消。'), { code: 'CANCELLED' });
      if (!settings.enabled) throw Object.assign(new Error('翻译功能已关闭，请在扩展菜单中开启。'), { code: 'DISABLED' });
      if (!publicStatus(settings).configured) throw Object.assign(new Error('请先配置翻译服务。'), { code: 'CONFIG' });
      if (message.configRevision && message.configRevision !== configRevision) throw Object.assign(new Error('服务配置已变化，请重试。'), { code: 'CONFIG_CHANGED' });
      validateSettings(settings);
      await authorize(settings);
      if (operationSignal.aborted) throw Object.assign(new Error('翻译已取消。'), { code: 'CANCELLED' });
      const options = { fetchImpl, signal: operationSignal, onProgress, onPhase, onActivity, targetLanguage: message.targetLanguage };
      if (message.type === 'TRANSLATE') return translate(message.text, settings, options);
      let targetLanguage = message.targetLanguage || settings.defaultLanguage;
      if (!Object.hasOwn(LANGUAGES, targetLanguage)) throw new Error('无效目标语言。');
      let recognized;
      if (message.recognized) {
        recognized = parseRecognition(JSON.stringify(message.recognized));
      } else {
        validateImage(message.image);
        onPhase?.('recognizing');
        recognized = await recognizeImage(message.image, settings, { fetchImpl, signal: operationSignal, onActivity });
      }
      if (operationSignal.aborted) throw Object.assign(new Error('翻译已取消。'), { code: 'CANCELLED' });
      onRecognized?.(recognized);
      if (!recognized.text) return { ...recognized, targetLanguage, translation: '', outcome: 'empty' };
      if (!message.targetLanguage) targetLanguage = chooseTargetLanguage(recognized.sourceLanguage, settings.defaultLanguage);
      if (sameLanguage(recognized.sourceLanguage, targetLanguage)) return { ...recognized, targetLanguage, translation: recognized.text, outcome: 'same-language' };
      onPhase?.('translating');
      const result = await translate(recognized.text, settings, { ...options, targetLanguage, sourceLanguage: recognized.sourceLanguage, imageLayout: true });
      return { ...result, text: recognized.text, warnings: recognized.warnings, outcome: 'translated' };
    }, signal);
  }
  async function handle(message, sender, callbacks = {}) {
    const context = {}, started = Date.now();
    try { return await handleRequest(message, sender, callbacks, context); }
    catch (error) {
      if (sender?.id === api.runtime.id && !callbacks.signal?.aborted && error.code !== 'CANCELLED' &&
          ['TRANSLATE', 'TRANSLATE_IMAGE', 'TEST', 'READ_SOURCE', 'CAPTURE_REGION'].includes(message?.type) &&
          (message.type !== 'TEST' || trusted(sender))) {
        await diagnostics.add({
          operation: message.type, requestId: message.requestId, taskId: message.taskId,
          sourceKind: message.type === 'TEST' ? 'test' : message.type === 'TRANSLATE' ? 'text' : message.sourceKind,
          tabId: sender.tab?.id, configRevision: context.configRevision,
          provider: context.settings?.provider, model: context.settings?.model,
          code: error.code || 'SERVICE', stage: ({ READ_SOURCE: 'image_read', CAPTURE_REGION: 'capture' }[message.type] || 'preparation'),
          step: 'validation', reason: ['READ_SOURCE', 'CAPTURE_REGION'].includes(message.type) ? 'operation_failed' : 'validation', elapsedMs: Date.now() - started,
          ...error.diagnostic,
        }, context.settings?.apiKey);
      }
      throw error;
    }
  }
  function connect(port) {
    if (port.name !== 'translation' || port.sender?.id !== api.runtime.id) { port.disconnect(); return; }
    const controller = new AbortController();
    let started = false, closed = false;
    const post = message => { if (!closed) { try { port.postMessage(message); } catch { controller.abort(); } } };
    port.onDisconnect.addListener(() => { closed = true; controller.abort(); });
    port.onMessage.addListener(message => {
      if (closed || message?.type === 'PING') return;
      if (started || !['TRANSLATE', 'TRANSLATE_IMAGE'].includes(message?.type)) return;
      started = true;
      void handle(message, port.sender, {
        signal: controller.signal,
        onProgress: data => post({ type: 'PROGRESS', requestId: message.requestId, data }),
        onPhase: phase => post({ type: 'PHASE', requestId: message.requestId, phase }),
        onRecognized: data => post({ type: 'RECOGNIZED', requestId: message.requestId, data }),
        onActivity: () => post({ type: 'ACTIVITY', requestId: message.requestId }),
      }).then(
        data => post({ type: 'DONE', requestId: message.requestId, data }),
        error => post({ type: 'ERROR', requestId: message.requestId, error: error.message || '翻译失败，请重试。', code: error.code || 'SERVICE' }),
      ).finally(() => { closed = true; port.disconnect(); });
    });
  }
  async function contextClicked(info, tab) {
    if (!tab?.id || !['image-translation', 'capture-translation'].includes(info.menuItemId)) return;
    const attempt = entryErrors.begin(tab.id);
    try { await browser.contextClicked(info, tab); await entryErrors.success(tab.id, attempt); }
    catch (error) { await entryErrors.report(error, info, tab, attempt); }
  }
  return { handle, connect, captureChanged: browser.captureChanged, contextClicked, forgetTab(tabId) { for (const entry of active.values()) if (entry.tabId === tabId) entry.controller.abort(); xTabs.delete(tabId); browser.forgetTab(tabId); entryErrors.forget(tabId); } };
}
