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

export interface AuthStatus {
  configured: boolean;
  signedIn: boolean;
  /** The Okta org the chat server serves; the chat only appears on that org's admin console. */
  oktaOrgUrl?: string;
  error?: string;
}
