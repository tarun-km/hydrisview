import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Config } from './config';
import type { Db } from './db/client';
import { HttpError } from './core/errors';
import { EventBus } from './core/events';
import { createStorage } from './core/services';
import type { Ctx } from './context';
import { authRoutes } from './modules/auth';
import { orgRoutes } from './modules/org';
import { plantRoutes } from './modules/plant';
import { telemetryRoutes } from './modules/telemetry';
import { alarmRoutes } from './modules/alarms';
import { inspectionModule } from './modules/inspections';
import { maintenanceRoutes } from './modules/maintenance';
import { deviceRoutes } from './modules/devices';
import { realtimeRoutes } from './modules/realtime';
import { insightRoutes } from './modules/insights';
import { publicRoutes } from './modules/public';
import { simulationRoutes } from './modules/simulation';
import { installProfileEnforcement, uiProfileRoutes } from './modules/ui-profiles';

export interface BuildOptions {
  db: Db;
  config: Config;
  logger?: boolean;
  /** Relax per-route rate limits (tests). */
  relaxedLimits?: boolean;
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false, bodyLimit: 1024 * 1024, trustProxy: true });
  const ctx: Ctx = { db: opts.db, config: opts.config, bus: new EventBus(opts.config.REALTIME_MODE, opts.db), storage: createStorage(opts.config), liveDevices: new Map() };
  // db realtime mode: persist events published by the handler once it has finished (its transaction is closed).
  if (ctx.bus.mode === 'db') app.addHook('onSend', async () => ctx.bus.flush());

  app.decorateRequest('principal', null);
  app.decorateRequest('platformUserId', null);
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: opts.relaxedLimits ? 100_000 : 600, timeWindow: '1 minute' });
  await app.register(jwt, { secret: opts.config.JWT_SECRET });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: { code: 'validation_failed', message: 'Some fields are invalid', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      });
    }
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: { code: status === 429 ? 'rate_limited' : status >= 500 ? 'internal_error' : (err.code ?? 'request_error'), message: status >= 500 ? 'Unexpected server error' : err.message } });
  });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  // Must precede route registration: appends glasses UI-profile checks to matching routes.
  installProfileEnforcement(app, ctx);
  const mods = [authRoutes, orgRoutes, plantRoutes, telemetryRoutes, alarmRoutes, inspectionModule, maintenanceRoutes, deviceRoutes, realtimeRoutes, insightRoutes, publicRoutes, simulationRoutes, uiProfileRoutes];
  for (const m of mods) await app.register(async (scope) => m(scope, ctx, opts), { prefix: '/api' });

  return { app, ctx };
}
