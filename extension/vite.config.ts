import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

import manifest from './manifest.config';

// Dark mode caches converted CSS across page loads; a new hash of its code drops
// CSS converted by older code. Not in dev, where the code changes without a restart.
const themeHash = (command: string) => {
  if (command === 'serve') return '';
  const hash = createHash('sha256');
  for (const file of readdirSync('src/theme')
    .filter((f) => f.endsWith('.ts'))
    .sort()) {
    hash.update(readFileSync(`src/theme/${file}`));
  }
  return hash.digest('hex').slice(0, 16);
};

export default defineConfig(({ command }) => ({
  plugins: [react(), crx({ manifest })],
  define: {
    __THEME_CACHE_KEY__: JSON.stringify(themeHash(command)),
  },
  server: {
    // A dev build loads its code from this port, so it mustn't move when the port is taken: fail
    // instead (set EXTENSION_DEV_PORT to run another checkout alongside, then reload the extension).
    port: Number(process.env.EXTENSION_DEV_PORT ?? 5273),
    strictPort: true,
    // CRXJS serves content scripts from the dev server during `vp dev`.
    cors: { origin: [/chrome-extension:\/\//] },
  },
  build: {
    // Everything ships inside the extension package, so large chunks don't cost network time.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      // Not in the manifest: the service worker opens it with chrome.offscreen.
      input: { offscreen: 'src/offscreen/index.html' },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
}));
