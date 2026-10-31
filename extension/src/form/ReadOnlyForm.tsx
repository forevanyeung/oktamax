import type { ReactElement, ReactNode } from 'react';

import type { Field, FormView, Option } from './schema';

// Okta's rule dialogs prefix condition labels with a grey "IF" / "AND" / "THEN" chip.
const CALLOUT = /^(IF|AND|THEN|EXCEPT)(\s+|$)/;

const Label = ({ text }: { text: string }) => {
  const callout = text.match(CALLOUT)?.[1];
  return callout ? (
    <>
      <span className="callout">{callout}</span>
      {text.slice(callout.length).trim()}
    </>
  ) : (
    <>{text}</>
  );
};

const Hint = ({ text }: { text?: string }) => (text ? <p className="hint">{text}</p> : null);

/** Radios and checkboxes are drawn, not real inputs, so there is nothing to toggle. */
const Choice = ({
  kind,
  option,
  checked,
}: {
  kind: 'radio' | 'checkbox';
  option: Pick<Option, 'label' | 'hint'>;
  checked: boolean;
}) => (
  <div
    className={`option ${kind}${checked ? ' checked' : ''}`}
    role={kind}
    aria-checked={checked}
    aria-disabled
    aria-label={option.label}
  >
    {option.label}
    <Hint text={option.hint} />
  </div>
);

/** The input part of a field, without its label column. */
function Control({ field }: { field: Field }): ReactElement {
  const name = field.label.replace(CALLOUT, '') || undefined;

  switch (field.type) {
    case 'text':
      return <input className="box" readOnly value={field.value} aria-label={name} />;

    case 'textarea':
      return (
        <textarea
          className="box"
          readOnly
          value={field.value}
          rows={Math.max(1, field.value.split('\n').length)}
          aria-label={name}
        />
      );

    case 'select':
      return (
        <div
          className="box select"
          role="combobox"
          aria-label={name}
          aria-readonly
          aria-expanded={false}
        >
          {field.options.find((o) => o.value === field.value)?.label ?? field.value}
        </div>
      );

    case 'radio':
      return (
        <div role="radiogroup" aria-label={name} aria-readonly>
          {field.options.map((o) => (
            <Choice key={o.value} kind="radio" option={o} checked={o.value === field.value} />
          ))}
        </div>
      );

    case 'checkbox':
      return <Choice kind="checkbox" option={field} checked={field.checked} />;

    case 'checkboxGroup':
      return (
        <div role="group" aria-label={name}>
          {field.options.map((o) => (
            <Choice
              key={o.value}
              kind="checkbox"
              option={o}
              checked={field.checked.includes(o.value)}
            />
          ))}
        </div>
      );

    case 'tags':
      return (
        <div className="box chips" role="list" aria-label={name}>
          {field.values.map((v) => (
            <span key={v} className="chip" role="listitem">
              {v}
            </span>
          ))}
        </div>
      );

    case 'table':
      return (
        <div role="table" aria-label={name}>
          <div className="table-row table-head" role="row">
            {field.columns.map((c) => (
              <span key={c} role="columnheader">
                {c}
              </span>
            ))}
          </div>
          {(field.rows.length > 0 ? field.rows : [[]]).map((row, i) => (
            <div key={i} className="table-row" role="row">
              {field.columns.map((c, j) => (
                <input key={c} className="box" readOnly value={row[j] ?? ''} aria-label={c} />
              ))}
            </div>
          ))}
        </div>
      );

    case 'inline':
      return (
        <div className="inline">
          {field.fields.map((f, i) => (
            <Control key={i} field={f} />
          ))}
        </div>
      );

    case 'note':
      return (
        <div className="note">
          <p>{field.text}</p>
          {field.items.length > 0 && (
            <ul>
              {field.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      );
  }
}

// Fields drawn as a 38px box: their label is nudged down to line up with the box's text.
const BOXED = new Set<Field['type']>(['text', 'textarea', 'select', 'tags', 'table', 'inline']);

function Row({ field }: { field: Field }): ReactNode {
  // Notes, and tables without a label (attribute statements), span the whole dialog.
  if (field.type === 'note' || (field.type === 'table' && !field.label)) {
    return (
      <div className="row">
        <Control field={field} />
      </div>
    );
  }
  // A lone checkbox carries its own label, so Okta leaves the label column empty.
  const label = field.type === 'checkbox' ? '' : field.label;
  return (
    <div className="row">
      <div className={`label${BOXED.has(field.type) ? ' boxed' : ''}`}>
        <Label text={label} />
      </div>
      <div className="input">
        <Control field={field} />
        {field.type !== 'checkbox' && <Hint text={field.hint} />}
      </div>
    </div>
  );
}

export const ReadOnlyForm = ({ view }: { view: FormView }) => (
  <>
    {view.description && <p className="description">{view.description}</p>}
    {view.sections
      .filter((s) => s.fields.length > 0 || s.description)
      .map((s, i) => (
        <section key={i} className="section">
          {s.title && <h2 className="section-head">{s.title}</h2>}
          {s.description && <p className="section-description">{s.description}</p>}
          {s.fields.map((f, j) => (
            <Row key={`${f.label}-${j}`} field={f} />
          ))}
        </section>
      ))}
    {view.raw !== undefined && (
      <details className="raw">
        <summary>API response (JSON)</summary>
        <pre>{JSON.stringify(view.raw, null, 2)}</pre>
      </details>
    )}
  </>
);
