# deploy — copy-paste recipes for serving `/.well-known/sustainability-data`

One folder per platform. Each has the exact file or configuration and a short README. The sample
document is `www/.well-known/sustainability-data` (a synthetic `kit.example`; replace it with your own
figures). Recipes marked **CI** are started and validated by `.github/workflows/deploy-kit.yml` on every
change with the reference consumer in strict mode; the others are reviewed by hand and say when.

**Figures:** every recipe publishes the figures you give it. [FIGURES.md](FIGURES.md) lists the easiest real sources
(your cloud's or host's own report, a meter, energy counters) and a five-minute estimate from data transfer, with
the `measurement-method` to declare for each and how to check the result.

The four response headers every recipe sets, and why. Only the media type comes from the draft; for caching, cross-origin
access and the rest of the HTTP exchange the draft defers to RFC 9110 and RFC 9111 and leaves them to the publisher, so the
other three are this kit's defaults, each a one-line change:

| Header | Value | Why |
|---|---|---|
| `Content-Type` | `application/sustainability-data+json` | the draft's media type (registration requested with the draft, not yet granted). A consumer may also process `application/json`; a response with any other media type is not a declaration, so a host that serves the file as `text/plain` or `application/octet-stream` is not usable |
| `X-Content-Type-Options` | `nosniff` | this kit's own hardening (the draft no longer mentions it; no consumer checks it); it stops browsers guessing |
| `Access-Control-Allow-Origin` | `*` | this kit's default for a public file that browser consumers read; remove it if you restrict access, which the draft allows |
| `Cache-Control` | `public, max-age=86400` | this kit's default of one day (the draft's worked example uses `max-age=3600`); refresh the file monthly |

**Validators.** Static hosts, nginx, Apache and Caddy send `ETag` and `Last-Modified` for a file themselves and answer
`If-None-Match` with `304`. HAProxy and Envoy answer from memory and send none, so give them a short `max-age`. The Node,
Python, PHP and Go recipes compute a strong `ETag` over the bytes and answer `304`.

`HEAD` must answer like `GET` without a body, and other methods should get `405` with `Allow: GET, HEAD` where the platform can do it (HTTP itself, RFC 9110, asks for both; the draft cites it rather than restating it).

## Query parameters

A recipe that serves a file is a Basic server: it ignores `target`, `start`, `end`, `granularity` and every other
parameter, and answers `200` with the same file for any query string (never `400`, never `404`, never a different body
for a different query). `capabilities` in the file is then `basic`. To answer ranges you need an Extended server: the
publisher package (`frameworks/node/README.md`) or the Home Assistant add-on. The one-click node publishes one current report and is Basic. An Extended
server returns the objects that match as a JSON array in ascending order of `period.start`, `[]` with `200` when none
match, and ignores a value outside the form of the draft (`start` and `end` are UTC date-times ending in `Z`).

## HTTPS and the `/.well-known/` path

The declaration is published and retrieved over HTTPS only. The static hosts that can serve it (table below) serve HTTPS and
redirect plain HTTP to it (switch "force HTTPS" on where it is an option). The proxy and framework recipes listen on a plain port for
local use and sit behind the TLS endpoint you already run; if they are the TLS endpoint, redirect port 80 to HTTPS (a
`return 301 https://$host$request_uri;` server block in nginx, `redir` in Caddy, a `redirect-scheme` middleware in
Traefik) and send `Strict-Transport-Security`. On a shared origin nobody but the publisher may be able to write under
`/.well-known/` (RFC 8615, Section 4): anyone who can write there can publish a declaration in your name.

## Methodology page and privacy

