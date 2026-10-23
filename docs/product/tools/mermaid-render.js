// Renders Mermaid diagrams to PNG with headless Chromium (Playwright from the repo root).
// Results are cached by content hash in .cache/ so rebuilds are fast.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const CACHE = path.join(__dirname, '.cache');
const MERMAID_JS = require.resolve('mermaid/dist/mermaid.min.js');

// Hydris brand palette (docs/product/tools/README.md).
const THEME = {
  theme: 'base',
  themeVariables: {
    fontFamily: 'Calibri, Arial, sans-serif',
    fontSize: '15px',
    primaryColor: '#EEF2FE',
    primaryBorderColor: '#1954F1',
    primaryTextColor: '#081116',
    secondaryColor: '#F3EEFE',
    secondaryBorderColor: '#8A60F0',
    secondaryTextColor: '#081116',
    tertiaryColor: '#F7F9FC',
    tertiaryBorderColor: '#D5DEF7',
    lineColor: '#3346B0',
    textColor: '#081116',
    mainBkg: '#EEF2FE',
    nodeBorder: '#1954F1',
    clusterBkg: '#F7F9FC',
    clusterBorder: '#D5DEF7',
    titleColor: '#0C1E85',
    edgeLabelBackground: '#FFFFFF',
    actorBkg: '#0C1E85',
    actorBorder: '#0C1E85',
    actorTextColor: '#FFFFFF',
    actorLineColor: '#5B6472',
    signalColor: '#081116',
    signalTextColor: '#081116',
    labelBoxBkgColor: '#EEF2FE',
    labelBoxBorderColor: '#1954F1',
    noteBkgColor: '#FFF7E6',
    noteBorderColor: '#F26414',
    noteTextColor: '#081116',
    activationBkgColor: '#D5DEF7',
    activationBorderColor: '#1954F1',
    sequenceNumberColor: '#FFFFFF',
    // gantt
    sectionBkgColor: '#EEF2FE',
    altSectionBkgColor: '#FFFFFF',
    sectionBkgColor2: '#F3EEFE',
    taskBkgColor: '#1954F1',
    taskBorderColor: '#0C1E85',
    taskTextColor: '#FFFFFF',
    taskTextLightColor: '#FFFFFF',
    taskTextOutsideColor: '#081116',
    activeTaskBkgColor: '#8A60F0',
    activeTaskBorderColor: '#3346B0',
    doneTaskBkgColor: '#12925A',
    doneTaskBorderColor: '#0E6E44',
    critBkgColor: '#F26414',
    critBorderColor: '#C24E0E',
    todayLineColor: '#FF2800',
    gridColor: '#D5DEF7',
    // pie / charts
    pie1: '#1954F1', pie2: '#0C1E85', pie3: '#8A60F0', pie4: '#12925A', pie5: '#F26414',
    pie6: '#3346B0', pie7: '#6F93FF', pie8: '#5B6472', pie9: '#B9A2F7', pie10: '#9DB4FA',
    pieStrokeColor: '#FFFFFF', pieOuterStrokeColor: '#D5DEF7', pieTitleTextColor: '#0C1E85',
    pieSectionTextColor: '#FFFFFF', pieLegendTextColor: '#081116',
    // quadrant
    quadrant1Fill: '#EEF2FE', quadrant2Fill: '#F3EEFE', quadrant3Fill: '#F7F9FC', quadrant4Fill: '#EAF6F0',
    quadrantPointFill: '#1954F1', quadrantTitleFill: '#0C1E85',
    // xychart
    xyChart: { plotColorPalette: '#1954F1, #8A60F0, #12925A, #F26414, #0C1E85', backgroundColor: '#FFFFFF', titleColor: '#0C1E85' },
    // git / timeline / mindmap
    cScale0: '#0C1E85', cScale1: '#1954F1', cScale2: '#8A60F0', cScale3: '#3346B0', cScale4: '#12925A', cScale5: '#F26414',
    cScale6: '#6F93FF', cScale7: '#5B6472', cScaleLabel0: '#FFFFFF', cScaleLabel1: '#FFFFFF', cScaleLabel2: '#FFFFFF', cScaleLabel3: '#FFFFFF',
    cScaleLabel4: '#FFFFFF', cScaleLabel5: '#FFFFFF', cScaleLabel6: '#FFFFFF', cScaleLabel7: '#FFFFFF',
  },
  flowchart: { htmlLabels: true, curve: 'basis', padding: 14, nodeSpacing: 45, rankSpacing: 55, useMaxWidth: false },
  sequence: { useMaxWidth: false, mirrorActors: false, showSequenceNumbers: true, actorMargin: 60, messageFontSize: 14 },
  er: { useMaxWidth: false, layoutDirection: 'TB' },
  gantt: { useMaxWidth: false, barHeight: 24, fontSize: 13, sectionFontSize: 13, leftPadding: 160 },
  journey: { useMaxWidth: false },
  pie: { useMaxWidth: false, textPosition: 0.7 },
  xyChart: { useMaxWidth: false, width: 900, height: 420 },
  quadrantChart: { useMaxWidth: false, chartWidth: 620, chartHeight: 620 },
  timeline: { useMaxWidth: false },
  mindmap: { useMaxWidth: false },
  state: { useMaxWidth: false },
  class: { useMaxWidth: false },
  block: { useMaxWidth: false },
  architecture: { useMaxWidth: false },
  sankey: { useMaxWidth: false, width: 900, height: 480 },
  securityLevel: 'loose',
  startOnLoad: false,
};

