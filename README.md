# Hydris Field Glasses

Industrial smart-glasses platform for wastewater operations: a **glasses viewport + browser simulator**, a secure multi-tenant **operator console**, a **public website**, and one **API**.

```
apps/api        Fastify modular monolith · Drizzle · Postgres (PGlite in dev/test) · RLS tenant isolation · SSE realtime
apps/web        Next.js 16 · website (/), console (/console), glasses (/glasses), simulator (/simulator), pairing (/pair)
packages/domain Roles/permissions, measurands & units, alarm/inspection/maintenance/device state machines, deterministic scenarios
tests/e2e       Playwright journeys (pairing → inspection on glasses → console → revocation)
```

## Demo mode (zero configuration)
Deploy the repository to Vercel with **no environment variables** (or run anywhere with `DEMO_MODE=true`) and you get a complete, clearly-labelled synthetic tenant: two plants (ETP + STP), 7 days of telemetry, 14 days of alarm history in every lifecycle state, inspections and maintenance in every state, lab results, SOPs for Hydris AI, UI profiles, devices, notifications and a live simulation. Sign in as **tarun@hydris.ai / demo@123** (the role accounts `admin|manager|supervisor|operator|operator2|engineer|viewer@demo.hydris.local` use `demo@123` too). Data is in memory and resets on every cold start. Details and limits: [docs/operations/vercel.md](docs/operations/vercel.md#demo-mode-no-setup).

```bash
npm run build && cd apps/web && DEMO_MODE=true npx next start -p 3000   # local demo, nothing else to configure
```

## Run locally
```bash
npm install
cp .env.example .env        # fill JWT_SECRET, DATA_KEY (64 hex each) and the seed passwords
npm run seed:demo           # platform admin + demo tenant (users: admin|manager|supervisor|operator|operator2|engineer|viewer @demo.hydris.local)
npm run dev                 # web :3000, API :4000 (proxied at /api)
```
Then open `/login`, the console at `/console`, and pair the simulator at `/simulator` (approve the code on `/pair`).

## Verify
```bash
npm test                    # domain unit tests + 14 API integration tests (auth, RLS, tenancy, RBAC, ingestion, alarms, pairing, offline sync, revocation)
npm run typecheck
npx playwright test         # e2e journeys against the running dev stack (uses local Chrome)
npm run build               # production web build
```

## Deploy
**Option A — Docker (single host):** set `POSTGRES_PASSWORD` plus the `.env` secrets, then `docker compose up -d --build`. The API applies migrations on start. Seed once with `docker compose exec api npx tsx src/seed/cli.ts` (add `--demo` for a demo tenant).

**Option B — Everything on Vercel (recommended for hosted demos/pilots):** with no environment variables at all it runs in **demo mode** (see above). For real data: one Vercel project serves the website, console, glasses and the API (Next.js route handlers run the Fastify API in-process), with Neon Postgres, a private Vercel Blob store, `REALTIME_MODE=db` (SSE over a `realtime_events` table) and Vercel Cron for background jobs. Step-by-step guide: [docs/operations/vercel.md](docs/operations/vercel.md).

**Option C — Vercel (web) + container host (API):** deploy `apps/web` to Vercel with env `API_URL=https://<your-api-host>` (a `beforeFiles` rewrite proxies `/api` to it, keeping auth cookies first-party and bypassing the built-in API). Deploy `apps/api/Dockerfile` to a long-running container host (Railway, Fly.io, Render, ECS) with a managed Postgres `DATABASE_URL`, `PUBLIC_APP_URL=https://<web domain>`, `NODE_ENV=production`, `JWT_SECRET`, `DATA_KEY`, and a persistent volume for `STORAGE_DIR`. See [docs/operations/deployment.md](docs/operations/deployment.md).

Production notes:
- Tenant isolation: every request runs `SET LOCAL ROLE hydris_app` with `app.org_id`, so Postgres RLS applies even if the connection user is the owner. Keep `hydris_app` without BYPASSRLS.
- Mail is written to the `mail_outbox` table (invitation/reset links). Wire a real SMTP/API transport in `apps/api/src/core/services.ts` before inviting external users.
- Set `SIMULATOR_ENABLED=false` on production unless demo tenants are hosted there; synthetic data is refused for non-demo tenants regardless.
- Realtime: `REALTIME_MODE=memory` (default) uses an in-process bus, so a single API instance only. Use `REALTIME_MODE=db` for serverless or multiple instances.

## Status
Done and verified: API (auth with MFA/invitations/reset/session revocation, RLS tenancy, RBAC, hierarchy, assets, sensors, gateway ingestion, alarm lifecycle, inspections with offline-idempotent sync, maintenance, documents and grounded SOP retrieval, devices and QR pairing, SSE realtime, reports/CSV, audit, demo simulator); console pages for all modules; glasses HUD + simulator + pairing; e2e journeys.

Not finished: no real hardware integration — Meta glasses input, camera and native secure storage sit behind adapters (apps/web/src/glasses/input.ts, link.ts) and are unverified on a device. MQTT/OPC UA ingestion adapters are not implemented (HTTPS gateway ingestion is). Email delivery is not wired (mail_outbox table).
