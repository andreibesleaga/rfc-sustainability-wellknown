#!/usr/bin/env bash
# Starts each CI-marked recipe on a loopback port and validates it with the reference consumer in
# strict mode (plain HTTP allowed, loopback only). Every recipe must pass every MUST of the draft, and
# answer 405 with "Allow: GET, HEAD" (or 403) to other methods, and HEAD like GET.
#
# Each recipe runs in its own process group, which is killed as a whole afterwards, and the port must be
# free before a recipe starts and free again after it stops: a recipe can never be validated against a
# server left over from another one.
#
# Usage: bash deploy/e2e/run.sh [recipe ...]   (default: every recipe whose tool is installed)
# Recipes: express fastify koa flask fastapi php go caddy nginx apache haproxy-config terraform-config
set -euo pipefail
set -m # job control: every background job is its own process group
HERE="$(cd "$(dirname "$0")" && pwd)"
KIT="$(cd "$HERE/.." && pwd)"
PORT="${PORT:-18090}"
DOC="$KIT/www/.well-known/sustainability-data"
CHECK=(npx -y -p sustainability-wellknown-consumer sustainability-fetch)
URL="http://127.0.0.1:$PORT/.well-known/sustainability-data"
fail=0

port_busy() { ss -ltn 2>/dev/null | grep -q "[:.]$PORT "; }

require_free_port() {
  if port_busy; then
    echo "ABORT: port $PORT is already in use before starting $1; every later result would be meaningless" >&2
    exit 2
  fi
}

wait_up() {
  for _ in $(seq 1 120); do
    curl -sf -o /dev/null "$URL" && return 0
    sleep 0.5
  done
  return 1
}

stop() { # pid: kill the recipe's whole process group, then wait for the port to be released
  kill -- -"$1" 2>/dev/null || kill "$1" 2>/dev/null || true
  wait "$1" 2>/dev/null || true
  for _ in $(seq 1 40); do port_busy || return 0; sleep 0.25; done
  return 1
}

check() { # name pid
  local name="$1" pid="$2" ok=1 post code g h head
  if wait_up; then
    "${CHECK[@]}" "http://127.0.0.1:$PORT" --strict --allow-http || ok=0
    post=$(curl -s -i -X POST "$URL" | tr -d '\r')
    code=$(printf '%s\n' "$post" | head -1 | awk '{print $2}')
    case "$code" in
      405) printf '%s\n' "$post" | grep -qi '^allow: *get, *head$' || { echo "$name: 405 without Allow: GET, HEAD"; ok=0; } ;;
      403) ;;
      *) echo "$name: POST answered $code, expected 405 (or 403)"; ok=0 ;;
    esac
    g=$(curl -s -D - -o /dev/null "$URL" | tr -d '\r' | grep -i '^content-length:' | cut -d' ' -f2 || true)
    h=$(curl -s -I "$URL" | tr -d '\r' | grep -i '^content-length:' | cut -d' ' -f2 || true)
    if [ -n "$h" ] && [ -n "$g" ] && [ "$h" != "$g" ]; then echo "$name: HEAD Content-Length $h differs from GET $g"; ok=0; fi
    head=$(curl -s -I "$URL" | tr -d '\r' | grep -i '^content-type:' || true)
    case "$head" in *sustainability-data+json*) ;; *) echo "$name: HEAD content-type: $head"; ok=0 ;; esac
  else
    echo "$name: did not start on port $PORT"; ok=0
  fi
  if ! stop "$pid"; then echo "$name: still listening on $PORT after stop"; ok=0; fi
  if [ "$ok" = 1 ]; then echo "PASS  $name"; else echo "FAIL  $name"; fail=1; fi
}

start() { # name, then the command; runs it in its own process group and checks it
  local name="$1"; shift
  require_free_port "$name"
  "$@" &
  check "$name" $!
}

