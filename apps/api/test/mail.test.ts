/** Brevo delivery of the mail outbox (mocked HTTP), templates and backoff. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { mailOutbox } from '../src/db/schema.js';
import { withSystem } from '../src/db/tenant.js';
import { BREVO_ENDPOINT, BrevoMailer, backoffMinutes, deliverOutbox, parseAddress } from '../src/core/mailer.js';
import { sendTemplate } from '../src/core/services.js';
import { accountEndedMail, alarmEscalationMail, inviteMail, passwordResetMail, verifyEmailMail } from '../src/core/mail-templates.js';
import { as, Client, harness, lastMailTo, type Harness } from './helpers.js';

let h: Harness;
before(async () => {
  h = await harness();
});
after(async () => {
  await h.app.close();
  await h.database.close();
});

const KEY = 'xkeysib-test-key-not-real';
function fakeBrevo(status = 201, body: unknown = { messageId: '<abc@smtp-relay.mailin.fr>' }) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fn = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  return { calls, fn };
}

test('address parsing', () => {
  assert.deepEqual(parseAddress('Hydris <no-reply@hydris.ai>'), { name: 'Hydris', email: 'no-reply@hydris.ai' });
  assert.deepEqual(parseAddress('no-reply@hydris.ai'), { email: 'no-reply@hydris.ai' });
  assert.deepEqual([1, 2, 3, 4, 10].map(backoffMinutes), [1, 2, 4, 8, 60]);
});

test('templates: subject, text alternative and escaped branded HTML', () => {
  for (const m of [
    inviteMail({ url: 'https://x.test/invite/T', orgName: 'Acme <Water>', accountType: 'operator', name: 'Priya' }),
    passwordResetMail({ url: 'https://x.test/reset-password?token=T' }),
    verifyEmailMail({ url: 'https://x.test/auth/verify?token=T' }),
    alarmEscalationMail({ title: 'Low DO', severity: 'critical', siteName: 'ETP-01', assetTag: 'BL-102', url: 'https://x.test/console/alarms/1', raisedAt: new Date() }),
    accountEndedMail({ orgName: 'Acme', status: 'suspended', name: 'Ravi' }),
  ]) {
    assert.ok(m.subject.length > 5);
    assert.ok(m.text.length > 20 && !/<(p|html|a|table)[ >]/.test(m.text), 'plain text alternative');
    assert.match(m.html, /^<!doctype html>/);
    assert.ok(m.html.includes('Hydris'));
  }
  const inv = inviteMail({ url: 'https://x.test/invite/T', orgName: 'Acme <Water>', accountType: 'operator' });
  assert.ok(inv.html.includes('Acme &lt;Water&gt;') && !inv.html.includes('Acme <Water>'), 'HTML-escaped');
  assert.ok(inv.text.includes('Hydris Field app'));
});

test('Brevo delivery: request shape, sent_at set, failures recorded with backoff and retried', async () => {
  const ok = fakeBrevo();
  const mailer = new BrevoMailer(KEY, 'Hydris <no-reply@hydris.ai>', 'support@hydris.ai', ok.fn);
  await withSystem(h.database.db, (tx) => sendTemplate(tx, 'brevo1@plant.test', passwordResetMail({ url: 'https://x.test/reset-password?token=SECRET' })));
  const r = await deliverOutbox(h.database.db, mailer);
  assert.ok(r.sent >= 1);
  const call = ok.calls.find((c) => (c.body.to as { email: string }[])[0]!.email === 'brevo1@plant.test')!;
  assert.equal(call.url, BREVO_ENDPOINT);
  assert.equal(call.headers['api-key'], KEY);
  assert.deepEqual(call.body.sender, { name: 'Hydris', email: 'no-reply@hydris.ai' });
  assert.deepEqual(call.body.replyTo, { email: 'support@hydris.ai' });
  assert.equal(call.body.subject, 'Reset your Hydris password');
  assert.match(String(call.body.textContent), /token=SECRET/);
  assert.match(String(call.body.htmlContent), /<!doctype html>/);
  const row = await lastMailTo(h, 'brevo1@plant.test');
  assert.ok(row!.sentAt, 'sent_at set');
  assert.equal(row!.attempts, 1);
  // Already sent: not sent again.
  const again = await deliverOutbox(h.database.db, mailer);
  assert.equal(ok.calls.filter((c) => (c.body.to as { email: string }[])[0]!.email === 'brevo1@plant.test').length, 1);
  void again;

  // Failure: recorded (token-free), backoff scheduled, retried later.
  const bad = fakeBrevo(401, { code: 'unauthorized', message: 'Key not found' });
  const failing = new BrevoMailer(KEY, 'no-reply@hydris.ai', undefined, bad.fn);
  await withSystem(h.database.db, (tx) => sendTemplate(tx, 'brevo2@plant.test', verifyEmailMail({ url: 'https://x.test/auth/verify?token=SECRET2' })));
  const warn = console.warn;
  const logged: string[] = [];
  console.warn = (...a: unknown[]) => logged.push(a.join(' '));
  try {
    const f = await deliverOutbox(h.database.db, failing);
    assert.ok(f.failed >= 1);
  } finally {
    console.warn = warn;
  }
  assert.ok(logged.every((l) => !l.includes(KEY) && !l.includes('SECRET2')), 'never logs the key or bodies');
  let row2 = await lastMailTo(h, 'brevo2@plant.test');
  assert.equal(row2!.sentAt, null);
  assert.equal(row2!.attempts, 1);
  assert.equal(row2!.lastError, 'brevo 401 unauthorized: Key not found');
  assert.ok(row2!.nextAttemptAt! > new Date(), 'backoff scheduled');
  // Not due yet: nothing is sent even with a working mailer.
  const before = ok.calls.length;
  await deliverOutbox(h.database.db, mailer);
  assert.equal(ok.calls.filter((c) => (c.body.to as { email: string }[])[0]!.email === 'brevo2@plant.test').length, 0);
  // Once due, the retry succeeds.
  await withSystem(h.database.db, (tx) => tx.update(mailOutbox).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(mailOutbox.id, row2!.id)));
  await deliverOutbox(h.database.db, mailer);
  row2 = await lastMailTo(h, 'brevo2@plant.test');
  assert.ok(row2!.sentAt);
  assert.equal(row2!.attempts, 2);
  assert.ok(ok.calls.length > before);

  // Network errors are handled the same way.
  const net = new BrevoMailer(KEY, 'no-reply@hydris.ai', undefined, async () => { throw new Error('ECONNRESET'); });
  await withSystem(h.database.db, (tx) => sendTemplate(tx, 'brevo3@plant.test', accountEndedMail({ orgName: 'Acme', status: 'removed' })));
  console.warn = () => {};
  try { await deliverOutbox(h.database.db, net); } finally { console.warn = warn; }
  assert.match((await lastMailTo(h, 'brevo3@plant.test'))!.lastError!, /^network: ECONNRESET/);
});

test('without BREVO_API_KEY mail stays in the outbox; with it, requests trigger delivery', async () => {
  assert.equal(h.ctx.mailer, null);
  const ok = fakeBrevo();
  h.ctx.mailer = new BrevoMailer(KEY, 'Hydris <no-reply@hydris.ai>', undefined, ok.fn);
  try {
    await new Client(h.app).req('POST', '/api/auth/password-reset/request', { email: 'operator2@demo.hydris.local' });
    for (let i = 0; i < 50 && !(await lastMailTo(h, 'operator2@demo.hydris.local'))?.sentAt; i++) await new Promise((r) => setTimeout(r, 20));
    const row = await lastMailTo(h, 'operator2@demo.hydris.local');
    assert.ok(row!.sentAt, 'delivered after the request');
    assert.ok(row!.bodyHtml?.includes('Choose a new password'));
    // Suspension notice is mailed (branded) to the person.
    const admin = await as(h.app, 'admin');
    await admin.req('POST', `/api/members/${h.demo.users.viewer}/suspend`);
    const notice = await lastMailTo(h, 'viewer@demo.hydris.local');
    assert.equal(notice!.subject, 'Your Hydris access is suspended');
  } finally {
    h.ctx.mailer = null;
  }
});
