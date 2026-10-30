'use client';

import { motion, useReducedMotion } from 'motion/react';
import clsx from 'clsx';

/** 5×7 LED font (rows top→bottom). */
const GLYPHS: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '/': ['001', '001', '010', '010', '010', '100', '100'],
  '%': ['11001', '11010', '00010', '00100', '01000', '01011', '10011'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ':': ['0', '0', '1', '0', '1', '0', '0'],
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
  '°': ['111', '101', '111', '000', '000', '000', '000'],
};

/**
 * Dot-matrix numeral (reference: the "36°" weather tile). Each lit dot pops in on change, staggered column by column,
 * with faint unlit dots behind for the LED-panel feel. Announced as plain text.
 */
export function DotMatrix({ value, dot = 5, gap = 2.2, className, label, dim = 0.07 }: { value: string | number; dot?: number; gap?: number; className?: string; label?: string; dim?: number }) {
  const reduced = useReducedMotion();
  const text = String(value);
  const pitch = dot + gap;
  let x = 0;
  const cells: { k: string; cx: number; cy: number; on: boolean; delay: number }[] = [];
  [...text].forEach((ch, ci) => {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    const w = g[0].length;
    g.forEach((row, ry) => [...row].forEach((bit, rx) => {
      cells.push({ k: `${ci}-${ch}-${rx}-${ry}`, cx: x + rx * pitch + dot / 2, cy: ry * pitch + dot / 2, on: bit === '1', delay: (ci * 5 + rx) * 0.012 + ry * 0.006 });
    }));
    x += w * pitch + pitch * 1.1;
  });
  const width = Math.max(0, x - pitch * 1.1 - gap);
  const height = 7 * pitch - gap;
  return (
    <svg role="img" aria-label={label ?? text} viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={clsx('dotmatrix overflow-visible', className)}>
      {cells.map((c) => c.on ? (
        <motion.circle key={c.k} cx={c.cx} cy={c.cy} r={dot / 2} fill="currentColor"
          initial={reduced ? false : { scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: c.delay, type: 'spring', stiffness: 500, damping: 22 }} style={{ transformOrigin: `${c.cx}px ${c.cy}px` }} />
      ) : dim > 0 ? <circle key={c.k} cx={c.cx} cy={c.cy} r={dot / 2.6} fill="currentColor" opacity={dim} /> : null)}
    </svg>
  );
}
