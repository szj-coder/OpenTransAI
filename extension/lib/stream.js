export class TranslationError extends Error {}
const fail = message => { throw new TranslationError(message); };

// SSE records can cross TCP chunks, UTF-8 characters and CRLF boundaries.
export async function readEvents(body, receive, signal, activity) {
  if (!body) fail('接口未返回可读取的数据流。');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', lines = [], total = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  const dispatch = () => {
    if (!lines.length) return false;
    const data = lines.join('\n'); lines = [];
    return receive(data) === true;
  };
  try {
    while (true) {
      if (signal.aborted) throw signal.reason;
      const { done, value } = await reader.read();
      if (signal.aborted) throw signal.reason;
      if (value) { total += value.length; activity(); }
      if (total > 8_000_000) fail('AI 返回内容过长，请缩小选区。');
      buffer += decoder.decode(value, { stream: !done });
      let match;
      while ((match = /\r\n|\r|\n/.exec(buffer))) {
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!line) { if (dispatch()) return; }
        else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
      }
      if (done) {
        if (buffer.startsWith('data:')) lines.push(buffer.slice(5).replace(/^ /, ''));
        dispatch(); return;
      }
    }
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Read only top-level JSON string values. Incomplete escapes are held until the
// next chunk, and quoted JSON-like content inside the translation stays text.
export function partialTranslation(raw) {
  const text = raw.trimStart().replace(/^```json\s*/i, '').replace(/^```\s*/, '');
  let i = 0;
  const values = Object.create(null);
  const whitespace = () => { while (/\s/.test(text[i] || 'x')) i++; };
  function string() {
    if (text[i++] !== '"') return null;
    let value = '';
    while (i < text.length) {
      const char = text[i++];
      if (char === '"') return { value, complete: true };
      if (char === '\\') {
        if (i >= text.length) break;
        const escape = text[i++];
        if (escape === 'u') {
          const hex = text.slice(i, i + 4);
          if (hex.length < 4) break;
          if (!/^[a-f\d]{4}$/i.test(hex)) return null;
          value += String.fromCharCode(parseInt(hex, 16)); i += 4;
        } else {
          const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          if (!Object.hasOwn(escapes, escape)) return null;
          value += escapes[escape];
        }
      } else if (char.charCodeAt(0) < 32) return null;
      else value += char;
    }
    // Do not display a half surrogate as a replacement character.
    return { value: value.replace(/[\uD800-\uDBFF]$/, ''), complete: false };
  }
  whitespace(); if (text[i++] !== '{') return null;
  while (i < text.length) {
    whitespace(); if (text[i] === '}') return values;
    const key = string(); if (!key?.complete) return null;
    if (!['sourceLanguage', 'targetLanguage', 'translation'].includes(key.value) || Object.hasOwn(values, key.value)) return null;
    whitespace(); if (text[i++] !== ':') return null;
    whitespace(); const value = string(); if (!value) return null;
    if (value.complete || key.value === 'translation') values[key.value] = value.value;
    if (!value.complete) return values;
    whitespace(); if (text[i] === '}') return values;
    if (text[i++] !== ',') return null;
  }
  return values;
}

export async function streamResponse(response, provider, { signal, activity, progress, phase = () => {} }) {
  let raw = '', finished = false;
  await readEvents(response.body, wire => {
    if (wire === '[DONE]') { finished = true; return true; }
    let data;
    try { data = JSON.parse(wire); } catch { fail('AI 流式数据格式不正确，请重试。'); }
    if (data.error || data.type === 'error') fail('AI 服务在生成过程中返回错误，请稍后重试。');
    let delta = '';
    if (provider === 'anthropic') {
      if (data.delta?.stop_reason === 'max_tokens') fail('译文被模型截断，请缩小选区后重试。');
      if (data.delta?.stop_reason && !['end_turn', 'stop_sequence'].includes(data.delta.stop_reason)) fail('AI 未能完成翻译，请更换模型或重试。');
      if (data.type === 'content_block_start' && data.content_block?.type === 'text') delta = data.content_block.text || '';
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') delta = data.delta.text;
      if (data.type === 'message_stop') { finished = true; return true; }
    } else if (provider === 'gemini') {
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason === 'MAX_TOKENS') fail('译文被模型截断，请缩小选区后重试。');
      if (data.promptFeedback?.blockReason || (candidate?.finishReason && candidate.finishReason !== 'STOP')) fail('AI 未能翻译这段内容，请调整选区或更换模型。');
      if (candidate?.finishReason === 'STOP') finished = true;
      delta = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('') || '';
    } else {
      const choice = data.choices?.[0];
      if (choice?.finish_reason === 'length') fail('译文被模型截断，请缩小选区后重试。');
      if (choice?.finish_reason && choice.finish_reason !== 'stop') fail('AI 未能完成翻译，请更换模型或重试。');
      // Only expose the phase, never forward or store raw reasoning text.
      if (typeof choice?.delta?.reasoning_content === 'string' && choice.delta.reasoning_content.length) phase('thinking');
      delta = choice?.delta?.content || '';
    }
    if (typeof delta !== 'string') fail('AI 流式内容格式不正确。');
    if (delta) {
      phase('translating');
      raw += delta;
      if (raw.length > 700000) fail('AI 返回内容过长，请缩小选区。');
      progress(raw);
    }
    return false;
  }, signal, activity);
  if (!finished) fail('翻译连接中断，译文可能不完整，请重试。');
  return raw;
}
