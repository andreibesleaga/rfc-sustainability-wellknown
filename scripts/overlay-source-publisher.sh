#!/usr/bin/env bash
# Installs the SOURCE build of the publisher into a package that depends on it (for example
# tools/create-sustainability-data), without touching that package's lockfile, so its tests exercise the code
# in this repository rather than the last release on npm. `npm pack` packs exactly what `npm publish` would
# ship. Run after `npm run build` in publisher/.
#
#   bash scripts/overlay-source-publisher.sh tools/create-sustainability-data
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$#" -ne 1 ] || [ ! -f "$ROOT/$1/package.json" ]; then
  echo "usage: bash scripts/overlay-source-publisher.sh <package directory, relative to the repository root>" >&2
  exit 2
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
(cd "$ROOT/publisher" && npm pack --silent --pack-destination "$TMP" >/dev/null)
(cd "$ROOT/$1" && npm install --no-save --package-lock=false --no-audit --no-fund "$TMP"/sustainability-wellknown-publisher-*.tgz >/dev/null)
want=$(node -p "require('$ROOT/publisher/package.json').version")
got=$(node -p "require('$ROOT/$1/node_modules/sustainability-wellknown-publisher/package.json').version")
if [ "$want" != "$got" ]; then
  echo "overlay failed: $1 has publisher $got (want $want)" >&2
  exit 1
fi
echo "$1 uses the source publisher $got"
