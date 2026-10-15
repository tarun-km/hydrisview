# Deploying Hydris Field Glasses

Two supported topologies:
- **Everything on Vercel** (website, console, glasses and API in one project; Neon + Vercel Blob + Vercel Cron): see **[vercel.md](vercel.md)**. Leave `API_URL` unset.
- **Vercel (web) + long-running API container**: described below. Setting `API_URL` on the Vercel project proxies `/api/*` to the container and disables the built-in API.

## Architecture
| Part | Where | Why |
|---|---|---|
| Web (website, console, glasses viewport, simulator) | **Vercel** (Next.js 16) | Static + SSR pages; `/api/*` is rewritten to the API so cookies stay first-party |
| API (`apps/api`) | **Long-running container** (Render blueprint `render.yaml`, or Fly/Railway/ECS) | Holds SSE realtime connections, runs background jobs (stale-data alarms, pairing expiry) and the demo simulator on timers (for the serverless alternative see vercel.md) |
| Database | **Managed Postgres 15+** (Neon, Render Postgres, Supabase) | Migrations run automatically on API start; RLS isolates tenants |
| File storage (inspection photos, attachments) | Persistent disk on the API host (`STORAGE_DIR`) | Swap `Storage` in `apps/api/src/core/services.ts` for S3/R2 to scale beyond one instance |
| Email | Not configured — messages are written to `mail_outbox` | Wire SMTP/Resend/SES in `sendMail` before inviting external users |

Single API instance with the default `REALTIME_MODE=memory` (in-process event bus). Set `REALTIME_MODE=db` to run several instances (events go through the `realtime_events` table).

## Accounts / credentials you must provide
1. Vercel project linked to this GitHub repo (already exists).
2. A host for the API container (e.g. Render account; `render.yaml` included).
3. A managed Postgres database → `DATABASE_URL` (with `sslmode=require`).
4. Secrets: `JWT_SECRET` (64 hex), `DATA_KEY` (64 hex): `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
5. Optional later: SMTP/Resend credentials; S3/R2 bucket.

## Steps
1. **Database:** create Postgres; copy its URL. The connecting user must be able to `CREATE ROLE` the first time (migration `0001` creates `hydris_app`; migration `0004` grants it to the connecting user). If your provider forbids that, run as the owner once: `CREATE ROLE hydris_app NOLOGIN; GRANT hydris_app TO <app_user> WITH SET TRUE;`.
2. **API:** Render → New → Blueprint → this repo. Set `DATABASE_URL`, `DATA_KEY`, `PUBLIC_APP_URL` (your Vercel URL). Deploy; check `https://<api>/api/health` returns `{"ok":true}`.
3. **Seed:** in the API shell run `npx tsx src/seed/cli.ts` with `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` set (add `--demo` + `SEED_DEMO_PASSWORD` for a demo tenant; then also set `SIMULATOR_ENABLED=true`).
4. **Web (Vercel):** Project → Settings → Environment Variables: `API_URL=https://<api host>`; Node.js 24.x. Root directory: repository root (root `vercel.json` builds `apps/web`). Redeploy.
5. Sign in at `https://<vercel domain>/login`.

## Checks before calling it live
- `npm run typecheck`, `npm test`, `npm run build` all pass (CI).
- `/api/health` OK through the Vercel domain (`https://<vercel>/api/health`).
- Login, console overview, pairing (`/simulator` → `/pair`) work end to end.
