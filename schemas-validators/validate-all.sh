#!/usr/bin/env bash
# validate-all.sh — Run CDDL and JSON validators against all example-responses

set -uo pipefail

# Always run from the schemas-validators directory so relative schema paths work
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

EXAMPLES_DIR="../example-responses"
PASS=0
FAIL=0
ERRORS=()

if [[ ! -d "$EXAMPLES_DIR" ]]; then
    echo "Error: examples directory '$EXAMPLES_DIR' not found." >&2
    exit 1
fi

mapfile -t EXAMPLES < <(find "$EXAMPLES_DIR" -maxdepth 1 -name "*.json" | sort)

if [[ ${#EXAMPLES[@]} -eq 0 ]]; then
    echo "No JSON files found in $EXAMPLES_DIR" >&2
    exit 1
fi

echo "Found ${#EXAMPLES[@]} example file(s) to validate."
echo "========================================"

for example in "${EXAMPLES[@]}"; do
    filename="$(basename "$example")"
    echo "--- $filename"

    # JSON (JTD) validation
    if out=$(python3 validator-json.py "$example" 2>&1); then
        echo "  [JSON]  PASS"
        PASS=$((PASS + 1))
    else
        reason=$(echo "$out" | grep -m1 "Validation Failed\|Error\|Path:" | head -c 120)
        echo "  [JSON]  FAIL  ($reason)"
        FAIL=$((FAIL + 1))
        ERRORS+=("JSON: $filename")
    fi

    # CDDL validation
    if out=$(python3 validator-cddl.py "$example" 2>&1); then
        echo "  [CDDL]  PASS"
        PASS=$((PASS + 1))
    else
        reason=$(echo "$out" | grep -m1 "Validation Failed\|Error\|CDDL validation" | head -c 120)
        echo "  [CDDL]  FAIL  ($reason)"
        FAIL=$((FAIL + 1))
        ERRORS+=("CDDL: $filename")
    fi
done

echo ""
echo "========================================"
echo "Results: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
    echo ""
    echo "Failed validations:"
    for err in "${ERRORS[@]}"; do
        echo "  - $err"
    done
    exit 1
fi
