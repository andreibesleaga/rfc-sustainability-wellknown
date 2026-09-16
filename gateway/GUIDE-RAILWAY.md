# Deploying the gateway to Railway

A step-by-step runbook. **You run every command here yourself** — nothing in
this repository deploys, commits, or pushes anything on your behalf.

Two paths are given, CLI and dashboard. They produce the same result; pick one.
Then do the custom-domain step and the verification step, which are common to
both.

The full reference guide (adding subjects, wiring adapters, the honesty rules)
is [GUIDE.md](GUIDE.md).

---

## 0. Before you start

```bash
cd gateway
npm install
npm run build
npm test          # 348 tests; everything must be green before you deploy
node dist/index.js &
curl -sSI http://127.0.0.1:8080/cloudflare.com/.well-known/sustainability-data
kill %1
```

If the process refuses to start, that is by design: a data file that is not
conformant, is oversized, or would be silently altered by the publisher pipeline
stops the boot rather than being served. The error names the file.

Commit the `gateway/` directory to the branch you intend to deploy. Railway
deploys from a Git branch (or from `railway up`), so the files must be there.

---

## Path A — Railway CLI

```bash
# 1. Install and sign in
npm i -g @railway/cli
railway login                 # opens a browser

# 2. From the gateway directory, create a project and link this directory to it
cd gateway
railway init                  # choose "Empty Project"; give it a name,
                              # e.g. sustainability-data-gateway

# 3. Create the service and deploy the current directory
railway up                    # builds the Dockerfile, streams build logs

# 4. Give it a public URL
railway domain                # prints something like
                              # sustainability-data-gateway-production.up.railway.app
```

`railway up` uploads the working directory, so `.dockerignore` applies: no
`node_modules`, no `dist`, no tests. The build runs `npm ci` twice (once for the
build stage, once production-only for the runtime stage) and compiles
TypeScript.

> **If the service is GitHub-connected with Root Directory `gateway`** (the
> dashboard setup below), do not run `railway up` from inside `gateway/`: the
> upload then has no `gateway/` subdirectory for the root-directory setting to
> resolve and the build fails with `lstat .../gateway: no such file or
> directory`. Either let the push trigger the deploy, or run `railway up` from
> the repository root. (Seen 2026-09-10.)

Useful follow-ups:

```bash
railway logs                  # structured JSON request lines
railway status
railway variables             # list the service's environment variables
railway redeploy              # after changing data/ and pushing
```

---

## Path B — Railway dashboard

1. Push the branch containing `gateway/` to GitHub.
2. <https://railway.app> → **New Project** → **Deploy from GitHub repo** →
   pick `rfc-sustainability-wellknown` → authorize the repo if prompted.
3. Open the created service → **Settings**:
   - **Root Directory**: `gateway`
     *(essential — the repository root is not the app)*
   - **Builder**: `Dockerfile` (Railway detects `gateway/Dockerfile`; the
     committed `railway.json` also pins this)
   - **Healthcheck Path**: `/healthz` (also set in `railway.json`)
   - **Start Command**: leave empty — the Dockerfile `CMD` is correct
4. **Settings → Networking → Generate Domain**. Railway assigns a
   `*.up.railway.app` hostname and injects `PORT`; the service binds
   `0.0.0.0:$PORT`.
5. **Deployments** → watch the build. The first log line on success is a JSON
   `"event":"listening"` record listing every subject loaded.

---

## Environment variables

