import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = resolve(root, 'extension');
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? walk(resolve(dir, entry.name)) : [resolve(dir, entry.name)]))).flat();
}
const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
const resources = [manifest.background.service_worker, manifest.action.default_popup,
  ...manifest.web_accessible_resources.flatMap(item => item.resources), ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), ...manifest.content_scripts.flatMap(script => script.js)];
for (const path of resources) await access(resolve(extension, path));
for (const path of await walk(extension)) {
  if (path.endsWith('.js')) execFileSync(process.execPath, ['--check', path]);
  if (path.endsWith('.html')) {
    const html = await readFile(path, 'utf8');
    assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>/i, 'Inline scripts violate MV3 CSP');
    assert.doesNotMatch(html, /\bon(?:click|load|error|submit)=/i, 'Inline handlers violate MV3 CSP');
    for (const [, src] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert(!src.startsWith('http'), 'Runtime resources must be local');
      await access(resolve(path, '..', src));
    }
  }
  if (path.endsWith('.png')) {
    const png = await readFile(path);
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    const size = Number(path.match(/icon-(\d+)/)[1]);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
}
console.log(`PASS: Manifest V3, ${new Set(resources).size} manifest resources, JS syntax, local assets, CSP and icon dimensions.`);
