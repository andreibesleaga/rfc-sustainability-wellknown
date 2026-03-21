# server-configurations

Server configuration snippets for publishing the `/.well-known/sustainability` endpoint as defined in [draft-besleaga-green-sustainability-wellknown-03](https://datatracker.ietf.org/doc/draft-besleaga-green-sustainability-wellknown/).

## Files

| File | Description |
|---|---|
| `nginx.conf` | Nginx location block snippet |
| `apache.conf` | Apache VirtualHost / .htaccess snippet |

## What each configuration provides

| Feature | nginx.conf | apache.conf | Draft requirement |
|---|---|---|---|
| `Content-Type: application/json` | ✓ | ✓ | MUST |
| `Cache-Control: max-age=86400` | ✓ | ✓ | RECOMMENDED |
| `ETag` / `Last-Modified` | auto (on by default) | auto (static files) | RECOMMENDED |
| `Access-Control-Allow-Origin: *` | ✓ | ✓ | allows aggregators |
| GET/HEAD only restriction | ✓ | ✓ | SHOULD |
| Rate limiting | commented out | commented out | RECOMMENDED |

## Usage

### Nginx

1. Copy the `limit_req_zone` line into your `http {}` block.
2. Copy the `location` block into your `server {}` block.
3. Update the `alias` path to point to your JSON file.
4. Uncomment `limit_req` to activate rate limiting.

```nginx
# In http {}:
limit_req_zone $binary_remote_addr zone=sust_limit:10m rate=1r/s;

# In server {}:
location = /.well-known/sustainability {
    alias /path/to/sustainability.json;
    ...
}
```

### Apache

1. Add the `Alias` directive and `<Location>` block to your `VirtualHost` configuration.
2. Ensure `mod_headers` and `mod_alias` are enabled:
   ```bash
   a2enmod headers alias
   systemctl reload apache2
   ```
3. Update the file path in the `Alias` directive.
4. For rate limiting, use a reverse proxy (nginx, HAProxy) or a WAF in front of Apache — `mod_ratelimit` only throttles bandwidth, not request rate.

## Security notes (per draft §Security)

- **Rate limiting** is RECOMMENDED on requests that include `period` or `granularity` query parameters, as dynamic aggregation can be CPU/DB-intensive.
- **Array size cap** of 366 objects should be enforced in your application layer (see `scripts/security.*`).
- **HTTPS** is RECOMMENDED — configure TLS in your server block separately; these snippets cover the endpoint behaviour only.
- The endpoint publishes no PII; metrics SHOULD be aggregated to ≥ 24-hour granularity before serving (enforced in `scripts/security.*`).
