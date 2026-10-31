/**
 * A declarative description of a read-only form.
 *
 * Every view (SAML settings, policy rule, network zone, ...) maps an Okta API
 * response into a `FormView`. `ReadOnlyForm` lays it out the way Okta's edit
 * dialogs are laid out (label column on the left, inputs on the right), with
 * every input read-only.
 *
 * Labels starting with IF / AND / THEN / EXCEPT get Okta's grey callout chip.
 * An empty label leaves the label column blank, as Okta does for pickers that
 * belong to the field above.
 */

export interface Option {
  value: string;
  label: string;
  /** Grey explanation under the option. */
  hint?: string;
}

export type Field =
  | { type: 'text'; label: string; value: string; hint?: string }
  | { type: 'textarea'; label: string; value: string; hint?: string }
  | { type: 'select'; label: string; value: string; options: Option[]; hint?: string }
  | { type: 'radio'; label: string; value: string; options: Option[]; hint?: string }
  | { type: 'checkbox'; label: string; checked: boolean; hint?: string }
  | { type: 'checkboxGroup'; label: string; options: Option[]; checked: string[]; hint?: string }
  | { type: 'tags'; label: string; values: string[]; hint?: string }
  | { type: 'table'; label: string; columns: string[]; rows: string[][]; hint?: string }
  /** Several inputs on one line, e.g. "8 [Hours]" or a basic group rule condition. */
  | { type: 'inline'; label: string; fields: Field[]; hint?: string }
  /** Explanatory text across the whole dialog, optionally with a bulleted list. */
  | { type: 'note'; label: string; text: string; items: string[]; hint?: string };

export interface Section {
  title?: string;
  description?: string;
  fields: Field[];
}

export interface FormView {
  /** Okta's intro paragraph under the dialog title. */
  description?: string;
  /** Dialog width in px; Okta's dialogs range from ~650 (authenticators) to ~1000. */
  width?: number;
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

export const inline = (
  label: string,
  fields: Array<Field | false | null | undefined>,
  hint?: string,
): Field => ({
  type: 'inline',
  label,
  fields: fields.filter((f): f is Field => Boolean(f)),
  hint,
});

export const note = (text: string, items: string[] = []): Field => ({
  type: 'note',
  label: '',
  text,
  items,
});

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
