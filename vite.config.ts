import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

import manifest from './manifest.config';

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: {
    // CRXJS serves content scripts from the dev server during `vp dev`.
    cors: { origin: [/chrome-extension:\/\//] },
  },
  build: {
    // Everything ships inside the extension package, so large chunks don't cost network time.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**'],
  },
  fmt: {
    semi: true,
    singleQuote: true,
    printWidth: 100,
  },
});
