/**
 * Hosted, multi-user front door for Okta's MCP server, at POST /mcp/<org host>:
 * one MCP server per org, so a client connected to one org never gets another's
 * answers.
 *
 * Each request is authenticated against that org (see `auth.ts`), then served
 * by that admin's own okta-mcp-server process from the pool. On top of the read-only token
 * scopes, the gateway only exposes – and only forwards calls to – read tools.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

import type { Principal } from '../auth';
import type { OktaMcpProcessPool } from './processPool';

/**
 * Okta's tools follow a verb_noun convention; list_* and get_* only read.
 * get_scope_status is left out: its advice (edit OKTA_SCOPES, restart the
 * server) is for people running the server themselves.
 */
export const isReadOnlyTool = (name: string) =>
  /^(list|get)_/.test(name) && name !== 'get_scope_status';

/** Okta's server checks the token is valid for 60s more; leave margin for a whole chat turn. */
const MIN_TOKEN_LIFETIME_MS = 2 * 60_000;

/** `expiring` answers a token that's about to expire (by default, a plain 401). */
export async function handleMcpRequest(
  request: Request,
  principal: Principal,
  pool: OktaMcpProcessPool,
  expiring = () => Response.json({ error: 'token_expiring' }, { status: 401 }),
): Promise<Response> {
  if (principal.expiresAt * 1000 - Date.now() < MIN_TOKEN_LIFETIME_MS) return expiring();

  // Start (or reuse) the admin's Okta server only when a request actually needs it.
  let lease: ReturnType<OktaMcpProcessPool['acquire']> | undefined;
  const upstream = async () => (await (lease ??= pool.acquire(principal))).client;

  const server = new Server(
    { name: 'okta-readonly', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const client = await upstream();
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor });
      tools.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor);

    return {
      tools: tools
        .filter((tool) => isReadOnlyTool(tool.name))
        .map((tool) => ({
          ...tool,
          annotations: { ...tool.annotations, readOnlyHint: true, destructiveHint: false },
        })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (call) => {
    if (!isReadOnlyTool(call.params.name)) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `${call.params.name} is not available: this server is read-only.` },
        ],
      };
    }
    const client = await upstream();
    return client.callTool({ name: call.params.name, arguments: call.params.arguments });
  });

  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
    if (lease)
      void lease.then(
        (l) => l.release(),
        () => undefined,
      );
  }
}
