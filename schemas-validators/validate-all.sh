#!/usr/bin/env bash
# validate-all.sh — Run the CDDL and JTD validators over the example corpus and
# compare each exit status with the verdict recorded in examples/manifest.json.
#
#   ./validate-all.sh                     the manifest corpus (served files included)
#
# --example-responses and EXAMPLE_RESPONSES=10 are accepted and change nothing: the
# files of ../example-responses/ are manifest entries (E01 and on) and always run.
#
# Corpus: examples/manifest.json is an array of entries
#   { "id": "I06", "path": "invalid/period-bound-not-string.json",
#     "cddl": false, "jtd": false, ... }
# where "path" is relative to examples/, "cddl" is the verdict of
# validator-cddl.py and "jtd" the verdict of validator-json.py (true = exit 0,
# false = non-zero). An entry without a "cddl" or "jtd" member is not run
# through that validator. An entry with a "golden" member (the output of
# sustainability-publisher upgrade for a file of legacy/in/) also has that file
# checked: both validators must accept it, the declaration inside a
# { "document": ... } wrapper being the one checked. The run fails when any verdict differs from the
# manifest, in either direction: a file expected to fail that starts to pass is
# reported as loudly as the reverse.
#
# First check: the CDDL block of the draft equals response-schema.cddl.
#
# Every file of ../example-responses/ must be a manifest entry.
#
# Needs python3 with the jtd package (PYTHON overrides the interpreter) and the
# cddl gem 0.12.14 on PATH. Exit status: 0 when every verdict matches, 1 on a
# mismatch, 2 when a tool is missing or an argument is unknown.

set -uo pipefail

# Always run from the schemas-validators directory so relative schema paths work
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PYTHON="${PYTHON:-python3}"
CORPUS_DIR="examples"
MANIFEST="$CORPUS_DIR/manifest.json"
EXAMPLES_DIR="../example-responses"
DRAFT="../internet-drafts/draft-besleaga-sustainability-wellknown-11.md"

for arg in "$@"; do
    case "$arg" in
        --example-responses) ;;  # accepted for older callers; the files always run
        -h|--help) sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "unknown argument: $arg (try --help)" >&2; exit 2 ;;
    esac
done

if [[ ! -f "$MANIFEST" ]]; then
    echo "Error: manifest '$MANIFEST' not found." >&2
    exit 1
fi

# A missing tool would otherwise show up as a verdict mismatch on every entry.
if ! command -v cddl >/dev/null 2>&1; then
    echo "Error: the 'cddl' tool is not on PATH (gem install cddl -v 0.12.14)." >&2
    exit 2
fi
if ! "$PYTHON" -c 'import jtd' >/dev/null 2>&1; then
    echo "Error: $PYTHON cannot import jtd (pip install -r requirements.txt, or set PYTHON)." >&2
    exit 2
fi

PASS=0
FAIL=0
ERRORS=()

# verdict <validator> <file>: prints "true" when the validator exits 0
verdict() {
    if "$PYTHON" "$1" "$2" >/dev/null 2>&1; then echo true; else echo false; fi
}

# expect <label> <validator> <file> <expected>: compare and count
expect() {
    local label="$1" validator="$2" file="$3" want="$4" got
    got="$(verdict "$validator" "$file")"
    if [[ "$got" == "$want" ]]; then
        PASS=$((PASS + 1))
    else
        echo "  [$label] MISMATCH  expected $want, got $got"
        FAIL=$((FAIL + 1))
        ERRORS+=("$label: $file (expected $want, got $got)")
    fi
}

# --- the draft's CDDL block is the schema file ---------------------------------
if [[ -f "$DRAFT" ]]; then
    if awk '/^~~~ cddl/{f=1;next} /^~~~/{if(f)exit} f' "$DRAFT" | cmp -s - response-schema.cddl; then
        echo "[identity] draft CDDL block == response-schema.cddl"
        PASS=$((PASS + 1))
    else
        echo "[identity] MISMATCH  draft CDDL block differs from response-schema.cddl"
        FAIL=$((FAIL + 1))
        ERRORS+=("identity: draft CDDL block differs from response-schema.cddl")
    fi
fi

# --- the manifest corpus -------------------------------------------------------
# One line per entry: id, path, cddl verdict, jtd verdict ("-" when absent)
UNWRAPPED="$(mktemp -d)"
trap 'rm -rf "$UNWRAPPED"' EXIT
mapfile -t ENTRIES < <("$PYTHON" - "$MANIFEST" "$UNWRAPPED" <<'PY'
import json, os, sys
def v(x):
    return "-" if x is None else ("true" if x else "false")
corpus = os.path.dirname(sys.argv[1])
for e in json.load(open(sys.argv[1])):
    print("\t".join([e["id"], e["path"], v(e.get("cddl")), v(e.get("jtd"))]))
    if e.get("golden"):
        golden = os.path.join(corpus, e["golden"])
        doc = json.load(open(golden))
        if isinstance(doc, dict) and "document" in doc and "target" not in doc:
            golden = os.path.join(sys.argv[2], os.path.basename(golden))
            json.dump(doc["document"], open(golden, "w"))
        print("\t".join([e["id"] + " golden", golden, "true", "true"]))
PY
)

if [[ ${#ENTRIES[@]} -eq 0 ]]; then
    echo "Error: no entries in $MANIFEST" >&2
    exit 1
fi

echo "Manifest: ${#ENTRIES[@]} entries."
echo "========================================"

for entry in "${ENTRIES[@]}"; do
    IFS=$'\t' read -r id path want_cddl want_jtd <<< "$entry"
    file="$CORPUS_DIR/$path"
    [[ "$path" == "$CORPUS_DIR"/* || "$path" == /* ]] && file="$path"
    if [[ ! -f "$file" ]]; then
        echo "$id $path"
        echo "  [file]  MISSING"
        FAIL=$((FAIL + 1))
        ERRORS+=("$id: $path is listed in the manifest but not on disk")
        continue
    fi
    [[ "$want_jtd"  != "-" ]] && expect "$id JTD"  validator-json.py  "$file" "$want_jtd"
    [[ "$want_cddl" != "-" ]] && expect "$id CDDL" validator-cddl.py  "$file" "$want_cddl"
done

# Every file of the four schema directories must be in the manifest (a file
# nobody expects anything of is a gap)
declare -A LISTED=()
for entry in "${ENTRIES[@]}"; do
    IFS=$'\t' read -r _ path _ <<< "$entry"
    LISTED["$path"]=1
done
for dir in valid tolerated invalid prose; do
    [[ -d "$CORPUS_DIR/$dir" ]] || continue
    while IFS= read -r f; do
        rel="${f#"$CORPUS_DIR"/}"
        if [[ -z "${LISTED[$rel]:-}" ]]; then
            echo "$rel is on disk but not in the manifest"
            FAIL=$((FAIL + 1))
            ERRORS+=("$rel is on disk but not in the manifest")
        fi
    done < <(find "$CORPUS_DIR/$dir" -name "*.json" | sort)
done

# --- the served example files are in the manifest -----------------------------
for f in "$EXAMPLES_DIR"/*.json; do
    rel="../../example-responses/$(basename "$f")"
    if [[ -z "${LISTED[$rel]:-}" ]]; then
        echo "$rel is on disk but not in the manifest"
        FAIL=$((FAIL + 1))
        ERRORS+=("$rel is on disk but not in the manifest")
    fi
done

echo ""
echo "========================================"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "Failed checks:"
    for err in "${ERRORS[@]}"; do
        echo "  - $err"
    done
    exit 1
fi
