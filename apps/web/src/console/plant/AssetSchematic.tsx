'use client';

import type { ReactNode } from 'react';
import { ASSET_TYPE_LABELS, type AssetType } from '@hydris/domain';

/**
 * Line-art schematic of an asset type (no stock imagery). Drawn in a 400×260 box with
 * light strokes on the dark hero; `accent` tints the active element (lime when healthy,
 * alarm colour when not).
 */
export function AssetSchematic({ type, accent = 'var(--color-lime)', className }: { type: AssetType; accent?: string; className?: string }) {
  const S = { fill: 'none', stroke: 'rgb(243 244 241 / 0.78)', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const F = { fill: 'rgb(255 255 255 / 0.04)', stroke: 'rgb(243 244 241 / 0.78)', strokeWidth: 2, strokeLinejoin: 'round' as const };
  const A = { fill: 'none', stroke: accent, strokeWidth: 3, strokeLinecap: 'round' as const };
  const pipe = (d: string) => <path d={d} {...S} strokeWidth={10} stroke="rgb(255 255 255 / 0.08)" />;
  const base = <path d="M40 228 H360" {...S} strokeOpacity={0.35} strokeDasharray="2 8" />;

  const art: Record<AssetType, ReactNode> = {
    pump: (<>
      {pipe('M20 150 H120')}{pipe('M228 70 V30 H380')}
      <rect x="60" y="176" width="280" height="22" rx="4" {...F} />
      <circle cx="190" cy="140" r="58" {...F} />
      <circle cx="190" cy="140" r="22" {...F} />
      <path d="M190 118 l0 -22 M212 140 l22 0 M190 162 l0 22 M168 140 l-22 0" {...A} />
      <path d="M210 92 L228 70 L250 70 L250 100" {...S} />
      <path d="M132 140 H100 V128 H60 V152 H100 V140" {...S} />
      <rect x="250" y="112" width="80" height="56" rx="10" {...F} />
      <path d="M262 124 V156 M278 124 V156 M294 124 V156 M310 124 V156" {...S} strokeOpacity={0.5} />
    </>),
    dosing_pump: (<>
      {pipe('M40 200 H160')}
      <rect x="70" y="60" width="90" height="120" rx="12" {...F} />
      <path d="M70 100 H160" {...S} strokeOpacity={0.4} />
      <path d="M82 140 h66" {...A} />
      <circle cx="240" cy="140" r="44" {...F} />
      <path d="M240 96 V184 M196 140 H284" {...S} strokeOpacity={0.4} />
      <circle cx="240" cy="140" r="14" {...F} stroke={accent} strokeWidth={3} />
      <rect x="290" y="114" width="60" height="52" rx="8" {...F} />
      <path d="M160 160 H196" {...S} />
    </>),
    blower: (<>
      {pipe('M20 100 H110')}{pipe('M290 100 H380')}
      <rect x="110" y="46" width="180" height="120" rx="22" {...F} />
      <circle cx="170" cy="106" r="34" {...S} />
      <circle cx="230" cy="106" r="34" {...S} />
      <path d="M150 106 a20 12 0 0 0 40 0 a20 12 0 0 0 -40 0 M210 106 a20 12 0 0 1 40 0 a20 12 0 0 1 -40 0" {...A} />
      <rect x="140" y="176" width="120" height="30" rx="6" {...F} />
      <path d="M200 166 V176" {...S} />
    </>),
    motor: (<>
      <rect x="80" y="70" width="200" height="110" rx="20" {...F} />
      <path d="M100 70 V180 M120 70 V180 M140 70 V180 M160 70 V180 M180 70 V180 M200 70 V180 M220 70 V180" {...S} strokeOpacity={0.35} />
      <path d="M280 125 H340" {...S} strokeWidth={10} />
      <circle cx="340" cy="125" r="8" {...A} />
      <rect x="150" y="46" width="60" height="24" rx="4" {...F} />
      <path d="M100 180 L90 206 H270 L260 180" {...S} />
    </>),
    tank: (<>
      {pipe('M20 70 H110')}{pipe('M290 200 H380')}
      <path d="M110 40 H290 V210 a8 8 0 0 1 -8 8 H118 a8 8 0 0 1 -8 -8 Z" {...F} />
      <path d="M110 112 C150 104 170 120 200 112 S260 104 290 112" {...A} />
      <path d="M116 112 V212 H284 V112" fill={accent} fillOpacity={0.08} stroke="none" />
      <path d="M300 40 V218 M296 60 H304 M296 100 H304 M296 140 H304 M296 180 H304" {...S} strokeOpacity={0.5} />
    </>),
    clarifier: (<>
      <ellipse cx="200" cy="90" rx="160" ry="40" {...F} />
      <path d="M40 90 V150 L200 210 L360 150 V90" {...S} />
      <ellipse cx="200" cy="90" rx="120" ry="28" {...S} strokeOpacity={0.4} />
      <path d="M200 50 V200" {...S} />
      <path d="M200 90 L330 90" {...A} />
      <path d="M90 170 L200 196 L310 170" {...S} strokeOpacity={0.4} strokeDasharray="4 6" />
    </>),
    filter: (<>
      {pipe('M20 60 H130')}{pipe('M270 200 H380')}
      <rect x="130" y="34" width="140" height="180" rx="70" {...F} />
      <path d="M140 110 H260 M140 130 H260 M140 150 H260" {...S} strokeOpacity={0.4} strokeDasharray="3 5" />
      <path d="M150 96 H250" {...A} />
      <path d="M140 170 H260" {...S} />
    </>),
    valve: (<>
      {pipe('M20 150 H380')}
      <path d="M120 120 L200 150 L120 180 Z M280 120 L200 150 L280 180 Z" {...F} />
      <path d="M200 150 V80" {...S} />
      <ellipse cx="200" cy="72" rx="56" ry="10" {...A} />
      <path d="M80 120 V180 M320 120 V180" {...S} strokeOpacity={0.5} />
    </>),
    mixer: (<>
      <path d="M90 90 V210 H310 V90" {...S} />
      <path d="M90 140 C150 130 250 150 310 140" {...S} strokeOpacity={0.4} />
      <rect x="170" y="30" width="60" height="44" rx="8" {...F} />
      <path d="M200 74 V176" {...S} />
      <path d="M160 176 Q200 160 240 176 Q200 192 160 176" {...A} />
    </>),
    analyzer: (<>
      <rect x="120" y="30" width="160" height="150" rx="16" {...F} />
      <rect x="140" y="52" width="120" height="58" rx="6" {...S} />
      <path d="M150 92 L176 74 L196 86 L222 64 L248 78" {...A} />
      <circle cx="160" cy="140" r="8" {...S} /><circle cx="200" cy="140" r="8" {...S} /><circle cx="240" cy="140" r="8" {...S} />
      <path d="M200 180 V222 M186 222 H214" {...S} />
    </>),
    screen: (<>
      {pipe('M20 180 H380')}
      <path d="M90 210 L250 40 H290 L130 210 Z" {...F} />
      <path d="M118 180 L262 40 M134 186 L276 46 M150 192 L290 54" {...S} strokeOpacity={0.4} />
      <path d="M250 40 H330 V70" {...S} />
      <path d="M100 170 L260 52" {...A} />
    </>),
    diffuser: (<>
      <path d="M40 60 V210 H360 V60" {...S} />
      <path d="M60 190 H340" {...S} strokeWidth={6} />
      {[90, 140, 190, 240, 290].map((x) => <rect key={x} x={x - 14} y={180} width={28} height={10} rx={5} {...F} />)}
      {[90, 140, 190, 240, 290].map((x, i) => <g key={x}><circle cx={x - 4} cy={150 - i * 3} r={4} {...A} strokeWidth={2} /><circle cx={x + 6} cy={118 - i * 2} r={3} {...A} strokeWidth={2} /><circle cx={x} cy={88} r={2.5} {...A} strokeWidth={2} /></g>)}
    </>),
    uv_unit: (<>
      {pipe('M20 140 H70')}{pipe('M330 140 H380')}
      <rect x="70" y="96" width="260" height="88" rx="44" {...F} />
      <path d="M100 124 H300 M100 140 H300 M100 156 H300" {...A} strokeOpacity={0.9} />
      <rect x="160" y="50" width="80" height="46" rx="8" {...F} />
    </>),
    other: (<>
      <rect x="110" y="50" width="180" height="150" rx="24" {...F} />
      <circle cx="200" cy="125" r="34" {...A} />
      <path d="M40 125 H110 M290 125 H360" {...S} />
    </>),
  };

  return (
    <svg viewBox="0 0 400 240" className={className} role="img" aria-label={`Schematic illustration of a ${ASSET_TYPE_LABELS[type].toLowerCase()}`}>
      {base}
      {art[type]}
    </svg>
  );
}
