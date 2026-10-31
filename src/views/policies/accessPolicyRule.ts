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
import { isoDuration } from '../format';
import { anyOrSome, networkFields, riskField } from './conditions';

const PLATFORMS = {
  'MOBILE:IOS': 'iOS',
  'MOBILE:ANDROID': 'Android',
  'MOBILE:OTHER': 'Other mobile (e.g., BlackBerry)',
  'DESKTOP:MACOS': 'macOS',
  'DESKTOP:WINDOWS': 'Windows',
  'DESKTOP:CHROMEOS': 'ChromeOS',
  'DESKTOP:OTHER': 'Other desktop (e.g., Linux)',
};

const POSSESSION_CONSTRAINTS = {
  phishingResistant: 'Phishing resistant',
  hardwareProtection: 'Hardware protected',
  deviceBound: 'Device bound (excludes phone and email)',
  userPresence: 'Require user interaction',
  userVerification: 'Require PIN or biometric user verification',
};

type VerificationMethod = NonNullable<
  NonNullable<PolicyRule['actions']>['appSignOn']
>['verificationMethod'];

/** The "User must authenticate with" dropdown is derived from factor mode + knowledge constraint. */
function authenticateWith(vm: VerificationMethod): string {
  if (vm?.type === 'AUTH_METHOD_CHAIN') return 'AUTH_METHOD_CHAIN';
  const password = vm?.constraints?.some((c) => c.knowledge?.types?.includes('password'));
  return `${vm?.factorMode ?? '1FA'}${password ? '_PASSWORD' : ''}`;
}

/** Security › Authentication Policies › policy › "Edit Rule" */
export async function accessPolicyRuleView(rule: PolicyRule): Promise<FormView> {
  const c = rule.conditions ?? {};
  const signOn = rule.actions?.appSignOn;
  const vm = signOn?.verificationMethod;
  const possession = vm?.constraints?.find((x) => x.possession)?.possession ?? {};
  const reauth = vm?.reauthenticateIn;

  const [userTypes, groups, excludedGroups, users, excludedUsers, assurances, network] =
    await Promise.all([
      userTypeNames(c.userType?.include),
      groupNames(c.people?.groups?.include),
      groupNames(c.people?.groups?.exclude),
      userLogins(c.people?.users?.include),
      userLogins(c.people?.users?.exclude),
      deviceAssuranceNames(c.device?.assurance?.include),
      networkFields(c.network, "AND User's IP is"),
    ]);

  const deviceState = c.device?.registered ? 'REGISTERED' : 'ANY';
  const platforms = (c.platform?.include ?? []).map((p) => `${p.type}:${p.os?.type ?? 'OTHER'}`);

  return {
    sections: [
      section(undefined, [text('Rule name', rule.name)]),
      section('IF', [
        ...anyOrSome(
          "User's user type is",
          userTypes,
          'Any user type',
          'One of the following user types',
          'User types',
        ),
        ...anyOrSome(
          "AND User's group membership includes",
          groups,
          'Any group',
          'At least one of the following groups',
          'Groups',
        ),
        excludedGroups.length > 0 && tags('Exclude groups', excludedGroups),
        ...anyOrSome('AND User is', users, 'Any user', 'One of the following users', 'Users'),
        excludedUsers.length > 0 && tags('Exclude users', excludedUsers),
        radio('AND Device state is', deviceState, { ANY: 'Any', REGISTERED: 'Registered' }),
        deviceState === 'REGISTERED' &&
          radio(
            'AND Device management is',
            c.device?.managed === undefined ? 'ANY' : c.device.managed ? 'MANAGED' : 'NOT_MANAGED',
            { ANY: 'Any', MANAGED: 'Managed', NOT_MANAGED: 'Not managed' },
          ),
        deviceState === 'REGISTERED' &&
          assurances.length > 0 &&
          tags('AND Device assurance policy is any of', assurances),
        radio('AND Device platform is', platforms.length > 0 ? 'SOME' : 'ANY', {
          ANY: 'Any platform',
          SOME: 'One of the following platforms',
        }),
        platforms.length > 0 && checkboxGroup('Platforms', platforms, PLATFORMS),
        ...network,
        riskField(c.riskScore, 'AND Risk is'),
        textarea('AND The following custom expression is true', c.elCondition?.condition),
      ]),
      section('THEN', [
        radio('Access is', signOn?.access, {
          ALLOW: 'Allowed after successful authentication',
          DENY: 'Denied',
        }),
        signOn?.access === 'ALLOW' &&
          select('User must authenticate with', authenticateWith(vm), {
            '1FA': 'Any 1 factor type',
            '1FA_PASSWORD': 'Password / IdP',
            '2FA': 'Any 2 factor types',
            '2FA_PASSWORD': 'Password / IdP + Another factor',
            AUTH_METHOD_CHAIN: 'Authentication method chain',
          }),
        signOn?.access === 'ALLOW' &&
          checkboxGroup(
            'Possession factor constraints are',
            Object.keys(POSSESSION_CONSTRAINTS).filter(
              (k) => possession[k as keyof typeof possession] === 'REQUIRED',
            ),
            POSSESSION_CONSTRAINTS,
          ),
        signOn?.access === 'ALLOW' &&
          radio('Prompt for authentication', reauth === 'PT0S' ? 'EVERY_TIME' : 'AFTER', {
            EVERY_TIME: 'Every time user signs in to resource',
            AFTER:
              "When it's been over a specified length of time since the user's last authentication",
          }),
        signOn?.access === 'ALLOW' &&
          reauth !== 'PT0S' &&
          text('Re-authentication frequency', isoDuration(reauth)),
      ]),
    ],
    raw: rule,
  };
}
