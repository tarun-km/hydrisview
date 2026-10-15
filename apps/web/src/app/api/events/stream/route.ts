/**
 * Built-in API mode realtime stream (Server-Sent Events from the realtime_events table).
 * Streams for up to ~50 s, then ends with `retry:` so the client reconnects with
 * Last-Event-ID and resumes — keeping each invocation under the function time limit.
 * Requires REALTIME_MODE=db (an in-memory bus cannot span serverless instances).
 */
import { authenticateBearer, getServerlessApi, runDbEventStream } from '@hydris/api/serverless';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const STREAM_MS = 50_000;

export async function GET(req: Request): Promise<Response> {
  let api;
  try {
    api = await getServerlessApi();
  } catch (e) {
    console.error('[api] failed to start', e);
    return Response.json({ error: { code: 'service_unavailable', message: 'API is starting or misconfigured' } }, { status: 503 });
  }
  if (api.ctx.bus.mode !== 'db') {
    return Response.json({ error: { code: 'realtime_misconfigured', message: 'Set REALTIME_MODE=db for the built-in API' } }, { status: 503 });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const auth = req.headers.get('authorization');
  const principal = await authenticateBearer(api, auth, ip);
  if (!principal) return Response.json({ error: { code: 'unauthorized', message: 'Authentication required' } }, { status: 401 });
  const url = new URL(req.url);
  const lastId = Number(req.headers.get('last-event-id') ?? url.searchParams.get('lastEventId') ?? 0) || 0;

  const encoder = new TextEncoder();
  let closed = false;
  req.signal.addEventListener('abort', () => (closed = true));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      try {
        await runDbEventStream({
          ctx: api.ctx, principal, lastId, write, isClosed: () => closed, maxMs: STREAM_MS,
          revalidate: () => authenticateBearer(api, auth, ip),
        });
      } catch (e) {
        console.error('[api] event stream failed', e);
      }
      closed = true;
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}
