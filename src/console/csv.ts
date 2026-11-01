/** CSV export of list responses in the API console. */

type Row = Record<string, unknown>;

const isObject = (value: unknown): value is Row =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A row's fields as dot paths (`profile.login`, `credentials.provider.type`),
 * at any depth. Arrays are kept whole, as JSON. Okta's `_links` / `_embedded`
 * are left out.
 */
export function flatten(row: Row, prefix = '', into: Row = {}): Row {
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('_')) continue;
    const path = prefix + key;
    if (isObject(value)) flatten(value, `${path}.`, into);
    else into[path] = value;
  }
  return into;
}

const field = (value: unknown): string => {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * `rows` as CSV (RFC 4180, CRLF line endings): a column for every field of
 * every row, in order of first appearance.
 */
export function toCsv(rows: Row[]): string {
  const flat = rows.map((row) => flatten(row));
  const columns = [...new Set(flat.flatMap((row) => Object.keys(row)))];
  return [columns, ...flat.map((row) => columns.map((c) => row[c]))]
    .map((line) => line.map(field).join(','))
    .join('\r\n');
}

/** `users-2026-10-31.csv` for `/api/v1/users?limit=200`. */
export function csvFilename(url: string, date = new Date()): string {
  const [path = ''] = url.split(/[?#]/);
  const name =
    path
      .replace(/^\/?(api\/v1\/)?/, '')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'response';
  return `${name}-${date.toISOString().slice(0, 10)}.csv`;
}

/** Saves `csv` as a file. The BOM makes Excel read it as UTF-8. */
export function downloadCsv(csv: string, filename: string) {
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
