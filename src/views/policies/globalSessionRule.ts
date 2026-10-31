import { radio, section, select, tags, text, type FormView } from '../../form/schema';
import { get } from '../../okta/api';
import { userLogins } from '../../okta/lookups';
import type { PolicyRule } from '../../okta/types';
import { durationField, networkFields, riskField } from './conditions';

/** Identity provider names for "Specific IdP", falling back to the ID. */
const idpNames = (ids: string[] | undefined) =>
  Promise.all(
    (ids ?? []).map((id) =>
      get<{ name: string }>(`/api/v1/idps/${id}`).then(
        (idp) => idp.name,
        () => id,
      ),
    ),
  );

/** Security › Global Session Policy › policy › "Edit Rule" */
export async function globalSessionRuleView(rule: PolicyRule): Promise<FormView> {
  const c = rule.conditions ?? {};
  const signon = rule.actions?.signon ?? {};
  const session = signon.session ?? {};
  const allowed = signon.access !== 'DENY';
  const lifetime = session.maxSessionLifetimeMinutes;
  const provider = c.identityProvider?.provider ?? 'ANY';

  const [excludedUsers, network, idps] = await Promise.all([
    userLogins(c.people?.users?.exclude),
    networkFields(c.network, "IF User's IP is", 'classic', 'Manage configuration for Networks'),
    idpNames(provider === 'SPECIFIC_IDP' ? c.identityProvider?.idpIds : []),
  ]);

  return {
    sections: [
      section(undefined, [text('Rule name', rule.name), tags('Exclude users', excludedUsers)]),
      section('Policy settings', [
        ...network,
        select('AND Identity provider is', provider, {
          ANY: 'Any',
          OKTA: 'Okta',
          SPECIFIC_IDP: 'Specific IdP',
        }),
        provider === 'SPECIFIC_IDP' && tags('', idps),
        select('AND Authenticates via', c.authContext?.authType ?? 'ANY', {
          ANY: 'Any',
          RADIUS: 'RADIUS',
        }),
        tags('AND Behavior is', c.risk?.behaviors),
        riskField(c.riskScore, 'AND Risk is'),
        select('THEN Access is', signon.access, { ALLOW: 'Allowed', DENY: 'Denied' }),
        allowed &&
          radio(
            'Establish the user session with',
            signon.primaryFactor,
            {
              PASSWORD_IDP_ANY_FACTOR:
                'Any factor used to meet the Authentication Policy requirements',
              PASSWORD_IDP: 'A password',
            },
            'An IdP claim will satisfy either of these options. The Authentication Policy determines the authentication requirement for a request.',
          ),
        allowed &&
          radio(
            'Multifactor authentication (MFA) is',
            signon.requireFactor ?? false,
            { false: 'Not required', true: 'Required' },
            'You can use the Authentication Policy to define multifactor requirements and characteristics of the allowed authenticators.',
          ),
        allowed &&
          signon.requireFactor &&
          radio('Users will be prompted for MFA', signon.factorPromptMode, {
            ALWAYS: 'At every sign in',
            DEVICE: 'When signing in with a new device cookie',
            SESSION: 'After MFA lifetime expires for the device cookie',
          }),
        allowed &&
          signon.requireFactor &&
          signon.factorPromptMode === 'SESSION' &&
          durationField('', signon.factorLifetime),
      ]),
      ...(!allowed
        ? []
        : [
            section(
              'Okta global session management',
              [
                radio('Maximum Okta global session lifetime', lifetime ? 'SET' : 'NONE', {
                  NONE: 'No time limit',
                  SET: 'Set time limit (Recommended)',
                }),
                Boolean(lifetime) &&
                  durationField(
                    '',
                    lifetime,
                    'Setting a maximum session lifetime reduces the risk of session cookie misuse or hijacking. Global sessions will expire even if no maximum idle time is set.',
                  ),
                durationField(
                  'Maximum Okta global session idle time',
                  session.maxSessionIdleMinutes,
                  'A global session will expire when the user is inactive for the specified amount of time, regardless of the maximum global session lifetime.',
                ),
                select(
                  'Okta global session cookies persist across browser sessions',
                  session.usePersistentCookie ?? false,
                  { false: 'Disable (Recommended)', true: 'Enable' },
                  'If Enable is selected: when a user reopens their browser, and their session is still active, they won’t be asked to sign in again.',
                ),
              ],
              'The Okta global session is also referred to as the Okta IdP session or Single Sign-on (SSO) session.',
            ),
          ]),
    ],
    raw: rule,
  };
}
