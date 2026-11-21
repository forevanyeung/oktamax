/**
 * A drawer at the bottom of the admin console for sending requests to the Okta
 * API with the admin's session: a prompt line (`GET /api/v1/users?limit=5`),
 * query parameters and a JSON body, the response, and a history of requests.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { loadSettings, onSettingsChanged } from '../settings';
import { fillTemplate, LABELS, pageContext, placeholders, type PageContext } from './context';
import { BodyEditor } from './BodyEditor';
import { timeAgo } from './format';
import { setDrawerInset } from './inset';
import { setConsoleHandler } from './remote';
import { Prompt, type PromptHandle } from './Prompt';
import { pastResponse } from './network';
import {
  joinUrl,
  send,
  splitUrl,
  toResponse,
  type ApiRequest,
  type ApiResponse,
  type Param,
} from './request';
import { ResponseView } from './ResponseView';
import { docsUrl, endpointFor, objectPath, type Endpoint, type QueryParam } from './suggest';
import { addToHistory, loadState, saveState, type ConsoleState, type HistoryEntry } from './store';

type Result =
  | { status: 'idle' }
  | { status: 'sending'; request: ApiRequest; stepUp?: boolean }
  | { status: 'done'; request: ApiRequest; response: ApiResponse; id: number }
  | { status: 'error'; request: ApiRequest; message: string }
  /** A history entry's response, being looked up in DevTools' Network log. */
  | { status: 'looking'; request: ApiRequest; entryId: string }
  /** A history entry whose response isn't in the Network log. */
  | { status: 'gone'; request: ApiRequest; entry: HistoryEntry; devtools: boolean };

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
/** How far the tab has to move before a press counts as a drag, not a click. */
const DRAG_THRESHOLD = 4;
/** How long the pointer rests on a parameter before its description shows: half of Chrome's own tooltip delay on macOS. */
const HINT_DELAY_MS = 500;
/**
 * The hint touches its row (overlapping the row's border, so no gap is left
 * even at fractional pixels); this is only slack for the pointer's path.
 */
const HINT_GRACE_MS = 150;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The endpoint the prompt's request goes to, beside the Params and Body tabs:
 * the scope it needs and its docs. The tooltip says what it does.
 */
