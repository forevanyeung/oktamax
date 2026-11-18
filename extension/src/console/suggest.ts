/**
 * Prompt suggestions from the Okta Management API's endpoints (generated from
 * Okta's OpenAPI spec by `npm run endpoints`): paths as they're typed, query
 * parameters after `?`, and the endpoints for the objects on the current page.
 */
import { fillTemplate, type PageContext } from './context';
import data from './endpoints.json';
import { escapeValue, splitUrl, type Method } from './request';

export interface QueryParam {
  /** Name. */
  n: string;
  /** Type, e.g. `string` or `string[]`. */
  ty?: string;
  /** Description: its first sentence or two, as plain text. */
  d?: string;
  /** Example values. */
  x?: string[];
}

export interface Endpoint {
  m: Method;
  /** Path template, e.g. `/api/v1/users/{userId}/groups`. */
  p: string;
  /** Summary. */
  s: string;
  /** Tag (API area). */
  t: string;
  /** Operation ID, for the docs link. */
  id?: string;
  /** OAuth scopes it needs. */
  sc?: string[];
  /** Query parameters. */
  q?: QueryParam[];
}

export const ENDPOINTS = data.endpoints as Endpoint[];
export const SPEC_VERSION = data.version;

export interface Suggestion {
  /** The prompt's URL once this is picked. */
  url: string;
  method?: Method;
  /** What it completes: an endpoint, a query parameter's name, or its value. */
  kind: 'endpoint' | 'param' | 'value';
  /** Path template, parameter name or value, as shown. */
  label: string;
  detail: string;
  /** A parameter's type. */
  type?: string;
  /** A parameter's first example, shown as a hint. */
  example?: string;
  /** The endpoint's reference page. */
  docs?: string;
}

const DOCS = 'https://developer.okta.com/docs/api/openapi/okta-management/management/tags';

/** The endpoint's page in Okta's API reference. */
export const docsUrl = ({ t, id }: Endpoint) =>
  t && id ? `${DOCS}/${t.toLowerCase()}/other/${id.toLowerCase()}` : undefined;

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
  kind: 'endpoint',
  label: endpoint.p,
  detail: endpoint.s,
  docs: docsUrl(endpoint),
});

/**
 * The endpoint a console URL is a request to, for `method`: its path matches
 * segment for segment, and literal segments win over parameters, so
 * `/users/me` is `/users/me` rather than `/users/{userId}`.
 */
export function endpointFor(url: string, method: Method, endpoints = ENDPOINTS) {
  let path = splitUrl(url.trim()).path;
  if (/^https?:/.test(path)) path = new URL(path).pathname;
  const typed = segmentsOf(absolute(path));
  const literals = (template: string[]) => template.filter((s) => !isParam(s)).length;
  return endpoints
    .filter((e) => e.m === method)
    .map((e) => ({ e, template: segmentsOf(e.p) }))
    .filter(
      ({ template }) =>
        template.length === typed.length &&
        template.every((segment, i) => {
          const value = typed[i] ?? '';
          return isParam(segment) ? value !== '' : segment.toLowerCase() === value.toLowerCase();
        }),
    )
    .sort((a, b) => literals(b.template) - literals(a.template))[0]?.e;
}

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

/**
 * After `?`: the endpoint's query parameters, with their types, descriptions
 * and an example. After `name=`: that parameter's examples.
 */
function paramSuggestions(url: string, method: Method, endpoints: Endpoint[]): Suggestion[] {
  const q = url.indexOf('?');
  const typed = segmentsOf(absolute(url.slice(0, q)));
  const matching = endpoints.filter((e) => {
    const template = segmentsOf(e.p);
    return template.length === typed.length && leadsTo(typed, template);
  });
  const endpoint = matching.find((e) => e.m === method) ?? matching[0];
  if (!endpoint?.q) return [];
  const fragment = url.slice(url.lastIndexOf('&') + 1 || q + 1);
  const prefix = url.slice(0, url.length - fragment.length);
  const eq = fragment.indexOf('=');

  if (eq >= 0) {
    const name = fragment.slice(0, eq);
    const value = fragment.slice(eq + 1);
    const param = endpoint.q.find((p) => p.n === name);
    return (param?.x ?? [])
      .filter((x) => x !== value && x.toLowerCase().startsWith(value.toLowerCase()))
      .map((x) => ({
        url: `${prefix}${name}=${escapeValue(x)}`,
        kind: 'value' as const,
        label: x,
        detail: `Example ${name}`,
      }));
  }

  const used = new Set(splitUrl(url).params.map((p) => p.key));
  return endpoint.q
    .filter((p) => !used.has(p.n) && p.n.toLowerCase().startsWith(fragment.toLowerCase()))
    .map((p) => ({
      url: `${prefix}${p.n}=`,
      kind: 'param' as const,
      label: p.n,
      detail: p.d ?? `Query parameter of ${endpoint.m} ${endpoint.p}`,
      type: p.ty,
      example: p.x?.[0],
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
