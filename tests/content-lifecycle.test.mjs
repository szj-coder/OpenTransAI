import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Run the real content controller; substitute only page widgets and Chrome I/O.
async function controller({ child = false, missingRuntime = false } = {}) {
  let pinned = false, actions, receive, uuid = 0, prepare, captureStarts = 0, opened = 0, closed = 0, renders = 0, focused = 0, rendered, now = 100;
  const ports = [], messages = [], selections = [], listeners = new Map();
  const timers = new Map(), faults = {};
  const panelHost = { id: 'opentransai-root' };
  const capture = { active: false, async begin() { captureStarts++; capture.active = true; }, cancel() { capture.active = false; }, verify: () => ({}) };
  const status = { enabled: true, configured: true, defaultLanguage: 'zh-CN', configRevision: 'revision-1' };
  const image = { dataUrl: 'data:image/png;base64,eA==', width: 100, height: 100 };
  const A = {
    uid: () => `test-id-${++uuid}`,
    createEntries: () => ({ hide() {}, claim() {}, read: async () => ({}), context: async () => { if (faults.context) throw faults.context; }, async selection(snapshot) { selections.push(snapshot); } }),
    createPanel(callbacks) {
      actions = callbacks;
      return {
        get pinned() { return pinned; },
        open(task) { pinned = false; opened++; rendered = { ...task }; },
        render(task) { renders++; rendered = { ...task }; },
        contains(event) { return event.composedPath().includes(panelHost); },
        close() { closed++; }, pause() {}, focus() {}, resetScroll() {}, notice() {},
      };
    },
    createCapture: () => capture,
    digest: async () => 'same-image-digest',
    async send(type, payload = {}) {
      messages.push({ type, ...payload });
      if (type === 'STATUS') return status;
      if (type === 'READ_SOURCE') return { image };
      if (type === 'PREPARE_CAPTURE') return prepare ? prepare() : { allowed: true };
      return {};
    },
  };
  const window = { addEventListener() {}, removeEventListener() {} }; window.top = child ? {} : window;
  const document = {
    activeElement: { isConnected: true, focus() { focused++; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const chrome = {
    runtime: {
      id: 'test-extension',
      getURL: path => `chrome-extension://test-extension/${path}`,
      onMessage: { addListener(listener) { receive = listener; }, removeListener() {} },
      async sendMessage({ type, ...payload }) {
        if (faults.send) return faults.send(type, payload);
        return { ok: true, data: await A.send(type, payload) };
      },
      connect() {
        if (faults.connect) throw faults.connect;
        const port = {
          onMessage: { addListener(listener) { port.receive = listener; } },
          onDisconnect: { addListener(listener) { port.disconnected = listener; } },
          disconnect() { port.closed = true; if (faults.disconnect) throw faults.disconnect; },
          postMessage(payload) { if (faults.post) throw faults.post; port.payload = payload; },
        };
        ports.push(port); return port;
      },
    },
  };
  const runtime = chrome.runtime;
  if (missingRuntime) delete chrome.runtime;
  const context = vm.createContext({
    window, document, chrome, location: { href: 'https://page.example/' },
    performance: { timeOrigin: 1000, now: () => now },
    crypto: { randomUUID: A.uid }, setInterval(fn) { const id = ++uuid; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); },
    HTMLInputElement: class {}, HTMLTextAreaElement: class {}, Date,
    getSelection: () => ({ rangeCount: 1, isCollapsed: false, toString: () => 'selected text', getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 10, right: 50, top: 20, bottom: 40 }) }) }),
  });
  vm.runInContext(await readFile(new URL('../extension/lib/page-shared.js', import.meta.url), 'utf8'), context);
  const { send: _send, ...widgets } = A;
  Object.assign(context.OpenTransAIPage, widgets);
  vm.runInContext(await readFile(new URL('../extension/content.js', import.meta.url), 'utf8'), context);
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const dispatch = message => receive?.(message, null, () => {});
  return {
    ports, messages, flush, panelHost, capture, chrome, runtime, timers, faults, listeners, document, selections,
    pin(value) { pinned = value; },
    get actions() { return actions; }, get task() { return rendered; },
    stats: () => ({ captureStarts, opened, closed, renders, focused }),
    tick() { now += 10; return 1000 + now; },
    pointer(path = [{}]) { const event = { composedPath: () => path, preventDefault() { assert.fail('page click was blocked'); }, stopPropagation() { assert.fail('page click was swallowed'); } }; listeners.get('pointerdown')?.(event); },
    prepare(callback) { prepare = callback; },
    dispatch, response(message) { return new Promise(resolve => receive(message, null, resolve)); },
    async open(id = 'image-source-1') { dispatch({ type: 'OPEN_SOURCE', source: { kind: 'image', id }, anchor: null }); await flush(); },
  };
}

