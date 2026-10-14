/**
 * Field-glasses device identity, lifecycle and pairing parameters.
 *
 * Pairing follows the shape of the OAuth 2.0 Device Authorization Grant (RFC 8628):
 * the glasses request a short-lived, single-use challenge and show a short user code
 * plus a QR link; an authenticated person approves it on a companion device; the
 * glasses, holding a separate secret that is never displayed, then claim a device
 * credential. The QR code never contains a reusable credential.
 */

export const DEVICE_RECORD_STATUSES = ['active', 'suspended', 'revoked'] as const;
export type DeviceRecordStatus = (typeof DEVICE_RECORD_STATUSES)[number];

/** User-facing composite lifecycle state. */
export const DEVICE_STATES = [
  'unregistered',
  'pending_pairing',
  'paired',
  'assigned',
  'connected',
  'disconnected',
  'suspended',
  'revoked',
] as const;
export type DeviceState = (typeof DEVICE_STATES)[number];

export const DEVICE_STATE_LABELS: Record<DeviceState, string> = {
  unregistered: 'Unregistered',
  pending_pairing: 'Pending pairing',
  paired: 'Paired',
  assigned: 'Assigned',
  connected: 'Connected',
  disconnected: 'Disconnected',
  suspended: 'Suspended',
  revoked: 'Revoked',
};

/** A device counts as connected if it has an open realtime stream or was seen within this window. */
export const DEVICE_ONLINE_WINDOW_S = 90;

export function deriveDeviceState(input: {
  status: DeviceRecordStatus;
  assignedUserId: string | null;
  lastSeenAt: Date | string | null;
  streamOpen: boolean;
  now?: Date;
}): DeviceState {
  if (input.status === 'revoked') return 'revoked';
  if (input.status === 'suspended') return 'suspended';
  const now = input.now ?? new Date();
  const seen = input.lastSeenAt ? new Date(input.lastSeenAt).getTime() : null;
  const recentlySeen = seen !== null && (now.getTime() - seen) / 1000 <= DEVICE_ONLINE_WINDOW_S;
  if (input.streamOpen || recentlySeen) return input.assignedUserId ? 'connected' : 'paired';
  if (!input.assignedUserId) return 'paired';
  return seen === null ? 'assigned' : 'disconnected';
}

// ---------------- Pairing ----------------

/** Crockford-style alphabet without easily confused characters (no 0/O, 1/I/L, U). */
export const PAIRING_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIRING_CODE_LENGTH = 8;
/** Challenge lifetime. Short enough to limit guessing, long enough to walk to a phone. */
export const PAIRING_TTL_S = 300;
/** Minimum interval between device polls; faster polling receives `slow_down`. */
export const PAIRING_POLL_INTERVAL_S = 3;
/** Wrong-code lookups allowed per client before rate limiting kicks in. */
export const PAIRING_MAX_LOOKUPS_PER_MINUTE = 10;

export const PAIRING_STATUSES = ['pending', 'approved', 'completed', 'denied', 'expired', 'cancelled'] as const;
export type PairingStatus = (typeof PAIRING_STATUSES)[number];

/** Format as XXXX-XXXX for display. */
export function formatPairingCode(code: string): string {
  const c = normalizePairingCode(code);
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/**
 * Normalize user input: uppercase and strip separators/whitespace. Characters outside
 * the alphabet (including the deliberately excluded 0/O/1/I/L/U) are dropped, which
 * makes the code too short and therefore invalid rather than silently "corrected".
 */
export function normalizePairingCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .split('')
    .filter((ch) => PAIRING_CODE_ALPHABET.includes(ch))
    .join('');
}

export function isValidPairingCode(input: string): boolean {
  return normalizePairingCode(input).length === PAIRING_CODE_LENGTH;
}

/** Device-side display assumptions for the primary target (verify on hardware). */
export const GLASSES_DISPLAY = {
  width: 600,
  height: 600,
  /** Additive display: pure black is rendered as transparent. */
  additive: true,
} as const;
