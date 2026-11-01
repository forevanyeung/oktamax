/**
 * A drawer at the bottom of the admin console for sending requests to the Okta
 * API with the admin's session: a prompt line (`GET /api/v1/users?limit=5`),
 * query parameters and a JSON body, the response, and a history of requests.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { loadSettings, onSettingsChanged } from '../settings';
import { fillTemplate, LABELS, pageContext, placeholders, type PageContext } from './context';
import { timeAgo } from './format';
import { Prompt, type PromptHandle } from './Prompt';
import { joinUrl, send, splitUrl, type ApiRequest, type ApiResponse, type Param } from './request';
import { ResponseView } from './ResponseView';
import { objectPath } from './suggest';
import { addToHistory, loadState, saveState, type ConsoleState, type HistoryEntry } from './store';

type Result =
  | { status: 'idle' }
  | { status: 'sending'; request: ApiRequest }
  | { status: 'done'; request: ApiRequest; response: ApiResponse; id: number }
  | { status: 'error'; request: ApiRequest; message: string };

/** The page's objects, kept up to date as the admin console navigates. */
function usePageContext(active: boolean): PageContext {
  const [href, setHref] = useState(location.href);
  useEffect(() => {
    if (!active) return;
    setHref(location.href);
    const timer = setInterval(() => setHref(location.href), 500);
    return () => clearInterval(timer);
  }, [active]);
  return useMemo(() => pageContext(new URL(href)), [href]);
}

const CloseIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    <path d="M3 3l10 10M13 3L3 13" />
  </svg>
);

