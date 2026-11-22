#!/usr/bin/env node
/**
 * Works out the next release of the extension or the chat server: its version, tag and notes.
 *
 *   node scripts/release.mjs <extension|server> [auto|patch|minor|major] [--write] [--notes <file>]
 *   node scripts/release.mjs <extension|server> --at <tag> [--since <tag>] [--notes <file>]
 *
 * The two are versioned separately and tagged `extension-v<version>` and `server-v<version>`.
 * The changes in a release are the pull requests merged into main since the previous tag of the
 * same component that touched its code (or `shared/`, which both build in).
 *
 * `auto` picks the bump from those changes:
 * - major: a breaking change. The pull request says "BREAKING CHANGE" in its description, its
 *   branch or title has a `!` (`feat!/...`, `feat!: ...`), or it raised the minimum version of
 *   the other side in `shared/src/version.ts` (so older peers stop working).
 * - minor: a feature: a `feat/...` branch, or a `feat:` title.
 * - patch: anything else.
 *
 * Prints `version=`, `tag=`, `previous=`, `bump=`, `changes=` and `title=` lines (for
 * $GITHUB_OUTPUT). `--write` sets the new version in the component's package.json and
 * package-lock.json (the nightly build does this without committing it: tags hold the versions);
 * `--notes` writes the release notes to a file.
 *
 * `--at <tag>` describes a release that already exists instead of the next one, with the changes
 * since `--since <tag>` (by default its previous tag). Promoting a nightly to a full release uses
 * it for notes that cover everything since the last full release.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const COMPONENTS = {
  extension: {
    title: 'Extension',
    dir: 'extension',
    paths: ['extension', 'shared'],
    /** Raising this breaks older servers. */
    peerMinimum: 'MIN_SERVER_VERSION',
    peer: 'chat server',
  },
  server: {
    title: 'Server',
    dir: 'server',
    paths: ['server', 'shared'],
    peerMinimum: 'MIN_EXTENSION_VERSION',
    peer: 'extension',
  },
};
const BUMPS = ['major', 'minor', 'patch'];
const VERSION_FILE = 'shared/src/version.ts';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const [, value] = args.splice(i, 2);
  return value ?? '';
};
const notesFile = flag('--notes');
const at = flag('--at') || undefined;
const since = flag('--since') || undefined;
const write = args.includes('--write');
const [name, requested = 'auto'] = args.filter((a) => !a.startsWith('--'));
const component = COMPONENTS[name];
if (!component || ![...BUMPS, 'auto'].includes(requested) || (at && write)) {
  console.error(
    'Usage: release.mjs <extension|server> [auto|patch|minor|major] [--write] [--notes <file>]\n' +
      '       release.mjs <extension|server> --at <tag> [--since <tag>] [--notes <file>]',
  );
  process.exit(2);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const tryGit = (...a) => {
  try {
    return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
};

const pkgPath = `${component.dir}/package.json`;
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const current = pkg.version;
const prefix = `${name}-v`;

if (at && (!at.startsWith(prefix) || !tryGit('rev-parse', '-q', '--verify', `refs/tags/${at}`))) {
  console.error(`${at} isn't a ${name} tag`);
  process.exit(1);
}
const head = at ?? 'HEAD';

// The previous release: the newest tag of this component on this branch.
const previous =
  since ?? tryGit('describe', '--tags', '--abbrev=0', `--match=${prefix}*`, at ? `${at}^` : 'HEAD');
const range = previous ? `${previous}..${head}` : head;

// Pull requests (merge commits) and direct commits on main, newest first, that touched the
// component. Commits are separated by NUL, fields by \x1f.
const log = git(
  'log',
  '--first-parent',
  '--format=%H%x1f%s%x1f%b%x00',
  range,
  '--',
  ...component.paths,
);
const changes = log
  .split('\0')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [sha, subject, body = ''] = entry.split('\x1f');
    const pr = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/.exec(subject);
    // A merge's title is the first line of its description: the pull request's title.
    const title = pr ? body.split('\n')[0].trim() || pr[2] : subject;
    const branch = pr?.[2] ?? '';
    const breaking =
      /BREAKING[ -]CHANGE/.test(body) ||
      /^[a-z]+!\//.test(branch) ||
      /^[a-z]+(\(.+\))?!:/.test(title);
    const feature = branch.startsWith('feat') || /^feat(\(.+\))?!?:/.test(title);
    const fix = branch.startsWith('fix') || /^fix(\(.+\))?!?:/.test(title);
    return {
      sha,
      pr: pr?.[1],
      title,
      kind: breaking ? 'breaking' : feature ? 'feature' : fix ? 'fix' : 'other',
    };
  })
  // Earlier release commits only bump the version.
  .filter((c) => !/^Release (extension|server) \d/.test(c.title));

