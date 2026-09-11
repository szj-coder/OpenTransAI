// Test-only Chrome boundary. None of this file is shipped in the extension.
const output = document.getElementById('results');
const roots = [];
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (options) { const root = attach.call(this, options); roots.push(root); return root; };
let requests = 0;
let enabled = true;
let latency = 80;
const eventChannel = () => { const listeners = []; return { addListener: fn => listeners.push(fn), fire: value => listeners.forEach(fn => fn(value)) }; };
const chromeMock = {
  runtime: {
    id: 'test-extension',
    getURL: path => '/extension/' + path,
    sendMessage: async message => {
      if (message.type === 'STATUS') return { ok: true, data: { enabled, configured: true, defaultLanguage: 'zh-CN' } };
    },
    connect() {
      let closed = false;
      const onMessage = eventChannel(), onDisconnect = eventChannel();
      return { onMessage, onDisconnect,
        disconnect() { if (!closed) { closed = true; onDisconnect.fire(); } },
        async postMessage(message) {
          if (message.type !== 'TRANSLATE') return;
          requests++;
          const time = latency;
          onMessage.fire({ type: 'PHASE', requestId: message.requestId, phase: 'waiting' });
          const chinese = message.text.includes('保持好奇');
          const data = { sourceLanguage: chinese ? 'zh-CN' : 'en', targetLanguage: chinese ? 'en' : 'zh-CN', translation: message.text.startsWith('LONG_CONTENT') ? '保持界面简洁，让每一次交互都能即时响应。\n'.repeat(100) : message.text.startsWith('<img') ? message.text : chinese ? 'Stay curious. Keep exploring.' : message.text.includes('gracefully') ? '设计能够优雅应对故障的系统。保持界面简洁，让每一次交互都能即时响应。' : '保持好奇，继续探索。' };
          if (message.text.includes('SIMULATE_THINKING')) {
            await new Promise(resolve => setTimeout(resolve, time / 4));
            if (closed) return;
            onMessage.fire({ type: 'PHASE', requestId: message.requestId, phase: 'thinking' });
            await new Promise(resolve => setTimeout(resolve, time / 4));
          } else await new Promise(resolve => setTimeout(resolve, time / 2));
          if (closed) return;
          if (['SIMULATE_ERROR', 'SIMULATE_THINKING_ERROR'].includes(message.text)) { onMessage.fire({ type: 'ERROR', requestId: message.requestId, error: '认证失败，请检查 API Key。' }); return; }
          onMessage.fire({ type: 'PHASE', requestId: message.requestId, phase: 'translating' });
          onMessage.fire({ type: 'PROGRESS', requestId: message.requestId, data: { ...data, translation: data.translation.slice(0, message.text.startsWith('LONG_CONTENT') ? Math.floor(data.translation.length / 2) : 4) } });
          await new Promise(resolve => setTimeout(resolve, time / 2));
          if (closed) return;
          if (message.text === 'SIMULATE_INTERRUPTION') { onDisconnect.fire(); return; }
          onMessage.fire({ type: 'DONE', requestId: message.requestId, data });
        },
      };
    },
  },
};
Object.defineProperty(window, 'chrome', { value: chromeMock, configurable: true });
const script = document.createElement('script'); script.src = '/extension/content.js'; document.body.append(script);
script.addEventListener('load', () => { output.textContent = '测试脚本已就绪'; });
script.addEventListener('error', () => { output.textContent = 'FAIL 内容脚本加载失败'; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function select(id) {
  const element = document.getElementById(id);
  const range = document.createRange(); range.selectNodeContents(element);
  getSelection().removeAllRanges(); getSelection().addRange(range);
  const rect = element.getBoundingClientRect();
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: rect.left + 120, clientY: rect.bottom - 5 }));
}
const root = () => roots.find(value => value.host.id === 'opentransai-root');
const assert = (condition, message) => { if (!condition) throw Error(message); };
const close = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const floating = () => root()?.querySelector('[data-action="translate"]');
const longText = 'LONG_CONTENT\n' + 'Design systems that fail gracefully. Keep the interface simple.\n'.repeat(80);
async function translateAt(text, x, y) {
  const input = document.createElement('textarea');
  input.value = text;
  input.style.cssText = 'position:fixed;left:8px;top:8px;width:100px;height:40px;opacity:0;';
  document.body.append(input); input.focus(); input.select();
  input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, clientX: x, clientY: y }));
  await delay(100); floating().click(); input.remove(); await delay(160);
}
function assertInViewport() {
  const rect = root().host.getBoundingClientRect();
  assert(rect.left >= 7 && rect.right <= document.documentElement.clientWidth - 7, '浮窗超出水平安全边距');
  assert(rect.top >= 7 && rect.bottom <= innerHeight - 7, '浮窗超出垂直安全边距');
  assert(rect.height <= innerHeight * .7 + 1, '浮窗高于视口的 70%');
}
document.getElementById('run-tests').addEventListener('click', async () => {
  const results = [];
  async function check(name, run) {
    try { close(); await run(); results.push(`PASS ${name}`); }
    catch (error) { results.push(`FAIL ${name}: ${error.message}`); }
    finally { latency = 80; enabled = true; }
    output.textContent = results.join('\n');
  }
  await check('只选中不发 AI 请求；点击一次才翻译', async () => {
    const before = requests; select('english'); await delay(120);
    assert(floating() && !floating().hidden, '未显示按钮'); assert(requests === before, '划词就发出了请求');
    floating().click(); await delay(160);
    assert(requests === before + 1, '没有点击后发出请求');
    assert(root().textContent.includes('保持好奇，继续探索。'), '译文未显示');
  });
  await check('划词按钮只有图标，翻译弹框各状态均没有设置或取消按钮', async () => {
    const validActions = () => {
      const actions = [...root().querySelectorAll('button')].map(button => button.dataset.action);
      assert(actions.every(action => ['close', 'retry', 'copy'].includes(action)), '出现额外操作按钮');
      assert(!root().querySelector('[data-action="settings"], [data-action="cancel"]'), '出现设置或取消按钮');
    };
    select('english'); await delay(100);
    assert(floating().textContent === '', '划词按钮出现文字');
    assert(floating().querySelector('img')?.src.endsWith('/icons/ai-translate-light.svg'), '未使用浅色图标');
    assert(floating().getBoundingClientRect().width === 26 && floating().getBoundingClientRect().height === 26, '划词按钮不是 26px 方形');
    assert(getComputedStyle(floating()).borderTopWidth === '1px', '缺少参考中的细边框');
    floating().click(); validActions(); await delay(160); validActions();
    select('error'); await delay(100); floating().click(); await delay(160); validActions();
  });
  await check('首段在完成前显示，原文默认折叠并显示字数，完成后可复制', async () => {
    latency = 600; select('english'); await delay(100); floating().click(); await delay(360);
    assert(root().querySelector('[data-result]').textContent === '保持好奇', '没有显示首段');
    assert(root().querySelector('.panel').getAttribute('aria-busy') === 'true', '提前标为完成');
    assert(root().querySelector('[data-action="copy"]').disabled, '未完成译文可复制');
    assert(!root().querySelector('details').open, '原文未默认折叠');
    assert(root().querySelector('summary').textContent.includes('29 字'), '未显示正确字数');
    await delay(300);
    assert(root().querySelector('[data-result]').textContent === '保持好奇，继续探索。', '未显示完整结果');
    assert(!root().querySelector('[data-action="copy"]').disabled, '完成后不可复制'); latency = 80;
  });
  await check('流中断保留部分内容并标记未完成', async () => {
    select('interrupted'); await delay(100); floating().click(); await delay(160);
    assert(root().querySelector('[data-result]').textContent.length > 0, '部分译文丢失');
    assert(root().textContent.includes('译文未完成'), '中断被当作成功');
    assert(root().querySelector('[data-action="copy"]').disabled, '中断结果可作为完整译文复制');
  });
  await check('等待和思考根据事件切换，显示用时，首段译文到达后收起提示', async () => {
    latency = 2400; select('thinking'); await delay(100); floating().click();
    await delay(120);
    assert(root().querySelector('.activity-label').textContent === '等待模型响应', '等待阶段不正确');
    assert(!root().textContent.includes('模型正在思考'), '尚未收到事件就显示思考');
    await delay(1000);
    assert(root().querySelector('.activity-label').textContent === '模型正在思考', '收到思考事件后无提示');
    assert(root().querySelector('.activity-time').textContent.includes('1 秒'), '没有更新等待用时');
    assert(root().querySelector('[data-result]').hidden, '思考阶段出现空白译文区域');
    assert(root().querySelector('[data-action="copy"]').disabled, '思考时复制可用');
    await delay(250);
    assert(root().querySelector('.activity').hidden && !root().querySelector('[data-result]').hidden, '首段到达后未切换为译文');
    await delay(1150);
    assert(root().querySelector('.status').textContent === 'AI 译文', '完成后仍显示思考');
  });
  await check('思考中关闭或失败清理用时及提示，旧事件不能重新弹出', async () => {
    latency = 600; select('thinking'); await delay(100); floating().click(); await delay(200);
    const timer = root().querySelector('.activity-time'); const previous = timer.textContent;
    close(); await delay(1100);
    assert(root().host.hidden && timer.textContent === previous, '关闭后仍更新用时或重新打开');
    select('thinking-error'); await delay(100); floating().click(); await delay(400);
    assert(root().querySelector('.activity').hidden, '失败后仍显示思考');
    assert(root().textContent.includes('认证失败') && !root().querySelector('[data-action="retry"]').disabled, '失败后无法重试');
  });
  await check('弹框边界不进入浏览器滚动条区域', async () => {
    select('reference'); await delay(100); floating().click(); await delay(160);
    const rect = root().host.getBoundingClientRect();
    assert(rect.left >= 0 && rect.right <= document.documentElement.clientWidth, '弹框右侧被滚动条遮挡');
    assert(rect.top >= 0 && rect.bottom <= innerHeight, '弹框超出视口');
    const panel = root().querySelector('.panel');
    assert(getComputedStyle(panel).borderRadius === '10px', '圆角与参考不一致');
  });
  await check('原文点击展开和折叠，浮窗随内容增长，默认宽约 440px', async () => {
    await translateAt('Hello 👋', innerWidth / 2, innerHeight / 2);
    const original = root().querySelector('.original');
    const panel = root().querySelector('.panel');
    const collapsedHeight = panel.getBoundingClientRect().height;
    assert(original.querySelector('summary').textContent.includes('7 字'), '字数把 emoji 拆成两个字符');
    assert(Math.abs(panel.getBoundingClientRect().width - Math.min(440, document.documentElement.clientWidth - 24)) < 1, '宽度不符合 440px / 窄屏自适应');
    original.querySelector('summary').click(); await delay(60);
    assert(original.open && panel.getBoundingClientRect().height > collapsedHeight, '展开原文未增长浮窗');
    original.querySelector('summary').click(); await delay(60);
    assert(!original.open && Math.abs(panel.getBoundingClientRect().height - collapsedHeight) < 1, '折叠后未恢复高度');
    assertInViewport();
  });
  await check('长原文和译文独立滚动且隐藏滚动条，语言栏和操作固定', async () => {
    await translateAt(longText, innerWidth - 10, innerHeight - 10);
    root().querySelector('summary').click(); await delay(80);
    const original = root().querySelector('.original p');
    const translated = root().querySelector('.translation-scroll');
    const body = root().querySelector('.content');
    const head = root().querySelector('.head').getBoundingClientRect();
    const bottom = root().querySelector('.bottom').getBoundingClientRect();
    assert(original.scrollHeight > original.clientHeight && original.clientHeight > 0, '长原文不能滚动');
    assert(translated && translated.scrollHeight > translated.clientHeight && translated.clientHeight > 0, '长译文不能独立滚动');
    assert(getComputedStyle(original).scrollbarWidth === 'none' && getComputedStyle(translated).scrollbarWidth === 'none', '滚动条没有隐藏');
    assert(getComputedStyle(body).overflowY === 'hidden' && body.scrollTop === 0, '外层内容区出现嵌套滚动');
    translated.scrollTop = 0; original.scrollTop = 50;
    assert(original.scrollTop === 50 && translated.scrollTop === 0, '滚动原文改变了译文');
    translated.scrollTop = 100;
    assert(translated.scrollTop === 100 && original.scrollTop === 50, '滚动译文改变了原文');
    assert(root().querySelector('.head').getBoundingClientRect().top === head.top, '顶部语言栏随内容移动');
    assert(root().querySelector('.bottom').getBoundingClientRect().bottom === bottom.bottom, '底部操作随内容移动');
    assert(root().querySelector('[data-action="copy"]').getBoundingClientRect().bottom <= bottom.bottom, '复制按钮不可见');
    assertInViewport();
  });
  await check('四角选区在流式增长及原文展开后仍完整处于视口', async () => {
    for (const [x, y] of [[10, 20], [innerWidth - 10, 20], [10, innerHeight - 10], [innerWidth - 10, innerHeight - 10]]) {
      close(); await translateAt(longText, x, y); assertInViewport();
      root().querySelector('summary').click(); await delay(60); assertInViewport();
    }
  });
  await check('流式追加不会打断原文或已向上滚动的译文阅读位置', async () => {
    latency = 1000;
    await translateAt(longText, innerWidth - 10, innerHeight - 10); await delay(400);
    root().querySelector('summary').click(); await delay(60);
    const original = root().querySelector('.original p');
    const translated = root().querySelector('.translation-scroll');
    assert(root().querySelector('.panel').getAttribute('aria-busy') === 'true', '测试未覆盖流式中途');
    assert(translated.scrollTop > 0, '跟随新片段未滚至底部');
    original.scrollTop = 40; translated.scrollTop = 30;
    await delay(500);
    assert(root().querySelector('.panel').getAttribute('aria-busy') === 'false', '翻译未完成');
    assert(original.scrollTop === 40 && translated.scrollTop === 30, '追加片段抢走了阅读位置');
  });
  await check('中文选区显示英语译文', async () => {
    select('chinese'); await delay(100); floating().click(); await delay(160);
    assert(root().querySelector('[data-result]').textContent === 'Stay curious. Keep exploring.', '译文方向错误');
  });
  await check('AI 返回的 HTML 作为文字显示', async () => {
    select('injection'); await delay(100); floating().click(); await delay(160);
    assert(root().querySelector('[data-result]').textContent.includes('<img'), '丢失原始文本');
    assert(!root().querySelector('[data-result] img'), '执行了 HTML');
  });
  await check('错误状态和重试按钮', async () => {
    select('error'); await delay(100); floating().click(); await delay(160);
    assert(root().textContent.includes('认证失败'), '无错误提示');
    assert(root().querySelector('[data-action="retry"]'), '无重试入口');
  });
  await check('关闭后旧请求不能重新弹出', async () => {
    latency = 180; select('english'); await delay(100); floating().click(); close(); await delay(230);
    assert(!root().host.matches(':popover-open') && root().host.hidden, '旧请求重新打开浮层'); latency = 80;
  });
  await check('新选区不会被旧译文覆盖', async () => {
    latency = 200; select('english'); await delay(100); floating().click();
    select('chinese'); await delay(100); floating().click(); await delay(260);
    assert(root().querySelector('[data-result]').textContent === 'Stay curious. Keep exploring.', '旧结果覆盖新结果'); latency = 80;
  });
  await check('关闭开关后选区不显示按钮', async () => {
    enabled = false; select('english'); await delay(120);
    assert(root().host.hidden, '关闭后仍显示'); enabled = true;
  });
  await check('密码框不显示按钮', async () => {
    const input = document.querySelector('input[type="password"]'); input.focus(); input.select();
    input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })); await delay(120);
    assert(root().host.hidden, '密码框显示按钮'); input.blur();
  });
  output.textContent += `\n\n${results.filter(x => x.startsWith('PASS')).length}/${results.length} 通过（本地测试响应）`;
});

document.getElementById('preview-stream').addEventListener('click', async () => {
  close(); latency = 6000; select('reference'); await delay(100); floating().click(); latency = 80;
});
document.getElementById('preview-long').addEventListener('click', async () => {
  close(); await translateAt(longText, innerWidth - 24, innerHeight - 24);
});
document.getElementById('preview-thinking').addEventListener('click', async () => {
  close(); latency = 20000; select('thinking'); await delay(100); floating().click(); latency = 80;
});
