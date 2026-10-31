import {
  checkbox,
  checkboxGroup,
  radio,
  section,
  tags,
  text,
  type FormView,
} from '../../form/schema';
import { userLogins } from '../../okta/lookups';
import type { PolicyRule } from '../../okta/types';
import { networkFields } from './conditions';

const RECOVERY_METHODS = {
  push: 'Okta Verify (Push)',
  sms: 'Phone (SMS)',
  voice: 'Phone (Voice call)',
  email: 'Email',
};

/** Security › Authenticators › Password › policy › "Edit Rule" */
export async function passwordRuleView(rule: PolicyRule): Promise<FormView> {
  const c = rule.conditions ?? {};
  const a = rule.actions ?? {};
  const reset = a.selfServicePasswordReset;
  const stepUp = reset?.requirement?.stepUp;
  const [excludedUsers, network] = await Promise.all([
    userLogins(c.people?.users?.exclude),
    networkFields(c.network, "IF User's IP is"),
  ]);

  return {
    sections: [
      section(undefined, [text('Rule name', rule.name), tags('Exclude Users', excludedUsers)]),
      section('Conditions', network),
      section('Actions', [
        checkbox('THEN User can change password', a.passwordChange?.access === 'ALLOW'),
        checkbox('AND User can perform self-service password reset', reset?.access === 'ALLOW'),
        reset?.access === 'ALLOW' &&
          checkboxGroup(
            'Users can initiate recovery with',
            reset.requirement?.primary?.methods,
            RECOVERY_METHODS,
          ),
        reset?.access === 'ALLOW' &&
          radio(
            'Additional verification is',
            !stepUp?.required
              ? 'NONE'
              : stepUp.methods?.includes('security_question')
                ? 'SECURITY_QUESTION'
                : 'ANY',
            {
              NONE: 'Not required',
              ANY: 'Any enrolled authenticator used for MFA/SSO',
              SECURITY_QUESTION: 'Security question',
            },
          ),
        checkbox(
          'AND User can perform self-service account unlock',
          a.selfServiceUnlock?.access === 'ALLOW',
        ),
      ]),
    ],
    raw: rule,
  };
}
