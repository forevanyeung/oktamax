import { checkbox, section, text, textarea, type FormView } from '../../form/schema';
import type { App } from '../../okta/types';
import { objectSections } from '../generic';

/** General tab › "App Settings" */
export const appSettingsView = (app: App): FormView => ({
  sections: [
    section(undefined, [
      text('Application label', app.label),
      checkbox('Do not display application icon to users', app.visibility?.hide?.web),
      checkbox('Do not display application icon in the Okta Mobile App', app.visibility?.hide?.iOS),
      app.visibility?.autoSubmitToolbar !== undefined &&
        checkbox(
          'Automatically log in when user lands on login page',
          app.visibility.autoSubmitToolbar,
        ),
      app.visibility?.autoLaunch !== undefined &&
        checkbox('Auto-launch the app when user signs into Okta', app.visibility.autoLaunch),
      textarea('Application notes for end users', app.settings?.notes?.enduser),
      textarea('Application notes for admins', app.settings?.notes?.admin),
    ]),
    // Integration-specific settings (OIN apps define their own, e.g. "Subdomain").
    ...objectSections('', app.settings?.app),
  ],
  raw: app,
});