None are required. `PORT` is injected by Railway. Everything else has a working
default; set them under **Variables** (dashboard) or with
`railway variables --set KEY=value`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Injected by Railway. Do not set it manually. |
| `HOST` | `0.0.0.0` | Bind address. Leave it. |
| `DATA_DIR` | `<app>/data` | Where subject documents are read from. |
| `EXAMPLES_DIR` | `<app>/examples` | Where the canonical wire-format example documents are read from. |
| `MAX_AGE` | `86400` | `Cache-Control: public, max-age=…`, the draft's RECOMMENDED value. |
| `SUSTAINABILITY_MEDIA_TYPE` | `sustainability-data+json` | `200` declaration response media type. `sustainability-data+json` (default) serves the dedicated `application/sustainability-data+json` type -07 requires, with `X-Content-Type-Options: nosniff`; `json` serves the generic `application/json` type instead (a consumer MAY process it, but publishing it is not conformant; also with `nosniff`). One subject can be pinned to the generic type regardless of this default via `data/_media-type.json` — see `GUIDE.md`. |
| `BASE_URL` | *(empty)* | Public base URL, for absolute links in the index. Setting it also turns the co2js demonstration's Greencheck lookup live (keyless). |
| `GWF_API_KEY` | *(unset)* | Optional free Green Web Foundation key → carbontxt demonstration runs live. |
| `CLIMATIQ_API_KEY` | *(unset)* | Optional; set only under your own Climatiq license (their terms restrict redistribution) — replay is the default. The demo passes Climatiq's required `data_version` selector (`^34`, set in `demo-specs.ts`). |
| `SELF_TARGET` | `sustainability-data-gateway` | `target` of the gateway's own report. |
| `SELF_PROVIDER` | `Andrei Besleaga, operator of this reference gateway` | `provider` of the gateway's own report. Use a role address. |
| `SELF_METHODOLOGY_URI` | this repo's `gateway/METHODOLOGY.md` on GitHub | **Must resolve publicly.** Point it at wherever you actually publish `METHODOLOGY.md`. |
| `SELF_DISCLOSURE_URI` | this repo's `gateway/` on GitHub | Disclosure index for the gateway. |
| `SELF_PERIOD` | last completed calendar month | Pin the gateway's own reporting period (`YYYY` or `YYYY-MM`). |
| `SELF_WATTS` | `3` | Modelled average container power draw. |
| `SELF_GRID_INTENSITY` | `373` | gCO2e/kWh. Cited in `METHODOLOGY.md`. |
| `SELF_LIVE_SINCE` | `2026-07-30T00:00:00Z` | When this gateway went live; the self model counts no hours before it. |
| `SUSTAINABILITY_SIGNING_KEY` | *(unset)* | Private JWK (JSON) signing the gateway's own report: every declaration object it emits then carries a `signed` member (-07 defines no separate signature resource). See [Signing and attestation](#signing-and-attestation). |
| `SELF_SIGNING_KEY_URL` | *(unset)* | Public URL of the signing key's public half (index display). |
| `SELF_ATTESTATION_URI` | *(unset)* | `verifiable-attestation-uri` of the self report. |
| `RATE_LIMIT_PER_MINUTE` | `600` | Per-client limit; `0` disables. `TRUST_PROXY` stays `1` on Railway. |
| `TRUST_PROXY` | `1` | Trusted proxies in front of the process (the client is the last `X-Forwarded-For` entry); `0` when exposed directly. |

### Signing and attestation

All three files below are hosted on a site you control (the reference deployment
uses `andreibesleaga.com`); private keys never enter the repository or Railway
except `SUSTAINABILITY_SIGNING_KEY` itself.

```bash
# 1. the gateway's signing key: private half to a local file, public half printed
npx -y -p sustainability-wellknown-publisher sustainability-publisher keygen \
  --out ~/.config/sustainability-gateway/private.jwk > gateway-signing-key.jwk
#    host gateway-signing-key.jwk at  https://<your-site>/keys/sustainability-gateway-signing-key.jwk  (application/jwk+json)

# 2. the attester's key (a second identity)
npx -y -p sustainability-wellknown-publisher sustainability-publisher keygen \
  --out ~/.config/sustainability-attester/private.jwk > attester.jwk
#    host attester.jwk at  https://<your-site>/keys/sustainability-attester.jwk

# 3. the credential attesting the reporting model (VC 2.0 as vc+jwt, valid five years)
node scripts/issue-attestation.mjs --issuer https://<your-site> \
  --attester-key-url https://<your-site>/keys/sustainability-attester.jwk \
  --id https://<your-site>/attestations/sustainability-data-gateway-2026.vc.jwt \
  --gateway https://<your-gateway> --out sustainability-data-gateway-2026.vc.jwt
#    host it at the --id URL  (application/vc+jwt)

# 4. tell the gateway
railway variables --set "SUSTAINABILITY_SIGNING_KEY=$(cat ~/.config/sustainability-gateway/private.jwk)" \
  --set SELF_SIGNING_KEY_URL=https://<your-site>/keys/sustainability-gateway-signing-key.jwk \
  --set SELF_ATTESTATION_URI=https://<your-site>/attestations/sustainability-data-gateway-2026.vc.jwt
```

