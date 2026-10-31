/** Rule conditions shared across policy types. */
import { radio, select, tags, type Field } from '../../form/schema';
import { zoneNames } from '../../okta/lookups';
import type { PolicyRule } from '../../okta/types';

type Conditions = NonNullable<PolicyRule['conditions']>;

export async function networkFields(
  network: Conditions['network'],
  label = "User's IP is",
): Promise<Field[]> {
  const included = network?.include ?? [];
  const excluded = network?.exclude ?? [];
  const value =
    network?.connection !== 'ZONE' ? 'ANYWHERE' : included.length > 0 ? 'IN_ZONE' : 'NOT_IN_ZONE';
  const zones = await zoneNames(value === 'IN_ZONE' ? included : excluded);

  return [
    radio(label, value, {
      ANYWHERE: 'Any IP',
      IN_ZONE: 'In any of the following zones',
      NOT_IN_ZONE: 'Not in any of the following zones',
    }),
    ...(value === 'ANYWHERE' ? [] : [tags('Zones', zones)]),
  ];
}

export const riskField = (riskScore: Conditions['riskScore'], label = 'Risk is') =>
  select(label, riskScore?.level ?? 'ANY', {
    ANY: 'Any',
    LOW: 'Low',
    MEDIUM: 'Medium',
    HIGH: 'High',
  });

/** Okta's "Any X" / "One of the following X" radio + picker pair. */
export const anyOrSome = (
  label: string,
  values: string[],
  anyLabel: string,
  someLabel: string,
  pickerLabel: string,
): Field[] => [
  radio(label, values.length > 0 ? 'SOME' : 'ANY', { ANY: anyLabel, SOME: someLabel }),
  ...(values.length > 0 ? [tags(pickerLabel, values)] : []),
];
