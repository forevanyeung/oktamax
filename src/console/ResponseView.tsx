import { useState } from 'react';

import { JsonView } from './JsonView';
import { cell, formatBytes, isTable, oktaError, tableColumns } from './format';
import { toConsoleUrl, type ApiResponse } from './request';

type Tab = 'pretty' | 'table' | 'raw' | 'headers';

const statusClass = (status: number) =>
  status >= 500 ? 'bad' : status >= 400 ? 'warn' : status >= 300 ? 'info' : 'good';

const Table = ({ rows }: { rows: Array<Record<string, unknown>> }) => {
  const columns = tableColumns(rows);
  return (
    <table className="grid">
      <thead>
        <tr>
          <th className="num">#</th>
          {columns.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            <td className="num">{i + 1}</td>
            {columns.map((c) => {
              const text = cell(row, c);
              return (
                <td key={c} title={text}>
                  {text}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export const ResponseView = ({
  response,
  onOpen,
}: {
  response: ApiResponse;
  /** Sends a GET for a console URL (a link in the response, or the next page). */
  onOpen: (url: string) => void;
}) => {
  const table = isTable(response.json);
  const hasJson = response.json !== undefined;
  const [tab, setTab] = useState<Tab>(hasJson ? 'pretty' : 'raw');
  // Remounts the tree with every level opened or closed.
  const [expand, setExpand] = useState<{ all?: boolean; n: number }>({ n: 0 });
  const [copied, setCopied] = useState(false);
  const errors = oktaError(response.json);
  const shown = tab === 'table' && !table ? 'pretty' : tab;

  const copy = () => {
    const text = hasJson ? JSON.stringify(response.json, null, 2) : response.text;
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };

  const tabs: Array<[Tab, string, boolean]> = [
    ['pretty', 'Pretty', hasJson],
    ['table', 'Table', table],
    ['raw', 'Raw', true],
    ['headers', `Headers (${response.headers.length})`, true],
  ];

  return (
    <div className="response">
      <div className="response-bar">
        <span className={`status ${statusClass(response.status)}`}>
          {response.status} {response.statusText}
        </span>
        <span className="meta">{response.ms} ms</span>
        <span className="meta">{formatBytes(response.bytes)}</span>
        {Array.isArray(response.json) && (
          <span className="meta">
            {response.json.length} item{response.json.length === 1 ? '' : 's'}
          </span>
        )}
        <div className="tabs" role="tablist">
          {tabs
            .filter(([, , enabled]) => enabled)
            .map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={shown === id}
                className={shown === id ? 'tab active' : 'tab'}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
        </div>
        <div className="spacer" />
        {shown === 'pretty' && (
          <>
            <button
              type="button"
              className="small"
              onClick={() => setExpand({ all: true, n: expand.n + 1 })}
            >
              Expand all
            </button>
            <button
              type="button"
              className="small"
              onClick={() => setExpand({ all: false, n: expand.n + 1 })}
            >
              Collapse
            </button>
          </>
        )}
        <button type="button" className="small" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
        {response.next && (
          <button type="button" className="small primary" onClick={() => onOpen(response.next!)}>
            Next page →
          </button>
        )}
      </div>
      {errors && (
        <div className="error response-error" role="alert">
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      <div className="response-body">
        {shown === 'pretty' && (
          <JsonView
            key={expand.n}
            value={response.json}
            expand={expand.all}
            onOpen={(href) => onOpen(toConsoleUrl(href))}
          />
        )}
        {shown === 'table' && table && (
          <Table rows={response.json as Array<Record<string, unknown>>} />
        )}
        {shown === 'raw' && <pre className="raw-text">{response.text || '(empty body)'}</pre>}
        {shown === 'headers' && (
          <table className="grid headers">
            <tbody>
              {response.headers.map(([name, value]) => (
                <tr key={name}>
                  <th>{name}</th>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
