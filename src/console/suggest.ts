/**
 * Prompt suggestions from the Okta Management API's endpoints (generated from
 * Okta's OpenAPI spec by `npm run endpoints`): paths as they're typed, query
 * parameters after `?`, and the endpoints for the objects on the current page.
 */
import { fillTemplate, type PageContext } from './context';
import data from './endpoints.json';
import { splitUrl, type Method } from './request';

export interface Endpoint {
  m: Method;
  /** Path template, e.g. `/api/v1/users/{userId}/groups`. */
  p: string;
  /** Summary. */
  s: string;
  /** Tag (API area). */
  t: string;
  /** Query parameters. */
  q?: string[];
}

export const ENDPOINTS = data.endpoints as Endpoint[];
export const SPEC_VERSION = data.version;

export interface Suggestion {
  /** The prompt's URL once this is picked. */
  url: string;
  method?: Method;
  /** Path template or parameter name, as shown. */
  label: string;
  detail: string;
}

const LIMIT = 50;
const METHOD_ORDER: Method[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const segmentsOf = (path: string) => path.split('/').slice(1);
const isParam = (segment: string) => segment.startsWith('{');

/** A console URL's path as the absolute path it's sent to. */
const absolute = (path: string) => (path.startsWith('/') ? path : `/api/v1/${path}`);

/** Does the path typed so far lead to `template`? The last segment may be half typed. */
function leadsTo(typed: string[], template: string[]): boolean {
  if (typed.length > template.length) return false;
  return typed.every((value, i) => {
    const segment = template[i] ?? '';
    if (isParam(segment)) return i < typed.length - 1 ? value !== '' : true;
    const last = i === typed.length - 1;
    return last
      ? segment.toLowerCase().startsWith(value.toLowerCase())
      : segment.toLowerCase() === value.toLowerCase();
  });
}

/**
 * The URL for `endpoint`: path parameters typed already are kept, the rest
 * come from the page, and any left over stay as `{name}` for the admin to fill.
 */
function fill(endpoint: Endpoint, typed: string[], context: PageContext): string {
  const path = segmentsOf(endpoint.p).map((segment, i) => {
    const value = typed[i];
    return isParam(segment) && value && i < typed.length - 1 && !isParam(value) ? value : segment;
  });
  return fillTemplate(`/${path.join('/')}`, context);
}

const byRelevance = (preferred: Method) => (a: Endpoint, b: Endpoint) =>
  segmentsOf(a.p).length - segmentsOf(b.p).length ||
  Number(b.m === preferred) - Number(a.m === preferred) ||
  METHOD_ORDER.indexOf(a.m) - METHOD_ORDER.indexOf(b.m) ||
  a.p.localeCompare(b.p);

const toSuggestion = (endpoint: Endpoint, url: string): Suggestion => ({
  url,
  method: endpoint.m,
  label: endpoint.p,
  detail: endpoint.s,
});

/** Endpoints for the page's objects: GETs whose path parameters the page fills. */
export function pageSuggestions(context: PageContext, endpoints = ENDPOINTS): Suggestion[] {
  const names = new Set(Object.keys(context));
  if (!names.size) return [];
  return endpoints
    .filter((e) => {
      if (e.m !== 'GET') return false;
      const params = segmentsOf(e.p).filter(isParam);
      return params.length > 0 && params.every((p) => names.has(p.slice(1, -1)));
    })
    .sort(byRelevance('GET'))
    .slice(0, LIMIT)
    .map((e) => toSuggestion(e, fillTemplate(e.p, context)));
}

/** Endpoints with every word of `query` in their summary, path or area. */
function search(query: string, preferred: Method, context: PageContext, endpoints: Endpoint[]) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return endpoints
    .filter((e) => {
      const text = `${e.m} ${e.p} ${e.s} ${e.t}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .sort(byRelevance(preferred))
    .slice(0, LIMIT)
    .map((e) => toSuggestion(e, fillTemplate(e.p, context)));
}

/** Query parameter names for the endpoint at `path`, after `?`. */
function paramSuggestions(url: string, method: Method, endpoints: Endpoint[]): Suggestion[] {
  const q = url.indexOf('?');
  const typed = segmentsOf(absolute(url.slice(0, q)));
  const matching = endpoints.filter((e) => {
    const template = segmentsOf(e.p);
    return template.length === typed.length && leadsTo(typed, template);
  });
  const endpoint = matching.find((e) => e.m === method) ?? matching[0];
  const fragment = url.slice(url.lastIndexOf('&') + 1 || q + 1);
  if (!endpoint?.q || fragment.includes('=')) return [];
  const used = new Set(splitUrl(url).params.map((p) => p.key));
  const prefix = url.slice(0, url.length - fragment.length);
  return endpoint.q
    .filter((name) => !used.has(name) && name.toLowerCase().startsWith(fragment.toLowerCase()))
    .map((name) => ({
      url: `${prefix}${name}=`,
      label: name,
      detail: `Query parameter of ${endpoint.m} ${endpoint.p}`,
    }));
}

export function suggest(
  url: string,
  method: Method,
  context: PageContext,
  endpoints = ENDPOINTS,
): Suggestion[] {
  if (!url.trim()) return pageSuggestions(context, endpoints);
  if (url.includes('?')) return paramSuggestions(url, method, endpoints);
  // Words rather than a path: search the summaries.
  if (/\s/.test(url.trim())) return search(url, method, context, endpoints);

  const typed = segmentsOf(absolute(url.trim()));
  const matches = endpoints
    .filter((e) => leadsTo(typed, segmentsOf(e.p)))
    .sort(byRelevance(method))
    .slice(0, LIMIT)
    .map((e) => toSuggestion(e, fill(e, typed, context)));
  return matches.length ? matches : search(url, method, context, endpoints);
}

/** The path of the object a path parameter names, e.g. `/api/v1/users/00u1` for `userId`. */
export function objectPath(name: string, context: PageContext, endpoints = ENDPOINTS) {
  const endpoint = endpoints
    .filter((e) => e.m === 'GET' && e.p.endsWith(`/{${name}}`))
    .sort(byRelevance('GET'))[0];
  return endpoint && fillTemplate(endpoint.p, context);
}
