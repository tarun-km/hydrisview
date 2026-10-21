'use client';

/**
 * Device communication layer for the glasses viewport.
 *
 * Responsibilities: install identity, pairing (device side of an RFC 8628-style flow),
 * device credential storage, short-lived access tokens, authenticated API calls,
 * an offline queue for inspection step responses, and connectivity state.
 *
 * Storage adapter: in a browser/web-app runtime the refresh credential lives in
 * localStorage. A native glasses runtime should provide a hardware-backed secure store
 * by implementing `SecureStore` — this is an explicit integration boundary.
 */

export interface SecureStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

const webStore: SecureStore = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  remove: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

const K = { hw: 'hydris.glasses.hw', refresh: 'hydris.glasses.refresh', queue: 'hydris.glasses.queue' };

export class DeviceError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export interface QueuedOp {
  inspectionId: string;
  op: { opId: string; stepId: string; value: unknown; note?: string; recordedAt: string };
}

export interface PairingChallenge {
  challengeId: string;
  userCode: string;
  pollSecret: string;
  expiresAt: string;
  pollIntervalS: number;
  verificationUri: string;
  verificationUriComplete: string;
}

type Listener = () => void;

export class DeviceLink {
  private access: string | null = null;
  private listeners = new Set<Listener>();
  /** Simulated network loss (browser simulator) - independent of navigator.onLine. */
  simulatedOffline = false;
  lastError: string | null = null;

  constructor(private store: SecureStore = webStore) {}

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    for (const l of this.listeners) l();
  }

  get online() {
    return !this.simulatedOffline && (typeof navigator === 'undefined' || navigator.onLine);
  }
  setSimulatedOffline(v: boolean) {
    this.simulatedOffline = v;
    this.emit();
  }

  hardwareId(): string {
    let id = this.store.get(K.hw);
    if (!id) {
      id = `hg-${crypto.randomUUID().replace(/-/g, '')}`;
      this.store.set(K.hw, id);
    }
    return id;
  }

  hasCredential() {
    return !!this.store.get(K.refresh);
  }
  /** Log out on the server (best effort) and drop local credentials. */
  async logout() {
    try { await this.fetchJson('/device/logout', { method: 'POST', json: {} }); } catch { /* offline or already revoked */ }
    this.forget();
  }
  forget() {
    this.store.remove(K.refresh);
    this.access = null;
    this.emit();
  }
  getAccessToken() {
    return this.access;
  }

  private async fetchJson<T>(path: string, init: RequestInit & { json?: unknown } = {}, auth = true): Promise<T> {
    if (!this.online) throw new DeviceError(0, 'offline', 'No network connection');
    const headers = new Headers(init.headers);
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    if (auth && this.access) headers.set('authorization', `Bearer ${this.access}`);
    let res: Response;
    try {
      res = await fetch(`/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined, cache: 'no-store' });
    } catch {
      throw new DeviceError(0, 'offline', 'Network unreachable');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = (data as { error?: { code?: string; message?: string; details?: unknown } }).error;
      throw new DeviceError(res.status, e?.code ?? 'request_failed', e?.message ?? `Request failed (${res.status})`, e?.details);
    }
    return data as T;
  }

  // ---------------- pairing ----------------
  createChallenge(device: { kind: 'hardware' | 'simulator'; model?: string; appVersion?: string; display?: { width: number; height: number } }) {
    return this.fetchJson<PairingChallenge>('/pairing/challenges', { method: 'POST', json: { hardwareId: this.hardwareId(), device } }, false);
  }

  async poll(c: PairingChallenge): Promise<{ status: string }> {
    const r = await this.fetchJson<{ status: string; accessToken?: string; refreshToken?: string }>(`/pairing/challenges/${c.challengeId}/poll`, { method: 'POST', json: { pollSecret: c.pollSecret } }, false);
    if (r.status === 'completed' && r.accessToken && r.refreshToken) {
      this.access = r.accessToken;
      this.store.set(K.refresh, r.refreshToken);
      this.emit();
    }
    return r;
  }

  cancelChallenge(c: PairingChallenge) {
    return this.fetchJson(`/pairing/challenges/${c.challengeId}/cancel`, { method: 'POST', json: { pollSecret: c.pollSecret } }, false).catch(() => {});
  }

  // ---------------- session ----------------
  private refreshing: Promise<void> | null = null;
  /** Rotate the device credential for a fresh access token. Throws DeviceError (e.g. device_revoked). */
  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const rt = this.store.get(K.refresh);
        if (!rt) throw new DeviceError(401, 'not_paired', 'Not paired');
        try {
          const r = await this.fetchJson<{ accessToken: string; refreshToken: string }>('/device/refresh', { method: 'POST', json: { refreshToken: rt } }, false);
          this.access = r.accessToken;
          this.store.set(K.refresh, r.refreshToken);
        } catch (e) {
          if (e instanceof DeviceError && (e.status === 401 || e.code === 'device_suspended' || e.code === 'device_unassigned')) {
            if (e.status === 401) this.store.remove(K.refresh);
            this.access = null;
          }
          throw e;
        }
      } finally {
        setTimeout(() => (this.refreshing = null), 0);
      }
    })();
    return this.refreshing;
  }

  /** Authenticated call with one transparent refresh on 401. */
  async call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    if (!this.access) await this.refresh();
    try {
      return await this.fetchJson<T>(path, init);
    } catch (e) {
      if (e instanceof DeviceError && e.status === 401) {
        await this.refresh();
        return this.fetchJson<T>(path, init);
      }
      throw e;
    }
  }

  // ---------------- offline queue (inspection responses) ----------------
  queue(): QueuedOp[] {
    try {
      return JSON.parse(this.store.get(K.queue) ?? '[]') as QueuedOp[];
    } catch {
      return [];
    }
  }
  private saveQueue(q: QueuedOp[]) {
    this.store.set(K.queue, JSON.stringify(q));
    this.emit();
  }
  enqueue(op: QueuedOp) {
    this.saveQueue([...this.queue(), op]);
  }

  /**
   * Replay queued ops grouped by inspection. Ops carry client ids, so replays are
   * idempotent server-side. Conflicts (inspection closed meanwhile) are returned for display.
   */
  async flush(): Promise<{ sent: number; conflicts: { inspectionId: string; opId: string; reason: string }[] }> {
    const q = this.queue();
    if (!q.length || !this.online) return { sent: 0, conflicts: [] };
    const byInspection = new Map<string, QueuedOp['op'][]>();
    for (const item of q) byInspection.set(item.inspectionId, [...(byInspection.get(item.inspectionId) ?? []), item.op]);
    let sent = 0;
    const conflicts: { inspectionId: string; opId: string; reason: string }[] = [];
    const remaining: QueuedOp[] = [];
    for (const [inspectionId, ops] of byInspection) {
      try {
        const r = await this.call<{ applied: number; duplicates: number; conflicts: { opId: string; reason: string }[] }>(`/inspections/${inspectionId}/responses`, { method: 'POST', json: { ops } });
        sent += r.applied + r.duplicates;
        for (const c of r.conflicts) conflicts.push({ inspectionId, ...c });
      } catch (e) {
        if (e instanceof DeviceError && (e.status === 0 || e.status >= 500)) remaining.push(...ops.map((op) => ({ inspectionId, op })));
        else for (const op of ops) conflicts.push({ inspectionId, opId: op.opId, reason: e instanceof DeviceError ? e.code : 'failed' });
      }
    }
    this.saveQueue(remaining);
    return { sent, conflicts };
  }
}
