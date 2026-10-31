import { defineConfig } from 'vite-plus';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    env: { OKTA_ORG_URL: 'https://acme.okta.com', OKTA_CLIENT_ID: '0oatestclient' },
  },
});
