import { describe, expect, it } from 'vite-plus/test';

import { fillTemplate, pageContext, placeholders } from '../context';
import { cell, formatBytes, isTable, oktaError, tableColumns, timeAgo } from '../format';
import { joinUrl, resolveUrl, splitMethod, splitUrl } from '../request';
import { addToHistory, type HistoryEntry } from '../store';
import { objectPath, suggest, type Endpoint, type Suggestion } from '../suggest';

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

  it('resolves console URLs against this org', () => {
    expect(resolveUrl('users?q=a b', ORIGIN).href).toBe(`${ORIGIN}/api/v1/users?q=a%20b`);
    expect(resolveUrl('/api/v1/groups', ORIGIN).href).toBe(`${ORIGIN}/api/v1/groups`);
    expect(resolveUrl('https://acme.okta.com/api/v1/apps?limit=2', ORIGIN).href).toBe(
      `${ORIGIN}/api/v1/apps?limit=2`,
    );
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
    { m: 'GET', p: '/api/v1/users', s: 'List all users', t: 'User', q: ['search', 'limit'] },
    { m: 'POST', p: '/api/v1/users', s: 'Create a user', t: 'User' },
    { m: 'GET', p: '/api/v1/users/{userId}', s: 'Retrieve a user', t: 'User' },
    { m: 'GET', p: '/api/v1/users/{userId}/groups', s: 'List all groups of a user', t: 'User' },
    { m: 'GET', p: '/api/v1/groups/{groupId}/users', s: 'List all member users', t: 'Group' },
  ];
  const labels = (suggestions: Suggestion[]) => suggestions.map((s) => `${s.method} ${s.url}`);

  it('completes paths as they are typed', () => {
    expect(labels(suggest('use', 'GET', {}, endpoints))).toEqual([
      'GET /api/v1/users',
      'POST /api/v1/users',
      'GET /api/v1/users/{userId}',
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
});
