/**
 * End-to-end smoke test: loads the built extension into Chromium, serves a
 * mock admin console page plus API fixtures, and checks that
 *  - view buttons appear only where there is no Edit control, in the row's
 *    actions cell (adding one to rows Okta renders without it),
 *  - the dialog renders read-only fields,
 *  - the extension never sends anything but GET.
 *
 * Run: vp build && vpx e2e/smoke.ts
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Page } from 'playwright';

const ORIGIN = 'https://acme-admin.okta.com';
const extensionPath = resolve(import.meta.dirname, '../dist');

const pages: Record<string, string> = {
  '/admin/access/networks': `
    <h1>Networks</h1>
    <table>
      <tr><td><a href="#">Office</a></td><td>IP</td><td><button>Edit</button></td></tr>
      <tr><td><a href="#">Blocked countries</a></td><td>Dynamic</td><td><div class="zone-actions"></div></td></tr>
    </table>
    <table>
      <thead><tr><th>Name</th><th>Zone type</th></tr></thead>
      <tbody><tr><td><a href="#">Guest Wi-Fi</a></td><td>IP</td></tr></tbody>
    </table>`,
  '/admin/app/acme_app_1/instance/0oa1/': `
    <h1>Acme</h1>
    <section><div><h2>SAML Settings</h2></div><p>Single sign-on URL: https://sp.example.com/acs</p></section>`,
};

const api: Record<string, unknown> = {
  '/api/v1/zones': [
    {
      id: 'nzo1',
      name: 'Office',
      type: 'IP',
      status: 'ACTIVE',
      gateways: [{ type: 'CIDR', value: '10.0.0.0/8' }],
    },
    {
      id: 'nzo2',
      name: 'Blocked countries',
      type: 'DYNAMIC',
      status: 'ACTIVE',
      usage: 'BLOCKLIST',
      locations: [{ country: 'KP' }],
      asns: ['64496'],
    },
    { id: 'nzo3', name: 'Guest Wi-Fi', type: 'IP', status: 'ACTIVE' },
  ],
  '/api/v1/apps/0oa1': {
    id: '0oa1',
    name: 'acme_app_1',
    label: 'Acme',
    status: 'ACTIVE',
    signOnMode: 'SAML_2_0',
    credentials: { userNameTemplate: { template: '${source.login}', type: 'BUILT_IN' } },
    settings: {
      signOn: {
        ssoAcsUrl: 'https://sp.example.com/acs',
        recipient: 'https://sp.example.com/acs',
        destination: 'https://sp.example.com/acs',
        audience: 'urn:example:sp',
        subjectNameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        responseSigned: true,
        assertionSigned: true,
        signatureAlgorithm: 'RSA_SHA256',
        digestAlgorithm: 'SHA256',
        honorForceAuthn: true,
        idpIssuer: 'http://www.okta.com/${org.externalKey}',
        attributeStatements: [
          {
            type: 'EXPRESSION',
            name: 'email',
            namespace: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic',
            values: ['user.email'],
          },
        ],
      },
    },
  },
};

const viewButton = (page: Page, key: string) => page.locator(`[data-oktamax-key="${key}"]`);

async function main() {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oktamax-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const methods = new Set<string>();
  await context.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      methods.add(route.request().method());
      const body = api[url.pathname];
      return body === undefined
        ? route.fulfill({ status: 404, json: { errorSummary: 'Not found' } })
        : route.fulfill({ json: body });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>${pages[url.pathname] ?? '<h1>Not mocked</h1>'}</body></html>`,
    });
  });

  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[page error]', m.text()));

  // --- list rows -----------------------------------------------------------
  await page.goto(`${ORIGIN}/admin/access/networks`);
  await viewButton(page, 'zone:nzo2').waitFor();
  assert.equal(await viewButton(page, 'zone:nzo1').count(), 0, 'row with Edit gets no view button');
  assert.equal(
    await viewButton(page, 'zone:nzo2').evaluate((el) => el.parentElement?.className),
    'zone-actions',
    "view button goes in the row's actions cell",
  );
  await viewButton(page, 'zone:nzo3').waitFor();
  assert.deepEqual(
    await viewButton(page, 'zone:nzo3').evaluate((el) => {
      const cell = el.parentElement!;
      const table = cell.closest('table')!;
      return [
        cell.tagName,
        cell === cell.parentElement!.lastElementChild,
        table.rows[0]!.cells.length,
      ];
    }),
    ['TD', true, 3],
    'rows without an actions cell get one, with a matching header cell',
  );

  await viewButton(page, 'zone:nzo2').click();
  const zoneDialog = page.getByRole('dialog', { name: 'View Dynamic Zone' });
  await zoneDialog.getByLabel('Zone name').waitFor();
  assert.equal(await zoneDialog.getByLabel('Zone name').inputValue(), 'Blocked countries');
  assert.equal(await zoneDialog.getByLabel('Zone name').getAttribute('readonly'), '');
  await page.screenshot({ path: join(import.meta.dirname, 'zone-dialog.png') });
  await zoneDialog.getByRole('button', { name: 'Close', exact: true }).last().click();
  await zoneDialog.waitFor({ state: 'detached' });

  // --- sections --------------------------------------------------------------
  await page.goto(`${ORIGIN}/admin/app/acme_app_1/instance/0oa1/#tab-general`);
  await viewButton(page, 'app:0oa1:general:SAML Settings').waitFor();

  await viewButton(page, 'app:0oa1:general:SAML Settings').click();
  const samlDialog = page.getByRole('dialog', { name: 'View SAML Integration' });
  const acs = samlDialog.getByLabel('Single sign-on URL');
  await acs.waitFor();
  assert.equal(await acs.inputValue(), 'https://sp.example.com/acs');

  // Typing into a read-only field must not change it.
  await acs.press('End');
  await page.keyboard.type('-changed');
  assert.equal(await acs.inputValue(), 'https://sp.example.com/acs');

  // Every text input in the dialog is read-only.
  const editable = await samlDialog
    .locator('input:not([readonly]), textarea:not([readonly])')
    .evaluateAll((els) => els.filter((e) => !(e as HTMLElement).hidden).length);
  assert.equal(editable, 0, 'no editable text inputs');

  // Selects don't open and checkboxes don't toggle.
  await samlDialog.getByRole('combobox', { name: 'Name ID format' }).click();
  assert.equal(await page.getByRole('listbox').count(), 0, 'read-only select stays closed');
  const sameUrls = samlDialog.getByRole('checkbox', {
    name: 'Use this for Recipient URL and Destination URL',
  });
  await sameUrls.click({ force: true });
  assert.equal(await sameUrls.isChecked(), true, 'read-only checkbox keeps its value');

  await page.screenshot({ path: join(import.meta.dirname, 'saml-dialog.png') });

  assert.deepEqual([...methods], ['GET'], 'only GET requests are sent');
  await context.close();
  console.log('e2e smoke test passed');
}

await main();
