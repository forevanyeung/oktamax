/** Messages between content scripts and the background service worker. */

export const FETCH_PORT = 'oktamax:fetch';

/** Content script → worker, over a `FETCH_PORT` port: one request per port. */
export interface BridgeRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Worker → content script: the response head, then body chunks, then end (or error). */
export type BridgeResponse =
  | { type: 'head'; status: number; statusText: string; headers: Array<[string, string]> }
  | { type: 'chunk'; text: string }
  | { type: 'end' }
  | { type: 'error'; message: string };

/** One-off requests via `chrome.runtime.sendMessage`. */
export type WorkerRequest = { type: 'oktamax:signIn' } | { type: 'oktamax:authStatus' };

/** Worker → content script, via `chrome.tabs.sendMessage`: an Okta API GET for the on-device assistant (`content/oktaGet.ts`). */
export type TabRequest = { type: 'oktamax:oktaGet'; path: string };

/** What the chat can do. The org URL is the Okta org of the admin console the chat is on. */
export type AuthStatus =
  /** No chat server URL (the assistant is turned off), or the server doesn't serve this org. */
  | { state: 'off' }
  /** The chat server can't be reached (in production builds). */
  | { state: 'unreachable'; serverUrl: string; error: string }
  /** Dev builds without a reachable chat server: replies come from `mockChat.ts`. */
  | { state: 'mock' }
  /** On-device: Chrome's built-in model can't run here, or hasn't been downloaded yet. */
  | { state: 'modelUnavailable'; oktaOrgUrl: string; availability: string }
  | { state: 'signedOut'; oktaOrgUrl: string; error?: string }
  | { state: 'signedIn'; oktaOrgUrl: string; onDevice?: boolean };

/** The admin console tab an on-device chat is on, which sends its Okta requests, and its org. */
export interface AdminTab {
  tabId: number;
  /** https://acme.okta.com for a tab on https://acme-admin.okta.com. */
  oktaOrgUrl: string;
}
