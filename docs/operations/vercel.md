# Running everything on Vercel

One Vercel project serves the website, the operator console, the glasses viewport **and** the API.
No separate server is needed. This guide assumes no prior Vercel experience.

## Demo mode (no setup)

**What it is.** If the project has **no `DATABASE_URL`** (or `DEMO_MODE=true` is set) the app starts in demo mode: every
function instance creates an in-memory database, runs the migrations and seeds the same deterministic, synthetic demo
tenant ("Riverbend Process Industries (Demo)", flagged `is_demo` and labelled as demo/synthetic throughout the UI):

- two sites — *Riverbend Industrial Park* (ETP-01) and *Riverbend Township STP* (STP-02) — with areas, map layout, assets and 27 online instruments;
- 7 days of telemetry at 10-minute resolution (diurnal load patterns, noise, excursions) and 14 days of lab COD/BOD/TSS results;
- 20+ alarms over 14 days in every state (active → acknowledged → investigating → resolved → closed) with history, notes and assignees;
- inspections in every state (scheduled, in progress, paused, submitted, approved, rejected, cancelled) incl. abnormal findings and glasses submissions;
- maintenance tasks in every state with checklists and activity, inspection routes, SOPs/manuals/safety documents for Hydris AI (`/assist`),
  published UI profiles with role/org assignments, pre-paired devices (connected, disconnected, suspended, revoked), notifications and an audit trail;
- a running "normal operations" simulation. Without cron, live data advances lazily: any API request or open realtime stream
  advances the simulation at most every 5 s (the daily Vercel cron still works too).

**Sign in:** `tarun@hydris.ai` / `demo@123` (org admin of the demo org and platform admin). Role accounts, same password
`demo@123`: `admin@`, `manager@`, `supervisor@`, `operator@`, `operator2@`, `engineer@`, `viewer@demo.hydris.local`.
Glasses: open `/simulator` (or `/glasses`), then approve the code on `/pair` while signed in. The public website demo
(`/glasses?demo=1`) is client-only and unaffected.

**Things to know.**
- Data lives in memory and **resets on every cold start**; changes you make exist only on the instance that served them.
- Instances share nothing, so demo mode relaxes per-instance state: access tokens last 12 h and are accepted even if the
  session row lives on another instance; `/auth/refresh` falls back to a signed `hg_demo` cookie; device tokens carry the
  assigned operator/site and device refresh tokens are self-contained, so a device paired on one instance is rebuilt
  lazily on another. Pairing itself (code → approve → poll) needs the same instance for its ~10 minutes, which is the normal
  case on a low-traffic demo; if a code is "not found", generate a new one.
