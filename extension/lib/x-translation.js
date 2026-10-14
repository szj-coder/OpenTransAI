// X owns the original DOM. Keep its nodes intact and render only our own siblings.
(() => {
  const A = globalThis.OpenTransAIPage, E = globalThis.OpenTransAIErrors;
  if (!A || !E || A.createXTranslation) return;
  const HOSTS = ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'];
  const TEXT = '[data-testid="tweetText"]';
  const OWNER = 'article[data-testid="tweet"], [data-testid="quoteTweet"], [role="link"]';
  const OWN = '[data-opentransai-x-entry], [data-opentransai-x-result], [data-opentransai-x-style]';
  const originalLabel = /^(显示原文|查看原文|顯示原文|檢視原文|show original|原文を表示|原文を見る|원문 보기|mostrar original|voir l[’']original|afficher l[’']original|original anzeigen|mostrar original|mostra originale|показать оригинал)$/i;
  const translateLabel = /^(显示翻译|查看翻译|翻译帖子|翻译推文|翻譯貼文|顯示翻譯|show translation|translate (?:post|tweet)|翻訳を表示|ポストを翻訳|ツイートを翻訳|번역 보기|게시물 번역|traducir (?:post|publicación)|mostrar traducción|voir la traduction|traduire le post|übersetzung anzeigen|post übersetzen|mostrar tradução|traduzir post|mostra traduzione|показать перевод)$/i;
  const ownerOf = node => node?.parentElement?.closest(OWNER);
  const owned = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest(OWN);
  const label = node => {
    const labels = [node?.getAttribute('aria-label'), node?.textContent].filter(Boolean).map(text => text.trim());
    return labels.find(text => originalLabel.test(text) || translateLabel.test(text)) || labels[0] || '';
  };
  const textReference = node => [...node.querySelectorAll('*')].findLast(child => child.textContent.trim() && child.textContent.trim() === node.textContent.trim()) || node;
  const typography = ['font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch', 'font-variant', 'line-height', 'letter-spacing', 'text-transform', 'color'];
  const copyTypography = (target, source) => {
    const computed = getComputedStyle(source);
    for (const name of typography) target.style.setProperty(name, computed.getPropertyValue(name));
  };
  const nativeAction = node => node && !owned(node) && (originalLabel.test(label(node)) || translateLabel.test(label(node)) || node.getAttribute('data-testid') === 'translateTweet');
  function nativeFor(body) {
    const owner = ownerOf(body);
    if (!owner) return null;
    // Search the smallest shared ancestor, excluding controls belonging to a quote.
    for (let parent = body.parentElement; parent; parent = parent.parentElement) {
      const found = [...parent.querySelectorAll('button, [role="button"]')].find(node => ownerOf(node) === owner && nativeAction(node));
      if (found) return found;
      if (parent === owner) break;
    }
    return null;
  }
  function identity(body) {
    const owner = ownerOf(body);
    return [...(owner?.querySelectorAll('a[href*="/status/"]') || [])].find(link => ownerOf(link) === owner)?.getAttribute('href') || '';
  }
  function textOf(body) {
    const visit = node => {
      if (node.nodeType === 3) return node.nodeValue;
      if (node.nodeType !== 1 || owned(node)) return '';
      if (node.tagName === 'BR') return '\n';
      if (node.tagName === 'IMG') return node.getAttribute('alt') || '';
      if (node !== body && (node.hidden || node.getAttribute('aria-hidden') === 'true')) return '';
      return [...node.childNodes].map(visit).join('');
    };
    return visit(body).trim();
  }
  let instance, resumeFromHistory = false;
  A.listen(window, 'pageshow', event => {
    if (event.persisted && resumeFromHistory) { resumeFromHistory = false; A.createXTranslation(); }
  });
  A.createXTranslation = () => {
    if (instance || !A.alive()) return instance;
    let disposed = false, status = null, statusVersion = 0, timer = null, nativeReference = null, url = location.href;
    const records = new Map(), cache = new Map(), roots = new Set();
    const linkStyle = document.createElement('style'); linkStyle.dataset.opentransaiXStyle = '';
    linkStyle.textContent = '[data-opentransai-x-result] a[data-opentransai-x-mention]:hover,[data-opentransai-x-result] a[data-opentransai-x-mention]:focus-visible{text-decoration:underline!important}';
    (document.head || document.documentElement).append(linkStyle);
    const remember = (key, value) => { cache.delete(key); cache.set(key, value); if (cache.size > 100) cache.delete(cache.keys().next().value); };
    const alive = record => !disposed && A.alive() && records.get(record.body) === record && record.owner.isConnected && identity(record.body) === record.identity;
    function restore(record) {
      record.result?.remove(); record.result = null; record.mentionLinks = [];
      if (record.savedDisplay) {
        const { value, priority, hidden } = record.savedDisplay;
        if (record.body.style.getPropertyValue('display') === 'none' && record.body.style.getPropertyPriority('display') === 'important') {
          if (value) record.body.style.setProperty('display', value, priority); else record.body.style.removeProperty('display');
        }
        record.body.hidden = hidden; record.savedDisplay = null;
      }
    }
    function cancel(record) {
      record.version++; record.busy = false;
      clearInterval(record.heartbeat); clearInterval(record.watchdog);
      const port = record.port; record.port = null;
      if (port) { try { port.disconnect(); } catch (error) { A.runtimeError(error); } }
      const requestId = record.requestId; record.requestId = null;
      if (requestId && A.alive()) void A.send('CANCEL', { scope: 'x-post', taskId: record.taskId, requestId }).catch(() => {});
    }
    function restoreRow(record) {
      if (record.row) {
        for (const [name, value, priority] of record.row.saved) {
          // Only restore properties still carrying the value installed by us.
          if (record.row.node.style.getPropertyValue(name) === record.row.applied[name]) {
            if (value) record.row.node.style.setProperty(name, value, priority); else record.row.node.style.removeProperty(name);
          }
        }
        record.row = null;
      }
    }
    function remove(record) {
      cancel(record); restore(record); record.host.remove();
      record.owner.removeEventListener('click', record.onNative, true);
      restoreRow(record);
      records.delete(record.body);
    }
    function render(record) {
      record.button.textContent = record.busy ? 'OpenTransAI 翻译中…' : record.result ? 'OpenTransAI · 显示原文' : record.error ? 'OpenTransAI · 重试翻译' : '使用 OpenTransAI 翻译';
      record.button.disabled = record.busy;
      record.button.setAttribute('aria-busy', String(record.busy));
      record.button.setAttribute('aria-pressed', String(Boolean(record.result)));
      record.notice.textContent = record.error || '';
      record.settings.hidden = !record.needsSettings;
      record.host.hidden = !status?.enabled;
    }
    function fail(record, error) {
      if (!alive(record)) return;
      cancel(record); restore(record);
      if (!alive(record)) return;
      const safe = E.normalizeError(error);
      record.error = error?.code === 'X_ORIGINAL' ? '未能取得帖子原文，请先点击 X 的“显示原文”后重试。' : safe.message;
      record.needsSettings = E.errorRecovery(safe.code, 'text').settings;
      render(record);
    }
    function appendTranslation(record, result, translation) {
      const mentions = new Map();
      for (const source of record.body.querySelectorAll('a[href]')) {
        const handle = source.textContent.trim();
        if (!/^@[A-Za-z0-9_]{1,15}$/.test(handle)) continue;
        try {
          const url = new URL(source.href);
          if (url.protocol === 'https:' && HOSTS.includes(url.hostname) && url.pathname.replace(/\/$/, '').toLowerCase() === '/' + handle.slice(1).toLowerCase()) mentions.set(handle.toLowerCase(), source);
        } catch { /* Only reuse actual X profile links found in this body. */ }
      }
      let offset = 0;
      for (const match of translation.matchAll(/@[A-Za-z0-9_]+/g)) {
        const source = mentions.get(match[0].toLowerCase());
        if (!source || /[A-Za-z0-9_@]/.test(translation[match.index - 1] || '')) continue;
        result.append(document.createTextNode(translation.slice(offset, match.index)));
        const link = document.createElement('a'); link.dataset.opentransaiXMention = ''; link.href = source.href;
        link.textContent = match[0]; link.dir = source.dir || 'auto';
        if (source.target === '_blank') { link.target = '_blank'; link.rel = 'noopener noreferrer'; }
        copyTypography(link, textReference(source)); link.style.textDecoration = 'none'; link.style.cursor = 'pointer';
        result.append(link); record.mentionLinks.push({ link, source }); offset = match.index + match[0].length;
      }
      result.append(document.createTextNode(translation.slice(offset)));
    }
    function show(record, translation) {
      restore(record);
      const result = document.createElement('div'); result.id = `opentransai-x-result-${record.taskId}`; result.dataset.opentransaiXResult = '';
      result.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;';
      copyTypography(result, record.body);
      result.dir = 'auto'; result.setAttribute('role', 'status'); appendTranslation(record, result, translation);
      result.addEventListener('click', event => event.stopPropagation());
      record.body.after(result); record.result = result;
      record.savedDisplay = { value: record.body.style.getPropertyValue('display'), priority: record.body.style.getPropertyPriority('display'), hidden: record.body.hidden };
      record.body.hidden = true; record.body.style.setProperty('display', 'none', 'important');
      render(record);
    }
    function place(record) {
      const native = nativeFor(record.body), parent = native?.parentElement;
      const compactRow = parent && !parent.contains(record.body) && parent.querySelectorAll('button,[role="button"]').length <= 3 && !parent.querySelector(`${TEXT},time`);
      if (record.row && (!compactRow || record.row.node !== parent)) restoreRow(record);
      if (native) {
        if (native.nextElementSibling !== record.host) native.after(record.host);
        if (compactRow && !record.row) {
          const applied = { display: 'flex', 'flex-direction': 'row', 'flex-wrap': 'wrap', 'align-items': 'center' };
          record.row = { node: parent, applied, saved: Object.keys(applied).map(name => [name, parent.style.getPropertyValue(name), parent.style.getPropertyPriority(name)]) };
          for (const [name, value] of Object.entries(applied)) parent.style.setProperty(name, value);
        }
        record.host.style.marginInlineStart = '8px';
      } else {
        if (record.host.nextElementSibling !== record.body) record.body.before(record.host);
        record.host.style.marginInlineStart = '0';
      }
      // X sets the actionable label color on nested spans, not on the gray button.
      const reference = native || nativeReference;
      copyTypography(record.host, reference ? textReference(reference) : record.body);
      if (!reference) {
        record.host.style.fontSize = '13px'; record.host.style.lineHeight = '16px'; record.host.style.fontWeight = '400'; record.host.style.color = '#1d9bf0';
      }
      if (record.result) {
        copyTypography(record.result, record.body);
        for (const { link, source } of record.mentionLinks) copyTypography(link, textReference(source));
      }
    }
    async function original(record, version) {
      let native = nativeFor(record.body);
      if (!native || translateLabel.test(label(native))) return textOf(record.body);
      // A known translation control with an unknown state is not proof of original text.
      if (!originalLabel.test(label(native))) throw { code: 'X_ORIGINAL' };
      const before = textOf(record.body), beforeLang = record.body.lang;
      record.acquiring = true;
      try {
        native.click();
        const deadline = Date.now() + 5000;
        let previous = null;
        while (Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 50));
          if (disposed || !A.alive() || record.version !== version || !record.owner.isConnected) throw { code: 'CANCELLED' };
          if (!record.body.isConnected) {
            const next = [...record.owner.querySelectorAll(TEXT)].find(node => ownerOf(node) === record.owner && identity(node) === record.identity);
            if (!next) continue;
            records.delete(record.body); record.body = next; records.set(next, record);
          }
          if (identity(record.body) !== record.identity) throw { code: 'CANCELLED' };
          native = nativeFor(record.body);
          const text = textOf(record.body);
          if (native && !originalLabel.test(label(native)) && text && (text !== before || record.body.lang !== beforeLang)) {
            if (previous === text) { record.snapshot = text; return text; }
            previous = text;
          } else previous = null;
        }
        throw { code: 'X_ORIGINAL' };
      } finally { record.acquiring = false; schedule(record.owner); }
    }
    async function toggle(record) {
      if (!alive(record) || record.busy) return;
      if (record.result) { restore(record); render(record); return; }
      cancel(record); const version = record.version;
      const valid = () => alive(record) && version === record.version;
      record.busy = true; record.error = ''; record.needsSettings = false; render(record);
      try {
        const current = await refreshStatus();
        if (!valid()) return;
        if (!current?.enabled) throw { code: 'DISABLED' };
        if (!current.configured) throw { code: 'CONFIG' };
        const text = await original(record, version);
        if (!valid()) return;
        if (!text) throw { code: 'FORMAT' };
        if (text.length > 12000) throw { code: 'LIMIT' };
        record.snapshot = text;
        const key = JSON.stringify([record.identity, text, current.defaultLanguage, current.configRevision]);
        if (cache.has(key)) { const value = cache.get(key); remember(key, value); record.busy = false; show(record, value); return; }
        const stream = A.connect({ name: 'translation' }); record.port = stream;
        record.requestId = A.uid(); const requestId = record.requestId;
        let finished = false, activity = Date.now();
        stream.onMessage.addListener(message => {
          if (!valid() || finished || message.requestId !== requestId) return;
          activity = Date.now();
          if (message.type === 'DONE') {
            finished = true;
            if (typeof message.data?.translation !== 'string' || !message.data.translation.trim()) { fail(record, { code: 'FORMAT' }); return; }
            const translation = message.data.translation;
            cancel(record); remember(key, translation); show(record, translation);
          } else if (message.type === 'ERROR') { finished = true; fail(record, E.fromResponse(message)); }
        });
        stream.onDisconnect.addListener(() => {
          try { if (chrome.runtime?.lastError) A.runtimeError(chrome.runtime.lastError); } catch (error) { A.runtimeError(error); }
          if (valid() && !finished) fail(record, { code: 'CONNECTION' });
        });
        stream.postMessage({ type: 'TRANSLATE', scope: 'x-post', taskId: record.taskId, requestId, text, configRevision: current.configRevision, sourceKind: 'text' });
        if (!valid()) return;
        record.heartbeat = setInterval(() => { if (valid()) { try { stream.postMessage({ type: 'PING' }); } catch (error) { fail(record, A.runtimeError(error)); } } }, 20000);
        record.watchdog = setInterval(() => { if (valid() && Date.now() - activity >= 60000) fail(record, { code: 'TIMEOUT' }); }, 1000);
      } catch (error) { if (valid()) fail(record, error); }
    }
    function create(body) {
      const owner = ownerOf(body);
      if (!owner || !textOf(body) || owned(body)) return;
      // Native show-original may replace the body before the awaiting task rebinds it.
      if ([...records.values()].some(record => record.acquiring && record.owner === owner && record.identity === identity(body))) return;
      const taskId = A.uid(), host = document.createElement('span'); host.id = `opentransai-x-entry-${taskId}`; host.dataset.opentransaiXEntry = '';
      host.style.cssText = 'display:inline-flex;vertical-align:baseline;max-width:100%;';
      const shadow = host.attachShadow({ mode: 'open' }), style = document.createElement('style');
      style.textContent = '*{box-sizing:border-box}span{display:inline-flex;align-items:baseline;gap:4px 8px;flex-wrap:wrap;max-width:100%;font:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit}button{font:inherit;line-height:inherit;color:inherit;letter-spacing:inherit;text-transform:inherit;background:transparent;border:0;padding:0;margin:0;cursor:pointer;text-align:start}button:hover{text-decoration:underline}button:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:2px}button:disabled{cursor:wait;opacity:.65;text-decoration:none}[hidden]{display:none!important}.notice{color:inherit;opacity:.8;font-size:12px}';
      const line = document.createElement('span'), button = document.createElement('button'), notice = document.createElement('span'), settings = document.createElement('button');
      button.type = settings.type = 'button'; notice.className = 'notice'; notice.setAttribute('role', 'status'); settings.textContent = '打开设置'; settings.hidden = true;
      line.append(button, notice, settings); shadow.append(style, line);
      const record = { body, owner, identity: identity(body), taskId, host, button, notice, settings, snapshot: textOf(body), version: 0, busy: false };
      for (const type of ['click', 'pointerdown', 'mouseup', 'keydown']) host.addEventListener(type, event => event.stopPropagation());
      button.addEventListener('click', () => void toggle(record));
      settings.addEventListener('click', () => { if (alive(record)) void A.send('OPEN_SETTINGS').catch(error => fail(record, error)); });
      record.onNative = event => {
        const target = event.target?.closest?.('button,[role="button"]');
        if (!record.acquiring && target && target === nativeFor(record.body)) { cancel(record); restore(record); record.error = ''; record.needsSettings = false; render(record); }
      };
      owner.addEventListener('click', record.onNative, true); records.set(body, record); place(record); render(record);
    }
    function reconcile() {
      timer = null;
      if (disposed || !A.alive()) return;
      nativeReference = [...document.querySelectorAll('button,[role="button"]')].find(node => ownerOf(node) && nativeAction(node)) || null;
      if (location.href !== url) { url = location.href; for (const record of [...records.values()]) remove(record); roots.add(document); }
      for (const record of [...records.values()]) {
        if (record.acquiring && record.owner.isConnected) continue;
        if (!record.body.isConnected || !record.owner.isConnected || ownerOf(record.body) !== record.owner || identity(record.body) !== record.identity || !status?.enabled) { if (record.body.isConnected) roots.add(record.body); remove(record); continue; }
        const text = textOf(record.body);
        if (text !== record.snapshot) { cancel(record); restore(record); record.snapshot = text; record.error = ''; record.needsSettings = false; render(record); }
        if (!text) { remove(record); continue; }
        place(record);
      }
      const pending = [...roots]; roots.clear();
      if (!status?.enabled) return;
      for (const root of pending) {
        if (root !== document && !root.isConnected) continue;
        const bodies = [...(root.querySelectorAll?.(TEXT) || [])]; if (root.matches?.(TEXT)) bodies.unshift(root);
        for (const body of bodies) if (!records.has(body)) create(body);
      }
    }
    function schedule(root = document) {
      if (disposed) return;
      roots.add(root);
      if (timer === null) timer = setTimeout(reconcile, 40);
    }
    function applyStatus(next) {
      const changed = status && (status.configRevision !== next.configRevision || status.defaultLanguage !== next.defaultLanguage || status.enabled !== next.enabled);
      status = next;
      if (changed) { cache.clear(); for (const record of [...records.values()]) remove(record); }
      schedule();
      return status;
    }
    async function refreshStatus() {
      const version = ++statusVersion;
      const next = await A.send('STATUS');
      if (disposed) return null;
      return version === statusVersion ? applyStatus(next) : status;
    }
    const observer = new MutationObserver(changes => {
      for (const change of changes) {
        if (owned(change.target)) continue;
        if (change.type === 'childList' && [...change.addedNodes, ...change.removedNodes].every(node => owned(node))) continue;
        schedule(change.target.nodeType === 1 ? change.target : change.target.parentElement);
      }
    });
    observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['lang', 'href', 'data-testid'] });
    const themeObserver = new MutationObserver(() => schedule());
    for (const node of [document.documentElement, document.body]) if (node) themeObserver.observe(node, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    const receive = message => { if (!disposed && A.alive() && message.type === 'STATUS_CHANGED') { statusVersion++; applyStatus(message.data); } };
    const focus = () => { if (!disposed && A.alive()) void refreshStatus().catch(() => {}); };
    const navigate = () => schedule();
    const visibility = () => { if (!document.hidden) focus(); };
    const pagehide = event => { dispose(); resumeFromHistory = event.persisted && A.alive(); };
    function dispose() {
      resumeFromHistory = false;
      if (disposed) return; disposed = true; statusVersion++;
      observer.disconnect(); themeObserver.disconnect(); clearTimeout(timer);
      for (const record of [...records.values()]) remove(record);
      linkStyle.remove();
      cache.clear(); roots.clear();
      try { chrome.runtime.onMessage.removeListener(receive); } catch { /* Runtime may already be gone. */ }
      window.removeEventListener('focus', focus); window.removeEventListener('popstate', navigate); window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', visibility); instance = null;
    }
    instance = { dispose }; A.onInvalidated(dispose);
    try { chrome.runtime.onMessage.addListener(receive); } catch (error) { A.runtimeError(error); dispose(); return instance; }
    window.addEventListener('focus', focus); window.addEventListener('popstate', navigate); window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', visibility);
    void refreshStatus().catch(() => {});
    return instance;
  };
  if (window === window.top && location.protocol === 'https:' && HOSTS.includes(location.hostname)) A.createXTranslation();
})();
