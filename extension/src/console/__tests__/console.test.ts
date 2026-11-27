import { describe, expect, it } from 'vite-plus/test';

import { completionsAt, lintBody, skeleton, type BodyField, type BodySchema } from '../body';
import { fillTemplate, pageContext, placeholders } from '../context';
import { csvFilename, flatten, toCsv } from '../csv';
import { cell, formatBytes, isTable, oktaError, tableColumns, timeAgo } from '../format';
import { cursorAt, keyAt, parseJson } from '../jsonDoc';
import {
  joinUrl,
  resolveUrl,
  splitMethod,
  splitUrl,
  stepUpChallenge,
  stepUpUrl,
  toConsoleUrl,
} from '../request';
import { addToHistory, RESPONSE_LIMIT, savedIds, type HistoryEntry } from '../store';
import {
  docsUrl,
  endpointFor,
  objectPath,
  suggest,
  type Endpoint,
  type Suggestion,
} from '../suggest';

const ORIGIN = 'https://acme-admin.okta.com';

describe('request', () => {
  it('splits a method typed at the prompt', () => {
    expect(splitMethod('post /api/v1/groups')).toEqual({ method: 'POST', url: '/api/v1/groups' });
    expect(splitMethod('DELETE ')).toEqual({ method: 'DELETE', url: '' });
    expect(splitMethod('/api/v1/users')).toEqual({ url: '/api/v1/users' });
    expect(splitMethod('users me')).toEqual({ url: 'users me' });
  });

  it('round-trips query parameters, keeping them readable', () => {
    const url = '/api/v1/users?search=profile.lastName eq "Smith"&limit=5&expand';
    const { path, params } = splitUrl(url);
    expect(path).toBe('/api/v1/users');
    expect(params).toEqual([
      { key: 'search', value: 'profile.lastName eq "Smith"' },
      { key: 'limit', value: '5' },
      { key: 'expand', value: '' },
    ]);
    expect(joinUrl(path, params)).toBe(url);
    expect(splitUrl('/x?q=a%26b').params).toEqual([{ key: 'q', value: 'a&b' }]);
    expect(joinUrl('/x', [{ key: 'q', value: 'a&b' }])).toBe('/x?q=a%26b');
  });

  it("reads a next link's `+` as a space, and sends it that way", () => {
    const next = toConsoleUrl(
      `${ORIGIN}/api/v1/users?after=00u2&limit=200&search=status+ne+%22DEPROVISIONED%22`,
      ORIGIN,
    );
    expect(next).toBe('/api/v1/users?after=00u2&limit=200&search=status ne "DEPROVISIONED"');
    expect(resolveUrl(next, ORIGIN).search).toBe(
      '?after=00u2&limit=200&search=status%20ne%20%22DEPROVISIONED%22',
    );
    // An encoded `+` is still a `+`.
    expect(toConsoleUrl(`${ORIGIN}/api/v1/users?q=a%2Bb`, ORIGIN)).toBe('/api/v1/users?q=a+b');
  });

  it('resolves console URLs against this org', () => {
    expect(resolveUrl('users?q=a b', ORIGIN).href).toBe(`${ORIGIN}/api/v1/users?q=a%20b`);
    expect(resolveUrl('/api/v1/groups', ORIGIN).href).toBe(`${ORIGIN}/api/v1/groups`);
    expect(resolveUrl('https://acme.okta.com/api/v1/apps?limit=2', ORIGIN).href).toBe(
      `${ORIGIN}/api/v1/apps?limit=2`,
    );
  });

  it("reads Okta's step-up challenge for a protected action", () => {
    // As Okta sends it for `PUT /api/v1/idps/{id}`.
    const header =
      'error="insufficient_user_authentication", authorization_uri="/admin/sso/oidc-entry", max_age="60" , acr_values="urn:okta:loa:2fa:any"';
    const challenge = stepUpChallenge(401, header);
    expect(challenge).toEqual({ maxAge: '60', acrValues: 'urn:okta:loa:2fa:any' });
    expect(stepUpUrl(challenge!, ORIGIN)).toBe(
      `${ORIGIN}/admin/sso/step-up?max_age=60&acr_values=urn%3Aokta%3Aloa%3A2fa%3Aany`,
    );
    expect(stepUpChallenge(403, header)).toBeUndefined();
    expect(stepUpChallenge(401, 'Bearer error="invalid_token"')).toBeUndefined();
    expect(stepUpChallenge(401, null)).toBeUndefined();
  });
});

