'use client';

import { useId } from 'react';
import clsx from 'clsx';
import { DEVICE_STATE_LABELS, type DeviceState } from '@hydris/domain';
import { Chip, StateChip } from '@/ui';

/** Indicator colour for a composite device state (status light on the render, dots in lists). */
export const DEVICE_STATE_COLOR: Record<DeviceState, string> = {
  connected: 'var(--color-lime)',
  disconnected: 'var(--color-medium)',
  assigned: 'var(--color-cobalt)',
  paired: 'var(--color-muted)',
  pending_pairing: 'var(--color-muted)',
  unregistered: 'var(--color-muted)',
  suspended: 'var(--color-high)',
  revoked: 'var(--color-critical)',
};

export function DeviceStateChip({ state }: { state: DeviceState }) {
  return <StateChip state={state} label={DEVICE_STATE_LABELS[state]} />;
}

export function DeviceKindChip({ kind }: { kind: 'hardware' | 'simulator' }) {
  return kind === 'simulator'
    ? <Chip tone="synthetic" title="Browser simulator paired like real glasses. Data it produces is labeled synthetic.">Simulator</Chip>
    : <Chip tone="outline">Hardware</Chip>;
}

/**
 * Product render of a pair of smart field glasses (VanMoof "device as hero").
 * The status light and waveguide tint follow the device state; nothing here is measured.
 */
export function GlassesArt({ state, className, title }: { state: DeviceState; className?: string; title?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glow = DEVICE_STATE_COLOR[state];
  const live = state === 'connected';
  const dim = state === 'revoked' || state === 'suspended';
  return (
    <svg viewBox="0 0 320 150" role="img" aria-label={title ?? `Field glasses, ${DEVICE_STATE_LABELS[state].toLowerCase()}`} className={clsx('block', className)}>
      <defs>
        <linearGradient id={`${uid}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a4b48" />
          <stop offset="55%" stopColor="#232423" />
          <stop offset="100%" stopColor="#121312" />
        </linearGradient>
        <linearGradient id={`${uid}l`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={glow} stopOpacity={dim ? 0.05 : 0.22} />
          <stop offset="60%" stopColor="#0a0a0a" stopOpacity={0.55} />
          <stop offset="100%" stopColor={glow} stopOpacity={dim ? 0.02 : 0.1} />
        </linearGradient>
        <radialGradient id={`${uid}s`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#000" stopOpacity={0.55} />
          <stop offset="100%" stopColor="#000" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${uid}g`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor={glow} stopOpacity={live ? 0.35 : 0.12} />
          <stop offset="100%" stopColor={glow} stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* floor shadow + ambient glow */}
      <ellipse cx="160" cy="132" rx="138" ry="10" fill={`url(#${uid}s)`} />
      <ellipse cx="226" cy="70" rx="70" ry="48" fill={`url(#${uid}g)`} />
      {/* temples receding */}
      <path d="M22 52 L4 40" stroke="#2a2b29" strokeWidth="8" strokeLinecap="round" />
      <path d="M298 52 L316 40" stroke="#2a2b29" strokeWidth="8" strokeLinecap="round" />
      {/* lenses */}
      <rect x="24" y="36" width="114" height="74" rx="28" fill={`url(#${uid}l)`} />
      <rect x="182" y="36" width="114" height="74" rx="28" fill={`url(#${uid}l)`} />
      {/* frame */}
      <rect x="24" y="36" width="114" height="74" rx="28" fill="none" stroke={`url(#${uid}f)`} strokeWidth="9" />
      <rect x="182" y="36" width="114" height="74" rx="28" fill="none" stroke={`url(#${uid}f)`} strokeWidth="9" />
      <path d="M30 40 Q81 26 134 40" stroke="#55574f" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M186 40 Q239 26 290 40" stroke="#55574f" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.7" />
      {/* bridge */}
      <path d="M138 56 Q160 40 182 56" stroke={`url(#${uid}f)`} strokeWidth="8" fill="none" strokeLinecap="round" />
      {/* waveguide display in the right lens */}
      <g opacity={dim ? 0.25 : live ? 1 : 0.55}>
        <rect x="222" y="52" width="48" height="30" rx="5" fill={glow} fillOpacity="0.14" stroke={glow} strokeOpacity="0.7" strokeWidth="1.2" />
        <rect x="228" y="58" width="22" height="3" rx="1.5" fill={glow} />
        <rect x="228" y="65" width="34" height="2.5" rx="1.25" fill={glow} fillOpacity="0.6" />
        <rect x="228" y="71" width="16" height="2.5" rx="1.25" fill={glow} fillOpacity="0.6" />
      </g>
      {/* camera + status light */}
      <circle cx="40" cy="44" r="4" fill="#0a0a0a" stroke="#5c5e58" strokeWidth="1.2" />
      <circle cx="40" cy="44" r="1.4" fill="#7fa6ff" opacity="0.8" />
      <circle cx="282" cy="44" r="3.6" fill={glow} className={live ? 'pulse-dot' : undefined} />
      {state === 'revoked' && <path d="M60 120 L260 26" stroke="var(--color-critical)" strokeWidth="2" strokeDasharray="6 6" opacity="0.5" />}
    </svg>
  );
}
