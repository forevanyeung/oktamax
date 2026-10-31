// Lists the Okta Management API's endpoints for the API console's suggestions, from Okta's
// OpenAPI spec: `npm run endpoints [path or URL of a spec]`. Writes src/console/endpoints.json.
//
// The spec is ~100k lines of YAML; this reads just what it needs line by line rather than
// pulling in a YAML parser.
import { readFileSync, writeFileSync } from 'node:fs';

const SPEC =
  'https://raw.githubusercontent.com/okta/okta-management-openapi-spec/master/dist/current/management-minimal.yaml';

const source = process.argv[2] ?? SPEC;
const yaml = /^https?:/.test(source)
  ? await (await fetch(source)).text()
  : readFileSync(source, 'utf8');
const lines = yaml.split('\n');

const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

// components.parameters: shared parameters, referenced by `$ref`.
const shared = {};
{
  let section = '';
  let name;
  for (const line of lines) {
    if (/^\S/.test(line)) section = line;
    if (section !== 'components:') continue;
    let m;
    if ((m = line.match(/^ {2}(\w+):$/))) {
      name = m[1] === 'parameters' ? undefined : null;
    } else if (name !== null && (m = line.match(/^ {4}(\w+):$/))) {
      name = m[1];
      shared[name] = {};
    } else if (name && (m = line.match(/^ {6}(name|in): (.+)$/))) {
      shared[name][m[1]] = unquote(m[2]);
    }
  }
}

const endpoints = [];
let section = '';
let path;
let op;
let inParams = false;
let inTags = false;
let pending; // an inline parameter whose `in` hasn't been read yet
for (const line of lines) {
  if (/^\S/.test(line)) section = line;
  if (section !== 'paths:') continue;
  let m;
  if ((m = line.match(/^ {2}(\/\S*):$/))) {
    path = m[1];
    op = undefined;
  } else if ((m = line.match(/^ {4}(get|post|put|patch|delete):$/))) {
    op = { m: m[1].toUpperCase(), p: path, s: '', t: '', q: [] };
    endpoints.push(op);
    inParams = inTags = false;
  } else if (op && /^ {6}\S/.test(line)) {
    inParams = line === '      parameters:';
    inTags = line === '      tags:';
    if ((m = line.match(/^ {6}summary: (.+)$/))) op.s = unquote(m[1]);
    if (line === '      deprecated: true') op.deprecated = true;
  } else if (op && inTags && (m = line.match(/^ {8}- (.+)$/))) {
    op.t ||= unquote(m[1]);
  } else if (op && inParams) {
    if ((m = line.match(/^ {8}- \$ref: '#\/components\/parameters\/(\w+)'$/))) {
      const param = shared[m[1]];
      if (param?.in === 'query') op.q.push(param.name);
    } else if ((m = line.match(/^ {8}- name: (.+)$/))) {
      pending = unquote(m[1]);
    } else if (pending && (m = line.match(/^ {10}in: (\w+)$/))) {
      if (m[1] === 'query') op.q.push(pending);
      pending = undefined;
    }
  } else if (/^ {4}\S/.test(line)) {
    op = undefined;
  }
}

// The spec names a user's ID `{id}` or `{userIdOrLogin}` in some paths. The console fills
// `{userId}` from the page, so they're all called that.
const RENAME = { '/users/{id}': '/users/{userId}', '/users/{userIdOrLogin}': '/users/{userId}' };
const rename = (path) =>
  Object.entries(RENAME).reduce((p, [from, to]) => p.replace(from, to), path);

const list = endpoints
  .filter((e) => !e.deprecated)
  .map(({ m, p, s, t, q }) => ({ m, p: rename(p), s, t, ...(q.length ? { q } : {}) }));
const version = yaml.match(/^ {2}version: (.+)$/m)?.[1];
writeFileSync(
  'src/console/endpoints.json',
  `${JSON.stringify({ version, endpoints: list }, null, 0).replace(/\},\{/g, '},\n{')}\n`,
);
console.log(`${list.length} endpoints from the Okta Management API ${version}`);