/** Launch Chromium; falls back to any Playwright-managed Chrome already on this machine. */
async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    const exe = fs.existsSync(root) && fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
      .map((d) => path.join(root, d, 'chrome-win64', 'chrome.exe')).find((f) => fs.existsSync(f));
    if (!exe) throw e;
    return chromium.launch({ executablePath: exe });
  }
}

const hash = (s) => crypto.createHash('sha1').update(JSON.stringify(THEME) + '\n' + s).digest('hex').slice(0, 16);

/** Render diagrams: [{ code }] -> [{ file, width, height } | { error }]. width/height are CSS px at 1x. */
async function renderAll(diagrams, { scale = 2.5 } = {}) {
  fs.mkdirSync(CACHE, { recursive: true });
  const out = new Array(diagrams.length);
  const todo = [];
  diagrams.forEach((d, i) => {
    const h = hash(d.code);
    const file = path.join(CACHE, `${h}.png`);
    const meta = path.join(CACHE, `${h}.json`);
    if (fs.existsSync(file) && fs.existsSync(meta)) out[i] = { file, ...JSON.parse(fs.readFileSync(meta, 'utf8')) };
    else todo.push({ i, h, file, meta, code: d.code });
  });
  if (!todo.length) return out;
  const browser = await launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: scale, viewport: { width: 1400, height: 1000 } });
    await page.setContent('<!doctype html><html><head><style>body{margin:0;background:#fff;font-family:Calibri,Arial,sans-serif}#c{display:inline-block;padding:12px;background:#fff}</style></head><body><div id="c"></div></body></html>');
    await page.addScriptTag({ path: MERMAID_JS });
    await page.evaluate((cfg) => window.mermaid.initialize(cfg), THEME);
    for (const t of todo) {
      const res = await page.evaluate(async ({ code, id }) => {
        const c = document.getElementById('c');
        c.innerHTML = '';
        try {
          await window.mermaid.parse(code);
          const { svg } = await window.mermaid.render(id, code);
          c.innerHTML = svg;
          const el = c.querySelector('svg');
          // Use the intrinsic size so text is not squashed by max-width.
          const vb = el.viewBox && el.viewBox.baseVal;
          if (vb && vb.width) { el.style.maxWidth = 'none'; el.setAttribute('width', vb.width); el.setAttribute('height', vb.height); }
          const r = c.getBoundingClientRect();
          return { ok: true, width: Math.ceil(r.width), height: Math.ceil(r.height) };
        } catch (e) {
          document.querySelectorAll('[id^="d' + id + '"], #' + id).forEach((n) => n.remove());
          return { ok: false, error: String((e && e.message) || e) };
        }
      }, { code: t.code, id: 'm' + t.h });
      if (!res.ok) { out[t.i] = { error: res.error }; continue; }
      await page.setViewportSize({ width: Math.max(1400, res.width + 40), height: Math.max(1000, res.height + 40) });
      await page.locator('#c').screenshot({ path: t.file });
      fs.writeFileSync(t.meta, JSON.stringify({ width: res.width, height: res.height }));
      out[t.i] = { file: t.file, width: res.width, height: res.height };
    }
  } finally {
    await browser.close();
  }
  return out;
}

module.exports = { renderAll, launch };
