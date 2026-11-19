/**
 * Whether the admin is still signed in to the admin console the page is on.
 *
 * The API console and the assistant act as the admin (with the console's own
 * session, or a token from it), so both are hidden once that session ends: signed
 * out in another tab, or expired after the org's idle or maximum session time.
 * They come back when the admin signs in again.
 *
 * `GET /api/v1/sessions/me` gives the session's expiry without extending it, so
 * the check runs again right when the session is due to end, and whenever the tab
 * comes back into view. Nothing is polled: requests that count as activity would
 * keep an idle session alive past the org's idle timeout.
 */
import { useEffect, useState } from 'react';

export type ConsoleSession =
  /** Signed in. `expiresAt` is when the session ends unless the admin is active, if known. */
  { state: 'active'; expiresAt?: number } | { state: 'expired' };

type Fetch = (path: string) => Promise<Response>;

const sameOriginGet: Fetch = (path) =>
  fetch(new URL(path, location.origin), {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

/**
 * The console session's state. Network errors count as active: the chat can't
 * reach Okta either then, and says so itself.
 */
export async function checkConsoleSession(get: Fetch = sameOriginGet): Promise<ConsoleSession> {
  try {
    const res = await get('/api/v1/sessions/me');
    if (res.ok) {
      const { status, expiresAt } = (await res.json()) as { status?: string; expiresAt?: string };
      if (status && status !== 'ACTIVE') return { state: 'expired' };
      const time = expiresAt ? Date.parse(expiresAt) : NaN;
      return { state: 'active', expiresAt: Number.isNaN(time) ? undefined : time };
    }
    // No session on this host's cookie (some admin consoles keep theirs elsewhere): ask an
    // endpoint any signed-in admin can read. Okta answers 401/403 without a valid session.
    const me = await get('/api/v1/users/me');
    if (me.status === 401 || me.status === 403) return { state: 'expired' };
    return { state: 'active' };
  } catch {
    return { state: 'active' };
  }
}

/** Checks again shortly after the session's expiry, giving Okta's clock a moment. */
const EXPIRY_GRACE_MS = 5_000;
/** setTimeout fires at once past 2^31-1 ms. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** The console session, undefined until the first check answers. */
export function useConsoleSession(): ConsoleSession | undefined {
  const [session, setSession] = useState<ConsoleSession>();

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let checking = false;

    const check = async () => {
      if (checking) return;
      checking = true;
      const next = await checkConsoleSession();
      checking = false;
      if (cancelled) return;
      setSession(next);
      clearTimeout(timer);
      if (next.state === 'active' && next.expiresAt !== undefined) {
        const delay = Math.min(next.expiresAt - Date.now() + EXPIRY_GRACE_MS, MAX_TIMEOUT_MS);
        timer = window.setTimeout(() => void check(), Math.max(delay, EXPIRY_GRACE_MS));
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };

    void check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  return session;
}
