/**
 * Okta's MCP server for the on-device assistant: an MCP client in the service
 * worker, connected to okta-mcp-server running on Pyodide in an offscreen
 * document (`src/offscreen/`).
 *
 * The same read-only limits as the chat server's gateway apply: the token only
 * has read scopes, OKTA_SCOPES is limited to them so the server drops its write
 * tools, and only `list_*`/`get_*` tools are handed to the model.
 */
import {
  createMCPClient,
  type JSONRPCMessage,
  type MCPClient,
  type MCPTransport,
} from '@ai-sdk/mcp';

import { OKTA_SCOPES } from '@oktamax/shared';

import {
  MCP_PORT,
  type McpPortRequest,
  type McpPortResponse,
  type OktaMcpEnv,
} from '../offscreen/messages';
import type { AuthConfig } from './auth';

/** Same rule as the chat server's gateway (`server/src/mcp/gateway.ts`). */
export const isReadOnlyTool = (name: string) =>
  /^(list|get)_/.test(name) && name !== 'get_scope_status';

const OFFSCREEN_PATH = 'src/offscreen/index.html';

/** Opens the offscreen document for `env`, replacing one started with a different org or scopes. */
async function openOffscreen(env: OktaMcpEnv) {
  const url = chrome.runtime.getURL(`${OFFSCREEN_PATH}?${new URLSearchParams({ ...env })}`);
  const [existing] = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing?.documentUrl === url) return;
  if (existing) await chrome.offscreen.closeDocument();
  await chrome.offscreen.createDocument({
    url,
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Runs Okta's MCP server (Python, on WebAssembly) for the on-device assistant.",
  });
}

// Only one offscreen document can exist: open them one at a time.
let opening = Promise.resolve();
const ensureOffscreen = (env: OktaMcpEnv) =>
  (opening = opening.catch(() => undefined).then(() => openOffscreen(env)));

/** An MCP transport over a port to the offscreen document; the token goes first. */
function portTransport(token: string): MCPTransport {
  let port: chrome.runtime.Port | undefined;
  const transport: MCPTransport = {
    async start() {
      port = chrome.runtime.connect({ name: MCP_PORT });
      port.onMessage.addListener((message: McpPortResponse) => {
        if (message.type === 'message') {
          transport.onmessage?.(JSON.parse(message.json) as JSONRPCMessage);
        } else transport.onerror?.(new Error(message.message));
      });
      port.onDisconnect.addListener(() => {
        port = undefined;
        transport.onclose?.();
      });
      port.postMessage({ type: 'token', token } satisfies McpPortRequest);
    },
    async send(message) {
      if (!port) throw new Error("Okta's MCP server isn't connected");
      port.postMessage({ type: 'message', json: JSON.stringify(message) } satisfies McpPortRequest);
    },
    async close() {
      port?.disconnect();
      port = undefined;
      transport.onclose?.();
    },
  };
  return transport;
}

const mcpEnv = (config: AuthConfig): OktaMcpEnv => ({
  OKTA_ORG_URL: config.oktaOrgUrl,
  OKTA_CLIENT_ID: config.oktaClientId,
  OKTA_SCOPES: OKTA_SCOPES.filter((s) => s !== 'openid').join(' '),
});

/** Starts Okta's MCP server early, so Python has loaded by the first question. */
export const prepareOktaMcp = (config: AuthConfig) => ensureOffscreen(mcpEnv(config));

/** An MCP client for this admin's Okta MCP server, started if it isn't running. */
export async function connectOktaMcp(config: AuthConfig, token: string): Promise<MCPClient> {
  await ensureOffscreen(mcpEnv(config));
  return createMCPClient({ transport: portTransport(token) });
}
