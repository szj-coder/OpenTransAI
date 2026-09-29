(() => {
  const A = globalThis.OpenTransAIPage;
  A.createCapture = ({ onStart, onCancel, onImage, onAccess }) => {
    const layer = A.layer('opentransai-capture', '.shade{position:fixed;inset:0;background:#17253850;cursor:crosshair;touch-action:none;user-select:none}.instruction{position:fixed;top:12px;left:50%;transform:translateX(-50%);padding:8px 12px;border-radius:6px;background:var(--bg);font-size:13px;max-width:calc(100vw - 24px)}.box{position:fixed;border:2px solid #6884ed;background:#ffffff08;pointer-events:none}.controls{position:fixed;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 24px);padding:6px;border-radius:8px;background:var(--bg);box-shadow:0 3px 15px #0002}.controls button{border:1px solid var(--line)}.capture-error{max-width:260px;font-size:12px;color:light-dark(#a83232,#ffb5b5)}');
    const shade = A.el('div', 'shade'), instruction = A.el('div', 'instruction', '拖动选择当前可见区域，Esc 取消。超出视口的长图请打开完整图片后重试。'), box = A.el('div', 'box'), controls = A.el('div', 'controls'), size = A.el('span'), error = A.el('span', 'capture-error');
    let active = false, nonce = '', initial, start = null, rect = null, busy = false, viewportRevision = 0, initialRevision = 0;
    A.onInvalidated(() => { active = false; nonce = ''; busy = false; start = null; rect = null; layer.hide(); });
    const changed = event => { if (!event?.composedPath?.().some(A.isExtensionNode)) viewportRevision++; };
    A.listen(document, 'scroll', changed, { capture: true, passive: true });
    A.listen(window, 'resize', changed, { passive: true });
    A.listen(window.visualViewport, 'resize', changed, { passive: true });
    A.listen(window.visualViewport, 'scroll', changed, { passive: true });
    const translate = A.button('翻译', 'capture-confirm', async () => {
      if (!rect?.width || !rect.height || busy) return;
      if (!unchanged()) { error.textContent = '页面已滚动或缩放，请重新选择。'; return; }
      busy = true; const current = nonce; const selected = { ...rect };
      layer.hide();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      try {
        const data = await A.send('CAPTURE_REGION', { nonce: current, viewport: initial, rect: selected });
        if (!active || nonce !== current) return;
        active = false; busy = false; layer.hide(); onImage(data.image, { left: selected.x + initial.left, right: selected.x + selected.width + initial.left, top: selected.y + initial.top, bottom: selected.y + selected.height + initial.top });
      } catch (e) {
        if (!active || nonce !== current) return;
        busy = false; layer.show(); error.textContent = e.message;
        if (e.code === 'CAPTURE_PERMISSION') permission.hidden = false;
      }
    });
    const reselect = A.button('重新选择', 'capture-reselect', () => reset());
    const cancel = A.button('取消', 'capture-cancel', () => stop());
    const permission = A.button('授权截图', 'capture-permission', () => { stop(); onAccess(); }); permission.hidden = true;
    controls.append(size, translate, reselect, cancel, permission, error); layer.surface.append(shade, instruction, box, controls);
    const unchanged = () => initialRevision === viewportRevision && JSON.stringify(A.viewport()) === JSON.stringify(initial);
    function reset() { initialRevision = viewportRevision; initial = A.viewport(); start = null; rect = null; busy = false; error.textContent = ''; permission.hidden = true; box.hidden = true; controls.hidden = false; size.textContent = '拖动框选'; translate.disabled = true; positionControls(initial.left + 12, initial.top + initial.height - 64); }
    function positionControls(x, y) { controls.style.left = `${Math.max(initial.left + 12, Math.min(x, initial.left + initial.width - 340))}px`; controls.style.top = `${Math.max(initial.top + 12, Math.min(y, initial.top + initial.height - 90))}px`; }
    function stop() { if (!active) return; active = false; nonce = ''; layer.hide(); onCancel(); }
    shade.addEventListener('pointerdown', event => {
      if (busy || event.button !== 0) return; event.preventDefault(); event.stopPropagation();
      if (!unchanged()) reset();
      start = { x: Math.max(0, Math.min(initial.width, event.clientX - initial.left)), y: Math.max(0, Math.min(initial.height, event.clientY - initial.top)) }; shade.setPointerCapture?.(event.pointerId); controls.hidden = true; error.textContent = '';
    });
    shade.addEventListener('pointermove', event => {
      if (!start || busy) return;
      const x = Math.max(0, Math.min(initial.width, event.clientX - initial.left)), y = Math.max(0, Math.min(initial.height, event.clientY - initial.top));
      rect = { x: Math.min(start.x, x), y: Math.min(start.y, y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) };
      box.hidden = false; box.style.cssText = `left:${rect.x + initial.left}px;top:${rect.y + initial.top}px;width:${rect.width}px;height:${rect.height}px;`;
    });
    shade.addEventListener('pointerup', event => {
      if (!start || busy) return; shade.releasePointerCapture?.(event.pointerId); start = null; controls.hidden = false;
      translate.disabled = !rect?.width || !rect?.height; size.textContent = rect ? `${Math.round(rect.width)} × ${Math.round(rect.height)}` : '空选区';
      error.textContent = rect && (rect.width < 16 || rect.height < 16) ? '选区较小，建议扩大范围。' : '';
      positionControls((rect?.x || 0) + initial.left, (rect?.y || 0) + (rect?.height || 0) + initial.top + 8); translate.focus({ preventScroll: true });
    });
    A.listen(document, 'keydown', event => { if (active && event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stop(); } }, true);
    return { get active() { return active; }, async begin() { if (!A.alive() || active) return; active = true; nonce = A.uid(); try { await onStart(); } catch (error) { stop(); throw error; } if (!active || !A.alive()) return; reset(); layer.show(); cancel.focus({ preventScroll: true }); }, cancel: stop,
      verify(value) { return { valid: active && busy && nonce === value && unchanged(), viewport: A.viewport() }; },
    };
  };
})();
