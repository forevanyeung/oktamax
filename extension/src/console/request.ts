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
export const escapeValue = (s: string) => s.replace(/[%&#]/g, encodeURIComponent);

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

/**
 * What Okta asks for when a protected action (editing an identity provider,
 * say) needs the admin to verify again: a 401 with
 * `WWW-Authenticate: error="insufficient_user_authentication", max_age="60", acr_values="…"`.
 */
export interface StepUpChallenge {
  maxAge?: string;
  acrValues?: string;
}

export function stepUpChallenge(
  status: number,
  wwwAuthenticate: string | null,
): StepUpChallenge | undefined {
  if (status !== 401 || !wwwAuthenticate) return undefined;
  const fields = Object.fromEntries(
    [...wwwAuthenticate.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map(([, k, v]) => [k, v]),
  );
  if (fields.error !== 'insufficient_user_authentication') return undefined;
  return { maxAge: fields.max_age, acrValues: fields.acr_values };
}

/** The pop-up the admin console itself opens for a step-up. */
export function stepUpUrl({ maxAge, acrValues }: StepUpChallenge, origin: string): string {
  const url = new URL('/admin/sso/step-up', origin);
  if (maxAge) url.searchParams.set('max_age', maxAge);
  if (acrValues) url.searchParams.set('acr_values', acrValues);
  return url.href;
}

/**
 * Opens Okta's step-up pop-up and waits for it. When the admin verifies, its
 * callback page posts `{ type: 'step-up', success: true }` to this window and
 * leaves closing the pop-up to us; closing it before then is a cancel.
 */
function stepUp(challenge: StepUpChallenge): Promise<boolean> {
  const popup = window.open(stepUpUrl(challenge, location.origin));
  if (!popup) return Promise.resolve(false); // blocked
  return new Promise((resolve) => {
    const finish = (verified: boolean) => {
      removeEventListener('message', onMessage);
      clearInterval(poll);
      popup.close();
      resolve(verified);
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; success?: unknown } | null;
      if (event.origin === location.origin && data?.type === 'step-up')
        finish(data.success === true);
    };
    const poll = setInterval(() => popup.closed && finish(false), 250);
    addEventListener('message', onMessage);
  });
}

export interface SendOptions {
  /** Called when Okta asks the admin to verify before it will carry out the request. */
  onStepUp?: () => void;
}

/**
 * Sends a request. If Okta asks for a step-up, opens its pop-up like the admin
 * console does and, once the admin verifies, sends the request again; if they
 * don't, the response is Okta's original 401.
 */
export async function send(request: ApiRequest, options: SendOptions = {}): Promise<ApiResponse> {
  const response = await sendOnce(request);
  const challenge = stepUpChallenge(
    response.status,
    response.headers.find(([name]) => name.toLowerCase() === 'www-authenticate')?.[1] ?? null,
  );
  if (!challenge) return response;
  options.onStepUp?.();
  return (await stepUp(challenge)) ? sendOnce(request) : response;
}

async function sendOnce({ method, url, body }: ApiRequest): Promise<ApiResponse> {
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
