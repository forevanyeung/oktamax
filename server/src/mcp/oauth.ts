/**
 * Sign-in for MCP clients (Claude Code, Claude Desktop, Cursor, ...) that use the
 * per-org MCP servers at `/mcp/<org host>` directly, following the MCP
 * authorization spec:
 *
 *   GET  /.well-known/oauth-protected-resource/mcp/<org>     which server signs in for it
 *   GET  /.well-known/oauth-authorization-server/oauth/<org> that server's endpoints
 *   POST /oauth/<org>/register    dynamic client registration
 *   GET  /oauth/<org>/authorize   consent page, then on to the org's Okta
 *   GET  /oauth/callback          back from Okta (one redirect URI for every org)
 *   POST /oauth/<org>/token       authorization code and refresh token grants
 *
 * Okta's org authorization server can't register clients on the fly, and each
 * client signs in with its own redirect URI. So this server stands in as each
 * org's authorization server: clients register here, and admins sign in to
 * Okta with the org's existing OIDC app, through this server's callback. The
 * client gets Okta's own access token (read scopes only), the same kind the
 * extension holds, so `/mcp/<org>` checks it the same way.
 *
 * Every client gets its own consent page before Okta is asked: otherwise anyone
 * could register a client and, with a link, have an admin's silent Okta sign-in
 * send a token to them. The consent and Okta's callback must happen in the
 * browser that saw the page (a cookie checks it).
 *
 * Client IDs carry the registration, signed, so nothing is stored for them.
 * Pending sign-ins and codes are kept in memory for 10 minutes.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';

import { OKTA_SCOPES } from '@oktamax/shared';

import { config, type OktaOrg } from '../config';

const TTL_MS = 10 * 60_000;
/** Most sign-ins waiting at once: anyone can start one. */
const MAX_PENDING = 10_000;

const publicUrl = (c: Context) => config.publicUrl ?? new URL(c.req.url).origin;
const issuer = (c: Context, org: OktaOrg) => `${publicUrl(c)}/oauth/${org.host}`;
/** The org's MCP server: the `resource` its tokens are for. */
export const resourceUrl = (c: Context, org: OktaOrg) => `${publicUrl(c)}/mcp/${org.host}`;
const callbackUrl = (c: Context) => `${publicUrl(c)}/oauth/callback`;

/** The 401 that tells an MCP client where to sign in. */
export const signInChallenge = (c: Context, org: OktaOrg, error?: string) => {
  const metadata = `${publicUrl(c)}/.well-known/oauth-protected-resource/mcp/${org.host}`;
  const params = [`resource_metadata="${metadata}"`, ...(error ? [`error="${error}"`] : [])];
  return c.json({ error: error ?? 'unauthorized' }, 401, {
    'WWW-Authenticate': `Bearer ${params.join(', ')}`,
  });
};

// --- Client registrations, in the client ID ---------------------------------------

interface Client {
  org: string;
  name?: string;
  redirectUris: string[];
}

const secret = config.oauthSecret ? Buffer.from(config.oauthSecret) : randomBytes(32);
const sign = (data: string) => createHmac('sha256', secret).update(data).digest('base64url');

const encodeClient = (client: Client) => {
  const data = Buffer.from(JSON.stringify(client)).toString('base64url');
  return `${data}.${sign(data)}`;
};

function decodeClient(clientId: string | undefined, org: OktaOrg): Client | undefined {
  const [data, mac] = clientId?.split('.') ?? [];
  if (!data || !mac) return undefined;
  const expected = Buffer.from(sign(data));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  const client = JSON.parse(Buffer.from(data, 'base64url').toString()) as Client;
  // A client registered for one org can't sign in to another.
  return client.org === org.host ? client : undefined;
}

const isLoopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
const UNSAFE_SCHEMES = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:'];

/** https, http on loopback, or an app's own scheme (cursor://...); never a fragment. */
function isAllowedRedirect(uri: unknown) {
  if (typeof uri !== 'string' || !URL.canParse(uri)) return false;
  const url = new URL(uri);
  if (url.hash || UNSAFE_SCHEMES.includes(url.protocol)) return false;
  return url.protocol !== 'http:' || isLoopback(url);
}

/** Exact match, except that loopback redirects may use any port (RFC 8252). */
function matchesRedirect(registered: string, requested: string) {
  if (registered === requested) return true;
  if (!URL.canParse(requested)) return false;
  const [a, b] = [new URL(registered), new URL(requested)];
  if (!isLoopback(a) || a.protocol !== 'http:') return false;
  a.port = b.port;
  return a.href === b.href;
}

