export const DIAGNOSTIC_LIMIT = 100;
export const DIAGNOSTIC_TTL = 7 * 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'diagnosticErrors';

export const DIAGNOSTIC_REASONS = Object.freeze({
  missing_content: '接口没有返回识别或翻译正文',
  empty_content: '模型返回空正文',
  non_string_content: '正文不是字符串',
  markdown_fence: '正文被 Markdown 代码围栏包裹',
  invalid_json: '正文不是合法 JSON',
  invalid_schema: 'JSON 字段缺失、类型或取值不符合要求',
  output_limit: '译文超过长度限制，请缩小选区',
  language_mismatch: '返回语言与请求方向不一致',
  response_json: '接口响应本身不是合法 JSON',
  response_shape: '接口响应结构不符合所选协议',
  truncated: '服务标记生成内容已截断',
  incomplete_generation: '服务未正常完成生成',
  blocked: '服务拒绝生成或过滤了内容',
  http_error: '接口返回 HTTP 错误',
  network: '请求未能完成，请检查网络或访问权限',
  timeout: '等待有效响应超时',
  stream_error: '流式响应出错或未完整结束',
  validation: '配置、权限或输入检查失败',
  operation_failed: '操作失败',
  receiver_missing: '网页翻译脚本未连接',
  message_closed: '网页消息连接中断',
  frame_missing: '图片所在框架已失效',
  tab_missing: '原标签页已关闭或不可访问',
  extension_context: '网页中的扩展连接已失效',
  page_restricted: '浏览器限制当前页面运行扩展',
  site_access_denied: '浏览器拒绝访问当前网站',
  page_changed: '页面已发生变化',
  disabled: '翻译功能已关闭',
  invalid_source: '图片来源无效',
  entry_failed: '翻译入口启动失败，原因未分类',
  entry_timeout: '网页翻译入口响应超时',
  page_connection_failed: '网页与扩展通信失败',
});

