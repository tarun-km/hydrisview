# Supabase: Auth + Postgres

Hydris uses Supabase for **identity (Supabase Auth)** and as the **production Postgres** (replacing Neon).
The API still talks to Postgres through `DATABASE_URL` with Drizzle, row-level security and the
`hydris_app` role, so the database switch is configuration plus running migrations. PGlite stays
in use for tests and demo mode.

You create the project and set every key yourself. Nothing in this repository contains keys; the
app reads them from environment variables only.

## How auth works

- **Supabase configured** (`SUPABASE_URL` + `SUPABASE_ANON_KEY`, not demo mode): sign-up, password
  sign-in, password reset, email verification, magic links and operator invitations go through
  Supabase Auth, and Supabase sends those emails (through Brevo SMTP, see below). The API verifies the
  Supabase access token (JWKS, or `SUPABASE_JWT_SECRET` for HS256 projects), maps it to the Hydris
  user, membership and organization, and issues the normal Hydris session (short access JWT +
  rotating `hg_refresh` cookie). Web, Android, glasses and the RLS tenant context are unchanged.
- **Not configured** (local dev, tests, demo): the built-in auth works as before, and email goes to
  `mail_outbox` (or Brevo when `BREVO_API_KEY` is set).
- Existing built-in accounts are migrated lazily: on their first sign-in after the switch, if
  Supabase does not know the user but the stored password hash matches, the API creates the
  Supabase user (confirmed, same password) with the service-role key and links it
  (`users.supabase_user_id`).
- Clients never call Supabase directly. All flows go through `/api/auth/*`.

| Flow | Endpoint | Supabase call |
| --- | --- | --- |
| Admin sign-up (work domain only) | `POST /api/auth/signup` | `POST /auth/v1/signup` (confirmation email) |
| Sign in | `POST /api/auth/login` | `POST /auth/v1/token?grant_type=password` |
| Forgot password | `POST /api/auth/password-reset/request` | `POST /auth/v1/recover` |
| Magic link (web / app) | `POST /api/auth/magic-link` | `POST /auth/v1/otp` (`create_user: false`) |
| Invite operator | `POST /api/invitations`, `/api/invitations/bulk` | `POST /auth/v1/invite` (service role) |
| Link landing | `POST /api/auth/callback/exchange` | `PUT /auth/v1/user` (set password for invite / recovery) |
| Suspend / remove operator | `POST /api/members/:id/suspend|remove` | `PUT /auth/v1/admin/users/:id` (`ban_duration`) |

## 1. Create the project

1. Sign in at https://supabase.com/dashboard and choose **New project**.
2. Organization: yours. Name: `hydris-prod`.
3. **Region: South Asia (Mumbai) `ap-south-1`.** If it is not offered on your plan, use Singapore
   (`ap-southeast-1`).
4. Generate a strong database password and store it in your password manager.
5. Create the project and wait until it is healthy.

## 2. Connection string (pooler for serverless)

1. Project → **Connect** (top bar) → **Connection string** → **URI**.
2. For the app on Vercel use the **Transaction pooler** (Supavisor, port **6543**):
   `postgresql://postgres.<project-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require`
   This is `DATABASE_URL` in Vercel. The app keeps the pool small on serverless (3 connections) and
   uses transaction-scoped settings only (`SET LOCAL ROLE`, `set_config(..., true)`), which the
   transaction pooler supports.
3. For **migrations** use the **Session pooler** (port **5432** on the same host) or the direct
   connection: the migrator holds a session-level advisory lock, which needs a session connection.

## 3. Vercel environment variables

Vercel → Project → **Settings → Environment Variables** (Production, and Preview if wanted):

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Transaction pooler URI (port 6543) | Replaces the Neon value. Remove Neon's variables. |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | Project Settings → API |
| `SUPABASE_ANON_KEY` | anon / publishable key | Public by design |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / secret key | **Server only. Never expose to the browser** (no `NEXT_PUBLIC_` prefix). Needed for invites, bans and lazy migration. |
| `SUPABASE_JWT_SECRET` | optional | Only for projects still on the legacy HS256 JWT secret. Without it tokens are verified against `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`. |
| `ADMIN_SIGNUP_DOMAINS` | `hydris.ai` | Comma-separated. Only these email domains may self-register as Administrator. |
| `PUBLIC_APP_URL` | `https://hydrisview.vercel.app` | Used to build redirect links. |
| `ANDROID_APP_URL` / `ANDROID_APK_URL` | Play listing / APK URL | Shown on the operator page and QR code. |
| `BREVO_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO` | see `brevo.md` | App email (not Supabase email). |
| `JWT_SECRET`, `DATA_KEY`, `REALTIME_MODE=db`, `CRON_SECRET`, `BLOB_READ_WRITE_TOKEN` | unchanged | See `vercel.md`. |

Setting `DATABASE_URL` turns demo mode off (unless `DEMO_MODE=true`). Supabase Auth is never used in
demo mode.

## 4. Run migrations

