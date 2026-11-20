/**
 * The Body tab: a JSON editor that knows the body of the endpoint being typed
 * (from Okta's API reference), completing its keys and values, describing them
 * on hover and underlining problems; with the spec's examples to start from.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { exampleBody, lintBody, loadBodySchema, skeleton, type BodySchema } from './body';
import type { JsonEditor } from './jsonEditor';
import type { ApiRequest } from './request';
import { endpointFor } from './suggest';

const PLACEHOLDER = '{ "profile": { … } }   Ctrl + Space for fields';

const jsonError = (body: string) => {
  if (!body.trim()) return undefined;
  try {
    JSON.parse(body);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

/** The schema of the body for the request's endpoint, once loaded. */
function useBodySchema(request: ApiRequest) {
  const endpoint = useMemo(
    () => (request.method === 'GET' ? undefined : endpointFor(request.url, request.method)),
    [request.url, request.method],
  );
  const key = endpoint && `${endpoint.m} ${endpoint.p}`;
  const [loaded, setLoaded] = useState<{ key: string; schema?: BodySchema }>();
  useEffect(() => {
    if (!endpoint || !key) return;
    let current = true;
    void loadBodySchema(endpoint).then((schema) => current && setLoaded({ key, schema }));
    return () => {
      current = false;
    };
  }, [endpoint, key]);
  return { endpoint, schema: key && loaded?.key === key ? loaded.schema : undefined };
}

/** The CodeMirror editor, loaded with the tab; a plain textarea until it is. */
const CodeEditor = ({
  value,
  schema,
  onChange,
  onSend,
}: {
  value: string;
  schema?: BodySchema;
  onChange: (value: string) => void;
  onSend: () => void;
}) => {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<JsonEditor>(undefined);
  const [ready, setReady] = useState(false);
  // The editor reads these when it needs them, so they're always the latest.
  const latest = useRef({ value, schema, onChange, onSend });
  latest.current = { value, schema, onChange, onSend };

  useEffect(() => {
    let destroyed = false;
    void import('./jsonEditor').then(({ createJsonEditor }) => {
      if (destroyed || !host.current) return;
      editor.current = createJsonEditor({
        parent: host.current,
        doc: latest.current.value,
        placeholder: PLACEHOLDER,
        onChange: (doc) => latest.current.onChange(doc),
        onSend: () => latest.current.onSend(),
        schema: () => latest.current.schema,
      });
      setReady(true);
    });
    return () => {
      destroyed = true;
      editor.current?.destroy();
      editor.current = undefined;
    };
  }, []);

  useEffect(() => editor.current?.setDoc(value), [value]);
  useEffect(() => editor.current?.relint(), [schema]);

  return (
    <div className="code-input">
      <div className="code-host" ref={host} />
      {!ready && (
        <textarea
          className="code-fallback"
          spellCheck={false}
          aria-label="Request body"
          value={value}
          placeholder={PLACEHOLDER}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
};

export const BodyEditor = ({
  request,
  onChange,
  onSend,
}: {
  request: ApiRequest;
  onChange: (body: string) => void;
  onSend: () => void;
}) => {
  const { endpoint, schema } = useBodySchema(request);
  const [example, setExample] = useState(0);
  useEffect(() => setExample(0), [schema]);

  const body = request.body;
  const error = jsonError(body);
  const problems = useMemo(
    () => (schema && body.trim() && !error ? lintBody(body, schema) : []),
    [schema, body, error],
  );
  const examples = schema?.x ?? [];
  const canStart = examples.length > 0 || !!schema?.f.some((f) => f.r);
  const insert = () =>
    onChange(exampleBody(examples.length ? examples[example]?.v : skeleton(schema?.f ?? [])));

  let status = 'JSON';
  let tone = '';
  if (error) {
    status = `Invalid JSON: ${error}`;
    tone = 'invalid';
  } else if (problems.length) {
    const errors = problems.filter((p) => p.severity === 'error').length;
    status = `${problems[0]!.message}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}`;
    tone = errors ? 'invalid' : 'warn';
  } else if (body.trim()) {
    status = schema ? 'Matches the API reference' : 'Valid JSON';
  }

  return (
    <div className="body-editor">
      {request.method === 'GET' && (
        <p className="hint">
          GET requests are sent without a body. Pick another method to send one.
        </p>
      )}
      <CodeEditor value={body} schema={schema} onChange={onChange} onSend={onSend} />
      <div className="body-bar">
        <span className={`body-status ${tone}`} role="status" title={status}>
          {status}
        </span>
        <span className="hint" hidden={!!tone}>
          {schema ? 'Ctrl + Space: fields · ' : ''}⌘/Ctrl + Enter: send
        </span>
        <span className="body-actions">
          {examples.length > 1 && (
            <select
              className="body-example-select"
              aria-label="Example"
              title={endpoint && `Examples of ${endpoint.m} ${endpoint.p}`}
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
          {canStart && (
            <button
              type="button"
              className="small"
              title={
                examples.length
                  ? `${body.trim() ? 'Replace the body with' : 'Insert'} “${examples[example]?.n}”`
                  : 'The API reference has no example: insert the required fields'
              }
              onClick={insert}
            >
              {examples.length
                ? body.trim()
                  ? 'Replace with example'
                  : 'Insert example'
                : 'Insert required fields'}
            </button>
          )}
          <button
            type="button"
            className="small"
            disabled={!!error || !body.trim()}
            onClick={() => onChange(JSON.stringify(JSON.parse(body), null, 2))}
          >
            Format
          </button>
        </span>
      </div>
    </div>
  );
};
