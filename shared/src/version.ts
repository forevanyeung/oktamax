/**
 * Version compatibility between the extension and the chat server.
 *
 * The two are released separately (`extension-v*` and `server-v*` tags), and either can be ahead
 * of the other: Chrome updates the extension on its own schedule, and whoever runs the server
 * deploys it on theirs. Each side tells the other its version, and each holds the oldest version
 * of the other it still works with. When a change breaks the contract, raise the minimum here in
 * the same change; the release script then makes it a major release of the side that broke it.
 *
 * - The server checks the extension's version on every `/api/*` request and answers 426 when it's
 *   too old, so an outdated extension is told to update rather than failing in odd ways.
 * - The extension checks the server's version in `GET /api/config`, and shows that the server
 *   needs updating instead of chatting with one that's too old.
 */

/** The oldest server version this extension works with. */
export const MIN_SERVER_VERSION = '0.1.0';

/** The oldest extension version this server works with. */
export const MIN_EXTENSION_VERSION = '0.1.0';

/**
 * The version of an extension or server from before they reported one. Both were 0.1.0 then, so a
 * peer that says nothing is treated as 0.1.0: compatible until a minimum is raised past it.
 */
export const UNVERSIONED = '0.1.0';

/** Request header the extension sends its version in. */
export const EXTENSION_VERSION_HEADER = 'X-Oktamax-Extension-Version';

/** Body of the server's 426 answer to an extension older than `minExtensionVersion`. */
export interface ExtensionOutdated {
  error: 'extension_outdated';
  serverVersion: string;
  minExtensionVersion: string;
}

const parse = (version: string) => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) throw new Error(`Not a version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
};

/** Negative when a < b, 0 when equal, positive when a > b. Pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/** Whether `version` is `min` or newer. A missing or malformed version is taken as `UNVERSIONED`. */
export function isAtLeast(version: string | undefined | null, min: string): boolean {
  try {
    return compareVersions(version || UNVERSIONED, min) >= 0;
  } catch {
    return compareVersions(UNVERSIONED, min) >= 0;
  }
}
