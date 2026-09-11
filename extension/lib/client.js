export async function send(type, payload = {}) {
  if (!globalThis.chrome?.runtime?.id) throw new Error('请先在 Chrome 扩展管理中加载插件，再打开扩展的设置页。');
  let response;
  try { response = await chrome.runtime.sendMessage({ type, ...payload }); }
  catch { throw new Error('扩展连接已断开，请刷新页面后重试。'); }
  if (!response?.ok) throw new Error(response?.error || '操作失败，请重试。');
  return response.data;
}

export function notice(element, text, tone = '') {
  element.textContent = text;
  element.dataset.tone = tone;
}
