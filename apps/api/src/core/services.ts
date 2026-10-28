import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Conn } from '../db/client';
import { auditEvents, mailOutbox, notifications } from '../db/schema';
import type { Principal } from './principal';
import type { EventBus } from './events';

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

/**
 * Queue an email in mail_outbox (inside the caller's transaction). With BREVO_API_KEY set the
 * outbox is delivered through Brevo after the request (core/mailer.ts); otherwise the outbox
 * itself is the transport (development, tests, demo).
 */
export async function sendMail(tx: Conn, to: string, subject: string, bodyText: string, bodyHtml?: string | null) {
  await tx.insert(mailOutbox).values({ to, subject, bodyText, bodyHtml: bodyHtml ?? null });
}

/** Queue a branded template (subject + text + HTML). */
export async function sendTemplate(tx: Conn, to: string, mail: { subject: string; text: string; html: string }) {
  await sendMail(tx, to, mail.subject, mail.text, mail.html);
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

/**
 * Object storage adapter for attachments. Keys are random and never exposed as URLs:
 * files are always served through the authorized `/api/attachments/:id` route.
 */
export interface Storage {
  readonly kind: 'disk' | 'vercel-blob';
  put(orgId: string, data: Buffer, contentType?: string): Promise<string>;
  get(key: string): Promise<Buffer>;
}

const validKey = (key: string) => {
  if (key.includes('..') || key.startsWith('/')) throw new Error('invalid key');
};

/** Local filesystem storage (development, single-host deployments). */
export class DiskStorage implements Storage {
  readonly kind = 'disk' as const;
  constructor(private dir: string) {}
  async put(orgId: string, data: Buffer): Promise<string> {
    const key = `${orgId}/${randomUUID()}`;
    const path = resolve(this.dir, key);
    await mkdir(resolve(this.dir, orgId), { recursive: true });
    await writeFile(path, data);
    return key;
  }
  async get(key: string): Promise<Buffer> {
    validKey(key);
    return readFile(join(resolve(this.dir), key));
  }
}

/**
 * Vercel Blob storage using a PRIVATE store: blobs are written with `access: 'private'`
 * and read server-side with the read-write token, so no public URL ever exists.
 */
export class VercelBlobStorage implements Storage {
  readonly kind = 'vercel-blob' as const;
  constructor(private token: string) {}
  async put(orgId: string, data: Buffer, contentType?: string): Promise<string> {
    const { put } = await import('@vercel/blob');
    const key = `attachments/${orgId}/${randomUUID()}`;
    await put(key, data, { access: 'private', token: this.token, addRandomSuffix: false, contentType: contentType ?? 'application/octet-stream' });
    return key;
  }
  async get(key: string): Promise<Buffer> {
    validKey(key);
    const { get } = await import('@vercel/blob');
    const r = await get(key, { access: 'private', token: this.token, useCache: false });
    if (!r || r.statusCode !== 200) throw new Error('blob not found');
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
}

/** Vercel Blob when BLOB_READ_WRITE_TOKEN is configured, local disk otherwise. */
export function createStorage(cfg: { STORAGE_DIR: string; BLOB_READ_WRITE_TOKEN?: string | undefined }): Storage {
  return cfg.BLOB_READ_WRITE_TOKEN ? new VercelBlobStorage(cfg.BLOB_READ_WRITE_TOKEN) : new DiskStorage(cfg.STORAGE_DIR);
}
