/**
 * Offscreen document that runs Okta's MCP server (okta/okta-mcp-server, Python)
 * on Pyodide, for the on-device assistant: no chat server, no Python install.
 *
 * Pyodide and every wheel are bundled with the extension (`npm run pyodide`
 * puts them in public/pyodide/). The service worker opens a port per MCP
 * session and sends the admin's current token over it, which the server reads
 * through a keyring backend, as it does on the chat server. The server calls
 * Okta with the extension's host permissions, through `fetch`.
 */
import type { PyodideAPI } from 'pyodide';
import type { PyProxy } from 'pyodide/ffi';

import { MCP_PORT, type McpPortRequest, type McpPortResponse, type OktaMcpEnv } from './messages';
import bridge from './python/oktamax_bridge.py?raw';
import fetchPatch from './python/oktamax_fetch.py?raw';
import stubs from './python/oktamax_stubs.py?raw';

const env = Object.fromEntries(new URLSearchParams(location.search)) as unknown as OktaMcpEnv;

/** The admin's token, as of the latest message from the worker. */
let token = '';

async function loadServer(): Promise<PyProxy> {
  const base = chrome.runtime.getURL('pyodide/');
  // Loaded from the extension package rather than bundled: it finds its .wasm next to itself.
  const { loadPyodide } = (await import(/* @vite-ignore */ `${base}pyodide.mjs`)) as {
    loadPyodide: (options: object) => Promise<PyodideAPI>;
  };
  const pyodide = await loadPyodide({ indexURL: base, lockFileURL: `${base}pyodide-lock.json` });
  const packages = (await (await fetch(`${base}packages.json`)).json()) as string[];
  await pyodide.loadPackage(packages, { messageCallback: () => {} });

  for (const [name, source] of Object.entries({
    oktamax_bridge: bridge,
    oktamax_fetch: fetchPatch,
    oktamax_stubs: stubs,
  })) {
    pyodide.FS.writeFile(`/home/pyodide/${name}.py`, source);
  }
  const module = pyodide.pyimport('oktamax_bridge');
  module.load(pyodide.toPy({ ...env, OKTA_LOG_LEVEL: 'WARNING' }), () => token);
  return module;
}

const server = loadServer();
server.catch((error: unknown) => console.error('[okta-mcp]', error));

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== MCP_PORT || port.sender?.id !== chrome.runtime.id) return;
  const post = (message: McpPortResponse) => port.postMessage(message);
  let session: Promise<PyProxy> | undefined;

  port.onMessage.addListener((message: McpPortRequest) => {
    if (message.type === 'token') {
      token = message.token;
      // The server checks the token as the session starts (without one, it starts its
      // own sign-in), so start it once the token is here.
      session ??= server.then((module) =>
        module.Session((json: string) => post({ type: 'message', json })),
      );
      session.catch((error: unknown) => {
        post({ type: 'error', message: `Okta's MCP server didn't start: ${String(error)}` });
        port.disconnect();
      });
    } else void session?.then((s) => s.receive(message.json));
  });
  port.onDisconnect.addListener(() => void session?.then((s) => (s.close(), s.destroy())));
});
