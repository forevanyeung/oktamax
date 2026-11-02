/**
 * A guide to Okta's MCP server for Gemini Nano. The evals (`evals/`) showed Nano
 * can't drive okta-mcp-server's 47 tools directly: picking from them took up to
 * 30 s, and it made up IDs and filter syntax Okta rejects. So it gets a few
 * tools that take names and fixed choices instead, each calling the MCP
 * server's tools: they look IDs up, write the filters, and return only what an
 * answer needs. Which ones it's offered is picked from the question's words and
 * the page, without asking the model.
 *
 * Every Okta call still goes through okta-mcp-server (and only its read tools).
 */
import type { MCPClient } from '@ai-sdk/mcp';
import { jsonSchema, tool, type JSONSchema7, type Tool } from 'ai';

import type { PageContext } from '@oktamax/shared';
import { NAVIGATE, OPEN_IN_API_CONSOLE, type PageToolOutput } from '@oktamax/shared/pageTools';

import { isReadOnlyTool, SEE_CONSOLE } from './oktaMcp';

type McpTools = Awaited<ReturnType<MCPClient['tools']>>;

const MAX_ITEMS = 25;
const MAX_STATUS_LOOKUPS = 5;

/** Calls an MCP tool and parses its JSON: a tool returning a list sends one content item each. */
async function callMcp(mcp: McpTools, name: string, args: object): Promise<unknown> {
  if (!isReadOnlyTool(name) || !mcp[name]) throw new Error(`No ${name} tool`);
  let result: { content?: Array<{ text?: string }>; isError?: boolean };
  try {
    // Called directly, not by the model: the options only need to identify the call.
    const options = { toolCallId: name, messages: [] } as never;
    const started = performance.now();
    result = (await mcp[name].execute!(args as never, options)) as typeof result;
    console.debug(`[on-device] ${name} took ${Math.round(performance.now() - started)} ms`);
  } catch (error) {
    // The offscreen document closed or crashed mid-call; the next question reopens it.
    if (error instanceof Error && error.message === 'Connection closed') {
      throw new Error(`Okta's MCP server stopped. ${SEE_CONSOLE}`);
    }
    throw error;
  }
  const parsed = (result.content ?? []).map((c) => {
    try {
      return JSON.parse(c.text ?? '') as unknown;
    } catch {
      return c.text;
    }
  });
  const value = parsed.length === 1 ? parsed[0] : parsed;
  const error =
    result.isError || typeof value === 'string'
      ? String(value)
      : (value as { error?: string } | undefined)?.error;
  if (error) throw new Error(error);
  return value;
}

/** A paginated result's items. */
const itemsOf = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : ((value as { items?: unknown[] } | undefined)?.items ?? []);

interface User {
  id: string;
  status?: string;
  profile: { login: string; email?: string; firstName?: string; lastName?: string };
}

/** list_users returns [profile, id] pairs; the others whole users. */
const asUser = (item: unknown): User =>
  Array.isArray(item)
    ? { id: item[1] as string, profile: item[0] as User['profile'] }
    : (item as User);

const userName = (u: User) => `${u.profile.firstName ?? ''} ${u.profile.lastName ?? ''}`.trim();

const briefUser = (u: User) => ({
  name: userName(u),
  login: u.profile.login,
  ...(u.status && { status: u.status }),
  id: u.id,
});

interface Group {
  id: string;
  type: string;
  profile: {
    name?: string;
    description?: string;
    actual_instance?: { name: string; description?: string };
  };
}

const groupProfile = (g: Group) => g.profile.actual_instance ?? g.profile;
const briefGroup = (g: Group) => ({
  name: groupProfile(g).name,
  kind: g.type === 'BUILT_IN' ? 'built-in' : g.type === 'APP_GROUP' ? 'from an app' : 'custom',
  description: groupProfile(g).description,
  id: g.id,
});

interface App {
  id: string;
  name: string;
  label: string;
  status: string;
  signOnMode: string;
}

