/**
 * End-to-end test of the on-device assistant: the built extension in Chromium,
 * with Okta's MCP server really running on Pyodide in the offscreen document,
 * calling a fake Okta over HTTPS. There's no chat server.
 *
 * Chromium for testing has no Gemini Nano, so the Prompt API (`LanguageModel`)
 * is replaced in the service worker by a scripted stand-in: it picks list_users,
 * calls it the way @browser-ai/core asks models to, and answers from its result.
 * What it checks is everything around the model: tool selection, the MCP round
 * trip through Python, the Okta request with the admin's token, and the reply
 * streaming into the panel.
 *
 * Run: vp build && vpx e2e/onDevice.ts
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium } from 'playwright';

const ORG = 'https://acme.okta.com';
const ADMIN = 'https://acme-admin.okta.com';
const extensionPath = resolve(import.meta.dirname, '../dist');

/** A self-signed certificate for the fake Okta (Chromium is told to accept it). */
function certificate() {
  const dir = mkdtempSync(join(tmpdir(), 'oktamax-cert-'));
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=acme.okta.com',
    '-keyout',
    join(dir, 'key.pem'),
    '-out',
    join(dir, 'cert.pem'),
  ]);
  return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
}

/** Okta's API, as far as this test needs it. Records what the offscreen document asks for. */
function fakeOkta() {
  const requests: Array<{ path: string; authorization?: string }> = [];
  const server = createServer(certificate(), (req, res) => {
    requests.push({ path: req.url!, authorization: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    if (req.url!.startsWith('/api/v1/users')) {
      res.end(
        JSON.stringify([
          {
            id: '00u1locked0000000001',
            status: 'LOCKED_OUT',
            profile: { login: 'locked@example.com', email: 'locked@example.com' },
          },
        ]),
      );
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ errorCode: 'E0000007', errorSummary: 'Not found' }));
    }
  });
  return { server, requests };
}

/**
 * Stands in for Chrome's `LanguageModel` (Prompt API), as @browser-ai/core uses it.
 * Runs in the service worker; records each prompt's size.
 */
function installScriptedModel() {
  const prompts: number[] = [];
  const text = (messages: Array<{ content: unknown }>) => JSON.stringify(messages);
  const reply = (
    messages: Array<{ content: unknown }>,
    options?: { responseConstraint?: unknown },
  ) => {
    const all = text(messages);
    if (options?.responseConstraint) return JSON.stringify({ tools: ['list_users'] });
    const login = /locked@example\.com/.exec(all);
    if (login) return `One user is locked out: **${login[0]}**.`;
    return '```tool_call\n{"name": "list_users", "arguments": {"search": "status eq \\"LOCKED_OUT\\""}}\n```';
  };
  class Session {
    contextWindow = 6144;
    inputQuota = 6144;
    contextUsage = 0;
    inputUsage = 0;
    constructor(private initial: unknown) {}
    addEventListener() {}
    destroy() {}
    async prompt(
      messages: Array<{ content: unknown }>,
      options?: { responseConstraint?: unknown },
    ) {
      prompts.push(text(messages).length + JSON.stringify(this.initial ?? null).length);
      return reply(messages, options);
    }
    promptStreaming(messages: Array<{ content: unknown }>) {
      prompts.push(text(messages).length + JSON.stringify(this.initial ?? null).length);
      const words = reply(messages).split(/(?<=\s)/);
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
      availability: async () => 'available',
      params: async () => ({ defaultTemperature: 1, defaultTopK: 3, maxTopK: 8 }),
      create: async (options: { initialPrompts?: unknown }) => new Session(options?.initialPrompts),
    },
    oktamaxPrompts: prompts,
  });
}

async function main() {
  const okta = fakeOkta();
  await new Promise<void>((r) => okta.server.listen(0, '127.0.0.1', r));
  const port = (okta.server.address() as AddressInfo).port;

  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oktamax-')), {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      // The offscreen document's requests can't be intercepted: send the org to the fake.
      `--host-resolver-rules=MAP acme.okta.com:443 127.0.0.1:${port}`,
      '--ignore-certificate-errors',
    ],
  });
  await context.route(`${ADMIN}/**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>People</title><body><main><h1>People</h1></main></body>',
    }),
  );

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // A JWT-shaped token: okta-mcp-server checks its expiry before calling Okta.
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const token = `${b64({ alg: 'none' })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  await worker.evaluate(installScriptedModel);
  await worker.evaluate(
    ({ token, org }) =>
      Promise.all([
        chrome.storage.sync.set({
          assistant: 'onDevice',
          oktaOrgUrl: org,
          oktaClientId: '0oatestclient',
        }),
        chrome.storage.session.set({
          oktaToken: { accessToken: token, expiresAt: Date.now() + 3_600_000, orgUrl: org },
        }),
      ]),
    { token, org: ORG },
  );

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
  await panel.getByText('Looked up: List users').waitFor();
  console.log(`First answer in ${Date.now() - started} ms`);
  await page.screenshot({ path: join(import.meta.dirname, 'on-device.png') });

  // The Okta call came from Python in the offscreen document, with the admin's token.
  const users = okta.requests.find((r) => r.path.startsWith('/api/v1/users'));
  assert.ok(users, 'okta-mcp-server called Okta');
  assert.equal(users.authorization, `Bearer ${token}`);

  // Every prompt fits Gemini Nano's context window (~6k tokens, ~4 characters each).
  const prompts = await worker.evaluate(
    () => (globalThis as unknown as { oktamaxPrompts: number[] }).oktamaxPrompts,
  );
  console.log('Prompt sizes (characters):', prompts);
  assert.ok(Math.max(...prompts) < 6144 * 4, 'prompts fit in the context window');

  await context.close();
  okta.server.close();
  console.log('e2e on-device test passed');
}

await main();
