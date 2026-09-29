import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function harness() {
  let now = 0, next = 0, underPointer, hitTest, mutationCallback, drawingError, selectionCollapsed = true, suspended = false, styleReads = 0, observerCount = 0;
  const timers = new Map(), listeners = new Map(), sent = [], layers = [];
  const document = { documentElement: {}, addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(listener); }, elementFromPoint(x, y) { return hitTest ? hitTest(x, y) : underPointer; }, getSelection() { return { isCollapsed: selectionCollapsed }; }, createElement(tag) { if (tag === 'canvas') return { width: 0, height: 0, getContext() { return { drawImage() { if (drawingError) throw drawingError; } }; } }; return node(tag); } };
  function node(tag) { return { tagName: tag.toUpperCase(), dataset: {}, style: {}, children: [], listeners: {}, hidden: false, isConnected: true, append(...children) { this.children.push(...children); children.forEach(child => child.parentNode = this); }, replaceChildren(...children) { this.children = children; }, setAttribute(name, value) { this[name] = value; }, addEventListener(type, callback) { this.listeners[type] = callback; }, contains(other) { return this === other || this.children.some(child => child.contains?.(other)); }, closest(selector) { if (selector === 'img' && tag === 'img') return this; if (selector.includes('[role') && this.semantic) return this; return null; }, getBoundingClientRect() { return this.rect || { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; } }; }
  const A = { uid: () => `entry-${++next}`, el: (tag, cls, text) => Object.assign(node(tag), { className: cls, textContent: text }), button(text, action, handler) { const button = node('button'); button.dataset.action = action; button.textContent = text; button.listeners.click = handler; return button; }, async send(type, payload) { sent.push({ type, ...payload }); return type === 'STATUS' ? { enabled: true } : {}; }, viewport: () => ({ left: 0, top: 0, width: 800, height: 600 }), async canvasImage(canvas) { return { dataUrl: 'data:image/png;base64,eA==', width: canvas.width, height: canvas.height }; }, layer(id, css) { const layer = { host: node('div'), surface: node('div'), show() { this.host.hidden = false; }, hide() { this.host.hidden = true; }, move(x, y) { this.position = [x, y]; }, css }; layer.host.id = id; layer.host.hidden = true; layer.host.append(layer.surface); layers.push(layer); return layer; } };
  const context = { chrome: { runtime: { getURL: path => `chrome-extension://test/${path}` } }, MutationObserver: class { constructor(callback) { mutationCallback = callback; observerCount++; } observe() {} disconnect() {} }, OpenTransAIPage: A, document, window: { addEventListener: document.addEventListener.bind(document), matchMedia: () => ({ matches: false }), visualViewport: null }, WeakMap, WeakRef, Map, crypto: { randomUUID: () => `entry-${++next}` }, getComputedStyle: node => { styleReads++; return { display: 'block', visibility: 'visible', opacity: '1', overflow: 'visible', overflowX: 'visible', overflowY: 'visible', ...node.computed }; }, setTimeout(callback, ms) { const id = ++next; timers.set(id, { at: now + ms, callback }); return id; }, clearTimeout(id) { timers.delete(id); } };
  context.requestAnimationFrame = callback => context.setTimeout(callback, 16);
  context.cancelAnimationFrame = context.clearTimeout;
  context.chrome.runtime.id = 'test-extension';
  context.chrome.runtime.sendMessage = async ({ type, ...payload }) => ({ ok: true, data: await A.send(type, payload) });
  document.removeEventListener = (type, listener) => listeners.set(type, (listeners.get(type) || []).filter(fn => fn !== listener));
  context.window.removeEventListener = document.removeEventListener;
  delete context.OpenTransAIPage;
  vm.runInNewContext(await readFile(new URL('../extension/lib/page-shared.js', import.meta.url), 'utf8'), context);
  const { send: _send, ...widgets } = A;
  const shared = Object.assign(context.OpenTransAIPage, widgets);
  vm.runInNewContext(await readFile(new URL('../extension/lib/image-entry.js', import.meta.url), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; }), context);
  assert.equal(typeof shared.createEntries, 'function', 'entry controller must be installed on the page shared API');
  const errors = [], entries = shared.createEntries({ suspended: () => suspended, onError: error => errors.push(error) });
  const tick = async ms => { const until = now + ms; while (true) { const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]; if (!due) break; timers.delete(due[0]); now = due[1].at; due[1].callback(); for (let i = 0; i < 12; i++) await Promise.resolve(); } now = until; for (let i = 0; i < 12; i++) await Promise.resolve(); };
  const dispatch = (type, target, extra = {}) => { underPointer = target; for (const listener of listeners.get(type) || []) listener({ target, clientX: 150, clientY: 100, buttons: 0, ...extra }); };
  const img = (extra = {}) => Object.assign(node('img'), { complete: true, naturalWidth: 400, naturalHeight: 200, currentSrc: 'https://example.test/a.png', src: 'https://example.test/a.png', rect: { left: 100, right: 500, top: 80, bottom: 280, width: 400, height: 200 }, getAttribute(name) { return this[name] ?? null; }, ...extra });
  return { entries, A: shared, chrome: context.chrome, sent, errors, layers, img, dispatch, tick, metrics: () => ({ styleReads, observerCount }), setPointer(value) { underPointer = value; }, hitTest(value) { hitTest = value; }, mutate(records) { mutationCallback?.(records); }, suspend(value) { suspended = value; }, setSelection(collapsed) { selectionCollapsed = collapsed; }, failDrawing(error) { drawingError = error; } };
}

