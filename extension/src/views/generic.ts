/**
 * Fallback for settings objects whose shape varies (OIN app settings,
 * authenticator settings, ...): every primitive becomes a read-only field,
 * nested objects become their own sections.
 */
import { checkbox, section, table, tags, text, type Field, type Section } from '../form/schema';
import { humanize } from './format';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const display = (v: unknown) =>
  isPlainObject(v) || Array.isArray(v) ? JSON.stringify(v) : String(v ?? '');

export function objectSections(
  title: string,
  value: Record<string, unknown> | undefined,
): Section[] {
  if (!value) return [];
  const fields: Field[] = [];
  const nested: Section[] = [];

  for (const [key, v] of Object.entries(value)) {
    if (key.startsWith('_')) continue; // _links, _embedded
    const label = humanize(key);

    if (isPlainObject(v)) {
      nested.push(...objectSections(title ? `${title} › ${label}` : label, v));
    } else if (Array.isArray(v) && v.every(isPlainObject)) {
      const columns = [...new Set(v.flatMap((row) => Object.keys(row)))];
      fields.push(
        table(
          label,
          columns.map(humanize),
          v.map((row) => columns.map((c) => display(row[c]))),
        ),
      );
    } else if (Array.isArray(v)) {
      fields.push(tags(label, v.map(display)));
    } else if (typeof v === 'boolean') {
      fields.push(checkbox(label, v));
    } else {
      fields.push(text(label, display(v)));
    }
  }

  return [section(title || undefined, fields), ...nested];
}