test('outside pointer closes and cancels without restoring old focus or accepting late stream events', async () => {
  const h = await controller(); await h.open();
  const port = h.ports[0], requestId = port.payload.requestId, before = h.stats();
  h.tick(); h.pointer();
  assert.equal(h.stats().closed, 1); assert.equal(h.stats().focused, 0);
  assert.equal(port.closed, true); assert(h.messages.some(m => m.type === 'CANCEL' && m.requestId === requestId));
  for (const type of ['RECOGNIZED', 'PROGRESS', 'DONE', 'ERROR']) port.receive({ type, requestId, data: { text: 'late', translation: 'late', outcome: 'translated' } });
  port.disconnected(); await h.flush();
  assert.equal(h.stats().opened, before.opened); assert.equal(h.stats().renders, before.renders);
});

test('entry failure replaces a running task in the same panel and rejects stale stream updates', async () => {
  const h = await controller(); await h.open();
  const old = h.ports[0], requestId = old.payload.requestId;
  const error = { sourceKind: 'image', message: '网页脚本未连接', code: 'PAGE_CONNECTION', hint: '请刷新网页', details: 'request-123' };
  const response = await h.response({ type: 'ENTRY_ERROR', expectedUrl: 'https://page.example/', error });
  assert.equal(response.ok, true); assert.equal(old.closed, true);
  assert.equal(h.task.entryError, error); assert.equal(h.task.state, 'error');
  old.receive({ type: 'DONE', requestId, data: { translation: 'stale' } });
  assert.equal(h.task.translation, '');
  h.actions.close(); assert.equal(h.stats().closed, 1);
});

test('entry errors cannot replace a panel after navigation and iframe failures reply without hanging', async () => {
  const h = await controller(); await h.open(); const before = h.stats().opened;
  const response = await h.response({ type: 'ENTRY_ERROR', expectedUrl: 'https://old.example/', error: {} });
  assert.equal(response.ok, false); assert.equal(h.stats().opened, before);
  const child = await controller({ child: true });
  child.faults.context = Object.assign(Error('翻译已关闭'), { code: 'DISABLED' });
  const reply = await child.response({ type: 'CONTEXT_IMAGE', url: 'https://example.test/image.png' });
  assert.equal(reply.ok, false); assert.equal(reply.code, 'DISABLED'); assert.equal(child.stats().opened, 0);
});

test('panel contents and selection trigger do not dismiss the translation', async () => {
  const h = await controller(); await h.open(); h.tick();
  h.pointer([{}, h.panelHost]); h.pointer([{ id: 'opentransai-entry' }]);
  assert.equal(h.stats().closed, 0); assert.notEqual(h.ports[0].closed, true);
});

test('capture selection keeps the previous task, including forwarded iframe clicks', async () => {
  const h = await controller(); await h.open(); h.actions.capture(); await h.flush();
  assert.equal(h.capture.active, true);
  const at = h.tick(); h.pointer(); h.dispatch({ type: 'DISMISS_PANEL', at });
  assert.equal(h.stats().closed, 0); assert.notEqual(h.ports[0].closed, true);
  h.capture.active = false; h.dispatch({ type: 'CAPTURE_VISIBILITY', active: true }); h.pointer();
  assert.equal(h.stats().closed, 0);
});

test('explicit close still restores the original focus once', async () => {
  const h = await controller(); await h.open(); h.actions.close();
  assert.equal(h.stats().focused, 1);
  h.actions.close(); assert.equal(h.stats().focused, 1);
});

test('late iframe outside click cannot dismiss a newer panel', async () => {
  const h = await controller(); await h.open(); const at = h.tick();
  h.tick(); await h.open('new-source');
  h.dispatch({ type: 'DISMISS_PANEL', at }); assert.equal(h.stats().closed, 0);
  h.dispatch({ type: 'DISMISS_PANEL', at: h.tick() }); assert.equal(h.stats().closed, 1);
});

