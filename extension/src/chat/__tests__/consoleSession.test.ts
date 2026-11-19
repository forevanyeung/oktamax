import { describe, expect, it } from 'vite-plus/test';

import { checkConsoleSession } from '../consoleSession';

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

/** A fake same-origin GET answering each path with a fixed response. */
const answers =
  (byPath: Record<string, () => Response | Promise<Response>>) => async (path: string) => {
    const answer = byPath[path];
    if (!answer) throw new Error(`Unexpected request: ${path}`);
    return answer();
  };

describe('checkConsoleSession', () => {
  it('is active with its expiry while the session is', async () => {
    const get = answers({
      '/api/v1/sessions/me': () =>
        json(200, { status: 'ACTIVE', expiresAt: '2026-11-18T12:00:00.000Z' }),
    });
    expect(await checkConsoleSession(get)).toEqual({
      state: 'active',
      expiresAt: Date.parse('2026-11-18T12:00:00.000Z'),
    });
  });

  it('is expired when the session is no longer active', async () => {
    const get = answers({ '/api/v1/sessions/me': () => json(200, { status: 'MFA_REQUIRED' }) });
    expect(await checkConsoleSession(get)).toEqual({ state: 'expired' });
  });

  it('is expired when there is no session and Okta refuses the admin', async () => {
    for (const status of [401, 403]) {
      const get = answers({
        '/api/v1/sessions/me': () => json(404, { errorCode: 'E0000007' }),
        '/api/v1/users/me': () => json(status, { errorCode: 'E0000005' }),
      });
      expect(await checkConsoleSession(get)).toEqual({ state: 'expired' });
    }
  });

  it('is active without an expiry when only the admin can be read', async () => {
    const get = answers({
      '/api/v1/sessions/me': () => json(404),
      '/api/v1/users/me': () => json(200, { id: '00u1' }),
    });
    expect(await checkConsoleSession(get)).toEqual({ state: 'active' });
  });

  it('stays active when Okta cannot be reached', async () => {
    const get = answers({
      '/api/v1/sessions/me': () => Promise.reject(new TypeError('Failed to fetch')),
    });
    expect(await checkConsoleSession(get)).toEqual({ state: 'active' });
  });
});
