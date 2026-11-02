/**
 * Offscreen document that runs Okta's MCP server (okta/okta-mcp-server, Python)
 * on Pyodide, for the on-device assistant: no chat server, no Python install.
 *
 * Pyodide and every wheel are bundled with the extension (`npm run pyodide`
 * puts them in public/pyodide/). The service worker opens a port per MCP
 * session. The server's Okta requests go back over that port, and the worker
 * has the admin console tab the chat is on send them, with the admin's session:
 * there's no access token.
 */
import type { PyodideAPI } from 'pyodide';
import type { PyProxy } from 'pyodide/ffi';

import {
  MCP_PORT,
  type McpPortRequest,
  type McpPortResponse,
  type OktaMcpEnv,
  type OktaResponse,
} from './messages';
import bridge from './python/oktamax_bridge.py?raw';
import fetchPatch from './python/oktamax_fetch.py?raw';
import stubs from './python/oktamax_stubs.py?raw';

const env = Object.fromEntries(new URLSearchParams(location.search)) as unknown as OktaMcpEnv;

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
  module.load(pyodide.toPy({ ...env, OKTA_LOG_LEVEL: 'WARNING' }));
  return module;
}

const server = loadServer();
server.catch((error: unknown) => console.error('[okta-mcp]', error));

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== MCP_PORT || port.sender?.id !== chrome.runtime.id) return;
  const post = (message: McpPortResponse) => port.postMessage(message);

  // The server's Okta requests, waiting for the worker's answer.
  const pending = new Map<number, (response: OktaResponse) => void>();
  let nextId = 0;
  const fetchOkta = (json: string) =>
    new Promise<string>((resolve) => {
      const id = nextId++;
      pending.set(id, (response) => resolve(JSON.stringify(response)));
      post({ type: 'oktaRequest', id, request: JSON.parse(json) });
    });

  const session = server.then((module) =>
    module.Session((json: string) => post({ type: 'message', json }), fetchOkta),
  );
  session.then(
    () => post({ type: 'ready' }),
    (error: unknown) => {
      console.error('[okta-mcp]', error);
      post({ type: 'error', message: `Okta's MCP server didn't start: ${String(error)}` });
      port.disconnect();
    },
  );

  port.onMessage.addListener((message: McpPortRequest) => {
    if (message.type === 'oktaResponse') {
      pending.get(message.id)?.(message.response);
      pending.delete(message.id);
    } else void session.then((s) => s.receive(message.json));
  });
  port.onDisconnect.addListener(() => {
    for (const resolve of pending.values()) resolve({ error: 'The MCP session ended' });
    void session.then((s) => (s.close(), s.destroy()));
  });
});
