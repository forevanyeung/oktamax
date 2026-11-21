/**
 * What the API console keeps across page loads: the request being written,
 * the drawer's height and whether it's open, where its tab sits, the history
 * of sent requests, and the responses to the latest of them.
 */
import type { ApiRequest, ApiResponse, Method } from './request';

export interface HistoryEntry {
  id: string;
  method: Method;
  url: string;
  body: string;
  /** Response status; `0` if the request didn't get a response. */
  status: number;
  ms: number;
  at: number;
  /** Its response is saved (`saveResponse`): one of the latest `RESPONSE_LIMIT`. */
  saved?: boolean;
}

export interface ConsoleState {
  open: boolean;
  height: number;
  /** As tall as it can be, rather than at `height`. */
  maximized: boolean;
  /** Where the closed drawer's tab sits along the bottom: 0 is the left edge, 1 the right. */
  tabX: number;
  draft: ApiRequest;
  history: HistoryEntry[];
}

const STORAGE_KEY = 'apiConsole';
export const HISTORY_LIMIT = 100;
/** Responses are much larger than requests: only the latest this many are kept. */
export const RESPONSE_LIMIT = 30;

export const defaultState: ConsoleState = {
  open: false,
  height: 420,
  maximized: false,
  tabX: 0.5,
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

/**
 * Adds `entry` to the top of `history`, replacing an identical earlier request.
 * Entries past the latest `RESPONSE_LIMIT` saved responses lose theirs.
 */
export function addToHistory(history: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const same = (e: HistoryEntry) =>
    e.method === entry.method && e.url === entry.url && e.body === entry.body;
  let saved = 0;
  return [entry, ...history.filter((e) => !same(e))].slice(0, HISTORY_LIMIT).map((e) => {
    if (!e.saved) return e;
    if (++saved <= RESPONSE_LIMIT) return e;
    const { saved: _, ...rest } = e;
    return rest;
  });
}

/** The ids of the entries whose responses are saved. */
export const savedIds = (history: HistoryEntry[]) =>
  new Set(history.filter((e) => e.saved).map((e) => e.id));

/**
 * A response as it's saved: what came over the wire, without what the console
 * works out from it (`toResponse`).
 */
export type SavedResponse = Pick<ApiResponse, 'status' | 'statusText' | 'headers' | 'text' | 'ms'>;

// Each response under a key of its own, apart from the rest of the state, which is saved
// as the request is typed.
const responseKey = (id: string) => `${STORAGE_KEY}.response.${id}`;

/** Saves the response to history entry `id`; whether it was saved (it may not fit). */
export async function saveResponse(id: string, response: ApiResponse): Promise<boolean> {
  const { status, statusText, headers, text, ms } = response;
  const saved: SavedResponse = { status, statusText, headers, text, ms };
  try {
    await chrome.storage.local.set({ [responseKey(id)]: saved });
    return true;
  } catch {
    return false;
  }
}

export async function loadResponse(id: string): Promise<SavedResponse | undefined> {
  try {
    const items = await chrome.storage.local.get(responseKey(id));
    return items[responseKey(id)] as SavedResponse | undefined;
  } catch {
    return undefined;
  }
}

export const removeResponses = (ids: Iterable<string>) =>
  chrome.storage.local.remove([...ids].map(responseKey)).catch(() => {});
