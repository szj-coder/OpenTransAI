const posts = document.querySelector('#posts'), output = document.querySelector('#results');
const messages = [], ports = [], errors = [], listeners = new Set();
let status = { enabled: true, configured: true, defaultLanguage: 'zh-CN', configRevision: 'one' }, instance;
addEventListener('error', event => errors.push(event.message));
addEventListener('unhandledrejection', event => errors.push(String(event.reason)));
const api = { runtime: { id: 'x-fixture', getURL: p => '/extension/' + p,
  onMessage: { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn) },
  async sendMessage(message) { messages.push(message); return { ok: true, data: message.type === 'STATUS' ? { ...status } : {} }; },
  connect() {
    const port = { onMessage: { addListener: fn => { port.receive = fn; } }, onDisconnect: { addListener: fn => { port.disconnected = fn; } },
      postMessage(message) { if (message.type !== 'PING') port.request = message; }, disconnect() { port.closed = true; },
      done(translation = '你好，世界！') { port.receive({ type: 'DONE', requestId: port.request.requestId, data: { translation, sourceLanguage: 'en', targetLanguage: 'zh-CN' } }); },
      fail(code = 'SERVICE') { port.receive({ type: 'ERROR', requestId: port.request.requestId, code }); },
    }; ports.push(port); return port;
  },
} };
Object.defineProperty(window, 'chrome', { value: api, configurable: true });
await import('/extension/lib/errors-shared.js'); await import('/extension/lib/page-shared.js');
// Missing feature must fail the visible entry assertion before implementation.
const resource = await fetch('/extension/lib/x-translation.js');
if (resource.ok) await import('/extension/lib/x-translation.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (ok, message) => { if (!ok) throw Error(message); };
const notify = data => { status = { ...status, ...data }; listeners.forEach(fn => fn({ type: 'STATUS_CHANGED', data: { ...status } })); };
function post({ id = '100', native = true, translated = false, text = 'Hello, world!\nStay curious.', quote = false } = {}) {
  const node = document.createElement(quote ? 'div' : 'article'); node.dataset.testid = quote ? 'quoteTweet' : 'tweet';
  node.innerHTML = `<div class="author"><a href="https://x.com/example/status/${id}">Example · <time>18 小时</time></a></div>${native ? '<div class="controls"><button data-testid="translateTweet"></button><button aria-label="翻译设置">⚙</button></div>' : ''}<div data-testid="tweetText" lang="en"></div>`;
  const body = node.querySelector('[data-testid=tweetText]'), control = node.querySelector('[data-testid=translateTweet]'); body.textContent = translated ? 'X 已翻译的文字' : text;
  let isTranslated = translated;
  if (control) {
    control.textContent = isTranslated ? '显示原文' : '显示翻译';
    control.addEventListener('click', () => { isTranslated = !isTranslated; control.textContent = isTranslated ? '显示原文' : '显示翻译'; body.textContent = isTranslated ? 'X 已翻译的文字' : text; body.lang = isTranslated ? 'zh' : 'en'; });
  }
  return node;
}
const entry = node => node.querySelector('[data-opentransai-x-entry]');
const button = node => entry(node)?.shadowRoot.querySelector('button');
const result = node => node.querySelector('[data-opentransai-x-result]');
const body = node => node.querySelector('[data-testid=tweetText]');
async function reset(nodes = [post()]) {
  instance?.dispose(); status = { enabled: true, configured: true, defaultLanguage: 'zh-CN', configRevision: 'one' };
  posts.replaceChildren(...nodes); ports.length = 0; messages.length = 0;
  instance = OpenTransAIPage.createXTranslation?.(); await delay(100); return nodes;
}
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
test('所有文字帖子都有入口，原生控件后同排追加，无控件时在正文上方', async () => {
  const [a, b] = await reset([post(), post({ id: '101', native: false })]);
  check(button(a) && button(b), '文字帖子缺少 OpenTransAI 入口');
  check(entry(a).parentElement === a.querySelector('.controls') && entry(a).previousElementSibling?.textContent === '⚙', '入口未在原生控件组之后');
  check(entry(b).nextElementSibling === body(b), '无原生控件入口未在正文上方');
});
test('点击等待保留原文，验证完成后切换，再点恢复完整原节点和缓存', async () => {
  const [a] = await reset(); const original = body(a); original.innerHTML = 'Hello <a href="https://example.com/">world</a>!<br><img alt="😀">'; await delay(80);
  let navigated = 0; a.addEventListener('click', () => navigated++);
  button(a).click(); button(a).click(); await delay(60);
  check(ports.length === 1 && !original.hidden, '重复请求或等待隐藏了原文');
  check(ports[0].request.text === 'Hello world!\n😀', '原文链接/换行/表情提取错误');
  check(ports[0].request.scope === 'x-post' && ports[0].request.taskId, '缺少任务作用域');
  ports[0].receive({ type: 'PROGRESS', requestId: ports[0].request.requestId, data: { translation: '不完整' } }); await delay(20);
  check(!original.hidden, '校验完成前替换正文');
  ports[0].done('<script>literal</script>\n你好'); await delay(50);
  check(original.hidden && result(a)?.textContent.includes('<script>literal</script>') && !result(a).querySelector('script'), '译文切换或纯文本渲染失败');
  button(a).click(); await delay(20); check(body(a) === original && !original.hidden && original.querySelector('a'), '原始节点或链接丢失');
  button(a).click(); await delay(40); check(ports.length === 1 && original.hidden && navigated === 0, '缓存复用或阻止误导航失败');
});
test('外层与引用帖独立，发送内容不含作者、时间或引用正文', async () => {
  const a = post({ text: 'Outer text' }), q = post({ quote: true, id: '102', text: 'Quoted text' }); a.append(q); await reset([a]);
  check(a.querySelectorAll('[data-opentransai-x-entry]').length === 2, '引用帖入口错误');
  button(a).click(); button(q).click(); await delay(40);
  check(ports.length === 2 && ports[0].request.text === 'Outer text' && ports[1].request.text === 'Quoted text', '正文跨帖串联');
  ports[1].done('引用译文'); ports[0].done('外层译文'); await delay(40);
  check(body(a).hidden && body(q).hidden && result(q).textContent === '引用译文', '并行译文串帖');
});
test('X 自动翻译先切回原文，原生按钮随后仍能操作', async () => {
  const [a] = await reset([post({ translated: true, text: 'Actual original' })]);
  button(a).click(); await delay(260);
  check(ports.length === 1 && ports[0].request.text === 'Actual original', '把 X 译文当成了原文');
  ports[0].done(); await delay(40); a.querySelector('[data-testid=translateTweet]').click(); await delay(100);
  check(!body(a).hidden && body(a).textContent === 'X 已翻译的文字', '原生翻译没有恢复控制');
});
test('网络错误保留原文并可重试，配置错误提供设置入口', async () => {
  const [a] = await reset(); button(a).click(); await delay(40); ports[0].fail(); await delay(40);
  check(!body(a).hidden && entry(a).shadowRoot.textContent.includes('服务暂时不可用'), '错误没有内联显示');
  button(a).click(); await delay(40); check(ports.length === 2, '重试未创建请求'); ports[1].fail('CONFIG'); await delay(40);
  const settings = [...entry(a).shadowRoot.querySelectorAll('button')].find(node => node.textContent === '打开设置'); check(settings, '缺少设置入口'); settings.click(); await delay(20);
  check(messages.some(m => m.type === 'OPEN_SETTINGS'), '设置消息未发送');
});
test('正文更新和虚拟列表复用丢弃迟到结果，新内容重新翻译', async () => {
  const [a] = await reset(); button(a).click(); await delay(40); const old = ports[0];
  body(a).textContent = 'Expanded new text'; a.querySelector('a').href = 'https://x.com/example/status/999'; await delay(100);
  old.done('过期译文'); await delay(40); check(!body(a).hidden && !result(a), '过期译文污染新帖');
  button(a).click(); await delay(40); check(ports[1].request.text === 'Expanded new text', '未重新读取正文');
});
test('动态追加幂等，删除帖子取消任务，迟到结果不再挂载', async () => {
  await reset([]); const a = post(); posts.append(a); await delay(100); a.append(document.createElement('span')); await delay(100);
  check(a.querySelectorAll('[data-opentransai-x-entry]').length === 1, '重复注入'); button(a).click(); await delay(40); a.remove(); await delay(100);
  check(ports[0].closed && messages.some(m => m.type === 'CANCEL' && m.scope === 'x-post'), '移除帖子未清理任务'); ports[0].done(); await delay(40); check(!posts.querySelector('[data-opentransai-x-result]'), '迟到结果重新挂载');
});
test('设置变化失效缓存，总开关关闭恢复正文，再启用重新挂载', async () => {
  const [a] = await reset(); button(a).click(); await delay(40); ports[0].done(); await delay(40);
  notify({ configRevision: 'two' }); await delay(80); check(!body(a).hidden, '配置变更仍显示旧译文');
  button(a).click(); await delay(40); check(ports.length === 2 && ports[1].request.configRevision === 'two', '缓存未失效'); ports[1].done(); await delay(30);
  notify({ enabled: false }); await delay(70); check(!body(a).hidden && !entry(a), '关闭未移除入口或恢复正文');
  notify({ enabled: true }); await delay(70); check(button(a), '重新开启没有入口');
});
test('超长正文不发送，未配置在帖子内引导设置', async () => {
  const [a] = await reset([post({ text: 'a'.repeat(12001) })]); button(a).click(); await delay(40); check(ports.length === 0 && !body(a).hidden, '超长正文仍发送');
  await reset(); status.configured = false; button(posts.firstElementChild).click(); await delay(40);
  check(ports.length === 0 && entry(posts.firstElementChild).shadowRoot.textContent.includes('打开设置'), '未配置处理错误');
});
test('原生切回原文时重建正文节点不会重复注入或遗留任务', async () => {
  const a = post({ native: false });
  const row = document.createElement('div'); row.className = 'controls';
  const native = document.createElement('button'); native.textContent = '显示原文'; row.append(native); body(a).before(row);
  body(a).textContent = 'Translated by X';
  native.addEventListener('click', () => {
    native.textContent = '显示翻译'; const replacement = document.createElement('div'); replacement.dataset.testid = 'tweetText'; replacement.lang = 'ja'; replacement.textContent = '本当の原文'; body(a).replaceWith(replacement);
  });
  await reset([a]); button(a).click(); await delay(280);
  check(ports.length === 1 && ports[0].request.text === '本当の原文', '重建正文后未取得原文');
  check(a.querySelectorAll('[data-opentransai-x-entry]').length === 1, '切回原文时出现重复入口');
  ports[0].done(); await delay(40); instance.dispose();
  check(!a.querySelector('[data-opentransai-x-entry]') && !body(a).hidden, '重建正文后卸载有残留');
});
test('原生按钮打断等待后迟到结果不覆盖 X 的译文', async () => {
  const [a] = await reset(); button(a).click(); await delay(40); const port = ports[0];
  a.querySelector('[data-testid=translateTweet]').click(); await delay(90); port.done('过期结果'); await delay(30);
  check(port.closed && !body(a).hidden && body(a).textContent === 'X 已翻译的文字' && !result(a), '原生操作后仍显示插件过期结果');
});
test('配置变更打断等待且不接受旧版本的流式结果', async () => {
  const [a] = await reset(); button(a).click(); await delay(40); const port = ports[0];
  notify({ configRevision: 'new-config' }); await delay(70); port.done('旧模型结果'); await delay(20);
  check(port.closed && !body(a).hidden && !result(a), '旧配置结果写入正文');
  button(a).click(); await delay(40); check(ports.at(-1).request.configRevision === 'new-config', '新任务未使用新配置');
});
test('站内导航清理等待任务，返回后仍只挂载一个入口', async () => {
  const [a] = await reset(); button(a).click(); await delay(40); const port = ports[0];
  history.pushState({}, '', '?route=detail'); dispatchEvent(new PopStateEvent('popstate')); await delay(90); port.done('前一页结果'); await delay(20);
  check(port.closed && !body(a).hidden && !result(a) && a.querySelectorAll('[data-opentransai-x-entry]').length === 1, '导航没有清理任务');
  history.replaceState({}, '', location.pathname);
});
test('仅更换帖子链接的虚拟列表复用仍有入口并取消旧任务', async () => {
  const [a] = await reset(); button(a).click(); await delay(150); const old = ports[0];
  a.querySelector('a').href = 'https://x.com/example/status/567'; await delay(100);
  check(old.closed && button(a), '仅更换身份后入口消失'); old.done('旧帖结果'); await delay(20); check(!result(a), '旧身份结果写入新帖');
  button(a).click(); await delay(40); check(ports.length === 2, '新帖子未能请求翻译');
});
test('后退恢复浏览器缓存页面时重新挂载入口且不恢复旧请求', async () => {
  const [a] = await reset(); button(a).click(); await delay(40); const old = ports[0];
  dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  check(old.closed && !entry(a), '进入缓存未清理');
  dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await delay(100);
  check(button(a) && a.querySelectorAll('[data-opentransai-x-entry]').length === 1, '缓存恢复缺少入口');
  old.done('旧页面结果'); await delay(20); check(!result(a), '恢复页面接受了旧请求');
  instance = OpenTransAIPage.createXTranslation();
});
test('繁体显示原文先恢复源文，未知原生状态不会误翻译', async () => {
  const a = post({ native: false }); const native = document.createElement('button'); native.dataset.testid = 'translateTweet'; native.textContent = '顯示原文'; body(a).before(native); body(a).textContent = 'X 翻译结果';
  native.addEventListener('click', () => { native.textContent = '顯示翻譯'; body(a).textContent = 'Genuine original'; });
  await reset([a]); button(a).click(); await delay(260);
  check(ports.length === 1 && ports[0].request.text === 'Genuine original', '繁体原生状态把译文当原文');
  const b = post(); b.querySelector('[data-testid=translateTweet]').textContent = 'Unknown native state'; await reset([b]); button(b).click(); await delay(70);
  check(ports.length === 0 && !body(b).hidden && entry(b).shadowRoot.textContent.includes('原文'), '未知原生状态仍发送了正文');
});
test('真实 X 的 aria-label 控件与内部文字样式、role link 引用帖适配', async () => {
  const a = post(), control = a.querySelector('[data-testid=translateTweet]');
  control.removeAttribute('data-testid'); control.setAttribute('aria-label', '显示翻译'); control.style.color = 'rgb(83,100,113)';
  control.innerHTML = '<span style="color:rgb(29,155,240);font:13px/16px system-ui">显示翻译</span>';
  const quote = post({ quote: true, id: '700', text: 'Real quote shape' }); quote.removeAttribute('data-testid'); quote.setAttribute('role', 'link'); a.append(quote);
  await reset([a]);
  check(getComputedStyle(button(a)).color === 'rgb(29, 155, 240)' && getComputedStyle(button(a)).lineHeight === '16px', '没有继承实际可见按钮文字的样式');
  button(quote).click(); await delay(60); check(ports.length === 1 && ports[0].request.text === 'Real quote shape', '真实引用帖边界未识别');
});
test('卸载恢复正文并清理全部 UI，扩展失效后不再发请求', async () => {
  const [a] = await reset(); button(a).click(); await delay(40); ports[0].done(); await delay(40); instance.dispose();
  check(!body(a).hidden && !entry(a) && !result(a), '卸载残留界面');
  await reset(); delete api.runtime.id; button(posts.firstElementChild).click(); await delay(60);
  check(!entry(posts.firstElementChild) && ports.length === 0, '失效后仍挂载入口或发送请求'); api.runtime.id = 'x-fixture';
});
document.querySelector('#run').addEventListener('click', async () => {
  output.textContent = ''; output.dataset.complete = 'false'; let passed = 0;
  for (const item of tests) { try { await item.fn(); passed++; output.textContent += `PASS ${item.name}\n`; } catch (e) { output.textContent += `FAIL ${item.name}: ${e.message}\n`; } }
  output.textContent += `${passed}/${tests.length} passed; uncaught errors: ${errors.length}`; output.dataset.complete = 'true';
});
document.querySelector('#preview').addEventListener('click', async () => {
  const [a] = await reset([post({ text: 'Wechatの中国人の友達\n今6人 !!!!!!!!' }), post({ native: false, text: 'Good design makes everyday things feel simple.' })]);
  button(a)?.click(); await delay(60); ports.at(-1)?.done('微信上的中国朋友\n现在有 6 个人了！！！！！！');
});
document.querySelector('#theme').addEventListener('click', () => document.documentElement.classList.toggle('dark'));
await reset();
