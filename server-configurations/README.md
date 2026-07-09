# server-configurations

Server configuration snippets for publishing the `/.well-known/sustainability` endpoint as defined in [draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

## Files

| File | Description |
|---|---|
| `nginx.conf` | Nginx location block snippet |
| `apache.conf` | Apache VirtualHost / .htaccess snippet |

Both snippets serve **one static Basic-service document** — no query-parameter
handling. For the Extended service (`target`/`period`/`granularity`, dynamic
per-request responses), see "Optional: dynamic Extended service" below.

## What each configuration provides

| Feature | nginx.conf | apache.conf | Draft requirement |
|---|---|---|---|
| `Content-Type: application/json` | ✓ | ✓ | MUST |
| `Cache-Control: max-age=86400` | ✓ | ✓ | RECOMMENDED |
| `ETag` / `Last-Modified` | auto (on by default) | auto (static files) | RECOMMENDED |
| `Access-Control-Allow-Origin: *` | ✓ | ✓ | allows aggregators |
| GET/HEAD only; others get `405` + `Allow: GET, HEAD` | ✓ (named location) | ✓ (ErrorDocument) | SHOULD |
| Rate limiting | commented out | commented out | RECOMMENDED |

**A note on the 405 handling in both files, and why it isn't a one-line `return`/`deny`:**
The obvious approaches — nginx setting `Allow` inside the method-check `if` block,
or Apache's `<LimitExcept>` — were tried and rejected after checking against each
server's actual documented/observed behavior:

- **nginx**: `add_header` is inherited from the parent block *only if* the current
  block defines no `add_header` of its own (documented:
  <https://nginx.org/en/docs/http/ngx_http_headers_module.html#add_header>). Setting
  `Allow` inside the `if` block would silently drop the `Cache-Control`/CORS headers
  set above it on the 405 path. The config instead routes the 405 through a named
  `location` (`error_page 405 = @sustainability_405`), which is nginx's standard,
  documented pattern for a fully custom error response.
- **Apache**: `<LimitExcept GET HEAD><Require all denied></LimitExcept>` returns
  **403 Forbidden**, not 405 — the wrong status for "method not supported here" (403
  means authorization denied). Faking a 405 via `mod_rewrite` instead works for the
  *status code*, but was empirically verified (Apache/2.4.58) to make Apache's core
  inject its own extra `Allow: TRACE` header alongside any `Header set Allow`
  directive — `mod_headers` cannot override it in place. Routing the 405 through a
  real `ErrorDocument` resource (a tiny static JSON file, `<Files>`-scoped headers)
  was verified to produce a single, correct `Allow: GET, HEAD` header and a JSON
  body. This is why `apache.conf` has an extra `Alias`/`<Files>` block for
  `sustainability-405.json` — create that one-line JSON file once (e.g.
  `{"error":"method not allowed"}`) alongside your main document.

## Usage

### Nginx

1. Copy the `limit_req_zone` line into your `http {}` block.
2. Copy the `location` blocks (including the `@sustainability_405` named location)
   into your `server {}` block.
3. Update the `alias` path to point to your JSON file.
4. Uncomment `limit_req` to activate rate limiting.
5. Run `nginx -t` to check the config before reloading — always do this for any
   nginx change, not specific to this snippet.

```nginx
# In http {}:
limit_req_zone $binary_remote_addr zone=sust_limit:10m rate=1r/s;

# In server {}:
location = /.well-known/sustainability {
    alias /path/to/sustainability.json;
    ...
}
location @sustainability_405 {
    ...
}
```

### Apache

1. Add the `Alias`/`<Files>`/`<Location>` blocks to your `VirtualHost` configuration.
2. Create the one-line 405 body file referenced by the `ErrorDocument` directive
   (e.g. `echo '{"error":"method not allowed"}' > /var/www/metadata/sustainability-405.json`).
3. Ensure `mod_headers`, `mod_alias`, and `mod_rewrite` are enabled:
   ```bash
   a2enmod headers alias rewrite
   systemctl reload apache2
   ```
4. Update the file paths in both `Alias` directives.
5. For rate limiting, use a reverse proxy (nginx, HAProxy) or a WAF in front of Apache — `mod_ratelimit` only throttles bandwidth, not request rate.
6. Run `apache2ctl configtest` (or `httpd -t`) before reloading.

## Optional: dynamic Extended service (target/period/granularity)

Static file serving cannot compute a response for `?target=`, `?period=`, or
`?granularity=` — those require real query-parameter logic. Rather than
reimplementing that logic in nginx/Apache configuration (fragile, and it would
duplicate the already-tested behavior in `publisher/`), reverse-proxy the well-known
path to a real implementation — this repo's `publisher/` gateway, or an equivalent
service in any language — and let nginx/Apache handle TLS termination and rate
limiting in front of it. Both config files have a commented-out `proxy_pass` /
`ProxyPass` block at the bottom showing this. **Do not add `Header`/`add_header`
directives for fields the gateway already sets correctly** (Content-Type,
Cache-Control, ETag, CORS, and 405/Allow) — both nginx and Apache pass upstream
response headers through unmodified by default, and duplicating them risks a
future silent mismatch between the proxy layer and the real implementation.

This exact reverse-proxy pattern was verified end-to-end (2026-07-09) with Apache
2.4.58 + `mod_proxy_http` fronting a live run of `publisher/`: query strings and
every upstream header (including the 405/Allow path) passed through correctly.

## Security notes (per draft §Security)

- **Rate limiting** is RECOMMENDED on requests that include `period` or `granularity` query parameters, as dynamic aggregation can be CPU/DB-intensive.
- **Array size cap** of 366 objects should be enforced in your application layer (see `example-scripts/security.*`, or `publisher/` if running the dynamic gateway).
- **HTTPS** is RECOMMENDED — configure TLS in your server block separately; these snippets cover the endpoint behaviour only.
- The endpoint publishes no PII; metrics SHOULD be aggregated to ≥ 24-hour granularity before serving (enforced in `example-scripts/security.*`).