test('iframe outside pointer forwards only a timestamp and ignores plugin/capture surfaces', async () => {
  const h = await controller({ child: true }); h.pointer([{ id: 'opentransai-entry' }]);
  assert.equal(h.messages.length, 0);
  const at = h.tick(); h.pointer(); await h.flush();
  assert.equal(h.messages.length, 1); assert.equal(h.messages[0].type, 'DISMISS_PANEL'); assert.equal(h.messages[0].at, at);
  h.dispatch({ type: 'CAPTURE_VISIBILITY', active: true }); h.pointer(); assert.equal(h.messages.length, 1);
});

for (const termination of ['close', 'replace']) {
  test(`late capture preparation cannot reopen overlay after ${termination}`, async () => {
    const h = await controller(); await h.open(); let resolve;
    h.prepare(() => new Promise(done => { resolve = done; }));
    h.actions.capture(); await h.flush();
    assert.equal(typeof resolve, 'function');
    if (termination === 'close') h.actions.close(); else await h.open('image-source-2');
    resolve({ allowed: true }); await h.flush();
    assert.equal(h.stats().captureStarts, 0, 'obsolete capture preparation opened an overlay');
  });
}

test('late capture preparation error cannot reopen an error panel after close', async () => {
  const h = await controller(); await h.open(); let reject;
  h.prepare(() => new Promise((_resolve, fail) => { reject = fail; }));
  h.actions.capture(); await h.flush(); h.actions.close();
  reject(Object.assign(Error('截图准备失败'), { code: 'CAPTURE_UNAVAILABLE' })); await h.flush();
  assert.equal(h.stats().opened, 1, 'late preparation error reopened the closed translation panel');
});

test('late capture permission completion cannot resume capture after close', async () => {
  const h = await controller(); await h.open(); h.prepare(() => ({ allowed: false }));
  h.actions.capture(); await h.flush();
  const request = h.messages.find(message => message.type === 'REQUEST_ACCESS' && message.purpose === 'capture');
  assert(request, 'capture permission was never requested');
  h.actions.close(); h.prepare(() => ({ allowed: true }));
  h.dispatch({ type: 'ACCESS_FINISHED', purpose: 'capture', granted: true, intent: request.intent }); await h.flush();
  assert.equal(h.stats().captureStarts, 0, 'obsolete capture permission opened an overlay');
});

for (const kind of ['image', 'screenshot']) {
  test(`${kind} starts with automatic language selection and retries without making the default explicit`, async () => {
    const h = await controller();
    h.dispatch({ type: 'OPEN_SOURCE', source: { kind, id: 'auto-source', image: { dataUrl: 'data:image/png;base64,eA==', width: 1, height: 1 } } });
    await h.flush();
    const first = h.ports[0], requestId = first.payload.requestId;
    assert.equal(Object.hasOwn(first.payload, 'targetLanguage'), false);
    const recognized = { text: '你好', sourceLanguage: 'zh-CN', warnings: [] };
    first.receive({ type: 'RECOGNIZED', requestId, data: recognized });
    first.receive({ type: 'ERROR', requestId, error: '暂时不可用', code: 'SERVICE' });
    h.actions.retry(); await h.flush();
    const retry = h.ports[1];
    assert.equal(Object.hasOwn(retry.payload, 'targetLanguage'), false);
    assert.deepEqual(retry.payload.recognized, recognized);
    assert.equal(retry.payload.image, undefined);
    retry.receive({ type: 'DONE', requestId: retry.payload.requestId, data: { ...recognized, targetLanguage: 'en', translation: 'Hello', outcome: 'translated' } });
    assert.equal(h.task.state, 'ready'); assert.equal(h.task.targetLanguage, 'en');
  });
}

test('reopening an automatically translated Chinese image reuses its English result', async () => {
  const h = await controller(); await h.open();
  const first = h.ports[0], requestId = first.payload.requestId;
  const recognized = { text: '你好', sourceLanguage: 'zh-CN', warnings: [] };
  first.receive({ type: 'RECOGNIZED', requestId, data: recognized });
  first.receive({ type: 'DONE', requestId, data: { ...recognized, targetLanguage: 'en', translation: 'Hello', outcome: 'translated' } });
  await h.open();
  assert.equal(h.ports.length, 1, 'automatic English result triggered another translation');
  assert.equal(h.task.translation, 'Hello'); assert.equal(h.task.targetLanguage, 'en'); assert.equal(h.task.state, 'ready');
});

