/**
 * Creates the chat's OIDC app in the live-test org (`server/scripts/create-okta-app.ts`),
 * signed in as the super admin from `.env` and calling the API with the admin
 * console's own session, so no API token is needed.
 *
 * Run: vpx e2e/create-okta-app.ts <extension-id>... [--group <group name>]
 */
import { parseArgs } from 'node:util';

import { createOktaApp, type OktaRequest } from '../../server/scripts/create-okta-app';
import { adminUrl, launch, signIn } from './okta';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { group: { type: 'string' } },
});
if (!positionals.length) {
  console.error('Usage: vpx e2e/create-okta-app.ts <extension-id>... [--group <name>]');
  process.exit(1);
}

const context = await launch('admin');
try {
  const page = await signIn(context, 'admin');
  const okta: OktaRequest = async (method, path, body) => {
    const result = await page.evaluate(
      async ({ method, path, body }) => {
        const xsrf = document.getElementById('_xsrfToken')?.textContent ?? '';
        const res = await fetch(path, {
          method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Okta-XsrfToken': xsrf,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
      },
      { method, path, body },
    );
    if (result.status >= 400) {
      throw new Error(`${method} ${path} → ${result.status}: ${JSON.stringify(result.body)}`);
    }
    return result.body;
  };

  const clientId = await createOktaApp(okta, {
    orgUrl: adminUrl.replace('-admin.', '.'),
    extensionIds: positionals,
    group: values.group,
  });
  console.log(`\nOKTA_CLIENT_ID=${clientId}`);
} finally {
  await context.close();
}
