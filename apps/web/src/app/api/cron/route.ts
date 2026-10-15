/**
 * Vercel Cron entry (see root vercel.json "crons"). Runs one pass of the background jobs:
 * stale-data alarms, pairing expiry, realtime_events pruning and — when
 * SIMULATOR_ENABLED=true — one step of every running demo simulation.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is rejected.
 */
import { timingSafeEqual } from 'node:crypto';
import { getServerlessApi, runScheduledJobs } from '@hydris/api/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request): Promise<Response> {
  if (!authorized(req.headers.get('authorization'))) {
    return Response.json({ error: { code: 'unauthorized', message: 'Invalid cron secret' } }, { status: 401 });
  }
  const api = await getServerlessApi();
  const started = Date.now();
  const report = await runScheduledJobs(api.ctx);
  return Response.json({ ok: true, ms: Date.now() - started, report });
}
