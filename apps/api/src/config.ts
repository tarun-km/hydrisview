import { z } from 'zod';

for (const p of ['../../.env', '.env']) {
  try {
    process.loadEnvFile(p);
    break;
  } catch {
    /* not present */
  }
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('127.0.0.1'),
  /** postgres://... for a real server, otherwise a PGlite directory path or "memory://". */
  DATABASE_URL: z.string().default('./data/pglite'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** 32-byte hex key used to encrypt MFA secrets at rest. */
  DATA_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'DATA_KEY must be 64 hex chars'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  STORAGE_DIR: z.string().default('./data/files'),
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
  SEED_DEMO_PASSWORD: z.string().optional(),
  SIMULATOR_ENABLED: z.enum(['true', 'false']).default('true'),
  /** 'memory' = in-process event bus (single long-running API). 'db' = realtime_events table (serverless / multi-instance). */
  REALTIME_MODE: z.enum(['memory', 'db']).default('memory'),
  /** When set, attachments go to Vercel Blob (private store) instead of STORAGE_DIR. */
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  /** Shared secret Vercel Cron sends as `Authorization: Bearer <CRON_SECRET>`. */
  CRON_SECRET: z.string().optional(),
  /** "1" forces serverless behaviour (no setInterval engines); auto-detected on Vercel. */
  SERVERLESS: z.string().optional(),
  VERCEL: z.string().optional(),
  /**
   * "true" = self-contained demo: in-memory database, deterministic synthetic tenant, fixed
   * public demo secrets, lazily advanced simulation. Auto-enabled on Vercel when DATABASE_URL is unset.
   */
  DEMO_MODE: z.enum(['true', 'false']).optional(),
});

export type Config = z.infer<typeof schema> & { isProd: boolean; serverless: boolean; demoMode: boolean };

/** Public, non-secret demo credentials. Only ever used when demo mode is on and nothing else is configured. */
export const DEMO_SECRETS = {
  JWT_SECRET: 'hydris-public-demo-jwt-secret-not-for-production-use-0001',
  DATA_KEY: '0123456789abcdef'.repeat(4),
};

type Env = Record<string, string | undefined>;

/** Demo mode is explicit (DEMO_MODE=true) or implied on Vercel when no database is configured. */
export function isDemoEnv(env: Env): boolean {
  if (env.DEMO_MODE === 'true') return true;
  if (env.DEMO_MODE === 'false') return false;
  return !!env.VERCEL && !env.DATABASE_URL;
}

let demoWarned = false;

/** Fill demo-mode defaults so the demo runs with zero configuration. */
function demoDefaults(env: Env): Env {
  const out: Env = { ...env, DEMO_MODE: 'true' };
  // Only a real Postgres URL is honoured in demo mode; anything else runs in memory (per instance).
  if (!/^postgres(ql)?:\/\//.test(env.DATABASE_URL ?? '')) out.DATABASE_URL = 'memory://';
  const warn: string[] = [];
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) { out.JWT_SECRET = DEMO_SECRETS.JWT_SECRET; warn.push('JWT_SECRET'); }
  if (!env.DATA_KEY || !/^[0-9a-f]{64}$/i.test(env.DATA_KEY)) { out.DATA_KEY = DEMO_SECRETS.DATA_KEY; warn.push('DATA_KEY'); }
  if (!env.PUBLIC_APP_URL) {
    const host = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
    if (host) out.PUBLIC_APP_URL = `https://${host.replace(/^https?:\/\//, '')}`;
  }
  out.SIMULATOR_ENABLED = 'true';
  // The streaming route reads the realtime_events table (with an in-memory database that log is per instance).
  out.REALTIME_MODE = 'db';
  if (warn.length && !demoWarned) {
    demoWarned = true;
    console.warn(`[hydris] DEMO MODE: using the built-in public demo ${warn.join(' and ')}. Synthetic data only - never use demo mode for real plants.`);
  }
  return out;
}

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof schema>, string>> = {}): Config {
  let env: Env = { ...process.env, ...overrides };
  const demoMode = isDemoEnv(env);
  if (demoMode) env = demoDefaults(env);
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const d = parsed.data;
  // Demo mode always behaves like serverless: no interval timers; simulations advance lazily per request.
  return { ...d, isProd: d.NODE_ENV === 'production', demoMode, serverless: d.SERVERLESS === '1' || d.SERVERLESS === 'true' || !!d.VERCEL || demoMode };
}

/** Access-token lifetime: short normally; 12 h in demo mode (sessions there live per instance). */
export const accessTokenTtl = (c: { demoMode: boolean }) => (c.demoMode ? '12h' : TTL.accessToken);

export const TTL = {
  accessToken: '15m',
  refreshMs: 7 * 24 * 3600_000,
  deviceRefreshMs: 30 * 24 * 3600_000,
  inviteMs: 7 * 24 * 3600_000,
  resetMs: 30 * 60_000,
  mfaChallenge: '5m',
  lockoutMs: 15 * 60_000,
  maxFailedLogins: 5,
};
