/**
 * Creates the OIDC app the extension signs admins in with (README, "Okta OIDC
 * app"): Native, Authorization Code with PKCE and no secret, redirecting to the
 * extension, with the read scopes in `OKTA_SCOPES` granted. Prints the client
 * ID to put in `OKTA_CLIENT_ID`.
 *
 * Needs an Okta API token from an admin who can manage apps (super admin).
 * Does nothing if an app with the same label already exists.
 *
 * Run: OKTA_API_TOKEN=... vpx scripts/create-okta-app.ts <extension-id>... [--group <group name>]
 *   OKTA_ORG_URL comes from the environment or server/.env.
 *   Pass one extension ID per machine whose ID differs (see chrome://extensions).
 */
import { parseArgs } from 'node:util';

import { OKTA_SCOPES } from '@oktamax/shared';

const LABEL = 'Okta Max assistant';

try {
  process.loadEnvFile();
} catch {
  // No .env file – rely on the real environment.
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { group: { type: 'string' } },
});
const orgUrl = process.env.OKTA_ORG_URL && new URL(process.env.OKTA_ORG_URL).origin;
const apiToken = process.env.OKTA_API_TOKEN;
if (!orgUrl || !apiToken || !positionals.length) {
  console.error(
    'Usage: OKTA_API_TOKEN=... vpx scripts/create-okta-app.ts <extension-id>... [--group <name>]\n' +
      '  with OKTA_ORG_URL set (e.g. https://acme.okta.com) in the environment or server/.env.',
  );
  process.exit(1);
}
for (const id of positionals) {
  if (!/^[a-p]{32}$/.test(id)) throw new Error(`Not an extension ID: ${id}`);
}

async function okta<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(new URL(path, orgUrl), {
    method,
    headers: {
      Authorization: `SSWS ${apiToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => undefined)) as T & { errorSummary?: string };
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${json?.errorSummary ?? ''}`);
  return json;
}

interface App {
  id: string;
  label: string;
  credentials: { oauthClient: { client_id: string } };
}

const existing = (await okta<App[]>('GET', `/api/v1/apps?q=${encodeURIComponent(LABEL)}`)).find(
  (app) => app.label === LABEL,
);
if (existing) {
  console.log(`"${LABEL}" already exists (${existing.id}); nothing changed.`);
  console.log(`OKTA_CLIENT_ID=${existing.credentials.oauthClient.client_id}`);
  process.exit(0);
}

// Find the group before creating anything, so a typo doesn't leave a half-set-up app.
let group: { id: string; profile: { name: string } } | undefined;
if (values.group) {
  const groups = await okta<{ id: string; profile: { name: string } }[]>(
    'GET',
    `/api/v1/groups?q=${encodeURIComponent(values.group)}`,
  );
  group = groups.find((g) => g.profile.name === values.group);
  if (!group) throw new Error(`No group named "${values.group}"`);
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
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: positionals.map((id) => `https://${id}.chromiumapp.org/`),
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

console.log(`\nOKTA_CLIENT_ID=${app.credentials.oauthClient.client_id}`);
