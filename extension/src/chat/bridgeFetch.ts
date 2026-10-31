/**
 * A `fetch` that runs in the background service worker instead of the page.
 *
 * Keeps the access token out of the page, and sidesteps the admin console's
 * CORS/CSP rules. Responses stream back over a port, so the AI SDK's streaming
 * works unchanged.
 */
import { FETCH_PORT, type BridgeRequest, type BridgeResponse } from '../background/messages';

export const bridgeFetch: typeof fetch = (input, init = {}) =>
  new Promise((resolve, reject) => {
    const request = new Request(input, init);
    const port = chrome.runtime.connect({ name: FETCH_PORT });
    const signal = init.signal ?? undefined;

    let body: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    const fail = (error: Error) => {
      reject(error);
      body?.error(error);
    };

    signal?.addEventListener('abort', () => {
      port.disconnect();
      fail(new DOMException('Aborted', 'AbortError'));
    });
    port.onDisconnect.addListener(() => {
      try {
        body?.close();
      } catch {
        // already closed or errored
      }
    });

    port.onMessage.addListener((message: BridgeResponse) => {
      switch (message.type) {
        case 'head': {
          const stream = new ReadableStream<Uint8Array>({ start: (c) => void (body = c) });
          const nullBody = message.status === 204 || message.status === 304;
          resolve(
            new Response(nullBody ? null : stream, {
              status: message.status,
              statusText: message.statusText,
              headers: message.headers,
            }),
          );
          break;
        }
        case 'chunk':
          body?.enqueue(encoder.encode(message.text));
          break;
        case 'end':
          body?.close();
          body = undefined;
          break;
        case 'error':
          fail(new Error(message.message));
          break;
      }
    });

    void (async () => {
      const outgoing: BridgeRequest = {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers),
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text(),
      };
      port.postMessage(outgoing);
    })();
  });
