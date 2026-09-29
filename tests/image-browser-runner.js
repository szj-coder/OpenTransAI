import { createService } from '/extension/lib/service.js';
import { DEFAULT_SETTINGS } from '/extension/lib/core.js';
const formattedSource = '# Product guide\n\nRead the **important** notes.\n\n## Steps\n\n3. Open the box\n7. Check all items\n\n| Item | Count | Note |\n| --- | ---: | --- |\n| A | 0 | |\n| B | 12 | Ready |\n\n```js\n  const total = 12;\n```\n\n<img src=x onerror=alert(1)> [link](https://example.test)';
const formattedResult = '# 产品说明\n\n请阅读**重要**说明。\n\n## 操作步骤\n\n3. 打开包装\n7. 检查物品\n\n| 物品 | 数量 | 备注 |\n| --- | ---: | --- |\n| A | 0 | |\n| B | 12 | 就绪 |\n\n```js\n  const total = 12;\n```\n\n<img src=x onerror=alert(1)> [link](https://example.test)';
const literalResult = '他说 "你好"。\n\n路径：C:\\temp\\file\n\n```json\n{"example":"原样保留"}\n```';
const roots = [], attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); roots.push(root); return root; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const listeners = [];
const state = { configured: true, enabled: true, scenario: 'normal', latency: 30, requests: [], permission: true, copies: [], cancelled: 0, pixelVersion: 0, captures: 0, captureHidden: false, imageFetches: 0 };
const sender = { id: 'browser-fixture', tab: { id: 1, windowId: 1 }, frameId: 0, documentId: 'doc1', url: location.href };
const event = () => { const handlers = []; return { addListener(fn) { handlers.push(fn); }, fire(x) { for (const fn of handlers) fn(x); } }; };
async function deliver(message, frameId = 0) {
  for (const record of listeners.filter(item => item.frameId === frameId)) {
    const listener = record.fn;
    let replied = false, value;
    const response = new Promise(resolve => { value = x => { replied = true; resolve(x); }; });
    const pending = listener(message, {}, value);
    if (pending === true || replied) return response;
  }
  return {};
}
const api = {
  runtime: { id: sender.id, getURL: path => '/extension/' + path, onMessage: { addListener(fn) { listeners.push({ fn, frameId: 0 }); } } },
  storage: { local: { setAccessLevel: async () => {}, get: async () => ({ settings: { ...DEFAULT_SETTINGS, apiKey: state.configured ? 'fixture-key' : '', enabled: state.enabled } }), set: async () => {} } },
  permissions: { contains: async () => state.permission },
  tabs: { sendMessage: async (_tab, message, options) => options ? deliver(message, options.frameId ?? (options.documentId === 'iframe-doc' ? 2 : 0)) : (await Promise.all([deliver(message), deliver(message, 2)]))[0], get: async () => ({ ...sender.tab, active: true, url: location.href }), query: async () => [{ ...sender.tab, active: true }] },
  windows: { create: async () => ({ id: 3 }) },
};
const service = createService(api, { fetchImpl: async (_url, options) => {
  if (options.method !== 'POST') { state.imageFetches++; return fetch('/extension/icons/icon-128.png'); }
  const body = JSON.parse(options.body); state.requests.push(body);
  const isOCR = Array.isArray(body.messages?.[1]?.content);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, state.latency);
    options.signal.addEventListener('abort', () => { clearTimeout(timer); state.cancelled++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  if (state.scenario === 'auth') return new Response('{}', { status: 401 });
  if (isOCR) {
    const result = state.scenario === 'format' ? { text: formattedSource, sourceLanguage: 'en', warnings: [] } : state.scenario === 'format-same' ? { text: '# 已经是中文\n\n- 第一项', sourceLanguage: 'zh-CN', warnings: [] } : state.scenario === 'empty' ? { text: '', sourceLanguage: 'und', warnings: [] }
      : { text: state.scenario === 'same' ? '你好世界' : state.scenario === 'long' ? 'Original line.\n'.repeat(300) : 'Stay curious. Keep exploring.', sourceLanguage: state.scenario === 'same' ? 'zh' : 'en', warnings: [] };
    const json = JSON.stringify(state.scenario === 'fenced-invalid' ? { text: 123, sourceLanguage: 'en', warnings: [] } : result);
    const content = state.scenario.startsWith('fenced') ? `\`\`\`json\n${json}\n\`\`\`` : json;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content } }] }));
  }
  if (state.scenario === 'translate-error') return new Response('{}', { status: 500 });
  const prompt = body.messages[0].content;
  const target = /translate (?:the text )?(?:to|into) (ja|fr|en|zh-CN)(?=[\s(.;]|$)/i.exec(prompt)?.[1] || 'zh-CN';
  const translation = state.scenario === 'same' ? 'Hello world' : state.scenario === 'format-same' ? '# Already Chinese\n\n- First item' : state.scenario === 'literal' ? literalResult : state.scenario === 'format' ? formattedResult : state.scenario === 'long' ? '译文段落，保持阅读位置。\n'.repeat(400) : '保持好奇，继续探索。';
  const plain = prompt.includes('Return ONLY the translated text');
  const result = plain ? translation : JSON.stringify({ sourceLanguage: 'en', targetLanguage: target, translation });
  const prefix = result.slice(0, Math.min(result.length - 1, plain ? (state.scenario === 'long' ? 1800 : 5) : result.indexOf('translation') + 20));
  const stream = new ReadableStream({ start(controller) {
    const wire = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
    controller.enqueue(new TextEncoder().encode(wire(prefix)));
    setTimeout(() => {
      try {
        if (state.scenario === 'broken') { controller.error(new Error('fixture interrupted')); return; }
        controller.enqueue(new TextEncoder().encode(wire(result.slice(prefix.length)) + 'data: [DONE]\n\n')); controller.close();
      } catch { /* cancelled reader */ }
    }, state.latency);
  } });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
} });
const drawImage = CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage = function(image, ...args) { drawImage.call(this, image, ...args); if (image.id === 'large' && state.pixelVersion) { this.fillStyle = 'red'; this.fillRect(0,0,10,10); } };
api.tabs.captureVisibleTab = async () => {
  state.captures++; state.captureHidden = roots.every(r => r.host.hidden);
  const canvas = document.createElement('canvas'); canvas.width = innerWidth * 2; canvas.height = innerHeight * 2;
  canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height); return canvas.toDataURL();
};
api.runtime.sendMessage = async message => {
  try { return { ok: true, data: await service.handle(message, sender) }; }
  catch (error) { return { ok: false, error: error.message, code: error.code }; }
};
api.runtime.connect = () => {
  const client = { name: 'translation', onMessage: event(), onDisconnect: event() };
  const server = { name: 'translation', sender, onMessage: event(), onDisconnect: event() };
  let disconnected = false;
  client.postMessage = value => server.onMessage.fire(value);
  server.postMessage = value => { if (!disconnected) client.onMessage.fire(value); };
  client.disconnect = server.disconnect = () => { if (!disconnected) { disconnected = true; server.onDisconnect.fire(); client.onDisconnect.fire(); } };
  service.connect(server); return client;
};
window.imageFixtureFrame = { roots, api(frameId) { return { ...api, runtime: { ...api.runtime, onMessage: { addListener(fn) { listeners.push({ fn, frameId }); } }, sendMessage: async message => { try { return { ok: true, data: await service.handle(message, { ...sender, frameId, documentId: 'iframe-doc' }) }; } catch (error) { return { ok: false, error: error.message, code: error.code }; } } } }; } };
Object.defineProperty(window, 'chrome', { value: api, configurable: true });
const samples = document.getElementById('samples');
function makeImage(id, width, height, text) {
  const canvas = document.createElement('canvas'); canvas.width = 500; canvas.height = 200;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e4ecf8'; ctx.fillRect(0, 0, 500, 200); ctx.fillStyle = '#213c62'; ctx.font = '28px sans-serif'; ctx.fillText(text, 20, 100);
  const img = new Image(); img.id = id; img.width = width; img.height = height; img.src = canvas.toDataURL(); img.alt = text; samples.append(img); return img;
}
makeImage('small',119,80,'Small picture'); makeImage('short',160,59,'Short picture'); makeImage('boundary',120,60,'Stay curious'); makeImage('large',320,160,'Stay curious. Keep exploring.');
await Promise.all([...samples.querySelectorAll('img')].map(img => img.decode()));
// Loaded dynamically to exercise the exact production script order.
const manifest = await (await fetch('/extension/manifest.json')).json();
for (const script of manifest.content_scripts[0].js) await import('/extension/' + script);
const root = () => roots.find(r => r.host.id === 'opentransai-root');
const entry = () => roots.find(r => r.host.id === 'opentransai-entry');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const close = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
function hover(id) {
  const img = document.getElementById(id), r = img.getBoundingClientRect();
  img.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  img.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  return img;
}
async function until(fn, message = '等待状态超时') { const deadline = Date.now() + 4000; while (!fn()) { if (Date.now() > deadline) throw Error(message); await delay(20); } }
const settled = () => until(() => root()?.querySelector('.panel').getAttribute('aria-busy') === 'false');
async function chooseImage(img, { target = img, frameId = 0 } = {}) {
  const view = target.ownerDocument.defaultView;
  target.dispatchEvent(new view.MouseEvent('contextmenu', { bubbles: true, composed: true, cancelable: true }));
  await service.contextClicked({ menuItemId: 'image-translation', srcUrl: img.currentSrc || img.src, frameId }, { ...sender.tab, url: location.href });
}
const startImage = (id = 'large') => chooseImage(document.getElementById(id));
async function openImage(id = 'large') { await startImage(id); await delay(20); await settled(); }
document.getElementById('show-image').onclick = () => { state.scenario = 'normal'; return openImage(); };
document.getElementById('show-same-language').onclick = () => { close(); state.scenario = 'same'; return openImage(); };
document.getElementById('show-formatted').onclick = async () => { close(); state.scenario = 'format'; await openImage(); root().querySelector('.content').scrollTop = 0; };
document.getElementById('run-tests').onclick = async () => {
  const results = [], output = document.getElementById('results');
  const check = async (name, fn) => { close(); state.scenario = 'normal'; state.latency = 30; state.configured = true; state.pixelVersion = 0; window.scrollTo(0,0); await delay(150); try { await fn(); results.push(`PASS ${name}`); } catch (e) { results.push(`FAIL ${name}: ${e.message}`); } output.textContent = results.join('\n'); };
  await check('Window 命名属性与表单控件遮蔽 id 时，划词、滚动和焦点恢复正常', async () => {
    const named = document.createElement('div'), form = document.createElement('form'), input = document.createElement('input');
    named.id = 'id'; form.tabIndex = 0; input.name = 'id'; form.append(input); document.body.append(named, form);
    const errors = [], onError = event => errors.push(event.message); window.addEventListener('error', onError);
    const select = async () => {
      const selected = document.getElementById('selection'), range = document.createRange(); range.selectNodeContents(selected);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      selected.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, composed: true, clientX: 160, clientY: 120 }));
      await until(() => entry()?.host.hidden === false);
    };
    try {
      assert(window.id === named && form.id === input, '未建立真实 DOM 命名属性场景');
      await select(); window.dispatchEvent(new Event('resize')); assert(entry().host.hidden, '窗口 resize 未隐藏入口');
      await select(); document.dispatchEvent(new Event('scroll')); assert(entry().host.hidden, '滚动路径包含 Window 时未隐藏入口');
      await select(); entry().querySelector('button').dispatchEvent(new Event('scroll', { bubbles: true, composed: true }));
      assert(!entry().host.hidden, '插件内部滚动错误地隐藏入口');
      form.focus(); assert(document.activeElement === form, '焦点没有进入表单');
      entry().querySelector('button').click(); await delay(20); await settled();
      assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), '表单 id 被遮蔽时翻译失败');
      close(); assert(document.activeElement === form, '关闭没有恢复表单焦点');
      assert(errors.length === 0, errors.join('; '));
    } finally { window.removeEventListener('error', onError); named.remove(); form.remove(); getSelection().removeAllRanges(); }
  });
  await check('Window.id 为元素时，框选仍检测视口变化并拒绝过期选区', async () => {
    const named = document.createElement('div'); named.id = 'id'; document.body.append(named);
    const errors = [], onError = event => errors.push(event.message); window.addEventListener('error', onError);
    try {
      assert(window.id === named, 'Window.id 没有解析为页面元素');
      await openImage(); await deliver({ type: 'BEGIN_CAPTURE' });
      const cr = roots.find(r => r.host.id === 'opentransai-capture'); await until(() => !cr.host.hidden);
      const shade = cr.querySelector('.shade'); shade.setPointerCapture = shade.releasePointerCapture = () => {};
      for (const [type, x, y] of [['pointerdown',50,60],['pointermove',150,140],['pointerup',150,140]]) shade.dispatchEvent(new PointerEvent(type, { clientX:x, clientY:y, pointerId:3, button:0, bubbles:true, composed:true }));
      const before = state.captures; window.dispatchEvent(new Event('resize'));
      cr.querySelector('[data-action="capture-confirm"]').click(); await delay(30);
      assert(state.captures === before && cr.querySelector('.capture-error').textContent.includes('重新选择'), '视口变化后仍提交旧选区');
      assert(errors.length === 0, errors.join('; '));
      close(); assert(!root().host.hidden, '取消框选未恢复原任务');
    } finally { window.removeEventListener('error', onError); named.remove(); }
  });
  await check('A01/A02/A25 任意大小图片悬停均不出现图片按钮', async () => { const n = state.requests.length; for (const id of ['small', 'short', 'boundary', 'large']) { hover(id); await delay(360); assert(!entry() || entry().host.hidden, '出现了图片悬停入口'); } assert(state.requests.length === n, '悬停调用AI'); });
  await check('A03/A04/A05 打开与取消原生菜单不读取图片', async () => { const n = state.requests.length, reads = state.imageFetches; document.getElementById('large').dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, cancelable:true })); await delay(100); assert(state.requests.length === n && state.imageFetches === reads, '仅打开菜单就处理图片'); assert(!root() || root().host.hidden, '仅右键就打开浮窗'); });
  await check('图片真实两阶段流程与原文折叠', async () => { const n = state.requests.length; await openImage(); assert(state.requests.length - n === 2, '没有先OCR后翻译'); assert(root().textContent.includes('保持好奇'), '未显示译文'); assert(!root().querySelector('details').open, '原文未折叠'); assert(root().textContent.includes('29 字'), '原文字数错误'); });
  await check('识别 JSON 外层代码围栏正常进入翻译，切换语言复用原文', async () => {
    state.scenario = 'fenced'; const n = state.requests.length; await openImage();
    assert(state.requests.length === n + 2, '完整围栏阻断识别或引起额外请求');
    assert(root().querySelector('[data-result]').textContent === '保持好奇，继续探索。', '围栏结果未进入翻译');
    assert(root().querySelector('.original-text').textContent === 'Stay curious. Keep exploring.', '原文包含外层围栏或被修改');
    assert(root().querySelector('.error').hidden, '成功识别仍显示错误');
    const select = root().querySelector('select'); select.value = 'ja'; select.dispatchEvent(new Event('change')); await delay(20); await settled();
    assert(state.requests.length === n + 3 && !Array.isArray(state.requests.at(-1).messages[1].content), '切换语言重复识别图片');
  });
  await check('围栏内字段错误仍拒绝，重试成功后才显示原文与译文', async () => {
    state.scenario = 'fenced-invalid'; const n = state.requests.length; await openImage();
    assert(state.requests.length === n + 1, '无效字段进入了翻译请求');
    assert(root().querySelector('.error').textContent.includes('格式不完整'), '字段错误没有保留');
    assert(root().querySelector('.original').hidden && root().querySelector('[data-result]').textContent === '', '无效识别被发布');
    state.scenario = 'fenced'; root().querySelector('[data-action="retry"]').click(); await delay(20); await settled();
    assert(state.requests.length === n + 3 && root().querySelector('[data-result]').textContent.includes('保持好奇'), '失败重试未恢复识别和翻译');
  });
  await check('图片原文与译文按标题、列表、表格和代码排版，复制不带标记', async () => {
    state.scenario = 'format'; await openImage(); const result = root().querySelector('[data-result]');
    assert(result.querySelector('h2')?.textContent === '产品说明' && result.querySelector('h3')?.textContent === '操作步骤', '标题层级丢失');
    assert(result.querySelectorAll('li')[0].value === 3 && result.querySelectorAll('li')[1].value === 7, '列表被重新编号');
    assert(result.querySelectorAll('tbody tr').length === 2 && result.querySelectorAll('tbody td')[1].textContent === '0', '表格数值或行丢失');
    assert(result.querySelectorAll('tbody td')[2].textContent === '', '空单元格被补齐');
    assert(result.querySelector('pre code').textContent.startsWith('  const'), '代码缩进丢失');
    assert(!result.querySelector('img,a,script') && result.textContent.includes('<img src=x'), '不安全内容被执行或隐藏');
    root().querySelector('summary').click(); assert(root().querySelector('.original-text h2')?.textContent === 'Product guide', '原文未整理');
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard'); let copied;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
    try { root().querySelector('[data-action="copy"]').click(); await delay(10); assert(copied.includes('物品\t数量\t备注\nA\t0\t') && copied.includes('3. 打开包装'), '复制丢失行列或编号'); assert(!copied.includes('```') && !copied.includes('**') && !copied.startsWith('#'), '复制包含排版标记'); }
    finally { if (original) Object.defineProperty(navigator, 'clipboard', original); else delete navigator.clipboard; }
  });
  await check('图片译文直接显示引号、反斜杠和 JSON 代码，不作为返回协议解析', async () => {
    state.scenario = 'literal'; const n = state.requests.length; await openImage();
    const result = root().querySelector('[data-result]');
    assert(state.requests.length === n + 2, '额外调用模型修复 JSON');
    assert(root().querySelector('.error').hidden, '纯正文误报格式错误');
    assert(result.querySelector('p')?.textContent === '他说 "你好"。', '引号丢失');
    assert(result.textContent.includes('C:\\temp\\file'), '反斜杠被当作转义解析');
    assert(result.querySelector('pre code')?.textContent === '{"example":"原样保留"}', '正文 JSON 示例丢失');
  });
  await check('结构化流式更新保留已读节点与文本选区', async () => {
    const host = document.createElement('div'); document.body.append(host);
    try { const render = OpenTransAIPage.createImageRenderer(host); render('# Title\n\nStable paragraph.\n\nGrowing'); const paragraph = host.querySelector('p'), text = paragraph.firstChild; const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 6); getSelection().removeAllRanges(); getSelection().addRange(range); render('# Title\n\nStable paragraph.\n\nGrowing content.'); assert(host.querySelector('p') === paragraph && paragraph.firstChild === text && getSelection().toString() === 'Stable', '流式更新重建了已读节点或选区'); getSelection().removeAllRanges(); const table = '| A | B |\n| --- | --- |\n| 1 | 2 |'; render(table); const cell = host.querySelector('td'); render(table + '\n| 3'); assert(host.querySelector('td') === cell && cell.textContent === '1', '未完成行重建了已有表格'); render(table + '\n| 3 | 4 |'); assert(host.querySelector('td') === cell && host.querySelectorAll('td').length === 4, '表格分片丢失单元格'); }
    finally { getSelection().removeAllRanges(); host.remove(); }
  });
  await check('自动转英语及手动同语言均保留图片排版，划词不解析图片排版标记', async () => {
    state.scenario = 'format-same'; const n = state.requests.length; await openImage();
    assert(state.requests.length === n + 2 && root().querySelector('[data-result] h2')?.textContent === 'Already Chinese', '自动英语译文未排版');
    const select = root().querySelector('select'); select.value = 'zh-CN'; select.dispatchEvent(new Event('change')); await delay(20); await settled();
    assert(state.requests.length === n + 2 && root().querySelector('[data-result] h2')?.textContent === '已经是中文', '手动同语言结果未排版或重复翻译');
    state.scenario = 'format'; await deliver({ type: 'OPEN_SOURCE', source: { kind: 'text', id: 'literal-markup', text: 'Hello' } }); await delay(20); await settled(); const result = root().querySelector('[data-result]'); assert(!result.querySelector('h2,table'), '划词意外解析排版标记'); assert(result.textContent.startsWith('# 产品说明'), `划词原样内容缺失：${root().querySelector('.error').textContent}`);
  });
  await check('A13 移出保留、点击网页关闭且不阻止页面事件', async () => { await openImage(); document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); assert(!root().host.hidden, '移出关闭了浮窗'); let reached = false; const reachedPage = () => { reached = true; }; document.body.addEventListener('pointerdown', reachedPage, { once: true }); const allowed = document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, cancelable: true })); assert(root().host.hidden, '点击网页未关闭浮窗'); assert(allowed && reached, '关闭阻止了页面事件'); });
  await check('浮窗内部正文与操作不误关闭', async () => { await openImage(); for (const selector of ['.content', 'summary', 'select', '[data-action="expand"]', '[data-action="copy"]']) { root().querySelector(selector).dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true })); assert(!root().host.hidden, `内部 ${selector} 关闭了浮窗`); } root().querySelector('summary').click(); root().querySelector('[data-action="expand"]').click(); assert(root().querySelector('details').open && root().querySelector('.panel').classList.contains('expanded'), '内部操作失效'); });
  await check('外部关闭不恢复旧焦点，显式关闭恢复原焦点', async () => { const input = document.getElementById('editable'); input.focus(); await openImage(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); assert(document.activeElement !== input, '外部点击恢复了旧输入框焦点'); input.focus(); await openImage(); root().querySelector('[data-action="close"]').click(); assert(document.activeElement === input, '显式关闭未恢复焦点'); });
  await check('A07/A08 重复选择同图只有一个任务，悬停另一图保留结果', async () => { state.latency = 200; const n = state.requests.length; await startImage(); await delay(40); await startImage(); await settled(); assert(state.requests.length - n === 2, `同图请求数 ${state.requests.length - n}`); hover('boundary'); await delay(360); assert(root().textContent.includes('保持好奇'), '悬停替换了结果'); });
  await check('A11 配置缺失不发请求', async () => { state.configured = false; const n = state.requests.length; await openImage(); assert(state.requests.length === n, '缺配置仍请求'); assert(root().textContent.includes('请先配置'), '无配置提示'); });
  await check('A12 无文字不生成译文', async () => { state.scenario = 'empty'; const n = state.requests.length; await openImage(); assert(state.requests.length - n === 1, '无文字仍翻译'); assert(root().textContent.includes('未识别到'), '缺空结果状态'); });
  await check('A27 默认中文的中文图片自动转英语并复用结果', async () => {
    state.scenario = 'same'; const n = state.requests.length; await openImage();
    assert(state.requests.length === n + 2, '没有完成识别和英语翻译');
    assert(root().querySelector('select').value === 'en' && root().querySelector('[data-result]').lang === 'en', '目标语言未显示英语');
    assert(root().querySelector('[data-result]').textContent === 'Hello world' && root().querySelector('.error').hidden, '只有提示没有英语译文');
    await openImage(); assert(state.requests.length === n + 2, '自动英语结果未复用');
  });
  await check('A27 手动选择中文保留原文，重新打开同图恢复自动英语', async () => {
    state.scenario = 'same'; await openImage(); const n = state.requests.length;
    const select = root().querySelector('select'); select.value = 'zh-CN'; select.dispatchEvent(new Event('change')); await delay(20); await settled();
    assert(state.requests.length === n && root().textContent.includes('已是目标语言'), '手动同语言触发多余翻译');
    assert(root().querySelector('[data-result]').textContent === '你好世界', '手动同语言未提供原文');
    await openImage(); assert(state.requests.length === n + 1, '重开图片未复用识别并恢复自动翻译');
    assert(root().querySelector('select').value === 'en' && root().querySelector('[data-result]').textContent === 'Hello world', '手动选择污染自动结果');
  });
  await check('A18 关闭后迟到响应不重开', async () => { state.latency = 300; await startImage(); await delay(40); close(); await delay(700); assert(root().host.hidden, '迟到响应重开'); });
  await check('外部点击取消正在翻译的任务，迟到响应不重开', async () => { state.latency = 300; await startImage(); await delay(40); const n = state.cancelled; document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); assert(root().host.hidden, '外部点击没有立即关闭'); await delay(700); assert(root().host.hidden && state.cancelled > n, '请求未取消或迟到响应重开'); });
  await check('A17 取消保留可恢复状态', async () => { state.latency = 300; await startImage(); await delay(40); root().querySelector('[data-action="cancel"]').click(); await delay(350); assert(root().textContent.includes('已取消'), '未保留取消状态'); });
  await check('A14/A23 长内容单滚动区域、展开保留阅读位置', async () => { state.scenario = 'long'; await openImage(); root().querySelector('summary').click(); const body = root().querySelector('.content'); body.scrollTop = 80; const before = body.scrollTop; root().querySelector('[data-action="expand"]').click(); await delay(40); root().querySelector('[data-action="expand"]').click(); await delay(40); assert(body.scrollTop === before, '展开丢失阅读位置'); assert(root().querySelector('details').open, '展开丢失折叠状态'); assert(getComputedStyle(body).overflowY === 'auto', '正文不是单一滚动区'); });
  await check('A24 视口安全边界', async () => { await openImage(); const r = root().host.getBoundingClientRect(); assert(r.left >= 11 && r.top >= 11 && r.right <= document.documentElement.clientWidth - 11 && r.bottom <= innerHeight - 11, '越出安全边界'); });
  await check('A10 小图原生菜单翻译', async () => { await openImage('small'); assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), '小图右键未翻译'); });
  await check('A16 切换目标语言只翻译已识别原文', async () => { await openImage(); const n = state.requests.length; const select = root().querySelector('select'); select.value = 'ja'; select.dispatchEvent(new Event('change')); await delay(20); await settled(); assert(state.requests.length === n + 1, '重复识别图片'); assert(!Array.isArray(state.requests.at(-1).messages[1].content), '发送了图片'); assert(root().querySelector('[data-result]').lang === 'ja', '目标语言未更新'); });
  await check('A21 翻译失败重试复用原文', async () => { state.scenario = 'translate-error'; await openImage(); const n = state.requests.length; assert(root().textContent.includes('暂时不可用'), '错误状态缺失'); state.scenario = 'normal'; root().querySelector('[data-action="retry"]').click(); await delay(20); await settled(); assert(state.requests.length === n + 1, '重试重复OCR'); assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), '未恢复'); });
  await check('A26 相同 URL 实际像素变化不命中旧结果', async () => { await openImage(); const n = state.requests.length; state.pixelVersion = 1; await openImage(); assert(state.requests.length === n + 2, '复用过期结果'); const before = state.requests.length; await openImage(); assert(state.requests.length === before, '相同像素未复用'); });
  await check('A20 框选取消恢复原任务', async () => { await openImage(); const before = root().querySelector('[data-result]').textContent, n = state.requests.length; await deliver({ type: 'BEGIN_CAPTURE' }); await until(() => roots.find(r => r.host.id === 'opentransai-capture')?.host.hidden === false); assert(root().host.hidden, '旧浮窗未隐藏'); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); close(); await delay(30); assert(!root().host.hidden && root().querySelector('[data-result]').textContent === before, '未恢复旧任务'); assert(state.requests.length === n, '取消截图触发了AI'); });
  await check('截图确认本地裁剪，只发送选区且隐藏全部插件界面', async () => { await openImage(); await deliver({ type: 'BEGIN_CAPTURE' }); const cr = () => roots.find(r => r.host.id === 'opentransai-capture'); await until(() => cr()?.host.hidden === false); const shade = cr().querySelector('.shade'); shade.setPointerCapture = shade.releasePointerCapture = () => {}; assert(cr().querySelector('[data-action="capture-confirm"]').disabled, '空选区可提交'); for (const [type,x,y] of [['pointerdown',50,60],['pointermove',150,140],['pointerup',150,140]]) shade.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:3,button:0,bubbles:true,composed:true})); cr().querySelector('[data-action="capture-confirm"]').click(); await until(() => !root().host.hidden); await settled(); assert(state.captureHidden, '截图包含插件UI'); assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), '截图译文未显示'); const data = state.requests.filter(r => Array.isArray(r.messages?.[1]?.content)).at(-1).messages[1].content.find(part => part.type === 'image_url').image_url.url; const bitmap = await createImageBitmap(await (await fetch(data)).blob()); assert(bitmap.width === 200 && bitmap.height === 160, `裁剪尺寸错误 ${bitmap.width}x${bitmap.height}`); bitmap.close(); });
  await check('A22 复制失败选中文本并提示手动复制', async () => { await openImage(); const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard'), command = document.execCommand; try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw Error('denied'); } } }); document.execCommand = () => false; root().querySelector('[data-action="copy"]').click(); await delay(30); assert(root().querySelector('.copy-note').textContent.includes('Ctrl/Cmd+C') && !root().querySelector('.copy-note').hidden, '未提示手动复制'); assert(root().querySelector('.status').textContent !== '已复制', '误报复制成功'); } finally { document.execCommand = command; if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor); else delete navigator.clipboard; getSelection().removeAllRanges(); } });
  await check('A15 流式阅读停止跟随并可回到最新', async () => { state.scenario = 'long'; state.latency = 500; await startImage(); await until(() => root().querySelector('[data-result]').textContent.length > 100); const body = root().querySelector('.content'); body.scrollTop = 0; body.dispatchEvent(new Event('scroll')); assert(!root().querySelector('[data-action="latest"]').hidden, '没有回到最新'); const position = body.scrollTop; await delay(100); assert(body.scrollTop === position, '强制滚动'); root().querySelector('[data-action="latest"]').click(); assert(body.scrollTop > 0, '未回到最新'); await settled(); });
  await check('跨域已加载图片在显式触发后才交后台读取', async () => { const img = new Image(); img.width = 160; img.height = 160; img.src = `http://localhost:${location.port}/extension/icons/icon-128.png`; img.style.cssText = 'position:fixed;left:12px;top:12px'; document.body.append(img); try { await img.decode(); let tainted = false; const c = document.createElement('canvas'); c.width = c.height = 128; c.getContext('2d').drawImage(img,0,0); try { c.toDataURL(); } catch { tainted = true; } assert(tainted, '测试图片并非跨域'); const n = state.imageFetches; img.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true })); assert(state.imageFetches === n, '非显式触发就读取'); await deliver({ type:'CONTEXT_IMAGE', url:img.src }); await delay(20); await settled(); assert(state.imageFetches === n+1, '未进入授权后台图片读取路径'); assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), '跨域读取未完成'); } finally { img.remove(); } });
  await check('透明图片组件通过原生菜单翻译，无悬停检测', async () => {
    const img = document.getElementById('large'), previousStyle = img.getAttribute('style'), wrapper = document.createElement('div'), paint = document.createElement('div');
    wrapper.style.cssText = `position:relative;width:${img.width}px;height:${img.height}px;flex:none`;
    paint.style.cssText = 'position:absolute;inset:0;background-size:100% 100%'; paint.style.backgroundImage = `url("${img.currentSrc}")`;
    img.replaceWith(wrapper); wrapper.append(paint,img); img.style.cssText = 'position:absolute;inset:0;opacity:0';
    try { const n = state.requests.length; await openImage(); assert(state.requests.length === n + 2, '未走两阶段翻译'); assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), '透明图片未完成翻译'); }
    finally { wrapper.replaceWith(img); if (previousStyle === null) img.removeAttribute('style'); else img.setAttribute('style', previousStyle); }
  });
  await check('无法定位图片节点时使用浏览器选定URL', async () => {
    document.body.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true })); const n = state.imageFetches;
    await service.contextClicked({ menuItemId:'image-translation', srcUrl:`http://localhost:${location.port}/extension/icons/icon-128.png`, frameId:0 }, { ...sender.tab, url:location.href });
    await delay(20); await settled(); assert(state.imageFetches === n + 1, '未使用原生图片URL读取'); assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), 'URL回退未完成翻译');
  });
  await check('picture/srcset 切换使用当前实际图片', async () => {
    const img = document.getElementById('large'), picture = document.createElement('picture'), source = document.createElement('source');
    source.srcset = img.src; img.replaceWith(picture); picture.append(source, img);
    try {
      await img.decode(); await openImage(); const before = state.requests.length;
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160; canvas.getContext('2d').fillRect(0, 0, 320, 160);
      const changed = canvas.toDataURL(); source.srcset = changed;
      await until(() => img.currentSrc === changed && img.complete); await openImage();
      assert(state.requests.length === before + 2, 'srcset 新图片错误复用了旧识别');
      assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), 'picture 图片未完成翻译');
    } finally { picture.replaceWith(img); await img.decode(); }
  });
  await check('动态新增和延迟加载图片可直接使用原生菜单', async () => {
    const img = document.createElement('img'); img.width = 320; img.height = 160; document.body.append(img);
    try { img.src = document.getElementById('large').src; await img.decode(); await chooseImage(img); await delay(20); await settled(); assert(root().querySelector('[data-result]').textContent.includes('保持好奇'), '动态图片未完成翻译'); }
    finally { img.remove(); }
  });
  await check('A06 图片链接正常工作，右键翻译不触发链接', async () => { const img = document.getElementById('large'), anchor = document.createElement('a'); anchor.href = '#image-link'; let clicks = 0; anchor.addEventListener('click', event => { event.preventDefault(); clicks++; }); img.replaceWith(anchor); anchor.append(img); try { img.click(); assert(clicks === 1, '图片链接被插件拦截'); await openImage(); assert(clicks === 1, '右键翻译触发链接'); } finally { anchor.replaceWith(img); } });
  await check('iframe 图片共享顶层浮窗，点击 iframe 页面也关闭', async () => {
    const frame = document.createElement('iframe'); frame.src = '/tests/image-frame.html'; frame.style.cssText = 'position:fixed;left:12px;top:12px;width:400px;height:220px;z-index:20'; document.body.append(frame);
    try { await until(() => frame.contentDocument?.getElementById('ready')); await chooseImage(frame.contentDocument.querySelector('img'), { frameId:2 }); await delay(20); await settled(); assert(roots.filter(r => r.host.id === 'opentransai-root').length === 1, 'iframe另建浮窗'); const b = root().host.getBoundingClientRect(); assert(Math.abs(b.top - 12) < 2 && Math.abs(b.right - (document.documentElement.clientWidth - 12)) < 2, 'iframe没有使用右上安全区域'); frame.contentDocument.body.dispatchEvent(new frame.contentWindow.PointerEvent('pointerdown', { bubbles: true })); await until(() => root().host.hidden); }
    finally { frame.remove(); for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].frameId === 2) listeners.splice(i, 1); }
  });
  await check('固定浮窗保留结果、展开状态和请求；取消固定恢复外点关闭', async () => {
    await openImage(); const pin = root().querySelector('[data-action="pin"]');
    assert(pin, '缺少固定按钮'); pin.click();
    assert(pin.getAttribute('aria-pressed') === 'true', '固定状态未标记');
    const result = root().querySelector('[data-result]').textContent, count = state.requests.length;
    root().querySelector('[data-action="expand"]').click();
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, composed:true }));
    assert(!root().host.hidden && root().querySelector('.panel').classList.contains('expanded'), '固定后外部点击关闭浮窗');
    assert(root().querySelector('[data-result]').textContent === result && state.requests.length === count, '固定改变内容或发起请求');
    pin.click(); document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true }));
    assert(root().host.hidden, '取消固定未恢复关闭');
    await openImage(); root().querySelector('[data-action="pin"]').click(); close();
    assert(root().host.hidden, '固定阻止 Esc 关闭');
    await openImage(); assert(root().querySelector('[data-action="pin"]').getAttribute('aria-pressed') === 'false', '新任务继承旧固定状态');
    root().querySelector('[data-action="pin"]').click(); root().querySelector('[data-action="close"]').click();
    assert(root().host.hidden, '固定阻止关闭按钮');
  });
  await check('固定浮窗不因 iframe 点击关闭，主动新任务仍替换结果', async () => {
    const frame = document.createElement('iframe'); frame.src = '/tests/image-frame.html'; document.body.append(frame);
    try {
      await until(() => frame.contentDocument?.getElementById('ready')); await openImage();
      const pin = root().querySelector('[data-action="pin"]'); assert(pin, '缺少固定按钮'); pin.click();
      frame.contentDocument.body.dispatchEvent(new frame.contentWindow.PointerEvent('pointerdown', { bubbles:true })); await delay(50);
      assert(!root().host.hidden, 'iframe 关闭了固定浮窗');
      frame.contentDocument.body.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown', { key:'Escape', bubbles:true }));
      await until(() => root().host.hidden, 'iframe Esc 未关闭固定浮窗');
      await openImage(); root().querySelector('[data-action="pin"]').click();
      await openImage('small'); assert(!root().host.hidden, '新任务无法替换固定窗口');
      assert(root().querySelector('[data-action="pin"]').getAttribute('aria-pressed') === 'false', '新任务未重置固定');
    } finally { frame.remove(); for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].frameId === 2) listeners.splice(i, 1); }
  });
  await check('设置支持全部语言，草稿重开恢复、测试不保存、显式保存后清除', async () => {
    const keys = ['opentransai-test-settings', 'opentransai-test-session', 'opentransai-test-revision'];
    const previous = keys.map(key => sessionStorage.getItem(key)); keys.forEach(key => sessionStorage.removeItem(key));
    const frame = document.createElement('iframe'); frame.hidden = true;
    const field = id => frame.contentDocument.getElementById(id);
    const load = async (scenario = '') => { await new Promise(resolve => { frame.onload = resolve; frame.src = '/preview/popup.html' + scenario; if (!frame.isConnected) document.body.append(frame); }); await until(() => field('fields') && !field('fields').disabled); };
    const set = (id, value, type = 'input') => { field(id).value = value; field(id).dispatchEvent(new frame.contentWindow.Event(type, { bubbles:true })); };
    try {
      await load(); assert(field('default-language').options.length === 16, '默认语言不足16种');
      set('base-url', 'https://unfinished.'); set('model', ''); set('api-key', 'draft-fixture-key'); set('default-language', 'pt', 'change');
      await until(() => field('draft-notice')?.textContent.includes('暂存'));
      await load('?reload=1'); assert(field('base-url').value === 'https://unfinished.' && field('model').value === '', '不完整草稿没有恢复');
      assert(field('api-key').value === 'draft-fixture-key' && field('api-key').type === 'password' && field('default-language').value === 'pt', '草稿字段丢失或 Key 明文显示');
      field('discard-draft').click(); await until(() => field('base-url').value === '');
      assert(field('api-key').value === '' && field('draft-state').hidden, '放弃修改未恢复保存配置');
      set('base-url', 'https://example.test/v1'); set('model', 'fixture-model'); set('api-key', 'draft-fixture-key'); set('default-language', 'pt', 'change');
      field('test').click(); assert(field('discard-draft').disabled, '测试期间放弃修改仍可操作'); await until(() => field('notice').textContent.includes('连接成功'));
      assert(field('notice').textContent.includes('尚未保存'), '测试成功未提示保存');
      assert(!JSON.parse(sessionStorage.getItem(keys[0]) || '{}').apiKey, '连接测试意外保存配置');
      field('save').click(); await until(() => frame.contentDocument.getElementById('popup-preview-closed'));
      await load('?reload=2'); assert(field('default-language').value === 'pt' && field('api-key').value === 'draft-fixture-key', '新增语言未持久化');
      assert(field('draft-state').hidden, '保存后仍恢复旧草稿');
      set('model', 'denied-model'); await until(() => field('draft-notice').textContent.includes('暂存'));
      await load('?scenario=permission-denied'); field('save').click(); await until(() => field('notice').textContent.includes('未获得'));
      await load('?reload=3'); assert(field('model').value === 'denied-model', '授权失败丢失草稿');
    } finally { frame.remove(); keys.forEach((key,i) => previous[i] === null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, previous[i])); }
  });
  await check('A19 图片读取失败保留主动框选入口且不自动截图', async () => { const before = state.captures; await deliver({ type: 'OPEN_SOURCE', source: { kind: 'image', id: 'missing-source' }, anchor: null }); await delay(20); await settled(); assert(!root().querySelector('[data-action="capture"]').hidden && !root().querySelector('[data-action="retry"]').hidden, '缺少恢复入口'); assert(state.captures === before, '读取失败自动截图'); });
  await check('密码框与文本输入框回归', async () => { const password = document.getElementById('password'); password.focus(); password.setSelectionRange(0, 5); password.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await delay(30); assert(!entry() || entry().host.hidden, '密码框出现翻译按钮'); const input = document.getElementById('editable'); input.focus(); input.setSelectionRange(0, 6); input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 100 })); await until(() => !entry().host.hidden); entry().querySelector('[data-action="translate"]').click(); await delay(20); await settled(); assert(root().querySelector('.original-text').textContent === 'Select', '输入框选区丢失'); });
  await check('划词入口回归：点击页面关闭旧结果、显式点击开启新翻译', async () => { await openImage(); const n = state.requests.length; const selected = document.getElementById('selection'); selected.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); const range = document.createRange(); range.selectNodeContents(selected); getSelection().removeAllRanges(); getSelection().addRange(range); selected.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 160, clientY: 120 })); await until(() => !entry().host.hidden); assert(state.requests.length === n && root().host.hidden, '页面点击未关闭旧结果或自动提交新任务'); const button = entry().querySelector('[data-action="translate"]'); button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true })); button.click(); await delay(20); await settled(); assert(!root().host.hidden && root().querySelector('[data-result]').textContent.includes('保持好奇'), '未开启文本翻译'); assert(!root().textContent.includes('划词翻译') && !root().querySelector('.source-kind'), '划词提示仍占用原文上方空间'); assert(state.requests.length === n + 1, '文本走了OCR'); getSelection().removeAllRanges(); });
  await check('切换协议保留当前配置，保存后回显所选协议及字段', async () => {
    const storageKey = 'opentransai-test-settings';
    const previous = sessionStorage.getItem(storageKey);
    const frame = document.createElement('iframe');
    frame.hidden = true;
    const load = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('配置预览加载超时')), 5000);
      frame.onload = () => { clearTimeout(timer); resolve(); };
      frame.src = '/preview/popup.html';
      if (!frame.isConnected) document.body.append(frame);
    });
    try {
      sessionStorage.removeItem(storageKey);
      await load();
      const field = id => frame.contentDocument.getElementById(id);
      const set = (id, value, type = 'input') => {
        field(id).value = value;
        field(id).dispatchEvent(new frame.contentWindow.Event(type, { bubbles: true }));
      };
      assert(!field('fields').disabled, '配置未加载完成');
      assert(!field('capture') && !field('capture-access'), '配置页仍保留截图按钮或权限区');
      set('base-url', 'https://api.deepseek.com');
      set('model', 'demo-model');
      set('api-key', 'demo-key-not-valid');
      set('default-language', 'ja', 'change');
      field('thinking').click();
      const retained = model => {
        assert(field('base-url').value === 'https://api.deepseek.com', '切换协议清空或替换了 API 地址');
        assert(field('model').value === model, '切换协议清空或恢复了旧模型');
        assert(field('api-key').value === 'demo-key-not-valid', '切换协议清空或替换了 Key');
        assert(field('default-language').value === 'ja' && field('enabled').checked, '切换协议改变了其他配置');
      };
      for (const protocol of ['anthropic', 'gemini', 'openai']) {
        set('provider', protocol, 'change'); retained('demo-model');
        assert(field('thinking').disabled === (protocol !== 'openai'), '思考开关适用范围错误');
        assert(field('thinking').checked === (protocol === 'openai'), '往返切换丢失思考偏好或错误启用思考');
      }
      set('provider', 'anthropic', 'change');
      set('model', 'updated-demo-model');
      set('provider', 'openai', 'change'); retained('updated-demo-model');
      set('provider', 'gemini', 'change'); retained('updated-demo-model');
      field('save').click(); await delay(100);
      assert(frame.contentDocument.getElementById('popup-preview-closed'), '保存未成功关闭配置');
      await load(); retained('updated-demo-model');
      assert(field('provider').value === 'gemini', '保存了旧协议');
      assert(field('thinking').disabled && !field('thinking').checked, '不支持的协议保存了思考开关');
    } finally {
      frame.remove();
      if (previous === null) sessionStorage.removeItem(storageKey);
      else sessionStorage.setItem(storageKey, previous);
    }
  });
  close(); output.textContent += `\n\n${results.filter(x => x.startsWith('PASS')).length}/${results.length} 通过（模拟 Chrome / AI，真实生产模块）`; output.dataset.complete = 'true';
};

