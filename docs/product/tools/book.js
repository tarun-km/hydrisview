// Assembles the Product Book (docs/product/book/*.md, in file order) into one Word file:
// "docs/product/word/Hydris Field Glasses Product Book.docx".
// Usage: node book.js     then: powershell -File finalize.ps1 -Filter "Hydris Field Glasses Product Book*"
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { frontMatter } = require('./md');

const DOCS = path.resolve(__dirname, '..');
const BOOK = path.join(DOCS, 'book');
const parts = fs.readdirSync(BOOK).filter((f) => /^\d.*\.md$/.test(f)).sort()
  .map((f) => frontMatter(fs.readFileSync(path.join(BOOK, f), 'utf8')).body.replace(/^# .*\n/m, '').replace(/\(\.\.\/images\//g, '(images/').trim());

const out = [
  '---',
  'title: Hydris Field Glasses Product Book',
  'subtitle: Every product and sub-product we are building: the problem, the users, the flows, the requirements and where each one stands',
  'short: Product book',
  'docId: HFG-BOOK',
  'version: 1.0',
  'status: Draft for review',
  'owner: Product and engineering, Hydris',
  'audience: Leadership, product, engineering, design, partners and pilot customers',
  'wordName: Field Glasses Product Book',
  'category: Product book',
  'date: October 2026',
  'compact: yes',
  'control: no',
  'figMaxH: 340',
  'shotScale: 0.55',
  'change: First edition: the full documentation suite condensed into one product-led volume',
  '---',
  '',
  '# Product Book',
  '',
  parts.join('\n\n'),
].join('\n');

const tmp = path.join(DOCS, '_book.md');
fs.writeFileSync(tmp, out);
try {
  execFileSync(process.execPath, [path.join(__dirname, 'build.js'), tmp], { stdio: 'inherit' });
} finally {
  fs.unlinkSync(tmp);
}
