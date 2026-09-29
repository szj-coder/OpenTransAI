import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const shared = await readFile(new URL('../extension/lib/page-shared.js', import.meta.url), 'utf8');
function fixture() {
  const runtime = { id: 'test', getURL: path => `chrome-extension://test/${path}`, sendMessage: async () => ({ ok: true, data: { enabled: true } }) };
  const context = vm.createContext({ chrome: { runtime } });
  vm.runInContext(shared, context);
  return { A: context.OpenTransAIPage, runtime, context };
}

for (const mode of ['missing-chrome', 'missing-runtime', 'missing-id', 'getURL-throws']) {
  test(`resource lookup safely retires ${mode} context exactly once`, () => {
    const { A, runtime, context } = fixture(); let retired = 0;
    assert.equal(A.getURL('icon.svg'), 'chrome-extension://test/icon.svg');
    A.onInvalidated(() => retired++);
    if (mode === 'missing-chrome') delete context.chrome;
    if (mode === 'missing-runtime') delete context.chrome.runtime;
    if (mode === 'missing-id') delete runtime.id;
    if (mode === 'getURL-throws') runtime.getURL = () => { throw Error('Extension context invalidated.'); };
    assert.equal(A.getURL('icon.svg'), ''); assert.equal(A.alive(), false);
    assert.equal(A.getURL('icon.svg'), ''); assert.equal(retired, 1);
    context.chrome = { runtime: { ...runtime, id: 'replacement' } };
    assert.equal(A.alive(), false, 'old script cannot reactivate against a different extension lifetime');
  });
}

for (const asyncFailure of [false, true]) {
  test(`sendMessage ${asyncFailure ? 'rejection' : 'throw'} invalidates context and blocks subsequent messages`, async () => {
    const { A, runtime } = fixture(); let calls = 0, retired = 0;
    A.onInvalidated(() => retired++);
    runtime.sendMessage = () => { calls++; const error = Error('Extension context invalidated.'); if (asyncFailure) return Promise.reject(error); throw error; };
    await assert.rejects(A.send('STATUS'), { code: 'EXTENSION_CONTEXT' });
    await assert.rejects(A.send('STATUS'), { code: 'EXTENSION_CONTEXT' });
    assert.equal(calls, 1); assert.equal(retired, 1);
  });
}

test('a successful but late service response is discarded after invalidation', async () => {
  const { A, runtime } = fixture(); let resolve;
  runtime.sendMessage = () => new Promise(done => { resolve = done; });
  const pending = A.send('STATUS'); delete runtime.id;
  resolve({ ok: true, data: { enabled: true } });
  await assert.rejects(pending, { code: 'EXTENSION_CONTEXT' });
});

test('ordinary transport failures and service errors retain retries and original service codes', async () => {
  const { A, runtime } = fixture();
  runtime.sendMessage = async () => { throw Error('Could not establish connection. Receiving end does not exist.'); };
  await assert.rejects(A.send('STATUS'), { code: 'CONNECTION' }); assert.equal(A.alive(), true);
  runtime.sendMessage = async () => ({ ok: false, code: 'AUTH', error: '配置错误' });
  await assert.rejects(A.send('STATUS'), { code: 'AUTH', message: '配置错误' }); assert.equal(A.alive(), true);
  runtime.sendMessage = async () => ({ ok: true, data: { enabled: true } });
  assert.equal((await A.send('STATUS')).enabled, true);
});
