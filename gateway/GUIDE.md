# Gateway guide

Everything you need to run, extend, verify and deploy the multi-domain
`sustainability-data` gateway.

- Deploying to Railway step by step → [GUIDE-RAILWAY.md](GUIDE-RAILWAY.md)
  (a condensed version is repeated in [Deploying](#deploying) below, so this
  document stands alone).
- How the gateway's own figures are derived → [METHODOLOGY.md](METHODOLOGY.md)
- Where every published number comes from → [data/README.md](data/README.md)

**Contents**

1. [What this is](#what-this-is)
2. [The honesty rules](#the-honesty-rules) ← read before adding any data
3. [Running it locally](#running-it-locally)
4. [Routes and HTTP contract](#routes-and-http-contract)
5. [Adding a subject](#adding-a-subject)
6. [Recording a subject that publishes nothing](#recording-a-subject-that-publishes-nothing)
7. [Wiring an adapter](#wiring-an-adapter)
8. [Validating the data files](#validating-the-data-files)
9. [Verifying a deployment](#verifying-a-deployment)
10. [Deploying](#deploying)
11. [Configuration reference](#configuration-reference)
12. [Design notes](#design-notes)

---

## What this is

One small HTTP service that publishes conformant
`/.well-known/sustainability-data` documents for many reporting subjects at
once:

```
GET  /{domain}/.well-known/sustainability-data   one subject's document
GET  /.well-known/sustainability-data            the gateway's own report
GET  /                                           human-readable index
GET  /index.json                                 machine-readable index
GET  /healthz                                    liveness
```

It exists because the specification cannot be exercised at scale until
organizations deploy the endpoint themselves. A registry of *real, sourced*
annual disclosures, served in the wire format at the right path with the right
headers, lets clients, validators and reviewers work against something concrete
today.

It is **not** an authoritative origin for anybody. See the next section — that
distinction is the whole design.

The gateway does not reimplement the format. It depends on the published
[`sustainability-wellknown-publisher`](https://www.npmjs.com/package/sustainability-wellknown-publisher)
package (v0.5.0) for normalization, the JTD validation gate, ETag generation,
caching and the per-document HTTP semantics; the gateway adds multi-subject
routing, `Last-Modified`, the index, and the honesty machinery.

## The honesty rules

This service publishes documents about organizations that never asked it to.
Everything below is a hard rule, enforced by the test suite where it can be.

1. **Never attribute an invented figure to a real organization.** Every number
   in a document about a real subject must be readable in that subject's own
   published report. If you cannot verify it, you do not publish it.
2. **Say so in band.** Every third-party document's `provider` member states
   that it is an illustrative mapping prepared by the gateway operator and is
   *not published, reviewed, authorized, or endorsed by the reporting subject* —
   followed by the specific scope caveats for that subject. `test/data.test.ts`
   fails the build if that wording is missing.
3. **`methodology-uri` points at the subject's own source document**, never at
   anything the operator wrote. The test suite rejects a real subject whose
   `methodology-uri` points back into this repository.
4. **Omit rather than approximate.** A member the source does not support is
   left out. The format deliberately has no in-band "not reported" marker, so
   omission carries that meaning exactly. Filling a gap with a plausible number
   is the single failure mode this registry exists to avoid.
5. **Synthetic data lives under reserved names only.** Anything invented is
   served under a `.example` domain (RFC 2606), says `SYNTHETIC EXAMPLE` in
   capitals in its `provider` member, and is badged `synthetic` in the index.
6. **Record provenance at the same time as the data.** Source URL, retrieval
   date, and every caveat go into [data/README.md](data/README.md) in the same
   change. A test asserts every data file has an entry.
7. **List the gaps.** A subject you looked for and could not publish goes into
   [`data/_no-data.json`](data/_no-data.json) with the evidence of absence. A
   registry that showed only the organizations that publish would overstate how
   much of the web is measurable.
8. **The index says all of this**, on the HTML page and in `index.json`, so a
   reader who never opens a document still sees it.

## Running it locally

```bash
cd gateway
npm install
npm run build
npm test                       # 196 tests
node dist/index.js             # binds 0.0.0.0:8080
```

Then:

```bash
curl -sS http://127.0.0.1:8080/index.json | jq '.count, .subjects[].domain'
curl -sSI http://127.0.0.1:8080/cloudflare.com/.well-known/sustainability-data
open http://127.0.0.1:8080/
```

If the process refuses to start, that is the design working: a data file that is
not conformant, is oversized, or would be silently altered by the publisher
pipeline stops the boot rather than being served. The error names the file and
the reason.

## Routes and HTTP contract

The gateway implements the **Basic** service level: `capabilities: "basic"`, no
query parameters.

| Route | Behaviour |
|---|---|
| `GET\|HEAD /{domain}/.well-known/sustainability-data` | The subject's document. `200` + `application/json`, or `404` if the subject is unknown. |
| `GET\|HEAD /.well-known/sustainability-data` | The gateway's own report, `target-type: "service"`. |
| `GET\|HEAD /` | HTML index: every subject, the honesty notice, the gaps. |
| `GET\|HEAD /index.json` | The same index, machine-readable. |
| `GET\|HEAD /healthz` | `{"status":"ok","subjects":N}`, `Cache-Control: no-store`. |
| any other method on any of the above | `405` + `Allow: GET, HEAD`. |
| anything else | `404` with a JSON body. |

Observed on a `200` for a subject document:

```
HTTP/1.1 200 OK
Cache-Control: public, max-age=86400
Access-Control-Allow-Origin: *
Content-Type: application/json
ETag: "eaf71630ba91732fd7654c506d04d128bad209be"
Last-Modified: Tue, 15 Jul 2025 00:00:00 GMT
Content-Language: en
Content-Length: 939
```

Notes on each of those, and on the rules behind them:

- **`ETag` is strong** (no `W/`), a SHA-1 of the exact body, produced by the
  publisher package. `If-None-Match` — including `*` — yields `304` with the
  same validator and no body.
- **`Last-Modified` comes from the document's own `updated` member**, not from
  the file's mtime. It describes the published document, not the deploy, so it
  is stable across redeploys and replicas.
- **`Content-Language: en`** identifies the language of the human-readable
  `provider` text, which the specification's Internationalization
  Considerations ask publishers to do at the HTTP layer. No negotiation is
  offered, so there is no `Vary`.
- **`HEAD` returns byte-identical headers** to `GET`, `Content-Length`
  included, with no body.
- **CORS is on every response**, `404` and `405` included, so a cross-origin
  client can read the status rather than an opaque failure.
- **Query parameters are ignored, never an error.** The specification requires a
  server that does not support the Extended parameters to ignore them and return
  the Basic response. `?period=2019&granularity=hourly&target=/x` returns the
  byte-identical `200` with the same `ETag`. This also collapses every query
  string onto one cache entry, which is the specification's Denial-of-Service
  guidance about bounding the cache-key space.
- **An unknown subject is `404`** — the no-data rule. For a subject listed in
  `_no-data.json` it is still `404`, but the body carries the finding, the
  evidence URLs, and a pointer to a parent that does report:

  ```json
  {
    "status": 404,
    "error": "no sustainability metadata is published here for that reporting subject",
    "reason": "consolidated-into-parent",
    "entity": "GitHub, Inc.",
    "finding": "GitHub publishes no standalone GHG inventory. …",
    "evidence": ["https://github.blog/…", "https://aka.ms/SustainabilityFactsheet2026"],
    "see": "/microsoft.com/.well-known/sustainability-data",
    "checked": "2026-07-29"
  }
  ```

- **No `carbon.txt` path is served or referenced anywhere.** The Independent
  Submission Editor's review asked that unregistered well-known paths not be
  advertised; a test asserts the string does not appear in the data files or the
  index page.

## Adding a subject

The data layer is drop-in: **no code change is needed.**

1. **Read the primary source.** The organization's own sustainability report,
   ESG report, impact report, environmental data fact sheet, EMAS statement, or
   equivalent. Not a news article, not an aggregator, not memory. If it is a
   PDF, extract the text and read the actual table.

2. **Create `data/<domain>.json`**, a single JSON object in wire format. The
   domain in the filename is the route. Use the subject's primary domain,
   lowercase.

   ```json
   {
     "version": "2.0",
     "updated": "2026-07-29T00:00:00Z",
     "capabilities": "basic",
     "provider": "Illustrative mapping prepared by the gateway operator, NAME (EMAIL), from the reporting subject's own published DOCUMENT; NOT published, reviewed, authorized, or endorsed by the reporting subject. Every figure is read from the source document named in methodology-uri. Scope caveats: …",
     "measurement-method": "hardware-estimated",
     "methodology-uri": "https://example.com/their-actual-report.pdf",
     "reporting-period": "2025",
     "target": "Example Corporation",
     "carbon-footprint": 12345,
     "carbon-unit": "mtCO2e",
     "carbon-accounting": "location-based",
     "scope-1": 100,
     "scope-2": 2245,
     "scope-3": 10000,
     "disclosure-uri": "https://example.com/sustainability/",
     "target-type": "organization"
   }
   ```

   Rules the loader and tests enforce:

   - a **single object**, never an array (the Basic response is one object);
   - all 8 mandatory members present; `version: "2.0"`; `capabilities: "basic"`;
   - `reporting-period` a **full calendar year**, `YYYY`;
   - `target-type` one of `organization`, `origin`, `service`;
   - every URI member an absolute `https` URI;
   - any extension member reverse-domain-named and lowercase
     (`io.github.you.thing`) — undotted names are reserved for the
     specification;
   - if scopes and a total are both present, they must reconcile (0.1% of the
     total, for publishers who round);
   - the file must survive the publisher pipeline **unchanged** — see
     [Design notes](#design-notes).

3. **Omit what the source does not support.** No renewable share published? Omit
   `renewable-energy`. Scope 2 basis unlabeled? Omit `carbon-accounting`. Only a
   combined Scope 1+2 figure? Omit all three scope members and publish only
   `carbon-footprint`. Every one of those cases is live in `data/` already; copy
   the nearest.

4. **Fiscal years.** `reporting-period` admits only whole calendar periods.
   For a subject reporting on a fiscal year, carry the calendar year in which
   the fiscal year *ended*, and state the exact boundary in two more places: in
   the `provider` caveats, and in a machine-readable extension member. The
   registry uses `io.github.andreibesleaga.reporting-period-basis`, e.g.
   `"fiscal-year-ended-2025-06-30"`. See `microsoft.com.json` and
   `ovhcloud.com.json`.

5. **Record the provenance** in [data/README.md](data/README.md): source URL,
   retrieval date, the figures read, and every caveat. A test fails if a data
   file has no entry.

6. **Run the checks**, then deploy:

   ```bash
   npm test
   npm run build && node dist/index.js &
   curl -sS http://127.0.0.1:8080/<domain>/.well-known/sustainability-data | jq .
   ```

## Recording a subject that publishes nothing

Some organizations publish no usable figures at all. Those belong in
[`data/_no-data.json`](data/_no-data.json) — the leading underscore keeps the
file out of the subject registry — with the evidence of absence:

```json
{
  "domain": "example.com",
  "entity": "Example Holdings, Inc.",
  "status": "publishes-no-quantitative-data",
  "finding": "What you searched and what you found. Be specific: which filings, which pages, what they do and do not contain.",
  "evidence": ["https://…", "https://…"],
  "checked": "2026-07-29"
}
```

`status` is either `publishes-no-quantitative-data` or
`consolidated-into-parent`; the latter takes an optional `see` naming a subject
in this registry that does cover it. The loader rejects an entry with no
evidence URLs, no `checked` date, or a `finding` shorter than a sentence.

These appear in the index under "publishes no machine-readable data", and their
document route returns the informative `404` shown above.

## Wiring an adapter

Curated files answer "what do organizations publish today?". Adapters answer
"how would an organization generate this itself?". Two are wired into the
gateway as worked examples.

**1. The gateway's own report — `computedAdapter`.**
`src/adapters/self-report.ts` composes the published `computedAdapter`: energy
= power × hours in the calendar period, carbon = energy × grid intensity, with
the members that adapter does not carry (`updated`, `target`, `target-type`,
`disclosure-uri`) added by a thin wrapper. It is served at
`/.well-known/sustainability-data`.

**2. `kepler-prometheus` in replay mode.** `src/adapters/kepler-replay.ts` runs
the real Kepler/Prometheus adapter against a *recorded* `/api/v1/query`
response, so no cluster, credentials or network are needed. In production you
swap one option:

```ts
keplerPrometheusAdapter({
  provider: "Example Corp (sustainability@example.com)",
  methodologyUri: "https://example.com/methodology",
  reportingPeriod: "2025",
  gridIntensity: 373,
  // replay:
  fixture: KEPLER_FIXTURE_2025,
  // live — delete `fixture` and add:
  // prometheusUrl: "http://prometheus.internal:9090",
  // query: "sum(kepler_node_platform_joules_total)",
});
```

It is served at `/kepler-demo.example/.well-known/sustainability-data`, under a
reserved name because the recorded counters are invented.

**Registering any adapter** takes one call in `createGateway()`
(`src/app.ts`):

```ts
subjects.set("example.com", await subjectFromAdapter({
  domain: "example.com",
  adapter: myAdapter,
  target: "Example Corporation",
  targetType: "organization",
  label: "adapter:climatiq",
}));
```

The document is produced at startup, passes the same JTD validation gate as a
curated file, and is served from the same route with the same headers.

**The adapters available** from `sustainability-wellknown-publisher`, and what
each is for:

| Adapter | Source of truth | Credentials |
|---|---|---|
| `staticAdapter` / `staticFileAdapter` | inline values, or a JSON file (native or wire format) | none |
| `computedAdapter` | an energy figure × a grid intensity factor | none |
| `keplerPrometheusAdapter` | Kepler joule counters via a Prometheus query — real hardware metering | Prometheus URL (or a fixture) |
| `climatiqAdapter` | Climatiq emission-factor API | API key |
| `co2jsAdapter` | `@tgwf/co2` models for transferred bytes | none |
| `carbonTxtApiAdapter` | a Green Web Foundation carbon.txt index, via its API | none |
| `salesforceNzcAdapter` | Salesforce Net Zero Cloud | org credentials |
| `msSustainabilityAdapter` | Microsoft Sustainability Manager | tenant credentials |
| `watershedAdapter` | Watershed | API key |

The realistic production shape for an organization is: enterprise carbon
platform (Watershed / Net Zero Cloud / Sustainability Manager) for the annual
inventory, or Kepler+Prometheus for measured infrastructure energy, feeding the
publisher, which validates and serves. The gateway is only what you do while
waiting for that.

## Validating the data files

Three independent checks, all of which must pass.

**1. In the test suite** (JTD + the specification's prose rules + the honesty
rules), via the publisher's validator:

```bash
npm test
```

**2. Against the repository's canonical schemas** — JTD (RFC 8927) and CDDL
(RFC 8610):

One-time setup for the two independent validators (any machine):

```bash
python3 -m venv ~/.cache/sustain-venv && ~/.cache/sustain-venv/bin/pip install jtd   # python JTD validator
gem install --user-install cddl                                                      # ruby CDDL validator
```

```bash
source ~/.cache/sustain-venv/bin/activate            # python `jtd`
export PATH="$(ruby -e 'print Gem.user_dir')/bin:$PATH"     # the `cddl` tool
cd ../schemas-validators
for f in ../gateway/data/*.json; do
  case "$(basename "$f")" in _*) continue;; esac
  echo "--- $(basename "$f")"
  python3 validator-json.py "$f" && python3 validator-cddl.py "$f"
done
```

Last run 2026-07-29: **11 files, 22/22 JTD + CDDL checks passed** (also enforced continuously by `.github/workflows/gateway.yml`, which boots the server and runs the conformance battery on every push).

**3. Against a running server**, including the documents produced by adapters
rather than files:

```bash
curl -sS http://127.0.0.1:8080/.well-known/sustainability-data > /tmp/self.json
python3 ../schemas-validators/validator-json.py /tmp/self.json
python3 ../schemas-validators/validator-cddl.py /tmp/self.json
```

## Verifying a deployment

Set `BASE` and run the whole battery. This is what a reviewer will do.

```bash
BASE=https://your-gateway.example.org

# health
curl -sS "$BASE/healthz"

# a subject document, headers then body
curl -sSI "$BASE/cloudflare.com/.well-known/sustainability-data"
curl -sS  "$BASE/cloudflare.com/.well-known/sustainability-data" | jq .

# conditional GET -> 304
ETAG=$(curl -sSI "$BASE/cloudflare.com/.well-known/sustainability-data" \
       | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r')
curl -sS -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" \
     "$BASE/cloudflare.com/.well-known/sustainability-data"          # 304

# HEAD == GET headers, no body
curl -sSI -X HEAD "$BASE/cloudflare.com/.well-known/sustainability-data"

# 405 + Allow
curl -sSI -X POST "$BASE/cloudflare.com/.well-known/sustainability-data"

# unknown subject -> 404; a listed gap -> 404 with the finding
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/nobody.example/.well-known/sustainability-data"
curl -sS "$BASE/github.com/.well-known/sustainability-data" | jq .

# query parameters IGNORED, not an error
curl -sS -o /dev/null -w '%{http_code}\n' \
     "$BASE/cloudflare.com/.well-known/sustainability-data?period=2019&granularity=hourly"   # 200

# the gateway's own report
curl -sS "$BASE/.well-known/sustainability-data" | jq .

# the repository's own conformance battery, root endpoint
#   (consumer >= 0.5.0 accepts the origin and options in either order)
npx -y -p sustainability-wellknown-consumer sustainability-fetch "$BASE" --strict

# the same battery against EVERY subject (walks /index.json)
npm run conformance -- "$BASE"
```

`sustainability-fetch` always requests `/.well-known/sustainability-data` at the
origin root, which for this service is the gateway's own report. To run the
battery per subject, `scripts/conformance.mjs` injects a `fetch` that rewrites
that one path to each subject's route; everything else about the battery is
unchanged. It is also part of `npm test`.

Expected result: **every check PASS, for the root and for all 12 subjects.**

## Deploying

The full runbook, with both the CLI and the dashboard path, custom domains and
DNS, is in [GUIDE-RAILWAY.md](GUIDE-RAILWAY.md). In brief:

**CLI**

```bash
npm i -g @railway/cli
railway login
cd gateway
railway init          # Empty Project
railway up            # builds the Dockerfile
railway domain        # assigns a public URL
```

**Dashboard**

1. Push the branch containing `gateway/`.
2. railway.app → New Project → Deploy from GitHub repo.
3. Service → Settings → **Root Directory `gateway`**, Builder **Dockerfile**,
   Healthcheck Path `/healthz`, Start Command empty.
4. Settings → Networking → Generate Domain.

**Custom domain**: Settings → Networking → Custom Domain, then a `CNAME` from
your subdomain to the hostname Railway shows (an `ALIAS`/`ANAME` record for an
apex domain, since a CNAME at the apex is not permitted). Railway issues and
renews the certificate automatically. If Cloudflare is in front, keep the record
**DNS only** until Railway reports the domain Active.

**Why a Dockerfile rather than Nixpacks**: this deployment is going to be cited
and curl-ed, so the build must be reproducible and inspectable rather than
inferred. The Dockerfile pins the Node major version, installs from the
lockfile with `npm ci`, ships only production dependencies and compiled output,
runs as a non-root user, and builds byte-identically on a laptop.

**Before citing the URL**: make sure `SELF_METHODOLOGY_URI` resolves publicly.
It is a mandatory member of a document you are publishing, and the
specification requires the resource behind it to be retrievable without
authentication. The default points at `gateway/METHODOLOGY.md` on GitHub, which
works once the branch is pushed.

## Configuration reference

Everything comes from the environment; nothing is required except what Railway
injects.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | Injected by the platform. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DATA_DIR` | `<app>/data` | Where subject documents are read from. |
| `MAX_AGE` | `86400` | `Cache-Control: public, max-age=…`. |
| `BASE_URL` | *(empty)* | Public base URL for absolute links in the index. |
| `SELF_TARGET` | `sustainability-data-gateway` | `target` of the gateway's own report. |
| `SELF_PROVIDER` | operator contact | `provider` of the gateway's own report; prefer a role address. |
| `SELF_METHODOLOGY_URI` | `gateway/METHODOLOGY.md` on GitHub | Must resolve publicly. |
| `SELF_DISCLOSURE_URI` | `gateway/` on GitHub | Disclosure index for the gateway. |
| `SELF_PERIOD` | last completed calendar month | Pin the gateway's own period (`YYYY` or `YYYY-MM`). |
| `SELF_WATTS` | `3` | Modelled average container power draw. |
| `SELF_GRID_INTENSITY` | `373` | gCO2e/kWh; sourced and caveated in METHODOLOGY.md. |

Bounds enforced by the loader (specification, Security Considerations), in
`src/config.ts`:

| Bound | Value |
|---|---|
| Largest source document, and largest body served | 256 KiB |
| Array-entry cap | 366 (and array documents are refused outright — the Basic response is a single object) |
| Longest domain accepted on a request line | 253 characters |

## Design notes

**The round-trip gate.** Every curated file is run through the publisher
pipeline at startup and the result compared, key-order-insensitively, with the
file. If they differ at all, the process refuses to start. This is what lets
[data/README.md](data/README.md) function as an audit trail: what is served is
byte-for-byte the document whose provenance is documented, never a
pipeline-massaged version of it. It catches real mistakes — a figure with more
decimal places than the normalizer keeps, or an `sci-score` missing its required
`functional-unit` (which the publisher's client-tolerance rule would otherwise
silently drop).

**Why the Basic service, and no query parameters at all.** The gateway relays
static annual disclosures. It has no finer-grained data to slice, so `period`
and `granularity` would be honest only as no-ops — and the specification's
answer for a server that does not support them is to ignore them and return the
Basic response, which is exactly what happens. The side benefit is that the
cache-key space is one entry per subject, which is the specification's
Denial-of-Service guidance.

**Why `node:http` rather than Express or Fastify.** The specification pins exact
status codes and header sets, and a framework that adds `X-Powered-By`, rewrites
`ETag`, or synthesises its own `HEAD` handling gets in the way of demonstrating
that. The core server has no runtime dependencies beyond the publisher package.
Teams that already run Express can mount the identical route resolver instead —
`src/express.ts` exports `gatewayMiddleware(gw)`, with a worked snippet in the
file header. Nothing in the deployed image imports it.

**Failure posture.** Startup is fail-loud: a malformed, non-conformant,
oversized, duplicated, or altered document stops the boot, and Railway surfaces
it as a failed health check rather than serving something wrong. At request
time the only 5xx path is an unexpected throw, which is logged and answered with
a JSON `500`.

**Logging.** One JSON object per request on stdout, with the path truncated to
512 characters; `JSON.stringify` escapes control characters, so a hostile path
cannot forge a log line.

**Shutdown.** `SIGTERM`/`SIGINT` stop new connections, drain in-flight
requests, and exit, with a 10-second ceiling.
