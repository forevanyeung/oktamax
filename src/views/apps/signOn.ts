import { checkbox, radio, section, text, type FormView } from '../../form/schema';
import type { App } from '../../okta/types';
import { SIGN_ON_MODES, usernameFields } from './shared';

/** Sign On tab › "Settings" */
export const signOnSettingsView = (app: App): FormView => ({
  sections: [
    section('Sign on methods', [
      radio('Sign on methods', app.signOnMode, {
        [app.signOnMode]: SIGN_ON_MODES[app.signOnMode] ?? app.signOnMode,
      }),
      app.signOnMode.startsWith('SAML') &&
        text('Default Relay State', app.settings?.signOn?.defaultRelayState),
    ]),
    section('Credentials Details', [
      ...usernameFields(app),
      app.credentials?.revealPassword !== undefined &&
        checkbox('Allow users to securely see their password', app.credentials.revealPassword),
    ]),
  ],
  raw: { signOnMode: app.signOnMode, credentials: app.credentials, signOn: app.settings?.signOn },
});
