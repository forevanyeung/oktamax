/**
 * End-to-end test of the on-page chat: the built extension in Chromium, the
 * real chat server (in-process) with a fake Okta and a scripted model.
 *
 * Checks that a question asked on one page keeps streaming across a full page
 * navigation, that the page context reaches the server, and that history
 * survives reloads.
 *
 * Run: vp build && vpx e2e/chat.ts
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { chromium } from 'playwright';

process.env.OKTA_ORG_URL = 'https://acme.okta.com';
process.env.OKTA_CLIENT_ID = '0oatestclient';
const { createApp } = await import('@oktamax/server/app');
const { MemoryChatStore } = await import('@oktamax/server/store');
const { fakeOktaMcpPool, mockOkta, scriptedModel } = await import('@oktamax/server/testing');

const ADMIN = 'https://acme-admin.okta.com';
const PORT = 8787; // the extension's default chat server URL
const extensionPath = resolve(import.meta.dirname, '../dist');

const pages: Record<string, string> = {
  '/admin/users': '<main><h1>People</h1><p>3 users are locked out.</p></main>',
  '/admin/apps/active': '<main><h1>Applications</h1><p>Acme SAML</p></main>',
};

async function main() {
  mockOkta();
  const store = new MemoryChatStore();
  const oktaMcp = fakeOktaMcpPool();
  const app = createApp({
    oktaMcp,
    model: scriptedModel(300),
    store,
    mcpUrl: `http://localhost:${PORT}/mcp`,
  });
  const server = serve({ fetch: app.fetch, port: PORT });

  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oktamax-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route(`${ADMIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, json: {} });
    return route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><title>${url.pathname}</title><body>${pages[url.pathname] ?? ''}</body>`,
    });
  });

  // Sign in: put a token where the service worker keeps it (the real flow needs Okta).
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(() =>
    chrome.storage.session.set({
      oktaToken: {
        accessToken: 'token-ada',
        expiresAt: Date.now() + 3_600_000,
        orgUrl: 'https://acme.okta.com',
      },
    }),
  );

  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[page error]', m.text()));

  // --- Ask a question on the People page -------------------------------------
  await page.goto(`${ADMIN}/admin/users`);
  await page.getByRole('button', { name: 'Open Okta assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Okta assistant' });
  await panel.getByPlaceholder('Ask about this org…').fill('Who is locked out?');
  await panel.getByPlaceholder('Ask about this org…').press('Enter');

  // Mid-answer, navigate to another page (a full page load).
  await panel.getByText('One user').waitFor();
  const partial = await panel.locator('.chat-message.assistant').innerText();
  assert.ok(!partial.includes('locked@example.com.'), 'still streaming when we navigate');
  await page.goto(`${ADMIN}/admin/apps/active`);

  // --- The new page reopens the chat and the answer finishes -------------------
  const resumed = page.getByRole('dialog', { name: 'Okta assistant' });
  await resumed.getByText('Who is locked out?').waitFor();
  await resumed.getByText('locked@example.com.').waitFor({ timeout: 10_000 });
  await resumed.getByText('Looked up: List users').waitFor();
  await page.screenshot({ path: join(import.meta.dirname, 'chat-resumed.png') });

  // --- History survives another reload, without duplicates ---------------------
  await page.reload();
  const reloaded = page.getByRole('dialog', { name: 'Okta assistant' });
  await reloaded.getByText('locked@example.com.').waitFor();
  assert.equal(await reloaded.locator('.chat-message.user').count(), 1);
  assert.equal(await reloaded.locator('.chat-message.assistant').count(), 1);

  // --- The server saw the page the question was asked from ---------------------
  const chatId = await worker.evaluate(async () => {
    const { chatState } = await chrome.storage.local.get('chatState');
    return (chatState as { chatId: string }).chatId;
  });
  const saved = store.get(chatId)!;
  assert.equal(saved.messages[0]?.metadata?.page?.url, `${ADMIN}/admin/users`);
  assert.deepEqual(saved.messages[0]?.metadata?.page?.headings, ['People']);

  // --- The panel moves up out of the way of the API console --------------------
  const panelBottom = async () =>
    (await reloaded.boundingBox())!.y + (await reloaded.boundingBox())!.height;
  await page.getByRole('button', { name: /^API$/ }).click();
  const drawer = page.getByRole('region', { name: 'API console' });
  await drawer.waitFor();
  const drawerTop = (await drawer.boundingBox())!.y;
  await page.waitForFunction(
    (top) =>
      document
        .querySelector('[data-oktamax="host"]')!
        .shadowRoot!.querySelector('.chat-panel')!
        .getBoundingClientRect().bottom <= top,
    drawerTop,
  );
  assert.ok((await panelBottom()) <= drawerTop, 'chat sits above the open API console');
  await page.screenshot({ path: join(import.meta.dirname, 'chat-api-console.png') });

  // --- Dark mode ---------------------------------------------------------------
  await worker.evaluate(() => chrome.storage.sync.set({ theme: 'dark' }));
  await page.reload();
  await reloaded.getByText('locked@example.com.').waitFor();
  const background = await reloaded.evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.notEqual(background, 'rgb(255, 255, 255)', 'chat follows dark mode');
  await page.screenshot({ path: join(import.meta.dirname, 'chat-dark.png') });

  await context.close();
  server.close();
  await oktaMcp.closeAll();
  console.log('e2e chat test passed');
}

await main();
