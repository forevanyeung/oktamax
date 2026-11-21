/**
 * The extension's DevTools page: Chrome loads it, without a panel, whenever
 * DevTools opens on a tab, and only it can read that tab's Network log. It
 * answers the API console's lookups of past responses (`console/network.ts`)
 * for the tab it inspects.
 */
import {
  REQUEST_ID_HEADER,
  type NetworkEntry,
  type NetworkLookup,
  type NetworkLookupResult,
} from '../console/network';

const header = REQUEST_ID_HEADER.toLowerCase();

const getHAR = () =>
  new Promise<HARFormatLog>((resolve) => chrome.devtools.network.getHAR(resolve));

const getContent = (request: chrome.devtools.network.Request) =>
  new Promise<{ content: string; encoding: string }>((resolve) =>
    request.getContent((content, encoding) => resolve({ content, encoding })),
  );

/** Base64 bodies (Chrome's choice for some content types) decoded as UTF-8. */
const decode = ({ content, encoding }: { content: string; encoding: string }) =>
  encoding === 'base64'
    ? new TextDecoder().decode(Uint8Array.from(atob(content), (c) => c.charCodeAt(0)))
    : (content ?? '');

/** The latest request in the log tagged `id`: a step-up sends the same request again. */
async function find(id: string): Promise<NetworkLookupResult> {
  const { entries } = await getHAR();
  const entry = entries.findLast((e) =>
    e.request.headers.some((h) => h.name.toLowerCase() === header && h.value === id),
  ) as chrome.devtools.network.Request | undefined;
  if (!entry) return null;
  const { response } = entry;
  const result: NetworkEntry = {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers.map((h) => [h.name, h.value]),
    text: decode(await getContent(entry)),
    ms: Math.round(entry.time),
  };
  return result;
}

chrome.runtime.onMessage.addListener((message: NetworkLookup, sender, sendResponse) => {
  if (
    message.type !== 'oktamax:networkResponse' ||
    sender.id !== chrome.runtime.id ||
    // Every open DevTools page hears this; only the one inspecting the sender's tab answers.
    sender.tab?.id !== chrome.devtools.inspectedWindow.tabId
  ) {
    return false;
  }
  find(message.id).then(sendResponse, () => sendResponse(null));
  return true; // respond asynchronously
});
