// One catalog for classic content scripts and extension-page/worker modules.
// Never display native browser/provider messages: they may contain URLs or keys.
(() => {
  if (globalThis.OpenTransAIErrors) return;
  const messages = Object.freeze({
    SERVICE: '服务暂时不可用，请稍后重试。',
    FORMAT: 'AI 返回内容格式不正确或未完整生成，请重试或更换模型。',
    AUTH: 'API Key 无效或没有模型访问权限，请检查设置。',
    CONFIG: '请先配置有效的 AI 服务、模型、API 地址和 API Key。',
    CONFIG_CHANGED: '服务配置已变化，请重试。',
    DISABLED: '翻译功能已关闭，请在扩展设置中开启。',
    PERMISSION: '未获得 API 地址访问权限，请打开设置并允许访问。',
    RATE_LIMIT: '请求过于频繁或额度不足，请稍后重试并检查服务额度。',
    LIMIT: '内容超过处理限制，请缩小文字选区或图片范围。',
    TIMEOUT: '处理超时，请稍后重试或缩小范围。',
    CONNECTION: '扩展连接已断开，请重试；若仍失败，请刷新网页。',
    EXTENSION_CONTEXT: '扩展已更新或停用，请刷新网页后重试。',
    CANCELLED: '操作已取消。',
    UNSUPPORTED_IMAGE: '当前模型不支持图片，请在设置中更换支持视觉输入的模型。',
    IMAGE_INVALID: '图片数据或尺寸无效，请重新选择 PNG/JPEG 图片或框选截图。',
    IMAGE_READ: '无法读取这张图片，请重试或使用框选截图。',
    IMAGE_PERMISSION: '尚未授权读取图片，请授权对应图片地址或使用框选截图。',
    CAPTURE_CHANGED: '页面已滚动、缩放或切换，请重新框选。',
    CAPTURE_PERMISSION: '尚未获得截图权限，请授权后重新框选。',
    CAPTURE_UNAVAILABLE: '当前页面无法截图，请回到普通网页后重新框选。',
    PAGE_CONNECTION: '未连接到网页翻译脚本，请刷新原网页后重试。',
    PAGE_CHANGED: '原网页已变化，请重新选择内容。',
    PAGE_RESTRICTED: '当前页面不支持翻译，请在普通 HTTP(S) 网页中使用。',
    PAGE_PERMISSION: '浏览器拒绝访问当前页面，请检查网站访问权限后刷新网页。',
    ENTRY_FAILED: '翻译入口未能启动，请刷新网页后重试。',
    ENTRY_TIMEOUT: '网页翻译入口未及时响应，请等待页面加载完成或刷新网页。',
    STORAGE: '本地设置或日志操作失败，请重试；若仍失败，请重新加载扩展。',
    COPY: '无法自动复制，请按 Ctrl/Cmd+C 手动复制已选中的内容。',
  });
  class TranslationError extends Error {
    constructor(message, code = 'FORMAT') { super(message); this.name = 'TranslationError'; this.code = code; }
  }
  function normalizeError(error, fallbackCode = 'SERVICE') {
    const raw = typeof error?.message === 'string' ? error.message : '';
    let code = Object.hasOwn(messages, error?.code) ? error.code : null;
    if (/extension context invalidated/i.test(raw)) code = 'EXTENSION_CONTEXT';
    if (!code && error?.name === 'AbortError') code = 'CANCELLED';
    if (!code && error?.name === 'TimeoutError') code = 'TIMEOUT';
    if (!code && /receiving end does not exist|could not establish connection|message (?:port|channel).*closed|port.*disconnected/i.test(raw)) code = 'CONNECTION';
    code ||= Object.hasOwn(messages, fallbackCode) ? fallbackCode : 'SERVICE';
    if (code === 'SERVICE' && [400, 404, 422].includes(error?.diagnostic?.httpStatus)) code = 'CONFIG';
    // Only locally constructed application errors carry trusted, actionable text.
    const message = error instanceof TranslationError && raw ? raw : messages[code];
    return { code, message };
  }
  function toError(error, fallbackCode) {
    const safe = normalizeError(error, fallbackCode);
    return new TranslationError(safe.message, safe.code);
  }
  function errorResponse(error, fallbackCode) {
    const safe = normalizeError(error, fallbackCode);
    const trusted = error instanceof TranslationError && safe.message.length <= 500;
    return { code: safe.code, error: safe.message, ...(trusted ? { safeMessage: true } : {}) };
  }
  // Only use at same-extension runtime/port response boundaries. A marker on a
  // caught browser/provider exception is never honored by normalizeError.
  function fromResponse(response) {
    if (response?.safeMessage === true && Object.hasOwn(messages, response.code) &&
        typeof response.error === 'string' && response.error.length > 0 && response.error.length <= 500) {
      return new TranslationError(response.error, response.code);
    }
    return toError({ code: response?.code, message: response?.error });
  }
  function errorRecovery(code, kind) {
    return {
      retry: ['SERVICE', 'FORMAT', 'RATE_LIMIT', 'TIMEOUT', 'CONNECTION', 'CONFIG_CHANGED', 'IMAGE_READ'].includes(code),
      settings: ['CONFIG', 'AUTH', 'PERMISSION', 'UNSUPPORTED_IMAGE', 'DISABLED'].includes(code),
      capture: kind !== 'text' && ['IMAGE_READ', 'IMAGE_INVALID', 'IMAGE_PERMISSION', 'LIMIT', 'CAPTURE_CHANGED', 'CAPTURE_PERMISSION', 'CAPTURE_UNAVAILABLE'].includes(code),
      access: code === 'IMAGE_PERMISSION',
    };
  }
  globalThis.OpenTransAIErrors = Object.freeze({ TranslationError, normalizeError, toError, errorResponse, fromResponse, errorRecovery, codes: Object.freeze(Object.keys(messages)) });
})();
