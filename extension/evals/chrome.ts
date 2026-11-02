/**
 * Google Chrome (not Playwright's Chromium, which has no Gemini Nano) with the
 * built extension, driven by Playwright over the DevTools protocol.
 *
 * The user data directory is kept between runs, so Chrome's model is downloaded
 * once and the Okta session survives. Chrome won't allow remote debugging on
 * its default directory, and branded Chrome ignores --load-extension, so the
 * extension is loaded with `Extensions.loadUnpacked` instead.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Browser, type BrowserContext } from 'playwright';

const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export const userDataDir =
  process.env.EVAL_CHROME_PROFILE ?? join(homedir(), '.cache', 'oktamax-evals', 'chrome');

const extensionPath = resolve(import.meta.dirname, '../dist');

export interface EvalChrome {
  browser: Browser;
  context: BrowserContext;
  extensionId: string;
  close(): Promise<void>;
}

/** Sends one browser-level DevTools command over a WebSocket of its own. */
async function browserCommand(wsUrl: string, method: string, params: object): Promise<unknown> {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  try {
    return await new Promise((resolve, reject) => {
      ws.addEventListener('message', (event) => {
        const reply = JSON.parse(String(event.data)) as {
          id?: number;
          result?: unknown;
          error?: { message: string };
        };
        if (reply.id !== 1) return;
        if (reply.error) reject(new Error(`${method}: ${reply.error.message}`));
        else resolve(reply.result);
      });
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally {
    ws.close();
  }
}

export async function launchChrome(): Promise<EvalChrome> {
  if (!existsSync(CHROME)) throw new Error(`No Google Chrome at ${CHROME} (set CHROME_PATH)`);
  if (!existsSync(join(extensionPath, 'manifest.json'))) {
    throw new Error('Build the extension first: npm run build');
  }
  mkdirSync(userDataDir, { recursive: true });
  const portFile = join(userDataDir, 'DevToolsActivePort');
  rmSync(portFile, { force: true });

  const chrome = spawn(
    CHROME,
    [
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-port=0',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const exited = new Promise((resolve) => chrome.once('exit', resolve));

  for (let i = 0; i < 300 && !existsSync(portFile); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!existsSync(portFile)) {
    chrome.kill();
    throw new Error(`Chrome didn't start (is another Chrome using ${userDataDir}?)`);
  }
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const browserWs = `ws://127.0.0.1:${port}${path}`;
  const load = async () =>
    (
      (await browserCommand(browserWs, 'Extensions.loadUnpacked', { path: extensionPath })) as {
        id: string;
      }
    ).id;
  // The profile keeps the extension from the last run, and loading it again keeps that
  // version: install it afresh so the eval runs the current build.
  const extensionId = await load();
  await browserCommand(browserWs, 'Extensions.uninstall', { id: extensionId });
  await load();

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0]!;
  return {
    browser,
    context,
    extensionId,
    async close() {
      await browser.close().catch(() => {});
      chrome.kill();
      await exited;
    },
  };
}
