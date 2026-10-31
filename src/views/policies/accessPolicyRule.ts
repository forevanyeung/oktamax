import {
  checkboxGroup,
  radio,
  section,
  select,
  tags,
  text,
  textarea,
  type FormView,
} from '../../form/schema';
import { deviceAssuranceNames, groupNames, userLogins, userTypeNames } from '../../okta/lookups';
import type { PolicyRule } from '../../okta/types';
import { anyOrSome, durationField, isoMinutes, networkFields, riskField } from './conditions';

const PLATFORMS = {
  'MOBILE:IOS': 'iOS',
  'MOBILE:ANDROID': 'Android',
  'MOBILE:OTHER': 'Other mobile (e.g., BlackBerry)',
  'DESKTOP:MACOS': 'macOS',
  'DESKTOP:WINDOWS': 'Windows',
  'DESKTOP:CHROMEOS': 'ChromeOS',
  'DESKTOP:OTHER': 'Other desktop (e.g., Linux)',
};

const AUTHENTICATION_METHODS: Record<string, string> = {
  okta_password: 'Password',
  okta_email: 'Email',
  phone_number: 'Phone',
  okta_verify: 'Okta Verify',
  google_otp: 'Google Authenticator',
  webauthn: 'Passkey (FIDO2 WebAuthn)',
  security_question: 'Security Question',
  smart_card_idp: 'Smart Card Authenticator',
  yubikey_token: 'YubiKey Authenticator',
  duo: 'Duo Security',
  symantec_vip: 'Symantec VIP',
  rsa_token: 'RSA SecurID',
  onprem_mfa: 'On-Prem MFA',
  custom_otp: 'Custom OTP',
  custom_app: 'Custom Authenticator',
  external_idp: 'IdP Authenticator',
};

type AppSignOn = NonNullable<NonNullable<PolicyRule['actions']>['appSignOn']>;
type VerificationMethod = AppSignOn['verificationMethod'];
type Possession = NonNullable<
  NonNullable<NonNullable<VerificationMethod>['constraints']>[number]['possession']
>;

/** Newer possession constraint fields not (yet) in `PolicyRule`. */
type AuthenticationMethod = { key?: string; method?: string };
interface PossessionExt extends Possession {
  userVerificationMethods?: string[];
  authenticationMethods?: AuthenticationMethod[];
  excludedAuthenticationMethods?: AuthenticationMethod[];
}

/** The "User must authenticate with" dropdown is derived from factor mode + knowledge constraint. */
function authenticateWith(vm: VerificationMethod): string {
  if (vm?.type === 'AUTH_METHOD_CHAIN') return 'AUTH_METHOD_CHAIN';
  const password = vm?.constraints?.some((c) => c.knowledge?.types?.includes('password'));
  return `${vm?.factorMode ?? '1FA'}${password ? '_PASSWORD' : ''}`;
}

/** Okta's checkboxes; user presence is REQUIRED unless set to OPTIONAL. */
function possessionConstraints(p: PossessionExt | undefined): string[] {
  if (!p) return [];
  return [
    p.phishingResistant === 'REQUIRED' && 'phishingResistant',
    p.hardwareProtection === 'REQUIRED' && 'hardwareProtection',
    p.userPresence !== 'OPTIONAL' && 'userPresence',
  ].filter((v): v is string => Boolean(v));
}

function userVerification(p: PossessionExt): string {
  if (p.userVerificationMethods?.includes('BIOMETRICS')) return 'BIOMETRICS';
  return p.userVerification === 'REQUIRED' ? 'REQUIRED' : 'ANY';
}

const methodLabel = (m: AuthenticationMethod) =>
  AUTHENTICATION_METHODS[m.key ?? ''] ?? m.key ?? m.method ?? '';

/** "When it's been over …" stores a duration; "every time" is PT0S; no duration means "no session". */
function promptMode(reauthenticateIn: string | undefined): string {
  if (!reauthenticateIn) return 'NO_SESSION';
  return isoMinutes(reauthenticateIn) === 0 ? 'EVERY_TIME' : 'AFTER';
}

