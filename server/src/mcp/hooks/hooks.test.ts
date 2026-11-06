import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vite-plus/test';

import type { Principal } from '../../auth';
import { ToolHooks, type HookEntry } from '.';

const principal = {
  org: { host: 'acme.okta.com', url: 'https://acme.okta.com', clientId: '0oa1' },
  userId: '00uada',
  username: 'ada@example.com',
  token: 't',
  scopes: [],
  expiresAt: 0,
} satisfies Principal;

const text = (value: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
});

/** Runs a call through the hooks, with `result` as Okta's server's answer. */
async function run(entries: HookEntry[], result: CallToolResult, args = {}) {
  const hooks = (await ToolHooks.create(entries)).for(principal.org.host);
  let forwarded = false;
  const out = await hooks.call({ name: 'get_user', arguments: args }, { principal }, async () => {
    forwarded = true;
    return result;
  });
  const first = out.content[0];
  const body = first?.type === 'text' ? first.text : '';
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  return { out, body, json, forwarded };
}

describe('redact', () => {
  it('withholds dates of birth, phone numbers, addresses and ID numbers by default', async () => {
    const { json } = await run(
      [{ type: 'redact' }],
      text({
        profile: {
          login: 'ada@example.com',
          firstName: 'Ada',
          city: 'Springfield',
          birthDate: '1990-01-01',
          primaryPhone: '555-010-0199',
          mobilePhone: null,
          streetAddress: '1 Main St',
          zipCode: 12345,
          ssn: '000-12-3456',
        },
        created: '2024-01-15T10:20:30.000Z',
      }),
    );
    expect(json).toEqual({
      profile: {
        login: 'ada@example.com',
        firstName: 'Ada',
        city: 'Springfield',
        birthDate: '[redacted]',
        primaryPhone: '[redacted]',
        mobilePhone: null,
        streetAddress: '[redacted]',
        zipCode: '[redacted]',
        ssn: '[redacted]',
      },
      created: '2024-01-15T10:20:30.000Z',
    });
  });

  it("searches objects under a field's name instead of wiping them out", async () => {
    const policy = { settings: { phone: { enroll: { self: 'OPTIONAL' } } } };
    const { json } = await run([{ type: 'redact' }], text(policy));
    expect(json).toEqual(policy);
  });

  it('redacts lists of values, and every item in a list of objects', async () => {
    const { json } = await run(
      [{ type: 'redact' }],
      text([{ mobilePhone: '+15550100199', phoneNumbers: ['+15550100199', null] }]),
    );
    expect(json).toEqual([{ mobilePhone: '[redacted]', phoneNumbers: ['[redacted]', null] }]);
  });

  it('finds phone numbers and SSNs in any text, without touching IDs, dates or IPs', async () => {
    const { body } = await run(
      [{ type: 'redact' }],
      text(
        'User 00u1abc2345 (created 2024-01-15, from 192.168.100.123) gave +1 (555) 010-0199, +15550100199 and 000-12-3456.',
      ),
    );
    expect(body).toBe(
      'User 00u1abc2345 (created 2024-01-15, from 192.168.100.123) gave [redacted], [redacted] and [redacted].',
    );
  });

  it("redacts fields in text that isn't JSON as a whole", async () => {
    const { body } = await run(
      [{ type: 'redact' }],
      text(
        `Found 1 user:\n{"birthdate": "1990-01-01", "login": "a@example.com"}\n{'zipCode': 12345}`,
      ),
    );
    expect(body).toBe(
      `Found 1 user:\n{"birthdate": "[redacted]", "login": "a@example.com"}\n{'zipCode': '[redacted]'}`,
    );
  });

  it('redacts structured content and embedded resources too', async () => {
    const { out } = await run([{ type: 'redact' }], {
      content: [{ type: 'resource', resource: { uri: 'okta://u', text: '{"dob":"1990-01-01"}' } }],
      structuredContent: { user: { dateOfBirth: '1990-01-01' } },
    });
    expect(out.content[0]).toMatchObject({ resource: { text: '{"dob":"[redacted]"}' } });
    expect(out.structuredContent).toEqual({ user: { dateOfBirth: '[redacted]' } });
  });

  it('takes more fields and patterns, and keeps what `allow` lists', async () => {
    const { json } = await run(
      [
        {
          type: 'redact',
          fields: ['employeeNumber', 'profile.city'],
          patterns: ['email', { name: 'badge ID', regex: 'B-\\d{6}' }],
          allow: ['zipCode', 'primaryPhone', 'phone'],
          replacement: '***',
        },
      ],
      text({
        profile: {
          city: 'Springfield',
          zipCode: '12345',
          primaryPhone: '555-010-0199',
          mobilePhone: '555-010-0199',
          employeeNumber: 42,
          note: 'mail ada@example.com, badge B-123456, desk 555-010-0199',
        },
        city: 'not a profile field',
      }),
    );
    expect(json).toEqual({
      profile: {
        city: '***',
        zipCode: '12345',
        primaryPhone: '555-010-0199',
        mobilePhone: '***',
        employeeNumber: '***',
        note: 'mail ***, badge ***, desk 555-010-0199',
      },
      city: 'not a profile field',
    });
  });

  it('starts from nothing with preset "none"', async () => {
    const result = text({ birthdate: '1990-01-01', ssn: '000-12-3456' });
    const { json } = await run([{ type: 'redact', preset: 'none', fields: ['ssn'] }], result);
    expect(json).toEqual({ birthdate: '1990-01-01', ssn: '[redacted]' });
  });

  it('refuses calls that search or filter on a redacted field', async () => {
    const refused = await run([{ type: 'redact' }], text({}), {
      search: 'status eq "ACTIVE" and profile.mobilePhone eq "+15550100199"',
    });
    expect(refused.forwarded).toBe(false);
    expect(refused.out.isError).toBe(true);
    expect(refused.body).toContain('profile.mobilePhone');

    const allowed = await run([{ type: 'redact' }], text({}), { search: 'profile.city eq "X"' });
    expect(allowed.forwarded).toBe(true);

    const off = await run([{ type: 'redact', blockFilters: false }], text({}), {
      search: 'profile.mobilePhone pr',
    });
    expect(off.forwarded).toBe(true);
  });

  it('tells the model what it withholds', async () => {
    const hooks = await ToolHooks.create([
      { type: 'redact', allow: ['*birth*', 'dateOfBirth', 'dob'], fields: ['employeeNumber'] },
    ]);
    const instructions = hooks.for('acme.okta.com').instructions!;
    expect(instructions).toContain('phone numbers');
    expect(instructions).toContain('employeeNumber');
    expect(instructions).not.toContain('dates of birth');
  });

  it('rejects options it doesn’t know', async () => {
    await expect(ToolHooks.create([{ type: 'redact', feilds: ['x'] }])).rejects.toThrow();
    await expect(ToolHooks.create([{ type: 'redact', patterns: ['nope'] }])).rejects.toThrow(
      /unknown pattern nope/,
    );
  });
});

