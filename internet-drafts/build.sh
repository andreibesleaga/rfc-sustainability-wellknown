#!/usr/bin/env bash
#
# Build and check the Internet-Draft.
#
#   ./build.sh                 build the highest-numbered draft in this directory
#   ./build.sh -06             build a specific revision
#   ./build.sh --no-idnits     skip the network idnits run
#   ./build.sh --help
#
# Produces <draft>.xml and <draft>.txt from <draft>.md and then checks:
#   * kramdown-rfc and xml2rfc --strict complete without error
#   * no rendered line exceeds 72 characters, and the text is pure ASCII
#   * no leaked Markdown code fences
#   * the schema references resolve and the stale RFC 8949 reference is absent
#   * the CDDL and JTD blocks in the draft still match schemas-validators/
#   * idnits (via the IETF author-tools API) reports zero errors
#
# Requirements:
#   kramdown-rfc  — gem install kramdown-rfc2629
#   xml2rfc       — pip install xml2rfc   (a virtualenv is fine; see NOTE below)
#   python3, curl
#
# NOTE on this repository's usual layout: the tools are commonly installed in a
# user gem dir and a virtualenv rather than system-wide. If they are not already
# on PATH, this script looks in the two locations used here:
#     ~/.local/share/gem/ruby/*/bin        (kramdown-rfc)
#     ~/.cache/sustain-venv/bin            (xml2rfc, and the python "jtd" module)
# Adjust or pre-set PATH if yours differ.

set -euo pipefail

RUN_IDNITS=1
REV=""

for arg in "$@"; do
  case "$arg" in
    --no-idnits) RUN_IDNITS=0 ;;
    -h|--help)   sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -[0-9][0-9]) REV="${arg#-}" ;;
    [0-9][0-9])  REV="$arg" ;;
    *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")"
REPO_ROOT="$(cd .. && pwd)"

