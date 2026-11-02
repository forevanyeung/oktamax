/**
 * Okta's MCP server for the on-device assistant: an MCP client in the service
 * worker, connected to okta-mcp-server running on Pyodide in an offscreen
 * document (`src/offscreen/`). The server's Okta requests are sent by the admin
 * console tab the chat is on, with the admin's session (`content/oktaGet.ts`).
 *
 * The session has the admin's full rights, so the server is kept to reading at
 * every step: OKTA_SCOPES only has read scopes, so it drops its write tools;
 * only `list_*`/`get_*` tools are handed to the model (as on the chat server's
 * gateway); only GETs to the tab's org are passed on; and the tab only sends
 * GETs, without the XSRF token Okta wants for changes.
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
  type OktaRequest,
  type OktaResponse,
} from '../offscreen/messages';
import type { AdminTab, TabRequest } from './messages';

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

/** Has `tab` send the server's request, if it's a GET to the tab's org. */
async function sendFromTab(tab: AdminTab, request: OktaRequest): Promise<OktaResponse> {
  const url = new URL(request.url);
  const org = new URL(tab.oktaOrgUrl);
  // The SDK builds URLs on the org; the next page's link is on the admin console.
  const hosts = [org.host, org.host.replace(/^([^.]+)/, '$1-admin')];
  if (request.method !== 'GET' || !hosts.includes(url.host)) {
    return { error: `Only reads from ${org.origin} are allowed (${request.method} ${url.origin})` };
  }
  try {
    const response = await chrome.tabs.sendMessage<TabRequest, OktaResponse | undefined>(
      tab.tabId,
      { type: 'oktamax:oktaGet', path: url.pathname + url.search },
      { frameId: 0 },
    );
    return response ?? { error: "The admin console tab didn't answer" };
  } catch (error) {
    return { error: `The admin console tab is gone: ${String(error)}` };
  }
}

/** An MCP transport over a port to the offscreen document; `tab` sends the server's Okta requests. */
function portTransport(tab: AdminTab): MCPTransport {
  let port: chrome.runtime.Port | undefined;
  const transport: MCPTransport = {
    async start() {
      port = chrome.runtime.connect({ name: MCP_PORT });
      port.onMessage.addListener((message: McpPortResponse) => {
        if (message.type === 'message') {
          transport.onmessage?.(JSON.parse(message.json) as JSONRPCMessage);
        } else if (message.type === 'oktaRequest') {
          void sendFromTab(tab, message.request).then((response) =>
            port?.postMessage({
              type: 'oktaResponse',
              id: message.id,
              response,
            } satisfies McpPortRequest),
          );
        } else transport.onerror?.(new Error(message.message));
      });
      port.onDisconnect.addListener(() => {
        port = undefined;
        transport.onclose?.();
      });
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

const mcpEnv = (oktaOrgUrl: string): OktaMcpEnv => ({
  OKTA_ORG_URL: oktaOrgUrl,
  OKTA_SCOPES: OKTA_SCOPES.filter((s) => s !== 'openid').join(' '),
});

/** Starts Okta's MCP server for an org early, so Python has loaded by the first question. */
export const prepareOktaMcp = (oktaOrgUrl: string) => ensureOffscreen(mcpEnv(oktaOrgUrl));

/** An MCP client for Okta's MCP server, started for the tab's org if it isn't running. */
export async function connectOktaMcp(tab: AdminTab): Promise<MCPClient> {
  await ensureOffscreen(mcpEnv(tab.oktaOrgUrl));
  return createMCPClient({ transport: portTransport(tab) });
}
