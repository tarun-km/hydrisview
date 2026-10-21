'use client';
/**
 * A realistic printed audit sheet rendered on a canvas, for demos and tests without paper:
 * header with logo, labelled values, a results table, a checklist, a photo placeholder and a
 * signature. It goes through exactly the same OCR pipeline as a camera photo.
 */
export async function renderSampleAuditSheet(variant = 0): Promise<Blob> {
  const W = 1240;
  const H = 1754; // A4 @150 dpi
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // Paper with a slight warm tint and vignette, like a photographed sheet.
  g.fillStyle = '#fbfaf6';
  g.fillRect(0, 0, W, H);
  const grad = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.06)');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const ink = '#151a1f';
  const font = (size: number, weight = 400) => `${weight} ${size}px Arial, Helvetica, sans-serif`;
  const text = (t: string, x: number, y: number, size = 26, weight = 400, color = ink) => {
    g.font = font(size, weight);
    g.fillStyle = color;
    g.fillText(t, x, y);
  };

  // Logo mark
  g.fillStyle = '#1954F1';
  g.beginPath();
  g.moveTo(90, 70); g.lineTo(150, 70); g.lineTo(120, 150); g.closePath(); g.fill();
  g.fillRect(90, 160, 60, 14);
  text('RIVERBEND PROCESS INDUSTRIES', 180, 110, 26, 700, '#1954F1');
  text('Environmental Compliance Department', 180, 148, 22, 400, '#4a535c');

  const day = 10 + (variant % 15);
  const ph = (7.1 + (variant % 4) / 10).toFixed(1);
  text('Monthly Effluent Compliance Audit', 90, 250, 44, 700);
  g.fillStyle = '#1954F1';
  g.fillRect(90, 272, 1060, 4);

  const kv: [string, string][] = [
    ['Audit No', `ECA-2026-${(1040 + variant).toString()}`],
    ['Site', 'Riverbend Industrial Park'],
    ['Date', `${day}/10/2026`],
    ['Auditor', 'Meera Pillai'],
    ['Outlet pH', ph],
    ['Outlet TSS', `${34 + (variant % 9)} mg/L`],
    ['Outlet COD', `${198 + (variant % 30)} mg/L`],
    ['Flow Meter Reading', `${(18450 + variant * 37).toLocaleString('en-US')} m3`],
  ];
  kv.forEach(([k, v], i) => {
    const y = 340 + i * 52;
    text(`${k}:`, 90, y, 28, 700);
    text(v, 420, y, 28, 400);
  });

  // Results table
  const ty = 800;
  text('Laboratory Results', 90, ty - 24, 30, 700);
  const cols = [90, 430, 680, 920];
  const rows = [
    ['Parameter', 'Limit', 'Result', 'Status'],
    ['pH', '6.5-8.5', ph, 'PASS'],
    ['TSS', '100', `${34 + (variant % 9)}`, 'PASS'],
    ['COD', '250', `${198 + (variant % 30)}`, 'PASS'],
    ['BOD', '30', `${18 + (variant % 7)}`, 'PASS'],
    ['Oil and Grease', '10', '4.2', 'PASS'],
  ];
  g.strokeStyle = '#9aa3ab';
  g.lineWidth = 2;
  rows.forEach((r, ri) => {
    const y = ty + ri * 56;
    if (ri === 0) { g.fillStyle = '#e8eefc'; g.fillRect(80, y, 1080, 56); }
    g.strokeRect(80, y, 1080, 56);
    r.forEach((cell, ci) => text(cell, cols[ci]! + 10, y + 38, 27, ri === 0 ? 700 : 400));
  });

  // Checklist
  const cy = 1180;
  text('Site Checklist', 90, cy, 30, 700);
  ['Sampling point labelled', 'Composite sampler operating', 'Discharge log up to date'].forEach((item, i) => {
    const y = cy + 50 + i * 48;
    g.strokeRect(92, y - 26, 30, 30);
    g.beginPath(); g.moveTo(97, y - 10); g.lineTo(106, y); g.lineTo(119, y - 22); g.stroke();
    text(item, 140, y, 26);
  });

  // Photo placeholder (figure)
  g.fillStyle = '#c9d6c3';
  g.fillRect(760, 1160, 380, 220);
  g.fillStyle = '#7f9a86';
  g.beginPath(); g.moveTo(760, 1380); g.lineTo(900, 1250); g.lineTo(1000, 1330); g.lineTo(1060, 1280); g.lineTo(1140, 1380); g.closePath(); g.fill();
  text('Fig 1. Outfall channel', 770, 1410, 20, 400, '#4a535c');

  // Signature
  text('Auditor Signature:', 90, 1560, 26, 700);
  g.strokeStyle = '#1b2a6b';
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(360, 1560);
  for (let x = 0; x < 260; x += 10) g.lineTo(360 + x, 1560 - Math.sin(x / 18) * 18 - (x % 40 === 0 ? 10 : 0));
  g.stroke();
  text('Remarks: All parameters within consent limits.', 90, 1640, 24);

  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('render failed'))), 'image/jpeg', 0.92));
}
