(() => {
  if (globalThis.__openTransAILoaded) return;
  globalThis.__openTransAILoaded = true;

  const host = document.createElement('div');
  host.id = 'opentransai-root';
  host.hidden = true;
  host.setAttribute('popover', 'manual');
  host.style.cssText = 'all:initial!important;position:fixed!important;inset:auto!important;margin:0!important;border:0!important;padding:0!important;background:transparent!important;overflow:visible!important;z-index:2147483647!important;color-scheme:light dark!important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host{font:14px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif;color-scheme:light dark}
    *{box-sizing:border-box}[hidden]{display:none!important}
    .surface{--text:light-dark(#202735,#e6eaf2);--muted:light-dark(#637087,#b0bbce);--line:light-dark(#edf0f5,#343c4b);--bg:light-dark(#fff,#222834);font:14px/1.5 system-ui,-apple-system,"PingFang SC",sans-serif;font-weight:430;color:var(--text);text-align:left;direction:ltr;letter-spacing:normal;word-spacing:normal;text-transform:none}
    button{display:inline-flex;align-items:center;justify-content:center;gap:5px;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:6px;min-height:28px;padding:4px 7px;white-space:nowrap}
    button:hover{background:light-dark(#edf0f7,#343c4c)}button:focus-visible,summary:focus-visible{outline:2px solid light-dark(#576add,#a7b6ff);outline-offset:2px}button:disabled{cursor:wait;opacity:.5}
    .trigger{width:26px;height:26px;min-height:26px;padding:0;border:1px solid #d6e0f0;border-radius:6px;background:linear-gradient(140deg,#fff,#eef3ff);box-shadow:0 1px 3px #42578b14;overflow:hidden}.trigger:hover{background:linear-gradient(140deg,#f9fbff,#e2ebff);border-color:#b9cbea}.trigger img{display:block;width:24px;height:24px}.brand img{width:18px;height:18px;flex:none}
    .panel{display:flex;flex-direction:column;width:min(440px,calc(var(--viewport-width,100vw) - 24px));max-height:var(--panel-max-height,70vh);border:1px solid light-dark(#dfe3ed,#3a4252);border-radius:10px;background:var(--bg);box-shadow:0 6px 20px light-dark(#233a5712,#00000033);overflow:hidden;overscroll-behavior:contain}
    .head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid var(--line);flex-wrap:wrap;flex:none}.brand{display:flex;align-items:center;gap:5px;font-weight:500;margin-right:3px}.lang{display:flex;align-items:center;gap:5px;color:light-dark(#606b7e,#b7c1d2);font-size:12px}.target{display:inline-flex;align-items:center;min-height:28px;background:light-dark(#f3f5f9,#303848);border-radius:5px;padding:0 6px}.close{margin-left:auto;width:28px;font-size:20px;line-height:1;padding:4px}
    .content{display:flex;flex-direction:column;padding:10px 12px 8px;min-height:0;overflow:hidden}.original{flex:none;margin:0 0 9px;padding:0 0 9px;border-bottom:1px solid var(--line)}.original summary{cursor:pointer;color:var(--muted);font-size:12px;list-style:none;display:flex;align-items:center;gap:4px}.original summary::-webkit-details-marker{display:none}.original summary::before{content:'›';font-size:16px;line-height:12px;transform:rotate(0)}.original[open] summary::before{transform:rotate(90deg)}.original p{color:light-dark(#687286,#adb7c9);font-size:12px;line-height:1.6;margin:4px 0 0;max-height:min(144px,var(--source-max-height,144px));white-space:pre-wrap;overflow-wrap:anywhere}.original p,.translation-scroll{overflow:auto;overscroll-behavior:contain;scrollbar-width:none}.original p::-webkit-scrollbar,.translation-scroll::-webkit-scrollbar{display:none;width:0;height:0}.translation-scroll{min-height:0;flex:0 1 auto;outline-offset:-2px}.count{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--muted)}
    .translation{font-size:14px;line-height:1.7;margin:0;min-height:48px;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text}.translation:empty::after{content:' ';display:inline-block;width:7px;height:7px;margin:8px 0;border-radius:50%;background:var(--muted);animation:pulse 1s ease-in-out infinite}.translation.streaming:not(:empty)::after{content:' ';display:inline-block;width:5px;height:13px;margin-left:3px;border-radius:2px;background:var(--muted);vertical-align:-2px;animation:pulse 1s ease-in-out infinite}.chunk{animation:appear 180ms ease-out both}
    .bottom{display:flex;align-items:center;gap:6px;padding:5px 8px 7px;color:var(--muted);font-size:12px;flex-wrap:wrap;flex:none}.status{margin-right:auto;padding-left:4px}.copy{color:light-dark(#485fbc,#b1c1ff);background:light-dark(#f0f3ff,#323c59)}.action-icon{font-size:14px;line-height:1}.error{font-size:12px;color:light-dark(#b43434,#ffaaaa);line-height:1.6;overflow-wrap:anywhere;margin:8px 0 0}.copy-note{font-size:12px;color:var(--muted);margin:8px 0 0}
    .activity{padding:4px 0 6px}.activity-heading{display:flex;align-items:center;gap:8px;font-size:13px}.activity-label{font-weight:500}.activity-time{margin-left:auto;color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}.activity-hint{margin:6px 0 0;color:var(--muted);font-size:12px;line-height:1.6}
    @keyframes appear{from{opacity:.2}to{opacity:1}}@keyframes pulse{50%{opacity:.3}}
    @media(max-width:400px){.head{gap:4px}.brand{font-size:12px}}@media(pointer:coarse){button{min-height:44px}.close{width:44px}.original summary{min-height:44px}}
    @media(prefers-reduced-motion:reduce){*,*::after{animation:none!important;transition:none!important}}
  `;
  const surface = document.createElement('div');
  surface.className = 'surface';
  shadow.append(style, surface);
  let snapshot = null;
  let revision = 0;
  let requestId = null;
  let streamPort = null;
  let heartbeat = null;
  let activityTimer = null;
  let mode = 'hidden';
  let pendingSelection = null;
  let focusBefore = null;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, className, action, handler) {
    const node = element('button', className, label);
    node.type = 'button';
    node.dataset.action = action;
    node.addEventListener('click', handler);
    return node;
  }
  async function send(type, payload = {}) {
    let response;
    try { response = await chrome.runtime.sendMessage({ type, ...payload }); }
    catch { throw new Error('扩展已更新或连接断开，请刷新网页后重试。'); }
    if (!response?.ok) throw new Error(response?.error || '翻译失败，请重试。');
    return response.data;
  }
  function cancel() {
    clearInterval(heartbeat);
    clearInterval(activityTimer);
    if (streamPort) { const port = streamPort; streamPort = null; port.disconnect(); }
    requestId = null;
  }
  function hide(restoreFocus = false) {
    revision++;
    cancel();
    clearTimeout(pendingSelection);
    mode = 'hidden';
    surface.replaceChildren();
    host.hidden = true;
    // `all: initial` on the host overrides the UA [hidden] style.
    host.style.setProperty('display', 'none', 'important');
    if (host.matches(':popover-open')) host.hidePopover();
    if (restoreFocus && focusBefore?.isConnected) focusBefore.focus({ preventScroll: true });
  }
  function position() {
    if (!snapshot || mode === 'hidden') return;
    const viewport = window.visualViewport;
    const viewportWidth = Math.min(document.documentElement.clientWidth || innerWidth, viewport?.width || innerWidth);
    const viewportHeight = viewport?.height || innerHeight;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const maxHeight = Math.floor(viewportHeight * .7);
    host.style.setProperty('--viewport-width', `${viewportWidth}px`);
    host.style.setProperty('--panel-max-height', `${maxHeight}px`);
    const panel = surface.querySelector('.panel');
    if (panel) {
      // Reserve fixed chrome and give the source at most 40% of the remaining
      // reading space, keeping the translation usable on short viewports too.
      const fixedHeight = panel.querySelector('.head').getBoundingClientRect().height
        + panel.querySelector('.bottom').getBoundingClientRect().height
        + panel.querySelector('summary').getBoundingClientRect().height + 43;
      host.style.setProperty('--source-max-height', `${Math.max(0, (maxHeight - fixedHeight) * .4)}px`);
    }
    const width = host.getBoundingClientRect().width;
    const height = host.getBoundingClientRect().height;
    const x = Math.max(left + 8, Math.min(snapshot.x + 8, left + viewportWidth - width - 8));
    const below = snapshot.bottom + 10;
    const above = snapshot.top - height - 10;
    const preferredY = below + height <= top + viewportHeight - 8 ? below : above;
    const y = Math.max(top + 8, Math.min(preferredY, top + viewportHeight - height - 8));
    host.style.setProperty('left', `${x}px`, 'important');
    host.style.setProperty('top', `${y}px`, 'important');
  }
  function mount(node) {
    if (!host.isConnected) document.documentElement.append(host);
    surface.replaceChildren(node);
    host.hidden = false;
    host.style.setProperty('display', 'block', 'important');
    if (host.showPopover && !host.matches(':popover-open')) host.showPopover();
    position();
  }
  function brandIcon() {
    const icon = element('img');
    icon.src = chrome.runtime.getURL('icons/ai-translate-light.svg');
    icon.alt = '';
    return icon;
  }
  function showButton() {
    mode = 'button';
    const trigger = button('', 'trigger', 'translate', () => void start());
    trigger.setAttribute('aria-label', '翻译选中文字');
    trigger.title = '翻译选中文字';
    trigger.append(brandIcon());
    mount(trigger);
  }
  function label(code) {
    if (code === 'zh-CN') return '简体中文';
    if (code === 'zh-TW') return '繁體中文';
    try { return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(code); } catch { return code; }
  }
  function showPanel() {
    mode = 'loading';
    const panel = element('section', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'OpenTransAI 翻译结果');
    panel.setAttribute('aria-busy', 'true');
    const head = element('div', 'head');
    const brand = element('span', 'brand');
    brand.append(brandIcon(), element('span', '', 'AI 翻译'));
    const direction = element('div', 'lang');
    const source = element('span', '', '自动识别');
    const target = element('span', 'target', label(snapshot.defaultLanguage || 'zh-CN'));
    direction.append(source, element('span', '', '→'), target);
    const close = button('×', 'close', 'close', () => hide(true));
    close.setAttribute('aria-label', '关闭翻译框');
    close.title = '关闭 · Esc';
    head.append(brand, direction, close);
    const body = element('div', 'content');
    const original = element('details', 'original');
    const summary = element('summary', '', '原文');
    const count = element('span', 'count', `${Array.from(snapshot.text).length} 字`);
    count.title = '字符数（含空格和换行）';
    summary.append(count);
    const originalText = element('p', '', snapshot.text);
    originalText.setAttribute('dir', 'auto');
    originalText.tabIndex = 0;
    originalText.setAttribute('aria-label', '原文内容');
    original.append(summary, originalText);
    original.addEventListener('toggle', position);
    const translated = element('div', 'translation-scroll');
    translated.tabIndex = 0;
    translated.setAttribute('role', 'region');
    translated.setAttribute('aria-label', '译文内容');
    const activity = element('div', 'activity');
    const activityHeading = element('div', 'activity-heading');
    const activityLabel = element('span', 'activity-label', '正在连接 AI 服务');
    const elapsed = element('span', 'activity-time', '已用时 0 秒');
    elapsed.setAttribute('aria-hidden', 'true');
    const startedAt = performance.now();
    activityTimer = setInterval(() => { elapsed.textContent = `已用时 ${Math.floor((performance.now() - startedAt) / 1000)} 秒`; }, 1000);
    activityHeading.append(activityLabel, elapsed);
    const activityHint = element('p', 'activity-hint', '正在准备翻译请求。');
    activity.append(activityHeading, activityHint);
    const result = element('p', 'translation streaming');
    result.hidden = true;
    result.dataset.result = '';
    result.setAttribute('dir', 'auto');
    // Announce completion via the status, rather than every token.
    const error = element('p', 'error');
    error.hidden = true;
    error.setAttribute('role', 'alert');
    translated.append(activity, result, error);
    body.append(original, translated);
    const bottom = element('div', 'bottom');
    const status = element('span', 'status', '正在连接…');
    status.setAttribute('role', 'status');
    const retry = button('重译', 'retry', 'retry', () => void start());
    retry.prepend(element('span', 'action-icon', '↻'));
    retry.disabled = true;
    let translation = '';
    const copy = button('复制', 'copy', 'copy', async () => {
      try { await copyText(translation); status.textContent = '已复制'; }
      catch {
        status.textContent = '复制失败';
        if (!translated.querySelector('.copy-note')) translated.append(element('p', 'copy-note', '可选中译文后按 Ctrl / ⌘ + C 复制。'));
      }
    });
    copy.prepend(element('span', 'action-icon', '⧉'));
    copy.disabled = true;
    bottom.append(status, retry, copy);
    panel.append(head, body, bottom);
    mount(panel);
    const update = data => {
      const nearBottom = translated.scrollHeight - translated.scrollTop - translated.clientHeight < 36;
      activity.hidden = true; clearInterval(activityTimer); result.hidden = false;
      status.textContent = '正在生成译文…';
      source.textContent = label(data.sourceLanguage);
      target.textContent = label(data.targetLanguage);
      result.lang = data.targetLanguage;
      const previous = translation;
      translation = data.translation;
      if (translation.startsWith(previous)) {
        const delta = translation.slice(previous.length);
        if (delta) {
          const chunk = element('span', 'chunk', delta);
          result.append(chunk);
          const settle = () => { if (chunk.isConnected) { chunk.replaceWith(document.createTextNode(delta)); result.normalize(); } };
          chunk.addEventListener('animationend', settle, { once: true });
          if (matchMedia('(prefers-reduced-motion: reduce)').matches) settle();
        }
      } else result.textContent = translation;
      position();
      if (nearBottom) translated.scrollTop = translated.scrollHeight;
    };
    const phaseLabels = {
      waiting: ['等待模型响应', '请求已发出，正在等待 AI 服务返回。'],
      thinking: ['模型正在思考', '模型正在分析原文，准备译文。'],
      translating: ['正在生成译文', '已开始接收回答，译文即将显示。'],
    };
    let phaseIndex = -1;
    return { close, update,
      phase(value) {
        if (translation || !Object.hasOwn(phaseLabels, value)) return;
        const index = Object.keys(phaseLabels).indexOf(value);
        if (index <= phaseIndex) return;
        phaseIndex = index;
        [activityLabel.textContent, activityHint.textContent] = phaseLabels[value];
        activity.dataset.phase = value;
        status.textContent = activityLabel.textContent;
      },
      complete(data) {
        update(data); mode = 'result'; result.classList.remove('streaming');
        panel.setAttribute('aria-busy', 'false'); status.textContent = 'AI 译文';
        copy.disabled = false; retry.disabled = false;
      },
      fail(message) {
        activity.hidden = true; clearInterval(activityTimer);
        mode = 'error'; panel.setAttribute('aria-busy', 'false'); result.classList.remove('streaming');
        if (!translation) result.hidden = true;
        error.textContent = message; error.hidden = false;
        status.textContent = translation ? '译文未完成' : '翻译失败';
        retry.disabled = false; copy.disabled = true;
      },
    };
  }
  async function copyText(text) {
    // Clipboard API needs HTTPS. execCommand is the fallback on ordinary HTTP pages.
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(text); return; } catch { /* Fall through. */ }
    }
    const input = element('textarea');
    input.value = text;
    input.style.cssText = 'position:fixed;opacity:0;left:0;top:0;width:1px;height:1px;';
    surface.append(input);
    input.focus(); input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('Copy failed');
  }
  function start() {
    if (!snapshot || mode === 'loading') return;
    cancel();
    const version = ++revision;
    const text = snapshot.text;
    focusBefore = document.activeElement === host ? focusBefore : document.activeElement;
    const view = showPanel();
    view.close.focus({ preventScroll: true });
    if (text.length > 12000) { view.fail('一次最多翻译 12000 个字符，请缩小选区。'); return; }
    requestId = `${Date.now()}-${version}`;
    const id = requestId;
    let finished = false;
    try {
      const port = chrome.runtime.connect({ name: 'translation' });
      streamPort = port;
      const current = () => version === revision && !host.hidden && !finished;
      port.onMessage.addListener(message => {
        if (!current() || message.requestId !== id) return;
        if (message.type === 'PHASE') view.phase(message.phase);
        else if (message.type === 'PROGRESS') view.update(message.data);
        else if (message.type === 'DONE' || message.type === 'ERROR') {
          finished = true; requestId = null; clearInterval(heartbeat);
          if (message.type === 'DONE') view.complete(message.data);
          else view.fail(message.error || '翻译失败，请重试。');
          if (streamPort === port) streamPort = null;
          port.disconnect();
        }
      });
      port.onDisconnect.addListener(() => {
        if (current()) { finished = true; requestId = null; clearInterval(heartbeat); view.fail('翻译连接中断，请刷新网页后重试。'); }
        if (streamPort === port) streamPort = null;
      });
      port.postMessage({ type: 'TRANSLATE', text, requestId: id });
      // Port traffic keeps an active MV3 worker alive during long generations.
      heartbeat = setInterval(() => { try { port.postMessage({ type: 'PING' }); } catch { cancel(); } }, 20000);
    } catch { cancel(); view.fail('扩展已更新或连接断开，请刷新网页后重试。'); }
  }
  function capture(event) {
    const target = event.composedPath()[0];
    if (target instanceof HTMLInputElement && !['text', 'search', 'url', 'tel', 'email'].includes(target.type)) return null;
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      const { selectionStart: from, selectionEnd: to } = target;
      if (from === null || to === null || from === to) return null;
      const text = target.value.slice(from, to).trim();
      if (!text) return null;
      return { text, x: event.clientX, top: event.clientY - 12, bottom: event.clientY + 5 };
    }
    const selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    const rects = [...selection.getRangeAt(0).getClientRects()];
    const rect = rects.find(rect => event.clientY >= rect.top && event.clientY <= rect.bottom) || rects.at(-1);
    if (!rect) return null;
    return { text, x: event.clientX || rect.left, top: rect.top, bottom: rect.bottom };
  }
  document.addEventListener('mouseup', event => {
    if (event.button !== 0 || event.composedPath().includes(host)) return;
    clearTimeout(pendingSelection);
    const next = capture(event);
    if (!next) { if (mode === 'button') hide(); return; }
    hide();
    snapshot = next;
    focusBefore = document.activeElement;
    const version = revision;
    pendingSelection = setTimeout(async () => {
      try {
        const status = await send('STATUS');
        if (version === revision && status.enabled) { snapshot.defaultLanguage = status.defaultLanguage; showButton(); }
      } catch { if (version === revision) showButton(); }
    }, 40);
  });
  // Preserve the page selection when pressing the trigger, but allow selecting the result.
  shadow.addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
  document.addEventListener('mousedown', event => {
    if (!event.composedPath().includes(host)) hide();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mode !== 'hidden') { hide(true); }
  }, true);
  document.addEventListener('scroll', event => {
    if (event.composedPath().includes(host)) return;
    if (mode === 'button') hide();
  }, true);
  window.addEventListener('resize', () => { if (mode === 'button') hide(); else position(); });
  window.visualViewport?.addEventListener('resize', position);
  window.visualViewport?.addEventListener('scroll', position);
  // Error messages, source expansion and font reflow can also resize the card.
  new ResizeObserver(position).observe(host);
  window.addEventListener('pagehide', () => hide());
})();
