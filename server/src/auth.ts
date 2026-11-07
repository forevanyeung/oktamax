/**
 * Bearer-token authentication for every API route.
 *
 * Tokens are Okta access tokens from an org's authorization server. Those can't
 * be validated locally, so we introspect them (cached briefly) at the org the
 * request is for, and check they were issued to that org's OIDC app. A token
 * from one org is never accepted for another. The token is then used, unchanged, to call the
 * Okta API as the admin – so Okta enforces both the read-only scopes and the
 * admin's role on every request.
 */
import { createHash } from 'node:crypto';

import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';

import { config, type OktaOrg } from './config';

export interface Principal {
  /** The org the token is from. */
  org: OktaOrg;
  /** Okta user ID of the admin. */
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
/** Most introspections remembered at once: anyone can present a token. */
const MAX_CACHED = 10_000;
/** Oldest first: entries are deleted before they're set again, so they stay in time order. */
const cache = new Map<string, { at: number; principal: Principal | null }>();

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Identifies an admin across orgs: chats and Okta MCP processes are keyed by it. */
export const principalKey = (p: Principal) => `${p.org.host}/${p.userId}`;

export async function authenticate(org: OktaOrg, token: string): Promise<Principal | null> {
  const key = `${org.host} ${hash(token)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.principal;

  const res = await fetch(new URL('/oauth2/v1/introspect', org.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    // Public (PKCE) clients identify themselves with client_id only.
    body: new URLSearchParams({
      token,
      token_type_hint: 'access_token',
      client_id: org.clientId,
    }),
  });
  const info = (await res.json().catch(() => null)) as Introspection | null;

  const principal =
    res.ok && info?.active && info.client_id === org.clientId && (info.uid ?? info.sub)
      ? {
          org,
          userId: (info.uid ?? info.sub)!,
          username: info.username ?? info.sub ?? '',
          token,
          scopes: info.scope?.split(' ') ?? [],
          expiresAt: info.exp ?? 0,
        }
      : null;

  // Only Okta's answer is remembered: a 429, 5xx or garbled reply is retried next time.
  if (!res.ok || typeof info?.active !== 'boolean') return principal;
  const now = Date.now();
  cache.delete(key);
  // Drop expired entries, then the oldest while full.
  for (const [k, v] of cache) {
    if (now - v.at < CACHE_MS && cache.size < MAX_CACHED) break;
    cache.delete(k);
  }
  cache.set(key, { at: now, principal });
  return principal;
}

type AuthEnv = { Variables: { principal: Principal } };

/**
 * Hono middleware: 401 unless the request carries a valid token for the org it's for.
 * Sets `c.var.principal`. `orgOf` picks the org (undefined: 404); `unauthorized` builds the 401.
 */
export const requireAuth = (
  orgOf: (c: Context<AuthEnv>) => OktaOrg | undefined,
  unauthorized: (c: Context<AuthEnv>, org: OktaOrg) => Response = (c) =>
    c.json({ error: 'unauthorized' }, 401),
) =>
  createMiddleware<AuthEnv>(async (c, next) => {
    const org = orgOf(c);
    if (!org) return c.json({ error: 'unknown_org' }, 404);
    const token = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const principal = token ? await authenticate(org, token) : null;
    if (!principal) return unauthorized(c, org);
    c.set('principal', principal);
    await next();
  });

/**
 * The org of an extension request: the `X-Okta-Org` header (acme.okta.com), or the
 * only org when the server has one.
 */
export const orgFromHeader = (c: Context) => {
  const host = c.req.header('x-okta-org');
  if (host) return config.org(host);
  return config.orgs.length === 1 ? config.orgs[0] : undefined;
};
