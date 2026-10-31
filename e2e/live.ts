/**
 * Live check against a real org: signs in as the read-only admin, opens every
 * page the extension supports, clicks each view button, and screenshots the
 * page and each dialog into `e2e/live/`. Run `e2e/seed.ts` first.
 *
 * Run: vp build && vpx e2e/live.ts
 */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Page } from 'playwright';

import { adminUrl, launch, signIn } from './okta';

const out = resolve(import.meta.dirname, 'live');
mkdirSync(out, { recursive: true });

const context = await launch('read');
const page = await signIn(context, 'read');

const writes: string[] = [];
page.on('request', (req) => {
  // Only the extension's own calls matter here; the console itself may POST telemetry.
  if (
    req.method() !== 'GET' &&
    req.url().includes('/api/v1/') &&
    req.frame() === page.mainFrame()
  ) {
    writes.push(`${req.method()} ${req.url()}`);
  }
});

const get = (path: string) =>
  page.evaluate(
    async (p) => (await fetch(p, { headers: { Accept: 'application/json' } })).json(),
    path,
  );

const apps: Array<{ id: string; name: string; label: string }> =
  await get('/api/v1/apps?limit=200');
const app = (label: string) => apps.find((a) => a.label === label)!;
const accessPolicy = (await get('/api/v1/policies?type=ACCESS_POLICY')).find(
  (p: { name: string }) => p.name === 'Oktamax Test App Policy',
);

const appPage = (label: string, tab: string) =>
  `/admin/app/${app(label).name}/instance/${app(label).id}/#tab-${tab}`;

const pages: Array<[string, string]> = [
  ['networks', '/admin/access/networks'],
  ['group-rules', '/admin/groups#rules'],
  ['authenticators', '/admin/access/multifactor'],
  ['password-policies', '/admin/access/authenticators/password'],
  ['global-session', '/admin/access/policies'],
  ['auth-policy', `/admin/authentication-policies/app-sign-in/${accessPolicy.id}`],
  ['saml-general', appPage('Oktamax SAML Test', 'general')],
  ['saml-signon', appPage('Oktamax SAML Test', 'signon')],
  ['oidc-web-general', appPage('Oktamax OIDC Web', 'general')],
  ['oidc-spa-general', appPage('Oktamax OIDC SPA', 'general')],
  ['bookmark-general', appPage('Oktamax Bookmark', 'general')],
];

async function settle(p: Page) {
  // The console keeps polling, so `networkidle` rarely arrives; give it time to render.
  await p.waitForLoadState('load').catch(() => {});
  await p.waitForTimeout(5000);
}

const summary: string[] = [];
for (const [name, path] of pages) {
  await page.goto(`${adminUrl}${path}`, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });

  const buttons = page.locator('[data-oktamax="view-button"]');
  const titles = await buttons.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? ''),
  );
  summary.push(
    `${name.padEnd(18)} ${titles.length} view button(s)${titles.length ? ': ' + titles.join(' | ') : ''}`,
  );

  for (let i = 0; i < titles.length; i++) {
    await buttons.nth(i).scrollIntoViewIfNeeded();
    await buttons.nth(i).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(out, `${name}-${i + 1}.png`) });
    const fields = await dialog.locator('input, textarea').evaluateAll((els) => ({
      total: els.length,
      editable: els.filter(
        (el) =>
          // MUI selects keep a hidden native input; it isn't focusable or visible.
          el.getAttribute('aria-hidden') !== 'true' &&
          !(el as HTMLInputElement).readOnly &&
          !(el as HTMLInputElement).disabled,
      ).length,
    }));
    const errors = dialog.getByText("Couldn't load this view");
    const error = (await errors.count()) ? await errors.first().textContent() : null;
    summary.push(
      `    ${titles[i]}: ${fields.total} fields, ${fields.editable} editable${error ? `, ERROR: ${error}` : ''}`,
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
}

console.log(summary.join('\n'));
console.log(writes.length ? `NON-GET API calls:\n${writes.join('\n')}` : 'No non-GET API calls.');
await context.close();