describe('blockTools', () => {
  it('hides tools by name or glob, and refuses calls to them', async () => {
    const hooks = (
      await ToolHooks.create([{ type: 'blockTools', tools: ['list_system_logs', 'get_user*'] }])
    ).for('acme.okta.com');
    expect(hooks.allowTool('list_system_logs')).toBe(false);
    expect(hooks.allowTool('get_user_groups')).toBe(false);
    expect(hooks.allowTool('list_users')).toBe(true);
    const { forwarded, out } = await run([{ type: 'blockTools', tools: ['get_user'] }], text({}));
    expect(forwarded).toBe(false);
    expect(out.isError).toBe(true);
  });
});

describe('hooks file', () => {
  const dir = mkdtemp(join(tmpdir(), 'oktamax-hooks-'));
  const file = async (name: string, content: string) => {
    const path = join(await dir, name);
    await writeFile(path, content);
    return path;
  };

  it('redacts personal data when there is no file', async () => {
    expect((await ToolHooks.load()).names).toEqual(['redact']);
  });

  it('can turn every hook off', async () => {
    expect((await ToolHooks.load(await file('none.json', '{ "hooks": [] }'))).names).toEqual([]);
  });

  it('scopes hooks to orgs, and replaces their instructions', async () => {
    const hooks = await ToolHooks.load(
      await file(
        'orgs.json',
        JSON.stringify([
          { type: 'redact', orgs: ['acme.okta.com'], instructions: 'No personal data.' },
        ]),
      ),
    );
    expect(hooks.for('acme.okta.com').instructions).toBe('No personal data.');
    expect(hooks.for('other.okta.com').hooks).toEqual([]);
  });

  it('loads custom hooks from modules next to the file', async () => {
    await file(
      'shout.mjs',
      `export default ({ word }) => ({
        name: 'shout',
        instructions: 'Results are loud.',
        afterCall: (result) => ({
          ...result,
          content: result.content.map((c) => ({ ...c, text: c.text.toUpperCase() + word })),
        }),
      });`,
    );
    const path = await file(
      'custom.json',
      JSON.stringify({ hooks: [{ type: 'module', path: './shout.mjs', options: { word: '!' } }] }),
    );
    const hooks = (await ToolHooks.load(path)).for('acme.okta.com');
    expect(hooks.instructions).toBe('Results are loud.');
    const out = await hooks.call({ name: 'x', arguments: {} }, { principal }, async () =>
      text('hi'),
    );
    expect(out.content[0]).toMatchObject({ text: 'HI!' });
  });

  it('says what is wrong with a bad file', async () => {
    await expect(ToolHooks.load(await file('bad.json', '{ nope'))).rejects.toThrow(/bad\.json/);
    await expect(
      ToolHooks.load(await file('unknown.json', '[{ "type": "nope" }]')),
    ).rejects.toThrow(/unknown type nope/);
  });
});
