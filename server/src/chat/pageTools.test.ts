import { describe, expect, it } from 'vite-plus/test';

import { checkAdminPath, checkApiPath } from '@oktamax/shared/pageTools';

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
