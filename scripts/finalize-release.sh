#!/usr/bin/env bash
# Turns a nightly pre-release into a full release: scripts/finalize-release.sh <tag>
#
# Nightly notes only cover the changes since the previous nightly, so the full release's notes are
# rewritten to cover everything since the component's last full release. The extension is what
# most people install, so its releases are the repo's "latest". Needs gh, node and the repo's tags.
set -euo pipefail

tag=$1
component=${tag%%-v*}
prefix="$component-v"
version=${tag#"$prefix"}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}

if [[ "$(gh release view "$tag" -R "$repo" --json isPrerelease -q .isPrerelease)" != true ]]; then
  echo "$tag is already a full release."
  exit 0
fi

# The newest full release of this component older than this one.
since=$(gh release list -R "$repo" --exclude-pre-releases --exclude-drafts -L 1000 --json tagName -q '.[].tagName' |
  { grep "^$prefix" || true; } | sed "s/^$prefix//" | { cat; echo "$version"; } | sort -uV |
  awk -v v="$version" '$0 == v { print p; exit } { p = $0 }')

notes=$(mktemp)
node scripts/release.mjs "$component" --at "$tag" ${since:+--since "$prefix$since"} --notes "$notes" >/dev/null

latest=false
[[ "$component" == extension ]] && latest=true
gh release edit "$tag" -R "$repo" --prerelease=false --latest=$latest --notes-file "$notes"
echo "Promoted $tag to a full release${since:+ (changes since $prefix$since)}."
