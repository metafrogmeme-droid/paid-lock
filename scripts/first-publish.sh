#!/usr/bin/env bash
# One-time first publish of the five npm packages from the owner's own machine (docs/RELEASE.md,
# "First publish (one time)"). npm trusted publishing cannot create a package that does not exist yet
# (release run 42943216299 stopped with E404 on @paid-lock/core), so 0.1.0 goes out once by hand; from 0.1.1
# the release workflow publishes through trusted publishing.
#
# Usage:
#   bash scripts/first-publish.sh             dry run (the default): every check, then npm publish --dry-run
#   bash scripts/first-publish.sh --publish   publish for real, after you type "publish <version>"
#
# Uses only your own `npm login` session (with 2FA; npm asks for the one-time code itself). It never reads,
# writes or asks for an npm token, and none belongs in the repository or CI. Stops at the first error.
# It runs the same gates as .github/workflows/release.yml, in the same order, and publishes the same
# pnpm-packed tarballs (pnpm rewrites workspace:* to real versions; a plain npm publish would not). No
# provenance: npm only issues it from CI, so 0.1.0 has none and 0.1.1 onwards does.
#
# Credit: HUMANOID-TRADERS · RUNECLAW, Patrick Baur, CEO.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

# Dependency order, the same as PUBLISHED in scripts/lib/release.ts and the release workflow.
PACKAGES=(packages/core packages/protocols packages/probe packages/runtime packages/cli)
REGISTRY=https://registry.npmjs.org
NPM_ORG=paid-lock

say() { echo "first-publish: $*"; }
die() {
  echo "first-publish: $*" >&2
  exit 1
}
usage() {
  echo "usage: bash scripts/first-publish.sh [--publish]   (dry run without --publish)" >&2
}

mode=dry-run
if [ $# -gt 1 ]; then
  usage
  exit 2
fi
case "${1-}" in
  "") ;;
  --publish) mode=publish ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 2
    ;;
esac
say "mode: $mode"

for tool in node pnpm npm git; do
  command -v "$tool" >/dev/null || die "$tool not found"
done

# 1. The public npm registry, nothing else.
registry=$(npm config get registry)
[ "${registry%/}" = "$REGISTRY" ] || die "npm registry is ${registry}, expected ${REGISTRY}/"

# 2. A clean checkout of main, equal to origin/main (the release workflow also publishes only from main).
[ -z "$(git status --porcelain)" ] || die "the working tree has changes; publish from a clean checkout of main"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || die "not on main"
git fetch --quiet origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "main is not equal to origin/main; run git pull"

# 3. The release gate: versions, not private, MIT, CLI VERSION, CHANGELOG section.
version=$(node -p 'require("./packages/core/package.json").version')
node scripts/release-check.ts "$version" "publish $version"

# 4. Logged in to npm, as a member of the paid-lock organisation (owner of the @paid-lock scope).
user=$(npm whoami 2>/dev/null) || die "not logged in to npm; run: npm login (an account with 2FA)"
say "npm user: $user"
npm org ls "$NPM_ORG" "$user" >/dev/null 2>&1 ||
  die "npm user $user is not a member of the npm organisation $NPM_ORG (create it on npmjs.com first)"

# 5. No package is already at this version on the registry.
names=()
for dir in "${PACKAGES[@]}"; do
  name=$(node -p "require('./$dir/package.json').name")
  names+=("$name")
  if out=$(npm view "$name@$version" version 2>&1); then
    [ -z "$out" ] || die "$name@$version is already on the registry; nothing published"
  elif ! grep -q E404 <<<"$out"; then
    die "could not check $name@$version on the registry: $(head -n 1 <<<"$out")"
  fi
  say "$name@$version is not on the registry yet"
done

# 6. Full check and demo, as in the release workflow.
pnpm install --frozen-lockfile
pnpm check
pnpm demo

# 7. Pack each package into its own folder.
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
tarballs=()
for i in "${!PACKAGES[@]}"; do
  mkdir -p "$work/$i"
  (cd "${PACKAGES[$i]}" && pnpm pack --pack-destination "$work/$i" >/dev/null)
  found=("$work/$i"/*.tgz)
  [ "${#found[@]}" -eq 1 ] && [ -f "${found[0]}" ] || die "expected one tarball for ${PACKAGES[$i]}"
  tarballs+=("${found[0]}")
done

# 8. Typed confirmation before a real publish.
if [ "$mode" = publish ]; then
  say "about to publish ${names[*]} at $version to $REGISTRY as $user"
  printf 'Type "publish %s" to continue: ' "$version"
  read -r answer || answer=""
  [ "$answer" = "publish $version" ] || die "not confirmed; nothing published"
fi

# 9. Publish in dependency order; set -e stops at the first failure.
for i in "${!tarballs[@]}"; do
  if [ "$mode" = publish ]; then
    npm publish "${tarballs[$i]}" --access public
    say "published ${names[$i]}@$version"
  else
    npm publish "${tarballs[$i]}" --access public --dry-run
  fi
done

if [ "$mode" = publish ]; then
  say "done: ${#tarballs[@]} packages at $version. Next: add a trusted publisher to each (docs/RELEASE.md)."
else
  say "dry run OK: ${#tarballs[@]} packages at $version would be published. Run again with --publish to publish."
fi
