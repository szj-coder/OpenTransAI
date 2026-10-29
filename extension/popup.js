import { LANGUAGES, DEFAULT_SETTINGS, validateSettings, permissionOrigin } from './lib/core.js';
import { send, notice } from './lib/client.js';
import { showEntryDialog } from './lib/entry-dialog.js';

// Toolbar popups size themselves. Resize only an independent extension window,
// never the user's normal browser window, when settings or feedback change height.
if (globalThis.chrome?.windows?.getCurrent) void chrome.windows.getCurrent().then(async current => {
  if (current.type !== 'popup') return;
  const tab = await chrome.tabs.getCurrent();
  if (!tab || tab.windowId !== current.id) return;
  let lastHeight;
  const fit = () => {
    const height = Math.ceil(document.body.getBoundingClientRect().height + Math.max(0, window.outerHeight - window.innerHeight));
    if (height === lastHeight) return;
    lastHeight = height;
    void chrome.windows.update(current.id, { height }).catch(() => {});
  };
  const observer = new ResizeObserver(fit); observer.observe(document.body);
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
}).catch(() => {});

const accessToken = new URLSearchParams(location.search).get('access');
if (accessToken) {
  const main = document.querySelector('main'); main.replaceChildren();
  const title = document.createElement('h1'); title.textContent = '授权图片翻译';
  const description = document.createElement('p'), result = document.createElement('p'); result.setAttribute('role', 'status');
  const allow = document.createElement('button'); allow.textContent = '授权'; allow.className = 'save'; allow.disabled = true;
  const deny = document.createElement('button'); deny.textContent = '取消'; deny.className = 'secondary';
  main.append(title, description, allow, deny, result);
  deny.addEventListener('click', async () => { await send('ACCESS_RESULT', { token: accessToken, granted: false }).catch(() => {}); window.close(); });
  try {
    const access = await send('ACCESS_GET', { token: accessToken });
    description.textContent = access.purpose === 'capture' ? '允许全站访问后，可以从网页浮窗直接框选截图。只有你确认的区域会发送至配置的 AI 服务。也可取消并从右键菜单使用临时授权。' : `允许读取所选图片所在地址：${access.origins.join('、')}。只处理你明确选择的图片。`;
    allow.disabled = false;
    allow.addEventListener('click', async () => {
      const request = chrome.permissions.request({ origins: access.origins });
      allow.disabled = true;
      try { const granted = await request; await send('ACCESS_RESULT', { token: accessToken, granted }); window.close(); }
      catch (error) { result.textContent = error.message; allow.disabled = false; }
    });
  } catch (error) { result.textContent = error.message; }
} else if (new URLSearchParams(location.search).has('entryError')) {
  const tabId = Number(new URLSearchParams(location.search).get('entryError'));
  let error;
  try { ({ error } = await send('ENTRY_ERROR_GET', { tabId })); } catch { /* Keep this in the toolbar popup even if the worker is unavailable. */ }
  showEntryDialog(error || { message: '这条翻译入口异常已失效。', hint: '请返回原网页重新选择图片。', details: '没有可用的当前异常记录。' }, '', true);
  const settings = document.createElement('button'); settings.textContent = '返回翻译设置'; settings.type = 'button';
  settings.addEventListener('click', async () => { await send('ENTRY_ERROR_CLEAR', { tabId }).catch(() => {}); location.replace(chrome.runtime.getURL('popup.html')); });
  document.getElementById('opentransai-entry-error').shadowRoot.querySelector('.actions').append(settings);
} else {

const $ = id => document.getElementById(id);
const form = $('settings-form');
const provider = $('provider');
const language = $('default-language');
const fields = $('fields');
const message = $('notice');
document.querySelector('.diagnostics-link').addEventListener('click', event => {
  event.preventDefault();
  void chrome.tabs.create({ url: chrome.runtime.getURL('diagnostics.html') })
    .catch(() => notice(message, '无法打开诊断日志，请重新加载扩展后重试。', 'error'));
});
let serviceProvider = 'openai';
let enabled = true;
let busy = false;
let savedForm, configRevision, draftVersion = 0;

for (const [value, label] of Object.entries(LANGUAGES)) language.add(new Option(label, value));
const protocolFor = value => ['openai', 'deepseek', 'custom'].includes(value) ? 'openai' : value;

function readForm() {
  return { provider: serviceProvider, baseUrl: $('base-url').value, model: $('model').value, apiKey: $('api-key').value, defaultLanguage: language.value, enabled };
}
function readDraft() {
  const { enabled: _enabled, ...draft } = readForm();
  return draft;
}
function setBusy(value) {
  busy = value; fields.disabled = value; $('enabled').disabled = value; $('discard-draft').disabled = value;
}
const isDirty = () => JSON.stringify(readDraft()) !== JSON.stringify(savedForm);
function draftNotice(text) {
  $('draft-state').hidden = !text;
  $('discard-draft').hidden = !text;
  $('draft-notice').textContent = text;
}
function showService(settings) {
  serviceProvider = settings.provider;
  provider.value = protocolFor(settings.provider);
  $('base-url').value = settings.baseUrl;
  $('model').value = settings.model;
  $('api-key').value = settings.apiKey;
  $('api-key').type = 'password';
  $('reveal').textContent = '显示';
  $('reveal').setAttribute('aria-pressed', 'false');
}
provider.addEventListener('change', () => {
  serviceProvider = provider.value;
});
function markDirty() {
  notice(message, '');
  if (!savedForm || busy) return;
  const version = ++draftVersion, dirty = isDirty();
  draftNotice(dirty ? '有未保存修改 · 正在暂存…' : '');
  // Send immediately: toolbar popups can be destroyed without an unload callback.
  void send('SETTINGS_DRAFT_SAVE', { configRevision, draft: dirty ? readDraft() : null }).then(() => {
    if (version === draftVersion) draftNotice(dirty ? '未保存 · 草稿已在本次浏览器会话暂存' : '');
  }).catch(() => {
    if (version === draftVersion) draftNotice('草稿暂存失败，请保存配置后再关闭');
  });
}
form.addEventListener('input', markDirty);
form.addEventListener('change', markDirty);
$('discard-draft').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true); ++draftVersion;
  try {
    await send('SETTINGS_DRAFT_SAVE', { configRevision, draft: null });
    showService(savedForm); language.value = savedForm.defaultLanguage;
    draftNotice(''); notice(message, '已放弃修改，恢复已保存配置。');
  } catch (error) { notice(message, error.message || '无法放弃修改，请重试。', 'error'); }
  finally { setBusy(false); }
});
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
    setBusy(true);
    notice(feedback, testOnly ? '正在测试连接，通常只需几秒…' : '正在保存…');
    if (!await permission) throw new Error('未获得 API 地址访问权限，配置未保存。');
    const data = await send(testOnly ? 'TEST' : 'SETTINGS_SAVE', { settings });
    if (testOnly) notice(feedback, `连接成功 · ${(data.elapsedMs / 1000).toFixed(1)} 秒${isDirty() ? ' · 尚未保存，请保存配置。' : ' · 当前配置已保存。'}`, 'success');
    else {
      notice(message, '配置已保存。', 'success');
      window.close();
    }
  } catch (error) { notice(feedback, error.message || '操作失败，请重试。', 'error'); }
  finally {
    setBusy(false);
  }
}
form.addEventListener('submit', event => { event.preventDefault(); void act(false); });
$('test').addEventListener('click', () => void act(true));

