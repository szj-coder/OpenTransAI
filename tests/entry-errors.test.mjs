import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createService } from '../extension/lib/service.js';
globalThis.crypto ||= webcrypto;

const missing = () => { throw Error('Could not establish connection. Receiving end does not exist.'); };
const info = { menuItemId: 'image-translation', srcUrl: 'https://cdn.example/private.png?token=PRIVATE', frameId: 2 };
const tab = { id: 7, windowId: 1, active: true, url: 'https://page.example/private?token=PRIVATE' };
const viewer = { id: 'test', url: 'chrome-extension://test/diagnostics.html' };
const popup = { id: 'test', url: 'chrome-extension://test/popup.html?entryError=7' };
function fixture({ send = missing, inject, enabled = true, getTab, popupFails = false, storageFails = false } = {}) {
  const values = { settings: { enabled } }, session = {}, messages = [], injections = [], windows = [], popups = [], badges = [];
  let requests = 0;
  const storage = data => ({ setAccessLevel: async () => {}, get: async () => structuredClone(data), set: async value => { if (storageFails) throw Error('disk'); Object.assign(data, structuredClone(value)); }, remove: async key => { delete data[key]; } });
  const api = {
    runtime: { id: 'test', getURL: path => `chrome-extension://test/${path}` },
    storage: { local: storage(values), session: storage(session) },
    tabs: { sendMessage: async (id, message, options) => { messages.push({ id, message, options }); return send(message, options); }, get: async id => getTab ? getTab(id) : { ...tab, id } },
    scripting: { executeScript: async options => { injections.push(options); return inject ? inject(options) : [{ frameId: 0, result: true }]; } },
    windows: { create: async options => { windows.push(options); } },
    action: { setPopup: async options => { popups.push(options); }, setBadgeText: async options => { badges.push(options); }, setTitle: async () => {}, openPopup: async () => { if (popupFails) throw Error('not supported'); } },
  };
  const service = createService(api, { fetchImpl: async () => { requests++; throw Error('unexpected model request'); } });
  return { api, service, values, messages, injections, windows, popups, badges, get requests() { return requests; } };
}

test('HTTP page without a receiver gets an in-page error with a correlated safe diagnostic, never a settings window', async () => {
  const f = fixture();
  await f.service.contextClicked(info, tab);
  assert.equal(f.windows.length, 0);
  assert.equal(f.injections.length, 1);
  const [error, expectedUrl] = f.injections[0].args;
  assert.equal(expectedUrl, tab.url);
  assert.equal(error.code, 'PAGE_CONNECTION');
  assert.match(error.hint, /刷新/);
  const { entries } = await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].requestId, error.requestId);
  assert.equal(entries[0].reason, 'receiver_missing');
  assert.equal(entries[0].step, 'open_panel');
  assert.equal(entries[0].frameId, 2);
  assert.equal(entries[0].display, 'injected_dialog');
  assert.doesNotMatch(JSON.stringify({ entries, error }), /PRIVATE|private|https:|\.png/);
  assert.equal(f.requests, 0);
});

test('a live top frame shows a disabled error in the translation panel without injecting another dialog', async () => {
  const f = fixture({ enabled: false, send: message => message.type === 'ENTRY_ERROR' ? { ok: true } : missing() });
  await f.service.contextClicked(info, tab);
  const shown = f.messages.find(({ message }) => message.type === 'ENTRY_ERROR');
  assert.equal(shown.message.error.code, 'DISABLED');
  assert.equal(shown.options.frameId, 0);
  assert.equal(f.injections.length, 0); assert.equal(f.windows.length, 0);
  assert.equal((await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer)).entries[0].display, 'translation_panel');
});

test('a missing child frame still opens the image in the live top frame without reporting an error', async () => {
  const f = fixture({ send: message => message.type === 'CONTEXT_IMAGE' ? missing() : { ok: true } });
  await f.service.contextClicked(info, tab);
  assert(f.messages.some(({ message }) => message.type === 'OPEN_SOURCE'));
  assert.equal(f.injections.length, 0); assert.equal(f.windows.length, 0);
  assert.equal((await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer)).entries.length, 0);
});

test('browser denial keeps the original failure and its distinct display failure in a toolbar popup', async () => {
  const f = fixture({ inject: () => { throw Error('Cannot access contents of url "https://private/PRIVATE". Extension manifest must request permission to access this host.'); }, popupFails: true });
  await f.service.contextClicked(info, tab);
  assert.equal(f.windows.length, 0);
  assert(f.popups.some(value => value.tabId === 7 && value.popup.includes('entryError=7')));
  assert(f.badges.some(value => value.text === '!'));
  const restarted = createService(f.api);
  const { error } = await restarted.handle({ type: 'ENTRY_ERROR_GET', tabId: 7 }, popup);
  assert.equal(error.code, 'PAGE_CONNECTION');
  assert.equal(error.diagnostic.displayReason, 'site_access_denied');
  assert.equal(error.diagnostic.display, 'toolbar_badge');
  assert.doesNotMatch(JSON.stringify(error), /PRIVATE|https:/);
  await assert.rejects(restarted.handle({ type: 'ENTRY_ERROR_GET', tabId: 7 }, { id: 'test', tab, url: tab.url }), /权限/);
});

test('restricted pages get an accurate explanation without attempting page injection', async () => {
  const f = fixture({ getTab: () => ({ ...tab, url: 'chrome://settings/' }) });
  await f.service.contextClicked(info, { ...tab, url: 'chrome://settings/' });
  assert.equal(f.injections.length, 0);
  const { error } = await f.service.handle({ type: 'ENTRY_ERROR_GET', tabId: 7 }, popup);
  assert.equal(error.code, 'PAGE_RESTRICTED');
  assert.match(error.message, /浏览器|页面/);
  assert.equal(f.windows.length, 0);
});

