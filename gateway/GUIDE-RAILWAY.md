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
npm test          # 196 tests; everything must be green before you deploy
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
| `MAX_AGE` | `86400` | `Cache-Control: public, max-age=…`, the draft's RECOMMENDED value. |
| `BASE_URL` | *(empty)* | Public base URL, for absolute links in the index. |
| `SELF_TARGET` | `sustainability-data-gateway` | `target` of the gateway's own report. |
| `SELF_PROVIDER` | operator contact string | `provider` of the gateway's own report. Use a role address. |
| `SELF_METHODOLOGY_URI` | this repo's `gateway/METHODOLOGY.md` on GitHub | **Must resolve publicly.** Point it at wherever you actually publish `METHODOLOGY.md`. |
| `SELF_DISCLOSURE_URI` | this repo's `gateway/` on GitHub | Disclosure index for the gateway. |
| `SELF_PERIOD` | last completed calendar month | Pin the gateway's own reporting period (`YYYY` or `YYYY-MM`). |
| `SELF_WATTS` | `3` | Modelled average container power draw. |
| `SELF_GRID_INTENSITY` | `373` | gCO2e/kWh. Cited in `METHODOLOGY.md`. |

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
   renewal. The draft says the resource SHOULD be served over HTTPS; this is
   how that is satisfied.
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

# 10. The repository's own conformance battery, root endpoint
npx -y -p sustainability-wellknown-consumer sustainability-fetch "$BASE" --strict

# 11. The same battery, every subject (uses this repo's script)
npm run conformance -- "$BASE"
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
