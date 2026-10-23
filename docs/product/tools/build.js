// Builds the Hydris product documents (docs/product/*.md) into branded Word files (docs/product/word/).
// Usage: node build.js [file.md ...]      then: powershell -File finalize.ps1   (updates tables of contents via Word)
const fs = require('fs');
const path = require('path');
const {
  AlignmentType, BorderStyle, Document, ExternalHyperlink, Footer, Header, HeadingLevel, HorizontalPositionRelativeFrom,
  ImageRun, LevelFormat, Packer, PageBreak, PageNumber, Paragraph, ShadingType, Tab, TabStopType, Table, TableCell,
  TableOfContents, TableRow, TextRun, VerticalAlign, VerticalPositionRelativeFrom, WidthType, TextWrappingType,
} = require('docx');
const { frontMatter, mermaidCaption, lex } = require('./md');
const { renderAll, launch } = require('./mermaid-render');

const DOCS = path.resolve(__dirname, '..');
const OUT = path.join(DOCS, 'word');
const ASSETS = path.join(__dirname, 'assets');
const CACHE = path.join(__dirname, '.cache');

// Brand (Hydris style guide): navy + blue dominate, purple sparingly, green for positive only.
const C = {
  navy: '0C1E85', blue: '1746E4', bright: '1954F1', purple: '8A60F0', indigo: '3346B0', ink: '081116', body: '1E2A33',
  tint: 'EEF2FE', tint2: 'F6F8FE', border: 'D5DEF7', gray: '5B6472', green: '12925A', orange: 'F26414', red: 'D92D0B', white: 'FFFFFF',
};
const FONT = { head: 'Arial', body: 'Calibri', mono: 'Consolas' };
const PAGE = { w: 11906, h: 16838, margin: 1247 }; // A4, 0.87in margins
const TEXT_W = PAGE.w - 2 * PAGE.margin; // 9412 DXA
const TEXT_PX = Math.floor((TEXT_W / 1440) * 96); // ~627 px at 96 dpi
const MONTH = new Date().toLocaleString('en-GB', { month: 'long', year: 'numeric' });

const CALLOUTS = {
  NOTE: { label: 'Note', color: C.bright, fill: 'EEF2FE' },
  TIP: { label: 'Tip', color: C.green, fill: 'EAF6F0' },
  IMPORTANT: { label: 'Important', color: C.purple, fill: 'F3EEFE' },
  WARNING: { label: 'Warning', color: C.orange, fill: 'FFF4EC' },
  CAUTION: { label: 'Caution', color: C.red, fill: 'FDEDEA' },
  DECISION: { label: 'Decision', color: C.navy, fill: 'EEF0FA' },
  RISK: { label: 'Risk', color: C.orange, fill: 'FFF4EC' },
  EXAMPLE: { label: 'Example', color: C.indigo, fill: 'F1F3FB' },
};

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (s) => String(s ?? '').replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => ENT[e] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));
const plain = (tokens) => (tokens || []).map((t) => (t.tokens ? plain(t.tokens) : decode(t.text ?? ''))).join('');

/** Pixel size of a PNG or JPEG file. */
function imageSize(file) {
  const b = fs.readFileSync(file);
  if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let i = 2; i < b.length;) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error(`Unsupported image: ${file}`);
}

/* ---------------------------------------------------------------- inline */

function inline(tokens, base = {}) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'strong': out.push(...inline(t.tokens, { ...base, bold: true })); break;
      case 'em': out.push(...inline(t.tokens, { ...base, italics: true })); break;
      case 'del': out.push(...inline(t.tokens, { ...base, strike: true })); break;
      case 'codespan':
        out.push(new TextRun({ ...base, text: decode(t.text), font: FONT.mono, size: Math.round((base.size || 21) * 0.86), color: base.color || C.indigo, shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.tint } }));
        break;
      case 'br': out.push(new TextRun({ ...base, break: 1 })); break;
      case 'link': {
        const runs = inline(t.tokens, { ...base, color: C.bright, underline: {} });
        if (/^https?:/.test(t.href)) out.push(new ExternalHyperlink({ link: t.href, children: runs }));
        else out.push(...inline(t.tokens, { ...base, color: C.blue }));
        break;
      }
      case 'image': out.push(new TextRun({ ...base, text: decode(t.text), italics: true })); break;
      case 'text': case 'escape':
        if (t.tokens) out.push(...inline(t.tokens, base));
        else out.push(new TextRun({ ...base, text: decode(t.text) }));
        break;
      case 'html': break;
      default: if (t.text) out.push(new TextRun({ ...base, text: decode(t.text) }));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- blocks */

