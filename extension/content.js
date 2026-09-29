(() => {
  if (globalThis.__openTransAILoaded) return;
  globalThis.__openTransAILoaded = true;
  const A = globalThis.OpenTransAIPage;
  if (!A?.alive()) return;
  const isTop = window === window.top;
  let task = null, revision = 0, port = null, heartbeat, activityTimer, focusBefore, openedAt = 0, capture = null, captureHidden = false, captureIntent = null, entries = null, view = null;
  const timestamp = () => performance.timeOrigin + performance.now();
  A.onInvalidated(() => {
    revision++; captureIntent = null; task = null; focusBefore = null;
    disconnect(); capture?.cancel(); view?.close(); entries?.hide();
  });
  entries = A.createEntries({ suspended: () => captureHidden || capture?.active || false, onError: error => { if (isTop) showError(error); } });
  if (!A.alive()) return;
  view = isTop ? A.createPanel({ close, cancel: () => cancelTask(), retry: () => void run({ force: true }).catch(showError), language: code => { if (task) { task.explicitTarget = code; void run({ switching: true }).catch(showError); } }, settings: () => void A.send('OPEN_SETTINGS').catch(showError), capture: () => void beginCapture(), access: () => void A.send('REQUEST_ACCESS', { purpose: 'image', sourceId: task?.source.id }).catch(showError) }) : null;
  if (!A.alive()) return;
  if (isTop) capture = A.createCapture({ onStart: async () => { entries.hide(); view.pause(true); await A.send('CAPTURE_MODE', { active: true }); }, onCancel: () => { captureIntent = null; if (!A.alive()) return; view.pause(false); void A.send('CAPTURE_MODE', { active: false }).catch(() => {}); }, onAccess: () => void beginCapture(true), onImage: (image, anchor) => { void A.send('CAPTURE_MODE', { active: false }).catch(() => {}); void openSource({ kind: 'screenshot', id: A.uid(), image }, anchor).catch(showError); } });
  function disconnect() { clearInterval(heartbeat); clearInterval(activityTimer); if (port) { const old = port; port = null; try { old.disconnect(); } catch (error) { A.runtimeError(error); } } }
  function invalidate() {
    revision++;
    const id = task?.requestId; disconnect();
    if (id && A.alive()) void A.send('CANCEL', { requestId: id }).catch(() => {});
  }
  function close({ restoreFocus = true } = {}) { captureIntent = null; capture?.cancel(); invalidate(); view?.close(); task = null; entries.hide(); if (restoreFocus && focusBefore?.isConnected) focusBefore.focus?.({ preventScroll: true }); focusBefore = null; }
  function dismiss(at, explicit = false) {
    // Frame clicks are asynchronous: a click preceding this panel must not close it.
    if (task && (explicit || !view?.pinned) && !capture?.active && !captureHidden && Number.isFinite(at) && at >= openedAt) close({ restoreFocus: explicit });
  }
  function cancelTask() { if (!A.alive() || !task) return; invalidate(); if (!A.alive() || !task) return; task.busy = false; task.switching = false; task.state = 'cancelled'; view.render(task); }
  function showError(error) {
    if (!A.alive() || !view) return;
    if (!task) { task = { source: { kind: 'text', text: '' }, kind: 'text', defaultLanguage: 'zh-CN', state: 'error', busy: false, translation: '' }; openedAt = timestamp(); view.open(task); }
    task.busy = false; task.switching = false; task.state = 'error'; task.error = error.message; task.code = error.code || 'SERVICE'; view.render(task);
  }
  async function beginCapture(forceAccess = false) {
    if (!A.alive()) return;
    const intent = captureIntent = A.uid();
    try {
      const status = await A.send('PREPARE_CAPTURE');
      if (captureIntent !== intent) return;
      if (forceAccess || !status.allowed) { await A.send('REQUEST_ACCESS', { purpose: 'capture', intent }); return; }
      await capture.begin();
    } catch (error) { if (captureIntent === intent) { captureIntent = null; if (task) view.notice(error.message); else showError(error); } }
  }
  async function openSource(source, anchor) {
    if (!A.alive() || !view) return;
    captureIntent = null; capture?.cancel();
    if (task?.busy && task.source.id === source.id) { view.focus(); return; }
    const previous = task?.state === 'ready' || task?.state === 'same-language' ? task : null;
    invalidate(); entries.hide();
    if (!A.alive()) return;
    focusBefore = A.isExtensionNode(document.activeElement) ? focusBefore : document.activeElement;
    task = { id: A.uid(), source, kind: source.kind, anchor, defaultLanguage: 'zh-CN', state: source.kind === 'text' ? 'waiting' : 'reading', busy: true, translation: '', previous };
    openedAt = timestamp(); view.open(task); await run({ reread: true });
  }
  async function run({ force = false, switching = false, reread = false } = {}) {
    if (!A.alive() || !task) return;
    invalidate(); const version = revision, current = task;
    if (!A.alive() || !current) return;
    const valid = () => A.alive() && revision === version && task === current;
    current.requestId = A.uid(); current.busy = true; current.error = ''; current.code = ''; current.slow = false; current.switching = switching;
    if (!switching) { current.translation = ''; view.resetScroll(); }
    current.state = current.kind === 'text' ? 'waiting' : current.recognized ? 'translating' : 'reading'; view.render(current);
    let lastProgress = Date.now();
    const progress = () => { lastProgress = Date.now(); current.slow = false; };
    activityTimer = setInterval(() => {
      if (!valid() || !current.busy) return;
      const idle = Date.now() - lastProgress;
      if (idle >= 60000) { invalidate(); if (!A.alive()) return; current.busy = false; current.switching = false; current.state = 'error'; current.code = 'TIMEOUT'; current.error = '处理超时，请重试或缩小图片范围。'; view.render(current); return; }
      if (idle >= 15000 && !current.slow) { current.slow = true; view.render(current); }
    }, 1000);
    try {
      const config = await A.send('STATUS'); if (!valid()) return;
      if (!config.enabled) throw Object.assign(new Error('翻译功能已关闭，请在扩展菜单中开启。'), { code: 'DISABLED' });
      if (!config.configured) throw Object.assign(new Error('请先配置翻译服务。'), { code: 'CONFIG' });
      if (current.configRevision && current.configRevision !== config.configRevision) current.recognized = null;
      current.configRevision = config.configRevision; current.defaultLanguage = config.defaultLanguage;
      if (!current.targetLanguage) current.targetLanguage = current.explicitTarget || config.defaultLanguage;
      if (current.kind !== 'text') {
        if (reread || !current.image) {
          current.state = 'reading'; view.render(current);
          const data = current.kind === 'screenshot' ? { image: current.source.image } : await A.send('READ_SOURCE', { sourceId: current.source.id, requestId: current.requestId });
          if (!valid()) return;
          current.image = data.image; current.imageDigest = await A.digest(data.image); if (!valid()) return; progress();
          const cache = current.previous;
          if (!force && cache?.imageDigest === current.imageDigest && cache.configRevision === config.configRevision) {
            current.recognized = cache.recognized;
            // Automatic direction may resolve to English instead of the default language.
            if (cache.explicitTarget === current.explicitTarget) {
              Object.assign(current, { translation: cache.translation, state: cache.state, targetLanguage: cache.targetLanguage, busy: false }); current.previous = null; disconnect(); view.render(current); return;
            }
          }
          current.previous = null;
        }
      }
      if (!valid()) return;
      const payload = { type: current.kind === 'text' ? 'TRANSLATE' : 'TRANSLATE_IMAGE', requestId: current.requestId, taskId: current.id, configRevision: current.configRevision, imageDigest: current.imageDigest, sourceKind: current.kind };
      if (current.kind === 'text') { payload.text = current.source.text; if (current.explicitTarget) payload.targetLanguage = current.explicitTarget; }
      else { if (current.explicitTarget) payload.targetLanguage = current.explicitTarget; if (current.recognized) payload.recognized = current.recognized; else payload.image = current.image; }
      const stream = A.connect({ name: 'translation' }); port = stream;
      let finished = false;
      stream.onMessage.addListener(message => {
        if (!valid() || finished || message.requestId !== current.requestId) return;
        if (message.type === 'ACTIVITY') { progress(); return; }
        if (message.type === 'PHASE') { current.state = message.phase; progress(); }
        if (message.type === 'RECOGNIZED') { current.recognized = message.data; progress(); }
        if (message.type === 'PROGRESS') { Object.assign(current, message.data); current.state = 'translating'; current.switching = false; progress(); }
        if (['DONE', 'ERROR'].includes(message.type)) {
          finished = true; current.busy = false; current.switching = false;
          if (message.type === 'DONE') { Object.assign(current, message.data); current.state = message.data.outcome === 'empty' ? 'empty' : message.data.outcome === 'same-language' ? 'same-language' : 'ready'; }
          else { current.state = 'error'; current.error = message.error; current.code = message.code; }
          disconnect();
        }
        if (valid()) view.render(current);
      });
      stream.onDisconnect.addListener(() => {
        // Read lastError in its callback so Chrome does not report it as unchecked.
        try { if (chrome.runtime?.lastError) A.runtimeError(chrome.runtime.lastError); } catch (error) { A.runtimeError(error); }
        if (!valid() || finished) return;
        finished = true; disconnect();
        if (valid()) showError(Object.assign(new Error('翻译连接中断，请重试。'), { code: 'CONNECTION' }));
      });
      stream.postMessage(payload);
      if (valid() && !finished) heartbeat = setInterval(() => { if (!valid()) return; try { stream.postMessage({ type: 'PING' }); } catch (error) { const failure = A.runtimeError(error); if (valid()) { disconnect(); showError(failure); } } }, 20000);
    } catch (error) { if (valid()) { const failure = A.runtimeError(error); disconnect(); showError(error.code ? error : failure); } }
  }
  function selection(event) {
    const target = event.composedPath()[0];
    if (target instanceof HTMLInputElement && !['text', 'search', 'url', 'tel', 'email'].includes(target.type)) return null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      if (target.selectionStart === target.selectionEnd) return null;
      const text = target.value.slice(target.selectionStart, target.selectionEnd).trim();
      return text ? { text, anchor: { left: event.clientX, right: event.clientX, top: event.clientY - 12, bottom: event.clientY + 5 } } : null;
    }
    const selected = getSelection(); if (!selected?.rangeCount || selected.isCollapsed || !selected.toString().trim()) return null;
    const r = selected.getRangeAt(0).getBoundingClientRect();
    return { text: selected.toString().trim(), anchor: { left: event.clientX || r.left, right: r.right, top: r.top, bottom: r.bottom } };
  }
  A.listen(document, 'pointerdown', event => {
    if (captureHidden || capture?.active || view?.contains(event) || event.composedPath().some(node => ['opentransai-entry', 'opentransai-capture'].includes(node?.id))) return;
    const at = timestamp();
    if (isTop) dismiss(at);
    else void A.send('DISMISS_PANEL', { at }).catch(() => {});
  }, { capture: true, passive: true });
  A.listen(document, 'mouseup', event => {
    if (event.button || capture?.active || event.composedPath().some(A.isExtensionNode)) return;
    const selected = selection(event); if (selected) void entries.selection(selected).catch(() => {});
  });
  A.listen(document, 'keydown', event => {
    if (event.key !== 'Escape' || capture?.active || captureHidden) return;
    if (task) close();
    else {
      entries.hide();
      if (!isTop) void A.send('CLOSE_PANEL', { at: timestamp() }).catch(() => {});
    }
  });
  A.listen(window, 'pagehide', () => { capture?.cancel(); close(); });
  const receive = (message, _sender, sendResponse) => {
    if (!A.alive()) return;
    const reply = value => { if (A.alive()) { try { sendResponse(value); } catch (error) { A.runtimeError(error); } } };
    if (message.type === 'CAPTURE_VISIBILITY') { captureHidden = message.active; if (captureHidden) entries.hide(); reply({ ok: true }); return; }
    if (message.type === 'HIDE_ENTRY') { entries.claim(message.owner); reply({ ok: true }); return; }
    if (message.type === 'READ_IMAGE') { void entries.read(message.token, message.url).then(reply).catch(() => reply({ code: 'READ', error: '无法读取这张图片，请重试。' })); return true; }
    if (message.type === 'CONTEXT_IMAGE') { void entries.context(message.url).then(() => reply({ ok: true })).catch(error => reply({ ok: false, code: error.code || 'SERVICE', error: error.message })); return true; }
    if (!isTop) return;
    if (message.type === 'ENTRY_ERROR') {
      if (message.expectedUrl !== location.href) { reply({ ok: false }); return; }
      captureIntent = null; capture?.cancel(); invalidate(); entries.hide();
      const error = message.error;
      task = { source: { kind: error.sourceKind }, kind: error.sourceKind, state: 'error', busy: false, translation: '', error: error.message, code: error.code, entryError: error, defaultLanguage: 'zh-CN' };
      openedAt = timestamp(); view.open(task); reply({ ok: true }); return;
    }
    if (message.type === 'DISMISS_PANEL') { dismiss(message.at); reply({ ok: true }); }
    if (message.type === 'CLOSE_PANEL') { dismiss(message.at, true); reply({ ok: true }); }
    if (message.type === 'OPEN_SOURCE') { void openSource(message.source, message.anchor).catch(showError); reply({ ok: true }); }
    if (message.type === 'BEGIN_CAPTURE') { void beginCapture(); reply({ ok: true }); }
    if (message.type === 'CAPTURE_VERIFY') reply(capture.verify(message.nonce));
    if (message.type === 'ACCESS_FINISHED') {
      if (message.granted) { if (message.purpose === 'capture') { if (captureIntent && captureIntent === message.intent) void beginCapture(); } else if (task?.source.id === message.sourceId) void run({ reread: true }).catch(showError); }
      reply({ ok: true });
    }
  };
  try {
    const messages = chrome.runtime.onMessage;
    messages.addListener(receive);
    A.onInvalidated(() => messages.removeListener(receive));
  } catch (error) { A.runtimeError(error); }
})();
