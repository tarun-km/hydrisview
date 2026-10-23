// Validates product documents: front matter, Mermaid diagrams (renders each one) and house style.
// Usage: node check.js [file.md ...]   (default: every document in docs/product)
const fs = require('fs');
const path = require('path');
const { frontMatter, mermaidBlocks } = require('./md');
const { renderAll } = require('./mermaid-render');

const DOCS = path.resolve(__dirname, '..');
const REQUIRED = ['title', 'subtitle', 'docId', 'version', 'status', 'owner', 'audience'];

(async () => {
  const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f)) : fs.readdirSync(DOCS).filter((f) => f.endsWith('.md')).map((f) => path.join(DOCS, f));
  let problems = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(process.cwd(), file);
    const { meta } = frontMatter(src);
    for (const k of REQUIRED) if (!meta[k]) { console.log(`${rel}: front matter is missing "${k}"`); problems++; }
    src.split('\n').forEach((l, i) => { if (l.includes('—')) { console.log(`${rel}:${i + 1}: em dash (house style: use a colon, comma or parentheses)`); problems++; } });
    const blocks = mermaidBlocks(src);
    const res = await renderAll(blocks);
    res.forEach((r, i) => {
      if (r.error) { console.log(`${rel}:${blocks[i].line}: mermaid error: ${r.error.split('\n').slice(0, 4).join(' | ')}`); problems++; }
      else if (!/%%\s*caption:/.test(blocks[i].code)) { console.log(`${rel}:${blocks[i].line}: diagram has no "%% caption:" line`); problems++; }
    });
    const words = src.replace(/```[\s\S]*?```/g, '').split(/\s+/).filter(Boolean).length;
    console.log(`${rel}: ${words} words, ${blocks.length} diagrams${res.some((r) => r.error) ? '' : ' (all render)'}`);
  }
  console.log(problems ? `\n${problems} problem(s)` : '\nOK');
  process.exit(problems ? 1 : 0);
})();
