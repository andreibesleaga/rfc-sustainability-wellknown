#!/usr/bin/env bash
# Installs the SOURCE builds of the publisher and consumer into the gateway (without touching its
# package-lock.json), then builds the gateway, so the behaviour scenarios and fitness functions exercise
# the code in this repository rather than the last release on npm. `npm pack` packs exactly what
# `npm publish` would ship. Run after `npm run build` in publisher/ and consumer/.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
(cd "$ROOT/publisher" && npm pack --silent --pack-destination "$TMP" >/dev/null)
(cd "$ROOT/consumer" && npm pack --silent --pack-destination "$TMP" >/dev/null)
(cd "$ROOT/gateway" && npm install --no-save --no-audit --no-fund "$TMP"/sustainability-wellknown-publisher-*.tgz "$TMP"/sustainability-wellknown-consumer-*.tgz >/dev/null && npm run build >/dev/null)
want_pub=$(node -p "require('$ROOT/publisher/package.json').version")
want_con=$(node -p "require('$ROOT/consumer/package.json').version")
got_pub=$(node -p "require('$ROOT/gateway/node_modules/sustainability-wellknown-publisher/package.json').version")
got_con=$(node -p "require('$ROOT/gateway/node_modules/sustainability-wellknown-consumer/package.json').version")
if [ "$want_pub" != "$got_pub" ] || [ "$want_con" != "$got_con" ]; then
  echo "overlay failed: gateway has publisher $got_pub (want $want_pub), consumer $got_con (want $want_con)" >&2
  exit 1
fi
echo "gateway built against source publisher $got_pub and consumer $got_con"