test('a manual same-language choice does not replace automatic direction when reopening the image', async () => {
  const h = await controller(); await h.open();
  const first = h.ports[0], requestId = first.payload.requestId;
  const recognized = { text: '你好', sourceLanguage: 'zh-CN', warnings: [] };
  first.receive({ type: 'RECOGNIZED', requestId, data: recognized });
  first.receive({ type: 'DONE', requestId, data: { ...recognized, targetLanguage: 'en', translation: 'Hello', outcome: 'translated' } });
  h.actions.language('zh-CN'); await h.flush();
  const explicit = h.ports[1];
  assert.equal(explicit.payload.targetLanguage, 'zh-CN'); assert.equal(explicit.payload.image, undefined);
  explicit.receive({ type: 'DONE', requestId: explicit.payload.requestId, data: { ...recognized, targetLanguage: 'zh-CN', translation: recognized.text, outcome: 'same-language' } });
  await h.open();
  assert.equal(h.ports.length, 3, 'manual same-language result masked automatic English translation');
  assert.equal(Object.hasOwn(h.ports[2].payload, 'targetLanguage'), false);
  assert.deepEqual(h.ports[2].payload.recognized, recognized);
  assert.equal(h.ports[2].payload.image, undefined);
});

test('target change reuses successful empty OCR without submitting image for another recognition', async () => {
  const h = await controller(); await h.open();
  const first = h.ports[0], requestId = first.payload.requestId;
  const recognized = { text: '', sourceLanguage: 'und', warnings: [] };
  first.receive({ type: 'RECOGNIZED', requestId, data: recognized });
  first.receive({ type: 'DONE', requestId, data: { ...recognized, targetLanguage: 'zh-CN', translation: '', outcome: 'empty' } });
  assert.equal(h.task.state, 'empty');
  h.actions.language('ja'); await h.flush();
  for (const port of h.ports.slice(1)) {
    assert.equal(port.payload.image, undefined, 'target-only change resubmitted pixels for recognition');
    assert.deepEqual(port.payload.recognized, recognized);
    assert.equal(port.payload.targetLanguage, 'ja');
  }
  assert.equal(h.messages.filter(message => message.type === 'READ_SOURCE').length, 1, 'target-only change reread the source image');
  assert.equal(h.task.explicitTarget, 'ja');
  assert.deepEqual(h.task.recognized, recognized);
});

test('matching permission intent resumes the still-current capture request', async () => {
  const h = await controller(); await h.open(); h.prepare(() => ({ allowed: false }));
  h.actions.capture(); await h.flush();
  const request = h.messages.find(message => message.type === 'REQUEST_ACCESS' && message.purpose === 'capture');
  assert.equal(typeof request?.intent, 'string'); assert(request.intent.length > 0);
  h.prepare(() => ({ allowed: true }));
  h.dispatch({ type: 'ACCESS_FINISHED', purpose: 'capture', granted: true, intent: request.intent }); await h.flush();
  assert.equal(h.stats().captureStarts, 1, 'valid permission intent was ignored');
});

test('A09 switching to image B rejects every late recognized/progress/done update from image A', async () => {
  const h = await controller(); await h.open('image-source-A');
  const old = h.ports[0], oldRequest = old.payload.requestId;
  await h.open('image-source-B');
  const current = h.ports[1], requestId = current.payload.requestId;
  assert.notEqual(requestId, oldRequest);
  const stale = [
    { type: 'RECOGNIZED', data: { text: 'stale A', sourceLanguage: 'en', warnings: [] } },
    { type: 'PROGRESS', data: { sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '过期图片 A' } },
    { type: 'DONE', data: { sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '过期图片 A 完成', outcome: 'translated' } },
  ];
  for (const message of stale) {
    old.receive({ ...message, requestId: oldRequest });
    assert.equal(h.task.source.id, 'image-source-B'); assert.equal(h.task.requestId, requestId);
    assert.equal(h.task.recognized, undefined); assert.equal(h.task.translation, ''); assert.equal(h.task.busy, true);
  }
  const recognized = { text: 'fresh B', sourceLanguage: 'en', warnings: [] };
  current.receive({ type: 'RECOGNIZED', requestId, data: recognized });
  current.receive({ type: 'DONE', requestId, data: { sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '当前图片 B', outcome: 'translated' } });
  for (const message of stale) old.receive({ ...message, requestId: oldRequest });
  assert.equal(h.task.source.id, 'image-source-B'); assert.equal(h.task.translation, '当前图片 B');
  assert.deepEqual(h.task.recognized, recognized); assert.equal(h.task.state, 'ready'); assert.equal(h.task.busy, false);
});

