import { findItems } from '../content/dom';
import { section, tags, text, textarea, type FormView } from '../form/schema';
import { getAll } from '../okta/api';
import { groupNames, userLogins } from '../okta/lookups';
import type { GroupRule } from '../okta/types';
import type { ViewProvider } from './types';

/** Groups › Rules › "Edit Rule" */
export async function groupRuleView(rule: GroupRule): Promise<FormView> {
  const names = rule._embedded?.groupIdToGroupNameMap ?? {};
  const assignTo = (rule.actions?.assignUserToGroups?.groupIds ?? []).map((id) => names[id] ?? id);
  const [excludedUsers, excludedGroups] = await Promise.all([
    userLogins(rule.conditions?.people?.users?.exclude),
    groupNames(rule.conditions?.people?.groups?.exclude),
  ]);

  return {
    sections: [
      section(undefined, [text('Name', rule.name)]),
      section('IF', [
        textarea('Use Okta Expression Language (advanced)', rule.conditions?.expression?.value),
      ]),
      section('THEN', [tags('Assign to', assignTo)]),
      section('EXCEPT', [
        tags('Users', excludedUsers),
        excludedGroups.length > 0 && tags('Groups', excludedGroups),
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
