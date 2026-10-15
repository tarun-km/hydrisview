import { createHash } from 'node:crypto';

/** Fixed namespace for Hydris demo-tenant identifiers (RFC 4122 name-based, SHA-1 / v5). */
const NAMESPACE = Buffer.from('6f1d7c2e9a4b4c58b1e3d0a7f2c94e61', 'hex');

/**
 * Deterministic UUID (v5) for a stable demo key, e.g. `demoId('site', 'RIP')`.
 * Every serverless instance seeds its own in-memory database; deterministic ids make
 * users, sites, assets, sensors, alarms... identical on all of them, so links, tokens and
 * client caches stay valid whichever instance serves a request.
 */
export function demoId(...parts: (string | number)[]): string {
  const h = createHash('sha1').update(NAMESPACE).update(parts.join(':')).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
