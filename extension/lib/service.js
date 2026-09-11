import { DEFAULT_SETTINGS, validateSettings, validateText, permissionOrigin, translate } from './core.js';

export function createService(api, { fetchImpl = globalThis.fetch } = {}) {
  const ready = api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const active = new Map();
  const read = async () => ({ ...DEFAULT_SETTINGS, ...(await api.storage.local.get('settings')).settings });
  let writes = Promise.resolve();
  const updateSettings = update => {
    const task = writes.then(async () => {
      const settings = update(await read());
      await api.storage.local.set({ settings });
      return settings;
    });
    writes = task.catch(() => {});
    return task;
  };
  const trusted = sender => ['popup.html'].some(path => sender.url?.split(/[?#]/)[0] === api.runtime.getURL(path));
  const requireTrusted = sender => { if (!trusted(sender)) throw new Error('没有操作设置的权限。'); };
  const authorize = async settings => {
    if (!await api.permissions.contains({ origins: [permissionOrigin(settings.baseUrl)] })) {
      throw new Error('尚未授权访问 AI 服务，请打开设置，点击保存配置并允许访问。');
    }
  };
  const publicStatus = settings => ({
    enabled: settings.enabled, defaultLanguage: settings.defaultLanguage, provider: settings.provider,
    configured: Boolean(settings.apiKey && settings.model && settings.baseUrl),
  });

  async function handle(message, sender, { signal, onProgress, onPhase } = {}) {
    if (sender?.id !== api.runtime.id) throw new Error('没有访问扩展的权限。');
    await ready;
    if (signal?.aborted) throw new Error('翻译已取消。');
    if (!message || typeof message.type !== 'string') throw new Error('无效请求。');
    if (message.type === 'STATUS') return publicStatus(await read());
    if (message.type === 'SETTINGS_GET') { requireTrusted(sender); return read(); }
    if (message.type === 'SETTINGS_SAVE') {
      requireTrusted(sender);
      const settings = validateSettings(message.settings);
      await authorize(settings);
      const saved = await updateSettings(current => ({ ...settings, enabled: current.enabled }));
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
      const settings = validateSettings(message.settings);
      await authorize(settings);
      const start = Date.now();
      const result = await translate('Hello, world!', settings, { fetchImpl, onProgress() {} });
      return { ...result, elapsedMs: Date.now() - start };
    }
    const channel = `${sender.tab?.id ?? sender.url}:${sender.frameId ?? 0}:${sender.documentId ?? ''}`;
    if (message.type === 'CANCEL') {
      const previous = active.get(channel);
      if (previous?.id === message.requestId) previous.controller.abort();
      return {};
    }
    if (message.type !== 'TRANSLATE') throw new Error('不支持的请求。');
    validateText(message.text);
    if (typeof message.requestId !== 'string' || message.requestId.length > 100) throw new Error('无效请求编号。');
    active.get(channel)?.controller.abort();
    if (!active.has(channel) && active.size >= 5) throw new Error('同时进行的翻译较多，请稍后重试。');
    const controller = new AbortController();
    const entry = { id: message.requestId, controller };
    active.set(channel, entry);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      // Register before async storage/permission checks so CANCEL and newer requests
      // cover the entire lifecycle, including requests that have not reached fetch.
      const settings = await read();
      if (controller.signal.aborted) throw new Error('翻译已取消。');
      if (!settings.enabled) throw new Error('划词翻译已关闭，请在扩展菜单中开启。');
      if (!publicStatus(settings).configured) throw new Error('请先在设置中配置 AI 服务、模型和 API Key。');
      validateSettings(settings);
      await authorize(settings);
      if (controller.signal.aborted) throw new Error('翻译已取消。');
      return await translate(message.text, settings, { fetchImpl, signal: controller.signal, onProgress, onPhase });
    }
    finally { signal?.removeEventListener('abort', abort); if (active.get(channel) === entry) active.delete(channel); }
  }
  function connect(port) {
    if (port.name !== 'translation' || port.sender?.id !== api.runtime.id) { port.disconnect(); return; }
    const controller = new AbortController();
    let started = false, closed = false;
    const post = message => { if (!closed) { try { port.postMessage(message); } catch { controller.abort(); } } };
    port.onDisconnect.addListener(() => { closed = true; controller.abort(); });
    port.onMessage.addListener(message => {
      if (closed || message?.type === 'PING') return;
      if (started || message?.type !== 'TRANSLATE') return;
      started = true;
      void handle(message, port.sender, {
        signal: controller.signal,
        onProgress: data => post({ type: 'PROGRESS', requestId: message.requestId, data }),
        onPhase: phase => post({ type: 'PHASE', requestId: message.requestId, phase }),
      }).then(
        data => post({ type: 'DONE', requestId: message.requestId, data }),
        error => post({ type: 'ERROR', requestId: message.requestId, error: error.message || '翻译失败，请重试。' }),
      ).finally(() => { closed = true; port.disconnect(); });
    });
  }
  return { handle, connect };
}
