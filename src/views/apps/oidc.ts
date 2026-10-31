import {
  checkbox,
  checkboxGroup,
  radio,
  section,
  select,
  table,
  text,
  type FormView,
} from '../../form/schema';
import type { App } from '../../okta/types';

const APPLICATION_TYPES = {
  web: 'Web Application',
  browser: 'Single-Page Application',
  native: 'Native Application',
  service: 'API Services',
};

const GRANT_TYPES = {
  client_credentials: 'Client Credentials',
  authorization_code: 'Authorization Code',
  refresh_token: 'Refresh Token',
  implicit: 'Implicit (hybrid)',
  password: 'Resource Owner Password',
  'urn:ietf:params:oauth:grant-type:device_code': 'Device Authorization',
  'urn:ietf:params:oauth:grant-type:token-exchange': 'Token Exchange',
  'urn:ietf:params:oauth:grant-type:saml2-bearer': 'SAML 2.0 Assertion',
  'urn:ietf:params:oauth:grant-type:jwt-bearer': 'JWT Bearer',
  'urn:openid:params:grant-type:ciba': 'Client-initiated backchannel authentication flow (CIBA)',
  interaction_code: 'Interaction Code',
  'urn:okta:params:oauth:grant-type:otp': 'OTP',
  'urn:okta:params:oauth:grant-type:oob': 'OOB',
};

const CLIENT_AUTH_METHODS = {
  client_secret_basic: 'Client secret',
  client_secret_post: 'Client secret (POST)',
  client_secret_jwt: 'Client secret (JWT)',
  private_key_jwt: 'Public key / Private key',
  none: 'None',
};

const oauth = (app: App) => app.settings?.oauthClient ?? {};

/** General tab › "Client Credentials" */
export const clientCredentialsView = (app: App): FormView => {
  const creds = app.credentials?.oauthClient;
  return {
    sections: [
      section('Client Credentials', [
        text('Client ID', creds?.client_id),
        radio('Client authentication', creds?.token_endpoint_auth_method, CLIENT_AUTH_METHODS),
        checkbox('Require PKCE as additional verification', creds?.pkce_required),
      ]),
    ],
    raw: app.credentials?.oauthClient,
  };
};

/** General tab › "General Settings" */
export const oidcGeneralSettingsView = (app: App): FormView => {
  const o = oauth(app);
  const rotation = o.refresh_token?.rotation_type;
  return {
    sections: [
      section('General Settings', [
        text('App integration name', app.label),
        select('Application type', o.application_type, APPLICATION_TYPES),
        checkbox(
          'Require Demonstrating Proof of Possession (DPoP) header in token requests',
          o.dpop_bound_access_tokens,
        ),
        checkboxGroup('Grant type', o.grant_types, GRANT_TYPES),
        o.grant_types?.includes('refresh_token') &&
          radio('Refresh token behavior', rotation, {
            STATIC: 'Use persistent token',
            ROTATE: 'Rotate token after every use',
          }),
        rotation === 'ROTATE' &&
          text('Grace period for token rotation (seconds)', o.refresh_token?.leeway),
        checkbox('Require consent', o.consent_method === 'REQUIRED'),
        text('Logo URI', o.logo_uri),
        text('Client URI', o.client_uri),
      ]),
    ],
    raw: app.settings?.oauthClient,
  };
};

/** General tab › "Login" */
export const oidcLoginView = (app: App): FormView => {
  const o = oauth(app);
  const mode = o.idp_initiated_login?.mode ?? 'DISABLED';
  return {
    sections: [
      section('Login', [
        table(
          'Sign-in redirect URIs',
          ['URI'],
          (o.redirect_uris ?? []).map((u) => [u]),
        ),
        checkbox('Allow wildcard * in sign-in URI redirect', o.wildcard_redirect === 'SUBDOMAIN'),
        table(
          'Sign-out redirect URIs',
          ['URI'],
          (o.post_logout_redirect_uris ?? []).map((u) => [u]),
        ),
        radio('Login initiated by', mode === 'DISABLED' ? 'APP' : 'EITHER', {
          APP: 'App Only',
          EITHER: 'Either Okta or App',
        }),
        mode !== 'DISABLED' &&
          checkbox('Display application icon to users', !app.visibility?.hide?.web),
        mode !== 'DISABLED' &&
          radio('Login flow', mode, {
            OKTA: 'Redirect to app to initiate login (OIDC Compliant)',
            SPEC: 'Send ID Token directly to app (Okta Simplified)',
          }),
        text('Initiate login URI', o.initiate_login_uri),
      ]),
    ],
    raw: app.settings?.oauthClient,
  };
};
