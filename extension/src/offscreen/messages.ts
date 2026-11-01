/** Messages between the service worker and the offscreen document running Okta's MCP server. */

export const MCP_PORT = 'oktamax:mcp';

/** What the server is started with; a change restarts the offscreen document. */
export interface OktaMcpEnv {
  OKTA_ORG_URL: string;
  OKTA_CLIENT_ID: string;
  /** Read scopes the admin's token has: okta-mcp-server drops tools for any others at startup. */
  OKTA_SCOPES: string;
}

/** Worker → offscreen, over an `MCP_PORT` port: one port per MCP session. */
export type McpPortRequest =
  /** Sent first, and again whenever the token is renewed. */
  { type: 'token'; token: string } | { type: 'message'; json: string };

/** Offscreen → worker. */
export type McpPortResponse =
  | { type: 'message'; json: string }
  | { type: 'error'; message: string };
