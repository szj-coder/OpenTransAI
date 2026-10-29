import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../extension/lib/service.js';
import { DEFAULT_SETTINGS } from '../extension/lib/core.js';
import { webcrypto } from 'node:crypto';
globalThis.crypto ||= webcrypto;

const sender = { id: 'draft-test', url: 'chrome-extension://draft-test/popup.html' };
function fixture() {
  const local = { settings: { ...DEFAULT_SETTINGS, apiKey: 'saved-fixture-key' }, configurationRevision: 'initial' }, session = {};
  let allowed = true, writesFail = false, removalsFail = false, access;
  const api = {
    runtime: { id: sender.id, getURL: path => `chrome-extension://${sender.id}/${path}` },
    permissions: { contains: async () => allowed },
    storage: {
      local: { setAccessLevel: async () => {}, get: async () => structuredClone(local), set: async next => Object.assign(local, structuredClone(next)) },
      session: {
        setAccessLevel: async value => { access = value; }, get: async () => structuredClone(session),
        set: async next => { if (writesFail) throw Error('quota'); Object.assign(session, structuredClone(next)); },
        remove: async key => { if (removalsFail) throw Error('storage'); delete session[key]; },
      },
    },
  };
  const makeService = () => createService(api, { fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好' }) } }] })) });
  return { service: makeService(), makeService, local, session, access: () => access, deny: () => { allowed = false; }, failWrites: value => { writesFail = value; }, failRemoval: () => { removalsFail = true; } };
}
const draft = { provider: 'openai', baseUrl: 'https://unfinished.', model: '', apiKey: 'draft-fixture-key', defaultLanguage: 'pt' };
const saveDraft = (service, value = draft, configRevision = 'initial') => service.handle({ type: 'SETTINGS_DRAFT_SAVE', draft: value, configRevision }, sender);

test('incomplete draft survives worker recreation without changing active settings or exposing it to a page', async () => {
  const h = fixture(); await saveDraft(h.service);
  const edit = await h.makeService().handle({ type: 'SETTINGS_EDIT' }, sender);
  assert.deepEqual(edit.draft, draft); assert.equal(edit.configRevision, 'initial');
  assert.equal(edit.settings.apiKey, 'saved-fixture-key'); assert.equal(h.local.settings.defaultLanguage, 'zh-CN');
  assert.deepEqual(h.access(), { accessLevel: 'TRUSTED_CONTEXTS' });
  const page = { id: sender.id, tab: { id: 7 }, url: 'https://example.test' };
  for (const type of ['SETTINGS_EDIT', 'SETTINGS_DRAFT_SAVE']) await assert.rejects(h.service.handle({ type, draft, configRevision: 'initial' }, page), /权限/);
  assert.equal(JSON.stringify(await h.service.handle({ type: 'STATUS' }, page)).includes('fixture-key'), false);
});

test('test success and denied save retain the draft, while explicit save clears it', async () => {
  const h = fixture(); await saveDraft(h.service);
  const settings = { ...DEFAULT_SETTINGS, apiKey: 'new-fixture-key', defaultLanguage: 'pt' };
  await h.service.handle({ type: 'TEST', settings: { ...settings, defaultLanguage: 'zh-CN' } }, sender);
  assert.deepEqual((await h.service.handle({ type: 'SETTINGS_EDIT' }, sender)).draft, draft);
  await h.service.handle({ type: 'SETTINGS_SAVE', settings }, sender);
  assert.equal(h.local.settings.defaultLanguage, 'pt');
  assert.equal((await h.service.handle({ type: 'SETTINGS_EDIT' }, sender)).draft, null);
  assert.deepEqual(h.session, {});
  const blocked = fixture(); await saveDraft(blocked.service); blocked.deny();
  await assert.rejects(blocked.service.handle({ type: 'SETTINGS_SAVE', settings }, sender), /授权/);
  assert.deepEqual((await blocked.service.handle({ type: 'SETTINGS_EDIT' }, sender)).draft, draft);
});

test('draft writes preserve the latest input and toggling enabled cannot revive an old value', async () => {
  const h = fixture();
  await Promise.all([saveDraft(h.service, { ...draft, model: 'first' }), saveDraft(h.service, { ...draft, model: 'latest' })]);
  await h.service.handle({ type: 'SET_ENABLED', enabled: false }, sender);
  const edit = await h.service.handle({ type: 'SETTINGS_EDIT' }, sender);
  assert.equal(edit.draft.model, 'latest'); assert.equal(edit.settings.enabled, false);
  await saveDraft(h.service, null);
  assert.equal((await h.service.handle({ type: 'SETTINGS_EDIT' }, sender)).draft, null);
});

test('old draft writes cannot reappear after saving a new configuration', async () => {
  const h = fixture(); await saveDraft(h.service); h.failRemoval();
  await h.service.handle({ type: 'SETTINGS_SAVE', settings: { ...DEFAULT_SETTINGS, apiKey: 'new-fixture-key' } }, sender);
  await assert.rejects(saveDraft(h.service), /配置已变化/);
  assert.equal((await h.makeService().handle({ type: 'SETTINGS_EDIT' }, sender)).draft, null);
});

test('draft storage failure is reported and later edits can still be saved', async () => {
  const h = fixture(); h.failWrites(true);
  await assert.rejects(saveDraft(h.service)); h.failWrites(false);
  await saveDraft(h.service); assert.deepEqual((await h.service.handle({ type: 'SETTINGS_EDIT' }, sender)).draft, draft);
  assert.equal(h.local.settings.apiKey, 'saved-fixture-key');
});


test('draft validation bounds secret fields and ignores unrelated data and legacy thinking', async () => {
  const h = fixture();
  for (const invalid of [{ ...draft, apiKey: 'x'.repeat(2001) }, { ...draft, baseUrl: 'x'.repeat(2049) }, { ...draft, defaultLanguage: 'invalid' }]) {
    await assert.rejects(saveDraft(h.service, invalid), /无效/);
  }
  await saveDraft(h.service, { ...draft, enabled: false, extra: 'ignored', thinking: true });
  const edit = await h.service.handle({ type: 'SETTINGS_EDIT' }, sender);
  assert.deepEqual(edit.draft, draft); assert.equal(edit.settings.enabled, true);
});

test('legacy settings and restored drafts discard thinking without losing other fields', async () => {
  const h = fixture();
  h.local.settings.thinking = true;
  h.session.settingsDraft = { configRevision: 'initial', draft: { ...draft, thinking: true } };
  const edit = await h.service.handle({ type: 'SETTINGS_EDIT' }, sender);
  assert.equal('thinking' in edit.settings, false);
  assert.equal(edit.settings.apiKey, 'saved-fixture-key');
  assert.deepEqual(edit.draft, draft);
  await h.service.handle({ type: 'SET_ENABLED', enabled: false }, sender);
  assert.equal('thinking' in h.local.settings, false);
});
