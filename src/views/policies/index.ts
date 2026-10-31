import { findItems, findSections, headingTexts } from '../../content/dom';
import type { FormView } from '../../form/schema';
import { get, getAll } from '../../okta/api';
import type { Policy, PolicyRule, PolicyType } from '../../okta/types';
import { objectSections } from '../generic';
import type { ViewProvider, ViewTarget } from '../types';
import { accessPolicyRuleView } from './accessPolicyRule';
import { globalSessionRuleView } from './globalSessionRule';
import { passwordRuleView } from './passwordRule';
import { policySettingsView } from './policySettings';

/** Admin console pages that show policies of a given type. */
const POLICY_PAGES: Array<{ path: RegExp; type: PolicyType }> = [
  { path: /^\/admin\/(authn\/)?authentication-policies/, type: 'ACCESS_POLICY' },
  { path: /^\/admin\/access\/policies/, type: 'OKTA_SIGN_ON' },
  { path: /^\/admin\/access\/(authenticators|authentication)/, type: 'PASSWORD' },
];

// Policy IDs appear in some URLs, e.g. #authentication-policies/policy/rst1abc.../
const POLICY_ID = /\b((?:00p|rst)[A-Za-z0-9]{17})\b/;

const RULE_VIEWS: Record<string, (rule: PolicyRule) => Promise<FormView>> = {
  ACCESS_POLICY: accessPolicyRuleView,
  OKTA_SIGN_ON: globalSessionRuleView,
  PASSWORD: passwordRuleView,
};

const genericRuleView = async (rule: PolicyRule): Promise<FormView> => ({
  sections: [
    ...objectSections('Conditions', rule.conditions ?? undefined),
    ...objectSections('Actions', rule.actions),
  ],
  raw: rule,
});

/** Which policy is the admin looking at? URL id first, then the visible heading. */
function selectedPolicy(url: URL, policies: Policy[]): Policy | undefined {
  const id = (url.pathname + url.hash).match(POLICY_ID)?.[1];
  if (id) return policies.find((p) => p.id === id);
  const headings = new Set(headingTexts());
  return (
    policies.find((p) => headings.has(p.name)) ?? (policies.length === 1 ? policies[0] : undefined)
  );
}

export const policiesProvider: ViewProvider = {
  name: 'Policies',
  matches: (url) => POLICY_PAGES.some((p) => p.path.test(url.pathname)),
  async findTargets(url) {
    const page = POLICY_PAGES.find((p) => p.path.test(url.pathname));
    if (!page) return [];

    const policies = await getAll<Policy>(`/api/v1/policies?type=${page.type}&limit=200`);
    const policy = selectedPolicy(url, policies);
    if (!policy) return [];

    const rules = await get<PolicyRule[]>(`/api/v1/policies/${policy.id}/rules?limit=200`);
    const ruleView = RULE_VIEWS[policy.type] ?? genericRuleView;

    const policyTargets: ViewTarget[] = findSections([policy.name]).map(({ anchor, scope }) => ({
      key: `policy:${policy.id}`,
      title: 'View Policy',
      anchor,
      scope,
      load: () => policySettingsView(policy),
    }));

    const ruleTargets: ViewTarget[] = findItems(rules, (r) => r.name).map(
      ({ item, anchor, scope }) => ({
        key: `policy-rule:${item.id}`,
        title: 'View Rule',
        anchor,
        scope,
        load: () => ruleView(item),
      }),
    );

    return [...policyTargets, ...ruleTargets];
  },
};