# --- locate tools -----------------------------------------------------------
for d in "$HOME"/.local/share/gem/ruby/*/bin "$HOME/.cache/sustain-venv/bin"; do
  [ -d "$d" ] && case ":$PATH:" in *":$d:"*) ;; *) PATH="$PATH:$d" ;; esac
done
export PATH

missing=0
for tool in kramdown-rfc xml2rfc python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "ERROR: $tool not found on PATH" >&2
    case "$tool" in
      kramdown-rfc) echo "       install with: gem install kramdown-rfc2629" >&2 ;;
      xml2rfc)      echo "       install with: pip install xml2rfc" >&2 ;;
    esac
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1

# --- pick the draft ---------------------------------------------------------
BASE="draft-besleaga-sustainability-wellknown"
if [ -n "$REV" ]; then
  DRAFT="$BASE-$REV"
else
  DRAFT="$(ls "$BASE"-[0-9][0-9].md 2>/dev/null | sort | tail -1)"
  DRAFT="${DRAFT%.md}"
fi
[ -f "$DRAFT.md" ] || { echo "ERROR: $DRAFT.md not found" >&2; exit 1; }
echo "==> building $DRAFT"

fail=0
note_fail() { echo "    FAIL: $1"; fail=1; }

# --- build ------------------------------------------------------------------
kramdown-rfc "$DRAFT.md" > "$DRAFT.xml"
echo "    wrote $DRAFT.xml"
# --strict surfaces long-line and rendering warnings; keep its output visible.
xml2rfc --strict --text "$DRAFT.xml" -o "$DRAFT.txt"
echo "    wrote $DRAFT.txt"

# --- local checks -----------------------------------------------------------
echo "==> checks"

long=$(awk 'length > 72' "$DRAFT.txt" | wc -l | tr -d ' ')
if [ "$long" -eq 0 ]; then echo "    OK   no lines over 72 characters"
else note_fail "$long line(s) over 72 characters"; awk 'length>72 {print "         " FNR ": " $0}' "$DRAFT.txt" | head -5; fi

if LC_ALL=C grep -qP '[^\x00-\x7F]' "$DRAFT.txt" 2>/dev/null; then
  note_fail "non-ASCII characters in the rendered text"
else echo "    OK   pure ASCII"; fi

if grep -q '```' "$DRAFT.txt"; then note_fail "leaked Markdown code fences"
else echo "    OK   no leaked code fences"; fi

for ref in RFC8610 RFC7493 RFC8927; do
  grep -q "\[$ref\]" "$DRAFT.txt" || note_fail "reference [$ref] does not resolve"
done
grep -q "\[RFC8949\]" "$DRAFT.txt" && note_fail "stale RFC 8949 (CBOR) reference present" \
  || echo "    OK   references resolve, no stale RFC 8949"

# --- schema identity with schemas-validators/ -------------------------------
# The draft's CDDL block must be byte-identical to response-schema.cddl, and its
# JTD block must be the same JSON value as response-schema.json. CI enforces the
# same invariant; a mismatch here means the draft and the validators have drifted.
SCHEMA_DIR="$REPO_ROOT/schemas-validators"
if [ -d "$SCHEMA_DIR" ]; then
  awk '/^~~~ cddl/{f=1;next} /^~~~/{if(f)exit} f' "$DRAFT.md" > /tmp/.draft-cddl.$$
  if diff -q /tmp/.draft-cddl.$$ "$SCHEMA_DIR/response-schema.cddl" >/dev/null 2>&1; then
    echo "    OK   CDDL block matches schemas-validators/response-schema.cddl"
  else note_fail "CDDL block differs from schemas-validators/response-schema.cddl"; fi
  rm -f /tmp/.draft-cddl.$$

  python3 - "$DRAFT.md" "$SCHEMA_DIR/response-schema.json" <<'PY' || fail=1
import json, re, sys
md = open(sys.argv[1]).read()
blocks = re.findall(r'~~~ json\n(.*?)\n~~~', md, re.S)
jtd = [b for b in blocks if '"optionalProperties"' in b or '"definitions"' in b]
if not jtd:
    print("    FAIL: no JTD block found in the draft"); sys.exit(1)
if json.loads(jtd[0]) == json.load(open(sys.argv[2])):
    print("    OK   JTD block matches schemas-validators/response-schema.json")
else:
    print("    FAIL: JTD block differs from schemas-validators/response-schema.json"); sys.exit(1)
PY
else
  echo "    SKIP schema identity (schemas-validators/ not found)"
fi

# --- idnits (network) -------------------------------------------------------
if [ "$RUN_IDNITS" -eq 1 ]; then
  if command -v curl >/dev/null 2>&1; then
    echo "==> idnits (author-tools.ietf.org)"
    out=$(curl -sS --max-time 120 -X POST -F "file=@$DRAFT.txt" \
          https://author-tools.ietf.org/api/idnits 2>/dev/null || true)
    if [ -z "$out" ]; then
      echo "    SKIP could not reach author-tools.ietf.org"
    else
      echo "$out" | grep -E '^[[:space:]]+(\*\*|==|--)[^-]|^[[:space:]]+Summary:' | sed 's/^ */    /'
      summary=$(echo "$out" | grep -E 'Summary:' || true)
      errs=$(echo "$summary" | sed -n 's/.*Summary: \([0-9]*\) error.*/\1/p')
      [ "${errs:-0}" -eq 0 ] || note_fail "idnits reports $errs error(s)"
      # The single expected warning is non-RFC2606 FQDNs in citation URLs
      # (ghgprotocol.org, un.org, carbontxt.org) -- real references, not fixable.
    fi
  else
    echo "    SKIP idnits (curl not installed)"
  fi
fi

# --- warn if this rewrites an already-posted artifact -------------------------
# Rebuilding regenerates the date line ("Intended status: ... <today>") and the
# expiry, so re-running this on a revision that is already on the Datatracker
# silently makes the repo copy differ from the posted bytes. That matters: the
# repo is meant to carry exactly what was submitted. If you are preparing a NEW
# submission this is expected; otherwise restore with the command shown.
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
  if git ls-files --error-unmatch "$DRAFT.txt" >/dev/null 2>&1 \
     && ! git diff --quiet -- "$DRAFT.txt" 2>/dev/null; then
    if git diff -U0 -- "$DRAFT.txt" | grep -qE '^[+-].*(Expires|Intended status)'; then
      echo
      echo "    NOTE: $DRAFT.txt now differs from the committed copy in its date/expiry"
      echo "          lines. If this revision is already posted to the Datatracker, do not"
      echo "          commit the rebuild -- restore it with:"
      echo "            git checkout HEAD -- $DRAFT.txt $DRAFT.xml"
    fi
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "==> $DRAFT built and checked clean"
  echo "    submit $DRAFT.xml at https://datatracker.ietf.org/submit/"
  echo "    (bump the front-matter date in $DRAFT.md and re-run before submitting)"
else
  echo "==> $DRAFT FAILED one or more checks (see FAIL lines above)" >&2
  exit 1
fi