run_express() { start express env SD_FILE="$DOC" PORT="$PORT" node "$KIT/frameworks/node/express.mjs"; }
run_fastify() { start fastify env SD_FILE="$DOC" PORT="$PORT" node "$KIT/frameworks/node/fastify.mjs"; }
run_koa()     { start koa env SD_FILE="$DOC" PORT="$PORT" node "$KIT/frameworks/node/koa.mjs"; }
run_flask()   { start flask env SD_FILE="$DOC" PORT="$PORT" python3 "$KIT/frameworks/python/flask_app.py"; }
run_fastapi() { start fastapi env SD_FILE="$DOC" python3 -m uvicorn --app-dir "$KIT/frameworks/python" fastapi_app:app --host 127.0.0.1 --port "$PORT" --log-level warning; }
run_php()     { start php env SD_FILE="$DOC" php -S "127.0.0.1:$PORT" "$KIT/frameworks/php/router.php"; }
run_go() {
  # Built first, so the process under test is the server itself, not `go run` and a child.
  (cd "$KIT/frameworks/go" && go build -o "$HERE/.go-bin" .)
  start go env SD_FILE="$DOC" PORT="$PORT" "$HERE/.go-bin"
}
run_caddy() {
  ln -sfn "$KIT/www" "$KIT/proxies/caddy/www"
  if command -v caddy >/dev/null; then
    start caddy bash -c "cd '$KIT/proxies/caddy' && exec caddy run --config Caddyfile --adapter caddyfile"
  else
    start caddy docker run --rm --network host -v "$KIT/proxies/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$KIT/www:/srv/www:ro" -w /srv caddy:2-alpine \
      sh -c "sed 's/:8080/:$PORT/; s#root \\* www#root * /srv/www#' /etc/caddy/Caddyfile > /tmp/Caddyfile && exec caddy run --config /tmp/Caddyfile --adapter caddyfile"
  fi
  rm -f "$KIT/proxies/caddy/www"
}
run_nginx() {
  local prefix="$HERE/.nginx" conf
  mkdir -p "$prefix/logs"; conf="$prefix/nginx.conf"
  if command -v nginx >/dev/null; then
    cat > "$conf" <<EOF
pid $prefix/nginx.pid;
error_log $prefix/logs/error.log;
events { worker_connections 64; }
http {
  access_log off;
  client_body_temp_path $prefix/cb; proxy_temp_path $prefix/pt; fastcgi_temp_path $prefix/ft; uwsgi_temp_path $prefix/ut; scgi_temp_path $prefix/st;
  server {
    listen 127.0.0.1:$PORT;
    root $KIT/www;
    include $KIT/proxies/nginx/sustainability-data.conf;
  }
}
EOF
    start nginx nginx -c "$conf" -p "$prefix" -g 'daemon off;'
  else
    cat > "$conf" <<EOF
events { worker_connections 64; }
http {
  access_log off;
  server {
    listen 127.0.0.1:$PORT;
    root /srv/www;
    include /etc/nginx/sustainability-data.conf;
  }
}
EOF
    start nginx docker run --rm --network host -v "$conf:/etc/nginx/nginx.conf:ro" \
      -v "$KIT/proxies/nginx/sustainability-data.conf:/etc/nginx/sustainability-data.conf:ro" -v "$KIT/www:/srv/www:ro" nginx:alpine
  fi
}
run_apache() {
  local prefix="$HERE/.apache" conf mods="/usr/lib/apache2/modules"
  mkdir -p "$prefix"; conf="$prefix/httpd.conf"
  cat > "$conf" <<EOF
ServerRoot "$prefix"
PidFile "$prefix/httpd.pid"
ErrorLog "$prefix/error.log"
Listen 127.0.0.1:$PORT
LoadModule mpm_event_module $mods/mod_mpm_event.so
LoadModule authz_core_module $mods/mod_authz_core.so
LoadModule mime_module $mods/mod_mime.so
LoadModule dir_module $mods/mod_dir.so
LoadModule headers_module $mods/mod_headers.so
LoadModule rewrite_module $mods/mod_rewrite.so
TypesConfig /etc/mime.types
DocumentRoot "$KIT/www"
<Directory "$KIT/www">
  AllowOverride All
  Require all granted
</Directory>
EOF
  cp "$KIT/proxies/apache/.htaccess" "$KIT/www/.htaccess"
  start apache apache2 -f "$conf" -DFOREGROUND
  rm -f "$KIT/www/.htaccess"
}

