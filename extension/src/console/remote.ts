/**
 * Lets the chat open a request in the API console and send it. The console
 * registers a handler while it's mounted and turned on.
 */
import type { ApiRequest } from './request';

let handler: ((request: ApiRequest) => boolean) | undefined;

export function setConsoleHandler(next: (request: ApiRequest) => boolean) {
  handler = next;
  return () => {
    if (handler === next) handler = undefined;
  };
}

/** Opens the drawer with `request` and sends it. False if the console is turned off. */
export const openInConsole = (request: ApiRequest) => handler?.(request) ?? false;
