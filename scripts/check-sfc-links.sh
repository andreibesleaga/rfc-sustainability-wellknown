#!/usr/bin/env bash
# Checks that every link into sfc-compliance/ in the SFC profile text resolves on GitHub main.
# Run it after the files are pushed and before the profile is released or deposited.
#
# usage: scripts/check-sfc-links.sh [path to SFC_COMPLIANCE.md]
# exit:  0 when every link answers 200 and the local counts match; 1 otherwise; 2 on a usage error.
#
# Needs network (curl). It is not part of scripts/test-everything.sh, which runs offline.
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SPEC="${1:-$HOME/work/awesome/awesome-blockchain-greentech/Innovative Projects/SFC_COMPLIANCE.md}"
[ -f "$SPEC" ] || { echo "check-sfc-links: no such file: $SPEC" >&2; exit 2; }

PATTERN='github\.com/andreibesleaga/rfc-sustainability-wellknown/(blob|tree)/main/sfc-compliance[^) `"<>]*'
failed=0

while IFS= read -r link; do
  url="https://${link%%[.,;]}"
  code="$(curl -s -o /dev/null -L -w '%{http_code}' --max-time 30 "$url")"
  if [ "$code" = "200" ]; then echo "ok    $url"; else echo "FAIL  $code  $url"; failed=$((failed + 1)); fi
done < <(grep -oE "$PATTERN" "$SPEC" | sort -u)

# The pushed tree must hold what the local tree holds: all schemas, the vectors and the examples.
base="https://api.github.com/repos/andreibesleaga/rfc-sustainability-wellknown/contents/sfc-compliance"
for dir in schemas vectors examples; do
  local_count="$(find "$ROOT/sfc-compliance/$dir" -maxdepth 1 -type f | wc -l)"
  remote_count="$(curl -s --max-time 30 "$base/$dir" | grep -c '"type": *"file"')"
  if [ "$remote_count" -ge "$local_count" ] && [ "$local_count" -gt 0 ]; then echo "ok    $dir: $remote_count files pushed, $local_count local"
  else echo "FAIL  $dir: $remote_count files pushed, $local_count local"; failed=$((failed + 1)); fi
done

[ "$failed" -eq 0 ] && echo "all SFC links resolve" || echo "$failed check(s) failed"
[ "$failed" -eq 0 ]
