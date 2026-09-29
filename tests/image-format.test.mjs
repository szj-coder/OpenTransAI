import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const A = {};
vm.runInNewContext(await readFile(new URL('../extension/lib/image-format.js', import.meta.url), 'utf8'), { OpenTransAIPage: A });
const doc = text => JSON.parse(JSON.stringify(A.imageDocument(text)));

test('image layout preserves headings, paragraphs, original list numbering and code indentation', () => {
  const result = doc('# Release notes\n\nFirst paragraph.\nStill the same paragraph.\n\n- One\n  - Nested\n\n3. Third\n7. Seventh\n\n```js\n  const x = 1;\n```');
  assert.equal(result.blocks[0].tag, 'h2');
  assert.match(result.plain, /^Release notes\n\nFirst paragraph\.\nStill the same paragraph\./);
  assert.match(result.plain, /- One\n  - Nested/);
  assert.match(result.plain, /3\. Third\n7\. Seventh/);
  assert.match(result.plain, /  const x = 1;/);
  assert.doesNotMatch(result.plain, /```|^# /);
});
test('table cells retain blanks, escaped pipes, numbers and header associations', () => {
  const result = doc('| Item | Count | Note |\n| --- | ---: | --- |\n| A\\|B | 0 | |\n| C | 12.50 | **Ready** |');
  assert.equal(result.blocks[0].tag, 'div');
  assert.equal(result.blocks[0].children[0].tag, 'table');
  assert.equal(result.plain, 'Item\tCount\tNote\nA|B\t0\t\nC\t12.50\tReady');
});
test('malformed or incomplete tables retain every visible cell as plain text', () => {
  for (const text of ['| A | B |\n| --- | --- |\n| 1 | 2 | 3 |', '| A | B |\n| --- |']) {
    const result = doc(text);
    assert.equal(result.blocks[0].tag, 'p');
    assert.equal(result.plain, text);
  }
  const partial = doc('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3');
  assert.equal(partial.blocks[0].children[0].tag, 'table');
  assert.equal(partial.blocks[1].children[0], '| 3');
  assert.equal(partial.plain, 'A\tB\n1\t2\n| 3');
});
test('legacy OCR tabs remain readable without guessing table headers', () => {
  const text = 'Item\tCount\nApple\t2\nPear\t0';
  assert.equal(doc(text).plain, text);
});
test('image markup never becomes executable HTML, external media or links', () => {
  const text = '# <img src=x onerror=alert(1)>\n\n[go](javascript:alert(1)) ![pixel](https://tracker.test/x)\n<script>alert(1)</script>';
  const result = doc(text);
  assert.match(result.plain, /<img src=x onerror=alert\(1\)>/);
  assert.match(result.plain, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(JSON.stringify(result.blocks), /"tag":"(?:img|script|a|iframe)"/);
});
test('unfinished code fences and emphasis during streaming lose no content', () => {
  assert.equal(doc('```js\n  const x').plain, '  const x');
  assert.equal(doc('Some **unfinished').plain, 'Some **unfinished');
});
