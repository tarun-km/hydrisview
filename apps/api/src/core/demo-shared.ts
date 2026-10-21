/**
 * Demo mode: a tiny key/value store shared by every serverless instance.
 *
 * Demo data lives in each instance's in-memory database, so state created on one instance
 * (a pairing challenge, its approval, a named guest account) must be visible to the others.
 * Backends, in order of preference:
 *   1. Postgres when DATABASE_URL is a postgres URL (one small table, nothing else is stored there);
 *   2. Vercel Runtime Cache (shared per region, no configuration) when running on Vercel;
 *   3. process memory (single instance: local dev, tests).
 */
import pg from 'pg';

export interface DemoShared {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

class MemoryShared implements DemoShared {
  private m = new Map<string, { v: unknown; exp: number }>();
  async get<T>(key: string) {
    const e = this.m.get(key);
    if (!e || e.exp < Date.now()) return null;
    return e.v as T;
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    this.m.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 });
  }
}

class PgShared implements DemoShared {
  private pool: pg.Pool;
  private ready: Promise<void>;
  constructor(url: string) {
    this.pool = new pg.Pool({ connectionString: url, max: 2, idleTimeoutMillis: 10_000 });
    this.pool.on('error', () => {});
    this.ready = this.pool
      .query('create table if not exists hydris_demo_kv (k text primary key, v jsonb not null, expires_at timestamptz not null)')
      .then(() => undefined);
    this.ready.catch(() => {}); // surfaced on first use (and absorbed by Resilient)
  }
  async get<T>(key: string) {
    await this.ready;
    const r = await this.pool.query('select v from hydris_demo_kv where k = $1 and expires_at > now()', [key]);
    return (r.rows[0]?.v ?? null) as T | null;
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    await this.ready;
    await this.pool.query(
      `insert into hydris_demo_kv (k, v, expires_at) values ($1, $2, now() + make_interval(secs => $3))
       on conflict (k) do update set v = excluded.v, expires_at = excluded.expires_at`,
      [key, JSON.stringify(value), ttlSeconds],
    );
  }
}

class VercelCacheShared implements DemoShared {
  private cache: Promise<{ get(k: string): Promise<unknown>; set(k: string, v: unknown, o?: { ttl?: number }): Promise<void> } | null>;
  private fallback = new MemoryShared();
  constructor() {
    this.cache = import('@vercel/functions')
      .then((m) => (m as unknown as { getCache: () => never }).getCache())
      .catch(() => null);
  }
  async get<T>(key: string) {
    const c = await this.cache;
    if (!c) return this.fallback.get<T>(key);
    try {
      return ((await c.get(key)) ?? null) as T | null;
    } catch {
      return this.fallback.get<T>(key);
    }
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    await this.fallback.set(key, value, ttlSeconds);
    const c = await this.cache;
    if (c) await c.set(key, value, { ttl: ttlSeconds }).catch(() => {});
  }
}

/** Never let the shared store break the demo: on errors fall back to this instance's memory. */
class Resilient implements DemoShared {
  private mem = new MemoryShared();
  constructor(private inner: DemoShared) {}
  async get<T>(key: string) {
    try {
      return (await this.inner.get<T>(key)) ?? (await this.mem.get<T>(key));
    } catch (e) {
      console.warn('[hydris] demo shared store read failed', (e as Error).message);
      return this.mem.get<T>(key);
    }
  }
  async set(key: string, value: unknown, ttlSeconds: number) {
    await this.mem.set(key, value, ttlSeconds);
    try {
      await this.inner.set(key, value, ttlSeconds);
    } catch (e) {
      console.warn('[hydris] demo shared store write failed', (e as Error).message);
    }
  }
}

let shared: DemoShared | null = null;

export function demoShared(): DemoShared {
  if (shared) return shared;
  const url = process.env.DATABASE_URL ?? '';
  if (/^postgres(ql)?:\/\//.test(url) && process.env.NODE_ENV !== 'test') shared = new Resilient(new PgShared(url));
  else if (process.env.VERCEL) shared = new Resilient(new VercelCacheShared());
  else shared = new MemoryShared();
  return shared;
}

/** Test hook: use a fresh in-memory store. */
export function resetDemoShared() {
  shared = new MemoryShared();
}
