import {
  checkbox,
  checkboxGroup,
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
      checkboxGroup(
        'Complexity requirements',
        [
          (complexity.minLowerCase ?? 0) > 0 && 'lower',
          (complexity.minUpperCase ?? 0) > 0 && 'upper',
          (complexity.minNumber ?? 0) > 0 && 'number',
          (complexity.minSymbol ?? 0) > 0 && 'symbol',
          complexity.excludeUsername && 'username',
          excluded.includes('firstName') && 'firstName',
          excluded.includes('lastName') && 'lastName',
        ].filter((v): v is string => Boolean(v)),
        {
          lower: 'Lower case letter',
          upper: 'Upper case letter',
          number: 'Number (0-9)',
          symbol: 'Symbol (e.g., !@#$%^&*)',
          username: 'Does not contain part of username',
          firstName: 'Does not contain first name',
          lastName: 'Does not contain last name',
        },
      ),
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
