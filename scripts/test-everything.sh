#!/usr/bin/env bash
# test-everything.sh — build and test every part of this repository in one run,
# from a clean clone, the way the CI workflows do.
#
#   git clone https://github.com/andreibesleaga/rfc-sustainability-wellknown
#   cd rfc-sustainability-wellknown
#   bash scripts/test-everything.sh            # everything
#   bash scripts/test-everything.sh --no-draft # skip the Internet-Draft build
#
# What it runs, in order (each step is the same command its CI workflow runs):
#   1. schemas         schemas-validators/validate-all.sh (JTD and CDDL on every example)
#   2. publisher       npm ci, typecheck, build, test
#   3. consumer        npm ci, typecheck, build, test (after the publisher build)
#   4. gateway         npm ci, typecheck, build, test, then the conformance battery
#                      against a local instance on 127.0.0.1:$GATEWAY_PORT (default 18080)
#   5. sfc-compliance  npm install (no lockfile by design), test, both reference declarations
#   6. example-scripts the Python, JavaScript and PHP safeguard tests and the request-handler
#                      end-to-end test
#   7. tools           tools/report-to-declaration: its tests and the offline demonstration
#   8. draft           builds the latest draft into a temporary directory (the files in
#                      internet-drafts/ are never rewritten) the way build.sh does: RFCXML v3
#                      vocabulary, v3-postprocess.py, strict xml2rfc, then idnits3 in normal
#                      mode, which must report no nit at all
#
# Not run here: the nginx and Apache configuration checks. They need both web servers
# installed system-wide and run in CI (full-verify.yml, example-scripts.yml).
#
# Needs: Node.js 22.12 or newer with npm, Python 3 with the `jtd` package, Ruby with the
# `cddl` gem, PHP 8 (CLI), network access to the npm registry; for step 7 also
# kramdown-rfc and xml2rfc. See CONTRIBUTING.md "Requirements". The Python packages and
# the gem can be installed with:  python3 schemas-validators/install.py
#
# Every step runs even if an earlier one fails; the summary at the end lists each
# result. Exit status 0 only if every step passed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUN_DRAFT=1
for arg in "$@"; do
  case "$arg" in
    --no-draft) RUN_DRAFT=0 ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

GATEWAY_PORT="${GATEWAY_PORT:-18080}"
LOG_DIR="$(mktemp -d "${TMPDIR:-/tmp}/test-everything.XXXXXX")"

# `gem install cddl` without sudo puts the executable in the user gem directory,
# which is often not on PATH (see schemas-validators/README.md). Add it if needed.
if ! command -v cddl >/dev/null 2>&1 && command -v ruby >/dev/null 2>&1; then
  PATH="$(ruby -e 'print Gem.user_dir')/bin:$PATH"
  export PATH
fi

# ---- prerequisites -------------------------------------------------------------
missing=()
if command -v node >/dev/null 2>&1; then
  if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; then
    missing+=("Node.js 22.12 or newer (found $(node -v))")
  fi
else
  missing+=("Node.js 22.12 or newer")
fi
command -v npm     >/dev/null 2>&1 || missing+=("npm")
command -v python3 >/dev/null 2>&1 || missing+=("python3")
python3 -c 'import jtd' >/dev/null 2>&1 || missing+=("Python package jtd (python3 -m pip install jtd)")
command -v cddl    >/dev/null 2>&1 || missing+=("Ruby gem cddl (gem install cddl)")
command -v php     >/dev/null 2>&1 || missing+=("PHP CLI")
command -v curl    >/dev/null 2>&1 || missing+=("curl")
if [ "$RUN_DRAFT" = 1 ]; then
  command -v kramdown-rfc >/dev/null 2>&1 || missing+=("kramdown-rfc (gem install kramdown-rfc2629) — or pass --no-draft")
  command -v xml2rfc      >/dev/null 2>&1 || missing+=("xml2rfc (python3 -m pip install xml2rfc) — or pass --no-draft")
fi
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing prerequisites:" >&2
  for m in "${missing[@]}"; do echo "  - $m" >&2; done
  exit 2
fi

# ---- runner --------------------------------------------------------------------
NAMES=()
RESULTS=()

step() {
  local name="$1"; shift
  local log="$LOG_DIR/$name.log"
  printf '%-18s ... ' "$name"
  local start=$SECONDS
  # Not inside `if`: bash ignores `set -e` there, and each step must stop at its first failure.
  ( set -e; "$@" ) >"$log" 2>&1
  if [ $? -eq 0 ]; then
    echo "pass ($((SECONDS - start)) s)"
    RESULTS+=("pass")
  else
    echo "FAIL ($((SECONDS - start)) s) — last lines of $log:"
    tail -n 25 "$log" | sed 's/^/    /'
    RESULTS+=("FAIL")
  fi
  NAMES+=("$name")
}

