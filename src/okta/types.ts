/**
 * The subset of Okta Management API shapes the views read. Everything is
 * optional because fields vary by org, feature flag and object type.
 */

export interface Group {
  id: string;
  profile: { name: string; description?: string };
}

export interface User {
  id: string;
  profile: { login: string; firstName?: string; lastName?: string };
}

type IncludeExclude = { include?: string[]; exclude?: string[] };

export interface App {
  id: string;
  name: string;
  label: string;
  status: string;
  signOnMode: string;
  visibility?: {
    autoLaunch?: boolean;
    autoSubmitToolbar?: boolean;
    hide?: { iOS?: boolean; web?: boolean };
  };
  credentials?: {
    userNameTemplate?: { template?: string; type?: string; pushStatus?: string };
    revealPassword?: boolean;
    oauthClient?: {
      client_id?: string;
      token_endpoint_auth_method?: string;
      pkce_required?: boolean;
      autoKeyRotation?: boolean;
    };
  };
  settings?: {
    app?: Record<string, unknown>;
    notes?: { admin?: string | null; enduser?: string | null };
    signOn?: SamlSignOn & { defaultRelayState?: string };
    oauthClient?: OAuthClientSettings;
  };
}

/** `/api/v1/apps/{appId}/users/{userId}`: a user's assignment to an app. */
export interface AppUser {
  id: string;
  /** USER: assigned directly (or overriding a group); GROUP: through a group assignment. */
  scope: 'USER' | 'GROUP';
  status?: string;
  credentials?: { userName?: string };
  profile?: Record<string, unknown>;
  _links?: { group?: { name?: string } };
  _embedded?: { user?: User };
}

/** `/api/v1/apps/{appId}/groups/{groupId}`: a group's assignment to an app. */
export interface AppGroup {
  id: string;
  priority?: number;
  profile?: Record<string, unknown>;
  _embedded?: { group?: Group };
}

export interface SchemaProperty {
  title?: string;
  type?: string;
  /** SELF: can only be set per user; NONE: can also be set on a group assignment. */
  scope?: 'SELF' | 'NONE';
  enum?: unknown[];
  oneOf?: Array<{ const: unknown; title: string }>;
  items?: { enum?: unknown[]; oneOf?: Array<{ const: unknown; title: string }> };
}

/** `/api/v1/meta/schemas/apps/{appId}/default`: the app user profile. */
export interface AppUserSchema {
  definitions?: {
    base?: { properties?: Record<string, SchemaProperty> };
    custom?: { properties?: Record<string, SchemaProperty> };
  };
}

export interface SamlSignOn {
  ssoAcsUrl?: string;
  recipient?: string;
  destination?: string;
  audience?: string;
  idpIssuer?: string;
  subjectNameIdTemplate?: string;
  subjectNameIdFormat?: string;
  responseSigned?: boolean;
  assertionSigned?: boolean;
  signatureAlgorithm?: string;
  digestAlgorithm?: string;
  honorForceAuthn?: boolean;
  authnContextClassRef?: string;
  requestCompressed?: boolean;
  allowMultipleAcsEndpoints?: boolean;
  acsEndpoints?: Array<{ url: string; index: number }>;
  samlAssertionLifetimeSeconds?: number;
  spIssuer?: string;
  slo?: { enabled?: boolean; logoutUrl?: string; issuer?: string };
  spCertificate?: { x5c?: string[] };
  assertionEncryption?: {
    enabled?: boolean;
    encryptionAlgorithm?: string;
    keyTransportAlgorithm?: string;
  };
  inlineHooks?: Array<{ id: string }>;
  attributeStatements?: Array<{
    type: 'EXPRESSION' | 'GROUP';
    name: string;
    namespace?: string;
    values?: string[];
    filterType?: string;
    filterValue?: string;
  }>;
}

export interface OAuthClientSettings {
  application_type?: string;
  grant_types?: string[];
  response_types?: string[];
  redirect_uris?: string[];
  post_logout_redirect_uris?: string[];
  initiate_login_uri?: string;
  login_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
  client_uri?: string;
  consent_method?: string;
  issuer_mode?: string;
  wildcard_redirect?: string;
  dpop_bound_access_tokens?: boolean;
  idp_initiated_login?: { mode?: string; default_scope?: string[] };
  refresh_token?: { rotation_type?: string; leeway?: number };
}

