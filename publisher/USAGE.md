# Using `sustainability-wellknown-publisher`

This gateway is designed to be used in **three different ways**, all from the same
package — pick whichever fits your deployment, or mix them across environments
(e.g. the standalone binary in production, the library form in a test harness).

| Mode | When to use it | Section |
|---|---|---|
| **Standalone server** | You just want `/.well-known/sustainability-data` running; no existing Node app | [§1](#1-standalone-server-cli) |
| **Embedded middleware** | You already have an Express/Fastify app and want to add the endpoint to it | [§2](#2-embedded-middleware-in-an-existing-app) |
| **Library / programmatic** | You're on a different framework (Koa, Next.js, a serverless function, a plain `http` server, a cron job, a test) | [§3](#3-library--programmatic-usage-any-framework) |

Then: [§4 Writing a custom adapter](#4-writing-a-custom-adapter-extensibility),
[§5 Deployment recipes](#5-deployment-recipes), [§6 Installing from npm](#6-installing-from-npm),
[§7 Configuration reference](#7-configuration-reference).

---

## 1. Standalone server (CLI)

Zero code. Point the bundled CLI at a config file (see `examples/*.json` for one
per adapter) and it serves the endpoint directly.

```bash
npm install -g sustainability-wellknown-publisher   # or use npx, see §6
sustainability-publisher --config config.json --port 8080
curl http://localhost:8080/.well-known/sustainability-data
```

Or print one document and exit (for a cron job that writes a static file, feeding
`server-configurations/`'s static-file deployment):

```bash
sustainability-publisher --config config.json --once > /var/www/metadata/sustainability.json
```

Flags: `--config <path>` (required), `--port <n>` (default 8080), `--once` (print
and exit instead of serving), `--emit-carbon-txt` (print a matching
carbon.txt to stdout INSTEAD of the metrics document; requires
`server.carbonTxt.sustainabilityUrl` in the config). See `bin/sustainability-publisher.js` / `src/cli.ts`.

Two subcommands support the draft's OPTIONAL `signed` member (0.7.0):
`keygen [--alg EdDSA|ES256] [--out <private.jwk>]` writes the private JWK
(mode 0600, never overwriting) and prints the public JWK; `sign <in.json>
<out.json> --key <private.jwk> [--kid <id>]` — also installed as the
`sustainability-sign` command — validates a declaration file, signs every object
in it individually and writes the signed copy, which is the offline path for a
static host. A served deployment signs by setting `SUSTAINABILITY_SIGNING_KEY`
(the private JWK JSON) or `signing.keyFile` in the config. See `README.md`
§ Signing the declaration.

## 2. Embedded middleware in an existing app

If you already run Express or Fastify, add the endpoint to your existing server
instead of running a second process.

```ts
import express from "express";
import { Publisher, computedAdapter, expressSustainability } from "sustainability-wellknown-publisher";

const publisher = new Publisher(
  computedAdapter({
    provider: "Example Corp (sustain@example.org)",
    methodologyUri: "https://example.com/methodology",
    energy: { value: 1250, unit: "kWh" },
    gridIntensity: 276,
    capabilities: "basic",  // no Extended query-param support (-03 semantics)
  }),
  // Mandatory reporting subject (draft `target` member): the origin host for
  // an origin-wide report. Adapter-supplied raw.target takes precedence.
  { normalize: { target: "example.com" } },
);

const app = express();
app.use(expressSustainability(publisher));   // handles GET/HEAD, 405s, caching, carbon.txt
app.listen(3000);
```

Fastify is the same shape with `fastifySustainability` (see `README.md` §Fastify
plugin for the full example). Both middlewares implement every draft-required
behavior (405+`Allow`, conditional requests, CORS, optional bidirectional
carbon.txt) — you don't need to reimplement anything from §3 below unless you're
on a framework without a bundled middleware.

## 3. Library / programmatic usage (any framework)

Everything the middlewares do is built from two plain functions/classes you can
call directly: `new Publisher(adapter, options)` and `handleRequest(publisher, query, opts)`
(from `src/handler.ts`, also exported from the package root). This is the path for
Koa, Next.js API routes, AWS Lambda / Cloud Functions, Cloudflare Workers, a plain
`http.createServer`, a CI check, or a unit test.

### 3a. Just get the document (simplest — no HTTP semantics needed)

```ts
import { Publisher, computedAdapter } from "sustainability-wellknown-publisher";

const publisher = new Publisher(computedAdapter({ /* ... */ }), {
  normalize: { target: "example.com" }, // mandatory reporting subject
});
const doc = await publisher.getDocument({ period: "2026-02" }); // validated, ready to serve/store
```

This is enough for a cron job, a build step, or feeding a static-file deployment
(§1's `--once` is a thin CLI wrapper around exactly this call).

### 3b. Full HTTP semantics without an Express/Fastify dependency

`handleRequest` implements everything the middlewares do (status codes, `Allow`,
`ETag`/conditional requests, CORS, caching headers) as a plain function returning
`{ status, headers, body }` — wire it into any request/response model:

**Access control**: the draft answers a `GET` without query parameters with
`200 OK` **when the server has a declaration to serve for that requester**, and
`404` when nothing is published. Access control is out of scope: a deployment
that restricts the resource, or rate-limits it, responds as RFC 9110 defines.
Nothing here forces the document on every requester — wrap or front the handler
with whatever authorization your deployment needs.

**CORS**: successful responses SHOULD include
`Access-Control-Allow-Origin: *` (WebFinger practice, so browser-based
aggregators can read the public document). `handleRequest`, both middlewares,
and the standalone server emit the header on **every** response — 200/304 and
the 404/405/503 error statuses alike, so cross-origin clients can read errors
too. Set the `cors` option to another value or `false` to override.

**Query processing** (`parseQuery`, applied identically by every entry point;
the numbered procedure of the draft's §Extended Query Parameters):

1. a parameter name that appears **more than once** is **`400 Bad Request`**;
   names other than `target`, `period` and `granularity` are ignored. The ABNF
   is **case-sensitive** (RFC 7405 `%s`), so `Period=`, `TARGET=` and
   `Granularity=` are undefined names and are ignored — including when they
   repeat;
2. a `period` that is not a real calendar `YYYY`, `YYYY-MM` or `YYYY-MM-DD`
   (the ABNF's `period-value` rule; `2026-02-30` is not one) is
   **`400 Bad Request`**;
3. `monthly` denotes **month precision** and `daily` denotes **day precision**;
   year is coarser than month, which is coarser than day. Let G be the precision
   the value denotes. A `granularity` whose value is neither token
   (`weekly`, `MONTHLY`, …), or whose precision is **not finer than the
   period's**, is **ignored** — the request proceeds as if the parameter were
   absent, so no array can be returned for it. One that IS finer is *in effect*,
   and the response is then the array of the held entries **whose precision is
   G** inside the period — **`404`** when there are none, never a fallback to
   the period's own object, and never an entry of some other precision that
   merely lies inside the period. With `period` absent the period in effect is
   that of the Basic response — and, where the Basic response is an array, that
   of its **last** object;
4. a `target` that matches none of the publisher's published prefixes
   (`PublisherOptions.targetPrefixes`) is **`404`**; a matching one becomes the
   `target` member of every returned object. With no prefix set configured the
   publisher does not support the parameter, ignores it, and does not even pass
   it to the adapter, so every value gets the same response;
5. the response shape then follows the draft's rule (`selectPeriod`,
   `src/period.ts`): an **array only when a finer granularity is in effect**
   (`?period=2026&granularity=monthly` over monthly entries); otherwise **one
   object** — the entry for the period, or the aggregate of the finer entries
   inside it (below) — an aggregate whose contributors are of one precision, do
   not overlap and **cover** the period; a period with no entries is **404**. An
   adapter declaring `capabilities: "basic"` ignores every parameter and always
   answers the Basic response;
6. for a period that has not yet completed, what is reported is the completed
   portion to date — the figures are the adapter's, as before, and the library's
   only part in it is the coverage test of step 5, which for such a period asks
   for the sub-periods that have **completed** rather than for the whole of it;
7. the **cache key** is computed from the parameters the publisher honors, in
   the canonical order `target`, `period`, `granularity` — never from the query
   string as received. `?a=1` and `?a=2` are one cache entry with one `ETag`;
   so are two values under the same honored `target` prefix, and a `granularity`
   the publisher ignores. `publisher.cacheKeyFor(query)` exposes the key so an
   upstream CDN can key the same way, and `publisher.cacheSize` reports how many
   entries are held.

**The aggregate** (`aggregatePeriod`, `src/period.ts`) is what a request for a
period with no entry of its own gets when finer entries lie inside it. It carries
exactly what the draft's step 5 lists:

- **the contributing entries** are "the held entries of one precision that lie
  within P: where the server holds more than one precision inside P, it takes
  the coarsest… They MUST NOT overlap… and they MUST cover P, or, where P has
  not yet completed, the completed portion of it that step 6 provides for."
  `contributingEntries` (exported from `src/period.ts`) chooses them, and
  `aggregatePeriod` sums nothing else:
  - only an entry **inside** the period and of a precision **finer** than it
    contributes; an entry for the period itself is the answer to the request,
    not a contribution to it;
  - where more than one precision lies inside the period, the **coarsest** one
    is taken and every entry of any other precision is dropped. A publisher
    holding the twelve months of 2026 and three days inside January aggregates
    `?period=2026` from the **twelve months**, so those days are not counted
    twice. The draft **requires** that choice — "it takes the coarsest, so that
    two servers holding the same data return the same figures" — and the reason
    holds in practice too: the rule is deterministic (it depends only on the
    periods held), reports the period most completely (a coarser series normally
    spans the whole of it, while finer entries cover a part), is stable as finer
    entries are published, and uses the publisher's own coarser figures rather
    than re-deriving them. The finer entries stay reachable:
    `?period=2026-01&granularity=daily` returns them;
  - two entries of one precision can overlap only by naming the **same period
    twice**, which a trend MUST NOT do. Such a set has no aggregate: the answer
    is the no-data **`404`**, not a figure counting that period twice, and
    `onError` fires with an `AggregateOverlapError` naming the period held twice;
  - they must **cover** the period, which is a **tiling with no gaps**, not a
    count of entries: every sub-period of the period, at the precision chosen
    above, that has **completed** must be one of them
    (`completedSubPeriods(period, precision, now)`). A finished year missing its
    June is refused, and so is one holding only January to March — "a server
    holding figures for only part of a finished period cannot present their sum
    as a figure for the whole of it". For a period that has **not yet
    completed**, what must be covered is the part of it that has: a year whose
    January to August are all held is served as the year-to-date aggregate in
    mid-September (step 6), and an entry for the month still running is not
    required, though where the publisher holds one it still contributes. A gap
    is the no-data **`404`** with an `AggregateCoverageError` through `onError`,
    naming the sub-periods missing. **The clock** is the publisher's
    `PublisherOptions.now` (`() => new Date()` by default) and is read for
    nothing else; pass a fixed one in tests, and a lagging one where your figures
    for a period land some days after it ends. Note that only the *aggregate* is
    refused: `?period=2025&granularity=monthly` still returns the months the
    publisher does hold, and each month is still served on its own;
- `reporting-period` is the requested period, and `capabilities` is `extended`;
- `energy-consumption`, `carbon-footprint` and `scope-1/2/3` are **sums taken
  after converting the contributing entries to the unit the aggregate itself
  declares** in `energy-unit` / `carbon-unit`. That unit is **the one declared
  by the last contributing entry in ascending order of `reporting-period`** —
  the entry for the latest period, which is a dimension of its own: it is *not*
  the entry with the latest `updated`, a separate rule of the same step. Where
  that entry declares no unit, the draft's default for the member applies
  (`kWh`, `gCO2e`). The library picks it by period rather than by array index,
  so calling `aggregatePeriod` yourself with the entries in another order gives
  the same unit;
- each of those summable members is **carried only where every contributing
  entry reports it**, and omitted otherwise, "since summing where some entries
  are silent would understate the period". One month silent about `scope-3`
  therefore removes `scope-3` from the year, while `scope-1` and `scope-2`,
  which every contributor reports, are summed as usual. The test is applied over
  the **contributing** entries only, so an entry dropped by the one-precision
  rule cannot suppress a member with its silence;
- `updated` is the **latest** `updated` of the contributing entries;
- `provider`, `measurement-method`, `methodology-uri`, `target` and
  `target-type` are those of the contributing entries, which **MUST agree** —
  when they do not, the server "MUST NOT serve an aggregate, since it could only
  misdescribe what the figures are about, and responds as it does when it has no
  data". `aggregatePeriod` raises `AggregateDisagreementError` rather than
  describing the aggregate with one contributor's context, and the handler
  answers the requester with the **no-data `404`** — byte for byte the response
  a period with no entries gets — while reporting the error through `onError`,
  naming the member and the values that disagreed. That report goes to your hook
  and **nowhere else**: with no hook configured nothing is written, to the
  console or anywhere, because the server is not broken, the finding recurs on
  every request that touches the period, and its message names the periods you
  hold — the coverage information Privacy Considerations keeps out of the
  response. Configure a hook if you want to hear about it. It is **not** a `503`: the request is not at fault and the server
  is not broken, but the data set you are publishing is inconsistent and only
  the operator can fix it, so watch that hook. A disagreement, an overlap and a
  gap in the coverage are the same kind of event and share a base class,
  `UnservableAggregateError`: `catch` that one to handle all three;
- every other metric member (`sci-score`, `renewable-energy`,
  `carbon-intensity-gCO2e-per-kWh`, `estimated-annual-emissions-kgCO2e`, and
  `functional-unit` with the score it belongs to) is **omitted**: this library
  recomputes none of them. A publisher that does recompute one for the
  aggregated period adds it itself and says so in the methodology document;
- an optional member that is **not a metric** (`carbon-accounting`,
  `disclosure-uri`, `verifiable-attestation-uri`, `upstream`, `extensions`) is
  "carried only where every contributing entry carries it with the same value,
  and omitted otherwise". Carrying it is part of the test: a member that one
  contributor omits is omitted from the aggregate even though the others agree;
- an aggregate that would carry **no metric member at all** is not emitted: the
  answer is **`404`**, per step 5, and an evidence link does not stand in for a
  metric here. A publisher holding only, say, `sci-score` for its monthly
  entries therefore has no yearly aggregate to serve — and so does one whose
  months report *different* lone metrics (January energy only, February carbon
  only): each member is dropped for not being reported by every contributor,
  which leaves the aggregate with nothing to carry;
- `signed` is never carried over: the aggregate is a new object, signed after it
  is built, if the publisher signs at all.

`parseQuery` returns `{ ok: true, query }` or `{ ok: false, error }`; pair the
rejection with `badRequestResult(error, opts)` (both exported) to produce the
400 response, as the bundled middlewares do.

```ts
import { Publisher, handleRequest, parseQuery, badRequestResult, computedAdapter } from "sustainability-wellknown-publisher";

const publisher = new Publisher(computedAdapter({ /* ... */ }));

// Next.js (Pages Router) API route, app/.well-known/sustainability-data/route.ts (App Router
// equivalent is analogous), AWS Lambda (API Gateway proxy integration), Cloudflare
// Workers `fetch` handler, Koa middleware, or a plain node:http server — all follow
// this same shape: parse the incoming query string, call handleRequest, map the
// result onto your framework's response object.

async function onRequest(rawQuery: Record<string, string | string[]>, method: string, ifNoneMatch?: string) {
  const parsed = parseQuery(rawQuery);              // a repeated name / bad period -> 400
  const result = parsed.ok
    ? await handleRequest(publisher, parsed.query, {}, ifNoneMatch)
    : badRequestResult(parsed.error);
  return result; // { status, headers, body } — send as-is
}
```

Concretely, for a plain Node HTTP server:

```ts
import { createServer } from "node:http";
import { URL } from "node:url";
import {
  Publisher, handleRequest, parseQuery, queryFromSearchParams, badRequestResult,
  WELL_KNOWN_PATH, computedAdapter,
} from "sustainability-wellknown-publisher";

const publisher = new Publisher(computedAdapter({ /* ... */ }));

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== WELL_KNOWN_PATH) return res.writeHead(404).end();
  // queryFromSearchParams keeps repeated names, which step 1 answers with 400.
  const parsed = parseQuery(queryFromSearchParams(url.searchParams));
  const result = parsed.ok
    ? await handleRequest(publisher, parsed.query, {}, req.headers["if-none-match"] as string)
    : badRequestResult(parsed.error);
  res.writeHead(result.status, result.headers);
  res.end(req.method === "HEAD" ? undefined : result.body);
}).listen(8080);
```

For a serverless function (AWS Lambda behind API Gateway, a Cloudflare Worker,
etc.), the pattern is identical: extract the query string and `If-None-Match`
header from whatever event object your platform hands you, call `handleRequest`,
and map `{status, headers, body}` onto your platform's response shape. `Publisher`
holds no server-specific state, so it's safe to construct once per cold start
(module scope) and reuse across invocations — see §5 for a worked serverless note.

### 3c. Advanced: build the pipeline yourself

If you need to hook in at a lower level (e.g. inspect the raw adapter output
before validation, or apply your own caching layer instead of `Publisher`'s
built-in one), the individual pipeline stages are all exported: an adapter's
`fetch()`, `normalize()`, `secureReports()`, `validateDocument()`/`assertValid()`.
`Publisher.build()` is a thin, ~15-line composition of exactly these four calls
(`src/publisher.ts`) — read it as the reference wiring if you need to diverge
from it. `validateDocument()`/`assertValid()` stand on their own: they apply the
JTD schema *and* every prose rule of the draft the schema cannot express — the
value ranges, non-finite numbers, the `sci-score`⇒`functional-unit` dependency,
the `updated` / `reporting-period` / `target` shapes, the at-least-one rule, the
absolute-URI form of the `extensions` keys, and the absolute-`https` requirement on
`methodology-uri`, `disclosure-uri`, `verifiable-attestation-uri` and every
`upstream[].declaration` — so a hand-built document (the one
`sustainability-sign` reads, for instance) is held to the same bar as one this
pipeline produced.

## 4. Writing a custom adapter (extensibility)

The package ships ten adapters (`static`, `static-file`, `computed`, `kepler-prometheus`,
`climatiq`, `co2js`, `carbontxt-api`, `salesforce-nzc`, `ms-sustainability`,
`watershed`), but any data source can plug in by implementing one interface:

```ts
export interface SourceAdapter {
  name: string;
  capabilities: "basic" | "extended";
  fetch(query: ServiceQuery): Promise<RawMetrics | RawMetrics[]>;
}
```

`RawMetrics` (from `src/types.ts`) is the gateway's internal, camelCase model —
`normalize()` converts it to the draft's wire field names/units, so your adapter
never has to think about `energy-consumption` vs `energyKwh` unit conversion,
rounding, or JSON key casing. A minimal custom adapter:

```ts
import { Publisher, RawMetrics, SourceAdapter } from "sustainability-wellknown-publisher";

function myAdapter(): SourceAdapter {
  return {
    name: "my-internal-metering-system",
    capabilities: "extended",
    async fetch(query): Promise<RawMetrics> {
      const row = await myInternalMeteringApi.getLatest(query.target);
      return {
        provider: "My Company (sustain@mycompany.example)",
        measurementMethod: "hardware-metered",
        methodologyUri: "https://mycompany.example/methodology",
        reportingPeriod: row.period,        // "YYYY", "YYYY-MM", or "YYYY-MM-DD"
        // Set `target` when you scope to a requested path prefix; otherwise the
        // publisher-level normalize.target fallback (below) is used. Both
        // energy and carbon are optional since -03 — omit what you don't have.
        // Optionally classify the subject with the -04 `target-type` hint
        // (e.g. targetType: "path" when scoping to a path prefix).
        target: query.target,
        energy: { value: row.kwh, unit: "kWh" },
        carbon: { value: row.gCO2e, unit: "gCO2e" },
        // Publisher-defined data goes under an absolute URI: `urn:uuid:` and
        // a lowercase UUID you generate once, or an `https` URI documenting the
        // members for a human (which no consumer ever fetches). The declaration
        // object itself is closed and takes no other member.
        extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": { "water-consumption-m3": row.m3 } },
        // The providers these figures derive from, if any.
        upstream: [{ declaration: "https://cloud.example/tenants/acme.json", role: "cloud" }],
      };
    },
  };
}

const publisher = new Publisher(myAdapter(), { normalize: { target: "mycompany.example" } });
```

Study `src/adapters/computed.ts` (simplest) and `src/adapters/enterprise/watershed.ts`
(shows fail-loud validation of upstream data — never silently publish a guessed
period or a zero that should have been "not reported") as the two reference
shapes to copy from. Every built-in adapter also ships a `fixture`/`fixturePages`
replay-mode option for offline testing without live credentials — copy that
pattern too if you want your custom adapter to be test-friendly.

**Returning an array** (`RawMetrics[]`) from `fetch()` signals a trend; the
gateway sorts it, applies the safeguards (366-cap, most-recent-first truncation),
and applies the draft's response-shape rule described in §3b: one object unless a
granularity finer than the period was requested. You don't need to implement
that rule yourself; `Publisher.build()` already does. An adapter that honours
`period` itself (like the reference gateway's own report) simply returns the
entries for the period asked; the rule then agrees with it.

## 5. Deployment recipes

**Docker** (standalone server):
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
COPY bin ./bin
COPY config.json ./config.json
EXPOSE 8080
CMD ["node", "bin/sustainability-publisher.js", "--config", "config.json", "--port", "8080"]
```

**Behind nginx/Apache for TLS + rate limiting**: run the standalone server (or
your embedded app) on a local port and reverse-proxy to it — see
`server-configurations/nginx.conf` and `apache.conf` for the tested, commented-out
`proxy_pass`/`ProxyPass` blocks (verified end-to-end against this gateway).

**Serverless (Lambda / Cloud Functions / Workers)**: construct `Publisher` once
at module scope (cold-start init), and call `handleRequest` per invocation (§3b).
Prefer a longer `cacheTtlMs` (the in-memory cache survives warm invocations on
most platforms) or set `cacheTtlMs: 0` and rely on your platform's own edge/CDN
caching using the `Cache-Control`/`ETag` headers the gateway already returns.
Signing works with any TTL — the `signed` member is produced when the document
is built, so it is cached with it — but a longer `cacheTtlMs` avoids signing on
every cold request.

**Static-file deployment (no Node runtime at all)**: run `--once` on a schedule
(cron/CI) to regenerate a static JSON file, and serve it with the plain
`server-configurations/` snippets (no reverse proxy needed) — this gets you the
Basic service level with zero ongoing Node process, at the cost of no dynamic
Extended query-parameter support (see those files' READMEs for the tradeoff).

## 6. Installing from npm

Published: **[`sustainability-wellknown-publisher`](https://www.npmjs.com/package/sustainability-wellknown-publisher)**.

```bash
npm install sustainability-wellknown-publisher
```

A git checkout or a git-based install also work, e.g. for tracking `main` ahead of
a release:

```bash
npm install /path/to/rfc-sustainability-wellknown/publisher
npm install github:andreibesleaga/rfc-sustainability-wellknown#main:publisher
```

Publishing itself (`npm publish`, from a clean `publisher/` directory, after
`npm run build`) is a deliberate, one-way step — do it when you're ready to
commit to that package name and version publicly, not as part of routine repo
maintenance.

## 7. Configuration reference

The three option bags accepted by `new Publisher(adapter, options)`:

- **`PublisherOptions`** (`src/publisher.ts`): `cacheTtlMs` (default 86 400 000 =
  24h; `0` disables caching), `maxCacheEntries` (default 256, bounds the
  per-query-variant cache), `now` (the clock the aggregate's coverage test reads,
  `() => new Date()` by default, and read for nothing else — pin it in tests, or
  let it lag where your figures land some days after the period they cover ends),
  `security` (see below), `normalize` (`target` — the
  mandatory reporting subject fallback, use the origin host for origin-wide
  reports; `targetType` — optional `target-type` hint classifying the subject,
  one of `origin`/`path`/`organization`/`service`/`product`/`device`/`tenant`/
  `data-source` (draft -04; any other value throws); `energyUnit`/`carbonUnit`
  to force specific output units), `targetPrefixes` (the published prefix set
  the Extended `target` parameter is matched against; unset means the parameter
  is not supported), `signing` (`{ key, keyId? }` — see below). The URI members
  (`methodologyUri`, `disclosureUri`, `verifiableAttestationUri` and every
  `upstream[].declaration`) must be absolute `https` URIs, `extensions` keys must
  be absolute URIs with the scheme in lowercase — the two forms the draft names
  are an `https` URI with a host
  (documentation for a human, never dereferenced) and `urn:uuid:` plus a
  lowercase UUID other than the Nil and Max UUIDs (guaranteed collisions) — and
  the object must report at least one
  metric or evidence link — anything else throws at normalization, never
  reaching the wire. `cacheKeyFor(query)` and `cacheSize` expose the canonical
  cache key and the number of entries held.
- **`SecurityOptions`** (`src/security.ts`): `maxObjects` (default 366),
  `enforceDailyFloor` (default `true`), `applyNoise` (default `false` — values
  are published exactly as measured unless you opt in; when `true`,
  deterministic per-period ±1% noise per the draft's Privacy Considerations).
  Enabling `applyNoise` carries a **MUST**:
  the methodology document MUST state that noise is applied, and MUST bound its
  magnitude (±1% for this implementation). Do not enable it without publishing
  that statement — the library never turns it on for you.
- **Handler/middleware options** (`HandlerOptions`, `src/handler.ts`): `maxAge`,
  `cors` (default `"*"`; `false` disables), `onError` (the operator channel; it
  receives a FAULT — the adapter threw or the gate refused its output, answered
  `503`, which falls back to `console.error` when you pass no hook so a
  deployment that cannot publish never fails silently — and a DIAGNOSTIC, an
  `UnservableAggregateError` for a disagreement, an overlap or a gap in the
  coverage, answered `404`, which is written **only** to your hook and to
  nothing else when you pass none),
  `mediaType`, `carbonTxt` (see `README.md` §Adapters for the bidirectional
  carbon.txt setup). Signing is **not** a handler option: the `signed` member is
  part of the document, so it is configured on the `Publisher`.
- **`PublisherOptions.signing`**: `{ key, keyId? }`, the key from
  `importSigningKey()`/`generateSigningKey()`. With `keyId` the JWS header names
  the key with `kid` instead of embedding the public key as `jwk`.
- **CLI config `signing.keyFile` / `signing.keyId`**: path of the private JWK
  written by `keygen --out`; the `SUSTAINABILITY_SIGNING_KEY` environment
  variable (the JWK JSON itself) takes precedence.

See `README.md` for the full adapter-by-adapter config field reference and the
JSON config-file schema used by the CLI.
