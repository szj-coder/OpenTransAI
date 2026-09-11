import { LANGUAGES, PROVIDERS, DEFAULT_SETTINGS, validateSettings, permissionOrigin, supportsThinking } from './lib/core.js';
import { send, notice } from './lib/client.js';

const $ = id => document.getElementById(id);
const form = $('settings-form');
const provider = $('provider');
const language = $('default-language');
const fields = $('fields');
const message = $('notice');
const drafts = new Map();
let currentProtocol = 'openai';
let serviceProvider = 'openai';
let enabled = true;
let busy = false;

const languageLabels = { 'zh-CN': '简体中文', 'zh-TW': '繁体中文', en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语', es: '西班牙语' };
for (const [value, label] of Object.entries(languageLabels)) language.add(new Option(label, value));
const protocolFor = value => ['openai', 'deepseek', 'custom'].includes(value) ? 'openai' : value;

function readForm() {
  return { provider: serviceProvider, baseUrl: $('base-url').value, model: $('model').value, apiKey: $('api-key').value, defaultLanguage: language.value, enabled, thinking: !$('thinking').disabled && $('thinking').checked };
}
function updateThinkingControl() {
  const supported = supportsThinking({ provider: serviceProvider, baseUrl: $('base-url').value });
  $('thinking').disabled = !supported;
  if (!supported) $('thinking').checked = false;
  $('thinking-hint').textContent = supported
    ? ($('thinking').checked ? '开启思考 · 可能增加等待时间' : '关闭思考 · 优先快速翻译')
    : '思考开关目前支持 DeepSeek 官方接口';
}
function showService(settings) {
  serviceProvider = settings.provider;
  currentProtocol = protocolFor(settings.provider);
  provider.value = currentProtocol;
  $('base-url').value = settings.baseUrl;
  $('model').value = settings.model;
  $('api-key').value = settings.apiKey;
  $('thinking').checked = settings.thinking === true;
  updateThinkingControl();
  $('api-key').type = 'password';
  $('reveal').textContent = '显示';
  $('reveal').setAttribute('aria-pressed', 'false');
}
provider.addEventListener('change', () => {
  drafts.set(currentProtocol, readForm());
  const next = provider.value;
  showService(drafts.get(next) || { provider: next, ...PROVIDERS[next], baseUrl: '', apiKey: '' });
});
$('base-url').addEventListener('input', updateThinkingControl);
$('thinking').addEventListener('change', updateThinkingControl);
function markDirty() {
  notice(message, '');
}
form.addEventListener('input', markDirty);
form.addEventListener('change', markDirty);
$('reveal').addEventListener('click', () => {
  const show = $('api-key').type === 'password';
  $('api-key').type = show ? 'text' : 'password';
  $('reveal').textContent = show ? '隐藏' : '显示';
  $('reveal').setAttribute('aria-pressed', String(show));
});
async function act(testOnly) {
  if (busy) return;
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }
  const feedback = message;
  try {
    const settings = validateSettings(readForm());
    const permission = chrome.permissions.request({ origins: [permissionOrigin(settings.baseUrl)] });
    busy = true;
    fields.disabled = true;
    $('enabled').disabled = true;
    notice(feedback, testOnly ? '正在测试连接，通常只需几秒…' : '正在保存…');
    if (!await permission) throw new Error('未获得 API 地址访问权限，配置未保存。');
    const data = await send(testOnly ? 'TEST' : 'SETTINGS_SAVE', { settings });
    if (testOnly) notice(feedback, `连接成功 · ${(data.elapsedMs / 1000).toFixed(1)} 秒 · ${data.translation}`, 'success');
    else {
      drafts.set(currentProtocol, settings);
      notice(message, '配置已保存。', 'success');
      window.close();
    }
  } catch (error) { notice(feedback, error.message || '操作失败，请重试。', 'error'); }
  finally {
    busy = false;
    fields.disabled = false;
    $('enabled').disabled = false;
  }
}
form.addEventListener('submit', event => { event.preventDefault(); void act(false); });
$('test').addEventListener('click', () => void act(true));

showService({ ...DEFAULT_SETTINGS, baseUrl: '' });
language.value = DEFAULT_SETTINGS.defaultLanguage;
try {
  const settings = await send('SETTINGS_GET');
  showService({ ...settings, baseUrl: settings.apiKey ? settings.baseUrl : '' });
  enabled = settings.enabled;
  if (!Object.hasOwn(languageLabels, settings.defaultLanguage)) language.add(new Option(LANGUAGES[settings.defaultLanguage], settings.defaultLanguage));
  language.value = settings.defaultLanguage;
  fields.disabled = false;
  $('enabled').checked = enabled;
  $('enabled').disabled = false;
} catch (error) { notice(message, error.message, 'error'); }

$('enabled').addEventListener('change', async () => {
  const toggle = $('enabled');
  toggle.disabled = true; fields.disabled = true;
  try {
    const saved = await send('SET_ENABLED', { enabled: toggle.checked });
    enabled = saved.enabled;
    notice(message, enabled ? '划词翻译已开启。' : '划词翻译已关闭。');
  } catch (error) { toggle.checked = enabled; notice(message, error.message, 'error'); }
  finally { toggle.disabled = false; fields.disabled = false; }
});