describe('format', () => {
  const users = [
    { id: '1', status: 'ACTIVE', profile: { login: 'a@x.com', tags: ['x'] }, _links: {} },
    { id: '2', created: null, profile: { login: 'b@x.com' } },
  ];

  it('makes tables of object lists', () => {
    expect(isTable(users)).toBe(true);
    expect(isTable([])).toBe(false);
    expect(isTable([1, 2])).toBe(false);
    expect(tableColumns(users)).toEqual(['id', 'status', 'created', 'profile.login']);
    expect(cell(users[0]!, 'profile.login')).toBe('a@x.com');
    expect(cell(users[1]!, 'status')).toBe('');
  });

  it('reads Okta errors', () => {
    expect(
      oktaError({
        errorSummary: 'Api validation failed: name',
        errorCauses: [{ errorSummary: 'name: The field cannot be left blank' }],
      }),
    ).toEqual(['Api validation failed: name', 'name: The field cannot be left blank']);
    expect(oktaError({ id: '1' })).toBeUndefined();
  });

  it('formats sizes and times', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(timeAgo(0, 30_000)).toBe('just now');
    expect(timeAgo(0, 3 * 3600_000)).toBe('3h ago');
  });
});

describe('csv', () => {
  it('flattens nested fields and leaves out links', () => {
    expect(
      flatten({ id: '1', credentials: { provider: { type: 'OKTA' } }, tags: ['a'], _links: {} }),
    ).toEqual({ id: '1', 'credentials.provider.type': 'OKTA', tags: ['a'] });
  });

  it('writes every field of every row, quoting where needed', () => {
    const csv = toCsv([
      { id: '1', profile: { name: 'Lovelace, Ada', title: 'Said "hi"' } },
      { id: '2', profile: { note: 'two\nlines' }, groups: ['a', 'b'], active: false, x: null },
    ]);
    expect(csv.split('\r\n')).toEqual([
      'id,profile.name,profile.title,profile.note,groups,active,x',
      '1,"Lovelace, Ada","Said ""hi""",,,,',
      '2,,,"two\nlines","[""a"",""b""]",false,',
    ]);
  });

  it('names files after the path', () => {
    const date = new Date('2026-10-31T12:00:00Z');
    expect(csvFilename('/api/v1/users?limit=200', date)).toBe('users-2026-10-31.csv');
    expect(csvFilename('groups/00g1/users', date)).toBe('groups-00g1-users-2026-10-31.csv');
    expect(csvFilename('/oauth2/v1/clients', date)).toBe('oauth2-v1-clients-2026-10-31.csv');
  });
});

describe('history', () => {
  const entry = (id: string, url: string): HistoryEntry => ({
    id,
    method: 'GET',
    url,
    body: '',
    status: 200,
    ms: 10,
    at: 0,
  });

  it('moves a repeated request to the top', () => {
    const history = [entry('2', '/b'), entry('1', '/a')];
    expect(addToHistory(history, entry('3', '/a')).map((e) => e.id)).toEqual(['3', '2']);
  });

  it('keeps the responses of only the latest entries', () => {
    const saved = (id: string) => ({ ...entry(id, `/${id}`), saved: true });
    const history = Array.from({ length: RESPONSE_LIMIT }, (_, i) => saved(String(i)));
    const next = addToHistory(history, saved('new'));
    expect(next).toHaveLength(RESPONSE_LIMIT + 1);
    expect(savedIds(next).size).toBe(RESPONSE_LIMIT);
    expect(savedIds(next).has('new')).toBe(true);
    expect(next.at(-1)).toEqual(entry(String(RESPONSE_LIMIT - 1), `/${RESPONSE_LIMIT - 1}`));
  });

  it("doesn't count entries without a saved response", () => {
    const history = [entry('2', '/b'), { ...entry('1', '/a'), saved: true }];
    expect(savedIds(addToHistory(history, entry('3', '/c')))).toEqual(new Set(['1']));
  });
});

