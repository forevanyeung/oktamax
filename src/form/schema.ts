/**
 * A declarative description of a read-only form.
 *
 * Every view (SAML settings, policy rule, network zone, ...) maps an Okta API
 * response into a `FormView`. `ReadOnlyForm` turns it into the same Odyssey
 * components Okta uses for its edit dialogs, with every input read-only.
 */

export interface Option {
  value: string;
  label: string;
}

export type Field =
  | { type: 'text'; label: string; value: string; hint?: string }
  | { type: 'textarea'; label: string; value: string; hint?: string }
  | { type: 'select'; label: string; value: string; options: Option[]; hint?: string }
  | { type: 'radio'; label: string; value: string; options: Option[]; hint?: string }
  | { type: 'checkbox'; label: string; checked: boolean; hint?: string }
  | { type: 'checkboxGroup'; label: string; options: Option[]; checked: string[]; hint?: string }
  | { type: 'tags'; label: string; values: string[]; hint?: string }
  | { type: 'table'; label: string; columns: string[]; rows: string[][]; hint?: string };

export interface Section {
  title?: string;
  description?: string;
  fields: Field[];
}

export interface FormView {
  sections: Section[];
  /** Raw API payload(s), shown in a collapsed accordion for anything the form doesn't cover. */
  raw?: unknown;
}

// ---------------------------------------------------------------------------
// Builders. Views read best as a list of `text(...)`, `radio(...)` calls, and
// these helpers take care of normalising `undefined`/`null` from the API.
// ---------------------------------------------------------------------------

type Maybe<T> = T | null | undefined;
type OptionsInput = Record<string, string> | Option[];

const toOptions = (options: OptionsInput): Option[] =>
  Array.isArray(options)
    ? options
    : Object.entries(options).map(([value, label]) => ({ value, label }));

/** Make sure the current value is always selectable, even if Okta added a new enum value. */
const withValue = (options: Option[], value: string): Option[] =>
  value === '' || options.some((o) => o.value === value)
    ? options
    : [...options, { value, label: value }];

const str = (value: Maybe<string | number | boolean>): string =>
  value === null || value === undefined ? '' : String(value);

export const text = (label: string, value: Maybe<string | number>, hint?: string): Field => ({
  type: 'text',
  label,
  value: str(value),
  hint,
});

export const textarea = (label: string, value: Maybe<string | string[]>, hint?: string): Field => ({
  type: 'textarea',
  label,
  value: Array.isArray(value) ? value.join('\n') : str(value),
  hint,
});

export const select = (
  label: string,
  value: Maybe<string | boolean>,
  options: OptionsInput,
  hint?: string,
): Field => ({
  type: 'select',
  label,
  value: str(value),
  options: withValue(toOptions(options), str(value)),
  hint,
});

export const radio = (
  label: string,
  value: Maybe<string | boolean>,
  options: OptionsInput,
  hint?: string,
): Field => ({
  type: 'radio',
  label,
  value: str(value),
  options: withValue(toOptions(options), str(value)),
  hint,
});

export const checkbox = (label: string, checked: Maybe<boolean>, hint?: string): Field => ({
  type: 'checkbox',
  label,
  checked: Boolean(checked),
  hint,
});

export const checkboxGroup = (
  label: string,
  checked: Maybe<string[]>,
  options: OptionsInput,
  hint?: string,
): Field => {
  const values = checked ?? [];
  return {
    type: 'checkboxGroup',
    label,
    checked: values,
    options: values.reduce(withValue, toOptions(options)),
    hint,
  };
};

export const tags = (label: string, values: Maybe<string[]>, hint?: string): Field => ({
  type: 'tags',
  label,
  values: values ?? [],
  hint,
});

export const table = (
  label: string,
  columns: string[],
  rows: Array<Array<Maybe<string | number>>>,
  hint?: string,
): Field => ({ type: 'table', label, columns, rows: rows.map((r) => r.map(str)), hint });

/** Drop `false`/`undefined` entries so views can write `cond && text(...)` inline. */
export const section = (
  title: string | undefined,
  fields: Array<Field | false | null | undefined>,
  description?: string,
): Section => ({
  title,
  description,
  fields: fields.filter((f): f is Field => Boolean(f)),
});
