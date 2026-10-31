import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Field, FormView } from '../../form/schema';
import type { PolicyRule } from '../../okta/types';
import { accessPolicyRuleView } from '../policies/accessPolicyRule';
import { globalSessionRuleView } from '../policies/globalSessionRule';
import { passwordRuleView } from '../policies/passwordRule';

/** Answer Okta API GETs from a fixture map. */
function mockApi(responses: Record<string, unknown>) {
  vi.stubGlobal('location', new URL('https://acme-admin.okta.com/admin/dashboard'));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: URL, init: RequestInit) => {
      expect(init.method).toBe('GET');
      const body = responses[url.pathname];
      return body === undefined
        ? new Response('{"errorSummary":"Not found"}', { status: 404 })
        : Response.json(body);
    }),
  );
}

const fields = (view: FormView) => view.sections.flatMap((s) => s.fields);
const field = (view: FormView, label: string): Field | undefined =>
  fields(view).find((f) => f.label === label);
/** The unlabelled field right under `label` (zone pickers, duration inputs, ...). */
const after = (view: FormView, label: string): Field | undefined => {
  const all = fields(view);
  return all[all.findIndex((f) => f.label === label) + 1];
};
const titles = (view: FormView) => view.sections.map((s) => s.title);

afterEach(() => vi.unstubAllGlobals());

describe('globalSessionRuleView', () => {
  // The "Short session" rule captured from the live org.
  const rule: PolicyRule = {
    id: '0pr1',
    name: 'Short session',
    type: 'SIGN_ON',
    status: 'ACTIVE',
    conditions: {
      people: { users: { exclude: [] } },
      network: { connection: 'ANYWHERE' },
      authContext: { authType: 'ANY' },
      risk: { behaviors: [] },
      riskScore: { level: 'ANY' },
      identityProvider: { provider: 'ANY' },
    },
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
  };

  it("matches Okta's Edit Rule dialog", async () => {
    mockApi({});
    const view = await globalSessionRuleView(rule);
    expect(titles(view)).toEqual([undefined, 'Policy settings', 'Okta global session management']);
    expect(fields(view).map((f) => f.label)).toEqual([
      'Rule name',
      'Exclude users',
      "IF User's IP is",
      'AND Identity provider is',
      'AND Authenticates via',
      'AND Behavior is',
      'AND Risk is',
      'THEN Access is',
      'Establish the user session with',
      'Multifactor authentication (MFA) is',
      'Users will be prompted for MFA',
      'Maximum Okta global session lifetime',
      '',
      'Maximum Okta global session idle time',
      'Okta global session cookies persist across browser sessions',
    ]);
    expect(field(view, "IF User's IP is")).toMatchObject({ type: 'select', value: 'ANYWHERE' });
    expect(field(view, 'THEN Access is')).toMatchObject({ type: 'select', value: 'ALLOW' });
    expect(field(view, 'Users will be prompted for MFA')).toMatchObject({
      value: 'ALWAYS',
      options: [
        { label: 'At every sign in' },
        { label: 'When signing in with a new device cookie' },
        { label: 'After MFA lifetime expires for the device cookie' },
      ],
    });
    expect(field(view, 'Maximum Okta global session lifetime')).toMatchObject({ value: 'SET' });
    expect(after(view, 'Maximum Okta global session lifetime')).toMatchObject({
      type: 'inline',
      fields: [{ value: '8' }, { value: 'HOURS' }],
    });
    expect(field(view, 'Maximum Okta global session idle time')).toMatchObject({
      type: 'inline',
      fields: [{ value: '30' }, { value: 'MINUTES' }],
    });
    expect(
      field(view, 'Okta global session cookies persist across browser sessions'),
    ).toMatchObject({ type: 'select', value: 'false' });
  });

  it('shows zones, specific IdPs and hides session settings when denied', async () => {
    mockApi({
      '/api/v1/zones': [{ id: 'nzo1', name: 'Office', type: 'IP' }],
      '/api/v1/idps/0oa1': { id: '0oa1', name: 'Corp SAML' },
    });
    const view = await globalSessionRuleView({
      ...rule,
      conditions: {
        network: { connection: 'ZONE', include: ['nzo1'] },
        identityProvider: { provider: 'SPECIFIC_IDP', idpIds: ['0oa1'] },
      },
      actions: { signon: { access: 'DENY' } },
    });
    expect(field(view, "IF User's IP is")).toMatchObject({ value: 'IN_ZONE' });
    expect(after(view, "IF User's IP is")).toMatchObject({ values: ['Office'] });
    expect(after(view, 'AND Identity provider is')).toMatchObject({ values: ['Corp SAML'] });
    expect(field(view, 'Multifactor authentication (MFA) is')).toBeUndefined();
    expect(titles(view)).not.toContain('Okta global session management');
  });

  it('shows the MFA lifetime and "No time limit"', async () => {
    mockApi({});
    const view = await globalSessionRuleView({
      ...rule,
      actions: {
        signon: {
          access: 'ALLOW',
          requireFactor: true,
          factorPromptMode: 'SESSION',
          factorLifetime: 2880,
          session: { maxSessionIdleMinutes: 120, maxSessionLifetimeMinutes: 0 },
        },
      },
    });
    expect(after(view, 'Users will be prompted for MFA')).toMatchObject({
      fields: [{ value: '2' }, { value: 'DAYS' }],
    });
    expect(field(view, 'Maximum Okta global session lifetime')).toMatchObject({ value: 'NONE' });
    expect(after(view, 'Maximum Okta global session lifetime')).toMatchObject({
      label: 'Maximum Okta global session idle time',
    });
  });
});

