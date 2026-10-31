import { findSections } from '../../content/dom';
import type { FormView } from '../../form/schema';
import { get } from '../../okta/api';
import type { App } from '../../okta/types';
import type { ViewProvider } from '../types';
import { appSettingsView } from './general';
import { clientCredentialsView, oidcGeneralSettingsView, oidcLoginView } from './oidc';
import { samlSettingsView } from './saml';
import { signOnSettingsView } from './signOn';

// /admin/app/{appName}/instance/{appId}/#tab-general
const APP_PATH = /^\/admin\/app\/[^/]+\/instance\/([^/]+)/;

/** Section heading on the app page -> dialog title and view. */
function sectionsFor(app: App, tab: string) {
  const sections: Record<
    string,
    { title: string; view: (app: App) => FormView | Promise<FormView> }
  > = {};

  if (tab === 'signon') {
    sections['Settings'] = { title: 'View Sign On Settings', view: signOnSettingsView };
    return sections;
  }

  sections['App Settings'] = { title: 'View App Settings', view: appSettingsView };
  if (app.signOnMode.startsWith('SAML')) {
    sections['SAML Settings'] = { title: 'View SAML Integration', view: samlSettingsView };
  }
  if (app.signOnMode === 'OPENID_CONNECT') {
    sections['Client Credentials'] = {
      title: 'View Client Credentials',
      view: clientCredentialsView,
    };
    sections['General Settings'] = {
      title: 'View General Settings',
      view: oidcGeneralSettingsView,
    };
    sections['Login'] = { title: 'View Login', view: oidcLoginView };
  }
  return sections;
}

export const appsProvider: ViewProvider = {
  name: 'Applications',
  matches: (url) => APP_PATH.test(url.pathname),
  async findTargets(url) {
    const appId = url.pathname.match(APP_PATH)?.[1];
    if (!appId) return [];

    const app = await get<App>(`/api/v1/apps/${appId}`);
    const tab = url.hash.match(/^#tab-([\w-]+)/)?.[1] ?? 'general';
    const sections = sectionsFor(app, tab);

    return findSections(Object.keys(sections)).map(({ title, anchor, scope }) => ({
      key: `app:${app.id}:${tab}:${title}`,
      title: sections[title]!.title,
      anchor,
      scope,
      load: async () => sections[title]!.view(await get<App>(`/api/v1/apps/${appId}`)),
    }));
  },
};
