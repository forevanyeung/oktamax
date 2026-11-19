import { describe, expect, it } from 'vite-plus/test';

import {
  checkAdminPath,
  checkApiPath,
  MAX_RESPONSE_CHARS,
  OPEN_IN_API_CONSOLE,
} from '@oktamax/shared/pageTools';

import type { Principal } from '../auth';
import { ToolHooks } from '../mcp/hooks';
import { consoleOutput } from './pageTools';

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

describe('API console output', () => {
  const principal = {
    org: { host: 'acme.okta.com', url: 'https://acme.okta.com', clientId: '0oa1' },
    userId: '00uada',
    username: 'ada@example.com',
    token: 't',
    scopes: [],
    expiresAt: 0,
  } satisfies Principal;
  const none = new ToolHooks();

  it("passes on the console's response", async () => {
    const out = await consoleOutput(
      principal,
      none,
      { path: '/api/v1/iam/roles' },
      { ok: true, status: 200, response: '{"roles":[]}', next: '/api/v1/iam/roles?after=x' },
    );
    expect(out).toEqual({
      ok: true,
      path: '/api/v1/iam/roles',
      status: 200,
      response: '{"roles":[]}',
      next: '/api/v1/iam/roles?after=x',
    });
  });

  it('cuts long responses and drops bad next links', async () => {
    const out = await consoleOutput(
      principal,
      none,
      { path: '/api/v1/logs' },
      {
        ok: true,
        status: 200,
        response: 'x'.repeat(MAX_RESPONSE_CHARS + 10),
        next: 'https://evil.example/',
      },
    );
    expect(out.ok && out.response).toHaveLength(MAX_RESPONSE_CHARS);
    expect(out).toMatchObject({ truncated: true });
    expect(out).not.toHaveProperty('next');
  });

  it('applies the MCP hooks', async () => {
    const response = JSON.stringify({ profile: { mobilePhone: '555-010-0199' } });
    const redacted = await consoleOutput(
      principal,
      await ToolHooks.create([{ type: 'redact' }]),
      { path: '/api/v1/users/00u1' },
      { ok: true, status: 200, response },
    );
    expect(JSON.stringify(redacted)).not.toContain('555-010-0199');

    const blocked = await consoleOutput(
      principal,
      await ToolHooks.create([{ type: 'blockTools', tools: [OPEN_IN_API_CONSOLE] }]),
      { path: '/api/v1/users/00u1' },
      { ok: true, status: 200, response },
    );
    expect(blocked).toMatchObject({ ok: false });
    expect(JSON.stringify(blocked)).not.toContain('555-010-0199');
  });

  it("doesn't take bad paths or outputs", async () => {
    const ok = { ok: true, status: 200, response: '[]' };
    expect(await consoleOutput(principal, none, { path: '/admin/users' }, ok)).toMatchObject({
      ok: false,
    });
    expect(
      await consoleOutput(principal, none, { path: '/api/v1/users' }, { status: 'yes' }),
    ).toMatchObject({ ok: false });
  });
});
