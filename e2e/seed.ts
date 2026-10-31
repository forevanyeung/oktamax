/**
 * Seeds a fresh integrator org with objects every read-only view can be
 * checked against. Signs in as the super admin and calls the API with the
 * admin console's own session. Safe to re-run: anything that already exists
 * (matched by name) is left alone.
 *
 * Everything is new and prefixed "Oktamax". Nothing existing is modified, and
 * every policy is scoped to the "Oktamax Contractors" group or a test app, so
 * no real admin's sign-in is affected.
 *
 * Run: vpx e2e/seed.ts
 */
import type { Page } from 'playwright';

import { adminUrl, autoStepUp, launch, signIn } from './okta';

type Json = Record<string, any>;

const PROBE_RULE = 'Oktamax step-up probe';

/**
 * Policy changes are Okta "protected actions": they need a fresh step-up
 * before the API accepts them. The console only starts step-up from its own
 * requests, so save a throwaway rule in the UI and let `autoStepUp` answer the
 * pop-up. The step-up then covers our own API calls for a short while.
 */
async function stepUp(page: Page, policyId: string) {
  console.log('  step-up  protected action: re-verifying with Google Authenticator');
  await page.goto(
    `${adminUrl}/admin/authn/authentication-policies#authentication-policies/policy/${policyId}/`,
    {
      waitUntil: 'networkidle',
    },
  );
  await page.getByText('Add rule', { exact: true }).first().click();
  await page.getByLabel(/rule name/i).fill(PROBE_RULE);
  const popup = page.context().waitForEvent('page');
  await page.getByRole('button', { name: /^save$/i }).click();
  const stepUpPage = await popup;
  await stepUpPage.waitForEvent('close', { timeout: 60_000 }).catch(async (err) => {
    await stepUpPage.screenshot({ path: new URL('step-up-stuck.png', import.meta.url).pathname });
    await page.screenshot({ path: new URL('step-up-console.png', import.meta.url).pathname });
    throw err;
  });
  await page.goto(`${adminUrl}/admin/dashboard`, { waitUntil: 'domcontentloaded' });
}

