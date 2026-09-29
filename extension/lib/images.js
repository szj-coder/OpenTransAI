import { TranslationError } from './stream.js';

export const IMAGE_LIMIT = 4 * 1024 * 1024;
const fail = (message, code = 'IMAGE_READ') => { throw Object.assign(new TranslationError(message), { code }); };

export function imageOrigin(raw) {
  let url;
  try { url = new URL(raw); } catch { fail('无法读取这张图片。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) fail('无法读取这张图片，请使用框选截图。');
  return `${url.protocol}//${url.hostname}/*`;
}

export function cropBounds(rect, viewport, bitmap) {
  if (![rect?.x, rect?.y, rect?.width, rect?.height, viewport?.width, viewport?.height, bitmap?.width, bitmap?.height].every(Number.isFinite)
    || viewport.width <= 0 || viewport.height <= 0 || bitmap.width <= 0 || bitmap.height <= 0
    || rect.width <= 0 || rect.height <= 0 || rect.x < 0 || rect.y < 0
    || rect.x + rect.width > viewport.width + .5 || rect.y + rect.height > viewport.height + .5) {
    fail('选区超出当前可见区域，请重新框选。', 'CAPTURE_CHANGED');
  }
  // Chrome captures the viewport including scrollbar gutters. Selection bounds exclude them.
  const width = viewport.captureWidth ?? viewport.width, height = viewport.captureHeight ?? viewport.height;
  if (![width, height].every(Number.isFinite) || width < viewport.width || height < viewport.height) fail('截图视口已变化，请重新框选。', 'CAPTURE_CHANGED');
  const x = Math.floor(rect.x * bitmap.width / width);
  const y = Math.floor(rect.y * bitmap.height / height);
  const right = Math.min(bitmap.width, Math.ceil((rect.x + rect.width) * bitmap.width / width));
  const bottom = Math.min(bitmap.height, Math.ceil((rect.y + rect.height) * bitmap.height / height));
  return { x, y, width: right - x, height: bottom - y };
}

async function dataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

export async function normalizeBitmap(bitmap, rect = { x: 0, y: 0, width: bitmap.width, height: bitmap.height }) {
  if (!rect.width || !rect.height || rect.width > 8000 || rect.height > 8000) fail('图片过大，请缩小框选范围（单边最多 8000 像素）。', 'LIMIT');
  const canvas = new OffscreenCanvas(rect.width, rect.height);
  canvas.getContext('2d').drawImage(bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  let blob = await canvas.convertToBlob({ type: 'image/png' });
  if (blob.size > IMAGE_LIMIT) blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: .92 });
  if (blob.size > IMAGE_LIMIT) fail('图片超过 4MiB，请缩小框选范围。', 'LIMIT');
  return { dataUrl: await dataUrl(blob), width: rect.width, height: rect.height };
}

export async function readRemoteImage(url, { fetchImpl = fetch, signal } = {}) {
  imageOrigin(url);
  let bitmap;
  try {
    const response = await fetchImpl(url, { signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) fail('无法读取这张图片，请重试或框选截图。');
    if (Number(response.headers.get('content-length')) > IMAGE_LIMIT) fail('图片超过 4MiB，请缩小框选范围。', 'LIMIT');
    const reader = response.body.getReader();
    const chunks = []; let size = 0;
    try {
      while (true) {
        if (signal?.aborted) throw signal.reason;
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > IMAGE_LIMIT) fail('图片超过 4MiB，请缩小框选范围。', 'LIMIT');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    bitmap = await createImageBitmap(new Blob(chunks, { type: response.headers.get('content-type') }));
    if (signal?.aborted) throw signal.reason;
    return await normalizeBitmap(bitmap);
  } catch (error) {
    if (signal?.aborted) fail('图片读取已取消。', 'CANCELLED');
    if (error.code) throw error;
    fail('无法读取这张图片，请重试或框选截图。');
  } finally { bitmap?.close(); }
}

export async function cropCapture(data, rect, viewport) {
  const response = await fetch(data);
  const bitmap = await createImageBitmap(await response.blob());
  try { return await normalizeBitmap(bitmap, cropBounds(rect, viewport, bitmap)); }
  finally { bitmap.close(); }
}
