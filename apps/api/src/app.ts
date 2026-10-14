import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { HttpError } from './core/errors.js';
import { EventBus } from './core/events.js';
import { Storage } from './core/services.js';
import type { Ctx } from './context.js';
import { authRoutes } from './modules/auth.js';
import { orgRoutes } from './modules/org.js';
import { plantRoutes } from './modules/plant.js';
import { telemetryRoutes } from './modules/telemetry.js';
import { alarmRoutes } from './modules/alarms.js';
import { inspectionModule } from './modules/inspections.js';
import { maintenanceRoutes } from './modules/maintenance.js';
import { deviceRoutes } from './modules/devices.js';
import { realtimeRoutes } from './modules/realtime.js';
import { insightRoutes } from './modules/insights.js';
import { publicRoutes } from './modules/public.js';
import { simulationRoutes } from './modules/simulation.js';

export interface BuildOptions {
  db: Db;
  config: Config;
  logger?: boolean;
  /** Relax per-route rate limits (tests). */
  relaxedLimits?: boolean;
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: Ctx }> {
  const app = Fastify({ logger: opts.logger ? { level: 'info' } : false, bodyLimit: 1024 * 1024, trustProxy: true });
  const ctx: Ctx = { db: opts.db, config: opts.config, bus: new EventBus(), storage: new Storage(opts.config.STORAGE_DIR), liveDevices: new Map() };

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

  const mods = [authRoutes, orgRoutes, plantRoutes, telemetryRoutes, alarmRoutes, inspectionModule, maintenanceRoutes, deviceRoutes, realtimeRoutes, insightRoutes, publicRoutes, simulationRoutes];
  for (const m of mods) await app.register(async (scope) => m(scope, ctx, opts), { prefix: '/api' });

  return { app, ctx };
}
