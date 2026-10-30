import narration from '../narration.json';
import type { Tour, TourStep } from '../types';

/** Console tour: `nav` is a route. Targets are data-tour attributes on the real console elements. */
type Extra = Omit<TourStep<string>, 'id' | 'title' | 'text' | 'audio'>;
const PAGE = '[data-tour="page-header"], [data-tour="page"]';
const nav = (href: string) => `[data-tour="nav-${href}"]`;
const extra: Record<string, Extra> = {
  welcome: { nav: '/console' },
  command: { nav: '/console', target: '[data-tour="kpis"]' },
  'operator-cards': { nav: '/console', target: '[data-tour="on-shift"]' },
  'live-view': { nav: '/console', target: '[data-tour="live-view"], [data-tour="on-shift"]' },
  'go-operators': { nav: '/console', target: nav('/console/operators'), interactive: { waitFor: 'click' } },
  operators: { nav: '/console/operators', target: PAGE },
  devices: { nav: '/console/devices', target: PAGE },
  work: { nav: '/console/inspections', target: nav('/console/inspections') },
  approvals: { nav: '/console/approvals', target: PAGE },
  telemetry: { nav: '/console/telemetry', target: PAGE },
  reports: { nav: '/console/reports', target: PAGE },
  closing: { nav: '/console' },
};

export const consoleTour: Tour<string> = {
  id: 'console',
  name: 'Hydris console tour',
  steps: narration.console.map((n) => ({ id: n.id, title: n.title, text: n.text, audio: `/tutorial/console/${n.id}.mp3`, ...(extra[n.id] ?? {}) })),
};
