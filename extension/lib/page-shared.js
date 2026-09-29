(() => {
  if (globalThis.OpenTransAIPage) return;
  const A = globalThis.OpenTransAIPage = {};
  // Reloading/disabling the extension leaves already-injected page listeners alive.
  // Retire that lifetime once; never reconnect an old page script to a new worker.
  let retired = false;
  const cleanup = new Set();
  const contextError = () => Object.assign(new Error('扩展已更新或停用，请刷新网页后重试。'), { code: 'EXTENSION_CONTEXT' });
  const retire = () => {
    if (retired) return;
    retired = true;
    for (const dispose of cleanup) { try { dispose(); } catch { /* A dead runtime must not prevent remaining local cleanup. */ } }
    cleanup.clear();
  };
  A.alive = () => {
    if (retired) return false;
    try { if (globalThis.chrome?.runtime?.id) return true; } catch { /* Runtime access itself can fail during teardown. */ }
    retire(); return false;
  };
  A.onInvalidated = dispose => { if (retired) dispose(); else cleanup.add(dispose); };
  A.runtimeError = error => {
    if (/extension context invalidated/i.test(error?.message || '')) retire();
    return A.alive() ? Object.assign(new Error('扩展连接已断开，请重试。'), { code: 'CONNECTION' }) : contextError();
  };
  A.getURL = path => {
    if (!A.alive()) return '';
    try { return chrome.runtime.getURL(path); } catch (error) { A.runtimeError(error); return ''; }
  };
  A.connect = options => {
    if (!A.alive()) throw contextError();
    try { return chrome.runtime.connect(options); } catch (error) { throw A.runtimeError(error); }
  };
  A.listen = (target, type, listener, options) => {
    if (!target || !A.alive()) return;
    const guarded = event => { if (A.alive()) return listener(event); };
    target.addEventListener(type, guarded, options);
    A.onInvalidated(() => target.removeEventListener(type, guarded, options));
  };
  A.isExtensionNode = node => {
    // Event paths include Window, whose named `id` property can be an element;
    // form controls can likewise shadow their form's id property.
    const id = node?.id;
    return typeof id === 'string' && id.startsWith('opentransai-');
  };
  A.uid = () => crypto.randomUUID?.() || Array.from(crypto.getRandomValues(new Uint8Array(16)), n => n.toString(16).padStart(2, '0')).join('');
  A.languages = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English', ja: '日本語', ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español', pt: 'Português', it: 'Italiano', ru: 'Русский', ar: 'العربية', hi: 'हिन्दी', th: 'ไทย', vi: 'Tiếng Việt', id: 'Bahasa Indonesia' };
  A.label = code => {
    if (!code) return '自动检测';
    if (code === 'mul') return '多语言';
    if (code === 'und') return '未知语言';
    if (A.languages[code]) return A.languages[code];
    try { return new Intl.DisplayNames(['zh-CN'], { type: 'language' }).of(code); } catch { return code; }
  };
  A.el = (tag, className = '', text) => {
    const node = document.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  A.button = (text, action, handler) => {
    const button = A.el('button', action, text); button.type = 'button'; button.dataset.action = action;
    A.listen(button, 'click', handler); return button;
  };
  A.send = async (type, payload = {}) => {
    if (!A.alive()) throw contextError();
    let response;
    try { response = await chrome.runtime.sendMessage({ type, ...payload }); }
    catch (error) { throw A.runtimeError(error); }
    if (!A.alive()) throw contextError();
    if (!response?.ok) throw Object.assign(new Error(response?.error || '操作失败，请重试。'), { code: response?.code || 'SERVICE' });
    return response.data;
  };
  A.viewport = () => {
    const v = window.visualViewport;
    const captureWidth = (v?.width || innerWidth) + (v ? Math.max(0, innerWidth - document.documentElement.clientWidth) / (v.scale || 1) : 0);
    const captureHeight = (v?.height || innerHeight) + (v ? Math.max(0, innerHeight - document.documentElement.clientHeight) / (v.scale || 1) : 0);
    return { left: v?.offsetLeft || 0, top: v?.offsetTop || 0, width: Math.min(document.documentElement.clientWidth || innerWidth, v?.width || innerWidth), height: v?.height || innerHeight, scale: v?.scale || 1, captureWidth, captureHeight, scrollX, scrollY };
  };
  A.layer = (id, css) => {
    const host = A.el('div'); host.id = id; host.hidden = true; host.setAttribute('popover', 'manual');
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:auto!important;margin:0!important;padding:0!important;border:0!important;background:transparent!important;overflow:visible!important;z-index:2147483647!important;color-scheme:light dark!important;display:none!important;';
    const shadow = host.attachShadow({ mode: 'closed' }), style = A.el('style');
    style.textContent = `:host{color-scheme:light dark}*{box-sizing:border-box}[hidden]{display:none!important}.surface{--text:light-dark(#202735,#e6eaf2);--muted:light-dark(#637087,#b0bbce);--line:light-dark(#e5e9f1,#3a4252);--bg:light-dark(#fff,#222834);font:14px/1.6 system-ui,-apple-system,"PingFang SC",sans-serif;font-weight:400;color:var(--text);text-align:left;direction:ltr;letter-spacing:normal;word-spacing:normal;text-transform:none}button,select{font:inherit;color:inherit;cursor:pointer;border-radius:6px}button{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-height:28px;padding:4px 7px;border:0;background:transparent}button:hover{background:light-dark(#edf0f7,#343c4c)}button:disabled{opacity:.5;cursor:default}button:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid #6683e9;outline-offset:2px}@media(pointer:coarse){button{min-height:44px}}@media(prefers-reduced-motion:reduce){*,*::after{animation:none!important;transition:none!important}}` + css;
    const surface = A.el('div', 'surface'); shadow.append(style, surface);
    A.onInvalidated(() => { host.hidden = true; host.remove(); });
    return { host, shadow, surface,
      show() { if (!A.alive()) return; if (!host.isConnected) document.documentElement.append(host); host.hidden = false; host.style.setProperty('display', 'block', 'important'); if (host.showPopover && !host.matches(':popover-open')) host.showPopover(); },
      hide() { host.hidden = true; host.style.setProperty('display', 'none', 'important'); if (host.matches(':popover-open')) host.hidePopover(); },
      move(x, y) { host.style.setProperty('left', `${x}px`, 'important'); host.style.setProperty('top', `${y}px`, 'important'); },
    };
  };
  // Hash in the extension worker: crypto.subtle is unavailable on ordinary HTTP pages.
  A.digest = async image => (await A.send('IMAGE_DIGEST', { image })).digest;
  A.canvasImage = async canvas => {
    if (!canvas.width || !canvas.height || canvas.width > 8000 || canvas.height > 8000) throw Object.assign(new Error('图片过大，请缩小框选范围（单边最多 8000 像素）。'), { code: 'LIMIT' });
    const blob = type => new Promise((resolve, reject) => { try { canvas.toBlob(value => value ? resolve(value) : reject(Error('无法读取图片')), type, .92); } catch (e) { reject(e); } });
    let value = await blob('image/png');
    if (value.size > 4 * 1024 * 1024) value = await blob('image/jpeg');
    if (value.size > 4 * 1024 * 1024) throw Object.assign(new Error('图片超过 4MiB，请缩小框选范围。'), { code: 'LIMIT' });
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(value); });
    return { dataUrl, width: canvas.width, height: canvas.height };
  };
})();