// --- Pending sign-ins and codes -----------------------------------------------------

interface PendingSignIn {
  org: OktaOrg;
  clientId: string;
  redirectUri: string;
  state?: string;
  codeChallenge: string;
  /** The value of this sign-in's cookie, set in the browser that saw the consent page. */
  browser: string;
  /** PKCE verifier for the sign-in to Okta. */
  oktaVerifier: string;
  expires: number;
}

interface OktaTokens {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
}

interface Grant {
  org: OktaOrg;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  tokens: OktaTokens;
  expires: number;
}

const pending = new Map<string, PendingSignIn>();
const grants = new Map<string, Grant>();

/** Removes and returns an unexpired entry; drops expired ones along the way. */
function take<T extends { expires: number }>(map: Map<string, T>, key: string | undefined) {
  const now = Date.now();
  for (const [k, v] of map) if (v.expires < now) map.delete(k);
  const value = key ? map.get(key) : undefined;
  if (key) map.delete(key);
  return value;
}

const random = () => randomBytes(32).toString('base64url');
const s256 = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');
const cookieName = (id: string) => `oauth_${id.slice(0, 16)}`;

/** Sends the browser back to the client with `params` (a code, or an error). */
function backToClient(c: Context, redirectUri: string, params: Record<string, string | undefined>) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return c.redirect(url.href);
}

/** The token response for clients: Okta's tokens, without the ID token. */
const forClient = (t: OktaTokens) => ({
  access_token: t.access_token,
  token_type: 'Bearer',
  expires_in: t.expires_in,
  scope: t.scope,
  ...(t.refresh_token ? { refresh_token: t.refresh_token } : {}),
});

/** Calls the org's Okta token endpoint as its OIDC app (a public client: no secret). */
async function oktaToken(org: OktaOrg, params: Record<string, string>) {
  const res = await fetch(new URL('/oauth2/v1/token', org.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: org.clientId, ...params }),
  });
  const body = (await res.json().catch(() => ({}))) as Partial<OktaTokens> & {
    error?: string;
    error_description?: string;
  };
  if (res.ok && body.access_token) return { tokens: body as OktaTokens };
  return {
    error: body.error ?? 'server_error',
    description: body.error_description ?? `Okta returned ${res.status}`,
  };
}

const tokenError = (c: Context, error: string, description?: string) =>
  c.json({ error, ...(description ? { error_description: description } : {}) }, 400, {
    'Cache-Control': 'no-store',
  });

// --- Pages -------------------------------------------------------------------------

const PAGE_HEADERS = {
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Cache-Control': 'no-store',
};

const STYLE = `
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; padding: 0 1rem; color: #1d1d21; }
  h1 { font-size: 1.3rem; }
  code { background: #f1f1f4; padding: 0 .25rem; border-radius: 3px; }
  .buttons { display: flex; gap: .5rem; margin-top: 1.5rem; }
  button { font: inherit; padding: .5rem 1.1rem; border-radius: 6px; border: 1px solid #c4c4cc; background: #fff; cursor: pointer; }
  button[value=allow] { background: #1662dd; border-color: #1662dd; color: #fff; }
  .note { color: #5e5e6a; font-size: 13px; }
`;

const errorPage = (c: Context, message: string) =>
  c.html(
    html`<!doctype html>
      <title>Okta Max</title>
      <style>
        ${STYLE}
      </style>
      <h1>Can’t sign in</h1>
      <p>${message}</p>`,
    400,
    PAGE_HEADERS,
  );

/** Where the client sends the admin back to, said plainly. */
function destination(redirectUri: string) {
  const url = new URL(redirectUri);
  if (isLoopback(url)) return `an app on this computer (${url.host})`;
  return url.protocol === 'https:' ? url.host : `the app that opens ${url.protocol}// links`;
}

// --- Routes ------------------------------------------------------------------------

