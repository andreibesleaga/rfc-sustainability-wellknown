#!/usr/bin/env bash
# Runs the plugin in a real WordPress (official Docker images: MariaDB, WordPress, WP-CLI), activates it with
# pretty permalinks, saves a declaration through WordPress's own option API, then checks the endpoint with the
# reference consumer in strict mode and prints the WordPress version it ran on. It also checks that query values
# are ignored (never refused) and that a declaration saved by plugin 0.1 (one period label) is published as a period.
# Needs Docker and Node. The consumer is the published package; to test a local build, install its `npm pack`
# tarball into a scratch folder and set SUSTAINABILITY_FETCH to the program there. Everything runs on a private network and a loopback port; everything is removed after.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN="$HERE/sustainability-data-wellknown"
PORT="${PORT:-18099}"
CHECK=(npx -y -p sustainability-wellknown-consumer@^0.8.0 sustainability-fetch)
[ -z "${SUSTAINABILITY_FETCH:-}" ] || CHECK=("$SUSTAINABILITY_FETCH")
NAME="sdwk-e2e-$$"
NET="$NAME-net"
DBPASS="e2e-$$-pw"
cleanup() { docker rm -f "$NAME-db" "$NAME-wp" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker network create "$NET" >/dev/null
docker run -d --name "$NAME-db" --network "$NET" -e MARIADB_ROOT_PASSWORD="$DBPASS" -e MARIADB_DATABASE=wp mariadb:11 >/dev/null
docker run -d --name "$NAME-wp" --network "$NET" -p "127.0.0.1:$PORT:80" \
  -e WORDPRESS_DB_HOST="$NAME-db" -e WORDPRESS_DB_USER=root -e WORDPRESS_DB_PASSWORD="$DBPASS" -e WORDPRESS_DB_NAME=wp \
  -v "$PLUGIN:/var/www/html/wp-content/plugins/sustainability-data-wellknown:ro" wordpress:latest >/dev/null

wp() { docker run --rm --network "$NET" --volumes-from "$NAME-wp" --user 33:33 \
  -e WORDPRESS_DB_HOST="$NAME-db" -e WORDPRESS_DB_USER=root -e WORDPRESS_DB_PASSWORD="$DBPASS" -e WORDPRESS_DB_NAME=wp \
  wordpress:cli wp "$@"; }

for _ in $(seq 1 60); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 2; done
for _ in $(seq 1 30); do wp db check >/dev/null 2>&1 && break; sleep 2; done
wp core install --url="http://127.0.0.1:$PORT" --title=e2e --admin_user=admin --admin_password="$DBPASS" --admin_email=e2e@example.com --skip-email >/dev/null
wp rewrite structure '/%postname%/' >/dev/null
wp plugin activate sustainability-data-wellknown >/dev/null
VERSION=$(wp core version)

# Before any settings: 404.
code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/.well-known/sustainability-data")
[ "$code" = 404 ] || { echo "FAIL: expected 404 before settings, got $code"; exit 1; }

wp option update sdwk_declaration --format=json '{"provider":"E2E Example (https://e2e.example/contact)","methodology_uri":"https://e2e.example/methodology","period_start":"2026-09-01T00:00:00Z","period_end":"2026-10-01T00:00:00Z","measurement_method":"third-party-modeled","target":"e2e.example","target_type":"origin","energy_kwh":"12.5","carbon_kgco2e":"3.06","scope_2":"3.06","carbon_accounting":"market-based","disclosure_uri":"https://e2e.example/sustainability","saved_at":1790000000}' >/dev/null

"${CHECK[@]}" "http://127.0.0.1:$PORT" --strict --allow-http --verify
URL="http://127.0.0.1:$PORT/.well-known/sustainability-data"
plain=$(curl -s "$URL")
printf '%s' "$plain" | grep -q '"start": "2026-09-01T00:00:00Z"' || { echo "FAIL: the document has no period object"; exit 1; }
printf '%s' "$plain" | grep -q '"reporting-period"' && { echo "FAIL: the document still has reporting-period"; exit 1; }
for q in 'start=2026-09-01T00:00:00Z&end=2026-10-01T00:00:00Z&target=e2e.example' 'start=yesterday' 'start=2026-09-01T00:00:00%2B02:00' 'granularity=weekly' 'foo=1'; do
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$URL?$q")" = 200 ] && [ "$(curl -s "$URL?$q")" = "$plain" ] || { echo "FAIL: ?$q is not ignored"; exit 1; }
done
post=$(curl -s -i -X POST "http://127.0.0.1:$PORT/.well-known/sustainability-data" | tr -d '\r')
printf '%s\n' "$post" | head -1 | grep -q ' 405' || { echo "FAIL: POST did not answer 405"; exit 1; }
printf '%s\n' "$post" | grep -qi '^allow: GET, HEAD' || { echo "FAIL: 405 without Allow"; exit 1; }
# A site that saved a one-label period with plugin 0.1 publishes the start and end it stood for.
wp option update sdwk_declaration --format=json '{"provider":"E2E Example (https://e2e.example/contact)","methodology_uri":"https://e2e.example/methodology","period":"2026","measurement_method":"third-party-modeled","carbon_kgco2e":"3.06","saved_at":1790000000}' >/dev/null
curl -s "$URL" | grep -q '"end": "2027-01-01T00:00:00Z"' || { echo "FAIL: a saved 2026 label did not become a period"; exit 1; }
other=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/?sdwk_declaration=1")
[ "$other" != "200" ] || ! curl -s "http://127.0.0.1:$PORT/?sdwk_declaration=1" | grep -q '"period"' || { echo "FAIL: the document is served at another URL"; exit 1; }
echo "PASS  wordpress $VERSION: plugin activated, 404 before settings, declaration valid and signed, 405 with Allow, no other URL serves it"