- Realtime events are per instance (the stream reads that instance's in-memory event log).
- Demo mode uses built-in, **public** `JWT_SECRET`/`DATA_KEY` values unless you set your own (a warning is logged). It is
  for demonstrations with synthetic data only — never for real plants.

**Switching to production mode.** Follow Steps 2–7 below: add Neon (`DATABASE_URL`), Blob, `JWT_SECRET`, `DATA_KEY`,
`CRON_SECRET`, `REALTIME_MODE=db`, `PUBLIC_APP_URL`, then redeploy. As soon as `DATABASE_URL` is set, demo mode turns off
(force either way with `DEMO_MODE=true|false`). With `DEMO_MODE=true` *and* a Postgres `DATABASE_URL`, the demo tenant is
seeded into that database instead (persistent demo).

## How it works

| Piece | On Vercel | Where in the code |
|---|---|---|
| Website, console, glasses, simulator | Next.js pages | `apps/web/src/app` |
| API (`/api/*`) | Next.js route handler that runs the Fastify API in-process (`app.inject`) | `apps/web/src/app/api/[...path]/route.ts`, `apps/api/src/serverless.ts` |
| Realtime (`/api/events/stream`) | Streaming route handler; events are stored in the `realtime_events` table and polled every 1.5 s. Each stream lasts ~50 s, then the browser reconnects automatically with `Last-Event-ID` (no events lost) | `apps/web/src/app/api/events/stream/route.ts` |
| Database | Neon Postgres (Vercel Marketplace) | `DATABASE_URL` |
| Migrations | Run automatically on the first request of each new function instance, guarded by a Postgres advisory lock | `apps/api/src/db/client.ts` |
| Background jobs | Vercel Cron calls `/api/cron` (stale-data alarms, pairing expiry, realtime cleanup, demo simulator steps) | `apps/web/src/app/api/cron/route.ts`, root `vercel.json` |
| File attachments | Vercel Blob, **private** store. Files are only served through the authorized `/api/attachments/:id` route; no public URLs | `apps/api/src/core/services.ts` |

Local development is unchanged: `npm run dev` still runs the API on :4000 with PGlite and Next.js proxies `/api` to it.

## What you need
- A Vercel account (Hobby works for trying it; **Pro** is needed for the per-minute cron — see Limits).
- This repository on GitHub.
- Node.js 24 on your own machine (only for the one-time seeding step).

## Step 1 — Create the Vercel project
1. Go to <https://vercel.com/new> and **Import** this GitHub repository.
2. **Root Directory:** leave it as the repository root (`./`). The root `vercel.json` already sets the install command, build command, output directory and cron.
3. **Framework preset:** Next.js (detected automatically).
4. Do **not** deploy yet if it offers to — or let it deploy and fail; you will redeploy after Step 5.
5. Project → **Settings → General → Node.js Version:** choose **24.x**.

## Step 2 — Add the database (Neon)
1. Project → **Storage** → **Create Database** (or **Marketplace**) → **Neon** → choose a region close to your users (and to your Vercel function region, see Limits) → **Create**.
2. Connect it to the project for **Production** and **Preview** environments.
3. Vercel adds `DATABASE_URL` (and some other `PG*`/`DATABASE_URL_UNPOOLED` variables) automatically. `DATABASE_URL` is the **pooled** connection string (host contains `-pooler`) with `sslmode=require` — that is the one the app uses. Nothing else to do.

> Tenant isolation: the app switches to the restricted role `hydris_app` in every transaction so row-level security applies. Migrations create that role and grant the Neon owner (`neondb_owner`) permission to `SET ROLE` to it (migrations `0004` and `0006`). Neon's owner role has `CREATEROLE`, which is all that's needed.

## Step 3 — Add file storage (Vercel Blob)
1. Project → **Storage** → **Create** → **Blob** → access **Private** → **Create** and connect it to the project.
2. Vercel adds `BLOB_READ_WRITE_TOKEN` automatically. When it is present the app stores attachments in Blob; when absent it uses local disk (which does **not** persist on Vercel).

## Step 4 — Generate secrets
Run this three times on your machine and keep the three outputs:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Step 5 — Set environment variables
Project → **Settings → Environment Variables** (apply to Production, and Preview if you use previews):

| Name | Value |
|---|---|
| `JWT_SECRET` | first generated value |
| `DATA_KEY` | second generated value (64 hex chars; **never change it** after go-live — it encrypts MFA secrets) |
| `CRON_SECRET` | third generated value (Vercel Cron sends it automatically as `Authorization: Bearer …`) |
| `REALTIME_MODE` | `db` |
| `PUBLIC_APP_URL` | `https://<your-project>.vercel.app` (or your custom domain) |
| `NODE_ENV` | `production` (Vercel sets this for builds/functions; setting it explicitly is harmless) |
| `SIMULATOR_ENABLED` | `true` only if you want the demo-tenant simulator, otherwise `false` |

Do **not** set `API_URL` — setting it switches the project to "external API" mode and proxies `/api` elsewhere.
`DATABASE_URL` and `BLOB_READ_WRITE_TOKEN` were added in Steps 2–3. A full template is in `apps/web/.env.example`.

## Step 6 — Deploy
Project → **Deployments** → **Redeploy** (or push to `main`). The build runs `npm ci` and `npm run build`.
Migrations run on the first API request. To run them during the build instead, change the project's Build Command to `npm run vercel-build` (runs `db:migrate` then the build) and add `MIGRATE_ON_START=false`.

## Step 7 — Seed the first accounts (from your machine)
The database is empty after deploying. Create the platform admin (and optionally the demo tenant) by running the seed CLI locally against Neon:

1. In Vercel → **Storage → your Neon database → .env.local / Quickstart**, copy the `DATABASE_URL` value.
2. From the repository root (after `npm ci`), run — macOS/Linux/Git Bash:
   ```bash
   DATABASE_URL='postgres://...-pooler.../neondb?sslmode=require' \
   JWT_SECRET='<same JWT_SECRET>' DATA_KEY='<same DATA_KEY>' \
   SEED_ADMIN_EMAIL='you@company.com' SEED_ADMIN_PASSWORD='<12+ chars>' \
   SEED_DEMO_PASSWORD='<12+ chars>' \
   npx tsx apps/api/src/seed/cli.ts --demo
   ```
   PowerShell:
   ```powershell
   $env:DATABASE_URL='postgres://...'; $env:JWT_SECRET='...'; $env:DATA_KEY='...'
   $env:SEED_ADMIN_EMAIL='you@company.com'; $env:SEED_ADMIN_PASSWORD='...'; $env:SEED_DEMO_PASSWORD='...'
   npx tsx apps/api/src/seed/cli.ts --demo
   ```
   Leave out `--demo` (and `SEED_DEMO_PASSWORD`) if you do not want the demo tenant. The command also applies migrations, and it is safe to run again. Remove these variables from your shell afterwards; do not put the Neon URL in a committed file.

## Step 8 — Verify
1. `https://<your-domain>/api/health` → `{"ok":true,...}`.
2. Open `https://<your-domain>/login` and sign in with the admin (or `manager@demo.hydris.local` + `SEED_DEMO_PASSWORD`).
3. Console overview loads; the live indicator turns green (realtime stream connected).
4. Pairing: open `/simulator` (or a headset) → it shows a code → approve it in the console → the glasses view opens.
5. Cron: Project → **Settings → Cron Jobs** shows `/api/cron`; its log should show `{"ok":true,...}` each run.

## Limits and trade-offs
- **Function duration:** API routes use `maxDuration = 60` s. The realtime stream ends after ~50 s and the client reconnects (≈1 s gap, no lost events). Hobby plans cap functions at 60 s; Pro allows longer, but there is no need.
- **Cron frequency:** `vercel.json` schedules `/api/cron` every minute (`* * * * *`). **Per-minute crons require Vercel Pro**; on Hobby, crons run at most once per day — change the schedule to e.g. `0 3 * * *`, accept that stale-data alarms and pairing expiry run daily (pairing codes still expire when used/checked), and that the demo simulator advances only on that schedule.
- **Demo simulator:** without a long-running process each cron run advances every running scenario by **one step** (instead of every 5 s locally), so scenarios play out more slowly.
- **Realtime latency:** up to ~1.5 s (polling) instead of instant. `realtime_events` keeps one day of events (pruned by cron).
- **Per-instance state:** login rate limits and similar in-memory caches are per function instance. That is acceptable (limits are still enforced per instance; account lockout is stored in the database). Device "stream open" presence uses `devices.last_seen_at` (updated on every device request).
- **Single region:** keep the Vercel function region (Project → Settings → Functions) in the same region as the Neon database; every request does several queries.
- **Connections:** each instance opens at most 3 Postgres connections via Neon's pooler.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `/api/*` returns 503 `API is starting or misconfigured` | Check Function logs. Usually a missing/invalid `JWT_SECRET`, `DATA_KEY` (must be 64 hex chars) or `DATABASE_URL`. |
| `permission denied to set role "hydris_app"` | Run once in the Neon SQL editor as the owner: `GRANT hydris_app TO neondb_owner WITH SET TRUE;` |
| Live indicator stays "reconnecting", stream returns 503 `realtime_misconfigured` | Set `REALTIME_MODE=db` and redeploy. |
| `/api/*` hits another server | `API_URL` is set — remove it to use the built-in API. |
| Cron shows 401 | `CRON_SECRET` missing or changed; set it and redeploy. |
| Uploaded files disappear | `BLOB_READ_WRITE_TOKEN` missing — connect a Blob store (Step 3). |
| Login works but cookies are not kept | Use the HTTPS Vercel domain (refresh cookies are `Secure` in production). |

## Switching back to a separate API
Set `API_URL=https://<api-host>` on the Vercel project and redeploy; `/api/*` is then proxied to that host (see `deployment.md`).
