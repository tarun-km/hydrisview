import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Conn } from '../db/client.js';
import { auditEvents, mailOutbox, notifications } from '../db/schema.js';
import type { Principal } from './principal.js';
import type { EventBus } from './events.js';

export interface AuditInput {
  orgId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
}

/** Append an audit event inside the caller's transaction. */
export async function audit(tx: Conn, actor: Principal | { userId?: string | null; deviceId?: string | null; label?: string } | null, e: AuditInput) {
  const a = actor as { userId?: string | null; deviceId?: string | null; label?: string; kind?: string } | null;
  await tx.insert(auditEvents).values({
    orgId: e.orgId,
    actorUserId: a?.userId ?? null,
    actorDeviceId: a?.deviceId ?? null,
    actorLabel: a?.label ?? (a?.kind === 'device' ? 'glasses' : null),
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    summary: e.summary,
    metadata: e.metadata,
    ip: e.ip,
  });
}

/** Mail transport adapter. Development records messages in mail_outbox. */
export async function sendMail(tx: Conn, to: string, subject: string, bodyText: string) {
  await tx.insert(mailOutbox).values({ to, subject, bodyText });
}

export async function notify(
  tx: Conn,
  bus: EventBus,
  n: { orgId: string; userIds: string[]; kind: string; title: string; body?: string; link?: string; severity?: 'info' | 'success' | 'warning' | 'critical'; entityType?: string; entityId?: string },
) {
  const ids = [...new Set(n.userIds)];
  if (!ids.length) return;
  const rows = await tx
    .insert(notifications)
    .values(ids.map((userId) => ({ orgId: n.orgId, userId, kind: n.kind, title: n.title, body: n.body, link: n.link, severity: n.severity ?? 'info', entityType: n.entityType, entityId: n.entityId })))
    .returning();
  for (const r of rows) bus.publish({ type: 'notification.created', orgId: n.orgId, userIds: [r.userId], payload: r });
}

/** Local filesystem object storage. Keys are random; files are served only through authorized routes. */
export class Storage {
  constructor(private dir: string) {}
  async put(orgId: string, data: Buffer): Promise<string> {
    const key = `${orgId}/${randomUUID()}`;
    const path = resolve(this.dir, key);
    await mkdir(resolve(this.dir, orgId), { recursive: true });
    await writeFile(path, data);
    return key;
  }
  async get(key: string): Promise<Buffer> {
    if (key.includes('..')) throw new Error('invalid key');
    return readFile(join(resolve(this.dir), key));
  }
}
