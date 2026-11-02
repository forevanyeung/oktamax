/**
 * Verifies the gateway against the REAL okta-mcp-server (Python, via uvx):
 * two admins, each with their own process, each calling a fake Okta org (HTTPS,
 * self-signed) with only their own token, and only read-only tools exposed.
 *
 * Needs `uv` on PATH. Run: vpx scripts/verify-okta-mcp.ts
 */
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMCPClient } from '@ai-sdk/mcp';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

process.env.OKTA_ORG_URL ??= 'https://acme.okta.com';
process.env.OKTA_CLIENT_ID ??= '0oatestclient';
const { config } = await import('../src/config');
const { handleMcpRequest } = await import('../src/mcp/gateway');
const { OktaMcpProcessPool } = await import('../src/mcp/processPool');

// --- A fake Okta org over HTTPS --------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), 'oktamax-verify-'));
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-days',
    '1',
    '-subj',
    '/CN=localhost',
    '-addext',
    'subjectAltName=DNS:localhost',
    '-keyout',
    join(dir, 'key.pem'),
    '-out',
    join(dir, 'cert.pem'),
  ],
  { stdio: 'ignore' },
);

const seen: Array<{ path: string; auth: string | undefined; method: string }> = [];
const okta = createServer(
  { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) },
  (req, res) => {
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, method: req.method ?? '' });
    const login = req.headers.authorization?.includes(jwtFor('ada').split('.')[1]!) ? 'ada' : 'bob';
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify([
        {
          id: `00u${login}`,
          status: 'ACTIVE',
          created: '2026-01-01T00:00:00.000Z',
          profile: {
            login: `seen-by-${login}@example.com`,
            email: `${login}@example.com`,
            firstName: login,
            lastName: 'Test',
          },
        },
      ]),
    );
  },
);
await new Promise<void>((resolve) => okta.listen(0, resolve));
const oktaUrl = `https://localhost:${(okta.address() as AddressInfo).port}`;

// Unsigned JWTs are enough: okta-mcp-server only reads `exp`; the fake org checks the string.
const tokens = new Map<string, string>();
function jwtFor(user: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  if (!tokens.has(user)) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    tokens.set(user, `${b64({ alg: 'none' })}.${b64({ sub: user, exp })}.sig`);
  }
  return tokens.get(user)!;
}
const principal = (user: string) => ({
  userId: `00u${user}`,
  username: `${user}@example.com`,
  token: jwtFor(user),
  // Includes a write scope on purpose: it must not reach the Okta server.
  scopes: ['okta.users.read', 'okta.groups.read', 'okta.users.manage'],
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

// --- Gateway with the real okta-mcp-server --------------------------------------
const pool = new OktaMcpProcessPool({
  ...config.oktaMcp,
  oktaOrgUrl: oktaUrl,
  oktaClientId: 'verify-client',
  env: {
    SSL_CERT_FILE: join(dir, 'cert.pem'),
    ...(process.env.UV_CACHE_DIR ? { UV_CACHE_DIR: process.env.UV_CACHE_DIR } : {}),
    ...(process.env.UV_PYTHON_INSTALL_DIR
      ? { UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR }
      : {}),
  },
});
const app = new Hono().post('/mcp/:user', (c) =>
  handleMcpRequest(c.req.raw, principal(c.req.param('user')), pool),
);
const gateway = serve({ fetch: app.fetch, port: 0 });
await new Promise((resolve) => gateway.once('listening', resolve));
const base = `http://localhost:${(gateway.address() as AddressInfo).port}`;

const as = (user: string) =>
  createMCPClient({ transport: { type: 'http', url: `${base}/mcp/${user}` } });

try {
  const ada = await as('ada');
  const tools = (await ada.listTools()).tools.map((t) => t.name).sort();
  console.log('tools exposed:', tools.join(', '));
  assert.ok(tools.includes('list_users') && tools.includes('list_groups'), 'read tools present');
  assert.ok(
    tools.every((t) => /^(list|get)_/.test(t)),
    'only read tools',
  );
  assert.ok(!tools.includes('create_user'), 'no write tools despite okta.users.manage in token');

  const bob = await as('bob');
  const [adaResult, bobResult] = await Promise.all([
    ada.callTool({ name: 'list_users', arguments: {} }),
    bob.callTool({ name: 'list_users', arguments: {} }),
  ]);
  assert.match(JSON.stringify(adaResult.content), /seen-by-ada/);
  assert.match(JSON.stringify(bobResult.content), /seen-by-bob/);

  const denied = await ada.callTool({ name: 'create_user', arguments: { profile: {} } });
  assert.equal(denied.isError, true, 'write tool call refused');

  const userCalls = seen.filter((s) => s.path.startsWith('/api/v1/users'));
  // okta-mcp-server's SDK (okta 3.4.x) sends "Bearer<token>" without a space; accept both.
  const sentBy = (user: string) => (s: (typeof seen)[number]) =>
    s.auth?.replace(/^Bearer ?/, '') === jwtFor(user);
  assert.ok(userCalls.some(sentBy('ada')), "ada's token used");
  assert.ok(userCalls.some(sentBy('bob')), "bob's token used");
  assert.ok(
    seen.every((s) => s.method === 'GET'),
    'only GETs reached Okta',
  );
  assert.equal(pool.size, 2, 'one process per admin');

  await ada.close();
  await bob.close();
  console.log(`okta calls: ${seen.map((s) => `${s.method} ${s.path}`).join(', ')}`);
  console.log('verified against the real okta-mcp-server');
} finally {
  await pool.closeAll();
  gateway.close();
  okta.close();
}