class Builder {
  constructor(file, meta, diagrams) {
    this.file = file; this.meta = meta; this.diagrams = diagrams; this.d = 0;
    this.fig = 0; this.tab = 0; this.h = [0, 0, 0]; this.listInstance = 0;
    this.pendingTableCaption = null;
  }

  heading(t) {
    const text = plain(t.tokens);
    if (t.depth === 1) return []; // document title lives on the cover
    let num = '';
    if (t.depth === 2) { this.h = [this.h[0] + 1, 0, 0]; num = `${this.h[0]}`; }
    else if (t.depth === 3) { this.h[1]++; this.h[2] = 0; num = `${this.h[0]}.${this.h[1]}`; }
    else if (t.depth === 4) { this.h[2]++; num = this.meta.numberH4 === 'yes' ? `${this.h[0]}.${this.h[1]}.${this.h[2]}` : ''; }
    const level = [null, null, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4][Math.min(t.depth, 5)];
    const runs = [];
    if (num && this.meta.numbered !== 'no') runs.push(new TextRun({ text: `${num}  `, color: t.depth === 2 ? C.bright : undefined }));
    runs.push(new TextRun({ text }));
    return [new Paragraph({ heading: level, children: runs, pageBreakBefore: t.depth === 2 && this.h[0] > 1 && this.meta.breaks !== 'no', keepNext: true })];
  }

  paragraph(t, opts = {}) {
    // A paragraph that is only an image becomes a figure.
    const toks = t.tokens || [];
    const imgs = toks.filter((x) => x.type === 'image');
    if (imgs.length === 1 && toks.every((x) => x.type === 'image' || (x.type === 'text' && !x.text.trim()))) return this.imageFigure(imgs[0]);
    const txt = plain(toks);
    const cap = /^Table:\s*(.+)$/.exec(txt.trim());
    if (cap && !opts.inCell) { this.pendingTableCaption = cap[1]; return []; }
    return [new Paragraph({ children: inline(toks, opts.run), spacing: opts.spacing, alignment: opts.align, keepNext: opts.keepNext })];
  }

  list(t, level = 0, opts = {}) {
    const out = [];
    const ref = t.ordered ? 'numbers' : 'bullets';
    const instance = t.ordered ? ++this.listInstance : 0;
    for (const item of t.items) {
      let first = true;
      for (const b of item.tokens) {
        if (b.type === 'list') { out.push(...this.list(b, Math.min(level + 1, 2), opts)); continue; }
        const toks = b.type === 'text' ? (b.tokens || [{ type: 'text', text: b.text }]) : b.tokens || [];
        const runs = [];
        if (first && item.task) runs.push(new TextRun({ text: item.checked ? '☑ ' : '☐ ', color: item.checked ? C.green : C.gray }));
        runs.push(...inline(toks, opts.run));
        out.push(new Paragraph({
          children: runs,
          numbering: first ? { reference: ref, level, ...(t.ordered ? { instance } : {}) } : undefined,
          indent: first ? undefined : { left: 360 * (level + 1) + 360 },
          spacing: { after: 60 },
        }));
        first = false;
      }
    }
    return out;
  }

