/**
 * Tools that act on the admin's page rather than on Okta. The extension sees the
 * call in the reply and carries it out.
 *
 * `open_in_api_console` also sends the same GET here, with the admin's token, so
 * the model can read what the admin sees in the console. That response goes
 * through the org's MCP hooks (`mcp/hooks/`), like any Okta tool's result, so
 * what they withhold or block stays withheld or blocked.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { tool } from 'ai';
import * as z from 'zod';

import { OKTA_SCOPES } from '@oktamax/shared';
import {
  checkAdminPath,
  checkApiPath,
  NAVIGATE,
  OPEN_IN_API_CONSOLE,
  type PageToolOutput,
} from '@oktamax/shared/pageTools';

import type { Principal } from '../auth';
import { ToolHooks } from '../mcp/hooks';

const input = z.object({ path: z.string().max(2_000) });

/** Most of a response the model gets: about 10k tokens. The console has all of it. */
export const MAX_RESPONSE_CHARS = 40_000;
const TIMEOUT_MS = 30_000;
const TOKEN_SCOPES = OKTA_SCOPES.filter((s) => s.startsWith('okta.')).join(', ');

/** Okta's `Link: <…>; rel="next"` header, as a path for the next call. */
function nextPath(link: string | null, org: URL): string | undefined {
  const next = link
    ?.split(',')
    .find((l) => /rel="?next"?/.test(l))
    ?.match(/<([^>]+)>/)?.[1];
  if (!next) return undefined;
  try {
    const url = new URL(next, org);
    return url.host === org.host ? url.pathname + url.search : undefined;
  } catch {
    return undefined;
  }
}

/** Sends `path` as the admin and returns the response as a tool result. */
async function fetchAsAdmin(principal: Principal, path: string): Promise<CallToolResult> {
  const org = new URL(principal.org.url);
  let res: Response;
  try {
    res = await fetch(new URL(path, org), {
      headers: { Authorization: `Bearer ${principal.token}`, Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return {
      isError: true,
      content: [{ type: 'text', text: `The request failed: ${String(error)}` }],
    };
  }
  const text = await res.text();
  const next = nextPath(res.headers.get('link'), org);
  // A 401/403 for a missing scope has an empty body; the scope it needs is in this header.
  const challenge = res.ok ? null : res.headers.get('www-authenticate');
  return {
    isError: !res.ok,
    content: [{ type: 'text', text }],
    // Kept out of `content` so the hooks only see Okta's body.
    _meta: {
      status: res.status,
      ...(next && { next }),
      ...(challenge && { wwwAuthenticate: challenge }),
    },
  };
}

export type ApiConsoleOutput = PageToolOutput & {
  /** What the request returned, for the model; the admin sees it in the console. */
  status?: number;
  response?: string;
  truncated?: true;
  /** The next page's path, to call this tool with if more is needed. */
  next?: string;
  /** Why Okta refused the token, e.g. `error="insufficient_scope"` and the `scope` it needs. */
  wwwAuthenticate?: string;
};

/** The page tools for `principal`'s chat. `hooks` are the MCP gateway's. */
export const pageTools = (principal: Principal, hooks: ToolHooks = new ToolHooks()) => ({
  [OPEN_IN_API_CONSOLE]: tool({
    description: `Open a GET request in the API console, a drawer at the bottom of the admin's page, and send it there, so the admin gets the full response with paging, a table view and CSV export. The same request is sent for you too: its response (the first ${MAX_RESPONSE_CHARS.toLocaleString('en-US')} characters) comes back in this tool's result, so answer from it.

Prefer ${NAVIGATE}. Use this only when the admin asks for the API or the API console, or when no admin console page shows what they asked for. Pass the same path you'd query, with filters, e.g. /api/v1/logs?filter=eventType eq "user.authentication.sso" and target.id eq "0oa…"&since=2026-11-01T00:00:00Z. Still say in your answer what you opened.

The console sends it with the admin's browser session; your copy is sent with their Okta token, which only has these read scopes: ${TOKEN_SCOPES}. So a 403 here can be a 200 in the console: when wwwAuthenticate says insufficient_scope, tell the admin the assistant's token lacks that scope (the console shows them the response), rather than saying they lack access.`,
    inputSchema: input,
    execute: async ({ path }): Promise<ApiConsoleOutput> => {
      const checked = checkApiPath(path);
      if (!checked.ok) return checked;
      // The admin's console sends it anyway; only what the model gets goes through the hooks.
      const result = await hooks
        .for(principal.org.host)
        .call({ name: OPEN_IN_API_CONSOLE, arguments: { path } }, { principal }, () =>
          fetchAsAdmin(principal, checked.path),
        );
      const text = result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n');
      const meta = (result._meta ?? {}) as {
        status?: number;
        next?: string;
        wwwAuthenticate?: string;
      };
      const output: ApiConsoleOutput = { ...checked, response: text.slice(0, MAX_RESPONSE_CHARS) };
      if (meta.status !== undefined) output.status = meta.status;
      if (text.length > MAX_RESPONSE_CHARS) output.truncated = true;
      if (meta.next) output.next = meta.next;
      if (meta.wwwAuthenticate) output.wwwAuthenticate = meta.wwwAuthenticate;
      return output;
    },
  }),
  [NAVIGATE]: tool({
    description: `Take the admin to a page of the admin console. It loads the page in their tab; the conversation carries on there.

Use it when the admin asks to go to, open, see, show or bring up something that has a page. Paths, with IDs from your lookups:
- /admin/user/profile/view/{userId}
- /admin/group/{groupId}
- /admin/app/{appName}/instance/{appId}/ (appName is the app's "name", e.g. okta_org2org)
- /admin/users, /admin/groups, /admin/apps/active
- /admin/access/networks, /admin/authn/authentication-policies, /admin/access/policies (global session policy), /admin/access/authenticators
- /report/system_log_2?search={filter}&fromTime={ISO time}&toTime={ISO time} (the System Log; search takes a System Log API filter expression, e.g. eventType eq "user.authentication.sso" and target.id eq "0oa…"; URL-encode the values; leave out what you don't need. Without times it shows the last 7 days)
Don't guess other paths.`,
    inputSchema: input,
    execute: async ({ path }): Promise<PageToolOutput> => checkAdminPath(path),
  }),
});