`methodology-uri` links to a page for people that says how the figures were obtained. [METHODOLOGY-TEMPLATE.md](METHODOLOGY-TEMPLATE.md)
has the five things the draft asks it to cover. Publish only what you intend to be public: energy and utilisation figures can
reveal capacity and load patterns, precise hardware, and which services and paths exist; `provider` should hold a role
address (`sustainability@`, not a person's name). Omit a metric that could be linked to individual users or
small groups, or report it at a coarser level. The kit publishes figures and does not vouch for their accuracy; that, and attackers who control your
server, your DNS zone, your certificate or your signing key, are outside what a declaration protects against.

## Static hosts
| Platform | Can serve it? | Recipe | Checked |
|---|---|---|---|
| Cloudflare Pages | yes (`_headers`) | `static/cloudflare-pages/` | live on andreibesleaga.com (media type, CORS, nosniff; that site chooses `max-age=0, must-revalidate` over the recipe's `max-age=86400`) |
| Netlify | yes (`_headers`) | `static/netlify/` | reviewed 2026-10-03 |
| Vercel | yes (`vercel.json` headers) | `static/vercel/` | reviewed 2026-10-03 |
| Render static site | yes (dashboard header rules) | `static/render/` | reviewed 2026-10-03 |
| AWS S3 + CloudFront | yes (object metadata + response-headers policy) | `static/aws-s3-cloudfront/` | script reviewed 2026-10-03; `main.tf` passes `terraform fmt`/`validate` in CI, never applied there |
| Google Cloud Storage (+ load balancer or Cloud Run) | yes for the media type, caching and CORS (object metadata + bucket CORS); `nosniff`, the kit's extra, needs a load balancer or Cloud Run | `static/gcp/` | reviewed 2026-10-03 |
| Azure Static Web Apps | yes (`staticwebapp.config.json`) | `static/azure/` | reviewed 2026-10-03 |
| Azure Blob static website | yes for the media type, caching and CORS (blob properties + account CORS); `nosniff` needs Front Door/CDN rules | `static/azure/` | reviewed 2026-10-03 |
| Codeberg Pages | yes (`.well-known` served; headers to verify) | `static/codeberg-pages/` | to verify |
| GitHub Pages | **no**: an extensionless file is served as `application/octet-stream`, no custom headers | `static/github-pages/` | known limitation |
| GitLab Pages | to verify: newer versions document a `_headers` file | `static/gitlab-pages/` | to verify |
| Shopify, Squarespace, Webflow, Wix | **no** custom path or headers at `/.well-known/` (Wix: Velo router to verify) | — | platform-level ask |

## Reverse proxies and web servers
| Server | Recipe | Checked |
|---|---|---|
| nginx | `proxies/nginx/` (3 lines; the full hardened file is `../server-configurations/nginx.conf`) | **CI** |
| Apache / LiteSpeed (`.htaccess`) | `proxies/apache/` (the full file is `../server-configurations/apache.conf`) | **CI** |
| Caddy | `proxies/caddy/Caddyfile` | **CI** |
| HAProxy | `proxies/haproxy/haproxy.cfg` | **CI** (`haproxy -c` configuration check; not started) |
| Envoy | `proxies/envoy/envoy.yaml` | reviewed 2026-10-03 |
| Traefik | `proxies/traefik/` (headers middleware in front of any recipe below) | reviewed 2026-10-03 |
| IIS | `proxies/iis/web.config` | reviewed 2026-10-03; not run on a real IIS yet |

## Application frameworks
| Language | Framework | Recipe | Checked |
|---|---|---|---|
| Node.js | Express, Fastify, Koa (one static route each; the publisher package's middleware is the signed, Extended alternative: `npm install sustainability-wellknown-publisher@^0.8.0`) | `frameworks/node/` | **CI** |
| Node.js | Next.js, Nuxt, SvelteKit, Astro | `frameworks/node/` | reviewed 2026-10-03 |
| Python | Flask, FastAPI, Django | `frameworks/python/` | **CI** (Flask, FastAPI); Django reviewed |
| PHP | plain PHP, Laravel, Symfony | `frameworks/php/` | **CI** (plain PHP); Laravel and Symfony reviewed |
| Go | net/http | `frameworks/go/` | **CI** |
| Java | Spring Boot | `frameworks/java/` | reviewed 2026-10-03 |
| C# | ASP.NET Core | `frameworks/dotnet/` | reviewed 2026-10-03 |
| Ruby | Rails | `frameworks/ruby/` | reviewed 2026-10-03 |
| Rust | Axum | `frameworks/rust/` | reviewed 2026-10-03 |

## One click, plugins, CI
| What | Recipe | Checked |
|---|---|---|
| One-click node (Railway, or any container host): figures from environment variables (`SD_PERIOD`, or `SD_START` and `SD_END`), served and signed (Ed25519) by the publisher library | `one-click/railway/` | **CI** (its own tests) |
| Static-site template with Deploy-to-Netlify / Vercel buttons | `one-click/static-site/` | reviewed 2026-10-03 |
| WordPress plugin "Sustainability Data (well-known)" (GPLv2-or-later; settings page with validation, signed output, multisite, translation-ready, no external calls) | `wordpress/` | **CI**: WordPress coding standards and PHP 8.1 compatibility, offline tests, output validated and signature verified with the consumer, and the plugin run in a real WordPress (7.1.2 on 2026-10-03) and checked in strict mode |
| GitHub Action: validate a file or a live origin in CI | `github-action/` | **CI** (this repository runs it on itself: `self-check.yml`) |
| Initializer `create-sustainability-data`: seven questions, the file and the host's configuration | `../tools/create-sustainability-data/` | **CI** (tests, including the bin run through a symlink as `npx` runs it) |
| Home Assistant add-on: metered monthly energy from the Energy dashboard's sensor, one signed object per month (`hardware-metered`) | `home-assistant/` | **CI** (fake Core API); not yet run in a real instance |

## Verify any deployment
```bash
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://your.host --strict
```
Locally over plain HTTP (development only): add `--allow-http`.

Run every recipe yourself: `bash deploy/e2e/run.sh` (each recipe in its own process group, on a port proven free
before and after; nginx, Caddy, HAProxy and Terraform run in Docker when not installed). The WordPress plugin in a
real WordPress: `bash deploy/wordpress/wordpress-e2e.sh` (Docker).