  code(t) {
    if (t.lang === 'mermaid') return this.mermaid(t);
    const lines = decode(t.text).split('\n');
    return lines.map((l, i) => new Paragraph({
      children: [new TextRun({ text: l.length ? l.replace(/\t/g, '  ') : ' ', font: FONT.mono, size: 16, color: C.ink })],
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F4F6FA' },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: C.bright, space: 8 } },
      spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 160 : 0, line: 240 },
      indent: { left: 160, right: 160 },
      keepLines: lines.length < 25, keepNext: i < lines.length - 1 && lines.length < 25,
    }));
  }

  figure(file, wPx, hPx, caption) {
    const type = /\.jpe?g$/i.test(file) ? 'jpg' : 'png';
    const maxH = 860;
    let w = wPx, h = hPx;
    if (w > TEXT_PX) { h = (h * TEXT_PX) / w; w = TEXT_PX; }
    if (h > maxH) { w = (w * maxH) / h; h = maxH; }
    const out = [new Paragraph({ alignment: AlignmentType.CENTER, keepNext: !!caption, spacing: { before: 120, after: caption ? 60 : 160 }, children: [new ImageRun({ type, data: fs.readFileSync(file), transformation: { width: Math.round(w), height: Math.round(h) }, altText: { title: caption || 'Figure', description: caption || 'Figure', name: path.basename(file) } })] })];
    if (caption) {
      this.fig++;
      out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 220 }, children: [new TextRun({ text: `Figure ${this.fig}. `, bold: true, color: C.navy, size: 18 }), new TextRun({ text: caption, italics: true, color: C.gray, size: 18 })] }));
    }
    return out;
  }

  mermaid(t) {
    const r = this.diagrams[this.d++];
    if (!r || r.error) throw new Error(`${path.basename(this.file)}: diagram ${this.d} failed to render: ${r && r.error}`);
    return this.figure(r.file, r.width, r.height, mermaidCaption(t.text));
  }

  imageFigure(img) {
    const file = path.resolve(path.dirname(this.file), decode(img.href));
    if (!fs.existsSync(file)) throw new Error(`${path.basename(this.file)}: image not found: ${img.href}`);
    const [pw, ph] = imageSize(file);
    // Default display width suits phone screenshots; a numeric title sets the width in px (627 = full text width).
    const scale = img.title && /^\d+$/.test(img.title) ? Math.min(+img.title, TEXT_PX) / pw : Math.min(1, 300 / pw);
    return this.figure(file, pw * scale, ph * scale, decode(img.text) || null);
  }

  table(t) {
    const cols = t.header.length;
    const lens = t.header.map((h, i) => Math.max(plain(h.tokens).length, ...t.rows.map((r) => Math.min(60, plain(r[i]?.tokens).length))) + 4);
    const total = lens.reduce((a, b) => a + b, 0);
    // Never narrower than the longest word in the column (IDs like HFG-PRD must not wrap).
    const longest = t.header.map((h, i) => Math.max(...[h, ...t.rows.map((r) => r[i])].map((c) => Math.max(0, ...plain(c?.tokens).split(/\s+/).map((w) => w.length)))));
    const minW = longest.map((n, i) => Math.min(2600, Math.max(800, n * (i === 0 ? 112 : 100) + 220)));
    let widths = lens.map((l, i) => Math.max(minW[i], Math.round((l / total) * TEXT_W)));
    const s = widths.reduce((a, b) => a + b, 0);
    widths = widths.map((w) => Math.floor((w * TEXT_W) / s));
    widths[cols - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
    const align = (i) => ({ center: AlignmentType.CENTER, right: AlignmentType.RIGHT }[t.align[i]] || AlignmentType.LEFT);
    const border = { style: BorderStyle.SINGLE, size: 4, color: C.border };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (toks, i, header, zebra) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA }, borders, verticalAlign: VerticalAlign.CENTER,
      margins: { top: 70, bottom: 70, left: 100, right: 100 },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill: header ? C.navy : zebra ? C.tint2 : C.white },
      children: [new Paragraph({ alignment: align(i), spacing: { after: 0, line: 252 }, children: inline(toks, header ? { bold: true, color: C.white, size: 18, font: FONT.head } : { size: 18 }) })],
    });
    const rows = [new TableRow({ tableHeader: true, cantSplit: true, children: t.header.map((h, i) => cell(h.tokens, i, true)) })];
    t.rows.forEach((r, ri) => rows.push(new TableRow({ cantSplit: true, children: r.map((c, i) => cell(c.tokens, i, false, ri % 2 === 1)) })));
    const out = [];
    if (this.pendingTableCaption) {
      this.tab++;
      out.push(new Paragraph({ keepNext: true, spacing: { before: 160, after: 80 }, children: [new TextRun({ text: `Table ${this.tab}. `, bold: true, color: C.navy, size: 18 }), new TextRun({ text: this.pendingTableCaption, bold: true, color: C.body, size: 18 })] }));
      this.pendingTableCaption = null;
    }
    out.push(new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths, rows }));
    out.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
    return out;
  }

  blockquote(t) {
    const first = t.tokens[0];
    const raw = first && first.type === 'paragraph' ? first.text : '';
    const m = /^\[!(\w+)\]\s*/.exec(raw);
    if (m && m[1].toUpperCase() === 'STATS') return this.stats(t);
    const kind = m && CALLOUTS[m[1].toUpperCase()];
    const style = kind || { label: null, color: C.indigo, fill: C.tint2 };
    let blocks = t.tokens;
    if (m) {
      // Strip the [!TYPE] marker from the first paragraph.
      const rest = raw.slice(m[0].length);
      blocks = [...(rest.trim() ? lex(rest) : []), ...t.tokens.slice(1)];
    }
    const children = [];
    if (style.label) children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: style.label.toUpperCase(), bold: true, color: style.color, size: 17, font: FONT.head, characterSpacing: 30 })] }));
    for (const b of blocks) children.push(...this.block(b, { inCell: true, run: kind ? {} : { italics: true, color: C.body } }));
    if (!children.length) children.push(new Paragraph({ children: [] }));
    const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
    return [
      new Table({
        width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [TEXT_W],
        rows: [new TableRow({ cantSplit: children.length < 14, children: [new TableCell({
          width: { size: TEXT_W, type: WidthType.DXA }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: style.fill },
          margins: { top: 120, bottom: 80, left: 220, right: 200 },
          borders: { top: none, bottom: none, right: none, left: { style: BorderStyle.SINGLE, size: 24, color: style.color } },
          children,
        })] })],
      }),
      new Paragraph({ spacing: { after: 120 }, children: [] }),
    ];
  }

  stats(t) {
    // > [!STATS]  followed by "- value | label" items: a row of KPI tiles.
    const list = t.tokens.find((x) => x.type === 'list');
    const items = (list ? list.items : []).map((i) => i.text.split('|').map((s) => s.trim()));
    const out = [];
    for (let k = 0; k < items.length; k += 4) {
      const row = items.slice(k, k + 4);
      const gap = 120;
      const w = Math.floor((TEXT_W - gap * (row.length - 1)) / row.length);
      const widths = [];
      row.forEach((_, i) => { widths.push(w); if (i < row.length - 1) widths.push(gap); });
      widths[widths.length - 1] += TEXT_W - widths.reduce((a, b) => a + b, 0);
      const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
      const nb = { top: none, bottom: none, left: none, right: none };
      const cells = [];
      row.forEach(([value, label, note], i) => {
        cells.push(new TableCell({
          width: { size: widths[cells.length], type: WidthType.DXA }, borders: { ...nb, top: { style: BorderStyle.SINGLE, size: 18, color: C.bright } },
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.tint }, margins: { top: 140, bottom: 140, left: 160, right: 120 },
          children: [
            new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: decode(value), bold: true, size: 40, color: C.navy, font: FONT.head })] }),
            new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: decode(label || ''), size: 17, color: C.body, bold: true })] }),
            ...(note ? [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: decode(note), size: 16, color: C.gray })] })] : []),
          ],
        }));
        if (i < row.length - 1) cells.push(new TableCell({ width: { size: gap, type: WidthType.DXA }, borders: nb, children: [new Paragraph({ children: [] })] }));
      });
      out.push(new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths, rows: [new TableRow({ cantSplit: true, children: cells })] }));
      out.push(new Paragraph({ spacing: { after: 140 }, children: [] }));
    }
    return out;
  }

  block(t, opts = {}) {
    switch (t.type) {
      case 'heading': return opts.inCell ? [new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: plain(t.tokens), bold: true, color: C.navy })] })] : this.heading(t);
      case 'paragraph': return this.paragraph(t, opts);
      case 'text': return [new Paragraph({ children: inline(t.tokens || [{ type: 'text', text: t.text }], opts.run) })];
      case 'list': return this.list(t, 0, opts);
      case 'code': return this.code(t);
      case 'table': return this.table(t);
      case 'blockquote': return this.blockquote(t);
      case 'hr': return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.border, space: 4 } }, spacing: { after: 160 }, children: [] })];
      default: return [];
    }
  }
}

