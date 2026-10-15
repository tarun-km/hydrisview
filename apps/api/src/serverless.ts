/**
 * Serverless entry point (Vercel / Next.js route handlers).
 *
 * Builds the Fastify app once per function instance and caches it in a module-level
 * promise. Migrations run once per instance on cold start, serialized across instances
 * by a Postgres advisory lock (see createDatabase). Requests are forwarded with
 * `app.inject`, except the SSE stream which the host streams itself via
 * `runDbEventStream` + `authenticateBearer`.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';
import { loadConfig, type Config } from './config';
import { createDatabase, defaultMigrationsFolder, type Database } from './db/client';
import { resolveTokenPrincipal, type Ctx, type DeviceJwt, type MfaJwt, type UserJwt } from './context';
import type { Principal } from './core/principal';

export { runScheduledJobs, type JobReport } from './jobs';
export { runDbEventStream, canReceive, formatSse, readySse } from './modules/realtime';
export type { Principal } from './core/principal';
export type { Ctx } from './context';

export interface ServerlessApi {
  app: FastifyInstance;
  ctx: Ctx;
  database: Database;
  config: Config;
}

/** Locate apps/api/drizzle from wherever the bundle runs (Vercel: /var/task/apps/web). */
export function findMigrationsFolder(): string {
  const candidates = [
    process.env.HYDRIS_MIGRATIONS_DIR,
    resolve(process.cwd(), '../api/drizzle'),
    resolve(process.cwd(), 'apps/api/drizzle'),
    resolve(process.cwd(), 'drizzle'),
    defaultMigrationsFolder(),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(resolve(p, 'meta/_journal.json')));
  if (!found) throw new Error(`Hydris migrations folder not found (tried: ${candidates.join(', ')}). Set HYDRIS_MIGRATIONS_DIR.`);
  return found;
}

let instance: Promise<ServerlessApi> | null = null;

async function create(): Promise<ServerlessApi> {
  const config = loadConfig();
  const database = await createDatabase(config.DATABASE_URL, { migrationsFolder: findMigrationsFolder(), poolMax: config.serverless ? 3 : 10 });
  // MIGRATE_ON_START=false when migrations are run in the build step instead (npm run vercel-build).
  if (process.env.MIGRATE_ON_START !== 'false') await database.migrate();
  const { app, ctx } = await buildApp({ db: database.db, config, logger: process.env.API_LOG === 'true' });
  await app.ready();
  return { app, ctx, database, config };
}

/** The per-instance API (built on first use; a failed build is retried on the next request). */
export function getServerlessApi(): Promise<ServerlessApi> {
  if (!instance) {
    instance = create().catch((e) => {
      instance = null;
      throw e;
    });
  }
  return instance;
}

/** Verify `Authorization: Bearer <jwt>` and resolve the principal (same rules as API routes). */
export async function authenticateBearer(api: ServerlessApi, authorization: string | null, ip?: string): Promise<Principal | null> {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  if (!m) return null;
  let tok: UserJwt | DeviceJwt | MfaJwt;
  try {
    tok = api.app.jwt.verify<UserJwt | DeviceJwt | MfaJwt>(m[1]!);
  } catch {
    return null;
  }
  return resolveTokenPrincipal(api.ctx, tok, ip ? { ip } : {});
}