describe('page context', () => {
  const at = (href: string) => pageContext(new URL(href, ORIGIN));

  it('reads the IDs of the objects a page shows', () => {
    expect(at('/admin/user/profile/view/00u1abcdefghijklmnop#tab-groups')).toEqual({
      userId: '00u1abcdefghijklmnop',
    });
    expect(at('/admin/group/00g1abcdefghijklmnop')).toEqual({ groupId: '00g1abcdefghijklmnop' });
    expect(at('/admin/app/acme_app_1/instance/0oa1abcdefghijklmnop/#tab-general')).toEqual({
      appId: '0oa1abcdefghijklmnop',
      appName: 'acme_app_1',
    });
    expect(at('/admin/access/identity-providers/edit/0oa2abcdefghijklmnop')).toEqual({
      idpId: '0oa2abcdefghijklmnop',
    });
    expect(at('/admin/dashboard')).toEqual({});
  });

  it('fills templates from it', () => {
    const context = { userId: '00u1' };
    expect(fillTemplate('/api/v1/users/{userId}/groups/{groupId}', context)).toBe(
      '/api/v1/users/00u1/groups/{groupId}',
    );
    expect(placeholders('/api/v1/users/00u1/groups/{groupId}')).toEqual(['groupId']);
  });
});

describe('suggestions', () => {
  const endpoints: Endpoint[] = [
    {
      m: 'GET',
      p: '/api/v1/users',
      s: 'List all users',
      t: 'User',
      id: 'listUsers',
      q: [
        { n: 'search', ty: 'string', d: 'Searches for users.', x: ['status eq "STAGED"'] },
        { n: 'limit', ty: 'integer' },
      ],
    },
    { m: 'POST', p: '/api/v1/users', s: 'Create a user', t: 'User' },
    { m: 'GET', p: '/api/v1/users/{userId}', s: 'Retrieve a user', t: 'User' },
    { m: 'GET', p: '/api/v1/users/me', s: 'Retrieve the current user', t: 'User' },
    { m: 'GET', p: '/api/v1/users/{userId}/groups', s: 'List all groups of a user', t: 'User' },
    { m: 'GET', p: '/api/v1/groups/{groupId}/users', s: 'List all member users', t: 'Group' },
  ];
  const labels = (suggestions: Suggestion[]) => suggestions.map((s) => `${s.method} ${s.url}`);

  it('completes paths as they are typed', () => {
    expect(labels(suggest('use', 'GET', {}, endpoints))).toEqual([
      'GET /api/v1/users',
      'POST /api/v1/users',
      'GET /api/v1/users/{userId}',
      'GET /api/v1/users/me',
      'GET /api/v1/users/{userId}/groups',
    ]);
    expect(labels(suggest('/api/v1/users/00u9/g', 'GET', {}, endpoints))).toEqual([
      'GET /api/v1/users/00u9/groups',
    ]);
  });

  it("fills path parameters from the page and suggests the page's endpoints", () => {
    const context = { userId: '00u1' };
    expect(labels(suggest('users/', 'GET', context, endpoints))).toContain(
      'GET /api/v1/users/00u1/groups',
    );
    expect(labels(suggest('', 'GET', context, endpoints))).toEqual([
      'GET /api/v1/users/00u1',
      'GET /api/v1/users/00u1/groups',
    ]);
    expect(objectPath('userId', context, endpoints)).toBe('/api/v1/users/00u1');
  });

  it('searches summaries for words', () => {
    expect(labels(suggest('member users', 'GET', {}, endpoints))).toEqual([
      'GET /api/v1/groups/{groupId}/users',
    ]);
  });

  it('suggests query parameters after ?', () => {
    expect(suggest('users?limit=5&s', 'GET', {}, endpoints).map((s) => s.url)).toEqual([
      'users?limit=5&search=',
    ]);
    expect(suggest('users?limit=', 'GET', {}, endpoints)).toEqual([]);
  });

  it("describes query parameters and suggests a parameter's examples", () => {
    const [search] = suggest('users?s', 'GET', {}, endpoints);
    expect(search).toMatchObject({
      kind: 'param',
      detail: 'Searches for users.',
      type: 'string',
      example: 'status eq "STAGED"',
    });
    expect(suggest('users?search=st', 'GET', {}, endpoints).map((s) => s.url)).toEqual([
      'users?search=status eq "STAGED"',
    ]);
    expect(suggest('users?search=status eq "STAGED"', 'GET', {}, endpoints)).toEqual([]);
  });

  it('finds the endpoint a request goes to, and its docs', () => {
    const get = (url: string) => endpointFor(url, 'GET', endpoints)?.p;
    expect(get('users?limit=5')).toBe('/api/v1/users');
    expect(get('/api/v1/users/00u1')).toBe('/api/v1/users/{userId}');
    expect(get('/api/v1/users/{userId}')).toBe('/api/v1/users/{userId}');
    expect(get('/api/v1/users/me')).toBe('/api/v1/users/me');
    expect(get('/api/v1/use')).toBeUndefined();
    expect(endpointFor('users', 'DELETE', endpoints)).toBeUndefined();
    expect(docsUrl(endpoints[0]!)).toBe(
      'https://developer.okta.com/docs/api/openapi/okta-management/management/tags/user/other/listusers',
    );
  });
});

