import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Conn = Db | Tx;

export interface Database {
  db: Db;
  kind: 'pglite' | 'postgres';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/** apps/api/drizzle, resolved relative to this source file (works under tsx; bundlers pass migrationsFolder). */
export function defaultMigrationsFolder(): string {
  try {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  } catch {
    return resolve(process.cwd(), 'drizzle');
  }
}

export interface DatabaseOptions {
  /** Folder holding drizzle SQL migrations + meta/_journal.json (bundlers move this file). */
  migrationsFolder?: string;
  /** node-postgres pool size (keep small on serverless: many instances x pool). */
  poolMax?: number;
}

/** Arbitrary constant key for the migration advisory lock ("hydris" in ASCII-ish). */
const MIGRATION_LOCK_KEY = 4_872_917_633;

export async function createDatabase(url: string, opts: DatabaseOptions = {}): Promise<Database> {
  const migrationsFolder = opts.migrationsFolder ?? defaultMigrationsFolder();
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url, max: opts.poolMax ?? 10 });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: 'postgres',
      // A session-level advisory lock on one dedicated connection serializes concurrent
      // migrators (several cold-starting serverless instances, or deploy + instance).
      migrate: async () => {
        const client = await pool.connect();
        try {
          await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
          try {
            await migratePg(drizzlePg(client, { schema }) as never, { migrationsFolder });
          } finally {
            await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
          }
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  let client: PGlite;
  if (url === 'memory://' || url === ':memory:') client = new PGlite();
  else {
    mkdirSync(dirname(resolve(url)), { recursive: true });
    client = new PGlite(resolve(url));
  }
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    kind: 'pglite',
    migrate: () => migratePglite(db as never, { migrationsFolder }),
    close: () => client.close(),
  };
}

/** Run raw SQL and return typed rows (driver-agnostic). */
export async function rows<T>(conn: Conn, query: import('drizzle-orm').SQL): Promise<T[]> {
  const r = (await conn.execute(query)) as unknown as { rows: T[] };
  return r.rows;
}
