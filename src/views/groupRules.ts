import { findItems } from '../content/dom';
import {
  inline,
  radio,
  section,
  select,
  tags,
  text,
  textarea,
  type FormView,
} from '../form/schema';
import { getAll } from '../okta/api';
import { groupNames, userLogins } from '../okta/lookups';
import type { GroupRule } from '../okta/types';
import type { ViewProvider } from './types';

const CONDITION_TYPES = {
  basic: 'Use basic condition',
  advanced: 'Use Okta Expression Language (advanced)',
};

/**
 * Okta's rule editor shows `user.<attr>=="<value>"` as a basic condition
 * ([User attribute] [attr] [Equals] [value]); anything else is advanced.
 */
const BASIC = /^\s*user\.([A-Za-z_][\w]*)\s*==\s*"([^"\\]*)"\s*$/;

export const parseBasicCondition = (expression: string | undefined) => {
  const match = expression?.match(BASIC);
  return match ? { attribute: match[1], operator: 'equals', value: match[2] } : undefined;
};

/** Groups › Rules › "View Rule" (Okta's own read-only dialog for active rules) */
export async function groupRuleView(rule: GroupRule): Promise<FormView> {
  const names = rule._embedded?.groupIdToGroupNameMap ?? {};
  const assignTo = (rule.actions?.assignUserToGroups?.groupIds ?? []).map((id) => names[id] ?? id);
  const [excludedUsers, excludedGroups] = await Promise.all([
    userLogins(rule.conditions?.people?.users?.exclude),
    groupNames(rule.conditions?.people?.groups?.exclude),
  ]);
  const expression = rule.conditions?.expression?.value;
  const basic = parseBasicCondition(expression);

  return {
    width: 1000,
    sections: [
      section(undefined, [
        text('Name', rule.name),
        radio('IF', basic ? 'basic' : 'advanced', CONDITION_TYPES),
        basic
          ? inline('', [
              select('Attribute type', 'user', { user: 'User attribute' }),
              // Okta shows "<attr> | <type>"; the type needs a schema lookup, so only the name is shown.
              select('Attribute', basic.attribute, {}),
              select('Operator', basic.operator, { equals: 'Equals' }),
              text('Value', basic.value),
            ])
          : textarea('', expression),
        tags(
          'THEN Assign to',
          assignTo,
          "This rule will not add users to a group they've been manually removed from.",
        ),
        tags('EXCEPT The following users', excludedUsers),
        excludedGroups.length > 0 && tags('EXCEPT The following groups', excludedGroups),
      ]),
    ],
    raw: rule,
  };
}

export const groupRulesProvider: ViewProvider = {
  name: 'Group rules',
  matches: (url) => url.pathname.startsWith('/admin/groups'),
  async findTargets() {
    const rules = await getAll<GroupRule>(
      '/api/v1/groups/rules?limit=200&expand=groupIdToGroupNameMap',
    );
    return findItems(rules, (r) => r.name).map(({ item, anchor, scope }) => ({
      key: `group-rule:${item.id}`,
      title: 'View Rule',
      anchor,
      scope,
      actions: scope.querySelector('.status-col-perf'),
      load: () => groupRuleView(item),
    }));
  },
};
