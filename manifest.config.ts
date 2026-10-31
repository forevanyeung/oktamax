import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json';

// The admin console lives at https://{org}-admin.{okta domain}/admin/...
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
  permissions: ['storage'],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Okta Max',
  },
  content_scripts: [
    {
      matches: adminConsoleMatches,
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
    },
  ],
});
