/**
 * Built-in API mode: serves the whole Hydris Fastify API from this Next.js deployment.
 * Each request is forwarded in-process with `app.inject` (no network hop). Only used when
 * API_URL is unset in production; otherwise next.config.ts proxies /api to the external API.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Audit document processing (clean page + server OCR + optional vision) can take ~10-40 s per document.
export const maxDuration = 300;

type InjectMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

// Hop-by-hop / host-managed headers that must not be copied onto the Response.
const DROP_RESPONSE = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length', 'date']);

async function handle(req: Request): Promise<Response> {
  try {
    return await forward(req);
  } catch (e) {
    console.error('[api] request failed', e);
    const detail = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 400) : String(e).slice(0, 400);
    return Response.json({ error: { code: 'internal', message: 'Request failed', detail } }, { status: 500 });
  }
}

async function forward(req: Request): Promise<Response> {
  let api;
  try {
    // Loaded lazily so module-load failures (native/wasm deps, config) are reported, not an empty 500.
    const { getServerlessApi } = await import('@hydris/api/serverless');
    api = await getServerlessApi();
  } catch (e) {
    console.error('[api] failed to start', e);
    const detail = e instanceof Error ? e.message.split(String.fromCharCode(10)).slice(0, 3).join(' | ').slice(0, 400) : 'unknown';
    return Response.json({ error: { code: 'service_unavailable', message: 'API failed to start', detail } }, { status: 503 });
  }
  const url = new URL(req.url);
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    headers[k] = v;
  });
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? Buffer.from(await req.arrayBuffer()) : undefined;
  const forwarded = headers['x-forwarded-for']?.split(',')[0]?.trim();

  const res = await api.app.inject({
    method: req.method as InjectMethod,
    url: url.pathname + url.search,
    headers,
    ...(body && body.length ? { payload: body } : {}),
    remoteAddress: forwarded || '127.0.0.1',
  });

  const out = new Headers();
  for (const [k, v] of Object.entries(res.headers)) {
    if (v === undefined || DROP_RESPONSE.has(k.toLowerCase())) continue;
    if (Array.isArray(v)) for (const item of v) out.append(k, String(item));
    else out.set(k, String(v));
  }
  const noBody = req.method === 'HEAD' || res.statusCode === 204 || res.statusCode === 304;
  return new Response(noBody ? null : new Uint8Array(res.rawPayload), { status: res.statusCode, headers: out });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE, handle as OPTIONS, handle as HEAD };
