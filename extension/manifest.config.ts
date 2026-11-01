import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json';

const icons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

// The admin console lives at https://{org}-admin.{okta domain}/, mostly under
// /admin/ but not all of it (Reports, the System Log). Match patterns only allow a
// wildcard at the start of the host, so `include_globs` narrows them to `-admin`.
const oktaDomains = ['okta.com', 'oktapreview.com', 'okta-emea.com', 'okta-gov.com'];
const adminConsole = {
  matches: oktaDomains.map((domain) => `https://*.${domain}/*`),
  include_globs: oktaDomains.map((domain) => `https://*-admin.${domain}/*`),
};

export default defineManifest({
  manifest_version: 3,
  name: 'Okta Max',
  description: pkg.description,
  version: pkg.version,
  icons,
  // identity: Okta sign-in for the chat server. storage: settings and chat state.
  permissions: ['storage', 'identity'],
  host_permissions: [
    // Token exchange with the Okta org authorization server.
    'https://*.okta.com/*',
    'https://*.oktapreview.com/*',
    'https://*.okta-emea.com/*',
    'https://*.okta-gov.com/*',
    // Local chat server during development.
    'http://localhost/*',
  ],
  // The chat server's origin, requested from the popup when it's configured.
  optional_host_permissions: ['https://*/*'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  action: {
    default_icon: icons,
    default_popup: 'src/popup/index.html',
    default_title: 'Okta Max',
  },
  content_scripts: [
    {
      ...adminConsole,
      js: ['src/content/pageWorld.iife.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      ...adminConsole,
      js: ['src/content/theme.iife.ts'],
      run_at: 'document_start',
    },
    {
      ...adminConsole,
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
    },
  ],
});
