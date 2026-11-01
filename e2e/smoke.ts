/**
 * End-to-end smoke test: loads the built extension into Chromium, serves a
 * mock admin console page plus API fixtures, and checks that
 *  - view buttons appear only where there is no Edit control, in the row's
 *    actions cell when it has one,
 *  - the dialog renders read-only fields,
 *  - the views never send anything but GET,
 *  - the API console sends requests and shows their responses.
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
    </table>`,
  '/admin/app/acme_app_1/instance/0oa1/': `
    <h1>Acme</h1>
    <section><div><h2>SAML Settings</h2></div><p>Single sign-on URL: https://sp.example.com/acs</p></section>`,
};

const api: Record<string, unknown> = {
  '/api/v1/users': [
    {
      id: '00u1',
      status: 'ACTIVE',
      created: '2026-01-02T03:04:05.000Z',
      profile: { login: 'ada@acme.com', firstName: 'Ada', lastName: 'Lovelace' },
      _links: { self: { href: `${ORIGIN}/api/v1/users/00u1` } },
    },
    {
      id: '00u2',
      status: 'SUSPENDED',
      created: '2026-02-03T04:05:06.000Z',
      profile: { login: 'alan@acme.com', firstName: 'Alan', lastName: 'Turing' },
      _links: { self: { href: `${ORIGIN}/api/v1/users/00u2` } },
    },
  ],
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

let consoleOpen = false;

const viewButton = (page: Page, key: string) => page.locator(`[data-oktamax-key="${key}"]`);

async function main() {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oktamax-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const methods = new Set<string>();
  const consoleRequests: Array<{
    method: string;
    url: string;
    xsrf?: string;
    body: string | null;
  }> = [];
  await context.route(`${ORIGIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      if (consoleOpen) {
        const request = route.request();
        consoleRequests.push({
          method: request.method(),
          url: url.pathname + url.search,
          xsrf: request.headers()['x-okta-xsrftoken'],
          body: request.postData(),
        });
        if (request.method() === 'POST') {
          return route.fulfill({
            status: 400,
            json: {
              errorSummary: 'Api validation failed: name',
              errorCauses: [{ errorSummary: 'name: The field cannot be left blank' }],
            },
          });
        }
        return route.fulfill({
          json: api[url.pathname] ?? {},
          headers: { link: `<${ORIGIN}/api/v1/users?after=00u2&limit=2>; rel="next"` },
        });
      }
      methods.add(route.request().method());
      const body = api[url.pathname];
      return body === undefined
        ? route.fulfill({ status: 404, json: { errorSummary: 'Not found' } })
        : route.fulfill({ json: body });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body><span id="_xsrfToken" hidden>xsrf-123</span>${pages[url.pathname] ?? '<h1>Not mocked</h1>'}</body></html>`,
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
  await page.keyboard.press('Escape');

  // --- API console -------------------------------------------------------------
  consoleOpen = true;
  await page.getByRole('button', { name: 'API', exact: true }).click();
  const drawer = page.getByRole('region', { name: 'API console' });
  const prompt = drawer.getByLabel('Request URL');
  await prompt.fill('users?limit=2');
  await prompt.press('Enter');
  await drawer.getByText('200 OK').waitFor();
  assert.deepEqual(consoleRequests.at(-1), {
    method: 'GET',
    url: '/api/v1/users?limit=2',
    xsrf: undefined,
    body: null,
  });
  await drawer.getByText('"ada@acme.com"').waitFor();
  await drawer.getByRole('tab', { name: 'Table' }).click();
  await drawer.getByRole('cell', { name: 'alan@acme.com' }).waitFor();
  await page.screenshot({ path: join(import.meta.dirname, 'api-console.png') });

  // The next page and links in the response open in the console.
  await drawer.getByRole('button', { name: 'Next page →' }).click();
  await drawer.getByText('"ada@acme.com"').waitFor();
  assert.equal(consoleRequests.at(-1)?.url, '/api/v1/users?after=00u2&limit=2');
  assert.equal(await prompt.inputValue(), '/api/v1/users?after=00u2&limit=2');

  // Typing a method at the prompt switches to it; a body is sent with the XSRF token.
  await prompt.fill('');
  await prompt.pressSequentially('post groups');
  assert.equal(await drawer.getByLabel('Method').inputValue(), 'POST');
  assert.equal(await prompt.inputValue(), 'groups');
  await prompt.press('Escape'); // closes the suggestions
  await drawer.getByRole('tab', { name: 'Body' }).click();
  await drawer.locator('textarea').fill('{"profile":{"name":""}}');
  await drawer.getByRole('button', { name: 'Format' }).click();
  await drawer.getByRole('button', { name: 'Send' }).click();
  await drawer.getByText('400 Bad Request').waitFor();
  await drawer.getByRole('alert').getByText('name: The field cannot be left blank').waitFor();
  assert.deepEqual(consoleRequests.at(-1), {
    method: 'POST',
    url: '/api/v1/groups',
    xsrf: 'xsrf-123',
    body: '{\n  "profile": {\n    "name": ""\n  }\n}',
  });
  await page.screenshot({ path: join(import.meta.dirname, 'api-console-error.png') });

  // History keeps every request, newest first, and survives a page load.
  await page.waitForTimeout(500); // the console saves its state after a short debounce
  await page.reload();
  const history = page.getByRole('region', { name: 'API console' }).locator('.history-url');
  await history.first().waitFor();
  assert.deepEqual(await history.allTextContents(), [
    'groups',
    '/api/v1/users?after=00u2&limit=2',
    'users?limit=2',
  ]);

  // Suggestions come from the API reference, with IDs from the page filled in.
  const USER = '00u1abcdefghijklmnop';
  await page.goto(`${ORIGIN}/admin/user/profile/view/${USER}#tab-account`);
  const userDrawer = page.getByRole('region', { name: 'API console' });
  const userPrompt = userDrawer.getByLabel('Request URL');
  await userPrompt.fill('');
  const suggestions = userDrawer.getByRole('listbox').getByRole('option');
  await suggestions.first().waitFor();
  assert.match(
    (await suggestions.first().textContent()) ?? '',
    /^GET\/api\/v1\/users\/\{userId\}Retrieve a user/,
  );
  await userPrompt.press('ArrowDown');
  await userPrompt.press('Enter');
  assert.equal(await userPrompt.inputValue(), `/api/v1/users/${USER}`);
  await userPrompt.fill('/api/v1/users/{userId}/gro');
  await suggestions.filter({ hasText: '/groups' }).first().click();
  assert.equal(await userPrompt.inputValue(), `/api/v1/users/${USER}/groups`);
  await userPrompt.fill('/api/v1/users/{userId}/groups');
  await userPrompt.press('Escape');
  await userPrompt.press('Enter');
  await userDrawer.getByText('200 OK').waitFor();
  assert.equal(consoleRequests.at(-1)?.url, `/api/v1/users/${USER}/groups`);
  await userDrawer.getByRole('button', { name: /User\s*00u1/ }).waitFor();

  // Expand covers the page.
  // Expand makes it as tall as dragging can, sliding up to it.
  await userDrawer.getByRole('button', { name: 'Expand console' }).click();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-oktamax="host"]')
      ?.shadowRoot?.querySelector('.drawer')
      ?.getAnimations()
      .every((a) => a.playState === 'finished'),
  );
  const expanded = await userDrawer.evaluate((el) => el.getBoundingClientRect());
  assert.equal(expanded.height, (page.viewportSize()?.height ?? 0) - 60);
  assert.equal(expanded.bottom, page.viewportSize()?.height);
  await userPrompt.fill('/api/v1/users?');
  await page.screenshot({ path: join(import.meta.dirname, 'api-console-suggestions.png') });
  await userDrawer.getByRole('button', { name: 'Restore console' }).click();
  await userDrawer.getByRole('button', { name: 'Expand console' }).waitFor();
  assert.equal(await userDrawer.evaluate((el) => el.getBoundingClientRect().height), 420);

  // Ctrl + ` twice expands; once closes and opens.
  await userPrompt.focus();
  await page.keyboard.press('Control+`');
  await page.keyboard.press('Control+`');
  await userDrawer.getByRole('button', { name: 'Restore console' }).waitFor();
  await page.keyboard.press('Control+`');
  await page.keyboard.press('Control+`');
  await userDrawer.getByRole('button', { name: 'Expand console' }).waitFor();
  await page.keyboard.press('Control+`');
  await userDrawer.waitFor({ state: 'detached' });
  await page.keyboard.press('Control+`');
  await userDrawer.waitFor();

  await context.close();
  console.log('e2e smoke test passed');
}

await main();
