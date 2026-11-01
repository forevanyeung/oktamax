/**
 * Background service worker.
 *
 * - Holds the Okta access token for the chat server (content scripts never see it).
 * - Relays the chat's HTTP requests to the chat server, adding the token and
 *   streaming the response back over a port. Only requests to the configured
 *   chat server get a token.
 * - In dev builds, answers them from a mock when no chat server is reachable.
 * - With the on-device assistant, answers them itself (`localChat.ts`).
 */
import type { ServerConfig } from '@oktamax/shared';

import { onDeviceModel } from '../onDeviceModel';
import { loadSettings, ON_DEVICE_CHAT_URL } from '../settings';
import { clearAccessToken, getAccessToken } from './auth';
import { createLocalChat } from './localChat';
import {
  FETCH_PORT,
  type AuthStatus,
  type BridgeRequest,
  type BridgeResponse,
  type WorkerRequest,
} from './messages';
import { mockChat } from './mockChat';
import { prepareOktaMcp } from './oktaMcp';

const configCache = new Map<string, Promise<ServerConfig>>();

async function fetchConfig(serverUrl: string): Promise<ServerConfig> {
  const res = await fetch(new URL('/api/config', serverUrl));
  if (!res.ok) throw new Error(`Chat server returned ${res.status}`);
  return (await res.json()) as ServerConfig;
}

async function serverConfig(): Promise<{ serverUrl: string; config: ServerConfig } | undefined> {
  const { chatServerUrl, assistant, oktaOrgUrl, oktaClientId } = await loadSettings();
  if (assistant === 'onDevice') {
    if (!oktaOrgUrl || !oktaClientId) return undefined;
    return { serverUrl: ON_DEVICE_CHAT_URL, config: { oktaOrgUrl, oktaClientId } };
  }
  if (!chatServerUrl) return undefined;
  let config = configCache.get(chatServerUrl);
  if (!config) {
    config = fetchConfig(chatServerUrl);
    configCache.set(chatServerUrl, config);
    config.catch(() => configCache.delete(chatServerUrl)); // retry next time
  }
  return { serverUrl: chatServerUrl, config: await config };
}

async function authStatus(interactive: boolean): Promise<AuthStatus> {
  let server: Awaited<ReturnType<typeof serverConfig>>;
  try {
    server = await serverConfig();
  } catch (error) {
    if (import.meta.env.DEV) return { state: 'mock' };
    const { chatServerUrl } = await loadSettings();
    return { state: 'unreachable', serverUrl: chatServerUrl, error: String(error) };
  }
  if (!server) return { state: 'off' };
  const { oktaOrgUrl } = server.config;
  const onDevice = server.serverUrl === ON_DEVICE_CHAT_URL;
  if (onDevice) {
    const availability = await onDeviceModel().availability();
    if (availability !== 'available')
      return { state: 'modelUnavailable', oktaOrgUrl, availability };
  }
  try {
    await getAccessToken(server.config, interactive);
    return { state: 'signedIn', oktaOrgUrl, onDevice };
  } catch (error) {
    return { state: 'signedOut', oktaOrgUrl, error: String(error) };
  }
}

chrome.runtime.onMessage.addListener((message: WorkerRequest, _sender, sendResponse) => {
  if (message.type === 'oktamax:authStatus') void authStatus(false).then(sendResponse);
  else if (message.type === 'oktamax:signIn') void authStatus(true).then(sendResponse);
  else return false;
  return true; // respond asynchronously
});

const localChat = createLocalChat(async () => {
  const server = await serverConfig();
  if (!server) throw new Error('The on-device assistant is turned off');
  return { config: server.config, token: await getAccessToken(server.config, false) };
});

/** The chat server's response to `request`, with the admin's token added. */
async function forward(request: BridgeRequest, signal: AbortSignal): Promise<Response> {
  let server: Awaited<ReturnType<typeof serverConfig>>;
  try {
    server = await serverConfig();
  } catch (error) {
    if (import.meta.env.DEV) return mockChat(request);
    throw error;
  }
  if (!server || new URL(request.url).origin !== new URL(server.serverUrl).origin) {
    throw new Error('Request is not for the configured chat server');
  }
  if (server.serverUrl === ON_DEVICE_CHAT_URL) {
    // Like the chat server, start Okta's MCP server when the chat opens, before the first question.
    void prepareOktaMcp(server.config).catch((error) => console.error('[okta-mcp]', error));
    return localChat(request);
  }

  let token: string;
  try {
    token = await getAccessToken(server.config, false);
  } catch {
    return Response.json({ error: 'signin_required' }, { status: 401 });
  }

  const res = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers, Authorization: `Bearer ${token}` },
    body: request.body,
    signal,
  });
  if (res.status === 401) await clearAccessToken();
  return res;
}

async function relay(
  request: BridgeRequest,
  post: (m: BridgeResponse) => void,
  signal: AbortSignal,
) {
  const res = await forward(request, signal);
  post({ type: 'head', status: res.status, statusText: res.statusText, headers: [...res.headers] });
  if (res.body) {
    const decoder = new TextDecoder();
    for await (const bytes of res.body) {
      post({ type: 'chunk', text: decoder.decode(bytes, { stream: true }) });
    }
  }
  post({ type: 'end' });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== FETCH_PORT || port.sender?.id !== chrome.runtime.id) return;

  // Closing the port (page navigated, request aborted) cancels the upstream request.
  const abort = new AbortController();
  let open = true;
  port.onDisconnect.addListener(() => {
    open = false;
    abort.abort();
  });
  const post = (message: BridgeResponse) => open && port.postMessage(message);

  port.onMessage.addListener((request: BridgeRequest) => {
    relay(request, post, abort.signal)
      .catch((error: unknown) => {
        if (!abort.signal.aborted) post({ type: 'error', message: String(error) });
      })
      .finally(() => open && port.disconnect());
  });
});