do_schemas() {
  bash schemas-validators/validate-all.sh
}

do_publisher() {
  cd "$ROOT/publisher"
  npm ci --no-audit --no-fund
  npm run typecheck
  npm run build
  npm test
}

do_consumer() {
  # consumer's interop test imports the publisher's dist/, so build it first
  # (a no-op when the publisher step already did).
  cd "$ROOT/publisher"
  [ -d node_modules ] || npm ci --no-audit --no-fund
  npm run build
  cd "$ROOT/consumer"
  npm ci --no-audit --no-fund
  npm run typecheck
  npm run build
  npm test
}

do_gateway() {
  cd "$ROOT/gateway"
  npm ci --no-audit --no-fund
  npm run typecheck
  npm run build
  npm test
  PORT="$GATEWAY_PORT" node dist/index.js &
  # The step runs in its own subshell, so an EXIT trap stops the server however the step ends.
  trap "kill $! 2>/dev/null" EXIT
  local ok=0
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:$GATEWAY_PORT/healthz" >/dev/null; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = 1 ] || { echo "gateway did not become healthy on port $GATEWAY_PORT"; return 1; }
  npm run conformance -- "http://127.0.0.1:$GATEWAY_PORT" --allow-http
}

do_sfc() {
  cd "$ROOT/sfc-compliance"
  npm install --no-audit --no-fund
  npm test
  node sfc-check.mjs examples/sfc-network.example.json
  node sfc-check.mjs examples/sfc-operator.example.json
}

do_example_scripts() {
  cd "$ROOT/example-scripts"
  python3 test_security.py
  node test_security.js
  php test_security.php
  python3 test_request_handler.py
}

do_tools() {
  cd "$ROOT/tools/report-to-declaration"
  node --test test/*.test.mjs
  # The demonstration exits 3 by design: it writes a candidate and waits for a reviewer.
  local out="$LOG_DIR/r2d"
  node extract.mjs --source fixtures/demo-report.txt --replay fixtures/demo-model-reply.json \
    --target "Example Hosting Ltd" --methodology-uri https://hosting.example/reports/2025.pdf \
    --target-type organization --source-differs --out "$out" || [ $? -eq 3 ]
  test -f "$out/candidate.json" && ! test -f "$out/declaration.json"
}

do_draft() {
  local md base out n
  cd "$ROOT/internet-drafts"
  md=$(ls draft-besleaga-sustainability-wellknown-*.md | sort | tail -1)
  base="${md%.md}"
  out="$LOG_DIR/draft"
  mkdir -p "$out"
  cp "$md" "$out/"
  cd "$out"
  # The same pipeline as build.sh: v3 vocabulary, then the idnits3 clean-up.
  kramdown-rfc -3 "$md" > "$base.v2.xml"
  xml2rfc --v2v3 --strict "$base.v2.xml" -o "$base.xml"
  python3 "$ROOT/internet-drafts/v3-postprocess.py" "$base.xml"
  xml2rfc --strict --text "$base.xml" -o "$base.txt"
  npx --yes @ietf-tools/idnits -m normal --no-progress --no-color "$base.xml" | tee idnits.out
  n=$(npx --yes @ietf-tools/idnits -m normal -o count --no-progress "$base.xml" | tail -1)
  [ "$n" = "0" ]
}

echo "Testing $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo 'working tree') with Node $(node -v); logs in $LOG_DIR"
step schemas         do_schemas
step publisher       do_publisher
step consumer        do_consumer
step gateway         do_gateway
step sfc-compliance  do_sfc
step example-scripts do_example_scripts
step tools           do_tools
if [ "$RUN_DRAFT" = 1 ]; then step draft do_draft; fi

echo
echo "Summary"
fail=0
for i in "${!NAMES[@]}"; do
  printf '  %-18s %s\n' "${NAMES[$i]}" "${RESULTS[$i]}"
  [ "${RESULTS[$i]}" = pass ] || fail=1
done
[ "$RUN_DRAFT" = 1 ] || echo "  draft              skipped (--no-draft)"
echo "  nginx/Apache       not run here (CI only)"
if [ "$fail" = 0 ]; then echo "All steps passed."; else echo "Some steps failed; full logs in $LOG_DIR"; fi
exit "$fail"
