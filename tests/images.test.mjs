import test from 'node:test';
import assert from 'node:assert/strict';
import { cropBounds, imageOrigin, readRemoteImage } from '../extension/lib/images.js';

test('screenshot crop uses actual bitmap / viewport ratios including noninteger DPI', () => {
  assert.deepEqual(cropBounds({ x: 10, y: 20, width: 100, height: 80 }, { width: 800, height: 600 }, { width: 1600, height: 1200 }), { x: 20, y: 40, width: 200, height: 160 });
  assert.deepEqual(cropBounds({ x: 1, y: 1, width: 10, height: 10 }, { width: 800, height: 600 }, { width: 1000, height: 750 }), { x: 1, y: 1, width: 13, height: 13 });
});
test('empty, negative, nonfinite and offscreen screenshot rectangles are rejected, tiny selections are valid', () => {
  const viewport = { width: 800, height: 600 }, bitmap = { width: 1600, height: 1200 };
  for (const rect of [{ x: 0, y: 0, width: 0, height: 1 }, { x: -1, y: 0, width: 2, height: 2 }, { x: 799, y: 0, width: 5, height: 1 }, { x: NaN, y: 0, width: 5, height: 1 }]) assert.throws(() => cropBounds(rect, viewport, bitmap), { code: 'CAPTURE_CHANGED' });
  assert.equal(cropBounds({ x: 0, y: 0, width: 1, height: 1 }, viewport, bitmap).width, 2);
});
test('image network reads restrict protocols and reject authentication URLs', () => {
  assert.equal(imageOrigin('https://cdn.example/a.png'), 'https://cdn.example/*');
  for (const url of ['file:///secret', 'chrome://settings', 'javascript:alert(1)', 'https://user:pass@site.example/a']) assert.throws(() => imageOrigin(url));
});
test('oversize remote image stops reading before decoder and never sends browser credentials', async () => {
  let init;
  await assert.rejects(readRemoteImage('https://cdn.example/a.png', { fetchImpl: async (_url, options) => { init = options; return new Response('', { headers: { 'content-type': 'image/png', 'content-length': '5000000' } }); } }), { code: 'LIMIT' });
  assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
});

test('capture pixels include scrollbar gutter while selections stay inside content viewport', () => {
  assert.deepEqual(cropBounds({ x: 50, y: 60, width: 100, height: 80 }, { width: 1250, height: 900, captureWidth: 1265, captureHeight: 900 }, { width: 2530, height: 1800 }), { x: 100, y: 120, width: 200, height: 160 });
});
