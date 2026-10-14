import type { Availability } from './primitives';

/**
 * Single source of truth for what the website says is available vs planned.
 * Keep this honest: anything not shipped in this repository is `planned`.
 */
export interface CapabilityRow { area: string; name: string; detail: string; status: Availability }

export const CAPABILITY_TABLE: CapabilityRow[] = [
  { area: 'Glasses', name: 'Glasses viewport (web, 600 × 600)', detail: 'Pure-black, high-contrast UI with four inputs: up, down, select, back.', status: 'available' },
  { area: 'Glasses', name: 'Browser simulator', detail: 'Run the viewport on any desktop browser for training, demos and acceptance testing.', status: 'available' },
  { area: 'Glasses', name: 'Native device adapter (Meta Ray-Ban Display class)', detail: 'Packaging the viewport for monocular display glasses with neural band / touch input.', status: 'planned' },
  { area: 'Glasses', name: 'Live asset context & freshness', detail: 'Latest readings, units, limits and live / delayed / stale / no-data state.', status: 'available' },
  { area: 'Glasses', name: 'Guided inspections & rounds', detail: 'Check, reading, choice and text steps with expected ranges and caution notes.', status: 'available' },
  { area: 'Glasses', name: 'Alarm interrupts', detail: 'Critical and high alarms for the operator’s sites surface over the current view.', status: 'available' },
  { area: 'Glasses', name: 'Approved SOPs', detail: 'Only approved procedure revisions reach operators and devices.', status: 'available' },
  { area: 'Glasses', name: 'Offline step queue', detail: 'Responses queue on the device while offline and sync on reconnect.', status: 'available' },
  { area: 'Platform', name: 'Secure pairing (QR + short code)', detail: 'Single-use, 5-minute challenges approved by an authorised person.', status: 'available' },
  { area: 'Platform', name: 'Operator Console', detail: 'Sites, assets, sensors, alarms, inspections, maintenance, operators, fleet, audit.', status: 'available' },
  { area: 'Platform', name: 'HTTPS gateway ingestion', detail: 'Per-site API key, JSON batches up to 500 readings, per-item results.', status: 'available' },
  { area: 'Platform', name: 'Realtime stream (SSE)', detail: 'Authorised per connection, with replay after reconnect.', status: 'available' },
  { area: 'Integrations', name: 'MQTT adapter', detail: 'Subscribe to broker topics at the edge and forward to ingestion.', status: 'planned' },
  { area: 'Integrations', name: 'OPC UA adapter', detail: 'Read tags from OPC UA servers at the edge.', status: 'planned' },
  { area: 'Intelligence', name: 'Computer vision assistance', detail: 'Gauge reading and visual anomaly prompts from the glasses camera.', status: 'planned' },
  { area: 'Intelligence', name: 'Voice notes & commands', detail: 'Hands-free notes and navigation.', status: 'planned' },
  { area: 'Intelligence', name: 'Predictive maintenance', detail: 'Early warnings from vibration, current and runtime trends.', status: 'planned' },
];

export const AVAILABLE_NOW = [
  'Glasses viewport (web) + browser simulator',
  'Live asset context with data freshness',
  'Guided inspections, rounds & maintenance checklists',
  'Alarm rules with deadband and on-delay',
  'Approved SOPs for operators and devices',
  'QR + short-code device pairing, fleet management',
  'HTTPS edge-gateway ingestion, manual & lab entry',
  'Realtime (SSE), audit trail, CSV export',
];

export const PLANNED = [
  { t: 'Computer vision', d: 'Gauge reading and visual anomaly prompts from the glasses camera — always confirmed by the operator.' },
  { t: 'Voice', d: 'Hands-free notes and navigation for gloved, wet work.' },
  { t: 'Predictive maintenance', d: 'Early warnings from vibration, motor current and runtime trends.' },
  { t: 'MQTT & OPC UA adapters', d: 'Edge adapters so existing brokers and servers can feed Hydris without custom code.' },
  { t: 'Native device adapter', d: 'Packaging the viewport for Meta Ray-Ban Display class glasses with neural-band input.' },
];
