/**
 * Stand-in for okta-mcp-server in tests (run with Node over stdio). It mirrors
 * the behaviour the gateway relies on:
 *
 *   - the access token is read from the keyring on every call (here: the same
 *     OKTAMAX_TOKEN_FILE our Python keyring backend reads),
 *   - tools are registered according to OKTA_SCOPES at startup,
 *   - there are write tools (`create_user`) the gateway must never expose.
 *
 * `list_users` reports which token, org, process and HOME served it, so tests
 * can check admins (and orgs) are isolated from each other.
 */
import { readFileSync } from 'node:fs';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';

const scopes = new Set((process.env.OKTA_SCOPES ?? '').split(' '));
const token = () => readFileSync(process.env.OKTAMAX_TOKEN_FILE!, 'utf8');

const server = new McpServer({ name: 'fake-okta-mcp-server', version: '0.0.0' });
const json = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
});

if (scopes.has('okta.users.read')) {
  server.registerTool(
    'list_users',
    { description: 'List users', inputSchema: { search: z.string().optional() } },
    async ({ search }) =>
      json({
        users: [{ id: '00u1', profile: { login: 'locked@example.com' } }],
        search,
        servedBy: {
          token: token(),
          org: process.env.OKTA_ORG_URL,
          pid: process.pid,
          home: process.env.HOME,
        },
      }),
  );
}
if (scopes.has('okta.users.manage')) {
  server.registerTool('create_user', { description: 'Create a user' }, async () =>
    json({ created: true }),
  );
}
// Like Okta's: always registered, regardless of scopes.
server.registerTool('get_scope_status', { description: 'Scope status' }, async () => json({}));
server.registerTool('delete_everything', { description: 'Not read-only' }, async () =>
  json({ deleted: true }),
);

await server.connect(new StdioServerTransport());
