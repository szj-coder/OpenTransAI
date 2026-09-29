const mode = new URL(location.href).searchParams.get('mode') || 'active-capture';
const errors = [], roots = [], messages = [], ports = [], intervals = new Set();
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(options) { const shadow = attach.call(this, options); roots.push(shadow); return shadow; };
const nativeInterval = window.setInterval, nativeClear = window.clearInterval;
window.setInterval = (...args) => { const id = nativeInterval(...args); intervals.add(id); return id; };
window.clearInterval = id => { intervals.delete(id); nativeClear(id); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw Error(message); };
let receive;
const invalid = () => Error('Extension context invalidated.');
const api = { runtime: {
  id: 'lifecycle-fixture',
  getURL: path => { if (mode === 'getURL-throws') throw invalid(); return '/extension/' + path; },
  onMessage: { addListener(fn) { receive = fn; }, removeListener() {} },
  async sendMessage(message) {
    messages.push(message);
    if (mode === 'selection-rejects') throw invalid();
    if (message.type === 'STATUS') return { ok: true, data: { enabled: true, configured: true, defaultLanguage: 'zh-CN', configRevision: 'fixture' } };
    if (message.type === 'PREPARE_CAPTURE') return { ok: true, data: { allowed: true } };
    if (message.type === 'TASK_OPEN') queueMicrotask(() => receive({ type: 'OPEN_SOURCE', source: { kind: 'text', id: 'fixture-text', text: message.text }, anchor: message.anchor }, {}, () => {}));
    return { ok: true, data: {} };
  },
  connect() {
    const port = {
      onMessage: { addListener(fn) { port.receive = fn; } }, onDisconnect: { addListener(fn) { port.disconnected = fn; } },
      postMessage(message) { port.message = message; },
      disconnect() { port.closed = true; if (!api.runtime?.id) throw invalid(); },
    };
    ports.push(port); return port;
  },
} };
if (mode === 'missing-runtime') delete api.runtime;
Object.defineProperty(window, 'chrome', { value: api, configurable: true });
const manifest = await (await fetch('/extension/manifest.json')).json();
for (const path of manifest.content_scripts[0].js) await import('/extension/' + path);
const root = id => roots.find(shadow => shadow.host.id === id);
const select = () => {
  const sample = document.getElementById('sample'), range = document.createRange(); range.selectNodeContents(sample);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  sample.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, clientX: 30, clientY: 100 }));
};
document.getElementById('run').onclick = async () => {
  document.getElementById('run').disabled = true;
  const output = document.getElementById('results');
  try {
    select(); await delay(30);
    if (mode === 'active-capture' || mode === 'visible-entry') {
      assert(root('opentransai-entry')?.host.hidden === false, '正常划词按钮未显示');
      assert(!root('opentransai-root')?.host.isConnected, '仅划词就弹出浮窗');
      if (mode === 'active-capture') {
        root('opentransai-entry').querySelector('button').click(); await delay(30);
        assert(root('opentransai-root').host.hidden === false && ports.length === 1, '翻译任务没有启动');
        receive({ type: 'BEGIN_CAPTURE' }, {}, () => {}); await delay(30);
        assert(root('opentransai-capture').host.hidden === false, '框选没有启动');
      }
      delete api.runtime;
      // Mouseup detects reload even while capture mode would otherwise ignore selection.
      select(); await delay(30);
    }
    const before = messages.length;
    for (let i = 0; i < 10; i++) {
      select(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    }
    for (const port of ports) {
      port.receive({ type: 'DONE', requestId: port.message.requestId, data: { translation: '迟到响应', outcome: 'translated' } });
      port.disconnected();
    }
    receive?.({ type: 'OPEN_SOURCE', source: { kind: 'text', id: 'late', text: 'late' } }, {}, () => {});
    await delay(50);
    assert(errors.length === 0, `未捕获异常：${errors.join('; ')}`);
    assert(!OpenTransAIPage.alive(), '旧上下文未停止');
    assert(roots.every(shadow => !shadow.host.isConnected), '遗留插件浮层');
    assert(intervals.size === 0, '遗留活动或心跳定时器');
    assert(ports.every(port => port.closed), '翻译端口未关闭');
    assert(messages.length === before, '失效后仍发送新消息');
    output.textContent = `PASS ${mode}\n无未捕获异常、无插件浮层、无定时器；后续事件和迟到响应均不重启任务。`;
  } catch (error) { output.textContent = `FAIL ${mode}: ${error.message}`; }
  output.dataset.complete = 'true';
};
