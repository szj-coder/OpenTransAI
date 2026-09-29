(() => {
  const A = globalThis.OpenTransAIPage;
  if (!A || A.createEntries) return;
  const box = rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom });
  const imageUrl = image => image.currentSrc || image.src || '';
  A.createEntries = ({ suspended = () => false, onError = () => {} } = {}) => {
    const layer = A.layer('opentransai-entry', `.surface{display:flex;align-items:center;justify-content:center}.surface button{padding:0;position:relative;flex:none;background:transparent;box-shadow:none}.surface .translate{width:26px;height:26px;min-height:26px;padding:0;border:1px solid #d6e0f0;border-radius:6px;background:linear-gradient(140deg,#fff,#eef3ff);box-shadow:0 1px 3px #42578b14;overflow:hidden}.surface .translate:hover{background:linear-gradient(140deg,#f9fbff,#e2ebff);border-color:#b9cbea}.translate img{display:block;width:24px;height:24px}`);
    const tokens = new WeakMap(), sources = new Map();
    let epoch = 0, owner = null, contextRef = null, textSnapshot = null;
    const tokenFor = image => {
      let token = tokens.get(image);
      if (!token) {
        token = A.uid(); tokens.set(image, token); sources.set(token, new WeakRef(image));
        if (sources.size > 128) for (const [key, ref] of sources) if (!ref.deref()) sources.delete(key);
      }
      return token;
    };
    const hide = () => {
      epoch++; owner = null; textSnapshot = null;
      if (!layer.host.hidden) layer.hide();
    };
    const entryTarget = target => layer.host === target || layer.host.contains?.(target);
    const textButton = A.button('', 'translate', event => {
      event.preventDefault(); event.stopPropagation();
      const snapshot = textSnapshot; hide();
      if (snapshot) void A.send('TASK_OPEN', { sourceKind: 'text', text: snapshot.text, anchor: snapshot.anchor }).catch(onError);
    });
    textButton.setAttribute('aria-label', 'OpenTransAI · 翻译选中文字'); textButton.title = 'OpenTransAI · 翻译选中文字';
    const brand = A.el('img'), iconUrl = A.getURL('icons/ai-translate-light.svg'); if (iconUrl) brand.src = iconUrl; brand.alt = ''; brand.setAttribute('aria-hidden', 'true');
    textButton.append(brand); layer.surface.append(textButton);
    A.onInvalidated(() => { hide(); sources.clear(); contextRef = null; });
    // Observe only the user's explicit right click. The browser's menu supplies
    // the authoritative URL when selected; opening a menu never reads pixels.
    A.listen(document, 'contextmenu', event => {
      const image = event.composedPath?.().find(node => node?.tagName === 'IMG') ||
        (event.target?.tagName === 'IMG' ? event.target : event.target?.closest?.('img'));
      contextRef = image ? new WeakRef(image) : null;
      hide();
    }, true);
    A.listen(document, 'pointerdown', event => { if (!entryTarget(event.target)) hide(); }, true);
    const scroll = event => {
      if (A.isExtensionNode(event?.target) || event?.composedPath?.().some(A.isExtensionNode)) return;
      hide();
    };
    A.listen(document, 'scroll', scroll, { capture: true, passive: true });
    A.listen(window, 'resize', scroll, { passive: true });
    A.listen(window.visualViewport, 'resize', scroll, { passive: true });
    A.listen(window.visualViewport, 'scroll', scroll, { passive: true });
    return {
      layer, hide,
      claim(token) { if (owner !== token) hide(); },
      async context(url) {
        if (!A.alive()) return;
        const image = contextRef?.deref();
        const source = image?.isConnected && imageUrl(image) === url
          ? { sourceKind: 'image', token: tokenFor(image), url, anchor: box(image.getBoundingClientRect()) }
          : { sourceKind: 'image', token: A.uid(), url, anchor: null };
        hide();
        await A.send('TASK_OPEN', source);
        return source;
      },
      async read(token, url) {
        const image = sources.get(token)?.deref();
        if (!image?.isConnected || !image.complete || !image.naturalWidth || !image.naturalHeight || imageUrl(image) !== url) return { needsFetch: true };
        if (image.naturalWidth > 8000 || image.naturalHeight > 8000) return { code: 'LIMIT', error: '图片过大，单边最多 8000 像素，请缩小范围。' };
        try {
          const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          return { image: await A.canvasImage(canvas) };
        } catch (error) {
          if (error?.name === 'SecurityError') return { needsFetch: true };
          return { code: error?.code === 'LIMIT' ? 'LIMIT' : 'READ', error: error?.code === 'LIMIT' ? '图片超过读取限制，请缩小范围。' : '无法读取这张图片，请重试或框选截图。' };
        }
      },
      async selection(snapshot) {
        hide(); if (!A.alive() || !snapshot?.text?.trim() || suspended()) return;
        const version = epoch;
        try {
          const status = await A.send('STATUS'); if (!status?.enabled || epoch !== version || suspended()) return;
          textSnapshot = { text: snapshot.text, anchor: { ...snapshot.anchor } };
          owner = A.uid(); const token = owner; const claim = await A.send('ENTRY_CLAIM', { token });
          if (claim?.suppressed) { hide(); return; }
          if (epoch !== version || owner !== token || suspended()) return;
          const viewport = A.viewport();
          const x = Math.max(viewport.left + 8, Math.min(snapshot.anchor.right, viewport.left + viewport.width - 40));
          const y = Math.max(viewport.top + 8, Math.min(snapshot.anchor.bottom + 8, viewport.top + viewport.height - 40));
          layer.move(x, y); layer.show();
        } catch { if (epoch === version) hide(); /* Passive selection never opens an error panel. */ }
      },
    };
  };
})();