describe('passwordRuleView', () => {
  // The "Contractors self-service" rule captured from the live org.
  const rule: PolicyRule = {
    id: '0pr2',
    name: 'Contractors self-service',
    type: 'PASSWORD',
    status: 'ACTIVE',
    conditions: { people: { users: { exclude: [] } }, network: { connection: 'ANYWHERE' } },
    actions: {
      passwordChange: { access: 'ALLOW' },
      selfServicePasswordReset: { access: 'ALLOW' },
      selfServiceUnlock: { access: 'DENY' },
    },
  };

  it("matches Okta's Edit Rule dialog", async () => {
    mockApi({});
    const view = await passwordRuleView(rule);
    expect(fields(view).map((f) => f.label)).toEqual([
      'Rule name',
      'Exclude users',
      "IF User's IP is",
      'THEN Users can perform self-service',
      'Access control',
      '',
      'AND Users can initiate recovery with',
      'AND Additional verification is',
    ]);
    expect(field(view, "IF User's IP is")).toMatchObject({ type: 'select', value: 'ANYWHERE' });
    expect(field(view, 'THEN Users can perform self-service')).toMatchObject({
      checked: ['CHANGE', 'RESET'],
    });
    expect(titles(view)).toContain('Recovery authenticators');
    expect(field(view, 'Access control')).toMatchObject({ value: 'LEGACY' });
    expect(field(view, 'AND Users can initiate recovery with')).toMatchObject({ checked: [] });
    // No requirement in the API: Okta leaves every option unselected.
    expect(field(view, 'AND Additional verification is')).toMatchObject({ value: '' });
  });

  it('maps recovery methods and step-up', async () => {
    mockApi({});
    const view = await passwordRuleView({
      ...rule,
      actions: {
        selfServicePasswordReset: {
          access: 'ALLOW',
          requirement: {
            primary: { methods: ['sms', 'email'] },
            stepUp: { required: true, methods: ['security_question'] },
          },
        },
      },
    });
    expect(field(view, 'AND Users can initiate recovery with')).toMatchObject({
      checked: ['phone', 'email'],
    });
    expect(field(view, 'AND Additional verification is')).toMatchObject({
      value: 'SECURITY_QUESTION',
    });
  });

  it('hides recovery settings without reset or unlock, and under the authentication policy', async () => {
    mockApi({});
    const none = await passwordRuleView({ ...rule, actions: {} });
    expect(titles(none)).not.toContain('Recovery authenticators');

    const authPolicy = await passwordRuleView({
      ...rule,
      actions: {
        selfServiceUnlock: { access: 'ALLOW' },
        selfServicePasswordReset: {
          access: 'DENY',
          requirement: { accessControl: 'AUTH_POLICY' } as never,
        },
      },
    });
    expect(field(authPolicy, 'Access control')).toMatchObject({ value: 'AUTH_POLICY' });
    expect(field(authPolicy, 'AND Users can initiate recovery with')).toBeUndefined();
  });
});

describe('accessPolicyRuleView', () => {
  it('follows the Edit Rule layout for a denied rule', async () => {
    mockApi({});
    const view = await accessPolicyRuleView({
      id: 'rul2',
      name: 'Block',
      type: 'ACCESS_POLICY',
      status: 'ACTIVE',
      conditions: {},
      actions: { appSignOn: { access: 'DENY' } },
    });
    expect(view.description).toMatch(/^If all of the conditions are true/);
    expect(fields(view).map((f) => f.label)).toEqual([
      'Rule name',
      "IF User's user type is",
      "AND User's group membership includes",
      'AND User is',
      'AND Device state is',
      'AND Device assurance policy is',
      'AND Device platform is',
      "AND User's IP is",
      'AND Risk is',
      'AND The following custom expression is true',
      'THEN Access is',
    ]);
  });

  it('shows allowed authentication methods and "every time" prompts', async () => {
    mockApi({});
    const view = await accessPolicyRuleView({
      id: 'rul3',
      name: 'Passkeys',
      type: 'ACCESS_POLICY',
      status: 'ACTIVE',
      actions: {
        appSignOn: {
          access: 'ALLOW',
          keepMeSignedIn: { postAuth: 'ALLOWED' },
          verificationMethod: {
            type: 'ASSURANCE',
            factorMode: '1FA',
            reauthenticateIn: 'PT0S',
            constraints: [
              {
                possession: {
                  userPresence: 'OPTIONAL',
                  authenticationMethods: [{ key: 'webauthn', method: 'webauthn' }],
                },
              },
            ],
          },
        } as never,
      },
    });
    expect(field(view, 'AND Possession factor constraints are')).toMatchObject({ checked: [] });
    expect(field(view, 'AND Authentication methods')).toMatchObject({ value: 'ALLOW' });
    expect(after(view, 'AND Authentication methods')).toMatchObject({
      values: ['Passkey (FIDO2 WebAuthn)'],
    });
    expect(field(view, 'AND Option to stay signed in')).toMatchObject({ checked: ['ALLOWED'] });
    expect(field(view, 'AND Prompt for authentication')).toMatchObject({ value: 'EVERY_TIME' });
  });
});
