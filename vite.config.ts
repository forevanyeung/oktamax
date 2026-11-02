import { defineConfig } from 'vite-plus';

// Workspace-wide lint/format settings. Each package has its own vite.config.ts for build/test.
export default defineConfig({
  lint: {
    ignorePatterns: ['**/dist/**'],
  },
  fmt: {
    // Written by `npm run endpoints -w @oktamax/extension`.
    ignorePatterns: ['extension/src/console/endpoints.json'],
    semi: true,
    singleQuote: true,
    printWidth: 100,
  },
});
