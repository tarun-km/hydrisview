/**
 * Outgoing mail through Brevo (transactional email REST API).
 *
 * The application always writes mail to `mail_outbox` inside the caller's transaction (see
 * services.sendMail), so a rolled-back request never sends anything. When BREVO_API_KEY is set,
 * `deliverOutbox` sends queued rows (after each request and from the scheduled jobs), sets
 * `sent_at`, and on failure records a short, token-free error and retries with exponential
 * backoff (1, 2, 4 … 60 min, at most MAX_ATTEMPTS). Without a key the outbox is the transport
 * (development, tests, demo). The API key and message bodies are never logged.
 */
import { and, asc, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { mailOutbox } from '../db/schema';
import { withSystem } from '../db/tenant';

export const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
export const MAX_ATTEMPTS = 8;

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface Address { email: string; name?: string }

/** "Hydris <no-reply@hydris.ai>" or "no-reply@hydris.ai" → { name, email }. */
export function parseAddress(raw: string): Address {
  const m = /^\s*"?([^"<]*?)"?\s*<\s*([^>\s]+@[^>\s]+)\s*>\s*$/.exec(raw);
  if (m) return m[1] ? { name: m[1].trim(), email: m[2]! } : { email: m[2]! };
  return { email: raw.trim() };
}

export interface OutgoingMail { to: string; subject: string; text: string; html?: string | null }

export class BrevoMailer {
  private from: Address;
  private replyTo: Address | null;
  constructor(private apiKey: string, from: string, replyTo?: string | undefined, private fetchImpl: FetchLike = fetch as unknown as FetchLike) {
    this.from = parseAddress(from);
    this.replyTo = replyTo ? parseAddress(replyTo) : null;
  }

  /** Throws an Error with a safe message (status + Brevo error code) on failure. */
  async send(m: OutgoingMail): Promise<{ messageId: string | null }> {
    const body = {
      sender: this.from,
      to: [{ email: m.to }],
      subject: m.subject,
      textContent: m.text,
      ...(m.html ? { htmlContent: m.html } : {}),
      ...(this.replyTo ? { replyTo: this.replyTo } : {}),
    };
    let res;
    try {
      res = await this.fetchImpl(BREVO_ENDPOINT, {
        method: 'POST',
        headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new Error(`network: ${(e as Error).message?.slice(0, 120) ?? 'request failed'}`);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      let code = '';
      try {
        const j = JSON.parse(text) as { code?: string; message?: string };
        code = [j.code, j.message].filter(Boolean).join(': ').slice(0, 200);
      } catch {
        /* non-JSON error */
      }
      throw new Error(`brevo ${res.status}${code ? ` ${code}` : ''}`);
    }
    try {
      return { messageId: (JSON.parse(text) as { messageId?: string }).messageId ?? null };
    } catch {
      return { messageId: null };
    }
  }
}

export function createMailer(cfg: { BREVO_API_KEY?: string | undefined; MAIL_FROM: string; MAIL_REPLY_TO?: string | undefined }): BrevoMailer | null {
  return cfg.BREVO_API_KEY ? new BrevoMailer(cfg.BREVO_API_KEY, cfg.MAIL_FROM, cfg.MAIL_REPLY_TO) : null;
}

/** Minutes to wait before attempt n+1 (n = attempts so far, ≥ 1). */
export const backoffMinutes = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1));

let running: Promise<{ sent: number; failed: number }> | null = null;

/** Send due outbox rows. Single-flight per process; safe to call often. */
export function deliverOutbox(db: Db, mailer: BrevoMailer | null, limit = 20): Promise<{ sent: number; failed: number }> {
  if (!mailer) return Promise.resolve({ sent: 0, failed: 0 });
  running ??= (async () => {
    let sent = 0;
    let failed = 0;
    try {
      const due = await withSystem(db, (tx) => tx.select().from(mailOutbox)
        .where(and(isNull(mailOutbox.sentAt), lt(mailOutbox.attempts, MAX_ATTEMPTS), or(isNull(mailOutbox.nextAttemptAt), lte(mailOutbox.nextAttemptAt, new Date()))))
        .orderBy(asc(mailOutbox.createdAt)).limit(limit));
      for (const m of due) {
        try {
          await mailer.send({ to: m.to, subject: m.subject, text: m.bodyText, html: m.bodyHtml });
          await withSystem(db, (tx) => tx.update(mailOutbox).set({ sentAt: new Date(), attempts: sql`${mailOutbox.attempts} + 1`, lastError: null }).where(eq(mailOutbox.id, m.id)));
          sent++;
        } catch (e) {
          const attempts = m.attempts + 1;
          const msg = (e as Error).message.slice(0, 300);
          await withSystem(db, (tx) => tx.update(mailOutbox).set({ attempts, lastError: msg, nextAttemptAt: new Date(Date.now() + backoffMinutes(attempts) * 60_000) }).where(eq(mailOutbox.id, m.id)));
          // Recipient and id only: never the body (it may contain sign-in tokens) or the key.
          console.warn(`[mail] delivery failed (attempt ${attempts}/${MAX_ATTEMPTS}) id=${m.id}: ${msg}`);
          failed++;
        }
      }
    } finally {
      running = null;
    }
    return { sent, failed };
  })();
  return running;
}
