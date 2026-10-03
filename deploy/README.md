# deploy — copy-paste recipes for serving `/.well-known/sustainability-data`

One folder per platform. Each has the exact file or configuration and a short README. The sample
document is `www/.well-known/sustainability-data` (a synthetic `kit.example`; replace it with your own
figures). Recipes marked **CI** are started and validated by `.github/workflows/deploy-kit.yml` on every
change with the reference consumer in strict mode; the others are reviewed by hand and say when.

The four response headers every recipe sets, and why (three come from the draft, one is kit hardening):

| Header | Value | Why |
|---|---|---|
| `Content-Type` | `application/sustainability-data+json` | the draft's media type (registration requested with the draft, not yet granted); `application/json` is only tolerated |
| `X-Content-Type-Options` | `nosniff` | this kit's own hardening (the -06 SHOULD was removed in -07; no consumer checks it); it stops browsers guessing |
| `Access-Control-Allow-Origin` | `*` | the file is public and browser consumers exist (draft, SHOULD) |
| `Cache-Control` | `public, max-age=86400` | the draft's recommended day of caching; refresh the file monthly |

`HEAD` must answer like `GET` without a body. Other methods should get `405` with `Allow: GET, HEAD` where the platform can do it.

## Static hosts
| Platform | Can serve it? | Recipe | Checked |
|---|---|---|---|
| Cloudflare Pages | yes (`_headers`) | `static/cloudflare-pages/` | live on andreibesleaga.com |
| Netlify | yes (`_headers`) | `static/netlify/` | reviewed 2026-10-03 |
| Vercel | yes (`vercel.json` headers) | `static/vercel/` | reviewed 2026-10-03 |
| Render static site | yes (dashboard header rules) | `static/render/` | reviewed 2026-10-03 |
| AWS S3 + CloudFront | yes (object metadata + response-headers policy) | `static/aws-s3-cloudfront/` | script reviewed 2026-10-03; `main.tf` passes `terraform fmt`/`validate` in CI, never applied there |
| Google Cloud Storage (+ load balancer or Cloud Run) | yes for the draft's headers (object metadata + bucket CORS); `nosniff`, the kit's extra, needs a load balancer or Cloud Run | `static/gcp/` | reviewed 2026-10-03 |
| Azure Static Web Apps | yes (`staticwebapp.config.json`) | `static/azure/` | reviewed 2026-10-03 |
| Azure Blob static website | yes for the draft's headers (blob properties + account CORS); `nosniff` needs Front Door/CDN rules | `static/azure/` | reviewed 2026-10-03 |
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
| Node.js | Express, Fastify, Koa (one static route each; the publisher package's middleware is the signed, Extended alternative) | `frameworks/node/` | **CI** |
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
| One-click node (Railway, or any container host): figures from environment variables, served and signed by the publisher library | `one-click/railway/` | **CI** (its own tests) |
| Static-site template with Deploy-to-Netlify / Vercel buttons | `one-click/static-site/` | reviewed 2026-10-03 |
| WordPress plugin "Sustainability Data (well-known)" (GPLv2-or-later; settings page with validation, signed output, multisite, translation-ready, no external calls) | `wordpress/` | **CI**: WordPress coding standards and PHP 8.1 compatibility, offline tests, output validated and signature verified with the consumer, and the plugin run in a real WordPress (7.1.2 on 2026-10-03) and checked in strict mode |
| GitHub Action: validate a file or a live origin in CI | `github-action/` | **CI** (this repository runs it on itself: `self-check.yml`) |
| Initializer `create-sustainability-data`: seven questions, the file and the host's configuration | `../tools/create-sustainability-data/` | **CI** (tests, including the bin run through a symlink as `npx` runs it) |
| Home Assistant add-on: metered monthly energy from the Energy dashboard's sensor, signed (`hardware-metered`) | `home-assistant/` | **CI** (fake Core API); not yet run in a real instance |

## Verify any deployment
```bash
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://your.host --strict
```
Locally over plain HTTP (development only): add `--allow-http`.

Run every recipe yourself: `bash deploy/e2e/run.sh` (each recipe in its own process group, on a port proven free
before and after; nginx, Caddy, HAProxy and Terraform run in Docker when not installed). The WordPress plugin in a
real WordPress: `bash deploy/wordpress/wordpress-e2e.sh` (Docker).
