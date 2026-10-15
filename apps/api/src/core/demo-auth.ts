/** Demo-mode authentication helpers (see ../demo.ts). Kept free of module imports to avoid cycles. */
import { createHmac } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { deviceAssignments, devices } from '../db/schema';
import { safeEqual } from './crypto';

// ------------------------------------------------------------------ devices across instances
/** Re-create a device record + assignment from token claims when this instance has never seen it. */
export async function ensureDemoDevice(tx: Tx, tok: { sub: string; org: string; sv: number; uid?: string | undefined; site?: string | null | undefined }): Promise<void> {
  if (!tok.uid) return;
  const [d] = await tx.select({ id: devices.id }).from(devices).where(eq(devices.id, tok.sub));
  if (!d) {
    await tx.insert(devices).values({
      id: tok.sub, orgId: tok.org, siteId: tok.site ?? null, name: 'Demo glasses', kind: 'simulator', model: 'Hydris browser simulator',
      hardwareId: `demo-${tok.sub}`, sessionVersion: tok.sv, pairedBy: tok.uid,
    }).onConflictDoNothing();
  }
  const [a] = await tx.select({ id: deviceAssignments.id }).from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, tok.sub), isNull(deviceAssignments.unassignedAt)));
  if (!a && !d) await tx.insert(deviceAssignments).values({ orgId: tok.org, deviceId: tok.sub, userId: tok.uid, reason: 'demo: restored from device token' }).onConflictDoNothing();
}

/** Demo device claims that let any instance rebuild the device (see ensureDemoDevice). */
export async function demoDeviceClaims(tx: Tx, device: { id: string; siteId: string | null }): Promise<{ uid?: string; site: string | null }> {
  const [a] = await tx.select({ userId: deviceAssignments.userId }).from(deviceAssignments).where(and(eq(deviceAssignments.deviceId, device.id), isNull(deviceAssignments.unassignedAt)));
  return { uid: a?.userId, site: device.siteId };
}

const uuidBytes = (u: string | null | undefined) => Buffer.from((u ?? '00000000-0000-0000-0000-000000000000').replace(/-/g, ''), 'hex');
const bytesUuid = (b: Buffer) => {
  const x = b.toString('hex');
  return x === '0'.repeat(32) ? null : `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};
const PREFIX = 'hgd_z';

/** Self-contained device refresh token (org, device, user, site, session version + HMAC). Fits the 120-char limit. */
export function encodeDemoDeviceRefresh(secret: string, c: { org: string; sub: string; uid: string; site: string | null; sv: number }): string {
  const sv = Buffer.alloc(4);
  sv.writeUInt32BE(c.sv >>> 0);
  const body = Buffer.concat([uuidBytes(c.org), uuidBytes(c.sub), uuidBytes(c.uid), uuidBytes(c.site), sv]);
  const mac = createHmac('sha256', secret).update('hydris-demo-device').update(body).digest().subarray(0, 16);
  return PREFIX + Buffer.concat([body, mac]).toString('base64url');
}

export function decodeDemoDeviceRefresh(secret: string, token: string): { org: string; sub: string; uid: string; site: string | null; sv: number } | null {
  if (!token.startsWith(PREFIX)) return null;
  const raw = Buffer.from(token.slice(PREFIX.length), 'base64url');
  if (raw.length !== 84) return null;
  const body = raw.subarray(0, 68);
  const mac = createHmac('sha256', secret).update('hydris-demo-device').update(body).digest().subarray(0, 16);
  if (!safeEqual(mac.toString('hex'), raw.subarray(68).toString('hex'))) return null;
  const org = bytesUuid(body.subarray(0, 16));
  const sub = bytesUuid(body.subarray(16, 32));
  const uid = bytesUuid(body.subarray(32, 48));
  if (!org || !sub || !uid) return null;
  return { org, sub, uid, site: bytesUuid(body.subarray(48, 64)), sv: body.readUInt32BE(64) };
}

export const isDemoDeviceRefresh = (t: string) => t.startsWith(PREFIX);

