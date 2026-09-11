import test from 'node:test';
import assert from 'node:assert/strict';

test('旧网页的一次性翻译请求提示刷新，不再悄悄走非流式通道', async () => {
  let listener; let reads = 0;
  globalThis.chrome = {
    runtime: { id: 'test-extension', getURL: path => `chrome-extension://test-extension/${path}`, onMessage: { addListener(fn) { listener = fn; } }, onConnect: { addListener() {} } },
    storage: { local: { setAccessLevel: async () => {}, get: async () => { reads++; return {}; } } },
  };
  try {
    await import('../extension/background.js');
    const reply = await new Promise(resolve => listener({ type: 'TRANSLATE', text: 'hello', requestId: 'legacy' }, { id: 'test-extension', tab: { id: 1 } }, resolve));
    assert.equal(reply.ok, false);
    assert.match(reply.error, /刷新/);
    assert.equal(reads, 0);
  } finally { delete globalThis.chrome; }
});