/** Security › Authentication Policies › policy › "Edit Rule" */
export async function accessPolicyRuleView(rule: PolicyRule): Promise<FormView> {
  const c = rule.conditions ?? {};
  const signOn = rule.actions?.appSignOn as
    | (AppSignOn & { keepMeSignedIn?: { postAuth?: string } })
    | undefined;
  const allowed = signOn?.access === 'ALLOW';
  const vm = signOn?.verificationMethod;
  const possession = vm?.constraints?.find((x) => x.possession)?.possession as
    | PossessionExt
    | undefined;
  const constraints = possessionConstraints(possession);
  const allowedMethods = possession?.authenticationMethods ?? [];
  const excludedMethods = possession?.excludedAuthenticationMethods ?? [];
  const methodsMode =
    allowedMethods.length > 0
      ? 'ALLOW'
      : excludedMethods.length > 0 || possession?.deviceBound === 'REQUIRED'
        ? 'DISALLOW'
        : 'ANY';
  const prompt = promptMode(vm?.reauthenticateIn);

  const [userTypes, groups, excludedGroups, users, excludedUsers, assurances, network] =
    await Promise.all([
      userTypeNames(c.userType?.include),
      groupNames(c.people?.groups?.include),
      groupNames(c.people?.groups?.exclude),
      userLogins(c.people?.users?.include),
      userLogins(c.people?.users?.exclude),
      deviceAssuranceNames(c.device?.assurance?.include),
      networkFields(c.network, "AND User's IP is", 'access'),
    ]);

  const registered = Boolean(c.device?.registered);
  const platforms = (c.platform?.include ?? []).map((p) => `${p.type}:${p.os?.type ?? 'OTHER'}`);

  return {
    description:
      'If all of the conditions are true, the authentication settings below will apply. Otherwise, Okta will evaluate the next rule.',
    sections: [
      section(undefined, [text('Rule name', rule.name)]),
      section('IF', [
        ...anyOrSome(
          "IF User's user type is",
          userTypes,
          'Any user type',
          'One of the following user types:',
        ),
        ...anyOrSome(
          "AND User's group membership includes",
          groups,
          'Any group',
          'At least one of the following groups:',
        ),
        (groups.length > 0 || excludedGroups.length > 0) &&
          tags('And none of the following groups:', excludedGroups),
        ...anyOrSome('AND User is', users, 'Any user', 'One of the following users:'),
        (users.length > 0 || excludedUsers.length > 0) &&
          tags('And none of the following users:', excludedUsers),
        radio('AND Device state is', registered ? 'REGISTERED' : 'ANY', {
          ANY: 'Any',
          REGISTERED: 'Registered',
        }),
        registered &&
          radio(
            'AND Device management is',
            c.device?.managed === undefined ? 'ANY' : c.device.managed ? 'MANAGED' : 'NOT_MANAGED',
            { ANY: 'Any', MANAGED: 'Managed', NOT_MANAGED: 'Not managed' },
          ),
        select('AND Device assurance policy is', assurances.length > 0 ? 'SOME' : 'NONE', {
          NONE: 'No policy',
          SOME: 'Any of the following device assurance policies:',
        }),
        assurances.length > 0 && tags('', assurances),
        select(
          'AND Device platform is',
          platforms.length > 0 ? 'SOME' : 'ANY',
          { ANY: 'Any platform', SOME: 'One of the following platforms:' },
          platforms.length > 0
            ? undefined
            : "Device platform is securely verified for registered devices. For unregistered devices, it's determined by the user-agent and can be modified.",
        ),
        platforms.length > 0 &&
          checkboxGroup(
            '',
            platforms,
            PLATFORMS,
            "Device platform is securely verified for registered devices. For unregistered devices, it's determined by the user-agent and can be modified.",
          ),
        ...network,
        riskField(c.riskScore, 'AND Risk is'),
        textarea(
          'AND The following custom expression is true',
          c.elCondition?.condition,
          'This is an optional advanced setting. If the expression is formatted incorrectly or conflicts with conditions set above, the rule may not match any users.',
        ),
      ]),
      section('THEN', [
        radio('THEN Access is', signOn?.access, {
          DENY: 'Denied',
          ALLOW: 'Allowed after successful authentication',
        }),
        allowed &&
          select('AND User must authenticate with', authenticateWith(vm), {
            '1FA': 'Any 1 factor type',
            '1FA_PASSWORD': 'Password / IdP',
            '2FA': 'Any 2 factor types',
            '2FA_PASSWORD': 'Password / IdP + Another factor',
            AUTH_METHOD_CHAIN: 'Authentication method chain',
          }),
        allowed &&
          checkboxGroup('AND Possession factor constraints are', constraints, {
            phishingResistant: 'Phishing resistant',
            hardwareProtection: 'Hardware protected',
            userPresence: 'Require user interaction',
          }),
        allowed &&
          possession &&
          constraints.includes('userPresence') &&
          radio('', userVerification(possession), [
            {
              value: 'ANY',
              label: 'Any interaction',
              hint: 'This includes responding to an approval prompt in Okta Verify, or touching an Yubikey to activate.',
            },
            {
              value: 'REQUIRED',
              label: 'Require device passcode or biometric user verification',
              hint: 'This can be met by any operating system and achieves 2FA with a single authenticator',
            },
            {
              value: 'BIOMETRICS',
              label: 'Require biometric user verification',
              hint: 'This can only be met by Okta Verify FastPass or Okta Verify Push on Android, iOS, and macOS.',
            },
          ]),
        allowed &&
          radio('AND Authentication methods', methodsMode, {
            ANY: 'Allow any method that can be used to meet the requirement',
            DISALLOW: 'Disallow specific authentication methods',
            ALLOW: 'Allow specific authentication methods',
          }),
        allowed &&
          methodsMode !== 'ANY' &&
          tags('', (methodsMode === 'ALLOW' ? allowedMethods : excludedMethods).map(methodLabel)),
        allowed &&
          checkboxGroup(
            'AND Option to stay signed in',
            signOn?.keepMeSignedIn?.postAuth === 'ALLOWED' ? ['ALLOWED'] : [],
            [{ value: 'ALLOWED', label: 'Show after users sign in' }],
            'Organization Security settings can also be configured to show users the option before they sign in.',
          ),
      ]),
      section(
        'When to prompt for authentication',
        allowed
          ? [
              radio('AND Prompt for authentication', prompt, [
                {
                  value: 'EVERY_TIME',
                  label: 'Every time user signs in to resource',
                  hint: 'This is the most secure option',
                },
                {
                  value: 'AFTER',
                  label:
                    'When it’s been over a specified length of time since the user accessed any resource protected by the active Okta global session',
                },
                {
                  value: 'NO_SESSION',
                  label: "When an Okta global session doesn't exist",
                  hint: 'If the global session exists, allow the user to authenticate silently through SSO',
                },
              ]),
              prompt === 'AFTER' && durationField('', isoMinutes(vm?.reauthenticateIn)),
            ]
          : [],
        allowed
          ? 'Even when an active Okta global session (SSO session) exists for a user, you can define the user authentication requirements. If signing in to an app, the maximum session lifetime for individual apps is governed by each app.'
          : undefined,
      ),
    ],
    raw: rule,
  };
}
