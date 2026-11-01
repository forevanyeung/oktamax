/**
 * Tools that act on the admin's page rather than on Okta. They only check their
 * input here; the extension sees the call in the reply and carries it out.
 */
import { tool } from 'ai';
import * as z from 'zod';

import {
  checkAdminPath,
  checkApiPath,
  NAVIGATE,
  OPEN_IN_API_CONSOLE,
  type PageToolOutput,
} from '@oktamax/shared/pageTools';

const input = z.object({ path: z.string().max(2_000) });

export const pageTools = {
  [OPEN_IN_API_CONSOLE]: tool({
    description: `Open a GET request in the API console, a drawer at the bottom of the admin's page, and send it there, so the admin gets the full response with paging, a table view and CSV export.

Use it when the admin asks to see, bring up, show or export data rather than for an answer: "bring up the logs for…", "show me all users in…". Pass the same path you'd query, with filters, e.g. /api/v1/logs?filter=eventType eq "user.authentication.sso" and target.id eq "0oa…"&since=2026-11-01T00:00:00Z. It's sent with the admin's console session. Still say in your answer what you opened.`,
    inputSchema: input,
    execute: async ({ path }): Promise<PageToolOutput> => checkApiPath(path),
  }),
  [NAVIGATE]: tool({
    description: `Take the admin to a page of the admin console. It loads the page in their tab; the conversation carries on there.

Use it when the admin asks to go to, open or be taken to something. Paths, with IDs from your lookups:
- /admin/user/profile/view/{userId}
- /admin/group/{groupId}
- /admin/app/{appName}/instance/{appId}/ (appName is the app's "name", e.g. okta_org2org)
- /admin/users, /admin/groups, /admin/apps/active
- /admin/access/networks, /admin/authn/authentication-policies, /admin/access/policies (global session policy), /admin/access/authenticators
- /report/system_log_2 (the System Log; for filtered logs, use ${OPEN_IN_API_CONSOLE} with /api/v1/logs instead)
Don't guess other paths.`,
    inputSchema: input,
    execute: async ({ path }): Promise<PageToolOutput> => checkAdminPath(path),
  }),
};
