/**
 * Minimal, GET-only client for the Okta Management API.
 *
 * The content script runs on the admin console origin, so requests carry the
 * admin's session cookie – exactly like the admin console's own calls. There
 * is intentionally no way to send anything other than GET from this extension.
 */

export class OktaApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<
  string,
  { at: number; response: Promise<{ body: unknown; next?: string }> }
>();

async function request(url: string): Promise<{ body: unknown; next?: string }> {
  const res = await fetch(new URL(url, location.origin), {
    method: 'GET',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => undefined);
    const summary = (detail as { errorSummary?: string } | undefined)?.errorSummary;
    throw new OktaApiError(res.status, url, summary ?? `${res.status} ${res.statusText}`);
  }
  return { body: await res.json(), next: nextLink(res.headers.get('link')) };
}

/** Okta paginates with `Link: <url>; rel="next"` headers. */
export function nextLink(header: string | null): string | undefined {
  const match = header?.split(',').find((part) => /rel="next"/.test(part));
  return match?.match(/<([^>]+)>/)?.[1];
}

/** GET with a short-lived cache, so repeated DOM scans don't refetch. */
function cachedRequest(url: string) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.response;

  const response = request(url);
  cache.set(url, { at: Date.now(), response });
  response.catch(() => cache.delete(url));
  return response;
}

export async function get<T>(path: string): Promise<T> {
  return (await cachedRequest(path)).body as T;
}

/** GET a list endpoint and follow every `next` page. */
export async function getAll<T>(path: string): Promise<T[]> {
  const items: T[] = [];
  let url: string | undefined = path;
  while (url) {
    const page = await cachedRequest(url);
    items.push(...(page.body as T[]));
    url = page.next;
  }
  return items;
}
