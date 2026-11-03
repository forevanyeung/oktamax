/** Messages between the service worker and the offscreen document running Okta's MCP server. */

export const MCP_PORT = 'oktamax:mcp';

/** What the server is started with; a change restarts the offscreen document. */
export interface OktaMcpEnv {
  OKTA_ORG_URL: string;
  /** Read scopes: okta-mcp-server drops tools for any others at startup. */
  OKTA_SCOPES: string;
}

/** An Okta API request from the server, sent from the admin console with the admin's session. */
export interface OktaRequest {
  url: string;
  method: string;
}

export type OktaResponse =
  | {
      status: number;
      statusText: string;
      url: string;
      headers: Array<[string, string]>;
      body: string;
    }
  | { error: string };

/** Worker → offscreen, over an `MCP_PORT` port: one port per MCP session. */
export type McpPortRequest =
  | { type: 'message'; json: string }
  | { type: 'oktaResponse'; id: number; response: OktaResponse };

/** Offscreen → worker. */
export type McpPortResponse =
  /** The session has started: MCP messages can flow. */
  | { type: 'ready' }
  | { type: 'message'; json: string }
  | { type: 'oktaRequest'; id: number; request: OktaRequest }
  | { type: 'error'; message: string };
