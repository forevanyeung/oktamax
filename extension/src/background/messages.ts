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

/** What the chat can do. The org URL is the Okta org the chat server serves; the chat only appears on that org's admin console. */
export type AuthStatus =
  /** No chat server URL: the assistant is turned off. */
  | { state: 'off' }
  /** The chat server can't be reached (in production builds). */
  | { state: 'unreachable'; serverUrl: string; error: string }
  /** Dev builds without a reachable chat server: replies come from `mockChat.ts`. */
  | { state: 'mock' }
  /** On-device: Chrome's built-in model can't run here, or hasn't been downloaded yet. */
  | { state: 'modelUnavailable'; oktaOrgUrl: string; availability: string }
  | { state: 'signedOut'; oktaOrgUrl: string; error?: string }
  | { state: 'signedIn'; oktaOrgUrl: string; onDevice?: boolean };
