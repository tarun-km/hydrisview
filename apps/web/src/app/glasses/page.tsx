'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { GlassesApp } from '@/glasses/GlassesApp';

function Viewport() {
  const p = useSearchParams();
  // ?demo=1&scenario=key → fully client-side synthetic demo (public website), no API calls.
  // ?sim=1 → embedded in the browser simulator (labels the device as a simulator during pairing).
  const demo = p.get('demo') === '1' ? (p.get('scenario') ?? 'normal_operations') : null;
  // ?profile=preview (demo only) → accepts draft UI-profile configs from the console editor via postMessage.
  return <GlassesApp demoScenario={demo} simulator={p.get('sim') === '1'} profilePreview={p.get('profile') === 'preview'} />;
}

export default function GlassesPage() {
  return <Suspense><Viewport /></Suspense>;
}
