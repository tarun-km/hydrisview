/**
 * Supabase Auth (GoTrue) adapter.
 *
 * Supabase is the identity provider when SUPABASE_URL + SUPABASE_ANON_KEY are configured
 * (see config.supabaseEnabled): sign-up, password sign-in, password reset, email verification,
 * magic links and operator invitations go through GoTrue, and Supabase sends those emails.
 * The API then verifies the Supabase access token, maps it to the Hydris user / membership /
 * organization and issues the usual Hydris session (access JWT + rotating refresh cookie), so
 * web, Android, glasses and the RLS tenant context are unchanged.
 *
 * No SDK dependency: the GoTrue REST API is small and stable, and access tokens are verified
 * locally (HS256 with SUPABASE_JWT_SECRET, or ES256/RS256 against the project's JWKS), with a
 * server-side `GET /auth/v1/user` fallback. Keys are read from configuration only and are never
 * logged or returned to clients (the anon key is public by design but is still not echoed).
 */
import { createHmac, createPublicKey, verify as cryptoVerify, type JsonWebKey } from 'node:crypto';
import { HttpError } from './errors';
import { safeEqual } from './crypto';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  serviceRoleKey?: string | undefined;
  jwtSecret?: string | undefined;
}

export interface SupabaseUser {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
  banned_until?: string | null;
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: SupabaseUser;
}

export interface SupabaseClaims {
  sub: string;
  email?: string;
  aud?: string | string[];
  exp?: number;
  iss?: string;
  role?: string;
  amr?: { method: string }[];
  user_metadata?: Record<string, unknown>;
}

type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

const b64url = (s: string) => Buffer.from(s, 'base64url');