const ExpandIcon = ({ maximized }: { maximized: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    width="14"
    height="14"
    aria-hidden
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
  >
    {maximized ? (
      <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
    ) : (
      <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
    )}
  </svg>
);

const MIN_HEIGHT = 160;
/** Leaves the top of the page in view, also when expanded. */
const clampHeight = (height: number) =>
  Math.round(Math.max(MIN_HEIGHT, Math.min(height, innerHeight - 60)));
const maxHeight = () => clampHeight(Infinity);

// Expanding and restoring slide the drawer's top edge, like a sheet. Only its
// transform is animated, so a large response isn't laid out again every frame.
const SLIDE = { duration: 320, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };
const DOUBLE_PRESS_MS = 300;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  const prompt = useRef<PromptHandle>(null);
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
  const setDraft = (change: Partial<ApiRequest>) =>
    setState((s) => s && { ...s, draft: { ...s.draft, ...change } });
  const context = usePageContext(!!state?.open && enabled);

  const drawer = useRef<HTMLElement>(null);
  // Growing: the height it grew from, to slide up from once it has grown.
  const grownFrom = useRef<number>(undefined);
  // Shrinking: the slide down, held at its end until the drawer has shrunk.
  const shrinking = useRef<Animation>(undefined);

  useLayoutEffect(() => {
    shrinking.current?.cancel();
    shrinking.current = undefined;
    const el = drawer.current;
    const from = grownFrom.current;
    grownFrom.current = undefined;
    if (!el || from === undefined) return;
    el.animate(
      [{ transform: `translateY(${el.offsetHeight - from}px)` }, { transform: 'none' }],
      SLIDE,
    );
  }, [state?.maximized]);

  const setMaximized = (maximized: boolean) => {
    const el = drawer.current;
    if (!state || shrinking.current) return;
    if (!el) return update({ maximized });
    const from = el.offsetHeight;
    const to = maximized ? maxHeight() : clampHeight(state.height);
    if (to > from && !reducedMotion()) grownFrom.current = from;
    if (to >= from || reducedMotion()) return update({ maximized });
    const slide = el.animate([{ transform: 'none' }, { transform: `translateY(${from - to}px)` }], {
      ...SLIDE,
      fill: 'forwards',
    });
    shrinking.current = slide;
    void slide.finished.then(
      () => update({ maximized }),
      () => {},
    );
  };

  // Ctrl + ` opens and closes the drawer; pressed twice quickly, it expands or
  // restores it. Closing waits to see whether a second press follows.
  const lastPress = useRef(0);
  const closing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onShortcut = (event: KeyboardEvent | React.KeyboardEvent) => {
    if (event.key !== '`' || !event.ctrlKey || event.repeat || !state) return;
    event.preventDefault();
    const now = performance.now();
    const twice = now - lastPress.current < DOUBLE_PRESS_MS;
    lastPress.current = twice ? 0 : now;
    if (twice) {
      clearTimeout(closing.current);
      closing.current = undefined;
      update({ open: true });
      setMaximized(!state.maximized);
    } else if (!state.open) {
      update({ open: true });
    } else {
      closing.current = setTimeout(() => {
        closing.current = undefined;
        update({ open: false });
      }, DOUBLE_PRESS_MS);
    }
  };
  const shortcut = useRef(onShortcut);
  shortcut.current = onShortcut;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => enabledRef.current && shortcut.current(event);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
      clearTimeout(closing.current);
    };
  }, []);

  useEffect(() => {
    if (state?.open) prompt.current?.focus();
  }, [state?.open]);

  const run = async (template: ApiRequest) => {
    if (!template.url.trim()) return;
    // `{userId}` and the like are filled from the page.
    const request = { ...template, url: fillTemplate(template.url, context) };
    const missing = placeholders(request.url);
    if (missing.length) {
      const names = missing.map((name) => `{${name}}`).join(', ');
      setResult({
        status: 'error',
        request,
        message: `this page has no ${names}. Replace ${missing.length > 1 ? 'them' : 'it'} with an ID.`,
      });
      return;
    }
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

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = drawer.current?.offsetHeight ?? state.height;
    // Dragging an expanded drawer picks it up at its expanded height.
    const onMove = (e: PointerEvent) =>
      update({ height: clampHeight(startHeight + startY - e.clientY), maximized: false });
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
      ref={drawer}
      className="drawer"
      aria-label="API console"
      style={{ height: state.maximized ? maxHeight() : clampHeight(state.height) }}
      // Keeps the console's keyboard shortcuts from seeing what's typed here.
      onKeyDown={(e) => {
        e.stopPropagation();
        onShortcut(e);
      }}
    >
      <div
        className="grip"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize, double-click to expand"
        onPointerDown={startResize}
        onDoubleClick={() => setMaximized(!state.maximized)}
      />
      <div className="drawer-main">
        <HistoryList
          history={state.history}
          onLoad={(entry) => load(entry)}
          onRun={(entry) => load(entry, true)}
          onClear={() => update({ history: [] })}
        />
        <div className="work">
          <div className="prompt-row">
            <Prompt
              ref={prompt}
              draft={draft}
              history={state.history}
              context={context}
              sending={sending}
              onChange={setDraft}
              onSend={() => void run(draft)}
              onEscape={() => update({ open: false })}
            />
            <div className="drawer-controls">
              <button
                type="button"
                className="icon"
                title={`${state.maximized ? 'Restore' : 'Expand'} console (Ctrl + \` twice)`}
                aria-label={state.maximized ? 'Restore console' : 'Expand console'}
                aria-pressed={state.maximized}
                onClick={() => setMaximized(!state.maximized)}
              >
                <ExpandIcon maximized={state.maximized} />
              </button>
              <button
                type="button"
                className="icon close"
                title="Close (Ctrl + `)"
                aria-label="Close console"
                onClick={() => update({ open: false })}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
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
            <div className="spacer" />
            {Object.entries(context).map(([name, value]) => {
              const path = objectPath(name, context);
              return (
                <button
                  key={name}
                  type="button"
                  className="page-object"
                  title={`{${name}} = ${value}${path ? `\nClick to browse ${path}` : ''}`}
                  disabled={!path}
                  onClick={() => path && prompt.current?.browse(`${path}/`)}
                >
                  <span className="page-object-label">{LABELS[name] ?? name}</span>
                  {value}
                </button>
              );
            })}
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
              e.g. <code>groups?q=Everyone</code>. Suggestions come from Okta's API reference, and{' '}
              <code>{'{userId}'}</code>, <code>{'{groupId}'}</code>, <code>{'{appId}'}</code>… are
              filled in from the page you're on.
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
            <ResponseView
              key={result.id}
              response={result.response}
              url={result.request.url}
              onOpen={openUrl}
            />
          )}
        </div>
      </div>
    </section>
  );
};