From your machine, with the **session** pooler URL (port 5432):

```bash
DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require' \
JWT_SECRET='any-32-plus-character-local-value-xxxxxxxx' DATA_KEY=$(openssl rand -hex 32) \
npm run db:migrate
```

This creates the `hydris_app` role, grants the `postgres` user `SET` on it (migration 0004), enables
RLS on every tenant table and applies `0009_identity_accounts` (account types, membership status,
operator profile, invitation status, `users.supabase_user_id`) and `0010_mail_delivery`.

Moving existing data from Neon: `pg_dump --no-owner --no-acl` from Neon, restore into Supabase, then
run `npm run db:migrate` (already-applied migrations are skipped). Legacy roles are mapped by 0009:
org_admin, factory_manager, supervisor → **admin**; field_operator, maintenance_engineer, viewer →
**operator**; status `deactivated` → `suspended`.

Alternatively set the Vercel Build Command to `npm run vercel-build` and `MIGRATE_ON_START=false`.

## 5. Auth URL configuration

Authentication → **URL Configuration**:

- **Site URL**: `https://hydrisview.vercel.app`
- **Redirect URLs** (add each):
  - `https://hydrisview.vercel.app/auth/callback`
  - `https://hydrisview.vercel.app/auth/callback?flow=*` (or `https://hydrisview.vercel.app/**`)
  - `hydrisfield://auth-callback` (Android magic links open the app)
  - for previews, optionally `https://*-<team>.vercel.app/**`

Authentication → **Providers → Email**: enable Email, keep **Confirm email ON**, keep "Secure email
change" ON. Minimum password length 12 (matches the API).

## 6. Email templates

Authentication → **Email Templates**. Keep `{{ .ConfirmationURL }}` (it carries the `redirect_to` the
API sets). Suggested subjects and copy (Hydris tone, plain):

- **Confirm signup**: "Confirm your Hydris administrator account". Body: "Confirm your email to finish
  creating your Hydris organization." Button → `{{ .ConfirmationURL }}`.
- **Invite user**: "You have been invited to Hydris". Body: "Your administrator invited you to Hydris
  as a Field Operator. Set your password, then install the Hydris Field app and sign in with this
  email." Button "Set your password" → `{{ .ConfirmationURL }}`.
- **Magic Link**: "Your Hydris sign-in link". Body: "Tap the button on the device where you want to
  sign in. The link works once."
- **Reset Password**: "Reset your Hydris password". Body: "Choose a new password. If you did not ask
  for this, ignore this email."

## 7. SMTP: send Supabase Auth email through Brevo

Supabase's built-in email is for testing only (a few messages per hour, only to team members).
Production must use custom SMTP. Hydris uses **Brevo** for all email:

Project Settings → **Authentication → SMTP Settings** → **Enable Custom SMTP**:

| Field | Value |
| --- | --- |
| Sender email | `no-reply@hydris.ai` (domain authenticated in Brevo, see `brevo.md`) |
| Sender name | `Hydris` |
| Host | `smtp-relay.brevo.com` |
| Port | `587` (STARTTLS) |
| Username | your Brevo **SMTP login** (Brevo → SMTP & API → SMTP tab, looks like `xxxx@smtp-brevo.com`) |
| Password | a Brevo **SMTP key** (not the API key) |
| Minimum interval | 60 s per user (default) |

Then Authentication → **Rate Limits**: raise "emails per hour" to suit (e.g. 100+), since the
custom SMTP lifts the built-in cap.

## 8. Sign-ups only through the API

The API enforces the administrator domain rule (`ADMIN_SIGNUP_DOMAINS`) before it calls Supabase, but
the public anon key could be used to call `/auth/v1/signup` directly. Such users can never get a
Hydris organization (the API only creates one for allowed domains with admin sign-up metadata, and
operators need an invitation), but to keep the user list clean:

- Option A (recommended once the first administrators exist): Authentication → Providers → Email →
  turn **off "Allow new users to sign up"**. Invitations (service role) and existing users keep
  working. Administrator self sign-up then needs an existing Hydris administrator to invite new
  administrators instead.
- Option B (keep self sign-up): leave sign-ups on and add a *Before User Created* auth hook
  (Authentication → Hooks) that rejects emails outside `hydris.ai`.

## 9. Check

1. Open `https://hydrisview.vercel.app/api/auth/config` → `"provider":"supabase"`.
2. Sign up at `/signup` with an `@hydris.ai` address → confirmation email (via Brevo) → link lands on
   `/auth/callback` → console setup wizard.
3. `/signup` with a gmail address → rejected with the domain message.
4. Invite an operator from Console → Operators → invite email → `/auth/callback?flow=invite` → set
   password → "Get the Hydris Field app" page.
5. Suspend that operator → their web page, Android app and glasses sign out within seconds.

## Org-per-sign-up rule

Every administrator self sign-up creates a **new organization**. A second `@hydris.ai` person who
should join an existing organization is **invited by one of its administrators** (account type
Administrator). An email that already has an account cannot sign up again.
