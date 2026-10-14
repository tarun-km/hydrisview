import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { desc, sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { mailOutbox } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import type { Ctx } from '../src/context.js';
import { demoEmail, seedDemo, seedPlatformAdmin, type DemoSeedResult } from '../src/seed/demo.js';

export const PW = 'correct-horse-battery-staple';
export const ADMIN = 'root@platform.test';

export interface Harness {
  app: FastifyInstance;
  ctx: Ctx;
  database: Database;
  demo: DemoSeedResult;
}

export async function harness(): Promise<Harness> {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'memory://', JWT_SECRET: 'x'.repeat(48), DATA_KEY: 'a'.repeat(64), STORAGE_DIR: './data/test-files', SIMULATOR_ENABLED: 'true',
  });
  const database = await createDatabase(config.DATABASE_URL);
  await database.migrate();
  await seedPlatformAdmin(database.db, ADMIN, PW);
  const demo = await seedDemo(database.db, PW, { historyHours: 0 });
  const { app, ctx } = await buildApp({ db: database.db, config, relaxedLimits: true });
  await app.ready();
  return { app, ctx, database, demo };
}

export type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export class Client {
  token = '';
  cookie = '';
  constructor(private app: FastifyInstance) {}
  async req(method: Method, url: string, payload?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    return this.app.inject({
      method, url, payload: payload as object,
      headers: { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
  }
  async login(email: string, password = PW) {
    const r = await this.req('POST', '/api/auth/login', { email, password });
    if (r.statusCode === 200) this.absorb(r);
    return r;
  }
  absorb(r: LightMyRequestResponse) {
    const body = r.json();
    if (body.accessToken) this.token = body.accessToken;
    const set = r.headers['set-cookie'];
    const c = (Array.isArray(set) ? set : [set]).find((x) => x?.startsWith('hg_refresh='));
    if (c) this.cookie = c.split(';')[0]!;
    return body;
  }
}

export async function as(app: FastifyInstance, key: string) {
  const c = new Client(app);
  const r = await c.login(key.includes('@') ? key : demoEmail(key));
  if (r.statusCode !== 200) throw new Error(`login ${key} failed: ${r.body}`);
  return c;
}

export async function lastMailTo(h: Harness, to: string) {
  return withSystem(h.database.db, async (tx) => (await tx.select().from(mailOutbox).where(sql`${mailOutbox.to} = ${to}`).orderBy(desc(mailOutbox.createdAt)).limit(1))[0]);
}

export const linkToken = (body: string, path: string) => new RegExp(`${path}(?:\\?token=)?([A-Za-z0-9_-]+)`).exec(body)?.[1] ?? '';