/* ---------------------------------------------------------------- cover & frame */

async function renderCover(meta, file) {
  fs.mkdirSync(CACHE, { recursive: true });
  const png = path.join(CACHE, `cover-${path.basename(file, '.md')}.jpg`);
  const logo = fs.readFileSync(path.join(ASSETS, 'logo_h_white.png')).toString('base64');
  const mark = fs.readFileSync(path.join(ASSETS, 'icon_trim.png')).toString('base64');
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const html = `<!doctype html><html><head><style>
    *{box-sizing:border-box;margin:0}body{width:794px;height:1123px;font-family:Arial,sans-serif;color:#fff;overflow:hidden}
    .p{position:relative;width:794px;height:1123px;background:radial-gradient(120% 80% at 100% 0%,#1954F1 0%,#1746E4 18%,#0C1E85 55%,#060E45 100%);padding:64px 64px 56px}
    .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(180deg,#000 0%,transparent 70%)}
    .mark{position:absolute;right:-150px;bottom:150px;width:560px;opacity:.10;filter:brightness(0) invert(1)}
    .logo{height:36px;position:relative}
    .eyebrow{margin-top:250px;font-size:13px;letter-spacing:.28em;text-transform:uppercase;color:#9DB4FA;font-weight:700;position:relative}
    h1{margin-top:18px;font-size:50px;line-height:1.06;font-weight:700;letter-spacing:-.01em;position:relative;max-width:640px}
    .sub{margin-top:20px;font-size:19px;line-height:1.45;color:#D5DEF7;max-width:600px;position:relative}
    .bar{margin-top:34px;width:84px;height:5px;background:#8A60F0;border-radius:3px;position:relative}
    .meta{position:absolute;left:64px;right:64px;bottom:96px;display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:1px solid rgba(255,255,255,.25);padding-top:20px}
    .meta div{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9DB4FA;font-weight:700}
    .meta b{display:block;margin-top:7px;font-size:15px;letter-spacing:0;text-transform:none;color:#fff;font-weight:700}
    .foot{position:absolute;left:64px;right:64px;bottom:40px;font-size:11px;color:#9DB4FA;display:flex;justify-content:space-between}
  </style></head><body><div class="p"><div class="grid"></div><img class="mark" src="data:image/png;base64,${mark}">
    <img class="logo" src="data:image/png;base64,${logo}">
    <div class="eyebrow">Hydris Field Glasses &nbsp;·&nbsp; ${esc(meta.category || 'Product documentation')}</div>
    <h1>${esc(meta.title)}</h1><div class="sub">${esc(meta.subtitle)}</div><div class="bar"></div>
    <div class="meta"><div>Document<b>${esc(meta.docId)}</b></div><div>Version<b>${esc(meta.version)}</b></div><div>Status<b>${esc(meta.status)}</b></div><div>Date<b>${esc(meta.date || MONTH)}</b></div></div>
    <div class="foot"><span>Hydris, Inc. &nbsp;·&nbsp; Confidential</span><span>hydrisview.vercel.app</span></div>
  </div></body></html>`;
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 2.5 });
    await page.setContent(html);
    await page.screenshot({ path: png, type: 'jpeg', quality: 90 });
  } finally { await browser.close(); }
  return png;
}

