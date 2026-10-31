import {
  checkbox,
  checkboxGroup,
  radio,
  section,
  select,
  table,
  text,
  textarea,
  type FormView,
} from '../../form/schema';
import type { App } from '../../okta/types';

const APPLICATION_TYPES = {
  web: 'Web Application',
  browser: 'Single-Page Application',
  native: 'Native Application',
  service: 'API Services',
};

/** Grant types in the order the console lists them for a web app. */
const GRANT_TYPES: Record<string, string> = {
  client_credentials: 'Client Credentials',
  authorization_code: 'Authorization Code',
  refresh_token: 'Refresh Token',
  'urn:ietf:params:oauth:grant-type:token-exchange': 'Token Exchange',
  'urn:okta:params:oauth:grant-type:otp': 'OTP',
  'urn:okta:params:oauth:grant-type:oob': 'OOB',
  'http://auth0.com/oauth/grant-type/mfa-otp': 'MFA OTP',
  'http://auth0.com/oauth/grant-type/mfa-oob': 'MFA OOB',
  'urn:openid:params:grant-type:ciba': 'Client-initiated backchannel authentication flow (CIBA)',
  implicit: 'Implicit (hybrid)',
};

/** Grants the console only lists for some app types; shown when the app has them. */
const OTHER_GRANT_TYPES: Record<string, string> = {
  password: 'Resource Owner Password',
  'urn:ietf:params:oauth:grant-type:device_code': 'Device Authorization',
  'urn:ietf:params:oauth:grant-type:saml2-bearer': 'SAML 2.0 Assertion',
  'urn:ietf:params:oauth:grant-type:jwt-bearer': 'JWT Bearer',
  interaction_code: 'Interaction Code',
};

const grantTypeOptions = (granted: string[] = []) => ({
  ...GRANT_TYPES,
  ...Object.fromEntries(Object.entries(OTHER_GRANT_TYPES).filter(([k]) => granted.includes(k))),
});

const SCOPES = {
  profile: 'Profile',
  email: 'Email',
  address: 'Address',
  phone: 'Phone',
  groups: 'Groups',
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

/**
 * General tab › "General Settings". One Edit button in the console covers
 * all of these subsections, so they share one view.
 */
export const oidcGeneralSettingsView = (app: App): FormView => {
  const o = oauth(app);
  const grants = o.grant_types ?? [];
  const rotation = o.refresh_token?.rotation_type;
  const mode = o.idp_initiated_login?.mode ?? 'DISABLED';
  return {
    sections: [
      section('Application', [
        text('App integration name', app.label),
        select('Application type', o.application_type, APPLICATION_TYPES),
        textarea('Application notes for end users', app.settings?.notes?.enduser),
        textarea('Application notes for admins', app.settings?.notes?.admin),
        checkbox(
          'Require Demonstrating Proof of Possession (DPoP) header in token requests',
          o.dpop_bound_access_tokens,
        ),
        checkboxGroup('Grant type', grants, grantTypeOptions(grants)),
      ]),
      ...(grants.includes('refresh_token')
        ? [
            section('Refresh Token', [
              radio('Refresh token behavior', rotation, {
                ROTATE: 'Rotate token after every use',
                STATIC: 'Use persistent token',
              }),
              rotation === 'ROTATE' &&
                text('Grace period for token rotation (seconds)', o.refresh_token?.leeway),
            ]),
          ]
        : []),
      section('User Consent', [
        checkbox('Require consent', o.consent_method === 'REQUIRED'),
        text('Terms of Service URI', o.tos_uri),
        text('Policy URI', o.policy_uri),
        text('Logo URI', o.logo_uri),
      ]),
      section('Login', [
        table(
          'Sign-in redirect URIs',
          ['URI'],
          (o.redirect_uris ?? []).map((u) => [u]),
        ),
        checkbox('Allow wildcard * in login URI redirect.', o.wildcard_redirect === 'SUBDOMAIN'),
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
        mode === 'SPEC' && checkboxGroup('Scopes', o.idp_initiated_login?.default_scope, SCOPES),
        text('Initiate login URI', o.initiate_login_uri),
      ]),
    ],
    raw: app.settings?.oauthClient,
  };
};
