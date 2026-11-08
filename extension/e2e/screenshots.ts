/**
 * Screenshots for the website and the Chrome Web Store listing (1280×800, the
 * size the store asks for): the built extension in Chromium on a mock admin
 * console, with the real chat server in-process and a scripted model.
 *
 * Writes site/screenshots/<name>.png (1280×800) and <name>@2x.png (for the site).
 * The numbered ones are the store's five; the others are only on the site.
 *
 * Run: npm run screenshots
 */
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { serve } from '@hono/node-server';
import { simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { chromium, type BrowserContext, type Page } from 'playwright';

process.env.OKTA_ORG_URL = 'https://acme.okta.com';
process.env.OKTA_CLIENT_ID = '0oatestclient';
const { createApp } = await import('@oktamax/server/app');
const { MemoryChatStore } = await import('@oktamax/server/store');
const { fakeOktaMcpPool, mockOkta } = await import('@oktamax/server/testing');

const ADMIN = 'https://acme-admin.okta.com';
const PORT = 8787; // the extension's default chat server URL
const extensionPath = resolve(import.meta.dirname, '../dist');
const outDir = resolve(import.meta.dirname, '../../site/screenshots');

// --- A mock admin console ------------------------------------------------------

const NAV = [
  'Dashboard',
  'Directory',
  'Customizations',
  'Applications',
  'Security',
  'Workflow',
  'Reports',
  'Settings',
];

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 "Inter", -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #1d1d21; background: #f4f4f4; }
  header { height: 56px; display: flex; align-items: center; gap: 24px; padding: 0 24px;
    background: #ffffff; border-bottom: 1px solid #e1e1e1; }
  .logo { font-weight: 700; font-size: 18px; letter-spacing: -0.02em; width: 192px; }
  .logo span { color: #1662dd; }
  .search { flex: 1; max-width: 480px; height: 36px; border: 1px solid #d7d7dc; border-radius: 6px;
    padding: 0 12px; display: flex; align-items: center; color: #6e6e78; background: #fafafa; }
  .me { margin-left: auto; display: flex; align-items: center; gap: 10px; color: #3f3f46; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; background: #ebf1fc; color: #1662dd;
    display: grid; place-items: center; font-weight: 600; font-size: 13px; }
  .layout { display: flex; min-height: calc(100vh - 56px); }
  nav { width: 240px; flex-shrink: 0; background: #ffffff; border-right: 1px solid #e1e1e1;
    padding: 16px 12px; }
  nav a { display: block; padding: 8px 12px; border-radius: 6px; color: #3f3f46;
    text-decoration: none; font-weight: 500; }
  nav a.active { background: #ebf1fc; color: #1662dd; }
  nav .sub { padding-left: 28px; font-weight: 400; font-size: 13px; }
  main { flex: 1; padding: 28px 36px; min-width: 0; }
  .crumbs { color: #6e6e78; font-size: 13px; margin-bottom: 4px; }
  h1 { font-size: 26px; font-weight: 600; margin: 0 0 20px; letter-spacing: -0.01em; }
  h2 { font-size: 17px; font-weight: 600; margin: 0; }
  .card { background: #ffffff; border: 1px solid #e1e1e1; border-radius: 8px; margin-bottom: 20px; }
  .card-head { display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid #ededf0; }
  .card-body { padding: 16px 20px; }
  .field { display: grid; grid-template-columns: 220px 1fr; padding: 6px 0; }
  .field b { font-weight: 500; color: #6e6e78; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-weight: 600; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.04em; color: #6e6e78; padding: 10px 20px; border-bottom: 1px solid #ededf0; }
  td { padding: 12px 20px; border-bottom: 1px solid #ededf0; }
  tr:last-child td { border-bottom: 0; }
  td a { color: #1662dd; text-decoration: none; font-weight: 500; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px;
    font-weight: 500; background: #e7f5ec; color: #16794c; }
  .pill.warn { background: #fdf3e2; color: #9c5f00; }
  .pill.off { background: #f0f0f2; color: #6e6e78; }
  .tabs { display: flex; gap: 24px; border-bottom: 1px solid #e1e1e1; margin-bottom: 20px; }
  .tabs span { padding: 10px 0; color: #6e6e78; font-weight: 500; }
  .tabs span.active { color: #1662dd; box-shadow: inset 0 -2px #1662dd; }
  .app-head { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  .app-icon { width: 56px; height: 56px; border-radius: 10px; background: #1d1d21; color: #fff;
    display: grid; place-items: center; font-weight: 700; font-size: 22px; }
  .app-head h1 { margin: 0; }
  .muted { color: #6e6e78; }
  .toolbar { display: flex; gap: 12px; margin-bottom: 16px; }
  .toolbar .search { max-width: 320px; background: #fff; }
  .btn { height: 36px; padding: 0 14px; border-radius: 6px; border: 1px solid #d7d7dc;
    background: #fff; font: inherit; font-weight: 500; color: #3f3f46; }
  /* Okta's "Actions" menu, which the extension builds with Okta's classes. */
  .dropdown { position: relative; display: inline-block; }
  .link-button { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px;
    border: 1px solid #d7d7dc; border-radius: 6px; background: #fff; color: #3f3f46;
    font-weight: 500; text-decoration: none; }
  .icon-dm::after { content: "▾"; }
  .dropdown .options { display: none; position: absolute; right: 0; top: 38px; z-index: 10;
    min-width: 160px; background: #fff; border: 1px solid #e1e1e1; border-radius: 6px;
    box-shadow: 0 6px 20px rgb(0 0 0 / 12%); }
  .okta-dropdown-list { list-style: none; margin: 0; padding: 4px 0; }
  .okta-dropdown-option a { display: block; padding: 8px 16px 8px 40px; color: #1d1d21;
    text-align: left; text-decoration: none; cursor: pointer; }
  .option-title { margin: 0; }
`;

function shell(title: string, active: string, sub: string[], content: string) {
  const nav = NAV.map((item) => {
    const link = `<a href="#" class="${item === active ? 'active' : ''}">${item}</a>`;
    return item === active
      ? link + sub.map((s) => `<a href="#" class="sub">${s}</a>`).join('')
      : link;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title} | Acme - Admin Console</title>
    <style>${CSS}</style></head><body>
    <span id="_xsrfToken" hidden>xsrf-123</span>
    <header><div class="logo">acme<span>.</span></div>
      <div class="search">Search for people, apps and groups</div>
      <div class="me"><span>Ada Lovelace</span><div class="avatar">AL</div></div></header>
    <div class="layout"><nav>${nav}</nav><main>${content}</main></div></body></html>`;
}

const USERS = [
  ['Ada Lovelace', 'ada@acme.com', 'Active', ''],
  ['Alan Turing', 'alan@acme.com', 'Locked out', 'warn'],
  ['Grace Hopper', 'grace@acme.com', 'Active', ''],
  ['Katherine Johnson', 'katherine@acme.com', 'Locked out', 'warn'],
  ['Linus Torvalds', 'linus@acme.com', 'Suspended', 'off'],
  ['Margaret Hamilton', 'margaret@acme.com', 'Active', ''],
  ['Tim Berners-Lee', 'tim@acme.com', 'Active', ''],
];

const GROUP_RULES = [
  {
    id: '0pr1',
    name: 'Engineering department',
    status: 'ACTIVE',
    conditions: {
      expression: { value: 'user.department=="Engineering"', type: 'urn:okta:expression:1.0' },
      people: { users: { exclude: ['00u05a7k3XqZ9'] } },
    },
    actions: { assignUserToGroups: { groupIds: ['00g1', '00g2'] } },
    _embedded: { groupIdToGroupNameMap: { '00g1': 'Engineering', '00g2': 'GitHub users' } },
  },
  {
    id: '0pr2',
    name: 'Contractors',
    status: 'ACTIVE',
    conditions: {
      expression: { value: 'user.userType=="Contractor" AND user.endDate != null' },
    },
    actions: { assignUserToGroups: { groupIds: ['00g3'] } },
    _embedded: { groupIdToGroupNameMap: { '00g3': 'Contractors' } },
  },
  {
    id: '0pr3',
    name: 'Sales team',
    status: 'ACTIVE',
    conditions: { expression: { value: 'user.department=="Sales"' } },
    actions: { assignUserToGroups: { groupIds: ['00g4'] } },
    _embedded: { groupIdToGroupNameMap: { '00g4': 'Sales' } },
  },
];

// The console's names and "Used for" column, beside the API's authenticators.
const AUTHENTICATORS = [
  {
    id: 'aut1',
    key: 'okta_email',
    name: 'Email',
    type: 'email',
    status: 'ACTIVE',
    settings: { allowedFor: 'any', tokenLifetimeInMinutes: 5 },
    usedFor: 'Authentication, Recovery',
  },
  {
    id: 'aut2',
    key: 'okta_verify',
    name: 'Okta Verify',
    type: 'app',
    status: 'ACTIVE',
    settings: {
      userVerification: 'PREFERRED',
      channelBinding: { required: 'HIGH_RISK_ONLY', style: 'NUMBER_CHALLENGE' },
    },
    usedFor: 'Authentication, Recovery',
  },
  {
    id: 'aut3',
    key: 'okta_password',
    name: 'Password',
    type: 'password',
    status: 'ACTIVE',
    usedFor: 'Authentication, Recovery',
  },
  {
    id: 'aut4',
    key: 'phone_number',
    name: 'Phone',
    type: 'phone',
    status: 'ACTIVE',
    settings: { allowedFor: 'recovery' },
    usedFor: 'Recovery',
  },
  {
    id: 'aut5',
    key: 'webauthn',
    name: 'FIDO2 (WebAuthn)',
    type: 'security_key',
    status: 'ACTIVE',
    settings: { userVerification: 'PREFERRED', residentKeyRequirement: 'REQUIRED' },
    usedFor: 'Authentication',
  },
];

// Salesforce's assignments: groups by priority, and people through them.
const APP_GROUPS = [
  { id: '00g4', name: 'Sales', priority: 0, profile: { profile: 'sales', role: 'ae' } },
  { id: '00g1', name: 'Engineering', priority: 1, profile: { profile: 'standard', role: 'eng' } },
  { id: '00g6', name: 'All employees', priority: 2, profile: { profile: 'chatter', role: '' } },
];

const ASSIGNEES = [
  ['00u03a7k3XqZ9', 'Grace Hopper', 'grace@acme.com', ['00g1', '00g6']],
  ['00u01a7k3XqZ9', 'Ada Lovelace', 'ada@acme.com', ['00g4', '00g1', '00g6']],
  ['00u06a7k3XqZ9', 'Margaret Hamilton', 'margaret@acme.com', ['00g6']],
  ['00u07a7k3XqZ9', 'Tim Berners-Lee', 'tim@acme.com', ['00g6']],
] as const;

const pages: Record<string, string> = {
  '/admin/users': shell(
    'People',
    'Directory',
    ['People', 'Groups', 'Devices', 'Profile Editor'],
    `<div class="crumbs">Directory</div><h1>People</h1>
    <div class="toolbar"><div class="search">Search…</div><button class="btn">More actions ▾</button></div>
    <div class="card"><table>
      <tr><th>Person &amp; username</th><th>Primary email</th><th>Status</th></tr>
      ${USERS.map(
        ([name, email, status, kind]) =>
          `<tr><td><a href="#">${name}</a><div class="muted">${email}</div></td><td>${email}</td>
           <td><span class="pill ${kind}">${status}</span></td></tr>`,
      ).join('')}
    </table></div>`,
  ),
  '/admin/groups': shell(
    'Groups',
    'Directory',
    ['People', 'Groups', 'Devices', 'Profile Editor'],
    `<div class="crumbs">Directory</div><h1>Groups</h1>
    <div class="tabs"><span>Groups</span><span class="active">Rules</span></div>
    <div class="card"><table>
      <tr><th>Rule</th><th>Assigns to</th><th>Status</th></tr>
      ${GROUP_RULES.map(
        (r) =>
          `<tr><td><a href="#">${r.name}</a></td><td>${Object.values(r._embedded.groupIdToGroupNameMap).join(', ')}</td>
           <td class="status-col-perf"><span class="pill">Active</span></td></tr>`,
      ).join('')}
    </table></div>`,
  ),
  '/admin/app/acme_app_1/instance/0oa1/': shell(
    'Salesforce',
    'Applications',
    ['Applications', 'Self Service', 'API Service Integrations'],
    `<div class="crumbs">Applications</div>
    <div class="app-head"><div class="app-icon">S</div><div><h1>Salesforce</h1>
      <span class="pill">Active</span> <span class="muted">SAML 2.0</span></div></div>
    <div class="tabs"><span>General</span><span>Sign On</span><span>Import</span><span class="active">Assignments</span></div>
    <div class="card"><div class="card-head"><h2>People</h2></div><table>
      <tr><th>Person</th><th>Type</th></tr>
      ${ASSIGNEES.map(
        ([id, name, email]) =>
          `<tr><td><a href="/admin/user/profile/view/${id}">${name}</a><div class="muted">${email}</div></td>
           <td>Group</td></tr>`,
      ).join('')}
    </table></div>`,
  ),
  '/admin/access/authenticators': shell(
    'Authenticators',
    'Security',
    ['Authenticators', 'Authentication Policies', 'Global Session Policy', 'Networks'],
    `<div class="crumbs">Security</div><h1>Authenticators</h1>
    <div class="tabs"><span class="active">Setup</span><span>Enrollment</span></div>
    <div class="card"><table>
      <tr><th>Name</th><th>Used for</th><th style="text-align: right">Actions</th></tr>
      ${AUTHENTICATORS.map(
        (a) =>
          `<tr><td><b>${a.key === 'webauthn' ? 'Passkey (FIDO2 WebAuthn)' : a.name}</b></td>
           <td class="muted">${a.usedFor}</td><td class="authenticator-actions" style="text-align: right"></td></tr>`,
      ).join('')}
    </table></div>`,
  ),
};

const apiUsers = USERS.map(([name, email, status], i) => {
  const [firstName, ...last] = name!.split(' ');
  return {
    id: `00u${(i + 1).toString().padStart(2, '0')}a7k3XqZ9`,
    status: status === 'Locked out' ? 'LOCKED_OUT' : status!.toUpperCase(),
    created: `2026-0${(i % 9) + 1}-1${i}T09:30:00.000Z`,
    lastLogin: `2026-10-${(20 + i).toString()}T14:0${i}:00.000Z`,
    profile: { login: email, email, firstName, lastName: last.join(' ') },
    _links: { self: { href: `${ADMIN.replace('-admin', '')}/api/v1/users/00u${i + 1}` } },
  };
});

const api: Record<string, unknown> = {
  '/api/v1/users': apiUsers,
  '/api/v1/groups/rules': GROUP_RULES,
  '/api/v1/users/00u05a7k3XqZ9': apiUsers[4],
  '/api/v1/authenticators': AUTHENTICATORS,
  '/api/v1/authenticators/aut2/methods': [
    { type: 'push', status: 'ACTIVE' },
    { type: 'totp', status: 'ACTIVE' },
    { type: 'signed_nonce', status: 'ACTIVE' },
  ],
  '/api/v1/apps/0oa1/groups': APP_GROUPS,
  '/api/v1/meta/schemas/apps/0oa1/default': {
    definitions: {
      base: { properties: { userName: { title: 'Username', type: 'string', scope: 'SELF' } } },
      custom: {
        properties: {
          profile: {
            title: 'Profile',
            type: 'string',
            oneOf: [
              { const: 'sales', title: 'Sales User' },
              { const: 'standard', title: 'Standard User' },
              { const: 'chatter', title: 'Chatter Free User' },
            ],
          },
          role: {
            title: 'Role',
            type: 'string',
            oneOf: [
              { const: 'ae', title: 'Account Executive' },
              { const: 'eng', title: 'Engineering' },
            ],
          },
        },
      },
    },
  },
  ...Object.fromEntries(
    ASSIGNEES.flatMap(([id, , email, groupIds]) => {
      const groups = APP_GROUPS.filter((g) => groupIds.includes(g.id as never));
      return [
        [
          `/api/v1/apps/0oa1/users/${id}`,
          {
            id,
            scope: 'GROUP',
            status: 'ACTIVE',
            credentials: { userName: email },
            profile: groups[0]!.profile,
            _links: { group: { name: groups[0]!.name } },
          },
        ],
        [
          `/api/v1/users/${id}/groups`,
          groups.map((g) => ({ id: g.id, profile: { name: g.name } })),
        ],
      ];
    }),
  ),
};

// --- A scripted model with a presentable answer -----------------------------------

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

const ANSWER = `Two people are locked out right now:

| Name | Username | Locked since |
| --- | --- | --- |
| Alan Turing | alan@acme.com | Today, 9:12 AM |
| Katherine Johnson | katherine@acme.com | Yesterday, 4:47 PM |

Both hit the password lockout threshold in the **Default Policy**. A super admin can unlock them from their profile pages, or they can unlock themselves with self-service unlock if it's enabled.`;

const model = () =>
  new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const answered = prompt
        .slice(prompt.findLastIndex((m) => m.role === 'user'))
        .some((m) => m.role === 'tool');
      const chunks: LanguageModelV4StreamPart[] = answered
        ? [
            { type: 'text-start', id: 't1' },
            { type: 'text-delta', id: 't1', delta: ANSWER },
            { type: 'text-end', id: 't1' },
            { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'end_turn' } },
          ]
        : [
            {
              type: 'tool-call',
              toolCallId: crypto.randomUUID(),
              toolName: 'list_users',
              input: JSON.stringify({ search: 'status eq "LOCKED_OUT"' }),
            },
            { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_use' } },
          ];
      return { stream: simulateReadableStream({ chunks, chunkDelayInMs: 20 }) };
    },
  });

/**
 * Stands in for Chrome's Gemini Nano (the Prompt API) in the service worker, as in
 * e2e/onDevice.ts: it calls the guide's find_users, then answers from its result.
 */
function installScriptedNano() {
  const text = (messages: unknown) => JSON.stringify(messages);
  const reply = (messages: unknown) =>
    text(messages).includes('alan@acme.com')
      ? 'Two people are locked out: **Alan Turing** (alan@acme.com) and **Katherine Johnson** (katherine@acme.com). A super admin can unlock them from their profile pages.'
      : '```tool_call\n{"name": "find_users", "arguments": {"status": "LOCKED_OUT"}}\n```';
  class Session {
    contextWindow = 6144;
    inputQuota = 6144;
    contextUsage = 0;
    inputUsage = 0;
    addEventListener() {}
    destroy() {}
    async prompt(messages: unknown) {
      return reply(messages);
    }
    promptStreaming(messages: unknown) {
      const words = reply(messages).split(/(?<=\s)/);
      return new ReadableStream<string>({
        async pull(controller) {
          await new Promise((r) => setTimeout(r, 10));
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
      create: async () => new Session(),
    },
  });
}

// --- Shots ----------------------------------------------------------------------

async function launch(scale: number): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'oktamax-')), {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: scale,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  await context.route(`${ADMIN}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      const filter = `${url.searchParams.get('search')} ${url.searchParams.get('filter')}`;
      if (url.pathname === '/api/v1/users' && filter.includes('LOCKED_OUT'))
        return route.fulfill({ json: apiUsers.filter((u) => u.status === 'LOCKED_OUT') });
      const body = api[url.pathname];
      return body === undefined
        ? route.fulfill({ status: 404, json: { errorSummary: 'Not found' } })
        : route.fulfill({
            json: body,
            // Only the users list has a next page (the views follow `Link` to the end).
            headers:
              url.pathname === '/api/v1/users' && !url.searchParams.has('after')
                ? { link: `<${ADMIN}/api/v1/users?after=00u07&limit=7>; rel="next"` }
                : {},
          });
    }
    return route.fulfill({
      contentType: 'text/html',
      body: pages[url.pathname] ?? shell('Admin Console', 'Dashboard', [], '<h1>Dashboard</h1>'),
    });
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  // Sign in: put a token where the service worker keeps it (the real flow needs Okta).
  await worker.evaluate(() =>
    chrome.storage.session.set({
      'oktaToken:https://acme.okta.com': {
        accessToken: 'token-ada',
        expiresAt: Date.now() + 3_600_000,
        orgUrl: 'https://acme.okta.com',
      },
    }),
  );
  return context;
}

async function setTheme(context: BrowserContext, theme: 'light' | 'dark') {
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate((t) => chrome.storage.sync.set({ theme: t }), theme);
}

async function shoot(page: Page, name: string, scale: number) {
  await page.mouse.move(0, 799);
  await page.waitForTimeout(400);
  const suffix = scale === 1 ? '' : `@${scale}x`;
  await page.screenshot({ path: join(outDir, `${name}${suffix}.png`) });
  console.log(`  ${name}${suffix}.png`);
}

/** Authenticators as a read-only admin sees them, and with Okta Max's View items, side by side. */
async function compareShot(context: BrowserContext, scale: number) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 640, height: 730 });
  await page.goto(`${ADMIN}/admin/access/authenticators`);
  await page.addStyleTag({
    content: 'nav { display: none; } header .search { white-space: nowrap; overflow: hidden; }',
  });
  const view = page.locator('[data-oktamax-key="authenticator:aut2"]');
  await view.waitFor({ state: 'attached' });
  await page.mouse.move(0, 729);
  await page.waitForTimeout(400);
  // Everything Okta Max adds: the Actions menus, and the Ask and API buttons.
  const hidden = await page.addStyleTag({
    content: '[data-oktamax] { display: none !important; }',
  });
  const without = await page.screenshot();
  await hidden.evaluate((style) => (style as Element).remove());
  await page.locator('tr', { hasText: 'Okta Verify' }).locator('.option-selected').click();
  await view.evaluate((item) =>
    Object.assign(item.style, {
      outline: '3px solid #ffc83d',
      outlineOffset: '-3px',
      borderRadius: '6px',
    }),
  );
  await page.mouse.move(0, 729);
  const withView = await page.screenshot();

  const src = (png: Buffer) => `data:image/png;base64,${png.toString('base64')}`;
  await page.goto('about:blank');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<style>
    body { margin: 0; width: 1280px; height: 800px; display: grid; grid-template-columns: 1fr 1fr;
      font: 15px -apple-system, 'Segoe UI', Roboto, sans-serif; }
    .panel + .panel { border-left: 2px solid #1662dd; }
    .label { height: 70px; box-sizing: border-box; padding: 14px 24px; background: #f0f2f6; }
    .label b { display: block; font-size: 18px; color: #1d1d21; }
    .label span { color: #5b5b66; }
    .with .label { background: #1662dd; }
    .with .label b, .with .label span { color: #ffffff; }
    img { display: block; width: 640px; height: 730px; }
  </style>
  <div class="panel"><div class="label"><b>Read-only admin in Okta</b>
    <span>No Actions menu, so authenticator settings stay hidden</span></div><img src="${src(without)}"></div>
  <div class="panel with"><div class="label"><b>With Okta Max</b>
    <span>A View option opens every setting, still read-only</span></div><img src="${src(withView)}"></div>`);
  const suffix = scale === 1 ? '' : `@${scale}x`;
  await page.screenshot({ path: join(outDir, `compare${suffix}.png`) });
  console.log(`  compare${suffix}.png`);
  await page.close();
}

async function run(scale: number) {
  const context = await launch(scale);
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('[page error]', m.text()));
  await setTheme(context, 'light');

  // 1. A read-only view of an app assignment, with the groups it comes through by priority.
  await page.goto(`${ADMIN}/admin/app/acme_app_1/instance/0oa1/#tab-assignments`);
  await page.locator('[data-oktamax-key="app-user:0oa1:00u03a7k3XqZ9"]').click();
  await page
    .getByRole('dialog', { name: 'View User Assignment' })
    .getByText('the highest-priority group')
    .waitFor();
  await shoot(page, '1-read-only-view', scale);
  await page.keyboard.press('Escape');
  await compareShot(context, scale);

  // 2. The on-device assistant: Gemini Nano and Okta's MCP server, in Chrome.
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(installScriptedNano);
  await worker.evaluate(() => chrome.storage.sync.set({ assistant: 'onDevice' }));
  await page.goto(`${ADMIN}/admin/users`);
  await page.getByRole('button', { name: 'Open Okta assistant' }).click();
  const local = page.getByRole('dialog', { name: 'Okta assistant' });
  await local.getByText('On-device').waitFor();
  await local.getByPlaceholder('Ask about this org…').fill('Who is locked out?');
  await local.getByPlaceholder('Ask about this org…').press('Enter');
  // The first question waits for Python to load in the offscreen document.
  await local.getByText('A super admin can unlock them').waitFor({ timeout: 90_000 });
  await shoot(page, '2-on-device-assistant', scale);
  await local.getByRole('button', { name: 'Close' }).first().click();

  // The popup, with the on-device assistant chosen (for the site).
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 320, height: 640 });
  await popup.addInitScript(() =>
    Object.assign(globalThis, { LanguageModel: { availability: async () => 'available' } }),
  );
  await popup.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/index.html`);
  await popup.getByText('Runs in Chrome').waitFor();
  await popup.waitForTimeout(400);
  await popup
    .locator('main')
    .screenshot({ path: join(outDir, `popup${scale === 1 ? '' : `@${scale}x`}.png`) });
  console.log('  popup');
  await popup.close();

  // The assistant on your own chat server (for the site).
  await worker.evaluate(() => chrome.storage.sync.set({ assistant: 'server' }));
  await page.goto(`${ADMIN}/admin/users`);
  await page.getByRole('button', { name: 'Open Okta assistant' }).click();
  const panel = page.getByRole('dialog', { name: 'Okta assistant' });
  const input = panel.getByPlaceholder('Ask about this org…');
  await input.fill('Who is locked out right now?');
  await input.press('Enter');
  await panel.getByText('self-service unlock').waitFor({ timeout: 15_000 });
  await shoot(page, 'assistant-server', scale);
  await panel.getByRole('button', { name: 'Close' }).first().click();

  // 3. The API console.
  await page.goto(`${ADMIN}/admin/users`);
  await page.getByRole('button', { name: 'API', exact: true }).click();
  const drawer = page.getByRole('region', { name: 'API console' });
  const prompt = drawer.getByLabel('Request URL');
  await prompt.fill('users?limit=7');
  await prompt.press('Enter');
  await drawer.getByText('200 OK').waitFor();
  await drawer.getByRole('tab', { name: 'Table' }).click();
  await drawer.getByRole('cell', { name: 'alan@acme.com' }).first().waitFor();
  await shoot(page, '3-api-console', scale);
  await page.keyboard.press('Control+`');
  await drawer.waitFor({ state: 'detached' });

  // 4. Dark mode, with a group rule view open.
  await setTheme(context, 'dark');
  await page.goto(`${ADMIN}/admin/groups`);
  await page.locator('[data-oktamax-key="group-rule:0pr1"]').click();
  await page.getByRole('dialog', { name: 'View Rule' }).getByText('Linus Torvalds').waitFor();
  await shoot(page, '4-dark-mode', scale);
  await page.keyboard.press('Escape');

  // 5. Dark mode with the assistant and the API console together.
  await page.goto(`${ADMIN}/admin/users`);
  await page.getByRole('button', { name: 'Open Okta assistant' }).click();
  await page
    .getByRole('dialog', { name: 'Okta assistant' })
    .getByText('self-service unlock')
    .waitFor();
  await page.getByRole('button', { name: 'API', exact: true }).click();
  const darkDrawer = page.getByRole('region', { name: 'API console' });
  await darkDrawer.getByLabel('Request URL').fill('users?limit=7');
  await darkDrawer.getByLabel('Request URL').press('Enter');
  await darkDrawer.getByText('"alan@acme.com"').first().waitFor();
  await shoot(page, '5-dark-assistant-api', scale);

  await context.close();
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  mockOkta();
  const oktaMcp = fakeOktaMcpPool();
  const server = serve({
    fetch: createApp({
      oktaMcp,
      model: model(),
      store: new MemoryChatStore(),
      mcpUrl: `http://localhost:${PORT}/mcp`,
    }).fetch,
    port: PORT,
  });
  for (const scale of [1, 2]) await run(scale);
  server.close();
  await oktaMcp.closeAll();
}

await main();
