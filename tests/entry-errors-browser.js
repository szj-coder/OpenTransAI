import { createService } from '/extension/lib/service.js';
import { showEntryDialog } from '/extension/lib/entry-dialog.js';
const roots = [], listeners = [], values = { settings: { enabled: true } };
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); roots.push(root); return root; };
const tab = { id: 7, windowId: 1, active: true, url: location.href };
const info = { menuItemId: 'image-translation', srcUrl: 'https://example.test/private.png?token=PRIVATE', frameId: 2 };
let mode = 'missing', injected = 0, external = 0, requests = 0;
const missing = () => { throw Error('Could not establish connection. Receiving end does not exist.'); };
async function deliver(message) {
  for (const fn of listeners) {
    let resolve, replied = false;
    const promise = new Promise(done => { resolve = done; });
    const async = fn(message, {}, value => { replied = true; resolve(value); });
    if (async || replied) return promise;
  }
}
const api = {
  runtime: { id: 'fixture', getURL: path => location.origin + '/extension/' + path, onMessage: { addListener(fn) { listeners.push(fn); }, removeListener() {} }, sendMessage: async message => ({ ok: true, data: await service.handle(message, { id: 'fixture', tab, frameId: 0, url: location.href }) }) },
  storage: { local: { setAccessLevel: async () => {}, get: async () => structuredClone(values), set: async next => Object.assign(values, structuredClone(next)) } },
  tabs: { get: async () => tab, sendMessage: async (_id, message) => mode === 'live' ? deliver(message) : missing(), create: async () => { external++; } },
  windows: { create: async () => { external++; } },
  scripting: { executeScript: async options => { injected++; return [{ frameId: 0, result: options.func(...options.args) }]; } },
};
Object.defineProperty(window, 'chrome', { configurable: true, value: api });
const service = createService(api, { fetchImpl: async () => { requests++; throw Error('Unexpected model request'); } });
const manifest = await (await fetch('/extension/manifest.json')).json();
for (const file of manifest.content_scripts[0].js) await import('/extension/' + file);
const top = () => roots.find(root => root.host.id === 'opentransai-root');
const fallback = () => document.getElementById('opentransai-entry-error')?.shadowRoot;
const cleanup = () => { globalThis.__openTransAIEntryDialogClose?.(); top().querySelector('.close').click(); document.querySelector('iframe')?.remove(); };
const showMissing = async () => { cleanup(); mode = 'missing'; values.settings.enabled = true; await service.contextClicked(info, tab); };
const showLive = async () => { cleanup(); mode = 'live'; values.settings.enabled = false; await service.contextClicked(info, tab); };
const showToolbar = () => { cleanup(); const frame = document.createElement('iframe'); frame.title = '工具栏异常弹窗预览'; frame.src = '/preview/popup.html?entryError=7'; document.querySelector('main').append(frame); };
document.getElementById('show-missing').onclick = showMissing;
document.getElementById('show-live').onclick = showLive;
document.getElementById('show-toolbar').onclick = showToolbar;
const problems = [];
window.addEventListener('error', event => { problems.push(event.message); document.getElementById('health').textContent = problems.join('\n'); });
window.addEventListener('unhandledrejection', event => { problems.push(String(event.reason)); document.getElementById('health').textContent = problems.join('\n'); });
document.getElementById('run-tests').onclick = async () => {
  const results = [], output = document.getElementById('results');
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const check = async (name, fn) => { try { await fn(); results.push('PASS ' + name); } catch (error) { results.push('FAIL ' + name + ': ' + error.message); } output.textContent = results.join('\n'); };
  await check('失联时在原网页显示错误，不开独立窗口、不请求模型', async () => {
    await showMissing(); assert(fallback().querySelector('.error').textContent.includes('未连接'), '原因缺失'); assert(external === 0 && requests === 0, '出现窗口或网络副作用');
    const logs = await service.handle({ type: 'DIAGNOSTICS_GET' }, { id: 'fixture', url: api.runtime.getURL('diagnostics.html') });
    assert(fallback().querySelector('pre').textContent.includes(logs.entries[0].requestId), '日志无法关联'); assert(!JSON.stringify(logs).includes('PRIVATE'), '记录了私密内容');
  });
  await check('诊断展开和复制失败后手动选择', async () => {
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('denied'); } } });
    try { fallback().querySelector('.actions button').click(); await new Promise(resolve => setTimeout(resolve, 20)); assert(fallback().querySelector('details').open, '详情未展开'); assert(fallback().querySelector('.notice').textContent.includes('Ctrl/Cmd'), '没有手动复制提示'); }
    finally { if (original) Object.defineProperty(navigator, 'clipboard', original); else delete navigator.clipboard; }
  });
  await check('重复异常只保留一个浮窗，Esc 关闭并移除', async () => {
    await showMissing(); await service.contextClicked(info, tab); assert(document.querySelectorAll('#opentransai-entry-error').length === 1, '重复浮窗');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert(!fallback(), 'Esc 未关闭');
  });
  await check('页面地址变化后不挂载过期异常', async () => { assert(showEntryDialog({}, 'https://different.example/') === false && !fallback(), '污染新页面'); });
  await check('页面脚本正常时复用原翻译浮窗，隐藏无效翻译操作', async () => {
    const before = injected; await showLive(); const root = top();
    assert(injected === before && !root.host.hidden, '没有复用浮窗'); assert(root.querySelector('.error').textContent.includes('关闭'), '原因错误');
    assert(root.querySelector('.lang').hidden && root.querySelector('.retry').hidden && root.querySelector('.copy').hidden, '显示了无效操作');
    assert(root.querySelector('.entry-details pre').textContent.includes('DISABLED'), '诊断缺失'); root.querySelector('.close').click(); assert(root.host.hidden, '关闭无效');
  });
  await check('当前视口内完整显示失联错误浮窗', async () => {
    await showMissing(); const panel = fallback().querySelector('.panel'), r = panel.getBoundingClientRect();
    assert(r.left >= 11 && r.top >= 11 && r.right <= document.documentElement.clientWidth - 11 && r.bottom <= innerHeight - 11, '浮窗越界或安全边距不足'); assert(panel.scrollWidth <= panel.clientWidth + 1, '内容横向溢出');
  });
  output.textContent += `\n${results.filter(result => result.startsWith('PASS')).length}/${results.length} 通过；运行错误 ${problems.length}`;
};
