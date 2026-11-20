// Lists the Okta Management API's endpoints for the API console's suggestions, from Okta's
// OpenAPI spec: `npm run endpoints [path or URL of a spec]`. Writes src/console/endpoints.json.
//
// `--check` writes nothing: it exits with 1 if endpoints.json is out of date with the spec (and
// says what changed), for the scheduled workflow that keeps it current.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'yaml';

const SPEC =
  'https://raw.githubusercontent.com/okta/okta-management-openapi-spec/master/dist/current/management-minimal.yaml';
const OUT = new URL('../src/console/endpoints.json', import.meta.url);

const args = process.argv.slice(2);
const check = args.includes('--check');
const source = args.find((a) => !a.startsWith('--')) ?? SPEC;
const yaml = /^https?:/.test(source)
  ? await (await fetch(source)).text()
  : readFileSync(source, 'utf8');
const spec = parse(yaml, { maxAliasCount: -1 });

const resolve = (node) => {
  const ref = node?.$ref;
  if (!ref) return node;
  return ref
    .slice(2)
    .split('/')
    .reduce((n, key) => n?.[key], spec);
};

/** The first sentence or two of a Markdown description, as plain text. */
function brief(markdown, max = 160) {
  if (!markdown) return undefined;
  const paragraph =
    markdown
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('>')) ?? '';
  const text = paragraph
    .split('\n')
    .filter((line) => !line.trim().startsWith('>')) // notes
    .join(' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/<[^>]+>/g, '') // HTML
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= max) return text || undefined;
  // Whole sentences while they fit, else cut at a word.
  // A sentence ends at a stop followed by a space, not at `profile.name`.
  const sentences = text.match(/.*?[.!?](?:\s+|$)/g) ?? [];
  let out = '';
  for (const s of sentences) {
    if ((out + s).trim().length > max) break;
    out += s;
  }
  out = out.trim();
  return out || `${text.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

const short = (value) => {
  if (value === undefined || value === null || typeof value === 'object') return undefined;
  const s = String(value);
  // Long ones don't fit a suggestion; `&` would split the query string.
  return s.length <= 80 && !s.includes('&') ? s : undefined;
};

function typeOf(schema) {
  if (!schema) return undefined;
  schema = resolve(schema);
  if (schema.type === 'array') {
    const items = typeOf(schema.items);
    return items ? `${items}[]` : 'array';
  }
  return schema.type;
}

/** Up to four example values: the parameter's examples, else its enum. */
function examplesOf(param) {
  const schema = resolve(param.schema) ?? {};
  const values = [
    ...Object.values(param.examples ?? {}).map((e) => resolve(e)?.value),
    param.example,
    schema.example,
    ...(schema.enum ?? resolve(schema.items)?.enum ?? []),
  ]
    .map(short)
    .filter((v) => v !== undefined && v !== '');
  return [...new Set(values)].slice(0, 4);
}

function queryParam(param) {
  const ty = typeOf(param.schema);
  const d = brief(param.description);
  const x = examplesOf(param);
  return { n: param.name, ...(ty ? { ty } : {}), ...(d ? { d } : {}), ...(x.length ? { x } : {}) };
}

const scopesOf = (security) =>
  (security ?? []).flatMap((s) => s.oauth2 ?? []).filter((s, i, all) => all.indexOf(s) === i);

// The spec names a user's ID `{id}` or `{userIdOrLogin}` in some paths. The console fills
// `{userId}` from the page, so they're all called that.
const RENAME = { '/users/{id}': '/users/{userId}', '/users/{userIdOrLogin}': '/users/{userId}' };
const rename = (path) =>
  Object.entries(RENAME).reduce((p, [from, to]) => p.replace(from, to), path);

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const endpoints = [];
for (const [path, item] of Object.entries(spec.paths ?? {})) {
  for (const method of METHODS) {
    const op = item[method];
    if (!op || op.deprecated) continue;
    const params = [...(item.parameters ?? []), ...(op.parameters ?? [])]
      .map(resolve)
      .filter((p) => p?.in === 'query');
    const q = params.map(queryParam);
    const sc = scopesOf(op.security ?? spec.security);
    endpoints.push({
      m: method.toUpperCase(),
      p: rename(path),
      s: op.summary ?? '',
      t: op.tags?.[0] ?? '',
      ...(op.operationId ? { id: op.operationId } : {}),
      ...(sc.length ? { sc } : {}),
      ...(q.length ? { q } : {}),
    });
  }
}

const version = spec.info?.version;
const json = `${JSON.stringify({ version, endpoints }, null, 0).replace(/\},\{"m"/g, '},\n{"m"')}\n`;

if (check) {
  let current = { endpoints: [] };
  try {
    current = JSON.parse(readFileSync(OUT, 'utf8'));
  } catch {
    // Missing or unreadable: out of date.
  }
  const key = (e) => `${e.m} ${e.p}`;
  const before = new Map(current.endpoints.map((e) => [key(e), JSON.stringify(e)]));
  const after = new Map(endpoints.map((e) => [key(e), JSON.stringify(e)]));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...after.keys()].filter((k) => before.has(k) && before.get(k) !== after.get(k));
  const stale = current.version !== version || added.length || removed.length || changed.length;
  const MAX = 40;
  const list = (title, keys) =>
    keys.length
      ? `\n\n${title} (${keys.length}):\n${keys
          .slice(0, MAX)
          .map((k) => `- \`${k}\``)
          .join('\n')}${keys.length > MAX ? `\n- …and ${keys.length - MAX} more` : ''}`
      : '';
  console.log(
    stale
      ? `endpoints.json (${current.version}) differs from the spec (${version}).` +
          list('Added', added) +
          list('Removed', removed) +
          list('Changed', changed)
      : `endpoints.json is up to date with the spec (${version}).`,
  );
  process.exit(stale ? 1 : 0);
}

writeFileSync(OUT, json);
console.log(`${endpoints.length} endpoints from the Okta Management API ${version}`);
