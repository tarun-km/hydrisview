import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context';
import { resolvePrincipal } from '../context';
import { latestEventId, readEventsSince, type DomainEvent } from '../core/events';
import { has, siteAllowed, type Principal } from '../core/principal';
import { unauthorized } from '../core/errors';

/** Per-connection authorization of a domain event. */
export function canReceive(p: Principal, e: DomainEvent): boolean {
  if (e.orgId !== p.orgId) return false;
  if (e.deviceIds) return p.kind === 'device' && e.deviceIds.includes(p.deviceId!);
  if (e.userIds && !e.userIds.includes(p.userId)) return false;
  if (e.siteId && !siteAllowed(p, e.siteId)) return false;
  if (e.permission && !has(p, e.permission)) return false;
  return true;
}

/** Events that end the receiving session: the stream closes right after delivering them. */
export const isTerminalFor = (p: Principal, e: DomainEvent) =>
  (e.type === 'account.ended' && p.kind === 'user') || (e.type === 'session.revoked' && p.kind === 'device');

export const formatSse = (e: DomainEvent) => `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify({ ...(e.payload as object), _at: e.at })}\n\n`;
export const readySse = (p: Principal, retryMs = 3000) => `retry: ${retryMs}\nevent: ready\ndata: ${JSON.stringify({ kind: p.kind, serverTime: new Date().toISOString() })}\n\n`;

export interface DbStreamOptions {
  ctx: Ctx;
  principal: Principal;
  /** Last-Event-ID from the client (0 = fresh connection: start at the current head). */
  lastId: number;
  write: (chunk: string) => void;
  isClosed: () => boolean;
  /** Re-resolve the session; null ends the stream with `session.ended`. */
  revalidate: () => Promise<Principal | null>;
  /** End the response after this long so serverless functions finish before their limit. */
  maxMs?: number;
  pollMs?: number;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * REALTIME_MODE=db stream loop: polls realtime_events for id > cursor, applies the same
 * canReceive authorization, sends heartbeats, and ends cleanly before `maxMs` with a short
 * `retry:` so clients reconnect with Last-Event-ID and resume without gaps.
 */
export async function runDbEventStream(o: DbStreamOptions): Promise<void> {
  const pollMs = o.pollMs ?? 1500;
  const maxMs = o.maxMs ?? 0;
  const started = Date.now();
  let p: Principal | null = o.principal;
  let cursor = o.lastId > 0 ? o.lastId : await latestEventId(o.ctx.db);
  o.write(readySse(p, 1000));
  let lastBeat = Date.now();
  let lastCheck = Date.now();
  while (!o.isClosed()) {
    o.ctx.onActivity?.();
    const events = await readEventsSince(o.ctx.db, cursor, p.orgId);
    for (const e of events) {
      cursor = e.id;
      if (canReceive(p, e)) {
        o.write(formatSse(e));
        if (isTerminalFor(p, e)) return;
      }
    }
    if (Date.now() - lastBeat >= 15_000) {
      o.write(`: hb ${Date.now()}\n\n`);
      lastBeat = Date.now();
    }
    if (Date.now() - lastCheck >= 30_000) {
      lastCheck = Date.now();
      p = await o.revalidate().catch(() => null);
      if (!p) {
        o.write(`event: session.ended\ndata: {}\n\n`);
        return;
      }
    }
    if (maxMs && Date.now() - started + pollMs >= maxMs) {
      o.write(`: reconnect\n\n`);
      return;
    }
    await delay(pollMs);
  }
}

/**
 * Server-Sent Events stream. Clients connect with fetch() so the bearer token travels
 * in the Authorization header (never in the URL). Supports Last-Event-ID replay and
 * re-validates the session every 30 s so revoked users/devices are disconnected.
 */
export async function realtimeRoutes(app: FastifyInstance, ctx: Ctx) {
  app.get('/events/stream', async (req, reply) => {
    let p = await resolvePrincipal(ctx, req);
    if (!p) throw unauthorized();
    const lastId = Number(req.headers['last-event-id'] ?? (req.query as { lastEventId?: string }).lastEventId ?? 0) || 0;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    if (ctx.bus.mode === 'db') {
      let closed = false;
      req.raw.on('close', () => (closed = true));
      // Long-running server: no time limit; presence comes from devices.last_seen_at.
      await runDbEventStream({ ctx, principal: p, lastId, write: (c) => res.write(c), isClosed: () => closed, revalidate: () => resolvePrincipal(ctx, req) })
        .catch((e) => req.log.error(e));
      res.end();
      return;
    }
    let ended = false;
    const send = (e: DomainEvent) => {
      if (ended || !p || !canReceive(p, e)) return;
      res.write(formatSse(e));
      // Suspended / removed: tell the client and close now (it must not reconnect with this session).
      if (isTerminalFor(p, e)) {
        ended = true;
        res.end();
      }
    };
    res.write(readySse(p));
    for (const e of ctx.bus.since(lastId)) send(e);

    const deviceId = p.kind === 'device' ? p.deviceId! : null;
    if (deviceId) ctx.liveDevices.set(deviceId, (ctx.liveDevices.get(deviceId) ?? 0) + 1);
    const unsub = ctx.bus.subscribe(send);
    const heartbeat = setInterval(() => res.write(`: hb ${Date.now()}\n\n`), 15_000);
    const revalidate = setInterval(async () => {
      try {
        p = await resolvePrincipal(ctx, req);
      } catch {
        p = null;
      }
      if (!p) {
        res.write(`event: session.ended\ndata: {}\n\n`);
        res.end();
      }
    }, 30_000);

    const cleanup = () => {
      clearInterval(heartbeat);
      clearInterval(revalidate);
      unsub();
      if (deviceId) {
        const n = (ctx.liveDevices.get(deviceId) ?? 1) - 1;
        if (n <= 0) ctx.liveDevices.delete(deviceId);
        else ctx.liveDevices.set(deviceId, n);
      }
    };
    req.raw.on('close', cleanup);
  });
}