const SIGN_ON: Record<string, string> = {
  SAML_2_0: 'SAML 2.0',
  SAML_1_1: 'SAML 1.1',
  OPENID_CONNECT: 'OpenID Connect (OIDC)',
  BOOKMARK: 'Bookmark',
  AUTO_LOGIN: 'Secure Web Authentication (SWA)',
  BROWSER_PLUGIN: 'Secure Web Authentication (browser plugin)',
  WS_FEDERATION: 'WS-Federation',
  BASIC_AUTH: 'Basic authentication',
};

const briefApp = (a: App) => ({
  label: a.label,
  signOn: SIGN_ON[a.signOnMode] ?? a.signOnMode,
  status: a.status,
  id: a.id,
});

/** At most MAX_ITEMS of a list, saying how many there are. */
const listOf = <T>(key: string, items: T[]) => ({
  count: items.length,
  [key]: items.slice(0, MAX_ITEMS),
  ...(items.length > MAX_ITEMS && { note: `Only the first ${MAX_ITEMS} are listed.` }),
});

const MAX_SUMMARY_ITEMS = 10;

/** "A, B and C", with "and N more" past MAX_SUMMARY_ITEMS. */
function listed(items: string[]) {
  if (items.length === 0) return 'none';
  const shown = items.slice(0, MAX_SUMMARY_ITEMS);
  const more = items.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return shown.length === 1 ? shown[0]! : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

const describeUser = (u: User) =>
  `${userName(u) || u.profile.login} (${u.profile.login}${u.status ? `, ${u.status}` : ''})`;

const words = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);

/** Users whose name, login or email contain every word of `name`. */
async function findUsers(mcp: McpTools, name: string | undefined, status?: string) {
  const args: Record<string, unknown> = { fetch_all: true };
  if (status) args.search = `status eq "${status}"`;
  else if (name?.includes('@')) args.search = `profile.login eq "${name}"`;
  else if (name) args.q = words(name)[0];
  let users = itemsOf(await callMcp(mcp, 'list_users', args)).map(asUser);
  if (status) users = users.map((u) => ({ ...u, status }));
  if (name && !name.includes('@')) {
    users = users.filter((u) =>
      words(name).every((w) =>
        `${userName(u)} ${u.profile.login} ${u.profile.email ?? ''}`.toLowerCase().includes(w),
      ),
    );
  }
  // list_users leaves out status: look it up for a handful of users, the usual question.
  if (!status && users.length <= MAX_STATUS_LOOKUPS) {
    users = await Promise.all(
      users.map(async (u) => asUser(await callMcp(mcp, 'get_user', { user_id: u.id }))),
    );
  }
  return users;
}

const pageId = (page: PageContext | undefined, prefix: string) =>
  page?.objectIds.find((id) => id.startsWith(prefix));

/**
 * `resolve(ref)`, falling back to the page's object (with ID `prefix`) when `ref`
 * matches nothing: the model often names "this app" by something else on the page.
 */
async function orPage<T>(
  resolve: (ref: string | undefined, page?: PageContext) => Promise<T>,
  ref: string | undefined,
  page: PageContext | undefined,
  prefix: string,
): Promise<T> {
  try {
    return await resolve(ref, page);
  } catch (error) {
    if (
      !ref ||
      !pageId(page, prefix) ||
      !/^No \w+ matches/.test(String((error as Error).message))
    ) {
      throw error;
    }
    return resolve(undefined, page);
  }
}

/** The one user `ref` names (an ID, login or name), or this page's user. */
const resolveUser = (mcp: McpTools, ref: string | undefined, page?: PageContext) =>
  orPage((r, p) => resolveUserOnly(mcp, r, p), ref, page, '00u');
const resolveGroup = (mcp: McpTools, ref: string | undefined, page?: PageContext) =>
  orPage((r, p) => resolveGroupOnly(mcp, r, p), ref, page, '00g');
const resolveApp = (mcp: McpTools, ref: string | undefined, page?: PageContext) =>
  orPage((r, p) => resolveAppOnly(mcp, r, p), ref, page, '0oa');

