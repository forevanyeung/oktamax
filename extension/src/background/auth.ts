/**
 * Signs the admin in to the chat server's Okta app with OAuth 2.0 + PKCE.
 *
 * The admin already has an Okta session (they're in the admin console), so the
 * authorize request normally completes without any prompt. The resulting access
 * token is issued by the org authorization server with read-only Okta API
 * scopes, and is further limited by the admin's own role.
 *
 * Tokens live only in this service worker's `chrome.storage.session`, one per
 * org; content scripts never see them.
 */
import { OKTA_SCOPES } from '@oktamax/shared';

export interface AuthConfig {
  oktaOrgUrl: string;
  oktaClientId: string;
}

interface StoredToken {
  accessToken: string;
  expiresAt: number;
  orgUrl: string;
}

/** Where an org's token is kept: `oktaToken:https://acme.okta.com`. */
const tokenKey = (oktaOrgUrl: string) => `oktaToken:${oktaOrgUrl}`;

export class SignInRequiredError extends Error {}

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const randomString = () => base64Url(crypto.getRandomValues(new Uint8Array(32)));

const sha256 = async (value: string) =>
  base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));

async function authorize(config: AuthConfig, interactive: boolean): Promise<StoredToken> {
  const verifier = randomString();
  const state = randomString();
  const redirectUri = chrome.identity.getRedirectURL();

  const authorizeUrl = new URL('/oauth2/v1/authorize', config.oktaOrgUrl);
  authorizeUrl.search = new URLSearchParams({
    client_id: config.oktaClientId,
    response_type: 'code',
    scope: OKTA_SCOPES.join(' '),
    redirect_uri: redirectUri,
    state,
    code_challenge: await sha256(verifier),
    code_challenge_method: 'S256',
    // Silent attempts must never show a login page inside a hidden window.
    ...(interactive ? {} : { prompt: 'none' }),
  }).toString();

  let redirect: string | undefined;
  try {
    redirect = await chrome.identity.launchWebAuthFlow({ url: authorizeUrl.href, interactive });
  } catch (error) {
    throw new SignInRequiredError(String(error));
  }
  const params = new URL(redirect ?? '').searchParams;
  if (params.get('state') !== state) throw new SignInRequiredError('OAuth state mismatch');
  const code = params.get('code');
  if (!code) throw new SignInRequiredError(params.get('error_description') ?? 'No code returned');

  const res = await fetch(new URL('/oauth2/v1/token', config.oktaOrgUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: config.oktaClientId,
      redirect_uri: redirectUri,
      code,
      code_verifier: verifier,
    }),
  });
  const body = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new SignInRequiredError(body.error_description ?? `Token request failed (${res.status})`);
  }
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    orgUrl: config.oktaOrgUrl,
  };
}

/**
 * A valid access token: cached, else silently renewed from the Okta session, else
 * (only when `interactive`) via a sign-in window.
 */
export async function getAccessToken(config: AuthConfig, interactive: boolean): Promise<string> {
  const key = tokenKey(config.oktaOrgUrl);
  const { [key]: cached } = (await chrome.storage.session.get(key)) as Record<
    string,
    StoredToken | undefined
  >;
  // Renew well before expiry: the server refuses tokens with under 2 minutes left, so a
  // chat turn never runs into an expired token mid-way.
  if (
    cached &&
    cached.orgUrl === config.oktaOrgUrl &&
    cached.expiresAt > Date.now() + 10 * 60_000
  ) {
    return cached.accessToken;
  }

  let token: StoredToken;
  try {
    token = await authorize(config, false);
  } catch (error) {
    if (!interactive) throw error;
    token = await authorize(config, true);
  }
  await chrome.storage.session.set({ [key]: token });
  return token.accessToken;
}

export const clearAccessToken = (oktaOrgUrl: string) =>
  chrome.storage.session.remove(tokenKey(oktaOrgUrl));
