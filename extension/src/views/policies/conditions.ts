/** Rule conditions and inputs shared across policy types. */
import { inline, select, tags, text, type Field, type Option } from '../../form/schema';
import { zoneNames } from '../../okta/lookups';
import type { PolicyRule } from '../../okta/types';

type Conditions = NonNullable<PolicyRule['conditions']>;

/**
 * "User's IP is" dropdown. Global session and password rules use the classic
 * wording ("Anywhere"); authentication policy rules use the newer one.
 */
const NETWORK_OPTIONS = {
  classic: {
    ANYWHERE: 'Anywhere',
    IN_ZONE: 'In zone',
    NOT_IN_ZONE: 'Not in zone',
  },
  access: {
    ANYWHERE: 'Any IP',
    IN_ZONE: 'In any of the following zones:',
    NOT_IN_ZONE: 'Not in any of the following zones:',
  },
};

export async function networkFields(
  network: Conditions['network'],
  label: string,
  style: keyof typeof NETWORK_OPTIONS,
  hint?: string,
): Promise<Field[]> {
  const included = network?.include ?? [];
  const excluded = network?.exclude ?? [];
  const value =
    network?.connection !== 'ZONE' ? 'ANYWHERE' : included.length > 0 ? 'IN_ZONE' : 'NOT_IN_ZONE';
  const zones = await zoneNames(value === 'IN_ZONE' ? included : excluded);

  // The zone picker sits under the dropdown, with an empty label column.
  return value === 'ANYWHERE'
    ? [select(label, value, NETWORK_OPTIONS[style], hint)]
    : [select(label, value, NETWORK_OPTIONS[style]), tags('', zones, hint)];
}

export const riskField = (riskScore: Conditions['riskScore'], label: string) =>
  select(label, riskScore?.level ?? 'ANY', {
    ANY: 'Any',
    LOW: 'Low',
    MEDIUM: 'Medium',
    HIGH: 'High',
  });

/** Okta's "Any X" / "One of the following X:" dropdown, with the picker under it. */
export const anyOrSome = (
  label: string,
  values: string[],
  anyLabel: string,
  someLabel: string,
): Field[] => [
  select(label, values.length > 0 ? 'SOME' : 'ANY', { ANY: anyLabel, SOME: someLabel }),
  ...(values.length > 0 ? [tags('', values)] : []),
];

const UNITS: Option[] = [
  { value: 'MINUTES', label: 'Minutes' },
  { value: 'HOURS', label: 'Hours' },
  { value: 'DAYS', label: 'Days' },
];

/** Minutes as Okta's "[8] [Hours]" number + unit pair, using the largest whole unit. */
export function durationField(label: string, minutes: number | undefined, hint?: string): Field {
  if (minutes === undefined || minutes === null) {
    return inline(label, [text('', ''), select('', 'MINUTES', UNITS)], hint);
  }
  const [amount, unit] =
    minutes > 0 && minutes % 1440 === 0
      ? [minutes / 1440, 'DAYS']
      : minutes > 0 && minutes % 60 === 0
        ? [minutes / 60, 'HOURS']
        : [minutes, 'MINUTES'];
  return inline(label, [text('', amount), select('', unit, UNITS)], hint);
}

/** ISO-8601 duration ("PT2H", "P1D", "PT30M") in minutes; undefined if absent or unparseable. */
export function isoMinutes(value: string | undefined): number | undefined {
  const match = value?.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return undefined;
  const [days = 0, hours = 0, minutes = 0, seconds = 0] = match.slice(1).map((n) => Number(n ?? 0));
  return days * 1440 + hours * 60 + minutes + Math.floor(seconds / 60);
}