const EndpointInfo = ({ endpoint }: { endpoint: Endpoint }) => {
  const docs = docsUrl(endpoint);
  const [scope, ...more] = endpoint.sc ?? [];
  const title = [
    `${endpoint.m} ${endpoint.p}`,
    endpoint.s,
    endpoint.sc?.length && `Scopes: ${endpoint.sc.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <div className="endpoint-info" title={title}>
      {scope && (
        <span className="endpoint-scope">
          {scope}
          {more.length > 0 && ` +${more.length}`}
        </span>
      )}
      {docs && (
        <a className="endpoint-docs" href={docs} target="_blank" rel="noreferrer">
          Docs ↗
        </a>
      )}
    </div>
  );
};

/**
 * A parameter's name in the Params table, with the endpoint's parameters
 * suggested under it as it's typed. The console draws the list rather than a
 * `<datalist>`, whose popup Chrome places on its own and can't be lined up.
 */
const KeyCell = ({
  id,
  value,
  placeholder,
  options,
  onChange,
}: {
  id: string;
  value: string;
  placeholder: string;
  options: QueryParam[];
  onChange: (key: string) => void;
}) => {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = value.toLowerCase();
  const shown = open
    ? options.filter((p) => p.n !== value && p.n.toLowerCase().startsWith(typed))
    : [];

  const accept = (param: QueryParam) => {
    onChange(param.n);
    setOpen(false);
    setActive(-1);
    // On to the value.
    const row = input.current?.closest('tr');
    requestAnimationFrame(() => row?.querySelectorAll('input')[1]?.focus());
  };
  const moveTo = (index: number) => {
    setActive(index);
    list.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const { key } = event;
    if (key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else if (active < shown.length - 1) moveTo(active + 1);
    } else if (key === 'ArrowUp' && shown.length) {
      event.preventDefault();
      if (active > 0) moveTo(active - 1);
    } else if ((key === 'Enter' || key === 'Tab') && !event.shiftKey && shown[active]) {
      event.preventDefault();
      accept(shown[active]);
    } else if (key === 'Escape' && shown.length) {
      setOpen(false);
      setActive(-1);
    }
  };

  // Fixed, so the panel's scrolling doesn't clip it: under the cell, or over it
  // when the window is short of room below.
  const rect = shown.length ? input.current?.closest('td')?.getBoundingClientRect() : undefined;
  const style: React.CSSProperties | undefined = rect && {
    left: rect.left,
    minWidth: rect.width,
    ...(innerHeight - rect.bottom >= 160
      ? { top: rect.bottom - 1, maxHeight: innerHeight - rect.bottom - 8 }
      : { bottom: innerHeight - rect.top - 1, maxHeight: rect.top - 8 }),
  };

  return (
    <>
      <input
        ref={input}
        className="cell-input"
        role="combobox"
        aria-expanded={shown.length > 0}
        aria-controls={id}
        aria-autocomplete="list"
        spellCheck={false}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {style && (
        <ul className="key-suggestions" id={id} role="listbox" ref={list} style={style}>
          {shown.map((p, i) => (
            <li
              key={p.n}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'key-suggestion active' : 'key-suggestion'}
              // Keeps the focus in the cell.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => accept(p)}
            >
              <span className="key-name">{p.n}</span>
              <span className="key-type">{p.ty}</span>
              <span className="key-detail">{p.d}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
};

const ParamsEditor = ({
  url,
  endpoint,
  onChange,
}: {
  url: string;
  endpoint?: Endpoint;
  onChange: (url: string) => void;
}) => {
  const { path, params } = splitUrl(url);
  const known = endpoint?.q ?? [];
  const hintFor = (key: string) => known.find((p) => p.n === key);
  const unused = known.filter((p) => !params.some((used) => used.key === p.n));

  // A parameter's description, shown under its row once the pointer rests on it,
  // and kept while the pointer is on the row or the hint itself.
  const [hover, setHover] = useState<{ index: number; rect: DOMRect }>();
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);
  const hideHint = () => {
    clearTimeout(hoverTimer.current);
    setHover(undefined);
  };
  const keepHint = () => clearTimeout(hoverTimer.current);
  const leaveHint = () => {
    clearTimeout(hoverTimer.current);
    // Shown: hides unless the pointer gets to the hint (or back to the row) in time.
    // Pending: never shows.
    if (hover) hoverTimer.current = setTimeout(() => setHover(undefined), HINT_GRACE_MS);
  };
  const hovered = hover && hintFor(params[hover.index]?.key ?? '');
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
    <>
      <table className="grid params">
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map((param, i) => {
            const hint = hintFor(param.key);
            const example = hint?.x?.[0];
            return (
              <tr
                key={i}
                onMouseEnter={(e) => {
                  if (hover?.index === i) return keepHint();
                  hideHint();
                  if (!hint?.d) return;
                  const row = e.currentTarget;
                  hoverTimer.current = setTimeout(
                    () => setHover({ index: i, rect: row.getBoundingClientRect() }),
                    HINT_DELAY_MS,
                  );
                }}
                onMouseLeave={leaveHint}
                onMouseDown={hideHint}
                onKeyDown={hideHint}
              >
                <td>
                  <KeyCell
                    id={`oktamax-param-keys-${i}`}
                    value={param.key}
                    placeholder={i === params.length ? 'Add a parameter' : ''}
                    options={unused}
                    onChange={(key) => update(i, { key })}
                  />
                </td>
                <td>
                  <input
                    className="cell-input"
                    value={param.value}
                    placeholder={
                      example
                        ? `e.g. ${example}`
                        : (hint?.ty ?? (i === params.length ? 'value' : ''))
                    }
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
            );
          })}
        </tbody>
      </table>
      {hover && hovered?.d && (
        <div
          className="param-hint"
          role="tooltip"
          onMouseEnter={keepHint}
          onMouseLeave={leaveHint}
          style={
            innerHeight - hover.rect.bottom >= 80
              ? { left: hover.rect.left, top: hover.rect.bottom - 1 }
              : { left: hover.rect.left, bottom: innerHeight - hover.rect.top - 1 }
          }
        >
          <code>{hovered.n}</code>
          {hovered.ty && <span className="param-hint-type">{hovered.ty}</span>}
          <span>{hovered.d}</span>
        </div>
      )}
    </>
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
        <button
          type="button"
          className="clear-history"
          disabled={!history.length}
          onClick={onClear}
        >
          Clear
        </button>
      </div>
      <ol className="history-list">
        {shown.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              className="history-item"
              title={`${entry.method} ${entry.url}\nClick to load it and its response, ▶ to send again`}
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
  const tabDragged = useRef(false);
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

  // Requests the chat opens here; set below once `load` exists, unset while turned off.
  const remote = useRef<(request: ApiRequest) => Promise<ApiResponse | Error>>(undefined);
  useEffect(() => setConsoleHandler((request) => remote.current?.(request)), []);

  const shown = !!state?.open && enabled;
  useEffect(() => {
    const el = drawer.current;
    if (!shown || !el) return;
    const observer = new ResizeObserver(() => setDrawerInset(el.offsetHeight));
    observer.observe(el);
    return () => {
      observer.disconnect();
      setDrawerInset(0);
    };
  }, [shown]);

  /** Sends the request and shows the response; returns it, or why it failed. */
  const run = async (template: ApiRequest): Promise<ApiResponse | Error> => {
    if (!template.url.trim()) return new Error('No URL');
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
      return new Error(`The path has placeholders this page can't fill: ${names}`);
    }
    setResult({ status: 'sending', request });
    // Tags the request, so its response can be found in DevTools' Network log later.
    const id = crypto.randomUUID();
    const entry = (status: number, ms: number): HistoryEntry => ({
      ...request,
      id,
      status,
      ms,
      at: Date.now(),
    });
    try {
      const response = await send(request, {
        id,
        onStepUp: () => setResult({ status: 'sending', request, stepUp: true }),
      });
      setResult({ status: 'done', request, response, id: ++responses.current });
      setState(
        (s) => s && { ...s, history: addToHistory(s.history, entry(response.status, response.ms)) },
      );
      return response;
    } catch (error) {
      setResult({ status: 'error', request, message: String(error) });
      setState((s) => s && { ...s, history: addToHistory(s.history, entry(0, 0)) });
      return error instanceof Error ? error : new Error(String(error));
    }
  };

  remote.current = undefined;
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

  /** Loads a history entry into the prompt and shows its response, from DevTools' Network log. */
  const loadPast = async (entry: HistoryEntry) => {
    load(entry);
    const request = { method: entry.method, url: entry.url, body: entry.body };
    setResult({ status: 'looking', request, entryId: entry.id });
    const past = await pastResponse(entry.id);
    const next: Result =
      past.state === 'found'
        ? { status: 'done', request, response: toResponse(past.entry), id: ++responses.current }
        : { status: 'gone', request, entry, devtools: past.state === 'missing' };
    // Unless something else was sent or picked meanwhile.
    setResult((current) =>
      current.status === 'looking' && current.entryId === entry.id ? next : current,
    );
  };
  remote.current = (request) => {
    update({ open: true });
    load(request);
    return run(request);
  };

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

  // The tab slides along the bottom, out of the way of whatever the page has
  // there. `tabX` keeps it where it was dropped, relative to the window's width.
  const startTabDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    tabDragged.current = false;
    const tab = event.currentTarget;
    const startX = event.clientX;
    const startLeft = tab.getBoundingClientRect().left;
    // The width `left: %` is measured against, without the scrollbar.
    const travel = document.documentElement.clientWidth - tab.offsetWidth;
    let dragging = false;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      if (!dragging) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        dragging = true;
        tab.setPointerCapture(e.pointerId);
        tab.classList.add('dragging');
      }
      if (travel > 0) update({ tabX: Math.max(0, Math.min(1, (startLeft + dx) / travel)) });
    };
    const onUp = () => {
      tab.removeEventListener('pointermove', onMove);
      tab.removeEventListener('pointerup', onUp);
      tab.removeEventListener('pointercancel', onUp);
      tab.classList.remove('dragging');
      tabDragged.current = dragging;
    };
    tab.addEventListener('pointermove', onMove);
    tab.addEventListener('pointerup', onUp);
    tab.addEventListener('pointercancel', onUp);
  };

  if (!state.open) {
    return (
      <button
        type="button"
        className="drawer-tab"
        title="Open the API console (Ctrl + `), or drag to move"
        style={{ '--x': state.tabX } as React.CSSProperties}
        onPointerDown={startTabDrag}
        onClick={() => {
          // A drag ends in a click too; only a press that stayed put opens it.
          if (tabDragged.current) tabDragged.current = false;
          else update({ open: true });
        }}
      >
        <span className="chevron" aria-hidden />
        API
      </button>
    );
  }

  const paramCount = splitUrl(draft.url).params.length;
  const endpoint = draft.url.trim() ? endpointFor(draft.url, draft.method) : undefined;
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
          onLoad={(entry) => void loadPast(entry)}
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
          <div className="request-tabs">
            <div className="tabs" role="tablist">
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
            {endpoint && <EndpointInfo endpoint={endpoint} />}
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
                <ParamsEditor
                  url={draft.url}
                  endpoint={endpoint}
                  onChange={(url) => setDraft({ url })}
                />
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
              {result.stepUp
                ? `This is a protected action. Verify it's you in the pop-up to send ${result.request.method} ${result.request.url}…`
                : `Sending ${result.request.method} ${result.request.url}…`}
            </p>
          )}
          {result.status === 'looking' && (
            <p className="hint placeholder">Looking for this response in DevTools' Network log…</p>
          )}
          {result.status === 'gone' && (
            <p className="hint placeholder">
              {result.devtools
                ? "This response isn't in DevTools' Network log any more: it was sent before DevTools opened, or the log was cleared (turn on Preserve log to keep it across page loads)."
                : "Responses are read back from DevTools' Network log. Open DevTools (F12) on this tab, then send the request again to see its response here later."}{' '}
              {result.entry.status
                ? `It returned ${result.entry.status} in ${result.entry.ms} ms.`
                : ''}{' '}
              <button type="button" className="link" onClick={() => void run(result.request)}>
                Send it again
              </button>
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
