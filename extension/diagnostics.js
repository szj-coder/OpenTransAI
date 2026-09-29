import { send, notice } from './lib/client.js';
import { DIAGNOSTIC_REASONS } from './lib/diagnostics.js';

const $ = id => document.getElementById(id);
const stageNames = { recognition: '图片识别', translation: '文字翻译', image_read: '图片读取', capture: '截图', preparation: '准备请求', entry: '翻译入口' };
let entries = [], busy = false;
const exportText = () => JSON.stringify({ application: 'OpenTransAI', exportedAt: new Date().toISOString(), entries }, null, 2);
function controls() {
  $('refresh').disabled = busy;
  $('copy').disabled = busy || !entries.length;
  $('clear').disabled = busy || !entries.length;
}
function render() {
  $('entries').replaceChildren();
  $('count').textContent = entries.length ? `共 ${entries.length} 条异常 · 最新在前` : '暂无异常记录。复现问题后点击“刷新”。';
  for (const entry of entries) {
    const article = document.createElement('article'); article.className = 'diagnostic-entry';
    const meta = document.createElement('p'); meta.className = 'meta';
    meta.textContent = `${new Date(entry.timestamp).toLocaleString()} · ${stageNames[entry.stage] || '操作'} · ${entry.code || 'SERVICE'}`;
    const title = document.createElement('h2'); title.textContent = DIAGNOSTIC_REASONS[entry.reason] || '操作失败';
    const summary = document.createElement('p');
    summary.textContent = [entry.provider, entry.model, entry.httpStatus !== undefined ? `HTTP ${entry.httpStatus}` : '', entry.elapsedMs !== undefined ? `${entry.elapsedMs} ms` : ''].filter(Boolean).join(' · ');
    const details = document.createElement('details'), label = document.createElement('summary'), pre = document.createElement('pre');
    label.textContent = '查看诊断字段'; pre.textContent = JSON.stringify(entry, null, 2); details.append(label, pre);
    article.append(meta, title, summary, details); $('entries').append(article);
  }
}
async function load(clear = false) {
  if (busy) return;
  busy = true; controls(); notice($('notice'), clear ? '正在清空…' : '正在读取…');
  $('manual-copy').hidden = true; $('copy-text').value = '';
  try {
    if (clear) {
      await send('DIAGNOSTICS_CLEAR'); entries = []; render();
    }
    const result = await send('DIAGNOSTICS_GET'); entries = result.entries; render();
    notice($('notice'), result.storageFailed ? '部分异常未能写入本地存储，请检查浏览器存储状态。' : clear ? '日志已清空。' : '日志已更新。', result.storageFailed ? 'error' : 'success');
  } catch {
    notice($('notice'), '无法读取或清空日志，请重新加载扩展后重试。', 'error');
  } finally { busy = false; controls(); }
}
$('refresh').addEventListener('click', () => void load());
$('clear').addEventListener('click', () => void load(true));
$('copy').addEventListener('click', async () => {
  const text = exportText();
  try { await navigator.clipboard.writeText(text); notice($('notice'), '诊断日志已复制。', 'success'); }
  catch {
    $('manual-copy').hidden = false; $('copy-text').value = text; $('copy-text').focus(); $('copy-text').select();
    notice($('notice'), '无法自动复制，已选中日志，请按 Ctrl+C 或 ⌘C。', 'error');
  }
});
void load();
