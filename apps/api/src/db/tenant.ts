import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

/**
 * Database-boundary tenant isolation.
 *
 * Every request runs inside a transaction that switches to the non-privileged
 * `hydris_app` role and sets `app.org_id`. Row-level security policies on all
 * tenant tables then only expose rows of that organization, so a missing WHERE
 * clause in application code cannot leak another tenant's data.
 */
export async function withTenant<T>(db: Db, orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role hydris_app`);
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

/**
 * System context for work that legitimately spans tenants (authentication lookups,
 * gateway key resolution, pairing, background jobs, platform administration).
 * Still runs as `hydris_app`, so append-only grants (e.g. audit) remain enforced.
 */
export async function withSystem<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role hydris_app`);
    await tx.execute(sql`select set_config('app.bypass', 'on', true)`);
    return fn(tx);
  });
}
