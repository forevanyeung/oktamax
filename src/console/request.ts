/**
 * Requests sent from the API console. Unlike `okta/api.ts`, which the views use
 * and which only GETs, this sends whatever method the admin picks, with their
 * session, to the org the console is open on.
 */
import { nextLink } from '../okta/api';

export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

export interface ApiRequest {
  method: Method;
  /** A path with an optional query string, e.g. `/api/v1/users?limit=5`. */
  url: string;
  body: string;
}

export interface ApiResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  text: string;
  /** The parsed body, if it is JSON. */
  json?: unknown;
  ms: number;
  bytes: number;
  /** The next page (`Link: rel="next"`), as a console URL. */
  next?: string;
}

export interface Param {
  key: string;
  value: string;
}

export const isMethod = (word: string): word is Method => METHODS.includes(word as Method);

/** `post /api/v1/groups` typed at the prompt: splits off a leading method. */
export function splitMethod(line: string): { method?: Method; url: string } {
  const [, word = '', url = ''] = line.match(/^\s*([a-z]+)\s+(.*)$/is) ?? [];
  const method = word.toUpperCase();
  return isMethod(method) ? { method, url } : { url: line };
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Splits a console URL into its path and (decoded) query parameters. */
export function splitUrl(url: string): { path: string; params: Param[] } {
  const [withoutHash = ''] = url.split('#');
  const q = withoutHash.indexOf('?');
  if (q < 0) return { path: withoutHash, params: [] };
  const params = withoutHash
    .slice(q + 1)
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      return eq < 0
        ? { key: decode(part), value: '' }
        : { key: decode(part.slice(0, eq)), value: decode(part.slice(eq + 1)) };
    });
  return { path: withoutHash.slice(0, q), params };
}

// Keeps the prompt readable: only escapes what would change how the query splits.
const escapeKey = (s: string) => s.replace(/[%&=#]/g, encodeURIComponent);
const escapeValue = (s: string) => s.replace(/[%&#]/g, encodeURIComponent);

export function joinUrl(path: string, params: Param[]): string {
  if (params.length === 0) return path;
  const query = params
    .map(({ key, value }) => (value ? `${escapeKey(key)}=${escapeValue(value)}` : escapeKey(key)))
    .join('&');
  return `${path}?${query}`;
}

/**
 * The URL a console URL is sent to. Paths without a leading slash are under
 * `/api/v1/`, and full URLs keep only their path: requests always go to this org.
 */
export function resolveUrl(url: string, origin: string): URL {
  let target = url.trim();
  if (/^https?:\/\//i.test(target)) {
    const parsed = new URL(target);
    target = parsed.pathname + parsed.search;
  } else if (!target.startsWith('/')) {
    target = `/api/v1/${target}`;
  }
  const { path, params } = splitUrl(target);
  const resolved = new URL(path, origin);
  resolved.search = params
    .map(({ key, value }) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return resolved;
}

/** A full URL (from a `Link` header or `_links`) as a console URL. */
export function toConsoleUrl(href: string): string {
  const parsed = new URL(href, location.origin);
  const { path, params } = splitUrl(parsed.pathname + parsed.search);
  return joinUrl(path, params);
}

/** Okta checks this token on every request that changes something. */
const xsrfToken = () => document.getElementById('_xsrfToken')?.textContent?.trim();

export async function send({ method, url, body }: ApiRequest): Promise<ApiResponse> {
  const target = resolveUrl(url, location.origin);
  const headers: Record<string, string> = { Accept: 'application/json' };
  const hasBody = method !== 'GET' && body.trim() !== '';
  if (hasBody) headers['Content-Type'] = 'application/json';
  const token = method === 'GET' ? undefined : xsrfToken();
  if (token) headers['X-Okta-XsrfToken'] = token;

  const started = performance.now();
  const res = await fetch(target, {
    method,
    credentials: 'same-origin',
    headers,
    body: hasBody ? body : undefined,
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - started);

  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  const next = nextLink(res.headers.get('link'));
  return {
    status: res.status,
    statusText: res.statusText,
    headers: [...res.headers.entries()],
    text,
    json,
    ms,
    bytes: new TextEncoder().encode(text).length,
    next: next && toConsoleUrl(next),
  };
}
