// Assembles the Product Book (docs/product/book/*.md, in file order) into one Word file:
// "docs/product/word/Hydris Field Glasses Product Book.docx".
// Usage: node book.js     then: powershell -File finalize.ps1 -Filter "Hydris Field Glasses Product Book*"
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { frontMatter } = require('./md');

const DOCS = path.resolve(__dirname, '..');
const BOOK = path.join(DOCS, 'prd');
const parts = fs.readdirSync(BOOK).filter((f) => /^\d.*\.md$/.test(f)).sort()
  .map((f) => frontMatter(fs.readFileSync(path.join(BOOK, f), 'utf8')).body.replace(/^# .*\n/m, '').replace(/\(\.\.\/images\//g, '(images/').trim());

const out = [
  '---',
  'title: Hydris Field Glasses PRD',
  'subtitle: Product requirements for the Hydris Field Glasses platform and every product we are building',
  'short: Product requirements',
  'docId: HFG-PRD-C',
  'version: 1.0',
  'status: Draft for review',
  'owner: Product and engineering, Hydris',
  'audience: Leadership, product, engineering, design, partners and pilot customers',
  'wordName: Field Glasses PRD (Concise)',
  'category: Product requirements document',
  'date: October 2026',
  'compact: yes',
  'figMaxH: 340',
  'shotScale: 0.55',
  'change: Concise PRD edition',
  '---',
  '',
  '# Product Requirements Document',
  '',
  parts.join('\n\n'),
].join('\n');

const tmp = path.join(DOCS, '_prd.md');
fs.writeFileSync(tmp, out);
try {
  execFileSync(process.execPath, [path.join(__dirname, 'build.js'), tmp], { stdio: 'inherit' });
} finally {
  fs.unlinkSync(tmp);
}