test('moving across images does not show an entry, observe DOM, inspect styles or request service work', async () => {
  const h = await harness(), image = h.img();
  for (let i = 0; i < 500; i++) h.dispatch('pointermove', image);
  await h.tick(1000); h.mutate([{ type: 'attributes', target: image, attributeName: 'style' }]); await h.tick(1000);
  assert.equal(h.entries.layer.host.hidden, true); assert.equal(h.sent.length, 0);
  assert.deepEqual(h.metrics(), { styleReads: 0, observerCount: 0 });
});

test('right click only remembers the image; choosing the native item explicitly opens one image task', async () => {
  const h = await harness(), image = h.img(); let intercepted = false;
  h.dispatch('contextmenu', image, { preventDefault() { intercepted = true; }, stopPropagation() { intercepted = true; } });
  assert.equal(intercepted, false); assert.equal(h.sent.length, 0); assert.equal(h.entries.layer.host.hidden, true);
  const source = await h.entries.context(image.currentSrc);
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].type, 'TASK_OPEN'); assert.equal(h.sent[0].sourceKind, 'image');
  assert.equal(source.anchor.left, 100); assert.equal(source.url, image.currentSrc);
  assert.equal((await h.entries.read(source.token, source.url)).image.width, 400);
});

test('small and transparent image elements are valid native-menu sources without visibility inspection', async () => {
  const h = await harness(), image = h.img({ computed: { opacity: '0' }, rect: { left: 10, right: 40, top: 20, bottom: 40, width: 30, height: 20 } });
  h.dispatch('contextmenu', image); const first = await h.entries.context(image.currentSrc);
  h.dispatch('contextmenu', image); const second = await h.entries.context(image.currentSrc);
  assert.equal(first.token, second.token); assert.equal(first.anchor.left, 10); assert.equal(h.metrics().styleReads, 0);
});

test('context-menu composed path preserves an image inside an open shadow tree', async () => {
  const h = await harness(), image = h.img(), host = h.img({ tagName: 'DIV', closest: () => null });
  h.dispatch('contextmenu', host, { composedPath: () => [image, host] });
  const source = await h.entries.context(image.currentSrc);
  assert.equal(source.anchor.left, 100); assert.equal((await h.entries.read(source.token, source.url)).image.width, 400);
});

test('browser-selected URL remains authoritative after node reuse, removal or a later unrelated right click', async () => {
  const h = await harness(), image = h.img(); const selected = image.currentSrc;
  h.dispatch('contextmenu', image); image.currentSrc = 'https://cdn.example/reused.png';
  const changed = await h.entries.context(selected); assert.equal(changed.anchor, null); assert.equal(changed.url, selected);
  assert.equal((await h.entries.read(changed.token, selected)).needsFetch, true);
  h.dispatch('contextmenu', image); image.isConnected = false;
  assert.equal((await h.entries.context(image.currentSrc)).anchor, null);
  image.isConnected = true; h.dispatch('contextmenu', image); h.dispatch('contextmenu', h.img({ tagName: 'DIV', closest: () => null }));
  assert.equal((await h.entries.context(image.currentSrc)).anchor, null);
});

test('pixel reads validate URL, loaded state, size and CORS before fallback', async () => {
  const h = await harness(), image = h.img(); h.dispatch('contextmenu', image); const source = await h.entries.context(image.currentSrc);
  assert.equal((await h.entries.read(source.token, 'https://example.test/wrong.png')).needsFetch, true);
  image.complete = false; assert.equal((await h.entries.read(source.token, source.url)).needsFetch, true); image.complete = true;
  h.failDrawing(Object.assign(Error('tainted'), { name: 'SecurityError' })); assert.equal((await h.entries.read(source.token, source.url)).needsFetch, true);
  image.naturalWidth = 8001; assert.equal((await h.entries.read(source.token, source.url)).code, 'LIMIT');
});

test('text selection keeps its icon button and only translates after click', async () => {
  const h = await harness(); await h.entries.selection({ text: 'hello', anchor: { left: 20, right: 60, top: 40, bottom: 70 } });
  assert.equal(h.entries.layer.host.hidden, false); assert.equal(h.sent.some(message => message.type === 'TASK_OPEN'), false);
  const button = h.entries.layer.surface.children.find(node => node.dataset.action === 'translate');
  assert.equal(button.children[0].src, 'chrome-extension://test/icons/ai-translate-light.svg');
  await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(h.sent.at(-1).sourceKind, 'text'); assert.equal(h.sent.at(-1).text, 'hello'); assert.equal(h.entries.layer.host.hidden, true);
});