const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
// Never retain raw values, arbitrary property names or JSON.parse error excerpts.
export function describeOutput(raw) {
  const detail = { responseType: typeOf(raw) };
  if (raw === undefined || raw === null) return { ...detail, reason: 'missing_content' };
  if (typeof raw !== 'string') return { ...detail, reason: 'non_string_content' };
  detail.responseChars = raw.length;
  if (!raw.trim()) return { ...detail, reason: 'empty_content' };
  if (/^\s*```/.test(raw)) return { ...detail, reason: 'markdown_fence' };
  try {
    const value = JSON.parse(raw);
    detail.jsonType = typeOf(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      detail.fieldCount = Object.keys(value).length;
      for (const key of ['text', 'sourceLanguage', 'targetLanguage', 'translation', 'warnings']) detail[`${key}Type`] = typeOf(value[key]);
    }
    return { ...detail, reason: 'invalid_schema' };
  } catch (error) {
    const position = /\bposition (\d+)\b/.exec(error.message);
    if (position) detail.jsonErrorOffset = Number(position[1]);
    return { ...detail, reason: 'invalid_json' };
  }
}

function safeLanguageCode(value) {
  // Basic codes only: never store private-use/extension subtags or free text.
  if (typeof value !== 'string' || !/^[a-z]{2,3}(?:-[a-z]{4})?(?:-(?:[a-z]{2}|\d{3}))?$/i.test(value)) return undefined;
  try { return Intl.getCanonicalLocales(value)[0]; } catch { return undefined; }
}

export function describeLanguageMismatch(languageField, expectedLanguage, actualLanguage) {
  const detail = { reason: 'language_mismatch', languageField };
  for (const [key, value] of Object.entries({ expectedLanguage, actualLanguage })) {
    const code = safeLanguageCode(value);
    if (code) detail[key] = code;
  }
  return detail;
}

const enums = {
  operation: ['TRANSLATE', 'TRANSLATE_IMAGE', 'TEST', 'READ_SOURCE', 'CAPTURE_REGION', 'ENTRY_IMAGE', 'ENTRY_CAPTURE'],
  sourceKind: ['text', 'image', 'screenshot', 'test'],
  stage: ['recognition', 'translation', 'image_read', 'capture', 'preparation', 'entry'],
  step: ['request', 'http', 'response_json', 'response_content', 'result_json', 'result_text', 'stream', 'validation', 'context_image', 'open_panel', 'begin_capture', 'entry_validation'],
  provider: ['openai', 'custom', 'deepseek', 'anthropic', 'gemini'],
  code: ['FORMAT', 'AUTH', 'RATE_LIMIT', 'SERVICE', 'CONFIG', 'CONFIG_CHANGED', 'DISABLED', 'PERMISSION', 'LIMIT', 'TIMEOUT', 'UNSUPPORTED_IMAGE', 'IMAGE_READ', 'IMAGE_PERMISSION', 'CAPTURE_CHANGED', 'CAPTURE_PERMISSION', 'CAPTURE_UNAVAILABLE', 'PAGE_CONNECTION', 'PAGE_CHANGED', 'PAGE_RESTRICTED', 'PAGE_PERMISSION', 'EXTENSION_CONTEXT', 'ENTRY_FAILED', 'ENTRY_TIMEOUT'],
  reason: Object.keys(DIAGNOSTIC_REASONS),
  previousReason: Object.keys(DIAGNOSTIC_REASONS),
  displayReason: Object.keys(DIAGNOSTIC_REASONS),
  display: ['translation_panel', 'injected_dialog', 'toolbar_popup', 'toolbar_badge', 'suppressed'],
  pageKind: ['http', 'https', 'restricted', 'unknown'],
  languageField: ['sourceLanguage', 'targetLanguage'],
};
const types = ['undefined', 'null', 'string', 'number', 'boolean', 'object', 'array'];
const numeric = ['httpStatus', 'elapsedMs', 'responseChars', 'fieldCount', 'jsonErrorOffset', 'tabId', 'frameId'];
function safeRecord(input, secret = '') {
  const record = {};
  for (const [key, allowed] of Object.entries(enums)) if (allowed.includes(input[key])) record[key] = input[key];
  for (const key of ['responseType', 'jsonType', 'textType', 'sourceLanguageType', 'targetLanguageType', 'translationType', 'warningsType']) if (types.includes(input[key])) record[key] = input[key];
  for (const key of numeric) if (Number.isSafeInteger(input[key]) && input[key] >= 0) record[key] = input[key];
  for (const key of ['expectedLanguage', 'actualLanguage']) {
    const value = safeLanguageCode(input[key]);
    if (value && !(secret && (input[key].includes(secret) || value.includes(secret)))) record[key] = value;
  }
  for (const key of ['id', 'requestId', 'taskId', 'configRevision', 'model']) {
    if (typeof input[key] !== 'string') continue;
    let value = secret ? input[key].replaceAll(secret, '[redacted]') : input[key];
    value = value.replace(/(?:sk-|Bearer\s+)[A-Za-z0-9_.-]+/gi, '[redacted]');
    record[key] = value.replace(/[\r\n\t]/g, ' ').slice(0, key === 'model' ? 200 : 100);
  }
  if (Number.isSafeInteger(input.timestamp) && input.timestamp > 0) record.timestamp = input.timestamp;
  return record;
}

export function createDiagnostics(storage, { ready = Promise.resolve(), now = Date.now } = {}) {
  let queue = Promise.resolve(), storageFailed = false;
  const serial = operation => {
    const result = queue.then(() => ready).then(operation);
    queue = result.catch(() => {});
    return result;
  };
  async function load() {
    const values = await storage.get(STORAGE_KEY);
    const entries = Array.isArray(values[STORAGE_KEY]) ? values[STORAGE_KEY] : [];
    return entries.filter(item => item && Number.isSafeInteger(item.timestamp) && item.timestamp > now() - DIAGNOSTIC_TTL && item.timestamp <= now())
      .slice(-DIAGNOSTIC_LIMIT).map(item => safeRecord(item));
  }
  return {
    add(input, secret) {
      return serial(async () => {
        const entries = await load();
        entries.push(safeRecord({ ...input, id: crypto.randomUUID(), timestamp: now() }, secret));
        await storage.set({ [STORAGE_KEY]: entries.slice(-DIAGNOSTIC_LIMIT) });
        storageFailed = false;
      }).catch(() => { storageFailed = true; });
    },
    list() {
      return serial(async () => {
        const entries = await load();
        await storage.set({ [STORAGE_KEY]: entries });
        return { entries: entries.reverse(), storageFailed };
      });
    },
    clear() {
      return serial(async () => { await storage.set({ [STORAGE_KEY]: [] }); storageFailed = false; return {}; });
    },
  };
}
