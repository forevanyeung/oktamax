/**
 * Carries out the page tools (`@oktamax/shared/pageTools`) as their calls come
 * in: sending a request from the API console, or navigating.
 *
 * `open_in_api_console` waits for us: the reply stops at the call, we send the
 * GET from the console (or straight from the page when the console is turned
 * off) with the admin's session, and its response goes back to the model as the
 * call's output, which continues the reply. The call stays waiting in the chat's
 * history until then, so if the admin navigates away before it's answered, the
 * next page sends it again: only GETs, so that's safe.
 *
 * `navigate` (and the on-device assistant's `open_in_api_console`, which answers
 * itself) run once, in the tab the admin is looking at, and only if they came in
 * after the chat loaded: calls already in its history don't run again. A reply
 * resumed after a page load replays its calls, so the IDs of calls that ran are
 * kept in extension storage too.
 */
import { getToolName, isToolUIPart, type ChatAddToolOutputFunction } from 'ai';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  checkApiPath,
  checkPageTool,
  MAX_RESPONSE_CHARS,
  OPEN_IN_API_CONSOLE,
  PAGE_TOOLS,
  type ApiConsoleOutput,
  type PageToolInput,
  type PageToolOutput,
} from '@oktamax/shared/pageTools';

import { openInConsole } from '../console/remote';
import { send, type ApiResponse } from '../console/request';
import type { OktaChatMessage } from './useOktaChat';

const DONE_KEY = 'chatPageActions';
const KEEP = 100;

interface PageAction {
  id: string;
  tool: string;
  path: string;
}

const isPageTool = (name: string) => (PAGE_TOOLS as readonly string[]).includes(name);

/** The page tool calls in `messages` that were answered with a path to open. */
const pageActions = (messages: OktaChatMessage[]): PageAction[] =>
  messages.flatMap((message) =>
    message.role !== 'assistant'
      ? []
      : message.parts.filter(isToolUIPart).flatMap((part) => {
          const tool = getToolName(part);
          if (!isPageTool(tool) || part.state !== 'output-available') return [];
          const output = part.output as PageToolOutput | ApiConsoleOutput;
          // A console call we answered ourselves has already run.
          if (!output.ok || 'status' in output) return [];
          return [{ id: part.toolCallId, tool, path: output.path }];
        }),
  );

/** The reply's API console calls that are waiting for their response. */
const waitingCalls = (messages: OktaChatMessage[]): Array<{ id: string; path: string }> => {
  const last = messages.at(-1);
  if (last?.role !== 'assistant') return [];
  return last.parts
    .filter(isToolUIPart)
    .flatMap((part) =>
      getToolName(part) === OPEN_IN_API_CONSOLE && part.state === 'input-available'
        ? [{ id: part.toolCallId, path: String((part.input as PageToolInput | undefined)?.path) }]
        : [],
    );
};

// Calls that couldn't open because the API console is turned off, for the chat to say so.
const consoleOff = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const setConsoleOff = (id: string, off: boolean) => {
  if (off === consoleOff.has(id)) return;
  if (off) consoleOff.add(id);
  else consoleOff.delete(id);
  listeners.forEach((l) => l());
};

export const useConsoleOff = (toolCallId: string) =>
  useSyncExternalStore(subscribe, () => consoleOff.has(toolCallId));

/** Opens the request or the page. Also used by the chat's "again" buttons. */
export function runPageAction(id: string, tool: string, path: string) {
  // Checked again here: the path came from the model by way of the server.
  const checked = checkPageTool(tool, { path });
  if (!checked.ok) return;
  if (tool !== OPEN_IN_API_CONSOLE) {
    location.assign(new URL(checked.path, location.origin).href);
    return;
  }
  setConsoleOff(id, !openInConsole({ method: 'GET', url: checked.path, body: '' }));
}

/** The call's output for the model, from what the console got. */
const toOutput = (path: string, response: ApiResponse | Error): ApiConsoleOutput =>
  response instanceof Error
    ? { ok: false, error: `The request failed: ${response.message}` }
    : {
        ok: true,
        path,
        status: response.status,
        response: response.text.slice(0, MAX_RESPONSE_CHARS),
        ...(response.text.length > MAX_RESPONSE_CHARS && { truncated: true as const }),
        ...(response.next && { next: response.next }),
      };

/** Sends an API console call's GET, once, and returns its output for the model. */
async function answerConsoleCall(id: string, path: string): Promise<ApiConsoleOutput> {
  const checked = checkApiPath(path);
  if (!checked.ok) return checked;
  const request = { method: 'GET' as const, url: checked.path, body: '' };
  const shown = openInConsole(request);
  setConsoleOff(id, !shown);
  // Turned off: the model still gets its answer, sent the same way.
  const response = await (shown ?? send(request).catch((e: unknown) => new Error(String(e))));
  return toOutput(checked.path, response);
}

/** Calls this page answered, so the reply doesn't wait for them again: see `useOktaChat`. */
export const answeredHere = new Set<string>();

/** True for the first tab to claim the call. */
async function claim(id: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(DONE_KEY);
  const done = (stored[DONE_KEY] as string[] | undefined) ?? [];
  if (done.includes(id)) return false;
  await chrome.storage.local.set({ [DONE_KEY]: [...done, id].slice(-KEEP) });
  return true;
}

type AddToolOutput = ChatAddToolOutputFunction<OktaChatMessage>;

export function usePageActions(
  messages: OktaChatMessage[],
  initialMessages: OktaChatMessage[],
  addToolOutput: AddToolOutput,
) {
  const seen = useRef<Set<string>>(undefined);
  seen.current ??= new Set(pageActions(initialMessages).map((action) => action.id));
  const sending = useRef(new Set<string>());
  const visible = useVisible();

  useEffect(() => {
    for (const action of pageActions(messages)) {
      if (seen.current!.has(action.id)) continue;
      seen.current!.add(action.id);
      if (!visible) continue;
      void claim(action.id).then((first) => {
        if (first) runPageAction(action.id, action.tool, action.path);
      });
    }
    // Including calls already waiting in the history: their page was left before
    // they were answered. A hidden tab leaves them to the one the admin is on.
    if (!visible) return;
    for (const call of waitingCalls(messages)) {
      if (sending.current.has(call.id)) continue;
      sending.current.add(call.id);
      void answerConsoleCall(call.id, call.path).then((output) => {
        answeredHere.add(call.id);
        return addToolOutput({ tool: OPEN_IN_API_CONSOLE, toolCallId: call.id, output });
      });
    }
  }, [messages, visible, addToolOutput]);
}

/** Whether this tab is the one the admin is looking at. */
const useVisible = () =>
  useSyncExternalStore(
    (onChange) => {
      document.addEventListener('visibilitychange', onChange);
      return () => document.removeEventListener('visibilitychange', onChange);
    },
    () => document.visibilityState === 'visible',
  );
