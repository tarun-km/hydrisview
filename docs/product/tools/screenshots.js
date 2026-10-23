// Captures web screenshots of the live product for the documents (docs/product/images/web-*.png).
// Usage: node screenshots.js [baseUrl]
const path = require('path');
const { launch } = require('./mermaid-render');

const BASE = process.argv[2] || 'https://hydrisview.vercel.app';
const OUT = path.resolve(__dirname, '..', 'images');

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const shot = async (name, opts = {}) => { await page.waitForTimeout(opts.wait ?? 2500); await page.screenshot({ path: path.join(OUT, `web-${name}.png`), fullPage: !!opts.full }); console.log('web-' + name); };

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot('website-home');
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Enter demo mode' }).click();
  await page.getByLabel('Your name').fill('Documentation');
  await page.getByRole('button', { name: 'Start demo' }).click();
  await page.waitForURL(/\/console/, { timeout: 60000 });
  await shot('console-overview', { wait: 5000 });
  for (const [p, n] of [['alarms', 'console-alarms'], ['telemetry', 'console-telemetry'], ['audit-docs', 'console-audit-docs'], ['devices', 'console-devices'], ['map', 'console-map'], ['inspections', 'console-inspections']]) {
    await page.goto(`${BASE}/console/${p}`, { waitUntil: 'networkidle' }).catch(() => {});
    await shot(n, { wait: 4000 });
  }
  // Glasses heads-up display as it appears inside the simulator.
  await page.goto(`${BASE}/simulator`, { waitUntil: 'networkidle' }).catch(() => {});
  await shot('simulator', { wait: 6000 });
  // Glasses app on a phone (companion layout).
  const phone = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  await pp.goto(`${BASE}/glasses?mode=phone`, { waitUntil: 'networkidle' }).catch(() => {});
  await pp.waitForTimeout(4000);
  await pp.screenshot({ path: path.join(OUT, 'web-glasses-phone-pairing.png') });
  console.log('web-glasses-phone-pairing');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
