import { createActions, findSections } from '../../content/dom';
import { get } from '../../okta/api';
import type { App } from '../../okta/types';
import type { ViewProvider } from '../types';
import { assignmentTargets } from './assignments';
import { samlSettingsView } from './saml';

// /admin/app/{appName}/instance/{appId}/#tab-general
const APP_PATH = /^\/admin\/app\/[^/]+\/instance\/([^/]+)/;

/**
 * Assignments: each user / group row's pencil opens "Edit User/Group Assignment",
 * which read-only admins don't get.
 *
 * Most app sections (App Settings, Sign On Settings, OIDC Client Credentials
 * and General Settings) are already shown read-only on the page. SAML is the
 * exception: its Edit button opens a wizard with settings the page leaves out.
 */
export const appsProvider: ViewProvider = {
  name: 'Applications',
  matches: (url) => APP_PATH.test(url.pathname),
  async findTargets(url) {
    const appId = url.pathname.match(APP_PATH)?.[1];
    if (!appId) return [];

    const tab = url.hash.match(/^#tab-([\w-]+)/)?.[1] ?? 'general';
    if (tab === 'assignments') return assignmentTargets(appId);
    if (tab !== 'general') return [];

    const app = await get<App>(`/api/v1/apps/${appId}`);
    if (!app.signOnMode.startsWith('SAML')) return [];

    return findSections(['SAML Settings']).map(({ title, anchor, scope }) => {
      // The section's own sub-headings ("GENERAL") stop `scope` at the heading; Edit is beside it.
      const section = anchor.closest('.form-wrap') ?? scope;
      return {
        key: `app:${app.id}:${tab}:${title}`,
        title: 'View SAML Integration',
        anchor,
        scope: section,
        actions: section.querySelector('.link-bar'),
        // Okta's Edit link sits in a link bar right after the heading.
        addActions: () => {
          const bar = createActions('div', 'link-bar hdr-layout clearfix');
          // Level with where the Edit link's text would be (it has 6px of padding).
          bar.style.paddingTop = '7px';
          anchor.after(bar);
          return bar;
        },
        load: async () => samlSettingsView(await get<App>(`/api/v1/apps/${appId}`)),
      };
    });
  },
};
