import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { checkAdminPath, checkApiPath, OPEN_IN_API_CONSOLE } from '@oktamax/shared/pageTools';

import type { Principal } from '../auth';
import { ToolHooks } from '../mcp/hooks';
import { MAX_RESPONSE_CHARS, pageTools, type ApiConsoleOutput } from './pageTools';

const LOGS =
  '/api/v1/logs?filter=eventType eq "user.authentication.sso"&since=2026-11-01T00:00:00Z';

describe('page tool paths', () => {
  it('accepts API paths for the API console, as written', () => {
    expect(checkApiPath(LOGS)).toEqual({ ok: true, path: LOGS });
  });

  it('accepts admin console pages for navigation', () => {
    for (const path of [
      '/admin/groups',
      '/admin/group/00g1abcdefghijklmnop',
      '/report/system_log_2',
    ]) {
      expect(checkAdminPath(path)).toEqual({ ok: true, path });
    }
  });

  it('keeps both on the current org', () => {
    for (const path of [
      'https://evil.example/api/v1/users',
      '//evil.example/api/v1/users',
      '/\\evil.example/api/v1/users',
      '/\t/evil.example/api/v1/users',
      'javascript:alert(1)',
      'api/v1/users',
    ]) {
      expect(checkApiPath(path).ok, path).toBe(false);
      expect(checkAdminPath(path).ok, path).toBe(false);
    }
  });

  it("doesn't mix them up", () => {
    expect(checkApiPath('/admin/groups').ok).toBe(false);
    expect(checkAdminPath('/api/v1/users').ok).toBe(false);
    expect(checkAdminPath('/admin/../api/v1/users').ok).toBe(false);
    expect(checkAdminPath('/oauth2/v1/authorize').ok).toBe(false);
  });
});

describe('open_in_api_console', () => {
  const principal = {
    org: { host: 'acme.okta.com', url: 'https://acme.okta.com', clientId: '0oa1' },
    userId: '00uada',
    username: 'ada@example.com',
    token: 'admin-token',
    scopes: [],
    expiresAt: 0,
  } satisfies Principal;

  const run = async (path: string, hooks?: ToolHooks) => {
    const t = pageTools(principal, hooks)[OPEN_IN_API_CONSOLE];
    return (await t.execute!(
      { path },
      { toolCallId: '1', messages: [], context: {} },
    )) as ApiConsoleOutput;
  };

  let requests: Request[] = [];
  let reply: () => Response;
  beforeEach(() => {
    requests = [];
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return reply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the response to the model, sent as the admin', async () => {
    reply = () =>
      Response.json([{ id: '00u1', profile: { login: 'ada@example.com' } }], {
        headers: { link: '<https://acme.okta.com/api/v1/users?after=00u1>; rel="next"' },
      });
    const out = await run('/api/v1/users?limit=1');
    expect(out).toMatchObject({ ok: true, path: '/api/v1/users?limit=1', status: 200 });
    expect(JSON.parse(out.response!)).toEqual([
      { id: '00u1', profile: { login: 'ada@example.com' } },
    ]);
    expect(out.next).toBe('/api/v1/users?after=00u1');
    expect(requests[0]!.url).toBe('https://acme.okta.com/api/v1/users?limit=1');
    expect(requests[0]!.headers.get('authorization')).toBe('Bearer admin-token');
    expect(requests[0]!.method).toBe('GET');
  });

  it('passes errors on', async () => {
    reply = () => Response.json({ errorCode: 'E0000006' }, { status: 403 });
    const out = await run('/api/v1/logs');
    expect(out).toMatchObject({ ok: true, status: 403 });
    expect(out.response).toContain('E0000006');
  });

  it('says which scope the token lacks', async () => {
    const challenge =
      'Bearer realm="IdpRealm", scope="okta.roles.read", error="insufficient_scope", error_description="The access token provided does not contain the required scopes."';
    reply = () => new Response(null, { status: 403, headers: { 'www-authenticate': challenge } });
    const out = await run('/api/v1/iam/roles');
    expect(out).toMatchObject({ ok: true, status: 403, response: '', wwwAuthenticate: challenge });
  });

  it('truncates long responses', async () => {
    reply = () => new Response('x'.repeat(MAX_RESPONSE_CHARS + 10));
    const out = await run('/api/v1/logs');
    expect(out.response).toHaveLength(MAX_RESPONSE_CHARS);
    expect(out.truncated).toBe(true);
  });

  it('applies the MCP hooks', async () => {
    reply = () =>
      Response.json({ profile: { login: 'ada@example.com', mobilePhone: '555-010-0199' } });
    const redacted = await run('/api/v1/users/00u1', await ToolHooks.create([{ type: 'redact' }]));
    expect(redacted.response).not.toContain('555-010-0199');

    const blocked = await run(
      '/api/v1/users/00u1',
      await ToolHooks.create([{ type: 'blockTools', tools: [OPEN_IN_API_CONSOLE] }]),
    );
    expect(blocked.ok).toBe(true);
    expect(blocked.response).toContain('not available');
    expect(requests).toHaveLength(1);
  });

  it("doesn't send bad paths", async () => {
    const out = await run('https://evil.example/api/v1/users');
    expect(out.ok).toBe(false);
    expect(requests).toHaveLength(0);
  });
});
