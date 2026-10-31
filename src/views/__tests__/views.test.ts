import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Field, FormView } from '../../form/schema';
import type { App, GroupRule, NetworkZone, PolicyRule } from '../../okta/types';
import { samlSettingsView } from '../apps/saml';
import { groupRuleView } from '../groupRules';
import { networkZoneView, zoneTitle } from '../networkZones';
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
  it('shows gateways and proxies for IP zones like "Edit IP Zone"', () => {
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
    expect(view.sections.flatMap((s) => s.fields.map((f) => f.label))).toEqual([
      'Zone name',
      'Block access from IPs matching conditions listed in this zone',
      'Gateway IPs',
      'Trusted proxy IPs',
    ]);
    expect(field(view, 'Gateway IPs')).toMatchObject({
      type: 'textarea',
      value: '10.0.0.0/8\n1.1.1.1-1.1.1.5',
    });
    expect(
      field(view, 'Block access from IPs matching conditions listed in this zone'),
    ).toMatchObject({
      checked: false,
      hint: 'WARNING: Selecting this option will prevent matching IPs from accessing Okta.',
    });
    expect(zoneTitle(zone)).toBe('View IP Zone');
  });

  it('shows dynamic zones like "Edit Dynamic Zone"', () => {
    const zone: NetworkZone = {
      id: 'nzo3',
      name: 'Countries',
      type: 'DYNAMIC',
      status: 'ACTIVE',
      usage: 'BLOCKLIST',
      proxyType: 'NotTorAnonymizer',
      locations: [
        { country: 'CA', region: 'CA-ON' },
        { country: 'US', region: null },
      ],
      asns: ['64496'],
    };
    const view = networkZoneView(zone);
    const fields = view.sections.flatMap((s) => s.fields);
    expect(fields.map((f) => f.label)).toEqual([
      'Zone name',
      'Block access from IPs matching conditions listed in this zone',
      'IP type',
      'Locations',
      '',
      'ISP ASNs',
    ]);
    expect(field(view, 'IP type')).toMatchObject({ value: 'NotTorAnonymizer' });
    expect(field(view, 'ISP ASNs')).toMatchObject({ type: 'textarea', value: '64496' });
    const shown = (f: Field | undefined) =>
      f?.type === 'inline'
        ? f.fields.map((x) =>
            x.type === 'select' ? x.options.find((o) => o.value === x.value)?.label : undefined,
          )
        : [];
    expect(shown(fields[3])).toEqual(['Canada', 'Ontario']);
    expect(shown(fields[4])).toEqual(['United States', 'State/Region (Optional)']);
    expect(zoneTitle(zone)).toBe('View Dynamic Zone');
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
    expect(field(view, 'Include locations')).toMatchObject({
      type: 'inline',
      fields: [{ value: 'US' }, { value: 'US-CA' }],
    });
    expect(field(view, 'Exclude locations')).toMatchObject({
      type: 'inline',
      fields: [{ value: 'CA' }, { value: '' }],
    });
    expect(field(view, 'Include ASNs')).toMatchObject({ value: '15169' });
    expect(field(view, 'Include IP service categories')).toMatchObject({
      values: ['All anonymizers'],
    });
    expect(zoneTitle(zone)).toBe('View Enhanced Dynamic Zone');
  });
});

describe('groupRuleView', () => {
  const rule = (expression: string): GroupRule => ({
    id: '0pr1',
    name: 'Engineers',
    status: 'ACTIVE',
    conditions: {
      expression: { value: expression },
      people: { users: { exclude: ['00u1'] } },
    },
    actions: { assignUserToGroups: { groupIds: ['00g1'] } },
    _embedded: { groupIdToGroupNameMap: { '00g1': 'Engineering' } },
  });

  it('shows a simple equality as a basic condition and resolves names', async () => {
    mockApi({
      '/api/v1/users/00u1': {
        id: '00u1',
        profile: { login: 'ada@example.com', firstName: 'Ada', lastName: 'L' },
      },
    });
    const view = await groupRuleView(rule('user.department=="Engineering"'));
    expect(view.sections.flatMap((s) => s.fields.map((f) => f.label))).toEqual([
      'Name',
      'IF',
      '',
      'THEN Assign to',
      'EXCEPT The following users',
    ]);
    expect(field(view, 'IF')).toMatchObject({ type: 'radio', value: 'basic' });
    expect(field(view, '')).toMatchObject({
      type: 'inline',
      fields: [
        { type: 'select', value: 'user' },
        { type: 'select', value: 'department' },
        { type: 'select', value: 'equals', options: [{ label: 'Equals' }] },
        { type: 'text', value: 'Engineering' },
      ],
    });
    expect(field(view, 'THEN Assign to')).toMatchObject({ values: ['Engineering'] });
    expect(field(view, 'EXCEPT The following users')).toMatchObject({
      values: ['Ada L (ada@example.com)'],
    });
  });

  it('falls back to the expression for anything else', async () => {
    mockApi({});
    const expression = 'isMemberOfGroupName("Contractors") AND user.department=="Eng"';
    const view = await groupRuleView(rule(expression));
    expect(field(view, 'IF')).toMatchObject({ value: 'advanced' });
    expect(field(view, '')).toMatchObject({ type: 'textarea', value: expression });
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
    const statements = view.sections.find((s) => s.title === 'Attribute Statements');
    expect(statements?.fields[0]).toMatchObject({
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
    const fields = view.sections.flatMap((s) => s.fields);
    const after = (label: string) => fields[fields.findIndex((f) => f.label === label) + 1];
    expect(field(view, "AND User's group membership includes")).toMatchObject({
      type: 'select',
      value: 'SOME',
    });
    expect(after("AND User's group membership includes")).toMatchObject({
      label: '',
      values: ['Contractors'],
    });
    expect(field(view, "AND User's IP is")).toMatchObject({ type: 'select', value: 'NOT_IN_ZONE' });
    expect(after("AND User's IP is")).toMatchObject({ label: '', values: ['Office'] });
    expect(field(view, 'AND User must authenticate with')).toMatchObject({
      value: '2FA_PASSWORD',
    });
    // User presence defaults to REQUIRED, so "Require user interaction" is checked too.
    expect(field(view, 'AND Possession factor constraints are')).toMatchObject({
      checked: ['phishingResistant', 'userPresence'],
    });
    expect(after('AND Possession factor constraints are')).toMatchObject({
      type: 'radio',
      value: 'ANY',
    });
    expect(field(view, 'AND Prompt for authentication')).toMatchObject({ value: 'AFTER' });
    expect(after('AND Prompt for authentication')).toMatchObject({
      type: 'inline',
      fields: [{ value: '2' }, { value: 'HOURS' }],
    });
  });
});
