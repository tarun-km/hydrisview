// Markdown helpers shared by check.js and build.js.
const { marked } = require('marked');

/** Split YAML-style front matter (flat key: value pairs) from the body. */
function frontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src);
  if (!m) return { meta: {}, body: src, offset: 0 };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: src.slice(m[0].length), offset: m[0].split('\n').length - 1 };
}

/** Mermaid caption convention: a first-line comment "%% caption: Text". */
function mermaidCaption(code) {
  const m = /^\s*%%\s*caption:\s*(.+)$/m.exec(code);
  return m ? m[1].trim() : null;
}

function lex(body) {
  return marked.lexer(body, { gfm: true });
}

/** All mermaid blocks with their 1-based line numbers in the source file. */
function mermaidBlocks(src) {
  const out = [];
  const re = /^```mermaid[^\n]*\n([\s\S]*?)^```/gm;
  let m;
  while ((m = re.exec(src))) out.push({ code: m[1], line: src.slice(0, m.index).split('\n').length });
  return out;
}

module.exports = { frontMatter, mermaidCaption, lex, mermaidBlocks };
