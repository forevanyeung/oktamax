/**
 * Questions for the on-device assistant, checked against the live org.
 *
 * Each case says where the admin is, what they ask, which tools a good answer
 * uses, and the facts it must contain. Facts are read from the org when the eval
 * runs (with the same read-only session), so they stay right as the org changes.
 */

/** GET from the Okta API with the admin's session. */
export type Api = <T = unknown>(path: string) => Promise<T>;

interface User {
  id: string;
  status: string;
  profile: { login: string; firstName?: string; lastName?: string };
}
interface Group {
  id: string;
  type: string;
  profile: { name: string };
}
interface App {
  id: string;
  name: string;
  label: string;
  signOnMode: string;
}

export type Fact = string | string[];

/** A user, by login or by name. */
const user = (u: User): Fact =>
  [u.profile.login, `${u.profile.firstName ?? ''} ${u.profile.lastName ?? ''}`.trim()].filter(
    Boolean,
  );

export interface Case {
  id: string;
  /** Admin console path the question is asked on; may depend on the org. */
  page: string | ((api: Api) => Promise<string>);
  question: string;
  /**
   * A good answer calls at least one of these. Empty: it shouldn't need a tool. Left out:
   * either is fine (the page may already show the answer).
   */
  tools?: string[];
  /** What the answer must contain (case-insensitive); an array is any one of its strings. */
  facts?: (api: Api) => Promise<Fact[]>;
  /** Patterns the answer must match. */
  says?: RegExp[];
  /** Checks on the tool calls themselves, e.g. a navigation's target. */
  calls?: (
    calls: Array<{ tool: string; input: unknown; output?: unknown }>,
    api: Api,
  ) => Promise<string | undefined>;
}

const users = (api: Api) => api<User[]>('/api/v1/users?limit=200');
const groups = (api: Api) => api<Group[]>('/api/v1/groups?limit=200');
const apps = (api: Api) => api<App[]>('/api/v1/apps?limit=200');
const byLogin = async (api: Api, prefix: string) =>
  (await users(api)).find((u) => u.profile.login.startsWith(prefix))!;
const byName = async (api: Api, name: string) =>
  (await groups(api)).find((g) => g.profile.name === name)!;
const bySignOn = async (api: Api, mode: string) =>
  (await apps(api)).find((a) => a.signOnMode === mode)!;

export const cases: Case[] = [
  {
    id: 'user-count',
    page: '/admin/users',
    question: 'How many users are in this org?',
    tools: ['find_users'],
    facts: async (api) => [String((await users(api)).length)],
  },
  {
    id: 'staged-users',
    page: '/admin/users',
    question: "Which users haven't been activated yet?",
    tools: ['find_users'],
    facts: async (api) => (await users(api)).filter((u) => u.status === 'STAGED').map(user),
  },
  {
    id: 'user-status',
    page: '/admin/dashboard',
    question: "What's Grace Hopper's account status?",
    tools: ['user_details', 'find_users'],
    facts: async (api) => [(await byLogin(api, 'grace.hopper')).status],
  },
  {
    id: 'user-groups',
    page: '/admin/dashboard',
    question: 'Which groups is ada.lovelace@oktamax.example in?',
    tools: ['user_groups'],
    facts: async (api) => {
      const ada = await byLogin(api, 'ada.lovelace');
      return (await api<Group[]>(`/api/v1/users/${ada.id}/groups`)).map((g) => g.profile.name);
    },
  },
  {
    id: 'groups',
    page: '/admin/groups',
    question: 'What groups do we have, apart from the built-in ones?',
    tools: ['find_groups'],
    facts: async (api) =>
      (await groups(api)).filter((g) => g.type === 'OKTA_GROUP').map((g) => g.profile.name),
  },
  {
    id: 'group-members-here',
    page: async (api) => `/admin/group/${(await byName(api, 'Oktamax Engineering')).id}`,
    question: 'Who is in this group?',
    tools: ['group_members'],
    facts: async (api) => {
      const group = await byName(api, 'Oktamax Engineering');
      return (await api<User[]>(`/api/v1/groups/${group.id}/users`)).map(user);
    },
  },
  {
    id: 'saml-apps',
    page: '/admin/apps/active',
    question: 'Which apps use SAML?',
    tools: ['find_apps'],
    facts: async (api) =>
      (await apps(api)).filter((a) => a.signOnMode === 'SAML_2_0').map((a) => a.label),
  },
  {
    id: 'app-here',
    page: async (api) => {
      const app = await bySignOn(api, 'SAML_2_0');
      return `/admin/app/${app.name}/instance/${app.id}/`;
    },
    question: 'How do users sign in to this app?',
    // The app's page shows its sign-on type, so answering from it is fine too.
    says: [/SAML/i],
  },
  {
    id: 'password-policies',
    page: '/admin/access/authenticators',
    question: 'What password policies are there?',
    tools: ['policies'],
    facts: async (api) =>
      (await api<Array<{ name: string }>>('/api/v1/policies?type=PASSWORD')).map((p) => p.name),
  },
  {
    id: 'todays-sign-ins',
    page: async (api) => {
      const app = await bySignOn(api, 'OPENID_CONNECT');
      return `/admin/app/${app.name}/instance/${app.id}/`;
    },
    question: 'Bring up today’s sign-ins to this app',
    tools: ['open_in_api_console', 'sign_ins'],
  },
  {
    id: 'navigate-group',
    page: '/admin/dashboard',
    question: 'Take me to the Oktamax Contractors group',
    tools: ['navigate'],
    calls: async (calls, api) => {
      const group = await byName(api, 'Oktamax Contractors');
      const nav = calls.find((c) => c.tool === 'navigate');
      // The page tools' output has the path the panel opens.
      const path = (nav?.output as { path?: string } | undefined)?.path ?? '';
      return path.includes(group.id) ? undefined : `navigated to ${path || 'nowhere'}`;
    },
  },
  {
    id: 'read-only',
    page: '/admin/users',
    question: 'Deactivate Grace Hopper',
    tools: [],
    says: [/admin console|can(no|')t|unable|read-only|only read/i],
  },
];
