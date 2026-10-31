import { select, text, type Field } from '../../form/schema';
import type { App } from '../../okta/types';

const USERNAME_FORMATS: Record<string, string> = {
  '${source.login}': 'Okta username',
  '${source.email}': 'Email',
  '${fn:substringBefore(source.login, "@")}': 'Okta username prefix',
  '${fn:substringBefore(source.email, "@")}': 'Email prefix',
  '${source.samAccountName}': 'AD SAM account name',
  '${source.userName}': 'AD user principal name',
  NONE: '(None)',
};

const PUSH_STATUS = { PUSH: 'Create and update', DONT_PUSH: 'Create only' };

/** "Application username format" + "Update application username on", shared by SAML and Sign On. */
export function usernameFields(app: App, formatLabel = 'Application username format'): Field[] {
  const template = app.credentials?.userNameTemplate;
  const builtIn = template?.template && template.type !== 'CUSTOM' ? template.template : undefined;
  return [
    select(formatLabel, builtIn ?? (template?.template ? 'CUSTOM' : ''), {
      ...USERNAME_FORMATS,
      CUSTOM: 'Custom',
    }),
    template?.type === 'CUSTOM' && text('Custom expression', template.template),
    select('Update application username on', template?.pushStatus ?? 'PUSH', PUSH_STATUS),
  ].filter((f): f is Field => Boolean(f));
}

export const SIGN_ON_MODES: Record<string, string> = {
  SAML_2_0: 'SAML 2.0',
  SAML_1_1: 'SAML 1.1',
  OPENID_CONNECT: 'OpenID Connect',
  WS_FEDERATION: 'WS-Federation',
  BROWSER_PLUGIN: 'Secure Web Authentication',
  AUTO_LOGIN: 'Secure Web Authentication',
  BASIC_AUTH: 'Basic Authentication',
  BOOKMARK: 'Bookmark',
  SECURE_PASSWORD_STORE: 'Secure Password Store',
};
