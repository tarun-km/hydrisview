import narration from '../narration.json';
import type { Tour, TourStep } from '../types';

/** Glasses-app screen to show for a step; `id: 'first'` means the first item in the current context. */
export interface GlassesTourNav { name: 'home' | 'alerts' | 'alert' | 'measurements' | 'inspections' | 'inspection' | 'sops' | 'scan' | 'status'; id?: 'first' }

type Extra = Omit<TourStep<GlassesTourNav>, 'id' | 'title' | 'text' | 'audio'>;
const extra: Record<string, Extra> = {
  welcome: { nav: { name: 'home' } },
  'problem-paper': {},
  'problem-field': {},
  'problem-evidence': {},
  solution: {},
  'status-bar': { nav: { name: 'home' }, target: '[data-tour="status-bar"]' },
  home: { nav: { name: 'home' }, target: '[data-tour="home-menu"]' },
  readings: { nav: { name: 'measurements' }, target: '[data-tour="row-first"]' },
  alarms: { nav: { name: 'alerts' }, target: '[data-tour="row-first"]', interactive: { waitFor: 'click' } },
  'alarm-detail': { nav: { name: 'alert', id: 'first' }, target: '[data-tour="alarm-ack"], [data-tour="content"]' },
  rounds: { nav: { name: 'inspections' }, target: '[data-tour="row-first"]' },
  'rounds-offline': { nav: { name: 'inspection', id: 'first' }, target: '[data-tour="content"]' },
  sops: { nav: { name: 'sops' }, target: '[data-tour="content"]' },
  scan: { nav: { name: 'scan' }, target: '[data-tour="content"]' },
  voice: { nav: { name: 'home' }, target: '[data-tour="voice"]' },
  menu: { nav: { name: 'home' }, target: '[data-tour="nav"]' },
  device: { nav: { name: 'status' }, target: '[data-tour="content"]' },
  'console-sees': { nav: { name: 'home' } },
  closing: { nav: { name: 'home' } },
};

export const glassesTour: Tour<GlassesTourNav> = {
  id: 'glasses',
  name: 'Hydris Field Glasses tour',
  steps: narration.glasses.map((n) => ({ id: n.id, title: n.title, text: n.text, audio: `/tutorial/glasses/${n.id}.mp3`, ...(extra[n.id] ?? {}) })),
};
