import { useEffect, useRef, useState } from 'react';

import { csvFilename, downloadCsv, toCsv } from './csv';
import { JsonView } from './JsonView';
import { cell, formatBytes, isTable, oktaError, tableColumns } from './format';
import { send, toConsoleUrl, type ApiResponse } from './request';

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

type Row = Record<string, unknown>;

/** Follows `next` links from `rows`' page, adding up the rows of every page after it. */
async function allPages(
  rows: Row[],
  next: string | undefined,
  signal: { cancelled: boolean },
  onProgress: (rows: number) => void,
): Promise<Row[]> {
  const all = [...rows];
  while (next && !signal.cancelled) {
    const page = await send({ method: 'GET', url: next, body: '' });
    if (page.status >= 400) throw new Error(`${page.status} ${page.statusText} for ${next}`);
    if (!Array.isArray(page.json)) throw new Error(`${next} didn't return a list`);
    all.push(...(page.json as Row[]));
    onProgress(all.length);
    next = page.next;
  }
  return all;
}

/** Downloads or copies a list response as CSV: this page, or every page. */
const ExportMenu = ({ response, url }: { response: ApiResponse; url: string }) => {
  const rows = response.json as Row[];
  const [open, setOpen] = useState(false);
  const [fetched, setFetched] = useState<number>();
  const [status, setStatus] = useState<string>();
  const signal = useRef({ cancelled: false });
  useEffect(() => () => void (signal.current.cancelled = true), []);

  const flash = (text: string) => {
    setStatus(text);
    setTimeout(() => setStatus(undefined), 2000);
  };
  const download = (data: Row[]) => downloadCsv(toCsv(data), csvFilename(url));
  const copy = () =>
    void navigator.clipboard.writeText(toCsv(rows)).then(() => flash('Copied CSV'));
  const exportAll = async () => {
    signal.current = { cancelled: false };
    const current = signal.current;
    setFetched(rows.length);
    try {
      const all = await allPages(rows, response.next, current, setFetched);
      if (!current.cancelled) download(all);
    } catch (error) {
      if (!current.cancelled) flash(`Export failed: ${(error as Error).message}`);
    } finally {
      if (!current.cancelled) setFetched(undefined);
    }
  };
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  const count = (n: number) => `${n} row${n === 1 ? '' : 's'}`;

  if (fetched !== undefined) {
    return (
      <span className="export">
        <span className="meta">Fetching pages… {count(fetched)}</span>
        <button
          type="button"
          className="small"
          onClick={() => {
            signal.current.cancelled = true;
            setFetched(undefined);
          }}
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span
      className="export"
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && open && (e.preventDefault(), setOpen(false))}
    >
      {status && <span className="meta">{status}</span>}
      <button
        type="button"
        className="small"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Export CSV ▾
      </button>
      {open && (
        <div className="menu" role="menu">
          <button type="button" role="menuitem" onClick={pick(() => download(rows))}>
            Download this page <span className="meta">{count(rows.length)}</span>
          </button>
          {response.next && (
            <button type="button" role="menuitem" onClick={pick(() => void exportAll())}>
              Download all pages <span className="meta">follows Next page</span>
            </button>
          )}
          <button type="button" role="menuitem" onClick={pick(copy)}>
            Copy this page as CSV
          </button>
        </div>
      )}
    </span>
  );
};

export const ResponseView = ({
  response,
  url,
  onOpen,
}: {
  response: ApiResponse;
  /** The URL the request was sent to, which names exported files. */
  url: string;
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
        {table && <ExportMenu response={response} url={url} />}
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
