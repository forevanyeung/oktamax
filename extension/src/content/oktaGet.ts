/**
 * Sends the on-device assistant's Okta API requests from the admin console, with
 * the admin's session, like the console's own calls (and `okta/api.ts`). The
 * service worker asks for them on behalf of Okta's MCP server, which has no
 * access token of its own.
 *
 * Only GETs under /api/, and without Okta's XSRF token, so nothing sent from
 * here can change the org, whatever the MCP server asks for.
 */
import type { TabRequest } from '../background/messages';
import type { OktaResponse } from '../offscreen/messages';

async function oktaGet(path: string): Promise<OktaResponse> {
  const url = new URL(path, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
    return { error: `Not an Okta API path: ${path}` };
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    return {
      status: res.status,
      statusText: res.statusText,
      url: res.url,
      headers: [...res.headers],
      body: await res.text(),
    };
  } catch (error) {
    return { error: String(error) };
  }
}

export function answerOktaGets() {
  chrome.runtime.onMessage.addListener((message: TabRequest, sender, sendResponse) => {
    if (message.type !== 'oktamax:oktaGet' || sender.id !== chrome.runtime.id) return false;
    void oktaGet(message.path).then(sendResponse);
    return true; // respond asynchronously
  });
}