showService({ ...DEFAULT_SETTINGS, baseUrl: '' });
language.value = DEFAULT_SETTINGS.defaultLanguage;
try {
  const edit = await send('SETTINGS_EDIT');
  const { settings, draft } = edit; configRevision = edit.configRevision;
  showService({ ...settings, baseUrl: settings.apiKey ? settings.baseUrl : '' });
  enabled = settings.enabled;
  language.value = settings.defaultLanguage;
  savedForm = readDraft();
  if (draft) {
    showService(draft); language.value = draft.defaultLanguage;
    if (isDirty()) draftNotice('已恢复未保存草稿 · 保存配置后生效');
  }
  if (edit.draftUnavailable) notice(message, '暂时无法恢复或保留草稿，请保存配置后再关闭。', 'error');
  fields.disabled = false;
  $('enabled').checked = enabled;
  $('enabled').disabled = false;
} catch (error) { notice(message, error.message, 'error'); }

$('enabled').addEventListener('change', async () => {
  const toggle = $('enabled');
  if (busy) return;
  setBusy(true);
  try {
    const saved = await send('SET_ENABLED', { enabled: toggle.checked });
    enabled = saved.enabled;
    notice(message, enabled ? '翻译功能已开启。' : '翻译功能已关闭。');
  } catch (error) { toggle.checked = enabled; notice(message, error.message, 'error'); }
  finally { setBusy(false); }
});

}