function infoTable(rows) {
  const w1 = 2400, w2 = TEXT_W - w1;
  const b = { style: BorderStyle.SINGLE, size: 4, color: C.border };
  const borders = { top: b, bottom: b, left: b, right: b };
  return new Table({
    width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: [w1, w2],
    rows: rows.map(([k, v]) => new TableRow({ cantSplit: true, children: [
      new TableCell({ width: { size: w1, type: WidthType.DXA }, borders, shading: { type: ShadingType.CLEAR, color: 'auto', fill: C.tint }, margins: { top: 70, bottom: 70, left: 120, right: 100 }, children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: k, bold: true, color: C.navy, size: 18, font: FONT.head })] })] }),
      new TableCell({ width: { size: w2, type: WidthType.DXA }, borders, margins: { top: 70, bottom: 70, left: 120, right: 100 }, children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: v, size: 19 })] })] }),
    ] })),
  });
}

function sectionTitle(text) {
  return new Paragraph({ spacing: { before: 0, after: 160 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.bright, space: 6 } }, children: [new TextRun({ text, bold: true, font: FONT.head, size: 30, color: C.navy })] });
}

/* ---------------------------------------------------------------- document */

async function buildOne(file) {
  const src = fs.readFileSync(file, 'utf8');
  const { meta, body } = frontMatter(src);
  const tokens = lex(body);
  const mer = [];
  (function walk(ts) { for (const t of ts) { if (t.type === 'code' && t.lang === 'mermaid') mer.push({ code: t.text }); if (t.tokens && t.type === 'blockquote') walk(t.tokens); } })(tokens);
  const diagrams = await renderAll(mer);
  const b = new Builder(file, meta, diagrams);

  // Intro text before the first ## becomes the "About this document" block.
  const content = [];
  for (const t of tokens) content.push(...b.block(t));

  const cover = await renderCover(meta, file);
  const control = [
    ['Document', `${meta.title} (${meta.docId})`], ['Version', meta.version], ['Status', meta.status], ['Owner', meta.owner],
    ['Audience', meta.audience], ['Product', 'Hydris Field Glasses: website, operator console, glasses app, Android app, API'],
    ['Source of truth', `docs/product/${path.basename(file)} in tarun-km/hydrisview (this Word file is generated from it)`], ['Classification', 'Confidential: Hydris, Inc. and named partners'],
  ];
  const history = (meta.history || `${meta.version}|${meta.date || MONTH}|${meta.owner}|${meta.change || 'Expanded edition: detail, diagrams and visualisations'}`).split(';').map((r) => r.split('|').map((s) => s.trim()));

  const historyTable = (() => {
    const widths = [1200, 1700, 2000, TEXT_W - 4900];
    const bd = { style: BorderStyle.SINGLE, size: 4, color: C.border };
    const borders = { top: bd, bottom: bd, left: bd, right: bd };
    const mk = (cells, header) => new TableRow({ tableHeader: header, children: cells.map((c, i) => new TableCell({ width: { size: widths[i], type: WidthType.DXA }, borders, margins: { top: 70, bottom: 70, left: 100, right: 100 }, shading: { type: ShadingType.CLEAR, color: 'auto', fill: header ? C.navy : C.white }, children: [new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: c || '', size: 18, bold: header, color: header ? C.white : C.body, font: header ? FONT.head : FONT.body })] })] })) });
    return new Table({ width: { size: TEXT_W, type: WidthType.DXA }, columnWidths: widths, rows: [mk(['Version', 'Date', 'Author', 'Changes'], true), ...history.map((r) => mk(r))] });
  })();

  const shortTitle = meta.short || meta.title;
  const logoDark = fs.readFileSync(path.join(ASSETS, 'logo_h_dark.png'));
  const header = new Header({ children: [new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.border, space: 6 } },
    children: [new TextRun({ text: 'HYDRIS FIELD GLASSES', bold: true, size: 15, color: C.bright, font: FONT.head, characterSpacing: 20 }), new TextRun({ text: `   ${shortTitle}`, size: 16, color: C.gray }), new TextRun({ children: [new Tab()] }), new ImageRun({ type: 'png', data: logoDark, transformation: { width: 82, height: 17 } })],
  })] });
  const footer = new Footer({ children: [new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: TEXT_W }],
    children: [new TextRun({ text: `Hydris, Inc.  ·  Confidential  ·  ${meta.date || MONTH}`, size: 15, color: C.gray }), new TextRun({ children: [new Tab(), `${meta.docId} v${meta.version}  ·  Page `, PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], size: 15, color: C.gray })],
  })] });

  const doc = new Document({
    creator: 'Hydris, Inc.', title: meta.title, subject: meta.subtitle, description: `${meta.docId} v${meta.version}`, keywords: 'Hydris, Field Glasses',
    styles: {
      default: { document: { run: { font: FONT.body, size: 21, color: C.body }, paragraph: { spacing: { after: 120, line: 276 } } } },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT.head, size: 34, bold: true, color: C.navy }, paragraph: { spacing: { before: 120, after: 220 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.bright, space: 6 } } } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT.head, size: 26, bold: true, color: C.blue }, paragraph: { spacing: { before: 300, after: 110 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT.head, size: 22, bold: true, color: C.ink }, paragraph: { spacing: { before: 220, after: 80 }, outlineLevel: 2 } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT.body, size: 21, bold: true, color: C.indigo }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 3 } },
      ],
    },
    numbering: {
      config: [
        { reference: 'bullets', levels: [0, 1, 2].map((l) => ({ level: l, format: LevelFormat.BULLET, text: ['●', '○', '▪'][l], alignment: AlignmentType.LEFT, style: { run: { color: l === 0 ? C.bright : C.indigo, size: l === 0 ? 14 : 16 }, paragraph: { indent: { left: 360 * (l + 1), hanging: 260 } } } })) },
        { reference: 'numbers', levels: [0, 1, 2].map((l) => ({ level: l, format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][l], text: `%${l + 1}.`, alignment: AlignmentType.LEFT, style: { run: { color: C.navy, bold: true }, paragraph: { indent: { left: 360 * (l + 1) + 40, hanging: 320 } } } })) },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE.w, height: PAGE.h }, margin: { top: 0, bottom: 0, left: 0, right: 0, header: 0, footer: 0 } } },
        children: [new Paragraph({ spacing: { after: 0, line: 240 }, children: [new ImageRun({ type: 'jpg', data: fs.readFileSync(cover), transformation: { width: 794, height: 1123 }, floating: { horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 }, verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 }, behindDocument: true, wrap: { type: TextWrappingType.NONE } }, altText: { title: meta.title, description: `Cover: ${meta.title}`, name: 'cover' } })] })],
      },
      {
        properties: { page: { size: { width: PAGE.w, height: PAGE.h }, margin: { top: 1300, bottom: 1150, left: PAGE.margin, right: PAGE.margin, header: 560, footer: 520 } } },
        headers: { default: header }, footers: { default: footer },
        children: [
          sectionTitle('Document control'), infoTable(control),
          new Paragraph({ spacing: { before: 280, after: 100 }, children: [new TextRun({ text: 'Revision history', bold: true, font: FONT.head, size: 24, color: C.blue })] }), historyTable,
          new Paragraph({ children: [new PageBreak()] }),
          sectionTitle('Contents'),
          new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
          new Paragraph({ children: [new PageBreak()] }),
          ...content,
        ],
      },
    ],
  });
  fs.mkdirSync(OUT, { recursive: true });
  const name = `${meta.order ? meta.order + ' ' : ''}Hydris ${meta.wordName || meta.title}.docx`.replace(/[\\/:*?"<>|]/g, '');
  const outFile = path.join(OUT, name);
  fs.writeFileSync(outFile, await Packer.toBuffer(doc));
  return { outFile, figures: b.fig, tables: b.tab };
}

(async () => {
  const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f)) : fs.readdirSync(DOCS).filter((f) => f.endsWith('.md')).map((f) => path.join(DOCS, f));
  for (const f of files) {
    const r = await buildOne(f);
    console.log(`${path.basename(f)} -> ${path.relative(DOCS, r.outFile)} (${r.figures} figures, ${r.tables} captioned tables)`);
  }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
