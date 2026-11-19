/**
 * Tools the model uses to act on the admin console page the admin is on. The
 * extension carries them out when it sees them in the reply
 * (`extension/src/chat/pageActions.ts`).
 *
 * Neither can change anything in Okta: `navigate` opens a page of the admin
 * console (the server checks the path), and `open_in_api_console` sends a GET
 * from the extension's API console, with the admin's session, and hands the
 * response back to the model as the tool's output.
 */

import { getToolName, isToolUIPart, type UIMessage } from 'ai';

export const OPEN_IN_API_CONSOLE = 'open_in_api_console';
export const NAVIGATE = 'navigate';
export const PAGE_TOOLS = [OPEN_IN_API_CONSOLE, NAVIGATE] as const;

export interface PageToolInput {
  /** `/api/v1/...` for the API console; an admin console path such as `/admin/groups` to navigate. */
  path: string;
}

export type PageToolOutput = { ok: true; path: string } | { ok: false; error: string };

/** Most of an API console response the model gets: about 10k tokens. The console has all of it. */
export const MAX_RESPONSE_CHARS = 40_000;

/** `open_in_api_console`'s output: what the console got back, for the model. */
export type ApiConsoleOutput =
  | {
      ok: true;
      path: string;
      status: number;
      /** The response body, cut to `MAX_RESPONSE_CHARS`. */
      response: string;
      truncated?: true;
      /** The next page's path (`Link: rel="next"`), to call the tool with if more is needed. */
      next?: string;
    }
  | { ok: false; error: string };

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

/**
 * `last` (the reply), with the outputs `submitted` has for its API console calls
 * that are still waiting, each passed through `check` (the chat server runs its
 * hooks there). Nothing else the extension sent is used. Undefined when it
 * answered none of them.
 */
export async function withConsoleOutputs<Message extends UIMessage>(
  last: Message | undefined,
  submitted: Message,
  check: (input: unknown, output: unknown) => Promise<unknown>,
): Promise<Message | undefined> {
  if (last?.role !== 'assistant' || last.id !== submitted.id) return undefined;
  let answered = false;
  const parts = await Promise.all(
    last.parts.map(async (part) => {
      if (
        !isToolUIPart(part) ||
        getToolName(part) !== OPEN_IN_API_CONSOLE ||
        part.state !== 'input-available'
      ) {
        return part;
      }
      const answer = submitted.parts.find(
        (p) => isToolUIPart(p) && p.toolCallId === part.toolCallId,
      );
      if (!answer || !isToolUIPart(answer) || answer.state !== 'output-available') return part;
      answered = true;
      return { ...part, state: 'output-available', output: await check(part.input, answer.output) };
    }),
  );
  return answered ? ({ ...last, parts } as Message) : undefined;
}