export function createOAuthRoutes() {
  const routes = new Hono();
  const orgOf = (c: Context) => config.org(c.req.param('org') ?? '');

  routes.get('/.well-known/oauth-protected-resource/mcp/:org', (c) => {
    const org = orgOf(c);
    if (!org) return c.json({ error: 'unknown_org' }, 404);
    return c.json({
      resource: resourceUrl(c, org),
      authorization_servers: [issuer(c, org)],
      bearer_methods_supported: ['header'],
      resource_name: `Okta ${org.host} (read-only)`,
    });
  });

  routes.get('/.well-known/oauth-authorization-server/oauth/:org', (c) => {
    const org = orgOf(c);
    if (!org) return c.json({ error: 'unknown_org' }, 404);
    const base = issuer(c, org);
    return c.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true,
    });
  });

  routes.post('/oauth/:org/register', async (c) => {
    const org = orgOf(c);
    if (!org) return c.json({ error: 'unknown_org' }, 404);
    const body = (await c.req.json().catch(() => ({}))) as {
      redirect_uris?: unknown;
      client_name?: unknown;
    };
    const redirectUris = body.redirect_uris;
    if (
      !Array.isArray(redirectUris) ||
      !redirectUris.length ||
      !redirectUris.every(isAllowedRedirect)
    ) {
      return c.json(
        {
          error: 'invalid_redirect_uri',
          error_description: 'Redirect URIs must be https, http on localhost, or an app scheme',
        },
        400,
      );
    }
    const client: Client = {
      org: org.host,
      name: typeof body.client_name === 'string' ? body.client_name.slice(0, 100) : undefined,
      redirectUris: redirectUris as string[],
    };
    return c.json(
      {
        client_id: encodeClient(client),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: client.name,
        redirect_uris: client.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        // Public clients, with PKCE: whatever was asked for, there's no secret.
        token_endpoint_auth_method: 'none',
      },
      201,
    );
  });

  routes.get('/oauth/:org/authorize', (c) => {
    const org = orgOf(c);
    if (!org) return errorPage(c, 'This server doesn’t serve that Okta org.');
    const q = c.req.query();
    const client = decodeClient(q.client_id, org);
    if (!client) return errorPage(c, 'The app signing in isn’t registered with this server.');
    const redirectUri =
      q.redirect_uri ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!redirectUri || !client.redirectUris.some((r) => matchesRedirect(r, redirectUri))) {
      return errorPage(c, 'The app asked to be sent back to an address it didn’t register.');
    }

    // From here on, errors go back to the client.
    const fail = (error: string, description: string) =>
      backToClient(c, redirectUri, { error, error_description: description, state: q.state });
    if (q.response_type !== 'code')
      return fail('unsupported_response_type', 'Only code is supported');
    if (!q.code_challenge || q.code_challenge_method !== 'S256') {
      return fail('invalid_request', 'PKCE with S256 is required');
    }
    if (q.resource && q.resource !== resourceUrl(c, org)) {
      return fail('invalid_target', `This server signs in for ${resourceUrl(c, org)} only`);
    }

    take(pending, undefined); // drop expired ones
    if (pending.size >= MAX_PENDING) return fail('temporarily_unavailable', 'Too many sign-ins');
    const id = random();
    const browser = random();
    pending.set(id, {
      org,
      clientId: q.client_id!,
      redirectUri,
      state: q.state,
      codeChallenge: q.code_challenge,
      browser,
      oktaVerifier: random(),
      expires: Date.now() + TTL_MS,
    });
    setCookie(c, cookieName(id), browser, {
      path: '/oauth',
      httpOnly: true,
      sameSite: 'Lax',
      secure: publicUrl(c).startsWith('https:'),
      maxAge: TTL_MS / 1000,
    });

    const name = client.name ?? 'An MCP client';
    return c.html(
      html`<!doctype html>
        <title>Allow access to ${org.host}?</title>
        <style>
          ${STYLE}
        </style>
        <h1>Allow <q>${name}</q> to read <code>${org.host}</code> as you?</h1>
        <p>
          After you sign in to Okta, it can use Okta’s read-only tools with your admin role, until
          you sign it out. It can’t change anything.
        </p>
        <p>You’ll be sent back to <strong>${destination(redirectUri)}</strong>.</p>
        <p class="note">
          The name above is the one the app gave itself. Only allow this if you just connected an
          app to <code>${resourceUrl(c, org)}</code>.
        </p>
        <form method="post">
          <input type="hidden" name="request" value="${id}" />
          <div class="buttons">
            <button type="submit" name="decision" value="allow">Allow</button>
            <button type="submit" name="decision" value="deny">Cancel</button>
          </div>
        </form>`,
      200,
      PAGE_HEADERS,
    );
  });

  routes.post('/oauth/:org/authorize', async (c) => {
    const form = await c.req.parseBody();
    const id = String(form.request ?? '');
    const signIn = take(pending, id);
    // The cookie is only sent by the browser that was shown the page, and only same-site.
    if (!signIn || signIn.org !== orgOf(c) || getCookie(c, cookieName(id)) !== signIn.browser) {
      return errorPage(
        c,
        'This sign-in has expired or was started elsewhere. Try again from the app.',
      );
    }
    if (form.decision !== 'allow') {
      deleteCookie(c, cookieName(id), { path: '/oauth' });
      return backToClient(c, signIn.redirectUri, {
        error: 'access_denied',
        state: signIn.state,
      });
    }
    // Same ID, so the callback finds it; Okta hands it back as `state`.
    pending.set(id, { ...signIn, expires: Date.now() + TTL_MS });

    const authorize = new URL('/oauth2/v1/authorize', signIn.org.url);
    authorize.search = new URLSearchParams({
      client_id: signIn.org.clientId,
      response_type: 'code',
      // offline_access: a refresh token, so clients don't sign in again every hour.
      scope: [...OKTA_SCOPES, 'offline_access'].join(' '),
      redirect_uri: callbackUrl(c),
      state: id,
      code_challenge: s256(signIn.oktaVerifier),
      code_challenge_method: 'S256',
    }).toString();
    return c.redirect(authorize.href);
  });

  routes.get('/oauth/callback', async (c) => {
    const q = c.req.query();
    const id = q.state ?? '';
    const signIn = take(pending, id);
    if (!signIn || getCookie(c, cookieName(id)) !== signIn.browser) {
      return errorPage(
        c,
        'This sign-in has expired or was started elsewhere. Try again from the app.',
      );
    }
    deleteCookie(c, cookieName(id), { path: '/oauth' });
    const back = (params: Record<string, string | undefined>) =>
      backToClient(c, signIn.redirectUri, {
        ...params,
        state: signIn.state,
        iss: issuer(c, signIn.org),
      });

    if (!q.code) {
      return back({
        error: q.error ?? 'access_denied',
        error_description: q.error_description ?? 'Okta sign-in failed',
      });
    }
    const result = await oktaToken(signIn.org, {
      grant_type: 'authorization_code',
      redirect_uri: callbackUrl(c),
      code: q.code,
      code_verifier: signIn.oktaVerifier,
    });
    if (!result.tokens) {
      console.error(`[oauth ${signIn.org.host}] ${result.error}: ${result.description}`);
      return back({ error: 'access_denied', error_description: result.description });
    }

    const code = random();
    grants.set(code, {
      org: signIn.org,
      clientId: signIn.clientId,
      redirectUri: signIn.redirectUri,
      codeChallenge: signIn.codeChallenge,
      tokens: result.tokens,
      expires: Date.now() + TTL_MS,
    });
    return back({ code });
  });

  routes.post('/oauth/:org/token', async (c) => {
    const org = orgOf(c);
    if (!org) return c.json({ error: 'unknown_org' }, 404);
    const form = (await c.req.parseBody()) as Record<string, string | undefined>;
    if (!decodeClient(form.client_id, org)) return tokenError(c, 'invalid_client');
    if (form.resource && form.resource !== resourceUrl(c, org)) {
      return tokenError(c, 'invalid_target');
    }

    if (form.grant_type === 'authorization_code') {
      const grant = take(grants, form.code);
      if (
        !grant ||
        grant.org !== org ||
        grant.clientId !== form.client_id ||
        // Required when it was sent to /authorize, which clients always do.
        (form.redirect_uri !== undefined && form.redirect_uri !== grant.redirectUri) ||
        !form.code_verifier ||
        s256(form.code_verifier) !== grant.codeChallenge
      ) {
        return tokenError(c, 'invalid_grant');
      }
      return c.json(forClient(grant.tokens), 200, { 'Cache-Control': 'no-store' });
    }

    if (form.grant_type === 'refresh_token' && form.refresh_token) {
      const result = await oktaToken(org, {
        grant_type: 'refresh_token',
        refresh_token: form.refresh_token,
      });
      if (!result.tokens) return tokenError(c, 'invalid_grant', result.description);
      return c.json(forClient(result.tokens), 200, { 'Cache-Control': 'no-store' });
    }

    return tokenError(c, 'unsupported_grant_type');
  });

  return routes;
}