// Layout checks use explicit image triggers so the fixture's offscreen samples do not affect hover tests.
document.getElementById('run-layout').onclick = async () => {
  const lines = [], output = document.getElementById('layout-results');
  const checkBounds = () => { const r = root().host.getBoundingClientRect(), v = OpenTransAIPage.viewport(); assert(r.left >= v.left + 11 && r.top >= v.top + 11 && r.right <= v.left + v.width - 11 && r.bottom <= v.top + v.height - 11, '浮窗越界'); return r; };
  try {
    close(); state.scenario = 'long'; state.latency = 30; state.configured = true;
    const img = document.getElementById('large'); img.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true })); await deliver({ type:'CONTEXT_IMAGE', url:img.src }); await delay(20); await settled();
    const b = checkBounds(); assert(b.height <= OpenTransAIPage.viewport().height * .7 + 1 && b.width <= 440, '默认宽高不正确'); lines.push('PASS 默认浮窗安全区域与70%高度');
    root().querySelector('summary').click(); const content = root().querySelector('.content'); content.scrollTop = 60; const position = content.scrollTop;
    root().querySelector('[data-action="expand"]').click(); await delay(50); const expanded = checkBounds(); assert(expanded.width <= 520 && root().querySelector('details').open, '展开宽度或折叠状态错误'); lines.push('PASS 展开520px阅读窗');
    root().querySelector('[data-action="expand"]').click(); await delay(50); checkBounds(); assert(content.scrollTop === position && root().querySelector('details').open, '收起丢失阅读位置'); lines.push('PASS 收起保留阅读位置');
    const before = root().host.getBoundingClientRect(); window.scrollBy(0,100); await delay(150); const after = root().host.getBoundingClientRect(); assert(before.x === after.x && before.y === after.y, '面板跟随页面滚动'); lines.push('PASS 打开后固定位置');
    const panel = root().querySelector('.panel'); assert(panel.scrollWidth <= panel.clientWidth + 2 && content.scrollWidth <= content.clientWidth + 2, '浮窗横向溢出'); lines.push('PASS 无横向溢出');
  } catch (e) { lines.push('FAIL ' + e.message); }
  output.textContent = lines.join('\n'); output.dataset.complete = 'true';
};
