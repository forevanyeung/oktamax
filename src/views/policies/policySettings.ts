import {
  checkbox,
  section,
  select,
  tags,
  text,
  textarea,
  type FormView,
  type Section,
} from '../../form/schema';
import { groupNames } from '../../okta/lookups';
import type { Policy } from '../../okta/types';
import { minutesToText } from '../format';

function passwordSections(policy: Policy): Section[] {
  const { complexity = {}, age = {}, lockout = {} } = policy.settings?.password ?? {};
  const excluded = complexity.excludeAttributes ?? [];

  return [
    section('Password Settings', [
      select('Authentication provider', policy.conditions?.authProvider?.provider ?? 'OKTA', {
        OKTA: 'Okta',
        ACTIVE_DIRECTORY: 'Active Directory',
      }),
      text('Minimum length', complexity.minLength),
      checkbox('Lower case letter', (complexity.minLowerCase ?? 0) > 0),
      checkbox('Upper case letter', (complexity.minUpperCase ?? 0) > 0),
      checkbox('Number (0-9)', (complexity.minNumber ?? 0) > 0),
      checkbox('Symbol (e.g., !@#$%^&*)', (complexity.minSymbol ?? 0) > 0),
      checkbox('Does not contain part of username', complexity.excludeUsername),
      checkbox('Does not contain first name', excluded.includes('firstName')),
      checkbox('Does not contain last name', excluded.includes('lastName')),
      checkbox('Restrict use of common passwords', complexity.dictionary?.common?.exclude),
    ]),
    section('Password age', [
      text('Enforce password history for last … passwords', age.historyCount),
      text('Minimum password age is', minutesToText(age.minAgeMinutes)),
      text('Password expires after … days', age.maxAgeDays || 'Never'),
      text('Prompt user … days before password expires', age.expireWarnDays || 'Never'),
    ]),
    section('Lock out', [
      text('Lock out user after … unsuccessful attempts', lockout.maxAttempts || 'Never'),
      text(
        'Account will automatically unlock after',
        lockout.autoUnlockMinutes ? minutesToText(lockout.autoUnlockMinutes) : 'Never',
      ),
      checkbox('Show lock out failures', lockout.showLockoutFailures),
      checkbox(
        'Send lockout email to user',
        lockout.userLockoutNotificationChannels?.includes('EMAIL'),
      ),
    ]),
  ];
}

/** "Edit Policy" for any policy type, plus password complexity/age/lockout for password policies. */
export async function policySettingsView(policy: Policy): Promise<FormView> {
  const groups = await groupNames(policy.conditions?.people?.groups?.include);
  return {
    sections: [
      section(undefined, [
        text('Policy name', policy.name),
        textarea('Policy description', policy.description),
        tags('Assign to groups', groups),
      ]),
      ...(policy.type === 'PASSWORD' ? passwordSections(policy) : []),
    ],
    raw: policy,
  };
}