test('late selection status cannot reopen a hidden entry and screenshot mode suppresses it', async () => {
  const h = await harness(); let resolve;
  h.A.send = () => new Promise(done => { resolve = done; });
  const pending = h.entries.selection({ text: 'hello', anchor: { right: 60, bottom: 70 } }); h.entries.hide(); resolve({ enabled: true }); await pending;
  assert.equal(h.entries.layer.host.hidden, true);
  h.suspend(true); await h.entries.selection({ text: 'hello', anchor: { right: 60, bottom: 70 } }); assert.equal(h.entries.layer.host.hidden, true);
});

test('text entry survives its own frame claim but yields to another frame and webpage scrolling', async () => {
  const h = await harness(), original = h.A.send;
  h.A.send = async (type, payload) => { if (type === 'ENTRY_CLAIM') h.entries.claim(payload.token); return original(type, payload); };
  await h.entries.selection({ text: 'hello', anchor: { right: 60, bottom: 70 } }); assert.equal(h.entries.layer.host.hidden, false);
  h.entries.claim('another-frame'); assert.equal(h.entries.layer.host.hidden, true);
  await h.entries.selection({ text: 'hello', anchor: { right: 60, bottom: 70 } }); h.dispatch('scroll', { id: 'opentransai-root' }); assert.equal(h.entries.layer.host.hidden, false);
  h.dispatch('scroll', {}); assert.equal(h.entries.layer.host.hidden, true);
});

test('page scroll and resize with a non-string target id still hide the text entry', async () => {
  const h = await harness(), snapshot = { text: 'hello', anchor: { right: 60, bottom: 70 } };
  // A Window named property or a form control can expose an element as `id`.
  for (const id of [{ tagName: 'INPUT' }, 1, { baseVal: 'page' }]) {
    for (const type of ['scroll', 'resize']) {
      await h.entries.selection(snapshot);
      assert.doesNotThrow(() => h.dispatch(type, { id }));
      assert.equal(h.entries.layer.host.hidden, true);
    }
  }
});

test('non-string ids in a composed path do not break page scroll or plugin scroll exclusion', async () => {
  const h = await harness(), snapshot = { text: 'hello', anchor: { right: 60, bottom: 70 } };
  const namedWindow = { id: { tagName: 'INPUT' } };
  await h.entries.selection(snapshot);
  assert.doesNotThrow(() => h.dispatch('scroll', {}, { composedPath: () => [{}, namedWindow] }));
  assert.equal(h.entries.layer.host.hidden, true);
  await h.entries.selection(snapshot);
  assert.doesNotThrow(() => h.dispatch('scroll', namedWindow, { composedPath: () => [namedWindow, { id: 'opentransai-root' }] }));
  assert.equal(h.entries.layer.host.hidden, false, 'plugin scrolling must preserve its entry');
});

test('context task errors propagate so the native-menu coordinator can report the actual failure', async () => {
  const h = await harness(); h.A.send = async () => { throw Object.assign(Error('服务暂时不可用'), { code: 'SERVICE' }); };
  await assert.rejects(h.entries.context('https://native.test/image.png'), { code: 'SERVICE' });
  assert.equal(h.errors.length, 0, 'the coordinator owns error presentation');
});

test('passive selection transport failure hides the entry without opening a translation/error panel', async () => {
  const h = await harness();
  h.chrome.runtime.sendMessage = async () => { throw Error('Could not establish connection.'); };
  await h.entries.selection({ text: 'hello', anchor: { right: 60, bottom: 70 } });
  assert.equal(h.entries.layer.host.hidden, true); assert.equal(h.errors.length, 0); assert.equal(h.A.alive(), true);
});

test('selection after extension reload silently retires its entry and ignores future mouse events', async () => {
  const h = await harness(), snapshot = { text: 'hello', anchor: { right: 60, bottom: 70 } };
  await h.entries.selection(snapshot); assert.equal(h.entries.layer.host.hidden, false);
  const before = h.sent.length; delete h.chrome.runtime;
  await h.entries.selection(snapshot);
  assert.equal(h.entries.layer.host.hidden, true); assert.equal(h.errors.length, 0);
  h.dispatch('contextmenu', h.img()); await h.entries.context('https://example.test/a.png'); await h.entries.selection(snapshot);
  assert.equal(h.sent.length, before); assert.equal(h.errors.length, 0);
});

test('late entry claim cannot revive the button after runtime invalidation', async () => {
  const h = await harness(); let resolve;
  const send = h.chrome.runtime.sendMessage;
  h.chrome.runtime.sendMessage = message => message.type === 'ENTRY_CLAIM' ? new Promise(done => { resolve = done; }) : send(message);
  const pending = h.entries.selection({ text: 'hello', anchor: { right: 60, bottom: 70 } });
  await h.tick(0); delete h.chrome.runtime.id;
  resolve({ ok: true, data: {} }); await pending;
  assert.equal(h.entries.layer.host.hidden, true); assert.equal(h.errors.length, 0);
});