/** Map GoTrue errors onto Hydris error codes clients understand. */
function mapError(status: number, body: Record<string, unknown>): HttpError {
  const code = String(body.error_code ?? body.code ?? body.error ?? '');
  const msg = String(body.msg ?? body.message ?? body.error_description ?? 'Authentication service error');
  if (code === 'email_not_confirmed' || /not confirmed/i.test(msg)) return new HttpError(403, 'email_not_verified', 'Verify your email address first. Check your inbox for the confirmation link.');
  if (code === 'invalid_credentials' || code === 'invalid_grant' || /invalid login credentials/i.test(msg)) return new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
  if (code === 'user_already_exists' || code === 'email_exists' || /already (been )?registered/i.test(msg)) return new HttpError(409, 'email_taken', 'An account with this email already exists. Sign in instead.');
  if (code === 'weak_password' || /password/i.test(code)) return new HttpError(400, 'weak_password', msg);
  if (code === 'user_banned') return new HttpError(403, 'account_suspended', 'This account is suspended. Contact your administrator.');
  if (status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return new HttpError(429, 'rate_limited', 'Too many requests to the sign-in service. Try again in a minute.');
  if (status === 401 || status === 403) return new HttpError(401, 'invalid_token', 'Sign-in link or token is invalid or expired');
  return new HttpError(status >= 500 ? 502 : 400, 'auth_provider_error', msg);
}

export class SupabaseAuth {
  private jwks: { keys: (JsonWebKey & { kid?: string; alg?: string })[]; at: number } | null = null;
  private readonly base: string;

  constructor(private cfg: SupabaseConfig, private fetchImpl: FetchLike = fetch as unknown as FetchLike) {
    this.base = cfg.url.replace(/\/+$/, '');
  }

  get canAdmin() {
    return !!this.cfg.serviceRoleKey;
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown; bearer?: string; admin?: boolean; query?: Record<string, string | undefined> } = {}): Promise<T> {
    const key = init.admin ? this.cfg.serviceRoleKey : this.cfg.anonKey;
    if (!key) throw new HttpError(503, 'auth_not_configured', 'Supabase service-role key is not configured');
    const qs = new URLSearchParams(Object.entries(init.query ?? {}).filter(([, v]) => v !== undefined) as [string, string][]).toString();
    const res = await this.fetchImpl(`${this.base}/auth/v1${path}${qs ? `?${qs}` : ''}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { apikey: key, authorization: `Bearer ${init.bearer ?? key}`, 'content-type': 'application/json', accept: 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await res.text();
    let body: unknown = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { msg: text.slice(0, 200) };
    }
    if (!res.ok) throw mapError(res.status, (body ?? {}) as Record<string, unknown>);
    return body as T;
  }

  // ------------------------------------------------------------ end-user flows (anon key)
  /** Create the user; Supabase emails the confirmation link (redirecting to `redirectTo`). */
  async signUp(email: string, password: string, data: Record<string, unknown>, redirectTo: string): Promise<{ user: SupabaseUser | null; session: SupabaseSession | null }> {
    const r = await this.call<SupabaseUser & Partial<SupabaseSession> & { user?: SupabaseUser }>('/signup', { body: { email, password, data }, query: { redirect_to: redirectTo } });
    // GoTrue returns either a session (autoconfirm on) or the bare user (confirmation required).
    if (r.access_token) return { user: r.user ?? null, session: r as SupabaseSession };
    return { user: (r.user ?? (r.id ? r : null)) as SupabaseUser | null, session: null };
  }

  signInWithPassword(email: string, password: string): Promise<SupabaseSession> {
    return this.call<SupabaseSession>('/token', { body: { email, password }, query: { grant_type: 'password' } });
  }

  /** Password-reset email (link lands on redirectTo with a recovery access token). */
  async recover(email: string, redirectTo: string): Promise<void> {
    await this.call('/recover', { body: { email }, query: { redirect_to: redirectTo } });
  }

  /** Magic-link email for an existing user (never creates accounts). */
  async magicLink(email: string, redirectTo: string): Promise<void> {
    await this.call('/otp', { body: { email, create_user: false }, query: { redirect_to: redirectTo } });
  }

  async resendSignup(email: string, redirectTo: string): Promise<void> {
    await this.call('/resend', { body: { type: 'signup', email }, query: { redirect_to: redirectTo } });
  }

  /** Set a new password using the user's (invite / recovery) access token. */
  async updatePassword(accessToken: string, password: string): Promise<SupabaseUser> {
    return this.call<SupabaseUser>('/user', { method: 'PUT', bearer: accessToken, body: { password } });
  }

  getUser(accessToken: string): Promise<SupabaseUser> {
    return this.call<SupabaseUser>('/user', { bearer: accessToken });
  }

  // ------------------------------------------------------------ admin (service role, server only)
  /** Send Supabase's invite email; the link opens `redirectTo` with an invite access token. */
  inviteUser(email: string, data: Record<string, unknown>, redirectTo: string): Promise<SupabaseUser> {
    return this.call<SupabaseUser>('/invite', { admin: true, body: { email, data }, query: { redirect_to: redirectTo } });
  }

  /** Create a confirmed user with a known password (lazy migration of built-in accounts). */
  adminCreateUser(email: string, password: string, data: Record<string, unknown> = {}): Promise<SupabaseUser> {
    return this.call<SupabaseUser>('/admin/users', { admin: true, body: { email, password, email_confirm: true, user_metadata: data } });
  }

  /** Ban (suspend / remove) or unban (reactivate) at the provider as well. */
  async adminSetBanned(userId: string, banned: boolean): Promise<void> {
    await this.call(`/admin/users/${encodeURIComponent(userId)}`, { admin: true, method: 'PUT', body: { ban_duration: banned ? '876000h' : 'none' } });
  }

  // ------------------------------------------------------------ token verification
  /**
   * Verify a Supabase access token and return its claims. HS256 tokens are checked with
   * SUPABASE_JWT_SECRET; ES256/RS256 tokens against the project JWKS (cached 10 min). When no
   * local key applies, the token is validated by GoTrue itself (`GET /auth/v1/user`).
   */
  async verifyAccessToken(token: string): Promise<SupabaseClaims> {
    const invalid = new HttpError(401, 'invalid_token', 'Sign-in link or token is invalid or expired');
    const parts = token.split('.');
    if (parts.length !== 3) throw invalid;
    let header: { alg?: string; kid?: string };
    let claims: SupabaseClaims;
    try {
      header = JSON.parse(b64url(parts[0]!).toString('utf8'));
      claims = JSON.parse(b64url(parts[1]!).toString('utf8'));
    } catch {
      throw invalid;
    }
    const data = `${parts[0]}.${parts[1]}`;
    const sig = b64url(parts[2]!);
    let verified = false;
    if (header.alg === 'HS256' && this.cfg.jwtSecret) {
      const mac = createHmac('sha256', this.cfg.jwtSecret).update(data).digest();
      verified = safeEqual(mac.toString('base64url'), sig.toString('base64url'));
      if (!verified) throw invalid;
    } else if (header.alg === 'ES256' || header.alg === 'RS256') {
      const jwk = await this.findKey(header.kid);
      if (jwk) {
        const key = createPublicKey({ key: jwk, format: 'jwk' });
        verified = cryptoVerify('sha256', Buffer.from(data), header.alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, sig);
        if (!verified) throw invalid;
      }
    } else if (header.alg !== 'HS256') {
      throw invalid;
    }
    if (!verified) {
      // No local key (e.g. HS256 without SUPABASE_JWT_SECRET): ask GoTrue to validate it.
      const u = await this.getUser(token).catch(() => null);
      if (!u || u.id !== claims.sub) throw invalid;
      claims = { ...claims, email: u.email ?? claims.email };
    }
    if (!claims.sub || (claims.exp && claims.exp * 1000 < Date.now())) throw invalid;
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.aud !== undefined && !aud.includes('authenticated')) throw invalid;
    if (claims.iss && !claims.iss.startsWith(this.base)) throw invalid;
    return claims;
  }

  private async findKey(kid: string | undefined) {
    const fresh = this.jwks && Date.now() - this.jwks.at < 10 * 60_000;
    if (!fresh) {
      try {
        const r = await this.call<{ keys: (JsonWebKey & { kid?: string })[] }>('/.well-known/jwks.json');
        this.jwks = { keys: r.keys ?? [], at: Date.now() };
      } catch {
        this.jwks = { keys: [], at: Date.now() };
      }
    }
    return this.jwks!.keys.find((k) => !kid || k.kid === kid) ?? null;
  }
}

export function createSupabaseAuth(cfg: { supabaseEnabled: boolean; SUPABASE_URL?: string | undefined; SUPABASE_ANON_KEY?: string | undefined; SUPABASE_SERVICE_ROLE_KEY?: string | undefined; SUPABASE_JWT_SECRET?: string | undefined }): SupabaseAuth | null {
  if (!cfg.supabaseEnabled || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
  return new SupabaseAuth({ url: cfg.SUPABASE_URL, anonKey: cfg.SUPABASE_ANON_KEY, serviceRoleKey: cfg.SUPABASE_SERVICE_ROLE_KEY, jwtSecret: cfg.SUPABASE_JWT_SECRET });
}
