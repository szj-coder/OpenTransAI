import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { DEFAULT_SETTINGS, parseTranslation, translate } from '../extension/lib/core.js';
import { createService } from '../extension/lib/service.js';
import { createDiagnostics } from '../extension/lib/diagnostics.js';

globalThis.crypto ||= webcrypto;
const settings = { ...DEFAULT_SETTINGS, apiKey: 'PRIVATE_KEY' };
const result = { sourceLanguage: 'en', targetLanguage: 'zh-CN', translation: '你好。' };
const contentResponse = content => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }));
const event = data => `data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
function streamResponse(provider, raw) {
  const chunks = [raw.slice(0, -4), raw.slice(-4)];
  const wire = provider === 'anthropic'
    ? chunks.map(text => event({ type: 'content_block_delta', delta: { type: 'text_delta', text } })).join('') + event({ type: 'message_stop' })
    : provider === 'gemini'
      ? chunks.map((text, i) => event({ candidates: [{ content: { parts: [{ text }] }, ...(i === 1 ? { finishReason: 'STOP' } : {}) }] })).join('')
      : chunks.map(content => event({ choices: [{ delta: { content } }] })).join('') + event('[DONE]');
  return new Response(wire, { headers: { 'Content-Type': 'text/event-stream' } });
}

test('语言代码大小写和下划线先规范化，再比较已知源语言及目标方向', () => {
  assert.deepEqual(parseTranslation(JSON.stringify({ ...result, sourceLanguage: 'EN_us', targetLanguage: 'zh_CN' }), 'zh-CN', { sourceLanguage: 'en-US' }), { ...result, sourceLanguage: 'en-US' });
});

test('明确的中文脚本别名可匹配对应简体或繁体目标', () => {
  for (const [actual, expected] of [['zh-Hans', 'zh-CN'], ['zh-Hans-CN', 'zh-CN'], ['zh-SG', 'zh-CN'], ['zh-Hant', 'zh-TW'], ['zh-HK', 'zh-TW']]) {
    assert.equal(parseTranslation(JSON.stringify({ ...result, targetLanguage: actual }), expected).targetLanguage, expected);
  }
});

test('无地区限制的目标接受同脚本地区代码，中文原文仍自动转英语', () => {
  assert.equal(parseTranslation(JSON.stringify({ ...result, sourceLanguage: 'zh_CN', targetLanguage: 'en-US' }), 'zh-CN').targetLanguage, 'en');
  assert.equal(parseTranslation(JSON.stringify({ ...result, targetLanguage: 'de-DE' }), 'zh-CN', { targetLanguage: 'de' }).targetLanguage, 'de');
});

test('源语言标准别名先规范化，再决定自动翻译方向', () => {
  assert.deepEqual(parseTranslation(JSON.stringify({ sourceLanguage: 'in', targetLanguage: 'en', translation: 'Hello.' }), 'id'), { sourceLanguage: 'id', targetLanguage: 'en', translation: 'Hello.' });
});

test('真正方向错误、相反中文脚本及不明确中文代码仍被拒绝', () => {
  for (const [actual, expected] of [['ja', 'zh-CN'], ['zh-TW', 'zh-CN'], ['zh-Hant-CN', 'zh-CN'], ['zh-Hans', 'zh-TW'], ['zh', 'zh-CN'], ['en-Shaw', 'en'], ['en-US-x-private', 'en']]) {
    assert.throws(() => parseTranslation(JSON.stringify({ ...result, targetLanguage: actual }), 'zh-CN', { targetLanguage: expected }), error => error.code === 'FORMAT' && error.diagnostic.reason === 'language_mismatch');
  }
});

test('源语言不一致与目标语言不一致的诊断分别保留安全代码', () => {
  for (const [value, options, field, expected, actual] of [
    [{ ...result, sourceLanguage: 'ja' }, { sourceLanguage: 'en' }, 'sourceLanguage', 'en', 'ja'],
    [{ ...result, targetLanguage: 'ja' }, {}, 'targetLanguage', 'zh-CN', 'ja'],
  ]) assert.throws(() => parseTranslation(JSON.stringify(value), 'zh-CN', options), error => {
    assert.deepEqual(error.diagnostic, { reason: 'language_mismatch', languageField: field, expectedLanguage: expected, actualLanguage: actual });
    return true;
  });
});

for (const provider of ['openai', 'anthropic', 'gemini']) {
  test(`${provider} 流式代码别名在预览与最终结果中一致，仍只请求一次`, async () => {
    const progress = []; let calls = 0;
    const actual = await translate('Hello.', { ...settings, provider }, {
      onProgress: value => progress.push(value),
      fetchImpl: async () => { calls++; return streamResponse(provider, JSON.stringify({ ...result, targetLanguage: 'zh-Hans' })); },
    });
    assert.deepEqual(actual, result);
    assert.equal(calls, 1);
    assert(progress.length > 0);
    assert(progress.every(value => value.targetLanguage === 'zh-CN'));
  });
}

test('非流式代码别名使用相同校验结果', async () => {
  assert.deepEqual(await translate('Hello.', settings, { fetchImpl: async () => contentResponse(JSON.stringify({ ...result, targetLanguage: 'zh_CN' })) }), result);
});

test('三协议真实方向错误不泄出分片，服务日志可读到预期和返回代码', async () => {
  for (const provider of ['openai', 'anthropic', 'gemini']) {
    const values = { settings: { ...settings, provider }, configurationRevision: 'revision-1' };
    const api = {
      runtime: { id: 'test', getURL: path => 'chrome-extension://test/' + path },
      storage: { local: { setAccessLevel: async () => {}, get: async () => structuredClone(values), set: async next => Object.assign(values, structuredClone(next)) } },
      permissions: { contains: async () => true },
    };
    const service = createService(api, { fetchImpl: async () => streamResponse(provider, JSON.stringify({ ...result, targetLanguage: 'ja', translation: 'PRIVATE_TRANSLATION' })) });
    const progress = [];
    await assert.rejects(service.handle({ type: 'TRANSLATE', requestId: 'mismatch', text: 'PRIVATE_ORIGINAL' }, { id: 'test', tab: { id: 7 } }, { onProgress: value => progress.push(value) }), error => error.code === 'FORMAT');
    assert.deepEqual(progress, []);
    const { entries } = await service.handle({ type: 'DIAGNOSTICS_GET' }, { id: 'test', url: 'chrome-extension://test/diagnostics.html' });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].provider, provider);
    assert.equal(entries[0].step, 'stream');
    assert.equal(entries[0].httpStatus, 200);
    assert.equal(entries[0].languageField, 'targetLanguage');
    assert.equal(entries[0].expectedLanguage, 'zh-CN');
    assert.equal(entries[0].actualLanguage, 'ja');
    assert.doesNotMatch(JSON.stringify(entries), /PRIVATE_KEY|PRIVATE_TRANSLATION|PRIVATE_ORIGINAL/);
  }
});

test('语言诊断不保存自由文本、私有扩展或碰巧形似语言代码的 Key', async () => {
  const values = {};
  const log = createDiagnostics({ get: async () => structuredClone(values), set: async next => Object.assign(values, structuredClone(next)) });
  await log.add({ reason: 'language_mismatch', languageField: 'targetLanguage', expectedLanguage: 'zh-CN', actualLanguage: 'zh-Hant' });
  assert.equal((await log.list()).entries[0].actualLanguage, 'zh-Hant');
  for (const actualLanguage of ['PRIVATE_KEY text', 'en-US-x-private', 'en-US-u-ca-gregory', 'en-US']) {
    await log.add({ languageField: 'PRIVATE_KEY', actualLanguage, expectedLanguage: 'PRIVATE_KEY' }, 'en-US');
    const record = (await log.list()).entries[0];
    assert.equal(record.actualLanguage, undefined);
    assert.equal(record.expectedLanguage, undefined);
    assert.equal(record.languageField, undefined);
  }
});

test('语言兼容不修补损坏 JSON、不接受非法语言值', () => {
  assert.throws(() => parseTranslation('{"sourceLanguage":"en","targetLanguage":"zh_CN","translation":"bad "quote""}', 'zh-CN'), error => error.diagnostic.reason === 'invalid_json');
  for (const targetLanguage of ['Simplified Chinese', ' zh-CN ', null]) {
    assert.throws(() => parseTranslation(JSON.stringify({ ...result, targetLanguage }), 'zh-CN'), error => error.diagnostic.reason === 'invalid_schema');
  }
});
