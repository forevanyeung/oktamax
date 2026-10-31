import { checkboxGroup, note, radio, section, tags, text, type FormView } from '../../form/schema';
import { userLogins } from '../../okta/lookups';
import type { PolicyRule } from '../../okta/types';
import { networkFields } from './conditions';

/** Fields of the password reset requirement not (yet) in `PolicyRule`. */
interface ResetRequirement {
  accessControl?: 'AUTH_POLICY' | 'LEGACY';
  primary?: {
    methods?: string[];
    methodConstraints?: { otp?: { allowedAuthenticators?: Array<{ key?: string }> } };
  };
  stepUp?: { required?: boolean; methods?: string[] };
}

/** Okta lists the org's recovery-capable authenticators; these are the standard ones. */
const RECOVERY_METHODS = [
  { value: 'push', label: 'Okta Verify (Push notification only)' },
  { value: 'phone', label: 'Phone (SMS / Voice call)' },
  { value: 'email', label: 'Email' },
  { value: 'google_otp', label: 'Google Authenticator' },
];

function recoveryMethods(primary: ResetRequirement['primary']): string[] {
  const methods = new Set<string>();
  for (const m of primary?.methods ?? []) {
    if (m === 'sms' || m === 'voice') methods.add('phone');
    else if (m === 'otp') {
      const keys = primary?.methodConstraints?.otp?.allowedAuthenticators?.map((a) => a.key);
      for (const key of keys?.length ? keys : ['otp']) if (key) methods.add(key);
    } else methods.add(m);
  }
  return [...methods];
}

function additionalVerification(stepUp: ResetRequirement['stepUp']): string {
  if (!stepUp) return ''; // Okta leaves every option unselected.
  if (!stepUp.required) return 'NONE';
  return stepUp.methods?.includes('security_question') ? 'SECURITY_QUESTION' : 'ANY';
}

/** Security › Authenticators › Password › policy › "Edit Rule" */
export async function passwordRuleView(rule: PolicyRule): Promise<FormView> {
  const c = rule.conditions ?? {};
  const a = rule.actions ?? {};
  const requirement = a.selfServicePasswordReset?.requirement as ResetRequirement | undefined;
  const accessControl = requirement?.accessControl ?? 'LEGACY';
  const selfService = [
    a.passwordChange?.access === 'ALLOW' && 'CHANGE',
    a.selfServicePasswordReset?.access === 'ALLOW' && 'RESET',
    a.selfServiceUnlock?.access === 'ALLOW' && 'UNLOCK',
  ].filter((v): v is string => Boolean(v));
  const recovery = selfService.includes('RESET') || selfService.includes('UNLOCK');

  const [excludedUsers, network] = await Promise.all([
    userLogins(c.people?.users?.exclude),
    networkFields(c.network, "IF User's IP is", 'classic', 'Manage configuration for Networks'),
  ]);

  return {
    sections: [
      section(undefined, [text('Rule name', rule.name), tags('Exclude users', excludedUsers)]),
      section(undefined, network),
      section(undefined, [
        checkboxGroup('THEN Users can perform self-service', selfService, [
          {
            value: 'CHANGE',
            label: 'Password change (from account settings)',
            hint: 'From their account settings or when their password is expiring.',
          },
          {
            value: 'RESET',
            label: 'Password reset',
            hint: 'When they’ve forgotten their current password.',
          },
          { value: 'UNLOCK', label: 'Unlock account' },
        ]),
      ]),
      ...(!recovery
        ? []
        : [
            section(
              'Recovery authenticators',
              [
                radio('Access control', accessControl, [
                  {
                    value: 'AUTH_POLICY',
                    label: 'Authentication policy',
                    hint: 'Use the Okta account management authentication policy to control conditions and authentication requirements for changing an expiring password, password reset, or unlock account.',
                  },
                  {
                    value: 'LEGACY',
                    label: 'This rule (legacy)',
                    hint: 'Until you’ve reviewed the Okta account management authentication policy, control access with this rule. Changing an expiring password will be allowed after the user authenticates with only their current password.',
                  },
                ]),
                accessControl === 'LEGACY' &&
                  note(
                    'Certain combinations of settings between Password Recovery, Authenticator Setup, and Enrollment Policy may prevent users from completing recovery. Learn how to avoid this in documentation.',
                  ),
                accessControl === 'LEGACY' &&
                  checkboxGroup(
                    'AND Users can initiate recovery with',
                    recoveryMethods(requirement?.primary),
                    RECOVERY_METHODS,
                  ),
                accessControl === 'LEGACY' &&
                  radio(
                    'AND Additional verification is',
                    additionalVerification(requirement?.stepUp),
                    [
                      { value: 'NONE', label: 'Not required' },
                      {
                        value: 'ANY',
                        label: 'Any enrolled authenticator used for MFA/SSO',
                        hint: 'At least two non-email authenticators should set to Required in Enrollment Policy for groups assigned to this policy',
                      },
                      { value: 'SECURITY_QUESTION', label: 'Only Security Question' },
                    ],
                  ),
              ],
              'Determine which authenticators a user will be asked for when performing self-service password reset, unlock account, or changing an expiring password. Changing a password from account settings will be protected by authentication policy regardless of this setting.',
            ),
          ]),
    ],
    raw: rule,
  };
}
