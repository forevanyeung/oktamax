/**
 * Bearer-token authentication for every API route.
 *
 * Tokens are Okta access tokens from the org authorization server. Those can't
 * be validated locally, so we introspect them (cached briefly) and check they
 * were issued to our OIDC app. The token is then used, unchanged, to call the
 * Okta API as the admin – so Okta enforces both the read-only scopes and the
 * admin's role on every request.
 */
import { createHash } from 'node:crypto';

import { createMiddleware } from 'hono/factory';

import { config } from './config';

export interface Principal {
  /** Okta user ID of the admin. Chats are owned by this ID. */
  userId: string;
  username: string;
  token: string;
  scopes: string[];
  expiresAt: number;
}

interface Introspection {
  active: boolean;
  client_id?: string;
  uid?: string;
  sub?: string;
  username?: string;
  scope?: string;
  exp?: number;
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; principal: Principal | null }>();

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function authenticate(token: string): Promise<Principal | null> {
  const key = hash(token);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.principal;

  const res = await fetch(new URL('/oauth2/v1/introspect', config.oktaOrgUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    // Public (PKCE) clients identify themselves with client_id only.
    body: new URLSearchParams({
      token,
      token_type_hint: 'access_token',
      client_id: config.oktaClientId,
    }),
  });
  const info = (await res.json().catch(() => ({ active: false }))) as Introspection;

  const principal =
    res.ok && info.active && info.client_id === config.oktaClientId && (info.uid ?? info.sub)
      ? {
          userId: (info.uid ?? info.sub)!,
          username: info.username ?? info.sub ?? '',
          token,
          scopes: info.scope?.split(' ') ?? [],
          expiresAt: info.exp ?? 0,
        }
      : null;

  cache.set(key, { at: Date.now(), principal });
  return principal;
}

/** Hono middleware: 401 unless the request carries a valid token. Sets `c.var.principal`. */
export const requireAuth = createMiddleware<{ Variables: { principal: Principal } }>(
  async (c, next) => {
    const token = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const principal = token ? await authenticate(token) : null;
    if (!principal) return c.json({ error: 'unauthorized' }, 401);
    c.set('principal', principal);
    await next();
  },
);
