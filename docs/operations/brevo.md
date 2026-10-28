# Brevo: all Hydris email

Hydris sends every email through **Brevo**:

1. **App email** (invitations when Supabase is not used, password reset, email verification, magic
   links, operator suspended / removed notices, alarm escalation template) through Brevo's
   transactional REST API: `POST https://api.brevo.com/v3/smtp/email` with the `api-key` header.
2. **Supabase Auth email** (sign-up confirmation, invite, magic link, reset when Supabase is
   configured) through Supabase **Custom SMTP** on `smtp-relay.brevo.com:587` (see `supabase.md`, step 7).

You create the keys and set them yourself. They are read from environment variables only and are
never logged.

## How app email is delivered

- Every email is written to `mail_outbox` inside the request's transaction (`sendMail` /
  `sendTemplate`), so nothing is sent for a request that fails.
- With `BREVO_API_KEY` set, the outbox is delivered right after each response and by the scheduled
  jobs (`/api/cron` on Vercel, a 60 s timer on the long-running server). Each row gets `sent_at` on
  success; on failure `attempts`, `last_error` (status and Brevo error code only, never the body) and
  `next_attempt_at` are recorded and the row is retried with backoff 1, 2, 4, 8 … 60 min, up to 8
  attempts. Failed rows can be inspected with
  `select id, "to", subject, attempts, last_error from mail_outbox where sent_at is null;`.
- Without `BREVO_API_KEY` (local dev, tests, demo) mail stays in the outbox and is not sent.
- Templates (`apps/api/src/core/mail-templates.ts`): branded HTML with a plain-text alternative for
  invite, password reset, email verification, magic link, alarm escalation and the operator
  suspended / removed notice.

## 1. Account and sender domain authentication (hydris.ai)

1. Create or open the Brevo account (https://app.brevo.com).
2. **Senders, Domains & Dedicated IPs → Domains → Add a domain**: `hydris.ai`. Choose to authenticate
   it yourself and copy the records Brevo shows. Add them at your DNS provider for `hydris.ai`:

| Type | Host / name | Value | Purpose |
| --- | --- | --- | --- |
| TXT | `@` (hydris.ai) | `brevo-code:<code from Brevo>` | Ownership verification |
| TXT | `@` | `v=spf1 include:spf.brevo.com ~all` | **SPF**. If an SPF record already exists (e.g. Google Workspace), merge into **one** record: `v=spf1 include:_spf.google.com include:spf.brevo.com ~all` |
| CNAME (or TXT) | `brevo1._domainkey` | value shown by Brevo (e.g. `b1.hydris-ai.dkim.brevo.com`) | **DKIM** |
| CNAME (or TXT) | `brevo2._domainkey` | value shown by Brevo (e.g. `b2.hydris-ai.dkim.brevo.com`) | **DKIM** (second key) |
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@hydris.ai; fo=1` | **DMARC** (start with `p=none`, move to `p=quarantine` once reports are clean) |

   Use the exact values in your Brevo dashboard; they are account-specific. Only one DMARC record may
   exist; if one is already there, keep it and make sure SPF/DKIM align.
3. Click **Authenticate this email domain** and wait until SPF, DKIM and DMARC show green (DNS can
   take minutes to hours).
4. **Senders → Add a sender**: `Hydris <no-reply@hydris.ai>` (and optionally `support@hydris.ai` as
   reply-to).

## 2. API key (app email)

Brevo → profile menu → **SMTP & API → API keys → Generate a new API key**, name `hydris-prod-api`.
Copy it once into Vercel as `BREVO_API_KEY`. Optionally restrict it to Vercel's egress under
**Security → Authorised IPs** (Vercel uses dynamic IPs, so usually leave IP restriction off).

## 3. SMTP key (Supabase Auth email)

Brevo → **SMTP & API → SMTP** tab:

- **SMTP server**: `smtp-relay.brevo.com`, **port** `587`
- **Login**: shown on that page (e.g. `xxxxxx@smtp-brevo.com`)
- **Generate a new SMTP key**, name `supabase-auth`

Enter host, port, login and the SMTP key in Supabase → Project Settings → Authentication → SMTP
Settings (sender `no-reply@hydris.ai`, name `Hydris`). Do not reuse the API key as the SMTP password.

## 4. Environment variables

| Variable | Where | Example |
| --- | --- | --- |
| `BREVO_API_KEY` | Vercel (server) | `xkeysib-…` (from step 2) |
| `MAIL_FROM` | Vercel | `Hydris <no-reply@hydris.ai>` (default) |
| `MAIL_REPLY_TO` | Vercel, optional | `Hydris Support <support@hydris.ai>` |
| SMTP login + SMTP key | Supabase dashboard only | not a Vercel variable |

Redeploy after setting them.

## 5. Check

1. Trigger a password reset from `/forgot-password` (built-in auth) or invite yourself as an operator.
2. In Brevo → **Transactional → Logs** the message appears as Delivered.
3. In the database: `select subject, sent_at, attempts, last_error from mail_outbox order by created_at desc limit 5;`
4. Check the received message headers: `spf=pass`, `dkim=pass` (d=hydris.ai), `dmarc=pass`.

Brevo's free plan allows 300 emails per day; choose a paid plan for production volume.
