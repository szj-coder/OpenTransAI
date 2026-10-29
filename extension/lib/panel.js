(() => {
  const A = globalThis.OpenTransAIPage;
  A.createPanel = actions => {
    const layer = A.layer('opentransai-root', `
      .panel{display:flex;flex-direction:column;width:min(440px,calc(var(--vw,100vw) - 24px));max-height:var(--mh,70vh);border:1px solid var(--line);border-radius:10px;background:var(--bg);box-shadow:0 6px 20px #233a5720;overflow:hidden;overscroll-behavior:contain}
      .panel.expanded{width:min(520px,calc(var(--vw,100vw) - 24px));height:var(--eh);max-height:var(--eh)}
      .head,.bottom{display:flex;align-items:center;gap:6px;flex:none;padding:7px 9px;flex-wrap:wrap}.head{border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:5px;white-space:nowrap;font-weight:500}.brand img{width:18px;height:18px}.lang{display:flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);min-width:0}.lang select{max-width:130px;min-height:28px;border:1px solid var(--line);background:var(--bg);padding:2px 4px}.expand{margin-left:auto}.close{font-size:20px;width:28px;line-height:1}
      .content{overflow:auto;overscroll-behavior:contain;min-height:0;padding:10px 12px;flex:1 1 auto;overflow-wrap:anywhere;scrollbar-width:thin;outline-offset:-3px}.original{margin-bottom:10px;padding-bottom:8px;border-bottom:1px solid var(--line)}summary{color:var(--muted);cursor:pointer;font-size:12px}.original-text{font-size:13px;color:var(--muted);margin:6px 0 0;white-space:pre-wrap;user-select:text}.translation{font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0;user-select:text}.translation:empty{display:none}.activity,.warning,.copy-note{font-size:12px;color:var(--muted);margin:8px 0}.error{font-size:13px;color:light-dark(#b43434,#ffaaaa);margin:8px 0}.error-actions{display:flex;gap:6px;flex-wrap:wrap}.error-actions button{border:1px solid var(--line)}.bottom{border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.status{margin-right:auto}.copy{background:light-dark(#f0f3ff,#323c59);color:light-dark(#485fbc,#b1c1ff)}.latest{font-size:12px;color:light-dark(#485fbc,#b1c1ff)}@media(max-width:400px){.head{gap:4px}.brand{font-size:12px}.lang select{max-width:95px}}`);
    layer.shadow.querySelector('style').textContent += `
      .image-formatted{white-space:normal}.image-formatted p{margin:0 0 10px;white-space:pre-wrap}.image-formatted h2,.image-formatted h3,.image-formatted h4{line-height:1.5;margin:14px 0 7px;font-weight:600}.image-formatted h2{font-size:17px}.image-formatted h3{font-size:15px}.image-formatted h4{font-size:14px}.image-formatted>:first-child{margin-top:0}.image-formatted>:last-child{margin-bottom:0}.image-formatted ul,.image-formatted ol{padding-inline-start:24px;margin:8px 0 12px}.image-formatted li{padding-inline-start:2px;margin:4px 0;white-space:pre-wrap}.image-formatted code{font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap}.image-formatted pre{background:light-dark(#f5f7fb,#1c2230);padding:10px;border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0}.image-table{max-width:100%;overflow-x:auto;margin:10px 0;outline-offset:-2px}.image-table table{width:100%;border-collapse:collapse;font-size:12px;line-height:1.6}.image-table th,.image-table td{border:1px solid var(--line);padding:6px 8px;text-align:start;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}.image-table th{font-weight:600;background:light-dark(#f4f6fb,#2d3545)}.image-table:focus-visible{outline:2px solid #6683e9}`;
    const panel = A.el('section', 'panel'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'AI 翻译');
    const head = A.el('div', 'head'), brand = A.el('span', 'brand'), icon = A.el('img'), iconUrl = A.getURL('icons/ai-translate-light.svg'); if (iconUrl) icon.src = iconUrl; icon.alt = ''; brand.append(icon, A.el('span', '', 'AI 翻译'));
    const lang = A.el('div', 'lang'), source = A.el('span'), target = A.el('select'); target.setAttribute('aria-label', '目标语言');
    for (const [value, text] of Object.entries(A.languages)) target.add(new Option(text, value));
    target.addEventListener('change', () => actions.language(target.value));
    // Let native select dismiss itself first; a subsequent Esc closes the panel.
    target.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); target.blur(); } });
    lang.append(source, A.el('span', '', '→'), target);
    const expand = A.button('展开', 'expand', () => {
      const scroll = body.scrollTop;
      if (!expanded) compactPosition = { ...position };
      expanded = !expanded; panel.classList.toggle('expanded', expanded); expand.textContent = expanded ? '收起' : '展开'; expand.setAttribute('aria-expanded', String(expanded));
      if (!expanded && compactPosition) position = { ...compactPosition };
      place(); body.scrollTop = scroll;
    });
    let pinned = false;
    const pin = A.button('固定', 'pin', () => {
      pinned = !pinned; updatePin();
    });
    const updatePin = () => {
      pin.textContent = pinned ? '已固定' : '固定';
      pin.setAttribute('aria-pressed', String(pinned));
      pin.setAttribute('aria-label', '固定翻译框');
      pin.title = pinned ? '已固定：点击网页保留结果，点击此处取消固定；Esc 仍可关闭' : '固定后点击网页也保留翻译结果';
    };
    updatePin();
    const close = A.button('×', 'close', actions.close); close.setAttribute('aria-label', '关闭翻译框'); close.title = '关闭 · Esc'; head.append(brand, lang, expand, pin, close);
    const body = A.el('div', 'content'); body.tabIndex = 0; body.setAttribute('aria-label', '原文与译文');
    const original = A.el('details', 'original'), summary = A.el('summary'), originalText = A.el('div', 'original-text'); originalText.dir = 'auto'; original.append(summary, originalText);
    const warning = A.el('p', 'warning'), activity = A.el('p', 'activity'), result = A.el('div', 'translation'); result.dataset.result = ''; result.dir = 'auto';
    const renderOriginal = A.createImageRenderer(originalText), renderResult = A.createImageRenderer(result);
    let copyText = '';
    const error = A.el('p', 'error'); error.setAttribute('role', 'alert');
    const entryHint = A.el('p', 'warning'), entryDetails = A.el('details', 'entry-details'), entrySummary = A.el('summary', '', '诊断详情'), entryText = A.el('pre', 'original-text');
    const entryCopy = A.button('复制诊断信息', 'copy-diagnostic', async () => {
      try { await navigator.clipboard.writeText(task.entryError.details); copyNote.textContent = '诊断信息已复制。'; }
      catch { entryDetails.open = true; const range = document.createRange(); range.selectNodeContents(entryText); const selection = layer.shadow.getSelection?.() || getSelection(); selection.removeAllRanges(); selection.addRange(range); copyNote.textContent = '请按 Ctrl/Cmd+C 复制已选中的诊断信息。'; }
      copyNote.hidden = false;
    });
    entryDetails.append(entrySummary, entryText, entryCopy);
    const errorActions = A.el('div', 'error-actions'), copyNote = A.el('p', 'copy-note');
    const settings = A.button('去设置', 'settings', actions.settings), capture = A.button('框选截图翻译', 'capture', actions.capture), access = A.button('授权读取图片', 'access', actions.access);
    errorActions.append(settings, access, capture); body.append(original, warning, activity, result, error, entryHint, entryDetails, errorActions, copyNote);
    const bottom = A.el('div', 'bottom'), status = A.el('span', 'status'); status.setAttribute('role', 'status');
    const latest = A.button('回到最新', 'latest', () => { following = true; body.scrollTop = body.scrollHeight; latest.hidden = true; }); latest.hidden = true;
    const retry = A.button('重译', 'retry', actions.retry), cancel = A.button('取消', 'cancel', actions.cancel);
    const copy = A.button('复制', 'copy', async () => {
      const text = copyText;
      if (!text) return;
      try {
        let copied = false;
        if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(text); copied = true; } catch { /* HTTP fallback below. */ } }
        if (!copied) {
          const input = A.el('textarea'); input.value = text; input.style.cssText = 'position:fixed;opacity:0;width:1px;height:1px;'; layer.surface.append(input); input.focus(); input.select();
          copied = document.execCommand('copy'); input.remove(); copy.focus({ preventScroll: true });
        }
        if (!copied) throw Error('copy');
        status.textContent = '已复制'; copyNote.hidden = true;
      } catch {
        const range = document.createRange(); range.selectNodeContents(result); const selection = layer.shadow.getSelection?.() || getSelection(); selection.removeAllRanges(); selection.addRange(range);
        copyNote.textContent = '复制失败，文本已选中，请按 Ctrl/Cmd+C。'; copyNote.hidden = false;
      }
    });
    bottom.append(status, latest, cancel, retry, copy); panel.append(head, body, bottom); layer.surface.append(panel);
    let task = null, renderedTranslation = '', expanded = false, position = null, compactPosition = null, following = true, programmatic = false;
    body.addEventListener('scroll', () => { if (!programmatic) following = body.scrollHeight - body.scrollTop - body.clientHeight < 36; latest.hidden = following || !task?.busy; });
    function place() {
      if (layer.host.hidden) return;
      const v = A.viewport(); layer.host.style.setProperty('--vw', `${v.width}px`); layer.host.style.setProperty('--mh', `${Math.min(v.height * .7, v.height - 24)}px`); layer.host.style.setProperty('--eh', `${v.height - 24}px`);
      const { width, height } = layer.host.getBoundingClientRect();
      if (expanded) { layer.move(v.left + v.width - width - 12, v.top + 12); return; }
      if (!position) {
        const a = task?.anchor, safe = p => p.x >= v.left + 12 && p.y >= v.top + 12 && p.x + width <= v.left + v.width - 12 && p.y + height <= v.top + v.height - 12;
        const candidates = a && task?.kind !== 'text' ? [{ x: a.right + 10, y: a.top }, { x: a.left - width - 10, y: a.top }, { x: a.left, y: a.bottom + 10 }, { x: a.left, y: a.top - height - 10 }]
          : a ? [{ x: a.left, y: a.bottom + 10 }, { x: a.left, y: a.top - height - 10 }] : [];
        position = candidates.find(safe) || candidates[0] || { x: v.left + v.width - width - 12, y: v.top + 12 };
      }
      position.x = Math.max(v.left + 12, Math.min(position.x, v.left + v.width - width - 12)); position.y = Math.max(v.top + 12, Math.min(position.y, v.top + v.height - height - 12)); layer.move(position.x, position.y);
    }
    const labels = { reading: '正在读取图片…', recognizing: '正在识别图片文字…', translating: '正在翻译…', waiting: '正在翻译…', switching: '正在切换语言…', ready: 'AI 译文', cancelled: '已取消 · 内容可能未完成', empty: '未识别到可翻译的文字', 'same-language': '图片文字已是目标语言', error: '暂时无法完成翻译' };
    function render(next) {
      const previousText = renderedTranslation; task = next;
      source.textContent = A.label(next.recognized?.sourceLanguage || next.sourceLanguage);
      target.value = next.explicitTarget || next.targetLanguage || next.defaultLanguage || 'zh-CN';
      const text = next.recognized?.text ?? (next.kind === 'text' ? next.source.text : undefined);
      const formatted = next.kind === 'image' || next.kind === 'screenshot';
      originalText.classList.toggle('image-formatted', formatted); result.classList.toggle('image-formatted', formatted);
      const originalVisible = formatted ? renderOriginal(text || '') : (originalText.textContent = text || '');
      original.hidden = text === undefined; summary.textContent = text === undefined ? '原文' : `原文 · ${Array.from(originalVisible).length} 字`;
      const warnings = next.recognized?.warnings || [];
      warning.textContent = warnings.map(w => w === 'ambiguous_text' ? '部分文字可能识别不准确。' : '表格已按行展示，列对应可能无法完整还原。').join(' '); warning.hidden = !warnings.length;
      activity.hidden = !next.busy; activity.textContent = (next.switching ? labels.switching : labels[next.state]) || labels.translating;
      if (next.slow) activity.textContent += ' 处理时间较长，你可以继续等待或取消。';
      renderedTranslation = next.translation || '';
      if (formatted) copyText = renderResult(renderedTranslation);
      else {
        copyText = renderedTranslation;
        if (renderedTranslation.startsWith(previousText)) { const delta = renderedTranslation.slice(previousText.length); if (delta) result.append(document.createTextNode(delta)); }
        else result.textContent = renderedTranslation;
      }
      result.lang = next.targetLanguage || '';
      error.textContent = next.error || (['empty', 'same-language'].includes(next.state) ? labels[next.state] : ''); error.hidden = !error.textContent;
      entryHint.textContent = next.entryError?.hint || ''; entryHint.hidden = !next.entryError;
      entryText.textContent = next.entryError?.details || ''; entryDetails.hidden = !next.entryError;
      lang.hidden = Boolean(next.entryError);
      status.textContent = next.switching ? labels.switching : labels[next.state] || labels.translating;
      if (next.state === 'error' && next.translation) status.textContent = '译文未完成';
      panel.setAttribute('aria-busy', String(next.busy));
      cancel.hidden = !next.busy; retry.hidden = next.busy || ['empty', 'same-language'].includes(next.state) || ['CONFIG', 'AUTH'].includes(next.code);
      retry.textContent = ['error', 'cancelled'].includes(next.state) ? '重试' : '重译';
      if (next.entryError) retry.hidden = true;
      copy.hidden = Boolean(next.entryError);
      copy.disabled = !next.translation; copy.textContent = next.state === 'same-language' ? '复制原文' : ['ready'].includes(next.state) ? '复制' : '复制已有内容';
      settings.hidden = !['CONFIG', 'AUTH', 'PERMISSION', 'UNSUPPORTED_IMAGE', 'DISABLED'].includes(next.code);
      capture.hidden = !(next.state === 'empty' || ['IMAGE_READ', 'IMAGE_PERMISSION', 'LIMIT', 'CAPTURE_CHANGED', 'CAPTURE_PERMISSION', 'CAPTURE_UNAVAILABLE'].includes(next.code));
      access.hidden = next.code !== 'IMAGE_PERMISSION';
      if (next.entryError) { capture.hidden = true; access.hidden = true; }
      errorActions.hidden = settings.hidden && capture.hidden && access.hidden;
      place();
      if (next.translation !== previousText && following) { programmatic = true; body.scrollTop = body.scrollHeight; queueMicrotask(() => { programmatic = false; }); }
      latest.hidden = following || !next.busy;
    }
    const observer = new ResizeObserver(place); observer.observe(layer.host);
    A.onInvalidated(() => observer.disconnect());
    A.listen(window, 'resize', place); A.listen(window.visualViewport, 'resize', place);
    return { layer,
      get pinned() { return pinned; },
      open(next) { task = null; pinned = false; updatePin(); renderedTranslation = ''; copyText = ''; renderOriginal(''); renderResult(''); originalText.textContent = ''; result.textContent = ''; position = null; expanded = false; following = true; original.open = false; panel.classList.remove('expanded'); expand.textContent = '展开'; copyNote.hidden = true; layer.show(); render(next); body.scrollTop = 0; close.focus({ preventScroll: true }); },
      render, notice(message) { copyNote.textContent = message; copyNote.hidden = false; }, focus() { close.focus({ preventScroll: true }); }, close() { layer.hide(); task = null; },
      pause(value) { if (value) layer.hide(); else if (task) { layer.show(); place(); } },
      resetScroll() { following = true; body.scrollTop = 0; }, contains(event) { return event.composedPath().includes(layer.host); },
    };
  };
})();
