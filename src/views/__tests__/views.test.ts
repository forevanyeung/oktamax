import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Field, FormView } from '../../form/schema';
import type { App, GroupRule, NetworkZone, PolicyRule } from '../../okta/types';
import { samlSettingsView } from '../apps/saml';
import { groupRuleView } from '../groupRules';
import { networkZoneView } from '../networkZones';
import { accessPolicyRuleView } from '../policies/accessPolicyRule';

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

const field = (view: FormView, label: string): Field | undefined =>
  view.sections.flatMap((s) => s.fields).find((f) => f.label === label);

afterEach(() => vi.unstubAllGlobals());

describe('networkZoneView', () => {
  it('shows gateways and proxies for IP zones', () => {
    const zone: NetworkZone = {
      id: 'nzo1',
      name: 'Office',
      type: 'IP',
      status: 'ACTIVE',
      usage: 'POLICY',
      gateways: [
        { type: 'CIDR', value: '10.0.0.0/8' },
        { type: 'RANGE', value: '1.1.1.1-1.1.1.5' },
      ],
      proxies: null,
    };
    const view = networkZoneView(zone);
    expect(field(view, 'Gateway IPs')).toMatchObject({
      type: 'textarea',
      value: '10.0.0.0/8\n1.1.1.1-1.1.1.5',
    });
    expect(
      field(view, 'Block access from IPs matching conditions listed in this zone'),
    ).toMatchObject({
      checked: false,
    });
  });

  it('splits include/exclude for enhanced dynamic zones', () => {
    const zone: NetworkZone = {
      id: 'nzo2',
      name: 'Geo',
      type: 'DYNAMIC_V2',
      status: 'ACTIVE',
      locations: { include: [{ country: 'US', region: 'US-CA' }], exclude: [{ country: 'CA' }] },
      asns: { include: ['15169'] },
      ipServiceCategories: { include: ['ALL_ANONYMIZERS'] },
    };
    const view = networkZoneView(zone);
    expect(field(view, 'Include locations')).toMatchObject({ values: ['US - US-CA'] });
    expect(field(view, 'Exclude locations')).toMatchObject({ values: ['CA'] });
    expect(field(view, 'Include IP service categories')).toMatchObject({
      values: ['All anonymizers'],
    });
  });
});

describe('groupRuleView', () => {
  it('resolves group names and excluded users', async () => {
    mockApi({
      '/api/v1/users/00u1': {
        id: '00u1',
        profile: { login: 'ada@example.com', firstName: 'Ada', lastName: 'L' },
      },
    });
    const rule: GroupRule = {
      id: '0pr1',
      name: 'Engineers',
      status: 'ACTIVE',
      conditions: {
        expression: { value: 'user.department=="Engineering"' },
        people: { users: { exclude: ['00u1'] } },
      },
      actions: { assignUserToGroups: { groupIds: ['00g1'] } },
      _embedded: { groupIdToGroupNameMap: { '00g1': 'Engineering' } },
    };
    const view = await groupRuleView(rule);
    expect(field(view, 'Assign to')).toMatchObject({ values: ['Engineering'] });
    expect(field(view, 'Users')).toMatchObject({ values: ['Ada L (ada@example.com)'] });
  });
});

describe('samlSettingsView', () => {
  it('maps the Configure SAML step', async () => {
    mockApi({});
    const app: App = {
      id: '0oa1',
      name: 'acme_app_1',
      label: 'Acme',
      status: 'ACTIVE',
      signOnMode: 'SAML_2_0',
      credentials: { userNameTemplate: { template: '${source.email}', type: 'BUILT_IN' } },
      settings: {
        signOn: {
          ssoAcsUrl: 'https://sp.example.com/acs',
          recipient: 'https://sp.example.com/acs',
          destination: 'https://sp.example.com/acs',
          audience: 'urn:sp',
          subjectNameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
          responseSigned: true,
          assertionSigned: false,
          signatureAlgorithm: 'RSA_SHA256',
          attributeStatements: [
            {
              type: 'EXPRESSION',
              name: 'email',
              namespace: 'urn:oasis:names:tc:SAML:2.0:attrname-format:basic',
              values: ['user.email'],
            },
          ],
        },
      },
    };
    const view = await samlSettingsView(app);
    expect(field(view, 'Use this for Recipient URL and Destination URL')).toMatchObject({
      checked: true,
    });
    expect(field(view, 'Recipient URL')).toBeUndefined();
    expect(field(view, 'Application username')).toMatchObject({ value: '${source.email}' });
    expect(field(view, 'Response')).toMatchObject({ type: 'radio', value: 'true' });
    expect(field(view, 'Attribute Statements')).toMatchObject({
      rows: [['email', 'Basic', 'user.email']],
    });
  });
});

describe('accessPolicyRuleView', () => {
  it('derives "User must authenticate with" and possession constraints', async () => {
    mockApi({
      '/api/v1/groups/00g1': { id: '00g1', profile: { name: 'Contractors' } },
      '/api/v1/zones': [{ id: 'nzo1', name: 'Office', type: 'IP' }],
    });
    const rule: PolicyRule = {
      id: 'rul1',
      name: 'Contractors need phishing-resistant MFA',
      type: 'ACCESS_POLICY',
      status: 'ACTIVE',
      conditions: {
        people: { groups: { include: ['00g1'] } },
        network: { connection: 'ZONE', exclude: ['nzo1'] },
      },
      actions: {
        appSignOn: {
          access: 'ALLOW',
          verificationMethod: {
            type: 'ASSURANCE',
            factorMode: '2FA',
            reauthenticateIn: 'PT2H',
            constraints: [
              { knowledge: { types: ['password'] }, possession: { phishingResistant: 'REQUIRED' } },
            ],
          },
        },
      },
    };
    const view = await accessPolicyRuleView(rule);
    expect(field(view, 'Groups')).toMatchObject({ values: ['Contractors'] });
    expect(field(view, "AND User's IP is")).toMatchObject({ value: 'NOT_IN_ZONE' });
    expect(field(view, 'Zones')).toMatchObject({ values: ['Office'] });
    expect(field(view, 'User must authenticate with')).toMatchObject({ value: '2FA_PASSWORD' });
    expect(field(view, 'Possession factor constraints are')).toMatchObject({
      checked: ['phishingResistant'],
    });
    expect(field(view, 'Re-authentication frequency')).toMatchObject({ value: '2 hours' });
  });
});
