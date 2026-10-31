import { isVisible } from '../../content/dom';
import {
  checkbox,
  note,
  radio,
  section,
  select,
  tags,
  text,
  type Field,
  type FormView,
} from '../../form/schema';
import { get, getAll } from '../../okta/api';
import type {
  App,
  AppGroup,
  AppUser,
  AppUserSchema,
  Group,
  SchemaProperty,
} from '../../okta/types';
import { humanize } from '../format';
import type { ViewTarget } from '../types';

const ASSIGNMENT_MASTER = { GROUP: 'Group', USER: 'Administrator (overrides group)' };

/** The app user profile attributes, in the order Okta's assignment dialogs list them. */
const schemaProperties = (schema: AppUserSchema): Array<[string, SchemaProperty]> => [
  ...Object.entries(schema.definitions?.base?.properties ?? {}),
  ...Object.entries(schema.definitions?.custom?.properties ?? {}),
];

const choices = (p: { enum?: unknown[]; oneOf?: Array<{ const: unknown; title: string }> }) =>
  p.oneOf
    ? Object.fromEntries(p.oneOf.map((o) => [String(o.const), o.title]))
    : p.enum && Object.fromEntries(p.enum.map((v) => [String(v), String(v)]));

function attributeField(key: string, p: SchemaProperty, value: unknown): Field {
  const label = p.title ?? humanize(key);
  if (p.type === 'boolean') return checkbox(label, value === true);
  if (p.type === 'array') {
    const labels = choices(p.items ?? {}) ?? {};
    return tags(
      label,
      (Array.isArray(value) ? value : []).map((v) => labels[String(v)] ?? String(v)),
    );
  }
  const options = choices(p);
  const str = value === null || value === undefined ? '' : String(value);
  return options ? select(label, str, options) : text(label, str);
}

/**
 * The app's assigned groups the user is in, by assignment priority (Okta takes
 * the user's profile from the first). Falls back to the group the API reports.
 */
async function assignedGroups(appId: string, appUser: AppUser): Promise<string[]> {
  const fallback = appUser._links?.group?.name ? [appUser._links.group.name] : [];
  try {
    const [assigned, memberOf] = await Promise.all([
      getAll<AppGroup>(`/api/v1/apps/${appId}/groups?limit=200`),
      getAll<Group>(`/api/v1/users/${appUser.id}/groups?limit=200`),
    ]);
    const names = assigned
      .toSorted((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))
      .flatMap((a) => memberOf.find((g) => g.id === a.id)?.profile.name ?? []);
    return names.length ? names : fallback;
  } catch {
    return fallback;
  }
}

/** Assignments tab › People › "Edit User Assignment" */
export async function userAssignmentView(appId: string, userId: string): Promise<FormView> {
  const [appUser, schema] = await Promise.all([
    get<AppUser>(`/api/v1/apps/${appId}/users/${userId}`),
    get<AppUserSchema>(`/api/v1/meta/schemas/apps/${appId}/default`),
  ]);
  const groups = await assignedGroups(appId, appUser);

  return {
    width: 680,
    sections: [
      // Okta only offers "Assignment master" to users who are in an assigned group.
      (groups.length > 0 || appUser.scope === 'GROUP') &&
        section(undefined, [
          radio('Assignment master', appUser.scope, ASSIGNMENT_MASTER),
          // Not in Okta's dialog: which assigned groups give this user access.
          tags(
            'Assigned through groups',
            groups,
            groups.length > 1 && appUser.scope === 'GROUP'
              ? `The profile comes from ${groups[0]}, the highest-priority group.`
              : undefined,
          ),
        ]),
      section(
        undefined,
        schemaProperties(schema).map(([key, p]) =>
          attributeField(
            key,
            p,
            key === 'userName' ? appUser.credentials?.userName : appUser.profile?.[key],
          ),
        ),
      ),
    ].filter((s) => s !== false),
    raw: appUser,
  };
}

/** Assignments tab › Groups › "Edit Group Assignment" */
export async function groupAssignmentView(appId: string, groupId: string): Promise<FormView> {
  const [app, appGroup, schema] = await Promise.all([
    get<App>(`/api/v1/apps/${appId}`),
    get<AppGroup>(`/api/v1/apps/${appId}/groups/${groupId}`),
    get<AppUserSchema>(`/api/v1/meta/schemas/apps/${appId}/default`),
  ]);
  // The username is per user; only attributes not limited to the user can be set on a group.
  const groupLevel = schemaProperties(schema).filter(
    ([key, p]) => key !== 'userName' && p.scope !== 'SELF',
  );

  return {
    width: 700,
    sections: [
      section(
        undefined,
        groupLevel.length
          ? groupLevel.map(([key, p]) => attributeField(key, p, appGroup.profile?.[key]))
          : [
              note(
                `There are no ${app.label} user attributes that can be set at a group level. ` +
                  `You can edit an individual's ${app.label} user attributes under the People tab for ${app.label}.`,
              ),
            ],
      ),
    ],
    raw: appGroup,
  };
}

const ROW = 'tr, [role="row"]';

/** Assignment rows link to the user's / group's page; read-only admins get no actions cell. */
function findRows(link: RegExp) {
  return [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].flatMap((anchor) => {
    const id = anchor.getAttribute('href')?.match(link)?.[1];
    const row = anchor.closest(ROW);
    return id && row && isVisible(anchor) ? [{ id, anchor, row }] : [];
  });
}

export function assignmentTargets(appId: string): ViewTarget[] {
  const users = findRows(/^\/admin\/user\/profile\/view\/(\w+)$/).map(({ id, anchor, row }) => ({
    key: `app-user:${appId}:${id}`,
    title: 'View User Assignment',
    anchor,
    scope: row,
    load: () => userAssignmentView(appId, id),
  }));
  const groups = findRows(/^\/admin\/group\/(\w+)$/).map(({ id, anchor, row }) => ({
    key: `app-group:${appId}:${id}`,
    title: 'View Group Assignment',
    anchor,
    scope: row,
    load: () => groupAssignmentView(appId, id),
  }));
  return [...users, ...groups];
}
