const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = document.getElementById('results'), feed = document.getElementById('feed');
const large = document.getElementById('large'), small = document.getElementById('small');
const metrics = { styles: 0, observers: 0, pixels: 0, messages: [] };
const nativeStyle = window.getComputedStyle, NativeObserver = window.MutationObserver;
window.getComputedStyle = (...args) => { metrics.styles++; return nativeStyle(...args); };
window.MutationObserver = class extends NativeObserver { constructor(callback) { super(callback); metrics.observers++; } };
Object.defineProperty(window, 'chrome', { configurable: true, value: { runtime: {
  id: 'performance-fixture',
  getURL: path => '/extension/' + path,
  async sendMessage(message) { metrics.messages.push(message.type); return { ok: true, data: message.type === 'STATUS' ? { enabled: true } : {} }; },
} } });
const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 160;
const context = canvas.getContext('2d'); context.fillStyle = '#e4ecf8'; context.fillRect(0, 0, 320, 160); context.fillStyle = '#213c62'; context.font = '24px sans-serif'; context.fillText('Generic image component', 12, 80);
large.src = small.src = canvas.toDataURL(); await Promise.all([large.decode(), small.decode()]);
await import('/extension/lib/page-shared.js'); await import('/extension/lib/image-entry.js');
const originalRead = OpenTransAIPage.canvasImage;
OpenTransAIPage.canvasImage = async canvas => { metrics.pixels++; return originalRead(canvas); };
const entries = OpenTransAIPage.createEntries();
const assert = (condition, message) => { if (!condition) throw Error(message); };
const churn = async () => { for (let batch = 0; batch < 10; batch++) { for (let i = 0; i < 100; i++) { const node = document.createElement('span'); node.className = 'feed-item'; feed.append(node); node.style.opacity = '.9'; } await delay(0); } };
document.getElementById('run').onclick = async () => {
  document.getElementById('run').disabled = true;
  const results = [];
  const check = async (name, fn) => { try { const detail = await fn(); results.push(`PASS ${name}${detail ? ': ' + detail : ''}`); } catch (error) { results.push(`FAIL ${name}: ${error.message}`); } output.textContent = results.join('\n'); await delay(30); };
  await check('动态页面更新不读取图片布局', async () => { const before = metrics.styles; await churn(); assert(metrics.styles === before, '发生样式读取'); return '1000 个节点更新，额外样式读取 0'; });
  await check('图片鼠标移动不观察页面、不读图、不显示按钮', async () => {
    for (let i = 0; i < 500; i++) for (const image of [large, small]) image.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:50, clientY:180 }));
    await delay(400); assert(entries.layer.host.hidden && metrics.styles === 0 && metrics.observers === 0 && metrics.messages.length === 0 && metrics.pixels === 0, JSON.stringify(metrics)); return '1000 次图片鼠标事件，观察器/样式读取/请求均为 0';
  });
  await check('当前图片频繁变更不触发后台工作', async () => { for (let i = 0; i < 500; i++) large.style.width = `${320 + i % 10}px`; await delay(50); assert(metrics.styles === 0 && metrics.messages.length === 0 && metrics.observers === 0, '图片变化触发了监视工作'); });
  await check('普通区域移动鼠标不反复修改插件 DOM', async () => {
    let writes = 0; const observer = new NativeObserver(records => { writes += records.length; }); observer.observe(entries.layer.host, { attributes:true });
    for (let i = 0; i < 500; i++) document.body.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:8, clientY:8 }));
    await delay(20); observer.disconnect(); assert(writes === 0, `额外 DOM 写入 ${writes}`); return '500 次鼠标移动，额外 DOM 写入 0';
  });
  await check('仅打开右键菜单不读取或上传图片', async () => { large.dispatchEvent(new MouseEvent('contextmenu', { bubbles:true, composed:true })); await delay(50); assert(metrics.messages.length === 0 && metrics.pixels === 0 && metrics.styles === 0, '仅右键就处理图片'); });
  await check('明确选择翻译后才能读取所选图片', async () => { const source = await entries.context(large.currentSrc); assert(metrics.messages.length === 1 && metrics.messages[0] === 'TASK_OPEN', '未显式开启任务'); const result = await entries.read(source.token, source.url); assert(result.image.width === 320 && metrics.pixels === 1, '未读取明确选择的原图'); });
  entries.hide(); output.textContent += `\n\n${results.filter(line => line.startsWith('PASS')).length}/${results.length} 通过`; output.dataset.complete = 'true';
};