function api(page: Page, stepUpPolicy: () => string | undefined) {
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    retried = false,
  ): Promise<any> => {
    const result = await page.evaluate(
      async ({ method, path, body }) => {
        const xsrf = document.getElementById('_xsrfToken')?.textContent ?? '';
        const res = await fetch(path, {
          method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Okta-XsrfToken': xsrf,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
      },
      { method, path, body },
    );
    const policyId = stepUpPolicy();
    if (result.status === 401 && result.body?.errorCode === 'E0000004' && policyId && !retried) {
      await stepUp(page, policyId);
      return call(method, path, body, true);
    }
    if (result.status >= 400) {
      throw new Error(`${method} ${path} → ${result.status}: ${JSON.stringify(result.body)}`);
    }
    return result.body;
  };
  return call;
}

const context = await launch('admin');
const page = await signIn(context, 'admin');
autoStepUp(context, 'admin');
let stepUpPolicyId: string | undefined;
const call = api(page, () => stepUpPolicyId);

/** Find by name, or create. Logs which happened. */
async function ensure(
  label: string,
  list: () => Promise<Json[]>,
  name: (o: Json) => string,
  wanted: string,
  create: () => Promise<Json>,
) {
  const existing = (await list()).find((o) => name(o) === wanted);
  if (existing) {
    console.log(`  exists   ${label}: ${wanted}`);
    return existing;
  }
  const created = await create();
  console.log(`  created  ${label}: ${wanted} (${created.id})`);
  return created;
}

try {
  // --- groups and users -----------------------------------------------------
  const group = (name: string, description: string) =>
    ensure(
      'group',
      () => call('GET', `/api/v1/groups?q=${encodeURIComponent(name)}`),
      (g) => g.profile.name,
      name,
      () => call('POST', '/api/v1/groups', { profile: { name, description } }),
    );
  const engineering = await group('Oktamax Engineering', 'Members are added by a group rule');
  const contractors = await group('Oktamax Contractors', 'Scope for the test policies');

  // Staged (not activated) so they don't send emails or count as active users.
  const user = (
    login: string,
    firstName: string,
    lastName: string,
    department: string,
    groupIds: string[],
  ) =>
    ensure(
      'user',
      () =>
        call('GET', `/api/v1/users?search=${encodeURIComponent(`profile.login eq "${login}"`)}`),
      (u) => u.profile.login,
      login,
      () =>
        call('POST', '/api/v1/users?activate=false', {
          profile: { login, email: login, firstName, lastName, department },
          groupIds,
        }),
    );
  await user('ada.lovelace@oktamax.example', 'Ada', 'Lovelace', 'Engineering', []);
  await user('grace.hopper@oktamax.example', 'Grace', 'Hopper', 'Contracting', [contractors.id]);

  // --- group rule -------------------------------------------------------------
  const rule = await ensure(
    'group rule',
    () => call('GET', '/api/v1/groups/rules?limit=200'),
    (r) => r.name,
    'Oktamax Engineering by department',
    () =>
      call('POST', '/api/v1/groups/rules', {
        type: 'group_rule',
        name: 'Oktamax Engineering by department',
        conditions: {
          expression: { type: 'urn:okta:expression:1.0', value: 'user.department=="Engineering"' },
        },
        actions: { assignUserToGroups: { groupIds: [engineering.id] } },
      }),
  );
  if (rule.status !== 'ACTIVE')
    await call('POST', `/api/v1/groups/rules/${rule.id}/lifecycle/activate`);

  // --- network zones (documentation-only IP ranges) ---------------------------
  const zones = () => call('GET', '/api/v1/zones?limit=200');
  await ensure(
    'zone',
    zones,
    (z) => z.name,
    'Oktamax Office',
    () =>
      call('POST', '/api/v1/zones', {
        type: 'IP',
        name: 'Oktamax Office',
        usage: 'POLICY',
        gateways: [
          { type: 'CIDR', value: '198.51.100.0/24' },
          { type: 'RANGE', value: '192.0.2.10-192.0.2.20' },
        ],
        proxies: [{ type: 'CIDR', value: '192.0.2.100/32' }],
      }),
  );
  await ensure(
    'zone',
    zones,
    (z) => z.name,
    'Oktamax Blocked IPs',
    () =>
      call('POST', '/api/v1/zones', {
        type: 'IP',
        name: 'Oktamax Blocked IPs',
        usage: 'BLOCKLIST',
        gateways: [{ type: 'CIDR', value: '203.0.113.0/24' }],
      }),
  );
  const geo = await ensure(
    'zone',
    zones,
    (z) => z.name,
    'Oktamax Allowed Countries',
    () =>
      call('POST', '/api/v1/zones', {
        type: 'DYNAMIC',
        name: 'Oktamax Allowed Countries',
        usage: 'POLICY',
        locations: [{ country: 'US' }, { country: 'CA', region: 'CA-ON' }],
        proxyType: 'NotTorAnonymizer',
        asns: ['64496'],
      }),
  );

  // --- apps -------------------------------------------------------------------
  const apps = () => call('GET', '/api/v1/apps?limit=200');
  const saml = await ensure(
    'app',
    apps,
    (a) => a.label,
    'Oktamax SAML Test',
    () =>
      call('POST', '/api/v1/apps', {
        label: 'Oktamax SAML Test',
        signOnMode: 'SAML_2_0',
        visibility: { autoSubmitToolbar: false, hide: { iOS: true, web: true } },
        settings: {
          signOn: {
            defaultRelayState: '',
            ssoAcsUrl: 'https://sp.oktamax.example/saml/acs',
            recipient: 'https://sp.oktamax.example/saml/acs',
            destination: 'https://sp.oktamax.example/saml/acs',
            audience: 'https://sp.oktamax.example/saml/metadata',
            idpIssuer: 'http://www.okta.com/${org.externalKey}',
            subjectNameIdTemplate: '${user.userName}',
            subjectNameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
            responseSigned: true,
            assertionSigned: true,
            signatureAlgorithm: 'RSA_SHA256',
            digestAlgorithm: 'SHA256',
            honorForceAuthn: true,
            authnContextClassRef:
              'urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport',
            requestCompressed: false,
            allowMultipleAcsEndpoints: false,
            acsEndpoints: [],
            attributeStatements: [
              {
                type: 'EXPRESSION',
                name: 'email',
                namespace: 'urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified',
                values: ['user.email'],
              },
              {
                type: 'GROUP',
                name: 'groups',
                namespace: 'urn:oasis:names:tc:SAML:2.0:attrname-format:unspecified',
                filterType: 'STARTS_WITH',
                filterValue: 'Oktamax',
              },
            ],
          },
        },
      }),
  );
  await ensure(
    'app',
    apps,
    (a) => a.label,
    'Oktamax OIDC Web',
    () =>
      call('POST', '/api/v1/apps', {
        name: 'oidc_client',
        label: 'Oktamax OIDC Web',
        signOnMode: 'OPENID_CONNECT',
        credentials: { oauthClient: { token_endpoint_auth_method: 'client_secret_basic' } },
        settings: {
          oauthClient: {
            application_type: 'web',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code'],
            redirect_uris: ['https://app.oktamax.example/callback'],
            post_logout_redirect_uris: ['https://app.oktamax.example/'],
            initiate_login_uri: 'https://app.oktamax.example/login',
            consent_method: 'REQUIRED',
            issuer_mode: 'DYNAMIC',
          },
        },
      }),
  );
  await ensure(
    'app',
    apps,
    (a) => a.label,
    'Oktamax OIDC SPA',
    () =>
      call('POST', '/api/v1/apps', {
        name: 'oidc_client',
        label: 'Oktamax OIDC SPA',
        signOnMode: 'OPENID_CONNECT',
        credentials: { oauthClient: { token_endpoint_auth_method: 'none' } },
        settings: {
          oauthClient: {
            application_type: 'browser',
            grant_types: ['authorization_code'],
            response_types: ['code'],
            redirect_uris: ['http://localhost:3000/callback'],
            consent_method: 'TRUSTED',
            issuer_mode: 'ORG_URL',
          },
        },
      }),
  );
  await ensure(
    'app',
    apps,
    (a) => a.label,
    'Oktamax Bookmark',
    () =>
      call('POST', '/api/v1/apps', {
        name: 'bookmark',
        label: 'Oktamax Bookmark',
        signOnMode: 'BOOKMARK',
        settings: { app: { requestIntegration: false, url: 'https://docs.oktamax.example' } },
      }),
  );

  // --- authentication policy, assigned only to the SAML test app ---------------
  const accessPolicies = () => call('GET', '/api/v1/policies?type=ACCESS_POLICY');
  const access = await ensure(
    'authentication policy',
    accessPolicies,
    (p) => p.name,
    'Oktamax Test App Policy',
    () =>
      call('POST', '/api/v1/policies', {
        type: 'ACCESS_POLICY',
        name: 'Oktamax Test App Policy',
        description: 'Only applies to Oktamax SAML Test',
      }),
  );
  stepUpPolicyId = access.id;
  const accessRules: Json[] = await call('GET', `/api/v1/policies/${access.id}/rules`);
  if (!accessRules.some((r) => r.name === 'Contractors off-network')) {
    await call('POST', `/api/v1/policies/${access.id}/rules`, {
      type: 'ACCESS_POLICY',
      name: 'Contractors off-network',
      conditions: {
        people: { groups: { include: [contractors.id] } },
        network: { connection: 'ZONE', exclude: [geo.id] },
        riskScore: { level: 'ANY' },
      },
      actions: {
        appSignOn: {
          access: 'ALLOW',
          verificationMethod: {
            factorMode: '2FA',
            type: 'ASSURANCE',
            reauthenticateIn: 'PT2H',
            constraints: [{ possession: { required: true, deviceBound: 'REQUIRED' } }],
          },
        },
      },
    });
    console.log('  created  authentication policy rule: Contractors off-network');
  }
  const mappings: Json[] = await call('GET', `/api/v1/policies/${access.id}/mappings`);
  if (!mappings.some((m) => m._links?.application?.href?.endsWith(saml.id))) {
    await call('PUT', `/api/v1/apps/${saml.id}/policies/${access.id}`);
    console.log('  assigned authentication policy to Oktamax SAML Test');
  }

  // --- global session and password policies, scoped to Contractors -------------
  const scoped = { people: { groups: { include: [contractors.id] } } };

  const sessionPolicy = await ensure(
    'global session policy',
    () => call('GET', '/api/v1/policies?type=OKTA_SIGN_ON'),
    (p) => p.name,
    'Oktamax Contractors Session',
    () =>
      call('POST', '/api/v1/policies', {
        type: 'OKTA_SIGN_ON',
        name: 'Oktamax Contractors Session',
        description: 'Shorter sessions for contractors',
        conditions: scoped,
      }),
  );
  const sessionRules: Json[] = await call('GET', `/api/v1/policies/${sessionPolicy.id}/rules`);
  if (!sessionRules.some((r) => r.name === 'Short session')) {
    await call('POST', `/api/v1/policies/${sessionPolicy.id}/rules`, {
      type: 'SIGN_ON',
      name: 'Short session',
      conditions: { network: { connection: 'ANYWHERE' } },
      actions: {
        signon: {
          access: 'ALLOW',
          requireFactor: true,
          primaryFactor: 'PASSWORD_IDP_ANY_FACTOR',
          factorPromptMode: 'ALWAYS',
          rememberDeviceByDefault: false,
          session: {
            usePersistentCookie: false,
            maxSessionIdleMinutes: 30,
            maxSessionLifetimeMinutes: 480,
          },
        },
      },
    });
    console.log('  created  global session rule: Short session');
  }

  const passwordPolicy = await ensure(
    'password policy',
    () => call('GET', '/api/v1/policies?type=PASSWORD'),
    (p) => p.name,
    'Oktamax Contractors Password',
    () =>
      call('POST', '/api/v1/policies', {
        type: 'PASSWORD',
        name: 'Oktamax Contractors Password',
        description: 'Stricter passwords for contractors',
        conditions: { ...scoped, authProvider: { provider: 'OKTA' } },
        settings: {
          password: {
            complexity: {
              minLength: 14,
              minLowerCase: 1,
              minUpperCase: 1,
              minNumber: 1,
              minSymbol: 1,
              excludeUsername: true,
              excludeAttributes: ['firstName', 'lastName'],
            },
            age: { maxAgeDays: 90, expireWarnDays: 7, minAgeMinutes: 60, historyCount: 12 },
            lockout: { maxAttempts: 5, autoUnlockMinutes: 30, showLockoutFailures: true },
          },
        },
      }),
  );
  const passwordRules: Json[] = await call('GET', `/api/v1/policies/${passwordPolicy.id}/rules`);
  if (!passwordRules.some((r) => r.name === 'Contractors self-service')) {
    await call('POST', `/api/v1/policies/${passwordPolicy.id}/rules`, {
      type: 'PASSWORD',
      name: 'Contractors self-service',
      conditions: { network: { connection: 'ANYWHERE' } },
      actions: {
        passwordChange: { access: 'ALLOW' },
        selfServicePasswordReset: { access: 'ALLOW' },
        selfServiceUnlock: { access: 'DENY' },
      },
    });
    console.log('  created  password rule: Contractors self-service');
  }

  // The console may save the step-up probe rule once step-up succeeds.
  const finalRules: Json[] = await call('GET', `/api/v1/policies/${access.id}/rules`);
  for (const probe of finalRules.filter((r) => /^Oktamax .*probe/.test(r.name))) {
    await call('DELETE', `/api/v1/policies/${access.id}/rules/${probe.id}`);
    console.log(`  deleted  probe rule: ${probe.name}`);
  }
} finally {
  await context.close();
}
