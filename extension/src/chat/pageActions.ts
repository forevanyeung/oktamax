/**
 * Carries out the page tools (`@oktamax/shared/pageTools`) as their calls come
 * in: opening a request in the API console, or navigating.
 *
 * Each call runs once, in the tab the admin is looking at, and only if it came
 * in after the chat loaded: calls already in its history don't run again. A
 * reply resumed after a page load replays its calls, so the IDs of calls that
 * ran are kept in extension storage too.
 */
import { getToolName, isToolUIPart } from 'ai';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  checkPageTool,
  OPEN_IN_API_CONSOLE,
  PAGE_TOOLS,
  type PageToolOutput,
} from '@oktamax/shared/pageTools';

import { openInConsole } from '../console/remote';
import type { OktaChatMessage } from './useOktaChat';

const DONE_KEY = 'chatPageActions';
const KEEP = 100;

interface PageAction {
  id: string;
  tool: string;
  path: string;
}

const isPageTool = (name: string) => (PAGE_TOOLS as readonly string[]).includes(name);

/** The page tool calls in `messages` that the server accepted. */
const pageActions = (messages: OktaChatMessage[]): PageAction[] =>
  messages.flatMap((message) =>
    message.role !== 'assistant'
      ? []
      : message.parts.filter(isToolUIPart).flatMap((part) => {
          const tool = getToolName(part);
          if (!isPageTool(tool) || part.state !== 'output-available') return [];
          const output = part.output as PageToolOutput;
          return output.ok ? [{ id: part.toolCallId, tool, path: output.path }] : [];
        }),
  );

// Calls that couldn't run because the API console is turned off, for the chat to say so.
const consoleOff = new Set<string>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
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
  const opened = openInConsole({ method: 'GET', url: checked.path, body: '' });
  if (opened === consoleOff.has(id)) {
    if (opened) consoleOff.delete(id);
    else consoleOff.add(id);
    listeners.forEach((l) => l());
  }
}

/** True for the first tab to claim the call. */
async function claim(id: string): Promise<boolean> {
  const stored = await chrome.storage.local.get(DONE_KEY);
  const done = (stored[DONE_KEY] as string[] | undefined) ?? [];
  if (done.includes(id)) return false;
  await chrome.storage.local.set({ [DONE_KEY]: [...done, id].slice(-KEEP) });
  return true;
}

export function usePageActions(messages: OktaChatMessage[], initialMessages: OktaChatMessage[]) {
  const seen = useRef<Set<string>>(undefined);
  seen.current ??= new Set(pageActions(initialMessages).map((action) => action.id));

  useEffect(() => {
    for (const action of pageActions(messages)) {
      if (seen.current!.has(action.id)) continue;
      seen.current!.add(action.id);
      if (document.visibilityState !== 'visible') continue;
      void claim(action.id).then((first) => {
        if (first) runPageAction(action.id, action.tool, action.path);
      });
    }
  }, [messages]);
}