Rotation: run step 1 again, host the new public key, replace the variable,
redeploy. Old signatures stop verifying against the new key — expected. The
credential stays valid until its `validUntil`.

Expect a stale window after enabling or rotating signing, and after each
monthly rollover of the self report. Railway's edge caches each response for
its full `max-age`, separately per `Accept-Encoding` variant, and offers no
purge: a client may still receive the previous declaration for up to its
`max-age`. Since -07 the signature is a member of that declaration rather than
a second resource, so a cached copy is at worst *old* and never *mismatched* —
the old body and the old signature travel together and still verify. The self
report is served with `max-age=3600`, the resolution of the model behind it, so
the window is at most an hour (the first, pre-signing deployment was cached for
a day). A request with a query string (`?period=…`) or an unusual
`Accept-Encoding` reaches the process and shows the current state.

> **Railway CLI note (seen 2026-09-14 while setting these variables).** The CLI
> now warns: *"Config as Code (railway.json / railway.toml) is deprecated. Prefer
> Infrastructure as Code (.railway/railway.ts). Run `railway config migrate` …
> Existing files keep working until 2026-12-01."* The committed `railway.json`
> therefore keeps working until that date; before it, run `railway config
> migrate` (it generates `.railway/railway.ts` from `railway.json`), commit the
> result, and delete `railway.json`. Nothing in this guide changes otherwise.

> **Do this before citing the deployment.** `SELF_METHODOLOGY_URI` is a
> mandatory member of a document you are publishing, and the draft requires the
> resource behind it to be publicly retrievable without authentication. Make
> sure the default URL actually resolves once you have pushed, or override it.

---

## Custom domain

A `*.up.railway.app` hostname works, but a domain you control reads better in a
citation, and lets you serve the gateway's own report from a stable origin.

1. Railway → your service → **Settings → Networking → Custom Domain** → enter
   e.g. `sustainability.example.org`.
2. Railway shows a target hostname such as
   `abc123.up.railway.app`. At your DNS provider create:

   | Type | Name | Value |
   |---|---|---|
   | `CNAME` | `sustainability` | `abc123.up.railway.app` |

   For an **apex** domain (`example.org` with no label), a plain `CNAME` is not
   permitted by DNS. Use your provider's `ALIAS`/`ANAME`/flattened-CNAME record
   type (Cloudflare, Route 53, DNSimple and others all offer one), pointing at
   the same target.
3. Wait for propagation. Railway shows the domain as **Active** and issues a
   Let's Encrypt certificate automatically — no configuration and no manual
   renewal. The draft requires the declaration to be published and retrieved
   over HTTPS (a MUST); this is how that is satisfied.
4. If you use Cloudflare in front, set the record to **DNS only (grey cloud)**
   until Railway reports the domain Active, then re-enable the proxy if you want
   it. Proxying before issuance can stall certificate validation.

> **Do not** put the gateway behind a path rewrite that strips the
> `/{domain}` prefix, and do not let a CDN cache-key on the query string alone:
> this service deliberately returns the identical Basic response for every
> query string, so a query-keyed cache would multiply entries for no benefit.

---

## Verify the deployment

