import { EventEmitter } from 'node:events';
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import type { Permission } from '@hydris/domain';
import type { Db } from '../db/client';
import { realtimeEvents } from '../db/schema';
import { withSystem } from '../db/tenant';

/**
 * Domain event bus feeding the realtime hub. Each event names the tenant, optional
 * site, and the permission a subscriber needs to receive it, so the hub can authorize
 * delivery per connection.
 *
 * Two modes:
 * - `memory` (default): in-process EventEmitter + replay ring. Single long-running API.
 * - `db`: events are appended to `realtime_events` and SSE streams poll that table, so
 *   any number of (serverless) instances share one event log. Publishing is buffered and
 *   written by `flush()`, which the app awaits in an `onSend` hook — i.e. after the route
 *   handler (and therefore its transaction) has finished, outside the caller's transaction.
 *   Events from a request whose transaction rolled back may still be written; events are
 *   refetch hints, so a spurious one only triggers a harmless refetch.
 */
export interface DomainEvent {
  id: number;
  type: string;
  orgId: string;
  siteId?: string | null;
  permission?: Permission;
  /** Restrict delivery to these users (e.g. personal notifications). */
  userIds?: string[];
  /** Restrict delivery to these devices. */
  deviceIds?: string[];
  payload: unknown;
  at: string;
}

export type RealtimeMode = 'memory' | 'db';

export class EventBus {
  private emitter = new EventEmitter();
  private seq = 0;
  private ring: DomainEvent[] = [];
  private pending: Omit<DomainEvent, 'id'>[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();

  constructor(readonly mode: RealtimeMode = 'memory', private db?: Db) {
    this.emitter.setMaxListeners(0);
    if (mode === 'db' && !db) throw new Error('EventBus db mode requires a database');
  }

  publish(e: Omit<DomainEvent, 'id' | 'at'>): DomainEvent {
    if (this.mode === 'db') {
      const ev = { ...e, at: new Date().toISOString() };
      this.pending.push(ev);
      // Safety net for publishes outside a request (jobs); requests flush in onSend.
      if (!this.flushTimer) this.flushTimer = setTimeout(() => void this.flush().catch((err) => console.error('[events] flush', err)), 25);
      return { ...ev, id: 0 };
    }
    const ev: DomainEvent = { ...e, id: ++this.seq, at: new Date().toISOString() };
    this.ring.push(ev);
    if (this.ring.length > 1000) this.ring.shift();
    this.emitter.emit('event', ev);
    return ev;
  }

  /** Write buffered events (db mode). Safe to call repeatedly; no-op in memory mode. */
  flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.mode !== 'db' || !this.pending.length) return this.flushing;
    const batch = this.pending.splice(0);
    this.flushing = this.flushing.then(() =>
      withSystem(this.db!, async (tx) => {
        await tx.insert(realtimeEvents).values(batch.map((e) => ({
          orgId: e.orgId, type: e.type, siteId: e.siteId ?? null, permission: e.permission ?? null,
          userIds: e.userIds ?? null, deviceIds: e.deviceIds ?? null, payload: e.payload ?? null, createdAt: new Date(e.at),
        })));
      }),
    ).catch((err) => console.error('[events] failed to persist realtime events', err));
    return this.flushing;
  }

  subscribe(fn: (e: DomainEvent) => void): () => void {
    this.emitter.on('event', fn);
    return () => this.emitter.off('event', fn);
  }

  /** Events after `lastId` for replay on reconnect (Last-Event-ID). Memory mode only. */
  since(lastId: number): DomainEvent[] {
    return this.ring.filter((e) => e.id > lastId);
  }
}

type EventRow = typeof realtimeEvents.$inferSelect;
const toDomain = (r: EventRow): DomainEvent => ({
  id: r.id, type: r.type, orgId: r.orgId, siteId: r.siteId, permission: (r.permission ?? undefined) as Permission | undefined,
  userIds: r.userIds ?? undefined, deviceIds: r.deviceIds ?? undefined, payload: r.payload, at: r.createdAt.toISOString(),
});

/** Persisted events with id > afterId (db mode), oldest first. Optionally scoped to one org. */
export async function readEventsSince(db: Db, afterId: number, orgId?: string, limit = 500): Promise<DomainEvent[]> {
  const rows = await withSystem(db, (tx) => tx.select().from(realtimeEvents)
    .where(orgId ? and(gt(realtimeEvents.id, afterId), eq(realtimeEvents.orgId, orgId)) : gt(realtimeEvents.id, afterId))
    .orderBy(asc(realtimeEvents.id)).limit(limit));
  return rows.map(toDomain);
}

/** Highest persisted event id (0 when empty) — the starting cursor for a fresh stream. */
export async function latestEventId(db: Db): Promise<number> {
  const [r] = await withSystem(db, (tx) => tx.select({ id: realtimeEvents.id }).from(realtimeEvents).orderBy(desc(realtimeEvents.id)).limit(1));
  return r?.id ?? 0;
}

/** Delete persisted events older than `maxAgeMs` (default one day). Returns rows removed. */
export async function pruneRealtimeEvents(db: Db, maxAgeMs = 24 * 3600_000): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMs);
  const rows = await withSystem(db, (tx) => tx.delete(realtimeEvents).where(lt(realtimeEvents.createdAt, cutoff)).returning({ id: realtimeEvents.id }));
  return rows.length;
}
