/** Guided, voiced tour: one step = navigate, point, caption, voice note. */
export type Placement = 'auto' | 'top' | 'bottom' | 'center';

export interface TourStep<Nav = unknown> {
  id: string;
  title: string;
  /** Exact narration text (mirrors the voice note). */
  text: string;
  /** Voice note URL (public path). */
  audio: string;
  /** Where the host app should be for this step (screen spec for glasses, route for console). Omit to stay put. */
  nav?: Nav;
  /** CSS selector of the element to point at; prefer [data-tour="..."] on the real element. Omit for a centered card. */
  target?: string;
  /** Wait for the user to tap the highlighted element before continuing (a Skip is always offered). */
  interactive?: { waitFor: 'click' };
  placement?: Placement;
}

export interface Tour<Nav = unknown> {
  id: 'glasses' | 'console';
  name: string;
  steps: TourStep<Nav>[];
}

export interface TourManifest {
  voiceId: string;
  voiceName: string;
  steps: Record<string, { file: string; text: string; durationMs: number; bytes: number }>;
}

/** Fallback narration length when the manifest is not loaded: ~2.6 words per second plus a beat. */
export function estimateMs(text: string): number {
  return Math.round((text.split(/\s+/).length / 2.6) * 1000) + 800;
}
