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
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Conn = Db | Tx;

export interface Database {
  db: Db;
  kind: 'pglite' | 'postgres';
  migrate(): Promise<void>;
  close(): Promise<void>;
}

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export async function createDatabase(url: string): Promise<Database> {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return {
      db,
      kind: 'postgres',
      migrate: () => migratePg(db as never, { migrationsFolder: MIGRATIONS }),
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
    migrate: () => migratePglite(db as never, { migrationsFolder: MIGRATIONS }),
    close: () => client.close(),
  };
}

/** Run raw SQL and return typed rows (driver-agnostic). */
export async function rows<T>(conn: Conn, query: import('drizzle-orm').SQL): Promise<T[]> {
  const r = (await conn.execute(query)) as unknown as { rows: T[] };
  return r.rows;
}
