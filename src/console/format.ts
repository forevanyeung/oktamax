/** Formatting for the API console's response panel and history. */

type Row = Record<string, unknown>;

const isObject = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isScalar = (value: unknown) => value === null || typeof value !== 'object';

/** A list response that reads well as a table: an array of objects. */
export const isTable = (json: unknown): json is Row[] =>
  Array.isArray(json) && json.length > 0 && json.every(isObject);

const MAX_COLUMNS = 40;

/**
 * Columns for a table of `rows`: their scalar fields, then the scalar fields of
 * nested objects (`profile.login`), in order of first appearance. Okta's
 * `_links` / `_embedded` are left out.
 */
export function tableColumns(rows: Row[]): string[] {
  const top = new Set<string>();
  const nested = new Set<string>();
  for (const row of rows.slice(0, 100)) {
    for (const [key, value] of Object.entries(row)) {
      if (key.startsWith('_')) continue;
      if (isScalar(value)) top.add(key);
      else if (isObject(value)) {
        for (const [sub, subValue] of Object.entries(value)) {
          if (isScalar(subValue)) nested.add(`${key}.${sub}`);
        }
      }
    }
  }
  return [...top, ...nested].slice(0, MAX_COLUMNS);
}

export function cell(row: Row, column: string): string {
  const [key = '', sub] = column.split('.', 2);
  const value = sub === undefined ? row[key] : (row[key] as Row | undefined)?.[sub];
  return value === undefined || value === null ? '' : String(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function timeAgo(at: number, now = Date.now()): string {
  const seconds = Math.round((now - at) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** `errorSummary` and `errorCauses` of an Okta error response. */
export function oktaError(json: unknown): string[] | undefined {
  if (!isObject(json) || typeof json.errorSummary !== 'string') return undefined;
  const causes = Array.isArray(json.errorCauses) ? json.errorCauses : [];
  return [
    json.errorSummary,
    ...causes
      .map((c) => (isObject(c) ? c.errorSummary : undefined))
      .filter((s): s is string => typeof s === 'string' && s !== json.errorSummary),
  ];
}