/** A version constant in shared/src/version.ts as of `ref` (the working tree when undefined). */
const minimumAt = (ref, constant) => {
  const source = ref
    ? tryGit('show', `${ref}:${VERSION_FILE}`)
    : readFileSync(VERSION_FILE, 'utf8');
  return source && new RegExp(`${constant} = '([^']+)'`).exec(source)?.[1];
};
const compare = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

// Raising the oldest peer this side works with is a breaking change for it.
const peerMinimum = minimumAt(at, component.peerMinimum);
const peerMinimumBefore = previous && minimumAt(previous, component.peerMinimum);
const droppedPeers =
  peerMinimumBefore && peerMinimum && compare(peerMinimum, peerMinimumBefore) > 0;

const bump =
  requested !== 'auto'
    ? requested
    : droppedPeers || changes.some((c) => c.kind === 'breaking')
      ? 'major'
      : changes.some((c) => c.kind === 'feature')
        ? 'minor'
        : 'patch';

// The first release is the version already in package.json; after that, bump from the last tag.
const base = previous ? previous.slice(prefix.length) : undefined;
const next = (() => {
  if (at) return at.slice(prefix.length);
  if (!base) return requested === 'auto' ? current : increment(current, bump);
  return increment(base, bump);
})();
function increment(version, by) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (by === 'major') return `${major + 1}.0.0`;
  if (by === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
const tag = `${prefix}${next}`;
if (!at && tryGit('rev-parse', '-q', '--verify', `refs/tags/${tag}`)) {
  console.error(`${tag} already exists`);
  process.exit(1);
}

if (write) {
  pkg.version = next;
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const lockPath = 'package-lock.json';
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  if (lock.packages?.[component.dir]) {
    lock.packages[component.dir].version = next;
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
  }
}

if (notesFile !== undefined) {
  const repo = process.env.GITHUB_REPOSITORY;
  const link = (c) =>
    c.pr
      ? repo
        ? `[#${c.pr}](https://github.com/${repo}/pull/${c.pr})`
        : `#${c.pr}`
      : c.sha.slice(0, 7);
  const sections = [
    ['breaking', 'Breaking changes'],
    ['feature', 'Features'],
    ['fix', 'Fixes'],
    ['other', 'Other changes'],
  ];
  const lines = [];
  for (const [kind, heading] of sections) {
    const items = changes.filter((c) => c.kind === kind);
    if (!items.length) continue;
    lines.push(`### ${heading}`, '', ...items.map((c) => `- ${c.title} (${link(c)})`), '');
  }
  if (!changes.length) lines.push(`No changes to the ${name} since ${previous}.`, '');

  lines.push('### Compatibility', '');
  lines.push(`- Works with the ${component.peer} ${peerMinimum} or newer.`);
  if (droppedPeers) {
    lines.push(
      `- **Drops support for the ${component.peer} before ${peerMinimum}** (was ${peerMinimumBefore}). Update it first.`,
    );
  }
  lines.push('');
  if (previous && repo) {
    lines.push(`**Full changelog:** https://github.com/${repo}/compare/${previous}...${tag}`, '');
  }
  writeFileSync(notesFile, lines.join('\n'));
}

console.log(`version=${next}`);
console.log(`tag=${tag}`);
console.log(`previous=${previous ?? ''}`);
console.log(`bump=${base ? bump : 'initial'}`);
console.log(`changes=${changes.length}`);
console.log(`title=${component.title} v${next}`);
