// The JSON request bodies of the Okta Management API's endpoints, for the API console's Body
// tab: `npm run bodies [path or URL of a spec]`. Writes one file per API area (tag) to
// src/console/bodies/, which the console loads only when the Body tab is open.
//
// Each body's schema is flattened to dotted paths (`profile.login`, `groupIds[]`) with a type,
// whether it's required and a short description, and comes with the spec's request examples.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { parse } from 'yaml';

const SPEC =
  'https://raw.githubusercontent.com/okta/okta-management-openapi-spec/master/dist/current/management-minimal.yaml';
const OUT = 'src/console/bodies';

/** How deep nested objects are flattened, e.g. 4 for `a.b.c.d`. */
const MAX_DEPTH = 4;
/** Fields listed per body. */
const MAX_FIELDS = 200;
/** Request examples kept per body, and the largest kept (as JSON). */
const MAX_EXAMPLES = 6;
const MAX_EXAMPLE_LENGTH = 4000;
const MAX_DESCRIPTION = 140;
const MAX_ENUM = 12;
const JSON_TYPES = ['application/json', 'application/merge-patch+json'];

const source = process.argv[2] ?? SPEC;
const text = /^https?:/.test(source)
  ? await (await fetch(source)).text()
  : readFileSync(source, 'utf8');
const spec = parse(text, { maxAliasCount: -1 });

/** The object a local `$ref` points to, e.g. `#/components/schemas/User`. */
const lookup = (ref) =>
  ref
    .replace(/^#\//, '')
    .split('/')
    .reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
const deref = (node) => {
  for (let i = 0; node?.$ref && i < 20; i++) node = lookup(node.$ref);
  return node;
};

/**
 * A schema with its `allOf` parts merged in. `oneOf`/`anyOf` variants are merged too, their
 * fields required only when every variant requires them.
 */
function merged(node, chain = new Set()) {
  if (node?.$ref) {
    if (chain.has(node.$ref)) return {};
    chain = new Set(chain).add(node.$ref);
  }
  const schema = deref(node) ?? {};
  const out = {
    ...schema,
    properties: { ...schema.properties },
    required: [...(schema.required ?? [])],
  };
  for (const part of schema.allOf ?? []) {
    const m = merged(part, chain);
    out.properties = { ...m.properties, ...out.properties };
    out.required.push(...m.required);
    out.type ??= m.type;
    out.description ??= m.description;
    out.discriminator ??= m.discriminator;
  }
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants?.length) {
    const parts = variants.map((v) => merged(v, chain));
    for (const m of parts) {
      out.properties = { ...m.properties, ...out.properties };
      out.type ??= m.type;
    }
    const everywhere = parts[0].required.filter((name) =>
      parts.every((m) => m.required.includes(name)),
    );
    out.required.push(...everywhere);
  }
  if (!out.type && Object.keys(out.properties).length) out.type = 'object';
  return out;
}

/** The first sentence of a description, without Markdown links or line breaks. */
function shortDescription(description) {
  if (typeof description !== 'string') return undefined;
  let s = description
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? s;
  if (s.length > MAX_DESCRIPTION) s = `${s.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
  return s || undefined;
}

function typeOf(schema) {
  if (schema.type === 'array') {
    const items = merged(schema.items);
    return `${typeOf(items)}[]`;
  }
  return schema.type ?? 'any';
}

/** The fields of `schema`, with dotted paths under `prefix`. */
function flatten(node, prefix = '', depth = 0, chain = new Set(), out = []) {
  if (node?.$ref) {
    if (chain.has(node.$ref)) return out;
    chain = new Set(chain).add(node.$ref);
  }
  const schema = merged(node);
  const required = new Set(schema.required);
  const discriminator = schema.discriminator;
  for (const [name, raw] of Object.entries(schema.properties ?? {})) {
    if (out.length >= MAX_FIELDS) break;
    const prop = merged(raw);
    if (prop.readOnly || deref(raw)?.readOnly) continue;
    const path = prefix ? `${prefix}.${name}` : name;
    const field = { p: path, t: typeOf(prop) };
    if (required.has(name)) field.r = 1;
    const d = shortDescription(prop.description ?? deref(raw)?.description);
    if (d) field.d = d;
    let values = prop.enum ?? (prop.type === 'array' ? merged(prop.items).enum : undefined);
    if (discriminator?.propertyName === name && discriminator.mapping) {
      values = Object.keys(discriminator.mapping);
    }
    if (values?.length)
      field.e = values
        .filter((v) => v !== null)
        .slice(0, MAX_ENUM)
        .map(String);
    out.push(field);

    if (depth + 1 >= MAX_DEPTH) continue;
    if (prop.type === 'object' && Object.keys(prop.properties).length) {
      flatten(raw, path, depth + 1, chain, out);
    } else if (prop.type === 'array') {
      const items = merged(prop.items);
      if (items.type === 'object' && Object.keys(items.properties).length) {
        flatten(prop.items, `${path}[]`, depth + 1, chain, out);
      }
    }
  }
  return out;
}

/** Up to MAX_EXAMPLES of a body's request examples, as `{ n: name, v: value }`. */
function examples(content) {
  const list = [];
  for (const [name, raw] of Object.entries(content.examples ?? {})) {
    const value = deref(raw)?.value;
    if (value === undefined) continue;
    if (JSON.stringify(value).length > MAX_EXAMPLE_LENGTH) continue;
    list.push({ n: name, v: value });
    if (list.length >= MAX_EXAMPLES) break;
  }
  if (!list.length && content.example !== undefined)
    list.push({ n: 'Example', v: content.example });
  return list;
}

// Paths are renamed as in endpoints.mjs, so they match endpoints.json.
const RENAME = { '/users/{id}': '/users/{userId}', '/users/{userIdOrLogin}': '/users/{userId}' };
const rename = (path) =>
  Object.entries(RENAME).reduce((p, [from, to]) => p.replace(from, to), path);

const byTag = {};
let count = 0;
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of ['post', 'put', 'patch', 'delete']) {
    const op = item[method];
    if (!op || op.deprecated) continue;
    const body = deref(op.requestBody);
    const type = JSON_TYPES.find((t) => body?.content?.[t]);
    if (!type) continue;
    const content = body.content[type];
    const fields = content.schema ? flatten(content.schema) : [];
    const x = examples(content);
    if (!fields.length && !x.length) continue;
    const tag = op.tags?.[0] ?? 'Other';
    byTag[tag] ??= {};
    byTag[tag][`${method.toUpperCase()} ${rename(path)}`] = {
      f: fields,
      ...(x.length ? { x } : {}),
    };
    count++;
  }
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
let bytes = 0;
for (const [tag, bodies] of Object.entries(byTag)) {
  const json = `${JSON.stringify(bodies)}\n`;
  bytes += json.length;
  writeFileSync(`${OUT}/${tag.replace(/[^\w-]/g, '_')}.json`, json);
}
const version = spec.info?.version;
console.log(
  `${count} request bodies in ${Object.keys(byTag).length} files (${Math.round(bytes / 1024)} KB) from the Okta Management API ${version}`,
);
