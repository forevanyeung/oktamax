/**
 * Vendors Pyodide and okta-mcp-server into public/pyodide/, for the on-device
 * assistant (src/offscreen/). The extension loads every file from its own
 * package: nothing is downloaded at runtime.
 *
 * Resolves okta-mcp-server's dependencies with micropip (under Node), then
 * copies Pyodide's runtime and downloads each wheel, and writes a lock file
 * listing only those packages. Okta's SDK imports pycryptodomex and jwcrypto
 * for private-key sign-in, which has no Pyodide build and which the extension
 * never uses, so they're installed as empty mocks here and stubbed at runtime
 * (src/offscreen/python/oktamax_stubs.py).
 *
 *   npm run pyodide -w @oktamax/extension
 *
 * `vp build` runs it with --if-missing, so a fresh checkout builds a working
 * extension; run it without to update.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPyodide } from 'pyodide';

/** Pinned, like the server's: the bridge relies on its tool modules and keyring use. */
export const OKTA_MCP_SERVER = 'okta-mcp-server==1.1.7';
const MOCKED = ['pycryptodomex', 'jwcrypto'];

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'public', 'pyodide');
const pyodideDir = dirname(createRequire(import.meta.url).resolve('pyodide/package.json'));

if (process.argv.includes('--if-missing') && existsSync(join(out, 'packages.json')))
  process.exit(0);

const pyodide = await loadPyodide({ stdout: () => {}, stderr: () => {} });
await pyodide.loadPackage('micropip', { messageCallback: () => {} });
const lock = JSON.parse(
  await pyodide.runPythonAsync(`
import micropip
for name in ${JSON.stringify(MOCKED)}:
    micropip.add_mock_package(name, "99")  # satisfies any version the SDK asks for
await micropip.install(${JSON.stringify(OKTA_MCP_SERVER)})
micropip.freeze()
`),
);

const installed = pyodide
  .runPython('import micropip; list(micropip.list().keys())')
  .toJs()
  .map((name) => name.toLowerCase().replace(/_/g, '-'));
const keep = new Set(installed.filter((name) => name !== 'micropip' && !MOCKED.includes(name)));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const file of ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip']) {
  await copyFile(join(pyodideDir, file), join(out, file));
}

const packages = {};
for (const [name, pkg] of Object.entries(lock.packages)) {
  if (!keep.has(name)) continue;
  const file = basename(new URL(pkg.file_name, 'file:///').pathname);
  // Wheels from PyPI have a full URL; Pyodide's own packages come from its CDN.
  const url = /^https?:/.test(pkg.file_name)
    ? pkg.file_name
    : `https://cdn.jsdelivr.net/pyodide/v${pyodide.version}/full/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  await writeFile(join(out, file), new Uint8Array(await res.arrayBuffer()));
  packages[name] = {
    ...pkg,
    file_name: file,
    depends: pkg.depends.filter((dep) => !MOCKED.includes(dep)),
  };
}

await writeFile(join(out, 'pyodide-lock.json'), JSON.stringify({ ...lock, packages }));
await writeFile(join(out, 'packages.json'), JSON.stringify(Object.keys(packages).sort()));
console.log(
  `Vendored Pyodide ${pyodide.version} and ${Object.keys(packages).length} packages into ${out}`,
);
process.exit(0);
