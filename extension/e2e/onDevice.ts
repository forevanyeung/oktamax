/**
 * End-to-end test of the on-device assistant: the built extension in Chromium,
 * with Okta's MCP server really running on Pyodide in the offscreen document,
 * reading a fake Okta through the admin console tab, with the admin's session.
 * There's no chat server, no sign-in and no settings beyond turning it on.
 *
 * Chromium for testing has no Gemini Nano, so the Prompt API (`LanguageModel`)
 * is replaced in the service worker by a scripted stand-in: it calls find_users,
 * calls it the way @browser-ai/core asks models to, and answers from its result.
 * Like Nano, it first calls find_users again when told to answer, which the reply
 * leaves out without logging an error.
 * What it checks is everything around the model: tool selection, the MCP round
 * trip through Python, the Okta request sent by the tab with the session cookie,
 * and the reply streaming into the panel.
 *
 * Run: vp build && vpx e2e/onDevice.ts
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

const ADMIN = 'https://acme-admin.okta.com';
const extensionPath = resolve(import.meta.dirname, '../dist');

/**
 * Stands in for Chrome's `LanguageModel` (Prompt API), as @browser-ai/core uses it.
 * Runs in the service worker; records each prompt's size, the options Chrome is
 * asked for, and what the worker logs as an error or warning.
 */
function installScriptedModel() {
  const prompts: number[] = [];
  const options: unknown[] = [];
  const logged: string[] = [];
  for (const level of ['error', 'warn'] as const) {
    const log = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
      log(...args);
    };
  }
  const text = (messages: Array<{ content: unknown }>) => JSON.stringify(messages);
  const findUsers =
    '```tool_call\n{"name": "find_users", "arguments": {"status": "LOCKED_OUT"}}\n```';
  let strayed = false;
  const reply = (messages: Array<{ content: unknown }>, initial: unknown) => {
    const login = /locked@example\.com/.exec(text(messages));
    if (!login) return findUsers;
    // Told to answer, Nano often calls the tool again first.
    if (!strayed && JSON.stringify(initial).includes("Don't call any tools")) {
      strayed = true;
      return findUsers;
    }
    return `One user is locked out: **${login[0]}**.`;
  };
  class Session {
    contextWindow = 6144;
    inputQuota = 6144;
    contextUsage = 0;
    inputUsage = 0;
    constructor(private initial: unknown) {}
    addEventListener() {}
    destroy() {}
    async prompt(messages: Array<{ content: unknown }>) {
      prompts.push(text(messages).length + JSON.stringify(this.initial ?? null).length);
      return reply(messages, this.initial);
    }
    promptStreaming(messages: Array<{ content: unknown }>) {
      prompts.push(text(messages).length + JSON.stringify(this.initial ?? null).length);
      const words = reply(messages, this.initial).split(/(?<=\s)/);
      return new ReadableStream<string>({
        async pull(controller) {
          await new Promise((r) => setTimeout(r, 20));
          const word = words.shift();
          if (word === undefined) controller.close();
          else controller.enqueue(word);
        },
      });
    }
  }
  Object.assign(globalThis, {
    LanguageModel: {
      availability: async (asked: unknown) => (options.push(asked), 'available'),
      params: async () => ({ defaultTemperature: 1, defaultTopK: 3, maxTopK: 8 }),
      create: async (asked: { initialPrompts?: unknown }) => {
        options.push(asked);
        return new Session(asked?.initialPrompts);
      },
    },
    oktamaxPrompts: prompts,
    oktamaxOptions: options,
    oktamaxLogged: logged,
  });
}

async function main() {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oktamax-')), {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  // The admin's session with the admin console.
  await context.addCookies([
    { name: 'sid', value: 'admin-session', domain: 'acme-admin.okta.com', path: '/', secure: true },
  ]);

  // Okta's API, as far as this test needs it; records what the tab asks for.
  const requests: Array<{ method: string; path: string; headers: Record<string, string> }> = [];
  await context.route(`${ADMIN}/api/**`, async (route) => {
    const url = new URL(route.request().url());
    requests.push({
      method: route.request().method(),
      path: url.pathname + url.search,
      headers: await route.request().allHeaders(),
    });
    if (url.pathname === '/api/v1/users') {
      await route.fulfill({
        json: [
          {
            id: '00u1locked0000000001',
            status: 'LOCKED_OUT',
            profile: { login: 'locked@example.com', email: 'locked@example.com' },
          },
        ],
      });
    } else {
      await route.fulfill({
        status: 404,
        json: { errorCode: 'E0000007', errorSummary: 'Not found' },
      });
    }
  });
  await context.route(/^https:\/\/acme-admin\.okta\.com\/(?!api\/)/, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>People</title><body><main><h1>People</h1></main></body>',
    }),
  );

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  await worker.evaluate(installScriptedModel);
  // The only setting: no org URL, client ID or token.
  await worker.evaluate(() => chrome.storage.sync.set({ assistant: 'onDevice' }));

  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[page error]', m.text()));
  await page.goto(`${ADMIN}/admin/users`);
  await page.getByRole('button', { name: 'Open Okta assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Okta assistant' });
  await panel.getByText('On-device').waitFor();

  const started = Date.now();
  await panel.getByPlaceholder('Ask about this org…').fill('Who is locked out?');
  await panel.getByPlaceholder('Ask about this org…').press('Enter');
  // The first question waits for Python to load in the offscreen document.
  await panel.getByText('One user is locked out:').waitFor({ timeout: 90_000 });
  await panel.getByText('Looked up: Find users').waitFor();
  console.log(`First answer in ${Date.now() - started} ms`);
  await page.screenshot({ path: join(import.meta.dirname, 'on-device.png') });

  // okta-mcp-server's Okta call was sent by the admin console tab, with the admin's session.
  const users = requests.find((r) => r.path.startsWith('/api/v1/users'));
  assert.ok(users, 'okta-mcp-server called Okta');
  assert.equal(users.method, 'GET');
  assert.match(users.headers.cookie ?? '', /sid=admin-session/);
  assert.equal(users.headers.authorization, undefined, 'no access token');
  assert.ok(
    requests.every((r) => r.method === 'GET'),
    'only reads',
  );

  // Every prompt fits Gemini Nano's context window (~6k tokens, ~4 characters each).
  const prompts = await worker.evaluate(
    () => (globalThis as unknown as { oktamaxPrompts: number[] }).oktamaxPrompts,
  );
  console.log('Prompt sizes (characters):', prompts);
  assert.ok(Math.max(...prompts) < 6144 * 4, 'prompts fit in the context window');

  const { asked, logged } = await worker.evaluate(() => {
    const g = globalThis as unknown as { oktamaxOptions: unknown[]; oktamaxLogged: string[] };
    return { asked: g.oktamaxOptions, logged: g.oktamaxLogged };
  });
  // Chrome warns about any request that doesn't say which language it answers in.
  const english = [{ type: 'text', languages: ['en'] }];
  for (const options of asked) {
    assert.deepEqual((options as { expectedOutputs?: unknown }).expectedOutputs, english);
  }
  assert.deepEqual(logged, [], 'the worker logged no errors or warnings');

  await context.close();
  console.log('e2e on-device test passed');
}

await main();
