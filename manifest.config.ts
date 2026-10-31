import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json';

// The admin console lives at https://{org}-admin.{okta domain}/admin/...
const icons = {
  16: 'icons/icon-16.png',
  32: 'icons/icon-32.png',
  48: 'icons/icon-48.png',
  128: 'icons/icon-128.png',
};

const adminConsoleMatches = [
  'https://*.okta.com/admin/*',
  'https://*.oktapreview.com/admin/*',
  'https://*.okta-emea.com/admin/*',
  'https://*.okta-gov.com/admin/*',
];

export default defineManifest({
  manifest_version: 3,
  name: 'Okta Max',
  description: pkg.description,
  version: pkg.version,
  icons,
  permissions: ['storage'],
  action: {
    default_icon: icons,
    default_popup: 'src/popup/index.html',
    default_title: 'Okta Max',
  },
  content_scripts: [
    {
      matches: adminConsoleMatches,
      js: ['src/content/theme.ts'],
      run_at: 'document_start',
    },
    {
      matches: adminConsoleMatches,
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
    },
  ],
});