test('A16 consecutive target changes reject older language responses while retaining OCR and latest result', async () => {
  const h = await controller(); await h.open();
  const first = h.ports[0], requestId = first.payload.requestId;
  const recognized = { text: 'Hello', sourceLanguage: 'en', warnings: [] };
  first.receive({ type: 'RECOGNIZED', requestId, data: recognized });
  first.receive({ type: 'DONE', requestId, data: { sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好', outcome: 'translated' } });
  h.actions.language('ja'); await h.flush(); const old = h.ports[1];
  h.actions.language('fr'); await h.flush(); const current = h.ports[2];
  assert.equal(old.payload.targetLanguage, 'ja'); assert.equal(current.payload.targetLanguage, 'fr');
  assert.deepEqual(old.payload.recognized, recognized); assert.deepEqual(current.payload.recognized, recognized);
  assert.equal(old.payload.image, undefined); assert.equal(current.payload.image, undefined);
  const stale = [
    { type: 'RECOGNIZED', data: { text: 'Wrong stale text', sourceLanguage: 'ja', warnings: [] } },
    { type: 'PROGRESS', data: { sourceLanguage: 'en', targetLanguage: 'ja', translation: 'こんにちは' } },
    { type: 'DONE', data: { sourceLanguage: 'en', targetLanguage: 'ja', translation: 'こんにちは 完成', outcome: 'translated' } },
  ];
  for (const message of stale) {
    old.receive({ ...message, requestId: old.payload.requestId });
    assert.equal(h.task.explicitTarget, 'fr'); assert.equal(h.task.translation, '你好');
    assert.deepEqual(h.task.recognized, recognized); assert.equal(h.task.busy, true); assert.equal(h.task.switching, true);
  }
  current.receive({ type: 'PROGRESS', requestId: current.payload.requestId, data: { sourceLanguage: 'en', targetLanguage: 'fr', translation: 'Bon' } });
  current.receive({ type: 'DONE', requestId: current.payload.requestId, data: { sourceLanguage: 'en', targetLanguage: 'fr', translation: 'Bonjour', outcome: 'translated' } });
  for (const message of stale) old.receive({ ...message, requestId: old.payload.requestId });
  assert.equal(h.task.targetLanguage, 'fr'); assert.equal(h.task.explicitTarget, 'fr'); assert.equal(h.task.translation, 'Bonjour');
  assert.deepEqual(h.task.recognized, recognized); assert.equal(h.task.busy, false); assert.equal(h.task.state, 'ready');
  assert.equal(h.messages.filter(message => message.type === 'READ_SOURCE').length, 1);
});

test('missing runtime at injection installs no controller widgets or page listeners', async () => {
  const h = await controller({ missingRuntime: true });
  assert.equal(h.actions, undefined);
  assert.equal(h.listeners.size, 0);
  assert.equal(h.timers.size, 0);
});

test('runtime removal retires the old page controller, including throwing port disconnect and late events', async () => {
  const h = await controller(); await h.open();
  const old = h.ports[0], before = h.stats(), count = h.messages.length;
  h.faults.disconnect = Error('Extension context invalidated.');
  delete h.chrome.runtime;
  assert.doesNotThrow(() => h.pointer());
  assert.equal(old.closed, true); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
  assert.equal(h.stats().closed, before.closed + 1);
  old.receive({ type: 'DONE', requestId: old.payload.requestId, data: { translation: 'late' } });
  old.disconnected(); h.dispatch({ type: 'OPEN_SOURCE', source: { kind: 'text', text: 'late' } }); await h.flush();
  assert.equal(h.stats().renders, before.renders); assert.equal(h.stats().opened, before.opened);
  assert.equal(h.messages.length, count, 'invalidated context attempted new service work');
});

test('invalidation during connect closes the task instead of opening another error panel', async () => {
  const h = await controller(); h.faults.connect = Error('Extension context invalidated.');
  await h.open();
  assert.equal(h.stats().opened, 1); assert.equal(h.stats().closed, 1);
  assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
  await h.open('ignored'); assert.equal(h.stats().opened, 1);
});

test('invalidation during heartbeat stops timers even if no disconnect event arrives', async () => {
  const h = await controller(); await h.open(); h.faults.post = Error('Extension context invalidated.');
  const heartbeat = [...h.timers.values()].at(-1); heartbeat();
  assert.equal(h.timers.size, 0); assert.equal(h.stats().closed, 1);
});

test('invalidation cancels pending screenshot preparation and rejects late permission completion', async () => {
  const h = await controller(); await h.open(); let resolve;
  h.prepare(() => new Promise(done => { resolve = done; }));
  h.actions.capture(); await h.flush(); delete h.runtime.id; h.pointer();
  resolve({ allowed: true }); await h.flush();
  h.dispatch({ type: 'ACCESS_FINISHED', granted: true, purpose: 'capture' });
  assert.equal(h.stats().captureStarts, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.stats().closed, 1);
});

test('temporary port connection errors keep retry available and do not retire the controller', async () => {
  const h = await controller(); h.faults.connect = Error('Could not establish connection. Receiving end does not exist.');
  await h.open(); assert.equal(h.task.state, 'error'); assert.equal(h.stats().closed, 0);
  delete h.faults.connect; h.actions.retry(); await h.flush();
  assert.equal(h.ports.length, 1); assert.equal(h.task.busy, true);
});

test('a non-string active element id does not prevent starting a translation or restoring focus', async () => {
  const h = await controller(); h.document.activeElement.id = { tagName: 'INPUT' };
  await h.open();
  assert.equal(h.ports.length, 1, 'translation failed before reaching its port');
  assert.equal(h.task.busy, true); assert.notEqual(h.task.state, 'error');
  h.actions.close(); assert.equal(h.stats().focused, 1);
});

test('selection event paths tolerate non-string ids and still exclude plugin nodes', async () => {
  const h = await controller(), namedWindow = { id: { tagName: 'INPUT' } };
  const mouseup = path => h.listeners.get('mouseup')({ button: 0, composedPath: () => path });
  assert.doesNotThrow(() => mouseup([{}, namedWindow])); await h.flush();
  assert.equal(h.selections.length, 1); assert.equal(h.selections[0].text, 'selected text');
  assert.doesNotThrow(() => mouseup([{}, namedWindow, { id: 'opentransai-root' }])); await h.flush();
  assert.equal(h.selections.length, 1, 'selecting plugin text must not create a page entry');
});


test('pinning keeps an active stream across page and iframe clicks; explicit close still cancels', async () => {
  const h = await controller(); await h.open(); h.pin(true); h.tick();
  const port = h.ports[0], requestId = port.payload.requestId;
  h.pointer(); h.dispatch({ type: 'DISMISS_PANEL', at: h.tick() });
  assert.equal(h.stats().closed, 0); assert.equal(port.closed, undefined);
  port.receive({ type: 'PROGRESS', requestId, data: { translation: 'still streaming' } });
  assert.equal(h.task.translation, 'still streaming');
  h.actions.close(); assert.equal(h.stats().closed, 1); assert.equal(port.closed, true);
});


test('Escape from an iframe closes a pinned top panel without accepting a stale event or interrupting capture', async () => {
  const top = await controller(), child = await controller({ child: true });
  const stale = child.tick(); await top.open(); top.pin(true);
  top.dispatch({ type: 'CLOSE_PANEL', at: stale - 20 }); assert.equal(top.stats().closed, 0);
  child.listeners.get('keydown')({ key: 'Escape' }); await child.flush();
  const close = child.messages.find(m => m.type === 'CLOSE_PANEL'); assert(close, 'iframe Esc was not forwarded');
  top.capture.active = true; top.dispatch(close); assert.equal(top.stats().closed, 0);
  top.capture.active = false; top.dispatch(close); assert.equal(top.stats().closed, 1);
  child.dispatch({ type: 'CAPTURE_VISIBILITY', active: true });
  child.messages.length = 0; child.listeners.get('keydown')({ key: 'Escape' }); await child.flush();
  assert.equal(child.messages.length, 0, 'iframe Escape interrupted screenshot selection');
});
