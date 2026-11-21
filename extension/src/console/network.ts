/**
 * Past responses come from DevTools' Network log rather than from storage of
 * the console's own. Every request the console sends carries a
 * `REQUEST_ID_HEADER` with its history entry's id; to show a past response,
 * the console asks the extension's DevTools page (`devtools/main.ts`), open
 * while DevTools is open on this tab, for the request with that id.
 */
export const REQUEST_ID_HEADER = 'X-Oktamax-Request-Id';

/** Asks the DevTools page inspecting the sender's tab for a request in its Network log. */
export interface NetworkLookup {
  type: 'oktamax:networkResponse';
  id: string;
}

/** A response as DevTools recorded it. */
export interface NetworkEntry {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  text: string;
  ms: number;
}

/** The DevTools page's answer: the response, or `null` if the request isn't in the log. */
export type NetworkLookupResult = NetworkEntry | null;

export type PastResponse =
  | { state: 'found'; entry: NetworkEntry }
  /** DevTools is open, but the request isn't in its log (sent before it opened, or the log was cleared). */
  | { state: 'missing' }
  /** DevTools isn't open on this tab, so there is no log to look in. */
  | { state: 'noDevtools' };

/** The response to the console request `id`, from DevTools' Network log. */
export async function pastResponse(id: string): Promise<PastResponse> {
  const lookup: NetworkLookup = { type: 'oktamax:networkResponse', id };
  let entry: NetworkLookupResult | undefined;
  try {
    entry = (await chrome.runtime.sendMessage(lookup)) as NetworkLookupResult | undefined;
  } catch {
    // Nothing answered: no DevTools page is open on this tab.
    return { state: 'noDevtools' };
  }
  // The DevTools page answers `null` when it has no such request; nothing at all means none answered.
  if (entry === undefined) return { state: 'noDevtools' };
  if (entry === null) return { state: 'missing' };
  return { state: 'found', entry };
}