async function resolveUserOnly(mcp: McpTools, ref: string | undefined, page?: PageContext) {
  const id = ref?.match(/^00u\w{17}$/)?.[0] ?? (ref ? undefined : pageId(page, '00u'));
  if (id) return asUser(await callMcp(mcp, 'get_user', { user_id: id }));
  if (!ref) throw new Error('Which user? Give their name or login.');
  const [user, ...more] = await findUsers(mcp, ref);
  if (!user) throw new Error(`No user matches "${ref}".`);
  if (more.length > 0) {
    throw new Error(
      `"${ref}" matches several users: ${[user, ...more].map((u) => u.profile.login).join(', ')}.`,
    );
  }
  return user.status ? user : asUser(await callMcp(mcp, 'get_user', { user_id: user.id }));
}

/** The group `ref` names (an ID or name), or this page's group. */
async function resolveGroupOnly(mcp: McpTools, ref: string | undefined, page?: PageContext) {
  const id = ref?.match(/^00g\w{17}$/)?.[0] ?? (ref ? undefined : pageId(page, '00g'));
  if (id) return (await callMcp(mcp, 'get_group', { group_id: id })) as Group;
  if (!ref) throw new Error('Which group? Give its name.');
  const groups = itemsOf(await callMcp(mcp, 'list_groups', { q: ref })) as Group[];
  const exact = groups.find((g) => groupProfile(g).name?.toLowerCase() === ref.toLowerCase());
  if (!exact && groups.length !== 1) {
    throw new Error(
      groups.length === 0
        ? `No group matches "${ref}".`
        : `"${ref}" matches several groups: ${groups.map((g) => groupProfile(g).name).join(', ')}.`,
    );
  }
  return exact ?? groups[0]!;
}

/** The app `ref` names (an ID or label), or this page's app. */
async function resolveAppOnly(mcp: McpTools, ref: string | undefined, page?: PageContext) {
  const id = ref?.match(/^0oa\w{17}$/)?.[0] ?? (ref ? undefined : pageId(page, '0oa'));
  if (id) return (await callMcp(mcp, 'get_application', { app_id: id })) as App;
  if (!ref) throw new Error('Which app? Give its name.');
  const apps = itemsOf(await callMcp(mcp, 'list_applications', { q: ref })) as App[];
  const exact = apps.find((a) => a.label.toLowerCase() === ref.toLowerCase());
  if (!exact && apps.length !== 1) {
    throw new Error(
      apps.length === 0
        ? `No app matches "${ref}".`
        : `"${ref}" matches several apps: ${apps.map((a) => a.label).join(', ')}.`,
    );
  }
  return exact ?? apps[0]!;
}

const STATUSES = [
  'ACTIVE',
  'STAGED',
  'PROVISIONED',
  'SUSPENDED',
  'LOCKED_OUT',
  'RECOVERY',
  'PASSWORD_EXPIRED',
  'DEPROVISIONED',
];
const SIGN_ON_CHOICES: Record<string, string[]> = {
  saml: ['SAML_2_0', 'SAML_1_1'],
  oidc: ['OPENID_CONNECT'],
  swa: ['AUTO_LOGIN', 'BROWSER_PLUGIN'],
  bookmark: ['BOOKMARK'],
  ws_federation: ['WS_FEDERATION'],
};
const POLICY_TYPES: Record<string, string> = {
  password: 'PASSWORD',
  sign_on: 'OKTA_SIGN_ON',
  app_sign_in: 'ACCESS_POLICY',
  mfa_enrollment: 'MFA_ENROLL',
  profile_enrollment: 'PROFILE_ENROLLMENT',
};
const WHEN = ['today', 'last_24_hours', 'last_7_days'] as const;
type When = (typeof WHEN)[number];

/** The start of `when`, in the browser's time zone. */
function since(when: When = 'today') {
  const date = new Date();
  if (when === 'today') date.setHours(0, 0, 0, 0);
  else date.setTime(date.getTime() - (when === 'last_7_days' ? 7 : 1) * 86_400_000);
  return date.toISOString();
}

