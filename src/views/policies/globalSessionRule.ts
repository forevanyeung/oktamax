import { radio, section, select, tags, text, type FormView } from '../../form/schema';
import { userLogins } from '../../okta/lookups';
import type { PolicyRule } from '../../okta/types';
import { ACCESS, minutesToText } from '../format';
import { networkFields, riskField } from './conditions';

/** Security › Global Session Policy › policy › "Edit Rule" */
export async function globalSessionRuleView(rule: PolicyRule): Promise<FormView> {
  const c = rule.conditions ?? {};
  const signon = rule.actions?.signon ?? {};
  const lifetime = signon.session?.maxSessionLifetimeMinutes;
  const [excludedUsers, network] = await Promise.all([
    userLogins(c.people?.users?.exclude),
    networkFields(c.network, "IF User's IP is"),
  ]);

  return {
    sections: [
      section(undefined, [text('Rule name', rule.name), tags('Exclude users', excludedUsers)]),
      section('Conditions', [
        ...network,
        select('AND Identity provider is', c.identityProvider?.provider ?? 'ANY', {
          ANY: 'Any',
          OKTA: 'Okta',
          SPECIFIC_IDP: 'Specific IdP',
        }),
        c.risk?.behaviors && tags('AND Behavior is', c.risk.behaviors),
        riskField(c.riskScore, 'AND Risk is'),
        select('AND Authenticates via', c.authContext?.authType ?? 'ANY', {
          ANY: 'Any',
          RADIUS: 'RADIUS',
        }),
      ]),
      section('Actions', [
        radio('THEN Access is', signon.access, ACCESS),
        select('Establish the user session with', signon.primaryFactor, {
          PASSWORD_IDP_ANY_FACTOR: 'Any factor used to meet the Authentication Policy requirements',
          PASSWORD_IDP: 'A password',
        }),
        radio('Multifactor authentication (MFA) is', signon.requireFactor ?? false, {
          true: 'Required',
          false: 'Not required',
        }),
        signon.requireFactor &&
          radio('Users will be prompted for MFA', signon.factorPromptMode, {
            DEVICE: 'When signing in with a new device cookie',
            SESSION: 'After MFA lifetime expires for the device cookie',
            ALWAYS: 'Every time user signs in to Okta',
          }),
        signon.requireFactor &&
          signon.factorPromptMode === 'SESSION' &&
          text('MFA lifetime', minutesToText(signon.factorLifetime)),
        text(
          'Maximum Okta global session idle time',
          minutesToText(signon.session?.maxSessionIdleMinutes),
        ),
        text(
          'Maximum Okta global session lifetime',
          lifetime ? minutesToText(lifetime) : 'No time limit',
        ),
        radio(
          'Okta global session cookies persist across browser sessions',
          signon.session?.usePersistentCookie ?? false,
          {
            true: 'Enable',
            false: 'Disable',
          },
        ),
      ]),
    ],
    raw: rule,
  };
}
