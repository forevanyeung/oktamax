/**
 * Tools the model uses to act on the admin console page the admin is on. The
 * server only checks their input; the extension carries them out when it sees
 * them in the reply (`extension/src/chat/pageActions.ts`).
 *
 * Neither can change anything in Okta: one opens a page of the admin console,
 * the other sends a GET from the extension's API console.
 */

export const OPEN_IN_API_CONSOLE = 'open_in_api_console';
export const NAVIGATE = 'navigate';
export const PAGE_TOOLS = [OPEN_IN_API_CONSOLE, NAVIGATE] as const;

export interface PageToolInput {
  /** `/api/v1/...` for the API console; an admin console path such as `/admin/groups` to navigate. */
  path: string;
}

export type PageToolOutput = { ok: true; path: string } | { ok: false; error: string };

const ORIGIN = 'https://org.invalid';

/** `path` parsed on a stand-in origin, or undefined if it could point to another origin. */
function samePath(path: string): URL | undefined {
  // Backslashes and control characters can turn into `//` once a browser parses them.
  // eslint-disable-next-line no-control-regex
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\x00-\x1f]/.test(path))
    return undefined;
  try {
    const url = new URL(path, ORIGIN);
    return url.origin === ORIGIN ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Checks an `open_in_api_console` path: an Okta API path on the current org. */
export function checkApiPath(path: string): PageToolOutput {
  const url = samePath(path);
  if (!url || !url.pathname.startsWith('/api/')) {
    return {
      ok: false,
      error: 'path must be an Okta API path starting with /api/, e.g. /api/v1/logs',
    };
  }
  return { ok: true, path };
}

/** Checks a `navigate` path: a page of the admin console, not the API. */
export function checkAdminPath(path: string): PageToolOutput {
  const url = samePath(path);
  if (!url || url.pathname.startsWith('/api/') || url.pathname.startsWith('/oauth2/')) {
    return { ok: false, error: 'path must be an admin console page path, e.g. /admin/groups' };
  }
  return { ok: true, path };
}

export const checkPageTool = (name: string, input: PageToolInput): PageToolOutput =>
  name === OPEN_IN_API_CONSOLE ? checkApiPath(input.path) : checkAdminPath(input.path);
