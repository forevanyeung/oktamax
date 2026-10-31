/**
 * A drawer at the bottom of the admin console for sending requests to the Okta
 * API with the admin's session: a prompt line (`GET /api/v1/users?limit=5`),
 * query parameters and a JSON body, the response, and a history of requests.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { loadSettings, onSettingsChanged } from '../settings';
import { timeAgo } from './format';
import {
  METHODS,
  joinUrl,
  send,
  splitMethod,
  splitUrl,
  toConsoleUrl,
  type ApiRequest,
  type ApiResponse,
  type Method,
  type Param,
} from './request';
import { ResponseView } from './ResponseView';
import { addToHistory, loadState, saveState, type ConsoleState, type HistoryEntry } from './store';

type Result =
  | { status: 'idle' }
  | { status: 'sending'; request: ApiRequest }
  | { status: 'done'; request: ApiRequest; response: ApiResponse; id: number }
  | { status: 'error'; request: ApiRequest; message: string };

const MIN_HEIGHT = 160;
const clampHeight = (height: number) =>
  Math.round(Math.max(MIN_HEIGHT, Math.min(height, innerHeight - 60)));

const ParamsEditor = ({ url, onChange }: { url: string; onChange: (url: string) => void }) => {
  const { path, params } = splitUrl(url);
  const rows = [...params, { key: '', value: '' }];
  const update = (index: number, change: Partial<Param>) =>
    onChange(
      joinUrl(
        path,
        rows
          .map((p, i) => (i === index ? { ...p, ...change } : p))
          .filter((p, i) => i < params.length || p.key || p.value),
      ),
    );
  const remove = (index: number) =>
    onChange(
      joinUrl(
        path,
        params.filter((_, i) => i !== index),
      ),
    );

  return (
    <table className="grid params">
      <thead>
        <tr>
          <th>Key</th>
          <th>Value</th>
          <th aria-label="Remove" />
        </tr>
      </thead>
      <tbody>
        {rows.map((param, i) => (
          <tr key={i}>
            <td>
              <input
                className="cell-input"
                value={param.key}
                placeholder={i === params.length ? 'Add a parameter' : ''}
                onChange={(e) => update(i, { key: e.target.value })}
              />
            </td>
            <td>
              <input
                className="cell-input"
                value={param.value}
                placeholder={i === params.length ? 'value' : ''}
                onChange={(e) => update(i, { value: e.target.value })}
              />
            </td>
            <td className="remove">
              {i < params.length && (
                <button type="button" className="icon" title="Remove" onClick={() => remove(i)}>
                  ×
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

const jsonError = (body: string) => {
  if (!body.trim()) return undefined;
  try {
    JSON.parse(body);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

const BodyEditor = ({
  request,
  onChange,
  onSend,
}: {
  request: ApiRequest;
  onChange: (body: string) => void;
  onSend: () => void;
}) => {
  const error = jsonError(request.body);
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      onSend();
    } else if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      const el = event.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;
      onChange(`${el.value.slice(0, start)}  ${el.value.slice(end)}`);
      requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
    }
  };

  return (
    <div className="body-editor">
      {request.method === 'GET' && (
        <p className="hint">
          GET requests are sent without a body. Pick another method to send one.
        </p>
      )}
      <textarea
        className="code-input"
        spellCheck={false}
        value={request.body}
        placeholder={'{\n  "profile": { "name": "…" }\n}'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="body-bar">
        <span className={error ? 'body-status invalid' : 'body-status'}>
          {request.body.trim() ? (error ? `Invalid JSON: ${error}` : 'Valid JSON') : 'JSON'}
        </span>
        <span className="hint">⌘/Ctrl + Enter to send</span>
        <button
          type="button"
          className="small"
          disabled={!!error || !request.body.trim()}
          onClick={() => onChange(JSON.stringify(JSON.parse(request.body), null, 2))}
        >
          Format
        </button>
      </div>
    </div>
  );
};

const HistoryList = ({
  history,
  onLoad,
  onRun,
  onClear,
}: {
  history: HistoryEntry[];
  onLoad: (entry: HistoryEntry) => void;
  onRun: (entry: HistoryEntry) => void;
  onClear: () => void;
}) => {
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? history.filter((e) => `${e.method} ${e.url}`.toLowerCase().includes(needle))
    : history;
  const now = Date.now();

  return (
    <aside className="history">
      <div className="history-head">
        <input
          className="filter"
          type="search"
          placeholder="Filter history"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button type="button" className="small" disabled={!history.length} onClick={onClear}>
          Clear
        </button>
      </div>
      <ol className="history-list">
        {shown.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="history-item"
              title={`${entry.method} ${entry.url}\nClick to load, ▶ to send again`}
              onClick={() => onLoad(entry)}
            >
              <span className={`method m-${entry.method}`}>{entry.method}</span>
              <span className="history-url">{entry.url}</span>
              <span className="history-meta">
                <span className={`code ${entry.status >= 400 || !entry.status ? 'fail' : ''}`}>
                  {entry.status || 'ERR'}
                </span>
                {timeAgo(entry.at, now)}
              </span>
            </button>
            <button
              type="button"
              className="icon run"
              title="Send again"
              onClick={() => onRun(entry)}
            >
              ▶
            </button>
          </li>
        ))}
        {!shown.length && (
          <li className="hint history-empty">
            {history.length ? 'No matches.' : 'Requests you send show up here.'}
          </li>
        )}
      </ol>
    </aside>
  );
};

export const ApiConsole = () => {
  const [state, setState] = useState<ConsoleState>();
  const [result, setResult] = useState<Result>({ status: 'idle' });
  const [panel, setPanel] = useState<'params' | 'body'>();
  const [showHistory, setShowHistory] = useState(true);
  const prompt = useRef<HTMLInputElement>(null);
  // Arrow up/down at the prompt walks the history, like a shell.
  const cursor = useRef<{ index: number; draft: ApiRequest }>(undefined);
  const responses = useRef(0);

  const [enabled, setEnabled] = useState(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    void loadState().then(setState);
    void loadSettings().then((s) => setEnabled(s.showApiConsole));
    onSettingsChanged((s) => setEnabled(s.showApiConsole));
  }, []);

  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => void saveState(state), 300);
    return () => clearTimeout(timer);
  }, [state]);

  const update = useCallback(
    (change: Partial<ConsoleState>) => setState((s) => s && { ...s, ...change }),
    [],
  );
  const setDraft = (change: Partial<ApiRequest>) => {
    cursor.current = undefined;
    setState((s) => s && { ...s, draft: { ...s.draft, ...change } });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '`' && event.ctrlKey && enabledRef.current) {
        event.preventDefault();
        setState((s) => s && { ...s, open: !s.open });
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (state?.open) prompt.current?.focus();
  }, [state?.open]);

  const run = async (request: ApiRequest) => {
    if (!request.url.trim()) return;
    setResult({ status: 'sending', request });
    const entry = (status: number, ms: number): HistoryEntry => ({
      ...request,
      id: crypto.randomUUID(),
      status,
      ms,
      at: Date.now(),
    });
    try {
      const response = await send(request);
      setResult({ status: 'done', request, response, id: ++responses.current });
      setState(
        (s) => s && { ...s, history: addToHistory(s.history, entry(response.status, response.ms)) },
      );
    } catch (error) {
      setResult({ status: 'error', request, message: String(error) });
      setState((s) => s && { ...s, history: addToHistory(s.history, entry(0, 0)) });
    }
  };

  if (!state || !enabled) return null;
  const { draft } = state;

  /** Loads a request into the prompt (and sends it, for `sendNow`). */
  const load = (request: ApiRequest, sendNow = false) => {
    setDraft({ method: request.method, url: request.url, body: request.body });
    if (request.body && request.method !== 'GET') setPanel('body');
    prompt.current?.focus();
    if (sendNow) void run(request);
  };
  const openUrl = (url: string) => load({ method: 'GET', url, body: '' }, true);

  const onPromptChange = (value: string) => {
    let { method, url } = splitMethod(value);
    if (/^https?:\/\//i.test(url.trim())) {
      try {
        url = toConsoleUrl(url.trim());
      } catch {
        // Not a URL yet; leave it as typed.
      }
    }
    setDraft(method ? { method, url } : { url });
  };

  const onPromptKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void run(draft);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const { history } = state;
      const current = cursor.current ?? { index: -1, draft };
      const index = Math.max(
        -1,
        Math.min(history.length - 1, current.index + (event.key === 'ArrowUp' ? 1 : -1)),
      );
      const request = index < 0 ? current.draft : history[index];
      if (index === current.index || !request) return;
      event.preventDefault();
      setState(
        (s) =>
          s && {
            ...s,
            draft: { method: request.method, url: request.url, body: request.body },
          },
      );
      cursor.current = index < 0 ? undefined : { index, draft: current.draft };
    } else if (event.key === 'Escape') {
      update({ open: false });
    }
  };

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = state.height;
    const onMove = (e: PointerEvent) =>
      update({ height: clampHeight(startHeight + startY - e.clientY) });
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
  };

  if (!state.open) {
    return (
      <button
        type="button"
        className="drawer-tab"
        title="Open the API console (Ctrl + `)"
        onClick={() => update({ open: true })}
      >
        <span className="chevron" aria-hidden />
        API
      </button>
    );
  }

  const paramCount = splitUrl(draft.url).params.length;
  const sending = result.status === 'sending';

  return (
    <section
      className="drawer"
      aria-label="API console"
      style={{ height: clampHeight(state.height) }}
      // Keeps the console's keyboard shortcuts from seeing what's typed here.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === '`' && e.ctrlKey) update({ open: false });
      }}
    >
      <div
        className="grip"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize"
        onPointerDown={startResize}
      />
      <header className="drawer-head">
        <button
          type="button"
          className={showHistory ? 'small toggled' : 'small'}
          aria-pressed={showHistory}
          onClick={() => setShowHistory(!showHistory)}
        >
          History
        </button>
        <h2>API console</h2>
        <span className="hint origin">{location.host}</span>
        <div className="spacer" />
        <span className="hint">Ctrl + ` to toggle</span>
        <button
          type="button"
          className="icon close"
          title="Close"
          onClick={() => update({ open: false })}
        >
          ×
        </button>
      </header>
      <div className="drawer-main">
        {showHistory && (
          <HistoryList
            history={state.history}
            onLoad={(entry) => load(entry)}
            onRun={(entry) => load(entry, true)}
            onClear={() => update({ history: [] })}
          />
        )}
        <div className="work">
          <form
            className="prompt"
            onSubmit={(e) => {
              e.preventDefault();
              void run(draft);
            }}
          >
            <select
              className={`method-select m-${draft.method}`}
              aria-label="Method"
              value={draft.method}
              onChange={(e) => setDraft({ method: e.target.value as Method })}
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              ref={prompt}
              className="prompt-input"
              aria-label="Request URL"
              spellCheck={false}
              autoComplete="off"
              placeholder="/api/v1/users?limit=10   (type a method first to switch, ↑ for history)"
              value={draft.url}
              onChange={(e) => onPromptChange(e.target.value)}
              onKeyDown={onPromptKeyDown}
            />
            <button type="submit" className="send" disabled={sending || !draft.url.trim()}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
          <div className="request-tabs" role="tablist">
            {(
              [
                ['params', `Params${paramCount ? ` (${paramCount})` : ''}`],
                ['body', `Body${draft.body.trim() ? ' •' : ''}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={panel === id}
                className={panel === id ? 'tab active' : 'tab'}
                onClick={() => setPanel(panel === id ? undefined : id)}
              >
                {label}
              </button>
            ))}
          </div>
          {panel && (
            <div className="request-panel">
              {panel === 'params' ? (
                <ParamsEditor url={draft.url} onChange={(url) => setDraft({ url })} />
              ) : (
                <BodyEditor
                  request={draft}
                  onChange={(body) => setDraft({ body })}
                  onSend={() => void run(draft)}
                />
              )}
            </div>
          )}
          {result.status === 'idle' && (
            <p className="hint placeholder">
              Send a request to see its response. Paths without a leading slash are under /api/v1/,
              e.g. <code>groups?q=Everyone</code>.
            </p>
          )}
          {result.status === 'sending' && (
            <p className="hint placeholder">
              Sending {result.request.method} {result.request.url}…
            </p>
          )}
          {result.status === 'error' && (
            <div className="error response-error" role="alert">
              Couldn't send {result.request.method} {result.request.url}: {result.message}
            </div>
          )}
          {result.status === 'done' && (
            <ResponseView key={result.id} response={result.response} onOpen={openUrl} />
          )}
        </div>
      </div>
    </section>
  );
};
