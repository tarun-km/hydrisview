import type { Metadata } from 'next';
import {
  CapabilitiesBand, ClosingBand, DemoBand, FaqBand, HeroShell, HowBand, PlatformBand, RoadmapBand, SafetyBand, UseCasesBand,
} from '@/site/home-mist';

export const metadata: Metadata = {
  title: { absolute: 'Hydris Field Glasses — live plant context in the operator’s field of view' },
  description:
    'Smart-glasses guidance for wastewater operators at ETPs, STPs and WTPs: live telemetry, guided inspections, alarms and approved SOPs in view, managed from a secure multi-tenant Operator Console. Advisory only.',
  alternates: { canonical: '/' },
};

/**
 * Homepage: one container, one panel system (ice / night / signal), alternating tones.
 * Each band is a rounded panel with the same padding and heading block, so every
 * eyebrow, title, paragraph and button shares a left edge.
 */
export default function HomePage() {
  return (
    <div className="site-container hz-stack pt-2 lg:pt-4">
      <HeroShell />
      <CapabilitiesBand />
      <DemoBand />
      <HowBand />
      <UseCasesBand />
      <PlatformBand />
      <SafetyBand />
      <RoadmapBand />
      <FaqBand />
      <ClosingBand />
    </div>
  );
}
