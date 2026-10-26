// Builds each Product Book part (docs/product/book/NN-*.md) as its own Word file:
// "docs/product/word/Product Book NN <Part title>.docx".
// Usage: node book-split.js     then: powershell -File finalize.ps1 -Filter "Product Book*"
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { frontMatter } = require('./md');

const DOCS = path.resolve(__dirname, '..');
const BOOK = path.join(DOCS, 'book');

for (const f of fs.readdirSync(BOOK).filter((x) => /^\d.*\.md$/.test(x)).sort()) {
  const { meta, body } = frontMatter(fs.readFileSync(path.join(BOOK, f), 'utf8'));
  const n = f.slice(0, 2);
  const title = (/^## (.+)$/m.exec(body) || [])[1] || meta.title;
  const md = [
    '---',
    `title: ${title}`,
    `subtitle: ${meta.subtitle || 'Hydris Field Glasses Product Book'}`,
    `short: ${title}`,
    `docId: HFG-BOOK-${n}`,
    'version: 1.0',
    'status: Draft for review',
    'owner: Product and engineering, Hydris',
    'audience: Leadership, product, engineering, design, partners and pilot customers',
    `order: Product Book ${n}`,
    `wordName: ${title.replace(/[()]/g, '').replace(/^Hydris /, '')}`,
    `category: Product book, part ${+n}`,
    'date: October 2026',
    'change: First edition',
    'compact: yes',
    'figMaxH: 340',
    'shotScale: 0.55',
    'breaks: no',
    '---',
    '',
    body.replace(/\(\.\.\/images\//g, '(images/'),
  ].join('\n');
  const tmp = path.join(DOCS, `_part${n}.md`);
  fs.writeFileSync(tmp, md);
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'build.js'), tmp], { stdio: 'inherit' });
  } finally {
    fs.unlinkSync(tmp);
  }
}
