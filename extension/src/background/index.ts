/**
 * Background service worker.
 *
 * - Holds the Okta access token for the chat server (content scripts never see it).
 * - Relays the chat's HTTP requests to the chat server, adding the token and
 *   streaming the response back over a port. Only requests to the configured
 *   chat server get a token.
 */
import type { ServerConfig } from '@oktamax/shared';

import { loadSettings } from '../settings';
import { clearAccessToken, getAccessToken } from './auth';
import {
  FETCH_PORT,
  type AuthStatus,
  type BridgeRequest,
  type BridgeResponse,
  type WorkerRequest,
} from './messages';

const configCache = new Map<string, Promise<ServerConfig>>();

async function fetchConfig(serverUrl: string): Promise<ServerConfig> {
  const res = await fetch(new URL('/api/config', serverUrl));
  if (!res.ok) throw new Error(`Chat server returned ${res.status}`);
  return (await res.json()) as ServerConfig;
}

async function serverConfig(): Promise<{ serverUrl: string; config: ServerConfig } | undefined> {
  const { chatServerUrl } = await loadSettings();
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
  try {
    const server = await serverConfig();
    if (!server) return { configured: false, signedIn: false };
    try {
      await getAccessToken(server.config, interactive);
      return { configured: true, signedIn: true, oktaOrgUrl: server.config.oktaOrgUrl };
    } catch (error) {
      return {
        configured: true,
        signedIn: false,
        oktaOrgUrl: server.config.oktaOrgUrl,
        error: String(error),
      };
    }
  } catch {
    // Chat server unreachable: hide the chat rather than offer a sign-in that can't work.
    return { configured: false, signedIn: false };
  }
}

chrome.runtime.onMessage.addListener((message: WorkerRequest, _sender, sendResponse) => {
  if (message.type === 'oktamax:authStatus') void authStatus(false).then(sendResponse);
  else if (message.type === 'oktamax:signIn') void authStatus(true).then(sendResponse);
  else return false;
  return true; // respond asynchronously
});

const jsonHead = (status: number): BridgeResponse => ({
  type: 'head',
  status,
  statusText: '',
  headers: [['content-type', 'application/json']],
});

async function relay(
  request: BridgeRequest,
  post: (m: BridgeResponse) => void,
  signal: AbortSignal,
) {
  const server = await serverConfig();
  if (!server || new URL(request.url).origin !== new URL(server.serverUrl).origin) {
    post({ type: 'error', message: 'Request is not for the configured chat server' });
    return;
  }

  let token: string;
  try {
    token = await getAccessToken(server.config, false);
  } catch {
    post(jsonHead(401));
    post({ type: 'chunk', text: JSON.stringify({ error: 'signin_required' }) });
    post({ type: 'end' });
    return;
  }

  const res = await fetch(request.url, {
    method: request.method,
    headers: { ...request.headers, Authorization: `Bearer ${token}` },
    body: request.body,
    signal,
  });
  if (res.status === 401) await clearAccessToken();

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
