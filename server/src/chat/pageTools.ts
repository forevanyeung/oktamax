/**
 * Tools that act on the admin's page rather than on Okta. The extension sees
 * the call in the reply and carries it out.
 *
 * `navigate` is checked and answered here. `open_in_api_console` has no
 * `execute`: the reply stops at the call, the extension sends the GET from the
 * API console with the admin's session, and posts the response back as the
 * tool's output (`routes.ts`), which `consoleOutput` checks and runs through the
 * org's MCP hooks (`mcp/hooks/`) before the model sees it.
 */
import { tool } from 'ai';
import * as z from 'zod';

import {
  checkAdminPath,
  checkApiPath,
  MAX_RESPONSE_CHARS,
  NAVIGATE,
  OPEN_IN_API_CONSOLE,
  type ApiConsoleOutput,
  type PageToolOutput,
} from '@oktamax/shared/pageTools';

import type { Principal } from '../auth';
import type { ToolHooks } from '../mcp/hooks';

const input = z.object({ path: z.string().max(2_000) });

export const pageTools = {
  [OPEN_IN_API_CONSOLE]: tool({
    description: `Send a GET request from the API console, a drawer at the bottom of the admin's page. The admin gets the full response there, with paging, a table view and CSV export, and you get it back as this tool's result (the first ${MAX_RESPONSE_CHARS.toLocaleString('en-US')} characters, with \`next\` for the next page), so answer from it.

It's sent with the admin's own admin console session, so it can read anything the admin can, including APIs your other tools don't cover (e.g. /api/v1/iam/roles for custom admin roles). Only GET: it can't change anything.

Use it when the admin asks for the API or the API console, or when your other tools can't answer. Prefer ${NAVIGATE} when they ask to see a page. Pass the path with its filters, e.g. /api/v1/logs?filter=eventType eq "user.authentication.sso" and target.id eq "0oa…"&since=2026-11-01T00:00:00Z. Still say in your answer what you opened.`,
    inputSchema: input,
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
};

const consoleOutputSchema = z.union([
  z.object({
    ok: z.literal(true),
    status: z.number().int(),
    response: z.string(),
    next: z.string().max(4_000).optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string().max(2_000) }),
]);

/**
 * What the model gets for an `open_in_api_console` call to `input.path`, from the
 * `output` the extension posted: checked, run through the org's hooks, and cut to
 * `MAX_RESPONSE_CHARS`.
 */
export async function consoleOutput(
  principal: Principal,
  hooks: ToolHooks,
  input: unknown,
  output: unknown,
): Promise<ApiConsoleOutput> {
  const requested = (input as { path?: unknown } | undefined)?.path;
  const path = checkApiPath(typeof requested === 'string' ? requested : '');
  if (!path.ok) return path;
  const parsed = consoleOutputSchema.safeParse(output);
  if (!parsed.success) return { ok: false, error: "The API console's response couldn't be read." };
  const answer = parsed.data;
  if (!answer.ok) return answer;

  // A hook may refuse the call (blockTools) or rewrite the response (redact).
  let refused = true;
  const result = await hooks
    .for(principal.org.host)
    .call(
      { name: OPEN_IN_API_CONSOLE, arguments: { path: path.path } },
      { principal },
      async () => {
        refused = false;
        return {
          isError: answer.status >= 400,
          content: [{ type: 'text', text: answer.response }],
        };
      },
    );
  const text = result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n');
  // The admin still sees it in the console; only the model doesn't get it.
  if (refused) return { ok: false, error: text };
  const next = answer.next ? checkApiPath(answer.next) : undefined;
  return {
    ok: true,
    path: path.path,
    status: answer.status,
    response: text.slice(0, MAX_RESPONSE_CHARS),
    ...(text.length > MAX_RESPONSE_CHARS && { truncated: true as const }),
    ...(next?.ok && { next: next.path }),
  };
}
