/**
 * What the API console keeps across page loads: the request being written,
 * the drawer's height and whether it's open, and the history of sent requests.
 */
import type { ApiRequest, Method } from './request';

export interface HistoryEntry {
  id: string;
  method: Method;
  url: string;
  body: string;
  /** Response status; `0` if the request didn't get a response. */
  status: number;
  ms: number;
  at: number;
}

export interface ConsoleState {
  open: boolean;
  height: number;
  /** Covering the whole page, rather than at `height`. */
  maximized: boolean;
  draft: ApiRequest;
  history: HistoryEntry[];
}

const STORAGE_KEY = 'apiConsole';
export const HISTORY_LIMIT = 100;

export const defaultState: ConsoleState = {
  open: false,
  height: 420,
  maximized: false,
  draft: { method: 'GET', url: '/api/v1/users/me', body: '' },
  history: [],
};

export async function loadState(): Promise<ConsoleState> {
  const items = await chrome.storage.local.get(STORAGE_KEY);
  return { ...defaultState, ...(items[STORAGE_KEY] as Partial<ConsoleState> | undefined) };
}

export const saveState = (state: ConsoleState) =>
  // Reloading the extension leaves this script running without access to storage.
  chrome.storage.local.set({ [STORAGE_KEY]: state }).catch(() => {});

/** Adds `entry` to the top of `history`, replacing an identical earlier request. */
export function addToHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const same = (e: HistoryEntry) =>
    e.method === entry.method && e.url === entry.url && e.body === entry.body;
  return [entry, ...history.filter((e) => !same(e))].slice(0, HISTORY_LIMIT);
}
