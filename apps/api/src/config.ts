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
});

export type Config = z.infer<typeof schema> & { isProd: boolean };

export function loadConfig(overrides: Partial<Record<keyof z.infer<typeof schema>, string>> = {}): Config {
  const parsed = schema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  return { ...parsed.data, isProd: parsed.data.NODE_ENV === 'production' };
}

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
