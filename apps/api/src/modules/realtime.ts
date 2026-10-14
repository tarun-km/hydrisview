import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../context.js';
import { resolvePrincipal } from '../context.js';
import type { DomainEvent } from '../core/events.js';
import { has, siteAllowed, type Principal } from '../core/principal.js';
import { unauthorized } from '../core/errors.js';

/** Per-connection authorization of a domain event. */
export function canReceive(p: Principal, e: DomainEvent): boolean {
  if (e.orgId !== p.orgId) return false;
  if (e.deviceIds) return p.kind === 'device' && e.deviceIds.includes(p.deviceId!);
  if (e.userIds && !e.userIds.includes(p.userId)) return false;
  if (e.siteId && !siteAllowed(p, e.siteId)) return false;
  if (e.permission && !has(p, e.permission)) return false;
  return true;
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
    const send = (e: DomainEvent) => {
      if (p && canReceive(p, e)) res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify({ ...(e.payload as object), _at: e.at })}\n\n`);
    };
    res.write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify({ kind: p.kind, serverTime: new Date().toISOString() })}\n\n`);
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
