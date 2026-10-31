import { describe, expect, it } from 'vite-plus/test';

import { cell, formatBytes, isTable, oktaError, tableColumns, timeAgo } from '../format';
import { joinUrl, resolveUrl, splitMethod, splitUrl } from '../request';
import { addToHistory, type HistoryEntry } from '../store';

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
