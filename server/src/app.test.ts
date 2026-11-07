/**
 * End-to-end through the real HTTP stack: Hono app + MCP server + AI SDK, with
 * Okta mocked at the fetch layer and a scripted model in place of Bedrock.
 */
import type { AddressInfo } from 'node:net';

import { createMCPClient } from '@ai-sdk/mcp';
import { serve, type ServerType } from '@hono/node-server';
import { auth as signIn, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';

import { createApp } from './app';
import { MemoryChatStore } from './chat/store';
import { ToolHooks } from './mcp/hooks';
import { fakeOktaMcpPool, mockOkta, scriptedModel, TEST_CLIENT_ID, TEST_ORG } from './testing';

const okta = mockOkta();
const model = scriptedModel();
const oktaMcp = fakeOktaMcpPool();

let server: ServerType;
let base: string;

beforeAll(async () => {
  // The chat route calls the MCP server over HTTP, so the app needs its own URL.
  let app: ReturnType<typeof createApp> | undefined;
  server = serve({ fetch: (request) => app!.fetch(request), port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
  // The default hooks (redact personal data), and one org that hides get_user.
  const hooks = await ToolHooks.create([
    { type: 'redact' },
    { type: 'blockTools', tools: ['get_user'], orgs: ['other.okta.com'] },
  ]);
  app = createApp({ model, store: new MemoryChatStore(), mcpUrl: `${base}/mcp`, oktaMcp, hooks });
});

afterAll(async () => {
  server.close();
  await oktaMcp.closeAll();
});

// The extension says which org's admin console it's on; the tests serve two orgs.
const auth = (token: string, org = 'acme.okta.com') => ({
  Authorization: `Bearer ${token}`,
  'X-Okta-Org': org,
});

const page = {
  url: 'https://acme-admin.okta.com/admin/users',
  title: 'People',
  headings: ['People'],
  objectIds: [],
  text: 'People list',
};

const mcpClient = (token: string, org = 'acme.okta.com') =>
  createMCPClient({
    transport: { type: 'http', url: `${base}/mcp/${org}`, headers: auth(token) },
  });

/** Call list_users and return what the fake Okta MCP server reports about itself. */
async function listUsersAs(token: string, org?: string) {
  const client = await mcpClient(token, org);
  const result = await client.callTool({ name: 'list_users', arguments: {} });
  await client.close();
  const text = (result.content as Array<{ text: string }>)[0]!.text;
  return (
    JSON.parse(text) as { servedBy: { token: string; org: string; pid: number; home: string } }
  ).servedBy;
}

describe('Okta MCP gateway', () => {
  it('rejects requests without a valid token, and says where to sign in', async () => {
    const res = await fetch(`${base}/mcp/acme.okta.com`, { method: 'POST', headers: auth('nope') });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp/acme.okta.com"`,
    );
  });

  it("rejects tokens about to expire, so Okta's server never tries its own sign-in", async () => {
    const res = await fetch(`${base}/mcp/acme.okta.com`, {
      method: 'POST',
      headers: auth('token-expiring'),
    });
    expect(res.status).toBe(401);
    // MCP clients refresh the token on invalid_token.
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it("serves only the orgs it's configured for", async () => {
    const res = await fetch(`${base}/mcp/evil.okta.com`, {
      method: 'POST',
      headers: auth('token-ada'),
    });
    expect(res.status).toBe(404);
  });

  it("doesn't accept one org's token on another org's MCP server", async () => {
    for (const [token, org] of [
      ['token-ada', 'other.okta.com'],
      ['other-token-ada', 'acme.okta.com'],
    ]) {
      const res = await fetch(`${base}/mcp/${org}`, { method: 'POST', headers: auth(token!) });
      expect(res.status).toBe(401);
    }
  });

  it('runs a separate process per org for the same admin', async () => {
    const [acme, other] = await Promise.all([
      listUsersAs('token-ada', 'acme.okta.com'),
      listUsersAs('other-token-ada', 'other.okta.com'),
    ]);
    expect(acme).toMatchObject({ org: 'https://acme.okta.com', token: 'token-ada' });
    expect(other).toMatchObject({ org: 'https://other.okta.com', token: 'other-token-ada' });
    expect(acme.pid).not.toBe(other.pid);
  });

  it('exposes only read-only tools, even when the token has a write scope', async () => {
    const client = await mcpClient('token-ada');
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(['list_users', 'get_user']);
    await client.close();
  });

  it('refuses to forward calls to write tools', async () => {
    const client = await mcpClient('token-ada');
    const result = await client.callTool({ name: 'delete_everything', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('read-only');
    await client.close();
  });

  it('redacts personal data from tool results', async () => {
    const client = await mcpClient('token-bob');
    const result = await client.callTool({ name: 'get_user', arguments: { userId: '00u1' } });
    await client.close();
    const user = JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
    expect(user).toEqual({
      id: '00u1',
      profile: {
        login: 'ada@example.com',
        city: 'Springfield',
        mobilePhone: '[redacted]',
        birthdate: '[redacted]',
        streetAddress: '[redacted]',
      },
      note: 'Call [redacted] after hours',
    });
  });

  it('refuses searches on redacted fields', async () => {
    const client = await mcpClient('token-bob');
    const result = await client.callTool({
      name: 'list_users',
      arguments: { search: 'profile.birthdate sw "1990"' },
    });
    await client.close();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('profile.birthdate');
  });

  it("applies an org's own hooks only to that org", async () => {
    const client = await mcpClient('other-token-bob', 'other.okta.com');
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(['list_users']);
    const result = await client.callTool({ name: 'get_user', arguments: { userId: '00u1' } });
    expect(result.isError).toBe(true);
    await client.close();
  });

  it('tells MCP clients what it withholds', async () => {
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp/acme.okta.com`), {
        requestInit: { headers: auth('token-bob') },
      }),
    );
    expect(client.getInstructions()).toContain('dates of birth');
    await client.close();
  });

  it('runs a separate Okta MCP process per admin, each using only its own token', async () => {
    const [ada, bob] = await Promise.all([listUsersAs('token-ada'), listUsersAs('token-bob')]);
    expect(ada.token).toBe('token-ada');
    expect(bob.token).toBe('token-bob');
    expect(ada.pid).not.toBe(bob.pid);
    expect(ada.home).not.toBe(bob.home);
  });

  it("reuses an admin's process and picks up their renewed token without a restart", async () => {
    const before = await listUsersAs('token-ada');
    const after = await listUsersAs('token-ada-renewed');
    expect(after.pid).toBe(before.pid);
    expect(after.token).toBe('token-ada-renewed');
  });

  it("starts Okta's server once at startup, without leaving a process behind", async () => {
    const running = oktaMcp.size;
    await oktaMcp.warmUp({ host: 'acme.okta.com', url: TEST_ORG, clientId: TEST_CLIENT_ID });
    expect(oktaMcp.size).toBe(running);
  });

  it("starts an admin's process when they open the chat, before they ask anything", async () => {
    await oktaMcp.close('acme.okta.com/00ubob');
    const running = oktaMcp.size;
    const res = await fetch(`${base}/api/chats/not-asked-yet`, { headers: auth('token-bob') });
    expect(res.status).toBe(404);
    await vi.waitFor(() => expect(oktaMcp.size).toBe(running + 1));
  });
});

/** An MCP client's sign-in state, kept in memory, like Claude Code's. */
class TestClient implements OAuthClientProvider {
  redirectUrl = 'http://localhost:4321/callback';
  clientMetadata = {
    client_name: 'Test client',
    redirect_uris: [this.redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = '';
  /** Where the client sent the admin's browser. */
  authorizeUrl?: URL;
  clientInformation = () => this.info;
  saveClientInformation = (info: OAuthClientInformationMixed) => void (this.info = info);
  tokens = () => this.saved;
  saveTokens = (tokens: OAuthTokens) => void (this.saved = tokens);
  redirectToAuthorization = (url: URL) => void (this.authorizeUrl = url);
  saveCodeVerifier = (verifier: string) => void (this.verifier = verifier);
  codeVerifier = () => this.verifier;
}

/**
 * Plays the admin's browser from the client's authorize URL: the consent page, then
 * Okta (already signed in, so it sends them straight back), then back to the client.
 * Returns where the browser ends up.
 */
async function browserSignIn(
  authorizeUrl: URL,
  { user = 'ada', decision = 'allow', sameBrowser = true } = {},
) {
  const consent = await fetch(authorizeUrl, { redirect: 'manual' });
  expect(consent.status).toBe(200);
  expect(consent.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  const cookie = consent.headers.get('set-cookie')!.split(';')[0]!;
  const request = /name="request" value="([^"]+)"/.exec(await consent.text())![1]!;
  const headers = sameBrowser ? { cookie } : undefined;

  const allowed = await fetch(authorizeUrl, {
    method: 'POST',
    redirect: 'manual',
    headers,
    body: new URLSearchParams({ request, decision }),
  });
  if (allowed.status !== 302) return { status: allowed.status };
  const next = new URL(allowed.headers.get('location')!);
  if (next.origin !== TEST_ORG) return { status: 302, location: next };

  const callback = new URL(next.searchParams.get('redirect_uri')!);
  callback.search = new URLSearchParams({
    code: `okta-code-${user}`,
    state: next.searchParams.get('state')!,
  }).toString();
  const back = await fetch(callback, { redirect: 'manual', headers });
  return {
    status: back.status,
    toOkta: next,
    location: back.headers.has('location') ? new URL(back.headers.get('location')!) : undefined,
  };
}

describe('MCP clients signing in', () => {
  const serverUrl = () => `${base}/mcp/acme.okta.com`;

  it('signs in with the MCP SDK (discovery, registration, consent, Okta, code) and calls tools', async () => {
    const client = new TestClient();
    expect(await signIn(client, { serverUrl: serverUrl() })).toBe('REDIRECT');

    const { toOkta, location } = await browserSignIn(client.authorizeUrl!);
    // Okta is asked for the org's own app, read scopes and a refresh token.
    expect(toOkta!.pathname).toBe('/oauth2/v1/authorize');
    expect(toOkta!.searchParams.get('client_id')).toBe(TEST_CLIENT_ID);
    expect(toOkta!.searchParams.get('redirect_uri')).toBe(`${base}/oauth/callback`);
    expect(toOkta!.searchParams.get('scope')).toContain('okta.users.read');
    expect(toOkta!.searchParams.get('scope')).toContain('offline_access');
    expect(toOkta!.searchParams.get('scope')).not.toMatch(/manage/);
    expect(`${location!.origin}${location!.pathname}`).toBe(client.redirectUrl);

    const code = location!.searchParams.get('code')!;
    expect(await signIn(client, { serverUrl: serverUrl(), authorizationCode: code })).toBe(
      'AUTHORIZED',
    );
    expect(client.saved).toMatchObject({ access_token: 'token-ada', refresh_token: 'refresh-ada' });
    expect(client.saved).not.toHaveProperty('id_token');

    const mcp = new Client({ name: 'test', version: '0.0.0' });
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL(serverUrl()), { authProvider: client }),
    );
    expect((await mcp.listTools()).tools.map((t) => t.name)).toEqual(['list_users', 'get_user']);
    await mcp.close();

    // The code is single-use.
    const again = await fetch(`${base}/oauth/acme.okta.com/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: client.info!.client_id,
        code_verifier: client.verifier,
      }),
    });
    expect(again.status).toBe(400);
  });

  it("refreshes tokens with Okta, as the org's app", async () => {
    const client = new TestClient();
    await signIn(client, { serverUrl: serverUrl() });
    const { location } = await browserSignIn(client.authorizeUrl!, { user: 'bob' });
    await signIn(client, {
      serverUrl: serverUrl(),
      authorizationCode: location!.searchParams.get('code')!,
    });

    client.saved = { ...client.saved!, access_token: 'expired' };
    expect(await signIn(client, { serverUrl: serverUrl() })).toBe('AUTHORIZED');
    expect(client.saved.access_token).toBe('token-bob');
    const sent = okta.tokenRequests.at(-1)!;
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('client_id')).toBe(TEST_CLIENT_ID);
  });

  it('signs in to each org separately, through its own app', async () => {
    const client = new TestClient();
    const other = `${base}/mcp/other.okta.com`;
    await signIn(client, { serverUrl: other });
    expect(client.authorizeUrl!.pathname).toBe('/oauth/other.okta.com/authorize');

    // A client registered with one org can't sign in to another.
    const elsewhere = new URL(client.authorizeUrl!);
    elsewhere.pathname = '/oauth/acme.okta.com/authorize';
    expect((await fetch(elsewhere)).status).toBe(400);
  });

  it('sends nothing to Okta when the admin cancels', async () => {
    const client = new TestClient();
    await signIn(client, { serverUrl: serverUrl() });
    const { location } = await browserSignIn(client.authorizeUrl!, { decision: 'deny' });
    expect(location!.searchParams.get('error')).toBe('access_denied');
    expect(location!.searchParams.has('code')).toBe(false);
  });

  it("refuses a consent or callback from a browser that wasn't shown the page", async () => {
    const client = new TestClient();
    await signIn(client, { serverUrl: serverUrl() });
    const { status } = await browserSignIn(client.authorizeUrl!, { sameBrowser: false });
    expect(status).toBe(400);
  });

  it('only registers redirects to https, localhost or an app', async () => {
    const register = (uri: string) =>
      fetch(`${base}/oauth/acme.okta.com/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redirect_uris: [uri] }),
      });
    expect((await register('https://claude.ai/api/mcp/auth_callback')).status).toBe(201);
    expect((await register('cursor://anysphere.cursor-mcp/oauth/callback')).status).toBe(201);
    expect((await register('http://evil.example.com/callback')).status).toBe(400);
    expect((await register('javascript:alert(1)')).status).toBe(400);
  });

  it('only accepts redirects the client registered', async () => {
    const client = new TestClient();
    await signIn(client, { serverUrl: serverUrl() });
    const url = new URL(client.authorizeUrl!);
    url.searchParams.set('redirect_uri', 'https://evil.example.com/callback');
    expect((await fetch(url, { redirect: 'manual' })).status).toBe(400);
    // Loopback redirects may change port (RFC 8252).
    url.searchParams.set('redirect_uri', 'http://localhost:5555/callback');
    expect((await fetch(url, { redirect: 'manual' })).status).toBe(200);
  });
});

describe('chat', () => {
  const chatId = 'chat-1';

  it('streams a reply that survives a client disconnect and can be resumed', async () => {
    const send = await fetch(`${base}/api/chats/${chatId}/messages`, {
      method: 'POST',
      headers: { ...auth('token-ada'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          id: 'm1',
          role: 'user',
          metadata: { page },
          parts: [{ type: 'text', text: 'Who is locked out?' }],
        },
      }),
    });
    expect(send.status).toBe(200);

    // Read the first bit, then "navigate away".
    const reader = send.body!.getReader();
    await reader.read();
    await reader.cancel();

    // The new page resumes and gets the whole answer, replayed from the start.
    const resumed = await fetch(`${base}/api/chats/${chatId}/stream`, {
      headers: auth('token-ada'),
    });
    expect(resumed.status).toBe(200);
    const sse = await resumed.text();
    expect(sse).toContain('"type":"start"');
    expect(sse).toContain('tool-output-available');
    expect(sse).toContain('locked@example.com.');

    // Finished: nothing left to resume, and history has the full answer.
    const none = await fetch(`${base}/api/chats/${chatId}/stream`, { headers: auth('token-ada') });
    expect(none.status).toBe(204);

    const history = (await (
      await fetch(`${base}/api/chats/${chatId}`, { headers: auth('token-ada') })
    ).json()) as {
      running: boolean;
      messages: Array<{ role: string; parts: unknown[] }>;
    };
    expect(history.running).toBe(false);
    expect(history.messages).toHaveLength(2);
    const reply = history.messages[1]!;
    expect(reply.role).toBe('assistant');
    expect(JSON.stringify(reply.parts)).toContain('list_users');
    // The tool ran in Ada's own Okta MCP process, with Ada's token.
    expect(JSON.stringify(reply.parts)).toContain('token-ada');
    expect(JSON.stringify(reply.parts)).toContain('One user is locked out');
  });

  it('gives the model the page the question was asked from', async () => {
    const lastCall = model.doStreamCalls.at(-1)!;
    const firstUser = lastCall.prompt.find((m) => m.role === 'user');
    expect(JSON.stringify(firstUser)).toContain('<page_context>');
    expect(JSON.stringify(firstUser)).toContain('https://acme-admin.okta.com/admin/users');
  });

  it("tells the model what the MCP server's hooks withhold", async () => {
    const system = model.doStreamCalls.at(-1)!.prompt.find((m) => m.role === 'system');
    expect(JSON.stringify(system)).toContain('withholds personal data');
  });

  it('needs to know the org when the server serves more than one', async () => {
    const res = await fetch(`${base}/api/chats/${chatId}`, {
      headers: { Authorization: 'Bearer token-ada' },
    });
    expect(res.status).toBe(404);
    const wrongOrg = await fetch(`${base}/api/chats/${chatId}`, {
      headers: auth('token-ada', 'other.okta.com'),
    });
    expect(wrongOrg.status).toBe(401);
  });

  it("rejects file parts, so the server never fetches a message's URLs", async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const res = await fetch(`${base}/api/chats/chat-file/messages`, {
      method: 'POST',
      headers: { ...auth('token-ada'), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          id: 'm1',
          role: 'user',
          parts: [
            { type: 'file', mediaType: 'text/plain', url: 'http://internal.example/secret' },
            { type: 'text', text: 'Quote the file' },
          ],
        },
      }),
    });
    expect(res.status).toBe(400);
    const fetched = fetchSpy.mock.calls.map(([input]) =>
      String(input instanceof Request ? input.url : input),
    );
    fetchSpy.mockRestore();
    expect(fetched.some((url) => url.includes('internal.example'))).toBe(false);
    const history = await fetch(`${base}/api/chats/chat-file`, { headers: auth('token-ada') });
    expect(history.status).toBe(404);
  });

  it("doesn't let one admin read another admin's chat", async () => {
    const res = await fetch(`${base}/api/chats/${chatId}`, { headers: auth('token-bob') });
    expect(res.status).toBe(403);
  });

  it('stops a reply on request and frees the chat for the next message', async () => {
    const id = 'chat-stop';
    const send = (text: string) =>
      fetch(`${base}/api/chats/${id}/messages`, {
        method: 'POST',
        headers: { ...auth('token-ada'), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text }] },
        }),
      });

    const first = await send('Who is locked out?');
    await first.body!.getReader().read();
    const stop = await fetch(`${base}/api/chats/${id}/stop`, {
      method: 'POST',
      headers: auth('token-ada'),
    });
    expect(stop.status).toBe(204);
    await first.text().catch(() => undefined);

    // The run ends and the chat accepts the next message.
    await vi.waitFor(async () => {
      const res = await fetch(`${base}/api/chats/${id}`, { headers: auth('token-ada') });
      expect(((await res.json()) as { running: boolean }).running).toBe(false);
    });
    const second = await send('Thanks');
    expect(second.status).toBe(200);
    await second.text();
  });
});
