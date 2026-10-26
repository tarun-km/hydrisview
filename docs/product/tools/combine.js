// Combines every product document into one Markdown file (each document becomes a part),
// builds it into a single Word file, then removes the temporary Markdown.
// Usage: node combine.js     then: powershell -File finalize.ps1 -Filter "Hydris Field Glasses*"
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { frontMatter } = require('./md');

const DOCS = path.resolve(__dirname, '..');
const docs = fs.readdirSync(DOCS).filter((f) => f.endsWith('.md'))
  .map((f) => ({ f, ...frontMatter(fs.readFileSync(path.join(DOCS, f), 'utf8')) }))
  .sort((a, b) => String(a.meta.order).localeCompare(String(b.meta.order)));

/** Demote headings one level outside code fences; drop the document's own # title. */
function demote(body) {
  let fence = false;
  return body.split('\n').map((l) => {
    if (/^\s*```/.test(l)) fence = !fence;
    if (fence) return l;
    if (/^# /.test(l)) return null;
    return /^#{2,5} /.test(l) ? '#' + l : l;
  }).filter((l) => l !== null).join('\n');
}

const parts = docs.map(({ meta, body }) => [
  `## ${meta.title}`,
  '',
  `> [!NOTE]`,
  `> **${meta.docId} v${meta.version}** · ${meta.status} · Owner: ${meta.owner}. ${meta.subtitle}`,
  '',
  demote(body),
].join('\n'));

const out = [
  '---',
  'title: Hydris Field Glasses: Complete Product Documentation',
  'subtitle: Requirements, architecture, data, APIs, apps, glasses, design, deployment, security, quality, operations and roadmap in one volume',
  'short: Complete product documentation',
  'docId: HFG-ALL',
  'version: 2.0',
  'status: Draft for review',
  'owner: Product and engineering, Hydris',
  'audience: Everyone building, deploying, operating, reviewing or evaluating Hydris Field Glasses',
  'wordName: Field Glasses Complete Documentation',
  'category: Complete documentation',
  `date: ${docs[0].meta.date || ''}`,
  'change: Single volume combining all thirteen product documents',
  'numberH4: yes',
  '---',
  '',
  '# Complete Product Documentation',
  '',
  'This volume combines the full Hydris Field Glasses documentation suite. Each part is one document; its chapters keep their original order.',
  '',
  parts.join('\n\n'),
].join('\n');

const tmp = path.join(DOCS, '_combined.md');
fs.writeFileSync(tmp, out);
try {
  execFileSync(process.execPath, [path.join(__dirname, 'build.js'), tmp], { stdio: 'inherit' });
} finally {
  fs.unlinkSync(tmp);
}
