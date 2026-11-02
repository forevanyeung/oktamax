/** Small formatting helpers shared by the views. */

/** "maxSessionIdleMinutes" / "max_session_idle" -> "Max session idle minutes" */
export const humanize = (key: string) => {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Look up a display label, falling back to the raw value. */
export const labelFor = (labels: Record<string, string>, value: string | null | undefined) =>
  value ? (labels[value] ?? value) : '';

/** ISO-8601 durations as Okta shows them: "PT2H" -> "2 hours", "PT0S" -> "0 minutes". */
export function isoDuration(value: string | undefined): string {
  if (!value) return '';
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return value;
  const [, days, hours, minutes, seconds] = match.map(Number);
  const totalMinutes =
    (days || 0) * 1440 + (hours || 0) * 60 + (minutes || 0) + Math.floor((seconds || 0) / 60);
  return minutesToText(totalMinutes);
}

/** 90 -> "90 minutes", 120 -> "2 hours", 2880 -> "2 days" (Okta's unit pickers). */
export function minutesToText(minutes: number | undefined): string {
  if (minutes === undefined || minutes === null) return '';
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (minutes > 0 && minutes % 1440 === 0) return plural(minutes / 1440, 'day');
  if (minutes > 0 && minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

export const ACCESS: Record<string, string> = { ALLOW: 'Allowed', DENY: 'Denied' };

export const STATUS: Record<string, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive' };
