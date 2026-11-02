/**
 * Signs in to a real Okta org for live testing. Credentials come from the
 * repo's `.env` (never logged):
 *
 *   OKTA_ADMIN_URL=https://<org>-admin.okta.com
 *   OKTA_USERNAME_<ACCOUNT>, OKTA_PASSWORD_<ACCOUNT>, OKTA_TOTP_SECRET_<ACCOUNT>
 *
 * Each account gets its own persistent browser profile under `e2e/.profiles`,
 * so later runs reuse the session instead of signing in again.
 *
 * Run: vp build && vpx e2e/okta.ts [admin|read ...]
 */
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';

import { chromium, type BrowserContext, type Page } from 'playwright';

process.loadEnvFile(resolve(import.meta.dirname, '../../.env'));

export type Account = 'admin' | 'read';

const extensionPath = resolve(import.meta.dirname, '../dist');
const screenshots = resolve(import.meta.dirname);

export const adminUrl = new URL(env('OKTA_ADMIN_URL')).origin;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}

/** RFC 6238 TOTP with Google Authenticator's defaults (SHA-1, 6 digits, 30 s). */
export function totp(secret: string, now = Date.now()): { code: string; secondsLeft: number } {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.replace(/[\s=]/g, '').toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error('Invalid base32 character in TOTP secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));

  const seconds = now / 1000;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(seconds / 30)));

  const mac = createHmac('sha1', key).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0xf;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 1e6;
  return { code: String(code).padStart(6, '0'), secondsLeft: 30 - Math.floor(seconds % 30) };
}

const usedCodes = new Map<string, string>();

/**
 * A fresh code with enough time left to submit it. Okta rejects a code that
 * was already used, so wait for the next one after a sign-in or step-up.
 */
async function freshCode(secret: string): Promise<string> {
  let { code, secondsLeft } = totp(secret);
  if (secondsLeft < 5 || usedCodes.get(secret) === code) {
    await new Promise((r) => setTimeout(r, secondsLeft * 1000 + 500));
    ({ code } = totp(secret));
  }
  usedCodes.set(secret, code);
  return code;
}

export async function launch(account: Account): Promise<BrowserContext> {
  return chromium.launchPersistentContext(resolve(import.meta.dirname, '.profiles', account), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 900 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
}

const onAdminConsole = (page: Page) => page.url().startsWith(`${adminUrl}/admin/`);

/**
 * Answers the Identity Engine sign-in widget (identifier → password →
 * authenticator choice → TOTP) until `done()` is true.
 */
async function answerSignInWidget(page: Page, account: Account, done: () => boolean) {
  const suffix = account.toUpperCase();
  const username = env(`OKTA_USERNAME_${suffix}`);
  const password = env(`OKTA_PASSWORD_${suffix}`);
  const secret = env(`OKTA_TOTP_SECRET_${suffix}`);

  for (let step = 0; step < 10 && !done(); step++) {
    await page
      .locator(
        'input[name="identifier"], input[name="credentials.passcode"], [data-se="authenticator-button"], .authenticator-row',
      )
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(() => {});
    if (done()) return;

    const identifier = page.locator('input[name="identifier"]');
    const passcode = page.locator('input[name="credentials.passcode"]');
    const heading =
      (await page
        .locator('h2, [data-se="o-form-head"]')
        .first()
        .textContent()
        .catch(() => '')) ?? '';

    if (await identifier.isVisible()) {
      await identifier.fill(username);
      // Some orgs ask for the password on the same page.
      if (await passcode.isVisible()) await passcode.fill(password);
    } else if (await passcode.isVisible()) {
      const isCode = /code|authenticator/i.test(heading) && !/password/i.test(heading);
      await passcode.fill(isCode ? await freshCode(secret) : password);
    } else {
      // Authenticator picker: choose Google Authenticator.
      const google = page
        .locator('[data-se="authenticator-button"], .authenticator-row')
        .filter({ hasText: /google authenticator/i })
        .getByRole('link')
        .or(page.locator('[data-se="google_otp"] [data-se="button"]'));
      if (!(await google.first().isVisible())) {
        await page.screenshot({ path: resolve(screenshots, `signin-${account}-stuck.png`) });
        throw new Error(`Unrecognised sign-in step: "${heading.trim()}"`);
      }
      // The widget can move on mid-click and detach the button; the next loop sees where it went.
      await google
        .first()
        .click({ timeout: 5_000 })
        .catch(() => {});
      continue;
    }

    const url = page.url();
    await page.locator('input[type="submit"], button[type="submit"]').first().click();
    await page
      .waitForURL((u) => u.toString() !== url, { timeout: 15_000 })
      .catch(() => (page.isClosed() ? undefined : page.waitForTimeout(1500)));
    if (done()) return;

    const error = page.locator('.o-form-error-container, .okta-form-infobox-error').first();
    if (await error.isVisible().catch(() => false)) {
      await page.screenshot({ path: resolve(screenshots, `signin-${account}-error.png`) });
      throw new Error(`Sign-in error: ${(await error.textContent())?.trim()}`);
    }
  }
}

/** Opens the admin console, signing in first if the saved session has expired. */
export async function signIn(context: BrowserContext, account: Account): Promise<Page> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${adminUrl}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
  await answerSignInWidget(page, account, () => onAdminConsole(page));
  await page.waitForURL(`${adminUrl}/admin/**`, { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  return page;
}

/**
 * Completes Okta's "protected actions" step-up: before sensitive changes the
 * admin console opens a pop-up that re-verifies the admin. A recent enough
 * sign-in satisfies it without a prompt, and the pop-up just closes.
 */
export async function completeStepUp(popup: Page, account: Account): Promise<void> {
  const closed = popup.waitForEvent('close', { timeout: 60_000 });
  await answerSignInWidget(popup, account, () => popup.isClosed());
  await closed;
}

/** Handles every step-up pop-up the console opens in this context. */
export function autoStepUp(context: BrowserContext, account: Account): void {
  context.on('page', (popup) => {
    if (popup.url().includes('/oauth2/') || popup.url() === 'about:blank') {
      completeStepUp(popup, account).catch((err) => console.error(`step-up: ${err.message}`));
    }
  });
}

if (import.meta.main) {
  const accounts = (
    process.argv.slice(2).length ? process.argv.slice(2) : ['admin', 'read']
  ) as Account[];
  for (const account of accounts) {
    const context = await launch(account);
    try {
      const page = await signIn(context, account);
      const me = await page.evaluate(async () => {
        const res = await fetch('/api/v1/users/me');
        const user = await res.json();
        return { status: res.status, login: user.profile?.login };
      });
      await page.screenshot({ path: resolve(screenshots, `signin-${account}.png`) });
      console.log(
        `${account}: signed in as ${me.login} (GET /users/me → ${me.status}) at ${page.url()}`,
      );
    } catch (err) {
      console.error(`${account}: ${(err as Error).message}`);
      process.exitCode = 1;
    } finally {
      await context.close();
    }
  }
}
