/**
 * Creates the OIDC app the extension signs admins in with (README, "Okta OIDC
 * app"): Native, Authorization Code with PKCE and no secret, redirecting to the
 * extension, with the read scopes in `OKTA_SCOPES` granted. Prints the client
 * ID to put in `OKTA_CLIENT_ID` (or in `OKTA_ORGS`).
 *
 * With `--server <public URL>`, MCP clients can sign in with it too: it also
 * redirects to the server's `/oauth/callback`, and issues refresh tokens.
 *
 * If an app with the same label already exists, it only adds missing redirect
 * URIs (and, with `--server`, the refresh token grant) to it.
 *
 * Needs an Okta API token from an admin who can manage apps (super admin).
 * `extension/e2e/create-okta-app.ts` does the same with the live-test admin's
 * session instead.
 *
 * Run: OKTA_API_TOKEN=... vpx scripts/create-okta-app.ts <extension-id>... [--group <group name>] [--server <url>]
 *   OKTA_ORG_URL comes from the environment or server/.env.
 *   Pass one extension ID per machine whose ID differs (see chrome://extensions).
 */
import { parseArgs } from 'node:util';

import { OKTA_SCOPES } from '@oktamax/shared';

const LABEL = 'Okta Max assistant';

/** Calls the Okta API; throws on an error status. */
export type OktaRequest = <T>(method: string, path: string, body?: unknown) => Promise<T>;

export interface CreateOktaAppOptions {
  /** e.g. https://acme.okta.com (not the -admin URL). */
  orgUrl: string;
  extensionIds: string[];
  /** Name of a group to assign the app to. */
  group?: string;
  /** The chat server's public URL, e.g. https://oktamax.example.com, for MCP clients' sign-in. */
  serverUrl?: string;
}

interface App {
  id: string;
  name: string;
  label: string;
  signOnMode: string;
  credentials: { oauthClient: { client_id: string } };
  settings: { oauthClient: { redirect_uris: string[]; grant_types: string[] } };
}

/** Creates the app, or updates its redirect URIs. Returns the client ID. */
export async function createOktaApp(
  okta: OktaRequest,
  { orgUrl, extensionIds, group: groupName, serverUrl }: CreateOktaAppOptions,
): Promise<string> {
  for (const id of extensionIds) {
    if (!/^[a-p]{32}$/.test(id)) throw new Error(`Not an extension ID: ${id}`);
  }
  const redirectUris = extensionIds.flatMap((id) => [
    `https://${id}.chromiumapp.org/`,
    // Never redirected to: Okta only takes token requests from a browser (the extension's
    // service worker sends `Origin: chrome-extension://<id>`) whose origin is a redirect URI's.
    `chrome-extension://${id}`,
  ]);
  // Where Okta sends admins back to the server when an MCP client signs them in.
  if (serverUrl) redirectUris.push(new URL('/oauth/callback', serverUrl).href);

  const existing = (await okta<App[]>('GET', `/api/v1/apps?q=${encodeURIComponent(LABEL)}`)).find(
    (app) => app.label === LABEL,
  );
  if (existing) {
    const current = existing.settings.oauthClient.redirect_uris;
    const missing = redirectUris.filter((uri) => !current.includes(uri));
    const grants = existing.settings.oauthClient.grant_types;
    const addRefresh = !!serverUrl && !grants.includes('refresh_token');
    if (missing.length || addRefresh) {
      // Only the app's own fields: Okta refuses the whole object (links, embedded, ...) back.
      await okta('PUT', `/api/v1/apps/${existing.id}`, {
        name: existing.name,
        label: existing.label,
        signOnMode: existing.signOnMode,
        credentials: existing.credentials,
        settings: {
          oauthClient: {
            ...existing.settings.oauthClient,
            redirect_uris: [...current, ...missing],
            grant_types: addRefresh ? [...grants, 'refresh_token'] : grants,
          },
        },
      });
      const added = [...missing, ...(addRefresh ? ['the refresh token grant'] : [])];
      console.log(`"${LABEL}" already exists (${existing.id}); added ${added.join(', ')}`);
    } else {
      console.log(`"${LABEL}" already exists (${existing.id}); nothing changed.`);
    }
    return existing.credentials.oauthClient.client_id;
  }

  // Find the group before creating anything, so a typo doesn't leave a half-set-up app.
  let group: { id: string; profile: { name: string } } | undefined;
  if (groupName) {
    const groups = await okta<{ id: string; profile: { name: string } }[]>(
      'GET',
      `/api/v1/groups?q=${encodeURIComponent(groupName)}`,
    );
    group = groups.find((g) => g.profile.name === groupName);
    if (!group) throw new Error(`No group named "${groupName}"`);
  }

  const app = await okta<App>('POST', '/api/v1/apps', {
    name: 'oidc_client',
    label: LABEL,
    signOnMode: 'OPENID_CONNECT',
    credentials: {
      oauthClient: { token_endpoint_auth_method: 'none', pkce_required: true },
    },
    settings: {
      oauthClient: {
        application_type: 'native',
        // Refresh tokens are only issued when asked for (offline_access): to MCP clients.
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        redirect_uris: redirectUris,
        // No consent screen, so the extension's silent sign-in (prompt=none) works.
        consent_method: 'TRUSTED',
      },
    },
  });
  console.log(`Created "${LABEL}" (${app.id})`);

  for (const scope of OKTA_SCOPES.filter((s) => s.startsWith('okta.'))) {
    await okta('POST', `/api/v1/apps/${app.id}/grants`, { issuer: orgUrl, scopeId: scope });
    console.log(`  granted ${scope}`);
  }

  if (group) {
    await okta('PUT', `/api/v1/apps/${app.id}/groups/${group.id}`, {});
    console.log(`  assigned to ${group.profile.name}`);
  } else {
    console.log('  not assigned to anyone yet: assign it to your admins in the admin console.');
  }
  return app.credentials.oauthClient.client_id;
}

if (import.meta.main) {
  try {
    process.loadEnvFile();
  } catch {
    // No .env file – rely on the real environment.
  }

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { group: { type: 'string' }, server: { type: 'string' } },
  });
  const orgUrl = process.env.OKTA_ORG_URL && new URL(process.env.OKTA_ORG_URL).origin;
  const apiToken = process.env.OKTA_API_TOKEN;
  if (!orgUrl || !apiToken || !positionals.length) {
    console.error(
      'Usage: OKTA_API_TOKEN=... vpx scripts/create-okta-app.ts <extension-id>... [--group <name>] [--server <url>]\n' +
        '  with OKTA_ORG_URL set (e.g. https://acme.okta.com) in the environment or server/.env.',
    );
    process.exit(1);
  }

  const okta: OktaRequest = async <T>(method: string, path: string, body?: unknown) => {
    const res = await fetch(new URL(path, orgUrl), {
      method,
      headers: {
        Authorization: `SSWS ${apiToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json().catch(() => undefined)) as T & { errorSummary?: string };
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json?.errorSummary ?? ''}`);
    return json;
  };

  const clientId = await createOktaApp(okta, {
    orgUrl,
    extensionIds: positionals,
    group: values.group,
    serverUrl: values.server ?? process.env.PUBLIC_URL,
  });
  console.log(`\nOKTA_CLIENT_ID=${clientId}`);
}