describe('body hints', () => {
  const endpoints: Endpoint[] = [
    { m: 'GET', p: '/api/v1/users/{userId}', s: 'Retrieve a user', t: 'User' },
    { m: 'POST', p: '/api/v1/users/{userId}', s: 'Update a user', t: 'User' },
    { m: 'GET', p: '/api/v1/users/me', s: 'Retrieve the current user', t: 'User' },
    { m: 'POST', p: '/api/v1/users', s: 'Create a user', t: 'User' },
  ];
  const fields: BodyField[] = [
    { p: 'credentials', t: 'object' },
    { p: 'credentials.password', t: 'object' },
    { p: 'credentials.password.value', t: 'string', r: 1 },
    { p: 'groupIds', t: 'string[]' },
    { p: 'profile', t: 'object', r: 1 },
    { p: 'profile.login', t: 'string', r: 1 },
    { p: 'profile.email', t: 'string', r: 1 },
    { p: 'profile.city', t: 'string' },
    { p: 'roles', t: 'object[]' },
    { p: 'roles[].type', t: 'string', r: 1, e: ['SUPER_ADMIN', 'ORG_ADMIN'] },
    { p: 'type', t: 'string', r: 1, e: ['OKTA', 'SAML'] },
  ];
  const schema: BodySchema = { f: fields };
  /** `|` marks the cursor. */
  const at = (text: string) => [text.replace('|', ''), text.indexOf('|')] as const;
  const labels = (text: string) => {
    const [doc, pos] = at(text);
    return completionsAt(doc, pos, schema)?.options.map((o) => o.label);
  };
  const problems = (body: unknown) =>
    lintBody(typeof body === 'string' ? body : JSON.stringify(body), schema).map((p) => p.message);
  it("finds a whole URL's endpoint by method, preferring literal paths", () => {
    const find = (url: string, method: 'GET' | 'POST') => endpointFor(url, method, endpoints)?.s;
    expect(find('users', 'POST')).toBe('Create a user');
    expect(find('/api/v1/users?activate=true', 'POST')).toBe('Create a user');
    expect(find('https://acme.okta.com/api/v1/users/00u1', 'POST')).toBe('Update a user');
    expect(find('users/{userId}', 'POST')).toBe('Update a user');
    expect(find('users/me', 'GET')).toBe('Retrieve the current user');
    expect(find('use', 'POST')).toBeUndefined();
    expect(find('users/me', 'POST')).toBe('Update a user');
  });

  it('reads where the cursor is in half-typed JSON', () => {
    const cursor = (text: string) => {
      const [doc, pos] = at(text);
      const c = cursorAt(doc, pos);
      return c && { path: c.path, slot: c.slot, key: c.key, prefix: c.prefix, keys: c.keys };
    };
    expect(cursor('{|')).toEqual({ path: '', slot: 'key', prefix: '', keys: [] });
    expect(cursor('{"type": "OKTA", "profile": {"lo|"}}')).toEqual({
      path: 'profile',
      slot: 'key',
      prefix: 'lo',
      keys: [],
    });
    expect(cursor('{"profile": {}, "type": "O|')).toMatchObject({ slot: 'value', key: 'type' });
    expect(cursor('{"roles": [{"type": "SUPER_ADMIN"}, {"ty|')).toMatchObject({
      path: 'roles[]',
      keys: [],
    });
    // A missing comma before a key still reads as a key.
    expect(cursor('{"type": "OKTA"\n  "|"')).toMatchObject({ slot: 'key', keys: ['type'] });
    expect(cursor('{"a": "x, {y}|"')).toMatchObject({ slot: 'value', prefix: 'x, {y}' });
    expect(cursor('|')).toBeUndefined();
    expect(keyAt('{"profile": {"login": 1}}', 15)).toEqual({
      path: 'profile.login',
      from: 13,
      to: 20,
    });
  });

  it("completes an object's other keys, required first, and allowed values", () => {
    expect(labels('{"type": "OKTA", |}')).toEqual(['profile', 'credentials', 'groupIds', 'roles']);
    expect(labels('{"profile": {"login": "a", "|"}}')).toEqual(['email', 'city']);
    expect(labels('{"roles": [{"|"}]}')).toEqual(['type']);
    expect(labels('{"type": "|"}')).toEqual(['OKTA', 'SAML']);
    expect(labels('{"roles": [{"type": |}]}')).toEqual(['SUPER_ADMIN', 'ORG_ADMIN']);
    expect(labels('{"profile": {"city": |}}')).toBeUndefined();

    const [doc, pos] = at('{"type": "OKTA", "pro|"}');
    const result = completionsAt(doc, pos, schema)!;
    // Replaces the half-typed key and the quote that closed itself.
    expect([result.from, result.to, result.typing]).toEqual([17, 22, true]);
    expect(result.options[0]).toMatchObject({
      label: 'profile',
      snippet: '"profile": {\n\t${}\n}',
      required: true,
    });
    expect(result.options.find((o) => o.label === 'groupIds')?.snippet).toBe('"groupIds": [${}]');
  });

  it('keeps positions when parsing JSON', () => {
    expect(parseJson('{"a": [1, true]}')).toEqual({
      kind: 'object',
      from: 0,
      to: 16,
      props: [
        {
          key: 'a',
          keyFrom: 1,
          keyTo: 4,
          value: {
            kind: 'array',
            from: 6,
            to: 15,
            items: [
              { kind: 'number', from: 7, to: 8, value: 1 },
              { kind: 'boolean', from: 10, to: 14, value: true },
            ],
          },
        },
      ],
    });
    expect(parseJson('{"a": }')).toBeUndefined();
    expect(parseJson('{"a": 1} x')).toBeUndefined();
  });

  it('underlines missing, unknown, mistyped and disallowed fields', () => {
    expect(problems({})).toEqual(['Missing required fields: profile, type.']);
    expect(problems({ profile: { login: 'a@x.com' }, type: 'OKTA' })).toEqual([
      'Missing required field in profile: email.',
    ]);
    expect(
      problems({ profile: { login: 'a', email: 'a' }, type: 'OKTA', credentials: {} }),
    ).toEqual([]);
    expect(
      problems({
        profile: { login: 'a', email: 'a' },
        type: 'LDAP',
        credentials: { password: {} },
        roles: [{ type: 'ORG_ADMIN' }, {}],
        groupIds: 'x',
        nickname: 'Al',
      }),
    ).toEqual([
      '"LDAP" isn\'t an allowed type: OKTA, SAML.',
      'Missing required field in credentials.password: value.',
      'Missing required field in roles[]: type.',
      'groupIds should be an array, not a string.',
      'Unknown field "nickname".',
    ]);
    // Where it's reported: the key of the object missing something.
    const [missing] = lintBody('{"type": "OKTA", "profile": {}}', schema);
    expect(missing).toMatchObject({ from: 17, to: 26, severity: 'error' });
    // Objects that take other fields, and enums with more values than listed, aren't flagged.
    expect(
      lintBody(
        JSON.stringify({ profile: { login: 'a', email: 'a', custom: 1 }, type: 'OKTA', x: 1 }),
        { f: fields.map((f) => (f.p === 'profile' ? { ...f, a: 1 } : f)), a: 1 },
      ),
    ).toEqual([]);
    expect(problems('{"type": ')).toEqual([]);
  });

  it('starts a body from the required fields when there are no examples', () => {
    expect(skeleton(fields)).toEqual({ profile: { login: '', email: '' }, type: 'OKTA' });
  });
});
