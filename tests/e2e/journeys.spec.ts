import { expect, test, type Page } from '@playwright/test';

const PW = process.env.SEED_DEMO_PASSWORD ?? '';
const email = (k: string) => `${k}@demo.hydris.local`;

async function signIn(page: Page, who: string, next = '/console') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Work email').fill(email(who));
  await page.getByLabel('Password', { exact: true }).fill(PW);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.beforeAll(() => {
  if (!PW) throw new Error('SEED_DEMO_PASSWORD must be set (run `npm run seed:demo` first).');
});

test('anonymous visitors cannot reach the console', async ({ page }) => {
  await page.goto('/console/alarms');
  await expect(page).toHaveURL(/\/login\?next=/);
  const res = await page.request.get('/api/overview');
  expect(res.status()).toBe(401);
});

test('sign in, overview, logout invalidates the session', async ({ page }) => {
  await signIn(page, 'manager');
  await expect(page.getByText('Open alarms', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Process snapshot' })).toBeVisible();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/console');
  await expect(page).toHaveURL(/\/login/);
});

test('glasses pairing by code, guided inspection on glasses, revocation', async ({ browser, request }) => {
  // Arrange: a supervisor assigns a fresh tank walk-down to the operator (keeps the journey independent of prior runs).
  const login = await request.post('/api/auth/login', { data: { email: email('supervisor'), password: PW } });
  const token = (await login.json()).accessToken as string;
  const auth = { authorization: `Bearer ${token}` };
  const templates = (await (await request.get('/api/inspection-templates', { headers: auth })).json()).templates as { id: string; key: string }[];
  const assets = (await (await request.get('/api/assets?q=T-101', { headers: auth })).json()).assets as { id: string }[];
  const members = (await (await request.get('/api/members', { headers: auth })).json()).members as { userId: string; email: string }[];
  const created = await request.post('/api/inspections', { headers: auth, data: {
    templateId: templates.find((t) => t.key === 'tank_check')!.id, assetId: assets[0]!.id, title: `E2E walk-down ${Date.now()}`,
    assignedTo: members.find((m) => m.email === email('operator2'))!.userId, dueAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
  } });
  expect(created.status()).toBe(201);
  const title = (await created.json()).inspection.title as string;

  // Glasses (unauthenticated device) and a companion phone session (operator's manager).
  const glassesCtx = await browser.newContext({ viewport: { width: 600, height: 600 } });
  const glasses = await glassesCtx.newPage();
  await glasses.goto('/glasses?sim=1');
  const codeEl = glasses.getByText(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
  await expect(codeEl).toBeVisible({ timeout: 30_000 });
  const code = (await codeEl.textContent())!.trim();

  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const phone = await phoneCtx.newPage();
  await signIn(phone, 'manager', `/pair?code=${code}`);
  await expect(phone.getByRole('heading', { name: 'Is this your device?' })).toBeVisible();
  await phone.getByLabel('Assign to operator').selectOption({ label: 'Divya Nair — Field operator' });
  const deviceName = `E2E glasses ${Date.now() % 100000}`;
  await phone.getByLabel('Device name (optional)').fill(deviceName);
  await phone.getByRole('button', { name: 'Approve and assign' }).click();
  await expect(phone.getByRole('heading', { name: 'Approved' })).toBeVisible();

  await expect(glasses.getByText('Hello, Divya')).toBeVisible({ timeout: 20_000 });
  await glasses.keyboard.press('Enter');
  await expect(glasses.getByText('Divya’s shift')).toBeVisible();

  // The overdue E2E inspection is first in the operator's list.
  // HUD input is directional; wait for each async save before the next press.
  const press = async (k = 'Enter') => { await glasses.keyboard.press(k); await glasses.waitForTimeout(900); };
  await press(); // open next inspection (resumes from server-saved progress if any)
  for (let i = 0; i < 12 && !(await glasses.getByText('Ready to submit').isVisible()); i++) await press();
  await expect(glasses.getByText('Ready to submit')).toBeVisible();
  await glasses.keyboard.press('Enter');
  await expect(glasses.getByText('Submitted', { exact: true })).toBeVisible();

  // The submission is visible in the console for review.
  await phone.goto('/console/inspections');
  await phone.getByRole('tab', { name: /awaiting review/i }).click();
  await expect(phone.getByText(title).first()).toBeVisible();

  // Revoke from the fleet page: the glasses are told immediately via the device event stream.
  await phone.goto('/console/devices');
  await phone.getByText(deviceName).first().click();
  await expect(phone.getByRole('heading', { name: deviceName })).toBeVisible();
  await phone.getByRole('button', { name: /revoke/i }).first().click();
  await phone.getByRole('dialog').getByRole('textbox').fill('E2E: device lost');
  await phone.getByRole('dialog').getByRole('button', { name: /revoke/i }).click();
  await expect(glasses.getByText('Device revoked')).toBeVisible({ timeout: 30_000 });

  await glassesCtx.close();
  await phoneCtx.close();
});

test('operators cannot reach administration they lack permission for', async ({ page }) => {
  await signIn(page, 'operator');
  const res = await page.evaluate(async () => (await fetch('/api/audit')).status);
  expect(res).toBe(401); // no bearer token from page context: data needs the in-memory session
  await page.goto('/console/audit');
  await expect(page.getByText(/do not have access|not authorized|permission/i).first()).toBeVisible();
});