export interface GroupRule {
  id: string;
  name: string;
  status: string;
  conditions?: {
    expression?: { value?: string; type?: string };
    people?: { users?: { exclude?: string[] }; groups?: { exclude?: string[] } };
  };
  actions?: { assignUserToGroups?: { groupIds?: string[] } };
  _embedded?: { groupIdToGroupNameMap?: Record<string, string> };
}

export interface NetworkZone {
  id: string;
  name: string;
  type: 'IP' | 'DYNAMIC' | 'DYNAMIC_V2';
  status: string;
  usage?: 'POLICY' | 'BLOCKLIST';
  system?: boolean;
  gateways?: Array<{ type: string; value: string }> | null;
  proxies?: Array<{ type: string; value: string }> | null;
  proxyType?: string | null;
  asns?: string[] | IncludeExclude | null;
  locations?:
    | Array<{ country: string; region?: string | null }>
    | {
        include?: Array<{ country: string; region?: string | null }>;
        exclude?: Array<{ country: string; region?: string | null }>;
      }
    | null;
  ipServiceCategories?: IncludeExclude | null;
}

export type PolicyType =
  | 'OKTA_SIGN_ON'
  | 'ACCESS_POLICY'
  | 'PASSWORD'
  | 'PROFILE_ENROLLMENT'
  | 'MFA_ENROLL'
  | string;

export interface Policy {
  id: string;
  name: string;
  type: PolicyType;
  status: string;
  description?: string | null;
  system?: boolean;
  conditions?: {
    people?: { groups?: IncludeExclude };
    authProvider?: { provider?: string };
  } | null;
  settings?: {
    password?: {
      complexity?: {
        minLength?: number;
        minLowerCase?: number;
        minUpperCase?: number;
        minNumber?: number;
        minSymbol?: number;
        excludeUsername?: boolean;
        excludeAttributes?: string[];
        dictionary?: { common?: { exclude?: boolean } };
      };
      age?: {
        maxAgeDays?: number;
        expireWarnDays?: number;
        minAgeMinutes?: number;
        historyCount?: number;
      };
      lockout?: {
        maxAttempts?: number;
        autoUnlockMinutes?: number;
        showLockoutFailures?: boolean;
        userLockoutNotificationChannels?: string[];
      };
    };
  };
}

export interface PolicyRule {
  id: string;
  name: string;
  type: PolicyType;
  status: string;
  priority?: number;
  system?: boolean;
  conditions?: {
    people?: { users?: IncludeExclude; groups?: IncludeExclude };
    userType?: IncludeExclude;
    network?: { connection?: 'ANYWHERE' | 'ZONE'; include?: string[]; exclude?: string[] };
    device?: {
      registered?: boolean;
      managed?: boolean;
      assurance?: { include?: string[] };
    };
    platform?: { include?: Array<{ type: string; os?: { type: string } }> };
    riskScore?: { level?: string };
    risk?: { behaviors?: string[] };
    elCondition?: { condition?: string };
    authContext?: { authType?: string };
    identityProvider?: { provider?: string; idpIds?: string[] };
  } | null;
  actions?: {
    appSignOn?: {
      access?: 'ALLOW' | 'DENY';
      verificationMethod?: {
        type?: string;
        factorMode?: '1FA' | '2FA';
        reauthenticateIn?: string;
        constraints?: Array<{
          knowledge?: { types?: string[]; required?: boolean };
          possession?: {
            required?: boolean;
            deviceBound?: string;
            phishingResistant?: string;
            hardwareProtection?: string;
            userPresence?: string;
            userVerification?: string;
          };
        }>;
      };
    };
    signon?: {
      access?: 'ALLOW' | 'DENY';
      requireFactor?: boolean;
      primaryFactor?: string;
      factorPromptMode?: string;
      rememberDeviceByDefault?: boolean;
      factorLifetime?: number;
      session?: {
        maxSessionIdleMinutes?: number;
        maxSessionLifetimeMinutes?: number;
        usePersistentCookie?: boolean;
      };
    };
    passwordChange?: { access?: 'ALLOW' | 'DENY' };
    selfServicePasswordReset?: {
      access?: 'ALLOW' | 'DENY';
      requirement?: {
        primary?: { methods?: string[] };
        stepUp?: { required?: boolean; methods?: string[] };
      };
    };
    selfServiceUnlock?: { access?: 'ALLOW' | 'DENY' };
  };
}

export interface Authenticator {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  settings?: Record<string, unknown>;
  provider?: { type?: string; configuration?: Record<string, unknown> };
}