# Configuration-only checks for recipes that are not started here.
run_haproxy-config() {
  local tmp; tmp=$(mktemp -d)
  cp "$DOC" "$tmp/sustainability-data"
  sed "s#/etc/haproxy/sustainability-data#/tmp/cfg/sustainability-data#" "$KIT/proxies/haproxy/haproxy.cfg" > "$tmp/haproxy.cfg"
  chmod 755 "$tmp"; chmod 644 "$tmp"/* # the official image runs as the unprivileged haproxy user
  local ok=1
  if command -v haproxy >/dev/null; then
    sed -i "s#/tmp/cfg/#$tmp/#" "$tmp/haproxy.cfg"; haproxy -c -f "$tmp/haproxy.cfg" || ok=0
  else
    docker run --rm -v "$tmp:/tmp/cfg:ro" haproxy:2.8-alpine haproxy -c -f /tmp/cfg/haproxy.cfg || ok=0
  fi
  rm -rf "$tmp"
  if [ "$ok" = 1 ]; then echo "PASS  haproxy (configuration check)"; else echo "FAIL  haproxy (configuration check)"; fail=1; fi
}
run_terraform-config() {
  local dir="$KIT/static/aws-s3-cloudfront" ok=1
  if command -v terraform >/dev/null; then
    (cd "$dir" && terraform fmt -check -diff && terraform init -backend=false -input=false >/dev/null && terraform validate) || ok=0
  else
    docker run --rm -v "$KIT:/kit" -w /kit/static/aws-s3-cloudfront hashicorp/terraform:latest fmt -check -diff || ok=0
    docker run --rm -v "$KIT:/kit" -w /kit/static/aws-s3-cloudfront --entrypoint sh hashicorp/terraform:latest \
      -c 'terraform init -backend=false -input=false >/dev/null && terraform validate; s=$?; rm -rf .terraform .terraform.lock.hcl; exit $s' || ok=0
  fi
  rm -rf "$dir/.terraform" "$dir/.terraform.lock.hcl" 2>/dev/null || true
  if [ "$ok" = 1 ]; then echo "PASS  terraform (fmt + validate)"; else echo "FAIL  terraform (fmt + validate)"; fail=1; fi
}

if [ $# -gt 0 ]; then selected="$*"; else
  selected=""
  have_docker=0; docker info >/dev/null 2>&1 && have_docker=1
  command -v node >/dev/null && selected="$selected express fastify koa"
  python3 -c 'import flask' 2>/dev/null && selected="$selected flask"
  python3 -c 'import uvicorn, fastapi' 2>/dev/null && selected="$selected fastapi"
  command -v php >/dev/null && selected="$selected php"
  command -v go >/dev/null && selected="$selected go"
  { command -v caddy >/dev/null || [ "$have_docker" = 1 ]; } && selected="$selected caddy"
  { command -v nginx >/dev/null || [ "$have_docker" = 1 ]; } && selected="$selected nginx"
  command -v apache2 >/dev/null && [ -d /usr/lib/apache2/modules ] && selected="$selected apache"
  { command -v haproxy >/dev/null || [ "$have_docker" = 1 ]; } && selected="$selected haproxy-config"
  { command -v terraform >/dev/null || [ "$have_docker" = 1 ]; } && selected="$selected terraform-config"
fi
echo "recipes: $selected"
for r in $selected; do "run_$r"; done
exit $fail