/** The System Log filter for sign-ins to `app`, or to Okta itself, and by `user`. */
const signInFilter = (app?: App, user?: User, failures?: boolean) =>
  [
    app ? `target.id eq "${app.id}"` : 'eventType eq "user.session.start"',
    user && `actor.id eq "${user.id}"`,
    failures && 'outcome.result ne "SUCCESS"',
  ]
    .filter(Boolean)
    .join(' and ');

const strings = (description: string) => ({ type: 'string' as const, description });

/** Words that ask about users' status: without them, find_users isn't offered a status. */
const ASKS_STATUS =
  /\b(status|active|activated|inactive|staged|pending|locked|suspended|deactivated|deprovisioned|expired|recovery)\b/i;

/**
 * The guide's tools, for `question` asked on `page`. Each result has a `summary`: a
 * sentence with the answer, which Nano repeats more faithfully than it reads JSON.
 */
export function guideTools(mcp: McpTools, page?: PageContext, question = ''): Record<string, Tool> {
  const call = (name: string, args: object) => callMcp(mcp, name, args);
  // "This app" is the page's, whatever Nano names it (it likes "okta").
  const thisApp = /\b(this|the) app\b|\bhere\b/i.test(question) ? pageId(page, '0oa') : undefined;
  const appOf = (app: string | undefined) =>
    thisApp ?? (app?.toLowerCase() === 'okta' ? undefined : app);
  // Nano filters by status unasked ("how many users" became "how many active users").
  const statusChoice: Record<string, JSONSchema7> = ASKS_STATUS.test(question)
    ? { status: { type: 'string', enum: STATUSES } }
    : {};

  return {
    find_users: tool({
      description:
        'Find users by name or login (with their status), or by a status the admin asks about. With no arguments, lists and counts every user.',
      inputSchema: jsonSchema<{ name?: string; status?: string }>({
        type: 'object',
        properties: { name: strings('Part of a name, login or email'), ...statusChoice },
      }),
      execute: async ({ name, status }) => {
        // Nano passes the question's noun as a name ("users"): that means everyone.
        if (name && /^(all\s+)?(users?|people|everyone|accounts?)$/i.test(name.trim()))
          name = undefined;
        // A name finds the user, whose status the summary gives: Nano adds a status unasked.
        if (name) status = undefined;
        const users = await findUsers(mcp, name, status?.toUpperCase());
        const which = [
          status && `with status ${status.toUpperCase()}`,
          name && `matching "${name}"`,
        ]
          .filter(Boolean)
          .join(' ');
        return {
          summary: `${plural(users.length, 'user')}${which ? ` ${which}` : ' in the org'}: ${listed(users.map(describeUser))}.`,
          ...listOf('users', users.map(briefUser)),
        };
      },
    }),
    user_details: tool({
      description:
        "A user's status, email, department and other profile details. Omit user for this page's user.",
      inputSchema: jsonSchema<{ user?: string }>({
        type: 'object',
        properties: { user: strings('Name, login or ID') },
      }),
      execute: async ({ user }) => {
        const u = await resolveUser(mcp, user, page);
        const { additional_properties: _, ...profile } = u.profile as User['profile'] & {
          additional_properties?: unknown;
        };
        return {
          summary: `${describeUser(u)} is ${u.status}${u.profile.email ? `; email ${u.profile.email}` : ''}.`,
          ...briefUser(u),
          status: u.status,
          profile,
        };
      },
    }),
    user_groups: tool({
      description: "The groups a user is in. Omit user for this page's user.",
      inputSchema: jsonSchema<{ user?: string }>({
        type: 'object',
        properties: { user: strings('Name, login or ID') },
      }),
      execute: async ({ user }) => {
        const u = await resolveUser(mcp, user, page);
        const groups = itemsOf(await call('list_user_groups', { user_id: u.id })) as Group[];
        const names = groups.map((g) => groupProfile(g).name ?? g.id);
        return {
          summary: `${describeUser(u)} is in ${plural(groups.length, 'group')}: ${listed(names)}.`,
          user: u.profile.login,
          ...listOf('groups', groups.map(briefGroup)),
        };
      },
    }),
    find_groups: tool({
      description:
        'Find groups by name, or list (and count) them all; kind=custom leaves out built-in groups.',
      inputSchema: jsonSchema<{ name?: string; kind?: 'custom' | 'built-in' }>({
        type: 'object',
        properties: {
          name: strings('Start of the group name'),
          kind: { type: 'string', enum: ['custom', 'built-in'] },
        },
      }),
      execute: async ({ name, kind }) => {
        const groups = (
          itemsOf(
            await call('list_groups', { ...(name && { q: name }), fetch_all: true }),
          ) as Group[]
        ).map(briefGroup);
        const found = kind ? groups.filter((g) => g.kind === kind) : groups;
        return {
          summary: `${plural(found.length, kind ? `${kind} group` : 'group')}: ${listed(found.map((g) => `${g.name} (${g.kind})`))}.`,
          ...listOf('groups', found),
        };
      },
    }),
    group_members: tool({
      description: "The users in a group. Omit group for this page's group.",
      inputSchema: jsonSchema<{ group?: string }>({
        type: 'object',
        properties: { group: strings('Group name or ID') },
      }),
      execute: async ({ group }) => {
        const g = await resolveGroup(mcp, group, page);
        const users = itemsOf(
          await call('list_group_users', { group_id: g.id, fetch_all: true }),
        ).map(asUser);
        const name = groupProfile(g).name;
        return {
          summary: `${name} has ${plural(users.length, 'member')}: ${listed(users.map(describeUser))}.`,
          group: name,
          ...listOf('members', users.map(briefUser)),
        };
      },
    }),
    find_apps: tool({
      description:
        'Find apps by name or sign-on type (SAML, OIDC, ...), or list (and count) them all.',
      inputSchema: jsonSchema<{ name?: string; sign_on?: string }>({
        type: 'object',
        properties: {
          name: strings('Start of the app name'),
          sign_on: { type: 'string', enum: Object.keys(SIGN_ON_CHOICES) },
        },
      }),
      execute: async ({ name, sign_on }) => {
        let apps = itemsOf(
          await call('list_applications', { ...(name && { q: name }), fetch_all: true }),
        ) as App[];
        if (sign_on) apps = apps.filter((a) => SIGN_ON_CHOICES[sign_on]?.includes(a.signOnMode));
        const which = sign_on ? ` using ${sign_on.toUpperCase().replace('_', '-')}` : '';
        return {
          summary: `${plural(apps.length, 'app')}${which}: ${listed(apps.map((a) => `${a.label} (${SIGN_ON[a.signOnMode] ?? a.signOnMode}, ${a.status})`))}.`,
          ...listOf('apps', apps.map(briefApp)),
        };
      },
    }),
    app_details: tool({
      description:
        "An app's sign-on type (how users sign in), status and settings. Omit app for this page's app.",
      inputSchema: jsonSchema<{ app?: string }>({
        type: 'object',
        properties: { app: strings('App name or ID') },
      }),
      execute: async ({ app }) => {
        const a = (await resolveApp(mcp, app, page)) as App & {
          created?: string;
          settings?: { app?: object; signOn?: object };
          credentials?: { oauthClient?: { client_id?: string } };
        };
        return {
          summary: `${a.label} signs users in with ${SIGN_ON[a.signOnMode] ?? a.signOnMode} and is ${a.status}.`,
          ...briefApp(a),
          created: a.created,
          settings: a.settings?.app,
          clientId: a.credentials?.oauthClient?.client_id,
        };
      },
    }),
    policies: tool({
      description:
        'The policies of one type, by priority: password, sign_on (global session), app_sign_in (authentication policies), mfa_enrollment or profile_enrollment.',
      inputSchema: jsonSchema<{ type: string }>({
        type: 'object',
        properties: { type: { type: 'string', enum: Object.keys(POLICY_TYPES) } },
        required: ['type'],
      }),
      execute: async ({ type }) => {
        const policies = itemsOf(
          await call('list_policies', { type: POLICY_TYPES[type] ?? type }),
        ) as Array<{
          name: string;
          status: string;
          priority?: number;
          description?: string;
          system?: boolean;
        }>;
        return {
          summary: `${plural(policies.length, `${type.replace('_', ' ')} policy`, `${type.replace('_', ' ')} policies`)}, by priority: ${listed(policies.map((p) => `${p.name}${p.system ? ' (default)' : ''}`))}.`,
          ...listOf(
            'policies',
            policies.map((p) => ({
              name: p.name,
              status: p.status,
              priority: p.priority,
              description: p.description,
              default: p.system,
            })),
          ),
        };
      },
    }),
    sign_ins: tool({
      description:
        "Sign-ins to an app (omit app on an app's page) or to Okta, optionally by one user or only failures.",
      inputSchema: jsonSchema<{
        app?: string;
        user?: string;
        when?: When;
        failures_only?: boolean;
      }>({
        type: 'object',
        properties: {
          app: strings('App name or ID; "okta" for sign-ins to Okta itself'),
          user: strings('Name, login or ID'),
          when: { type: 'string', enum: [...WHEN] },
          failures_only: { type: 'boolean' },
        },
      }),
      execute: async ({ app, user, when, failures_only }) => {
        const ref = appOf(app);
        const a =
          ref || (app === undefined && pageId(page, '0oa'))
            ? await resolveApp(mcp, ref, page)
            : undefined;
        const u = user ? await resolveUser(mcp, user) : undefined;
        const events = itemsOf(
          await call('get_logs', {
            since: since(when),
            filter: signInFilter(a, u, failures_only),
            limit: 100,
          }),
        ) as Array<{
          published: string;
          eventType: string;
          actor?: { alternateId?: string };
          outcome?: { result?: string; reason?: string };
        }>;
        const signIns = events
          .filter((e) => (a ? e.eventType === 'user.authentication.sso' : true))
          .map((e) => ({
            time: e.published,
            user: e.actor?.alternateId,
            outcome: e.outcome?.result,
            reason: e.outcome?.reason,
          }));
        const to = a?.label ?? 'Okta';
        const failed = signIns.filter((e) => e.outcome !== 'SUCCESS').length;
        const latest = signIns
          .slice(0, 5)
          .map((e) => `${e.user} at ${new Date(e.time).toLocaleTimeString()}`);
        return {
          summary: `${plural(signIns.length, failures_only ? 'failed sign-in' : 'sign-in')} to ${to} since ${new Date(since(when)).toLocaleString()}${failed && !failures_only ? `, ${failed} of them failed` : ''}${latest.length ? `. Latest: ${listed(latest)}` : ''}.`,
          to,
          since: since(when),
          ...listOf('signIns', signIns),
        };
      },
    }),
    [NAVIGATE]: tool({
      description:
        'Take the admin to a user, group or app page, or to the users, groups or apps lists.',
      inputSchema: jsonSchema<{ to: string; name?: string }>({
        type: 'object',
        properties: {
          to: { type: 'string', enum: ['user', 'group', 'app', 'users', 'groups', 'apps'] },
          name: strings('For one user, group or app: its name, login or ID'),
        },
        required: ['to'],
      }),
      execute: async ({ to, name }): Promise<PageToolOutput & { summary?: string }> => {
        try {
          if (to === 'user') {
            const u = await resolveUser(mcp, name);
            return {
              ok: true,
              path: `/admin/user/profile/view/${u.id}`,
              summary: `Opening ${userName(u) || u.profile.login}'s profile.`,
            };
          }
          if (to === 'group') {
            const g = await resolveGroup(mcp, name);
            return {
              ok: true,
              path: `/admin/group/${g.id}`,
              summary: `Opening the ${groupProfile(g).name} group.`,
            };
          }
          if (to === 'app') {
            const a = await resolveApp(mcp, name);
            return {
              ok: true,
              path: `/admin/app/${a.name}/instance/${a.id}/`,
              summary: `Opening ${a.label}.`,
            };
          }
          return {
            ok: true,
            path: to === 'apps' ? '/admin/apps/active' : `/admin/${to}`,
            summary: `Opening the ${to} list.`,
          };
        } catch (error) {
          return { ok: false, error: String(error instanceof Error ? error.message : error) };
        }
      },
    }),
    [OPEN_IN_API_CONSOLE]: tool({
      description:
        'Bring up sign-ins (to an app, or this page\'s app) in the API console at the bottom of the page, for "show me" or "bring up".',
      inputSchema: jsonSchema<{ app?: string; when?: When }>({
        type: 'object',
        properties: { app: strings('App name or ID'), when: { type: 'string', enum: [...WHEN] } },
      }),
      execute: async ({ app, when }): Promise<PageToolOutput & { summary?: string }> => {
        try {
          const ref = appOf(app);
          const a = ref || pageId(page, '0oa') ? await resolveApp(mcp, ref, page) : undefined;
          const filter = a
            ? `${signInFilter(a)} and eventType eq "user.authentication.sso"`
            : signInFilter();
          return {
            ok: true,
            path: `/api/v1/logs?${new URLSearchParams({ since: since(when), filter })}`,
            summary: `Here are the sign-ins to ${a?.label ?? 'Okta'} since ${new Date(since(when)).toLocaleString()}, in the API console below.`,
          };
        } catch (error) {
          return { ok: false, error: String(error instanceof Error ? error.message : error) };
        }
      },
    }),
  };
}

