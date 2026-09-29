// Test-only bridge: Chrome still routes through the real background service.
const bridge = parent.imageFixtureFrame;
Object.defineProperty(window, 'chrome', { value: bridge.api(2) });
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function(options) { const root = attach.call(this, options); bridge.roots.push(root); return root; };
const canvas = document.createElement('canvas'); canvas.width = 240; canvas.height = 120;
const ctx = canvas.getContext('2d'); ctx.fillStyle = '#edf2fa'; ctx.fillRect(0,0,240,120); ctx.fillStyle = '#203050'; ctx.font = '24px sans-serif'; ctx.fillText('Frame text',20,60);
const img = document.querySelector('img'); img.src = canvas.toDataURL(); await img.decode();
const manifest = await (await fetch('/extension/manifest.json')).json();
for (const path of manifest.content_scripts[0].js) await import('/extension/' + path);
document.body.append(Object.assign(document.createElement('span'), { id: 'ready' }));
