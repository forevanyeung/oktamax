/**
 * The console's prompt: a method and a URL, with suggestions from the API's
 * endpoints as you type, and the history on arrow up, like a shell.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import type { PageContext } from './context';
import { METHODS, splitMethod, toConsoleUrl, type ApiRequest, type Method } from './request';
import type { HistoryEntry } from './store';
import { suggest, type Suggestion } from './suggest';

export interface PromptHandle {
  focus: () => void;
  /** Sets the URL and shows its suggestions, e.g. to browse an object's endpoints. */
  browse: (url: string) => void;
}

interface Props {
  draft: ApiRequest;
  history: HistoryEntry[];
  context: PageContext;
  sending: boolean;
  onChange: (change: Partial<ApiRequest>) => void;
  onSend: () => void;
  onEscape: () => void;
}

/** Selects the first `{placeholder}` left in the input, so typing replaces it. */
const selectPlaceholder = (input: HTMLInputElement) =>
  requestAnimationFrame(() => {
    const match = input.value.match(/\{\w+\}/);
    input.focus();
    if (match?.index !== undefined) {
      input.setSelectionRange(match.index, match.index + match[0].length);
    } else {
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });

/** Shows `label` with the part matching what's typed in bold. */
const Highlighted = ({ label, typed }: { label: string; typed: string }) => {
  const last = typed.split(/[/?&]/).pop()?.toLowerCase() ?? '';
  const at = last ? label.toLowerCase().lastIndexOf(last) : -1;
  if (at < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, at)}
      <b>{label.slice(at, at + last.length)}</b>
      {label.slice(at + last.length)}
    </>
  );
};

export const Prompt = forwardRef<PromptHandle, Props>(
  ({ draft, history, context, sending, onChange, onSend, onEscape }, ref) => {
    const input = useRef<HTMLInputElement>(null);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    // Arrow up at the prompt walks the history, like a shell.
    const cursor = useRef<{ index: number; draft: ApiRequest }>(undefined);
    const list = useRef<HTMLUListElement>(null);

    const suggestions = open ? suggest(draft.url, draft.method, context) : [];
    const showing = suggestions.length > 0;

    const change = (next: Partial<ApiRequest>) => {
      cursor.current = undefined;
      onChange(next);
    };

    useImperativeHandle(ref, () => ({
      focus: () => input.current?.focus(),
      browse: (url) => {
        change({ url });
        setOpen(true);
        setActive(-1);
        if (input.current) selectPlaceholder(input.current);
      },
    }));

    const accept = (suggestion: Suggestion) => {
      change(
        suggestion.method
          ? { method: suggestion.method, url: suggestion.url }
          : { url: suggestion.url },
      );
      setActive(-1);
      setOpen(false);
      if (input.current) selectPlaceholder(input.current);
    };

    const moveTo = (index: number) => {
      setActive(index);
      list.current?.children[index]?.scrollIntoView({ block: 'nearest' });
    };

    const walkHistory = (step: 1 | -1) => {
      const current = cursor.current ?? { index: -1, draft };
      const index = Math.max(-1, Math.min(history.length - 1, current.index + step));
      const request = index < 0 ? current.draft : history[index];
      if (index === current.index || !request) return false;
      onChange({ method: request.method, url: request.url, body: request.body });
      cursor.current = index < 0 ? undefined : { index, draft: current.draft };
      return true;
    };

    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      const { key } = event;
      if (key === 'Enter') {
        event.preventDefault();
        const suggestion = showing && active >= 0 ? suggestions[active] : undefined;
        if (suggestion) accept(suggestion);
        else {
          setOpen(false);
          onSend();
        }
      } else if (key === 'Tab' && showing && !event.shiftKey) {
        event.preventDefault();
        const suggestion = suggestions[Math.max(active, 0)];
        if (suggestion) accept(suggestion);
      } else if (key === 'ArrowDown' && showing && active < suggestions.length - 1) {
        event.preventDefault();
        moveTo(active + 1);
      } else if (key === 'ArrowUp' && showing && active > 0) {
        event.preventDefault();
        moveTo(active - 1);
      } else if (key === 'ArrowUp' || key === 'ArrowDown') {
        // Out of the suggestions (or none): the history.
        if (walkHistory(key === 'ArrowUp' ? 1 : -1)) {
          event.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (key === 'ArrowDown' && !open) {
          event.preventDefault();
          setOpen(true);
        }
      } else if (key === 'Escape') {
        if (showing) {
          setOpen(false);
          setActive(-1);
        } else onEscape();
      } else if (key === ' ' && event.ctrlKey) {
        event.preventDefault();
        setOpen(true);
      }
    };

    const onInput = (value: string) => {
      let { method, url } = splitMethod(value);
      if (/^https?:\/\//i.test(url.trim())) {
        try {
          url = toConsoleUrl(url.trim());
        } catch {
          // Not a URL yet; leave it as typed.
        }
      }
      change(method ? { method, url } : { url });
      setOpen(true);
      setActive(-1);
    };

    return (
      <div className="prompt-wrap">
        <form
          className="prompt"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <select
            className={`method-select m-${draft.method}`}
            aria-label="Method"
            value={draft.method}
            onChange={(e) => change({ method: e.target.value as Method })}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input
            ref={input}
            className="prompt-input"
            aria-label="Request URL"
            role="combobox"
            aria-expanded={showing}
            aria-controls="oktamax-suggestions"
            aria-autocomplete="list"
            spellCheck={false}
            autoComplete="off"
            placeholder="/api/v1/users?limit=10, or words to search the API, e.g. list group members"
            value={draft.url}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => !draft.url.trim() && setOpen(true)}
            onBlur={() => setOpen(false)}
          />
          <button type="submit" className="send" disabled={sending || !draft.url.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
        {showing && (
          <ul className="suggestions" id="oktamax-suggestions" role="listbox" ref={list}>
            {suggestions.map((s, i) => (
              <li
                key={`${s.method ?? ''} ${s.label}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'suggestion active' : 'suggestion'}
                // Keeps the focus in the prompt.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => accept(s)}
              >
                <span className={`method m-${s.method ?? 'param'}`}>{s.method ?? '?'}</span>
                <span className="suggestion-label">
                  <Highlighted label={s.label} typed={draft.url} />
                </span>
                <span className="suggestion-detail">{s.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  },
);