test('navigation or a newer action suppresses stale failures instead of showing them in a new document', async () => {
  const f = fixture({ getTab: () => ({ ...tab, url: 'https://other.example/' }) });
  await f.service.contextClicked(info, tab);
  assert.equal(f.injections.length, 0); assert.equal(f.popups.some(value => value.popup.includes('entryError')), false);
  assert.equal((await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer)).entries[0].display, 'suppressed');
  let release;
  const g = fixture({ send: message => message.type === 'CONTEXT_IMAGE' ? new Promise((_resolve, reject) => { release = () => reject(Error('Receiving end does not exist.')); }) : missing() });
  const pending = g.service.contextClicked(info, tab);
  for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
  g.service.forgetTab(tab.id); release(); await pending;
  assert.equal(g.injections.length, 0); assert.equal(g.windows.length, 0);
});

test('known browser transport failures retain distinct reasons while unknown messages stay private', async () => {
  for (const [message, reason] of [
    ['The message port closed before a response was received.', 'message_closed'],
    ['No frame with id 0 in tab 7.', 'frame_missing'],
    ['No tab with id: 7.', 'tab_missing'],
    ['Extension context invalidated.', 'extension_context'],
    ['PRIVATE unknown browser failure', 'entry_failed'],
  ]) {
    const f = fixture({ send: () => { throw Error(message); } });
    await f.service.contextClicked(info, tab);
    const { entries } = await f.service.handle({ type: 'DIAGNOSTICS_GET' }, viewer);
    assert.equal(entries[0].reason, reason);
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE/);
  }
});

test('logging storage failure does not prevent showing the entry error', async () => {
  const f = fixture({ storageFails: true });
  await f.service.contextClicked({ menuItemId: 'capture-translation' }, tab);
  assert.equal(f.injections.length, 1);
  assert.equal(f.injections[0].args[0].diagnostic.step, 'begin_capture');
  assert.equal(f.windows.length, 0);
});

test('an empty top-frame reply is not mistaken for a successfully opened translation panel', async () => {
  const f = fixture({ send: message => message.type === 'OPEN_SOURCE' ? undefined : missing() });
  await f.service.contextClicked(info, tab);
  assert.equal(f.injections.length, 1);
  assert.equal(f.injections[0].args[0].diagnostic.reason, 'message_closed');
});

test('an unresponsive entry times out with a diagnostic instead of leaving the menu action pending forever', { timeout: 6000 }, async () => {
  const f = fixture({ send: message => message.type === 'BEGIN_CAPTURE' ? new Promise(() => {}) : missing() });
  await f.service.contextClicked({ menuItemId: 'capture-translation' }, tab);
  assert.equal(f.injections.length, 1);
  assert.equal(f.injections[0].args[0].diagnostic.reason, 'entry_timeout');
});

test('clearing a toolbar error restores settings and removes the cached error across worker restarts', async () => {
  const f = fixture({ inject: () => { throw Error('Cannot access contents of url'); } });
  await f.service.contextClicked(info, tab);
  await f.service.handle({ type: 'ENTRY_ERROR_CLEAR', tabId: 7 }, popup);
  assert.equal(f.popups.at(-1).popup, 'popup.html'); assert.equal(f.badges.at(-1).text, '');
  assert.equal((await createService(f.api).handle({ type: 'ENTRY_ERROR_GET', tabId: 7 }, popup)).error, null);
});

test('a timed-out image entry is not replayed as a second task when delivery is uncertain', { timeout: 6000 }, async () => {
  const f = fixture({ send: message => message.type === 'CONTEXT_IMAGE' ? new Promise(() => {}) : missing() });
  await f.service.contextClicked(info, tab);
  assert.equal(f.messages.some(({ message }) => message.type === 'OPEN_SOURCE'), false);
  assert.equal(f.injections[0].args[0].diagnostic.reason, 'entry_timeout');
  assert.equal(f.injections[0].args[0].diagnostic.step, 'context_image');
});

test('navigation during toolbar storage leaves neither a stale error nor a badge after cleanup', async () => {
  let release, stored;
  const f = fixture({ inject: () => { throw Error('Cannot access contents of url'); } });
  const set = f.api.storage.session.set;
  f.api.storage.session.set = async value => { stored = value; await new Promise(resolve => { release = resolve; }); await set(value); };
  const pending = f.service.contextClicked(info, tab);
  for (let i = 0; i < 80 && !release; i++) await Promise.resolve();
  assert(stored, 'toolbar storage was not reached');
  f.service.forgetTab(tab.id); release(); await pending;
  const cleared = await f.service.handle({ type: 'ENTRY_ERROR_GET', tabId: tab.id }, popup);
  assert.equal(cleared.error, null);
  assert.equal(f.popups.at(-1).popup, 'popup.html'); assert.equal(f.badges.at(-1).text, '');
});

test('a newer in-page failure replaces an older toolbar error for the same tab', async () => {
  let live = false;
  const f = fixture({ send: message => live && message.type === 'ENTRY_ERROR' ? { ok: true } : missing(), inject: () => { throw Error('Cannot access contents of url'); } });
  await f.service.contextClicked(info, tab);
  live = true; f.values.settings.enabled = false;
  await f.service.contextClicked(info, tab);
  assert.equal((await f.service.handle({ type: 'ENTRY_ERROR_GET', tabId: 7 }, popup)).error, null);
  assert.equal(f.popups.at(-1).popup, 'popup.html');
  assert.equal(f.messages.at(-1).message.error.code, 'DISABLED');
});