/** Matches a request to change something: the assistant can only read. */
export const WRITE_REQUEST =
  /^\s*(please\s+)?(deactivate|activate|delete|remove|add|create|reset|unlock|suspend|unsuspend|assign|unassign|change|update|rename|disable|enable|set|make)\b/i;

const ROUTES: Array<[RegExp, string[]]> = [
  [/\b(take me|go to|navigate|open the .* page)\b/i, [NAVIGATE]],
  [
    /\b(bring up|api console|show me .*(sign.?ins?|logins?|logs?))\b/i,
    [OPEN_IN_API_CONSOLE, 'sign_ins'],
  ],
  [/\b(sign.?ins?|log.?ins?|logged in|signed in|failed|failures?|activity)\b/i, ['sign_ins']],
  [/\bpolic(y|ies)\b/i, ['policies']],
  [/\bgroups?\b.*\b(is|are)\b.*\bin\b|\bmember of\b|'s groups\b/i, ['user_groups']],
  [/\b(members?|who is in|who's in|users in|people in)\b/i, ['group_members']],
  [/\bgroups?\b/i, ['find_groups']],
  [/\b(apps?|applications?|saml|oidc|sso|bookmark)\b/i, ['find_apps', 'app_details']],
  [
    /\b(status|email|department|details?|profile|activated|locked|staged|suspended)\b/i,
    ['user_details', 'find_users'],
  ],
];

/** For questions about users that nothing more specific matched. */
const USERS = /\b(users?|people|accounts?|who)\b/i;

/** The tools for the page the admin is on, when the question doesn't say. */
function pageTools(page?: PageContext): string[] {
  if (pageId(page, '00g')) return ['group_members'];
  if (pageId(page, '0oa')) return ['app_details', 'sign_ins'];
  if (pageId(page, '00u')) return ['user_details', 'user_groups'];
  return [];
}

const MAX_TOOLS = 3;

/** The guide tools to offer for `question`, from its words and the page; empty for changes. */
export function routeTools(question: string, page?: PageContext): string[] {
  if (WRITE_REQUEST.test(question)) return [];
  const picked = ROUTES.filter(([pattern]) => pattern.test(question)).flatMap(([, tools]) => tools);
  if (picked.length === 0 && USERS.test(question)) picked.push('find_users');
  // "This group/app" and questions that name nothing go by the page.
  if (picked.length === 0 || /\b(this|here)\b/i.test(question)) picked.unshift(...pageTools(page));
  return [
    ...new Set(picked.length > 0 ? picked : ['find_users', 'find_groups', 'find_apps']),
  ].slice(0, MAX_TOOLS);
}
