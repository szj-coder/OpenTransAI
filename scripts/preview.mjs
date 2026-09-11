import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const port = Number(process.env.OPENTRANSAI_PREVIEW_PORT || 4173);
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path === '/') path = '/tests/browser.html';
    const preview = path.startsWith('/preview/');
    if (preview) path = path.replace('/preview/', '/extension/');
    if (!path.startsWith('/extension/') && !path.startsWith('/tests/')) throw Error('Not found');
    const file = resolve(root, '.' + path);
    if (!file.startsWith(root + sep)) throw Error('Not found');
    let content = await readFile(file);
    if (preview && extname(file) === '.html') {
      content = content.toString().replace('<script type="module"', '<script type="module" src="/tests/settings-adapter.js"></script><script type="module"');
    }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}/ (test responses only)`));
