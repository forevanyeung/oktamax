import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Field, FormView } from '../../form/schema';
import type { AppUserSchema } from '../../okta/types';
import { groupAssignmentView, userAssignmentView } from '../apps/assignments';

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

const labels = (view: FormView) => view.sections.flatMap((s) => s.fields.map((f) => f.label));

const schema: AppUserSchema = {
  definitions: {
    base: {
      properties: { userName: { title: 'Username', type: 'string', scope: 'NONE' } },
    },
    custom: {
      properties: {
        role: {
          title: 'Role',
          type: 'string',
          scope: 'NONE',
          oneOf: [
            { const: 'admin', title: 'Administrator' },
            { const: 'user', title: 'User' },
          ],
        },
        costCenter: { type: 'string', scope: 'SELF' },
        licensed: { title: 'Licensed', type: 'boolean', scope: 'NONE' },
      },
    },
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('userAssignmentView', () => {
  it('mirrors "Edit User Assignment" for a user assigned through a group', async () => {
    mockApi({
      '/api/v1/apps/0oa1/users/00u1': {
        id: '00u1',
        scope: 'GROUP',
        credentials: { userName: 'ada@example.com' },
        profile: { role: 'admin', costCenter: 'R&D', licensed: true },
      },
      '/api/v1/meta/schemas/apps/0oa1/default': schema,
    });
    const view = await userAssignmentView('0oa1', '00u1');
    expect(labels(view)).toEqual([
      'Assignment master',
      'Username',
      'Role',
      'Cost center',
      'Licensed',
    ]);
    expect(field(view, 'Assignment master')).toMatchObject({ type: 'radio', value: 'GROUP' });
    expect(field(view, 'Username')).toMatchObject({ type: 'text', value: 'ada@example.com' });
    expect(field(view, 'Role')).toMatchObject({ type: 'select', value: 'admin' });
    expect(field(view, 'Licensed')).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('only offers "Assignment master" to direct assignees who are also in an assigned group', async () => {
    const appUser = { id: '00u2', scope: 'USER', credentials: { userName: 'bob' }, profile: {} };
    mockApi({
      '/api/v1/apps/0oa2/users/00u2': appUser,
      '/api/v1/meta/schemas/apps/0oa2/default': schema,
      '/api/v1/apps/0oa2/groups': [{ id: '00g1' }],
      '/api/v1/users/00u2/groups': [{ id: '00g2', profile: { name: 'Other' } }],
    });
    expect(labels(await userAssignmentView('0oa2', '00u2'))).not.toContain('Assignment master');

    mockApi({
      '/api/v1/apps/0oa3/users/00u3': { ...appUser, id: '00u3' },
      '/api/v1/meta/schemas/apps/0oa3/default': schema,
      '/api/v1/apps/0oa3/groups': [{ id: '00g1' }],
      '/api/v1/users/00u3/groups': [{ id: '00g1', profile: { name: 'Assigned' } }],
    });
    expect(field(await userAssignmentView('0oa3', '00u3'), 'Assignment master')).toMatchObject({
      value: 'USER',
    });
  });
});

describe('groupAssignmentView', () => {
  it('shows only the attributes that can be set at a group level', async () => {
    mockApi({
      '/api/v1/apps/0oa4': { id: '0oa4', label: 'Acme' },
      '/api/v1/apps/0oa4/groups/00g1': { id: '00g1', profile: { role: 'user' } },
      '/api/v1/meta/schemas/apps/0oa4/default': schema,
    });
    const view = await groupAssignmentView('0oa4', '00g1');
    expect(labels(view)).toEqual(['Role', 'Licensed']);
    expect(field(view, 'Role')).toMatchObject({ value: 'user' });
  });

  it('explains when there are no group-level attributes, like Okta does', async () => {
    mockApi({
      '/api/v1/apps/0oa5': { id: '0oa5', label: 'Acme' },
      '/api/v1/apps/0oa5/groups/00g1': { id: '00g1', profile: {} },
      '/api/v1/meta/schemas/apps/0oa5/default': {
        definitions: { base: { properties: schema.definitions!.base!.properties } },
      },
    });
    const [only] = (await groupAssignmentView('0oa5', '00g1')).sections[0]!.fields;
    expect(only).toMatchObject({
      type: 'note',
      text: expect.stringMatching(/^There are no Acme user attributes that can be set/),
    });
  });
});
