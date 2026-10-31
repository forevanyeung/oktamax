/**
 * The objects the admin console page is showing (its user, group, app, ...),
 * as values for the API's path parameters: `{userId}` on a user's page.
 */

export type PageContext = Record<string, string>;

/** Okta IDs are 20 characters; their first three tell the object type. */
const OKTA_ID = /\b([0-9a-z]{3}[A-Za-z0-9]{17})\b/g;

const BY_PREFIX: Record<string, string> = {
  '00u': 'userId',
  '00g': 'groupId',
  '0oa': 'appId',
  aus: 'authServerId',
  '00p': 'policyId',
  rst: 'policyId',
  '0pr': 'ruleId',
  rul: 'ruleId',
  guo: 'deviceId',
  aut: 'authenticatorId',
  nzo: 'zoneId',
};

export const LABELS: Record<string, string> = {
  userId: 'User',
  groupId: 'Group',
  appId: 'App',
  appName: 'App name',
  authServerId: 'Authorization server',
  policyId: 'Policy',
  ruleId: 'Rule',
  deviceId: 'Device',
  authenticatorId: 'Authenticator',
  zoneId: 'Network zone',
  idpId: 'Identity provider',
};

export function pageContext(url: Pick<URL, 'pathname' | 'hash'>): PageContext {
  const context: PageContext = {};
  const where = url.pathname + url.hash;
  // Identity providers' IDs start with 0oa too.
  const idp = /\/identity-providers\//.test(where);
  for (const [, id = ''] of where.matchAll(OKTA_ID)) {
    const name = idp && id.startsWith('0oa') ? 'idpId' : BY_PREFIX[id.slice(0, 3)];
    if (name) context[name] ??= id;
  }
  // /admin/app/{appName}/instance/{appId}/
  const appName = url.pathname.match(/^\/admin\/app\/([^/]+)\/instance\//)?.[1];
  if (appName) context.appName = appName;
  return context;
}

/** Fills `{name}` placeholders from `context`, leaving unknown ones as they are. */
export const fillTemplate = (template: string, context: PageContext) =>
  template.replace(/\{(\w+)\}/g, (placeholder, name: string) => context[name] ?? placeholder);

/** The `{name}` placeholders left in `url`. */
export const placeholders = (url: string) =>
  [...url.matchAll(/\{(\w+)\}/g)].map(([, name = '']) => name);
