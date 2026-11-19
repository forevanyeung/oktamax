/**
 * Lets the chat open a request in the API console and send it. The console
 * registers a handler while it's mounted and turned on.
 */
import type { ApiRequest, ApiResponse } from './request';

/** Sends `request` from the console: its response or why it failed; undefined if turned off. */
type Handler = (request: ApiRequest) => Promise<ApiResponse | Error> | undefined;

let handler: Handler | undefined;

export function setConsoleHandler(next: Handler) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}

/** Opens the drawer with `request` and sends it. Undefined if the console is turned off. */
export const openInConsole = (request: ApiRequest) => handler?.(request);