Set `BASE` to your public URL, then run all of this. The expected output is
shown in [GUIDE.md](GUIDE.md#verifying-a-deployment).

```bash
BASE=https://sustainability.example.org

# 1. Health
curl -sS "$BASE/healthz"

# 2. Headers on a subject document — the ones a reviewer will check
curl -sSI "$BASE/cloudflare.com/.well-known/sustainability-data"

# 3. The document itself
curl -sS "$BASE/cloudflare.com/.well-known/sustainability-data" | jq .

# 4. Conditional GET must yield 304
ETAG=$(curl -sSI "$BASE/cloudflare.com/.well-known/sustainability-data" \
       | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r')
curl -sS -o /dev/null -w '%{http_code}\n' \
     -H "If-None-Match: $ETAG" \
     "$BASE/cloudflare.com/.well-known/sustainability-data"      # -> 304

# 5. HEAD must match GET
curl -sSI -X HEAD "$BASE/cloudflare.com/.well-known/sustainability-data"

# 6. A non-GET/HEAD method must be 405 with Allow
curl -sSI -X POST "$BASE/cloudflare.com/.well-known/sustainability-data"

# 7. Unknown subject must be 404
curl -sS -o /dev/null -w '%{http_code}\n' \
     "$BASE/nobody.example/.well-known/sustainability-data"      # -> 404

# 8. Unsupported query parameters must be IGNORED, not an error
curl -sS -o /dev/null -w '%{http_code}\n' \
     "$BASE/cloudflare.com/.well-known/sustainability-data?period=2019&granularity=hourly"
                                                                 # -> 200

# 9. The gateway's own report
curl -sS "$BASE/.well-known/sustainability-data" | jq .

# 10. The repository's own conformance battery, root endpoint (includes the signature check)
npx -y -p sustainability-wellknown-consumer sustainability-fetch "$BASE" --strict --verify-attestation

# 11. The same battery, every subject (uses this repo's script)
npm run conformance -- "$BASE"

# 12. The self report's Extended service: a month, a year of months, a pre-go-live month (404)
curl -sS "$BASE/.well-known/sustainability-data?period=2026-08" | jq '.["reporting-period"]'
curl -sS "$BASE/.well-known/sustainability-data?period=2026&granularity=monthly" | jq 'map(.["reporting-period"])'
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/.well-known/sustainability-data?period=2026-06"   # -> 404

# 13. The embedded signature and the attestation. -07 defines ONE resource: the
#     signature is the declaration's own `signed` member, so there is no second
#     URL to fetch, and the old .jws path is a plain 404.
curl -sS "$BASE/.well-known/sustainability-data" | jq -r '.signed | split(".")[0] | @base64d'
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/.well-known/sustainability-data.jws"          # -> 404
npx -y -p sustainability-wellknown-consumer sustainability-fetch "$BASE" --verify --verify-attestation >/dev/null

# 13b. The -07 query procedure and the upstream chain
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/.well-known/sustainability-data?period=2026&period=2025"  # -> 400
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/.well-known/sustainability-data?target=/anything"          # -> 404
npx -y -p sustainability-wellknown-consumer sustainability-fetch "$BASE/tenant-demo.example" --upstream >/dev/null

# 14. Rate limiting: a burst from one client ends in 429 + Retry-After
for i in $(seq 1 650); do curl -sS -o /dev/null -w '%{http_code}\n' -I "$BASE/healthz-not/"; done | sort | uniq -c

# 15. In a browser: open $BASE and click every link in the table at the end of
#     "Service level". Each row names the status and media type a click should show.
```

---

## Operating it

- **Adding a subject**: add `data/<domain>.json`, add its provenance row to
  `data/README.md`, run `npm test`, push. Railway redeploys; the file is picked
  up at startup. No code change. Read
  [GUIDE.md § Adding a subject](GUIDE.md#adding-a-subject) first — the honesty
  rules are not optional.
- **Rollback**: Railway → **Deployments** → the previous successful deploy →
  **Redeploy**.
- **Logs**: one JSON object per request on stdout
  (`{"ts":…,"event":"request","method":…,"path":…,"status":…,"bytes":…,"ms":…}`).
- **Shutdown**: Railway sends `SIGTERM` on redeploy; the process stops accepting
  connections, drains in-flight requests, and exits (10 s ceiling).
- **Cost**: one always-on replica of a small Node process. `sleepApplication` is
  set to `false` in `railway.json` so a cited URL is never cold — flip it to
  `true` if you would rather trade first-byte latency for cost.

## Published image (ghcr.io)

The same `Dockerfile` Railway builds is also built, smoke-tested (`/healthz` and the
well-known document's media type) and pushed by the repository workflow
`.github/workflows/publish-github-packages.yml` to
`ghcr.io/andreibesleaga/sustainability-wellknown-gateway` (tags: the git tag, `latest`
from `main`, and the short commit sha). Railway keeps building from source; the image is
for reviewers who want to run the gateway without cloning:

```bash
docker run --rm -p 8080:8080 ghcr.io/andreibesleaga/sustainability-wellknown-gateway:latest
curl -si http://localhost:8080/.well-known/sustainability-data | head -5
```

