const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.marked = require('../lib/marked.min.js');
require('../src/parser.js');
const { parse, tableMarkdown } = globalThis.XMD;

test('H1 becomes the title; H2/H3 map to h1/h2', () => {
  const p = parse('# 제목\n\n## 섹션\n\n### 소섹션\n\n본문');
  assert.equal(p.title, '제목');
  assert.equal(p.blocks.length, 1);
  assert.equal(p.blocks[0].type, 'html');
  assert.match(p.blocks[0].html, /^<h1>섹션<\/h1><h2>소섹션<\/h2><p>본문<\/p>$/);
});

test('without H1, H2 still maps to h1 and H3 to h2', () => {
  const p = parse('## A\n\n### B\n\n#### C');
  assert.equal(p.title, null);
  assert.equal(p.blocks[0].html, '<h1>A</h1><h2>B</h2><h2>C</h2>');
});

test('table becomes a table block with clean GFM markdown', () => {
  const p = parse('| a | b |\n|---|:-:|\n| `x` | y\\|z |');
  assert.equal(p.blocks.length, 1);
  assert.equal(p.blocks[0].type, 'table');
  assert.equal(p.blocks[0].markdown, '| a | b |\n| --- | :---: |\n| `x` | y\\|z |');
});

test('fenced code becomes a code block and splits surrounding html', () => {
  const p = parse('앞\n\n```text\ntree\n├── a\n```\n\n뒤');
  assert.deepEqual(
    p.blocks.map((b) => b.type),
    ['html', 'code', 'html']
  );
  assert.equal(p.blocks[1].lang, 'text');
  assert.equal(p.blocks[1].text, 'tree\n├── a');
});

test('inline code is plain by default and backticked on request', () => {
  const md = '값은 `x` 다';
  assert.equal(parse(md).blocks[0].html, '<p>값은 x 다</p>');
  assert.equal(parse(md, { inlineCode: 'backticks' }).blocks[0].html, '<p>값은 `x` 다</p>');
});

test('bold, links, lists, blockquote and hr', () => {
  const p = parse('**굵게** [링크](https://e.com)\n\n- 하나\n- 둘\n\n> 인용\n\n---\n\n끝');
  assert.equal(p.blocks[0].type, 'html');
  assert.match(p.blocks[0].html, /<strong>굵게<\/strong> <a href="https:\/\/e.com">링크<\/a>/);
  assert.match(p.blocks[0].html, /<ul><li>하나<\/li><li>둘<\/li><\/ul>/);
  assert.match(p.blocks[0].html, /<blockquote>인용<\/blockquote>/);
  assert.equal(p.blocks[1].type, 'divider');
  assert.equal(p.blocks[2].html, '<p>끝</p>');
});

test('frontmatter is stripped', () => {
  const p = parse('---\ntitle: x\n---\n# T\n\nbody');
  assert.equal(p.title, 'T');
  assert.equal(p.blocks[0].html, '<p>body</p>');
});

test('target document: codex-file-map.md', { skip: !fs.existsSync('/Users/gzonelee/git/codex-tip/docs/codex-file-map.md') }, () => {
  const md = fs.readFileSync('/Users/gzonelee/git/codex-tip/docs/codex-file-map.md', 'utf8');
  const p = parse(md);
  assert.equal(p.title, 'Codex가 읽는 파일 지도');
  const counts = p.blocks.reduce((a, b) => ((a[b.type] = (a[b.type] || 0) + 1), a), {});
  assert.equal(counts.table, 2);
  assert.equal(counts.code, 6);
  assert.equal(counts.divider || 0, 0);
  const html = p.blocks.filter((b) => b.type === 'html').map((b) => b.html).join('');
  assert.equal((html.match(/<h1>/g) || []).length, 7, 'seven H2 sections -> h1');
  assert.equal((html.match(/<h2>/g) || []).length, 3, 'three H3 -> h2');
  assert.ok(!/<code>/.test(html), 'no inline <code> left in body html');
  assert.match(p.blocks.find((b) => b.type === 'table').markdown, /^\| 범위 \| 대표 위치 \| 쓰임 \|/);
});
