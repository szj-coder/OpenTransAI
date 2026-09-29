// Self-contained so Chrome can serialize this function into an isolated world
// even when the normal content scripts are absent or belong to an old lifetime.
export function showEntryDialog(error, expectedUrl, popup = false) {
  if (!popup && (!expectedUrl || location.href !== expectedUrl)) return false;
  globalThis.__openTransAIEntryDialogClose?.();
  const previousFocus = document.activeElement;
  const host = document.createElement('div'); host.id = 'opentransai-entry-error';
  host.style.cssText = popup ? 'display:block' : 'all:initial!important;position:fixed!important;inset:12px 12px auto auto!important;margin:0!important;padding:0!important;border:0!important;z-index:2147483647!important;background:transparent!important;width:min(440px,calc(100% - 24px))!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `:host{color-scheme:light dark}*{box-sizing:border-box}[hidden]{display:none!important}.panel{font:14px/1.6 system-ui,-apple-system,sans-serif;color:light-dark(#243146,#e1e8f4);background:light-dark(#fff,#18202d);border:1px solid light-dark(#dbe1ed,#46516a);border-radius:10px;box-shadow:0 6px 20px #233a5720;width:100%;max-height:calc(100vh - 24px);overflow:auto;overflow-wrap:anywhere}.head{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid light-dark(#dbe1ed,#46516a)}h2{font-size:14px;margin:0;font-weight:600}.body{padding:12px}.error{color:light-dark(#b43434,#ffaaaa);margin:0 0 8px}.hint{margin:0 0 12px}summary{cursor:pointer;font-size:12px;color:light-dark(#65728b,#a5b2c9)}pre{font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;user-select:text}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{font:inherit;font-size:12px;cursor:pointer;border:1px solid light-dark(#dbe1ed,#46516a);border-radius:6px;padding:5px 9px;color:inherit;background:light-dark(#f6f8fd,#263249)}button:focus-visible,summary:focus-visible{outline:2px solid #6683e9;outline-offset:2px}.close{font-size:20px;line-height:1;border:0;background:none}.notice{font-size:12px;margin:8px 0 0}`;
  shadow.append(style);
  const el = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const panel = el('section', 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'OpenTransAI 翻译异常');
  const head = el('div', 'head'), title = el('h2', '', 'OpenTransAI · 翻译异常'), close = el('button', 'close', '×'); close.type = 'button'; close.setAttribute('aria-label', '关闭翻译异常'); head.append(title, close);
  const body = el('div', 'body'), message = el('p', 'error', error.message), hint = el('p', 'hint', error.hint); message.setAttribute('role', 'alert');
  const details = el('details', ''), summary = el('summary', '', '诊断详情'), pre = el('pre', '', error.details); details.append(summary, pre);
  const actions = el('div', 'actions'), copy = el('button', '', '复制诊断信息'), note = el('p', 'notice'); copy.type = 'button'; note.setAttribute('role', 'status');
  const finish = () => { document.removeEventListener('keydown', escape, true); host.remove(); if (globalThis.__openTransAIEntryDialogClose === finish) delete globalThis.__openTransAIEntryDialogClose; if (previousFocus?.isConnected) previousFocus.focus?.({ preventScroll: true }); };
  const escape = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(); if (popup) window.close(); } };
  close.addEventListener('click', () => { finish(); if (popup) window.close(); });
  copy.addEventListener('click', async () => {
    try {
      if (!navigator.clipboard?.writeText) throw Error('clipboard unavailable');
      await navigator.clipboard.writeText(error.details); note.textContent = '诊断信息已复制。';
    } catch {
      details.open = true;
      const range = document.createRange(); range.selectNodeContents(pre);
      const selection = shadow.getSelection?.() || getSelection(); selection.removeAllRanges(); selection.addRange(range);
      note.textContent = '请按 Ctrl/Cmd+C 复制已选中的诊断信息。';
    }
  });
  actions.append(copy);
  body.append(message, hint, details, actions, note); panel.append(head, body); shadow.append(panel);
  if (popup) { const main = document.querySelector('main'); main.replaceChildren(host); }
  else { host.setAttribute('popover', 'manual'); document.documentElement.append(host); try { host.showPopover(); } catch { /* Fixed positioning also works without popover support. */ } }
  document.addEventListener('keydown', escape, true); globalThis.__openTransAIEntryDialogClose = finish;
  close.focus({ preventScroll: true });
  return true;
}
