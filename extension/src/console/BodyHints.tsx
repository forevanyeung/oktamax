/**
 * Beside the Body tab's editor: the request body's fields from Okta's API
 * reference for the endpoint being typed, which required ones the JSON is
 * missing, and its examples to start from.
 */
import { useEffect, useMemo, useState } from 'react';

import {
  exampleBody,
  loadBodySchema,
  missingFields,
  presentFields,
  skeleton,
  type BodyField,
  type BodySchema,
} from './body';
import type { ApiRequest } from './request';
import { endpointFor } from './suggest';

/** Lists longer than this get a filter. */
const FILTER_AFTER = 12;

type Loaded = { key: string; schema: BodySchema | undefined };

const parse = (body: string): { value: unknown } | undefined => {
  if (!body.trim()) return { value: {} };
  try {
    return { value: JSON.parse(body) as unknown };
  } catch {
    return undefined;
  }
};

const FieldRow = ({ field, state }: { field: BodyField; state?: 'set' | 'missing' }) => {
  const dot = field.p.lastIndexOf('.');
  const depth = field.p.split('.').length - 1;
  return (
    <li
      className={`body-field${state ? ` ${state}` : ''}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      title={field.e ? `One of: ${field.e.join(', ')}` : undefined}
    >
      <div className="body-field-head">
        <span className="body-field-name">
          {dot >= 0 && <span className="body-field-parent">{field.p.slice(0, dot + 1)}</span>}
          {field.p.slice(dot + 1)}
        </span>
        <span className="body-field-type">{field.t}</span>
        {field.r && <span className="badge required">required</span>}
        {state === 'missing' && <span className="badge missing">missing</span>}
        {state === 'set' && (
          <span className="body-field-set" aria-label="set">
            ✓
          </span>
        )}
      </div>
      {(field.d || field.e) && (
        <div className="body-field-desc">
          {field.d}
          {field.e && (
            <span className="body-field-enum">
              {field.d ? ' ' : ''}
              {field.e.map((value) => (
                <code key={value}>{value}</code>
              ))}
            </span>
          )}
        </div>
      )}
    </li>
  );
};

export const BodyHints = ({
  request,
  onInsert,
}: {
  request: ApiRequest;
  onInsert: (body: string) => void;
}) => {
  const endpoint = useMemo(
    () => endpointFor(request.url, request.method),
    [request.url, request.method],
  );
  const key = endpoint && `${endpoint.m} ${endpoint.p}`;
  const [loaded, setLoaded] = useState<Loaded>();
  const [example, setExample] = useState(0);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!endpoint || !key) return;
    let current = true;
    void loadBodySchema(endpoint).then((schema) => current && setLoaded({ key, schema }));
    setExample(0);
    return () => {
      current = false;
    };
  }, [endpoint, key]);

  const parsed = useMemo(() => parse(request.body), [request.body]);
  const schema = loaded?.key === key ? loaded?.schema : undefined;
  const fields = useMemo(() => schema?.f ?? [], [schema]);
  const missing = useMemo(
    () => (parsed ? missingFields(fields, parsed.value) : []),
    [fields, parsed],
  );
  const present = useMemo(
    () => (parsed ? presentFields(fields, parsed.value) : new Set<string>()),
    [fields, parsed],
  );

  if (!endpoint) {
    return (
      <aside className="body-hints">
        <p className="hint">Type a path the API reference knows to see its body's fields here.</p>
      </aside>
    );
  }
  if (loaded?.key !== key) {
    return (
      <aside className="body-hints">
        <p className="hint">Loading the body of {key}…</p>
      </aside>
    );
  }
  if (!schema) {
    return (
      <aside className="body-hints">
        <p className="hint">
          The API reference has no JSON body for <code>{key}</code>.
        </p>
      </aside>
    );
  }

  const examples = schema.x ?? [];
  const missingPaths = new Set(missing.map((f) => f.p));
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? fields.filter((f) => `${f.p} ${f.d ?? ''}`.toLowerCase().includes(needle))
    : fields;
  const replacing = !!request.body.trim();
  const insert = () =>
    onInsert(exampleBody(examples.length ? examples[example]?.v : skeleton(fields)));

  return (
    <aside className="body-hints" aria-label="Request body reference">
      <div className="body-hints-bar">
        {examples.length > 1 && (
          <select
            className="body-example-select"
            aria-label="Example"
            value={example}
            onChange={(e) => setExample(Number(e.target.value))}
          >
            {examples.map((x, i) => (
              <option key={x.n} value={i}>
                {x.n}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className="small"
          title={
            examples.length
              ? `${replacing ? 'Replace the body with' : 'Insert'} “${examples[example]?.n}”`
              : 'The spec has no examples: insert the required fields'
          }
          disabled={!examples.length && !fields.some((f) => f.r)}
          onClick={insert}
        >
          {examples.length
            ? replacing
              ? 'Replace with example'
              : 'Insert example'
            : 'Insert required fields'}
        </button>
      </div>
      <div className="body-hints-status">
        <p
          className={`body-check${missing.length ? ' invalid' : ''}`}
          role="status"
          title={`${endpoint.m} ${endpoint.p}: ${endpoint.s}`}
        >
          {!parsed
            ? 'Fix the JSON to check its required fields.'
            : missing.length
              ? `Missing ${missing.length > 1 ? `${missing.length} required fields` : 'a required field'}: ${missing.map((f) => f.p).join(', ')}`
              : fields.some((f) => f.r)
                ? 'Has every required field.'
                : 'No fields are required.'}
        </p>
        {fields.length > FILTER_AFTER && (
          <input
            className="filter"
            type="search"
            aria-label="Filter fields"
            placeholder={`Filter ${fields.length} fields`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        )}
      </div>
      <ul className="body-fields">
        {shown.map((field) => (
          <FieldRow
            key={field.p}
            field={field}
            state={missingPaths.has(field.p) ? 'missing' : present.has(field.p) ? 'set' : undefined}
          />
        ))}
        {!shown.length && <li className="hint body-field">No matches.</li>}
      </ul>
    </aside>
  );
};
