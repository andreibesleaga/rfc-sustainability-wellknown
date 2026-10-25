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
and exit instead of serving), `--noise-disclosed` (confirm that your methodology
document states the privacy noise; needed with `security.applyNoise`),
`--emit-carbon-txt` (print a matching
carbon.txt to stdout INSTEAD of the metrics document; requires
`server.carbonTxt.sustainabilityUrl` in the config). See `bin/sustainability-publisher.js` / `src/cli.ts`.

Two subcommands support the draft's OPTIONAL `signed` member:
`keygen [--alg Ed25519|ES256] [--out <private.jwk>]` (`Ed25519` by default; `EdDSA`, the
identifier RFC 9864 deprecates, is refused) writes the private JWK
(mode 0600, never overwriting) and prints the public JWK; `sign <in.json>
<out.json> --key <private.jwk> [--kid <id>] [--x5c <chain.pem>]` — also installed as the
`sustainability-sign` command — validates a declaration file, signs every object
in it individually and writes the signed copy, which is the offline path for a
static host. A served deployment signs by setting `SUSTAINABILITY_SIGNING_KEY`
(the private JWK JSON) or `signing.keyFile` in the config. See `README.md`
§ Signing the declaration. `--x5c` takes a PEM file with the certificate chain of
the key, leaf first, and puts it in the header as `x5c` instead of the embedded
`jwk`; the leaf must hold the signing key.

A third subcommand converts files written for an earlier revision:
`upgrade <in.json> [<out.json>] [--check] [--updated <date-time>] [--offset <+hh:mm>]
[--measurement-method <token>]` reads a declaration file (or an array of them) written
for -08 or -09, converts the period (`reporting-period` or a pair of full-dates) and the
values of `measurement-method`, `functional-unit`, `carbon-unit`, upstream `role` and
`target-type` that the current sets do not contain, and prints the result to standard
output. With `<out.json>` the result is written there; the input is replaced only when
the same path is given twice. Each change is a note on standard error, a file that is
already current is returned byte for byte, and a `signed` member is dropped from every
object that is converted (sign it again afterwards). `--check` writes nothing and exits
`1` if the file would change. `--offset` is the offset in which a calendar day of the
earlier form begins (`Z` by default), `--updated` sets `updated` on the converted
objects, `--measurement-method` is the token to use for a free-text `measurement-method`
(the residual token by default). Exit status: `0` converted or nothing to convert, `1`
cannot be converted (or `--check` found a change), `2` usage error. See `README.md`
§ Migrating from 0.7.x.

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
    period: "2026-02",      // the whole month, in UTC; or { start, end } (two RFC 3339 date-times)
    capabilities: "basic",  // honors no query parameter; "extended" honors target, start, end, granularity
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
plugin for the full example). Both middlewares implement every behavior this package
provides (405+`Allow`, conditional requests, CORS, optional bidirectional
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
const doc = await publisher.getDocument(); // validated, ready to serve/store
// An Extended publisher also takes the query of a request:
// await publisher.getDocument({ start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z", granularity: "monthly" });
```

This is enough for a cron job, a build step, or feeding a static-file deployment
(§1's `--once` is a thin CLI wrapper around exactly this call).

### 3b. Full HTTP semantics without an Express/Fastify dependency

`handleRequest` implements everything the middlewares do (status codes, `Allow`,
`ETag`/conditional requests, CORS, caching headers) as a plain function returning
`{ status, headers, body }` — wire it into any request/response model:

**Access control**: the draft (Location and Transport) leaves access control, caching and every other aspect
of the HTTP exchange to RFC 9110 and RFC 9111 and to the publisher. A deployment
that restricts the resource, or rate-limits it, responds as RFC 9110 defines
(`401`, `403`, `429`).
Nothing here forces the document on every requester — wrap or front the handler
with whatever authorization your deployment needs.

**CORS**: successful responses SHOULD include
`Access-Control-Allow-Origin: *` (WebFinger practice, so browser-based
aggregators can read the public document; deployment practice). `handleRequest`, both middlewares,
and the standalone server emit the header on **every** response — 200/304 and
the 404/405/503 error statuses alike, so cross-origin clients can read errors
too. Set the `cors` option to another value or `false` to override.

**Query processing** (`parseQuery`, applied identically by every entry point;
the draft's Query Parameters):

1. an adapter declaring `capabilities: "basic"` honors **no** parameter: every
   request gets what the source holds, with any query string. An `"extended"` adapter
   honors `target`, `start`, `end` and `granularity`;
2. names and values are compared **after percent-decoding**, and the ABNF is
   **case-sensitive** (RFC 7405 `%s`): `Start=`, `TARGET=` and `granularity=Monthly`
   name or hold nothing the draft defines and are ignored;
3. a parameter that appears **more than once** is ignored, since the request is
   ambiguous; a repeated name the draft does not define is not looked at;
4. `start` and `end` are UTC date-times, `2026-02-01T00:00:00Z`. A value that does
   not match, a date alone, a lower-case `t` or `z`, an offset, a leap second
   `:60`, is **ignored: never read as another value and never answered with an
   error**. (A `+` in a URL is turned into a space by form decoding, which is why the
   draft has no offsets in a query; a client converts to UTC first.) `granularity` is
   `yearly`, `monthly` or `daily`; an empty `target` is ignored;
5. the response is the held objects that satisfy **every honored parameter**:
   the period **overlaps** the range (it starts before `end` and ends after
   `start`, compared as instants; an absent bound is unbounded); the `target`
   **equals** the value (the same characters once JSON escapes are decoded, a host
   name compared without regard to ASCII case, no prefix matching); the period is
   a **whole calendar** year, month or day for `granularity` (each bound read in
   its own offset, so a Berlin March is one whole month);
6. they are returned **as a JSON array**, in ascending order of the instant
   `period.start`, then `period.end`, then `target` by code point, then the order
   held. Objects are returned as held: **nothing is summed, merged or split**, and a
   period nobody published gets no answer made up for it;
7. when none matches, the answer is **`200` with `[]`**. `404` is only for a source that
   holds nothing at all, for a Basic publisher or one with `representation: "single"`; an Extended
   publisher answers `200` with `[]`. A request that honors no
   parameter, to an Extended publisher, gets the held objects as a sorted array,
   even when there is one; `representation: "single"` on the `Publisher` answers it
   with the object of the latest period instead. A Basic publisher serves what the
   adapter returns as it returns it;
8. the **cache key** is computed from the parameters the publisher honors, in the
   order `target`, `start`, `end`, `granularity`, with `start` and `end` as the instants
   they name (`…:00Z` and `…:00.000Z` are one entry) — never from the query
   string as received. `?a=1` and `?a=2` are one cache entry with one `ETag`; so
   is a malformed `start`. This is the **origin's own** response cache; a shared
   cache keys on the request URI (RFC 9111 §4), so each distinct query string is
   a distinct entry there. `publisher.cacheKeyFor(query)` exposes the key so a
   reverse proxy you control can key the same way, and `publisher.cacheSize`
   reports how many entries are held.

`parseQuery` returns `{ query, ignored }`: the query to serve, and for each
parameter left out its name and the reason, for the operator's log. The consumer
compares the `period` and `target` of every object it receives with what it asked
for, since a server may ignore any parameter.

```ts
import { Publisher, handleRequest, parseQuery, computedAdapter } from "sustainability-wellknown-publisher";

const publisher = new Publisher(computedAdapter({ /* ... */ }));

// Next.js (Pages Router) API route, app/.well-known/sustainability-data/route.ts (App Router
// equivalent is analogous), AWS Lambda (API Gateway proxy integration), Cloudflare
// Workers `fetch` handler, Koa middleware, or a plain node:http server — all follow
// this same shape: parse the incoming query string, call handleRequest, map the
// result onto your framework's response object.

async function onRequest(rawQuery: Record<string, string | string[]>, method: string, ifNoneMatch?: string) {
  const { query, ignored } = parseQuery(rawQuery);  // never fails: what does not match is left out
  if (ignored.length) console.warn("ignored query parameters", ignored);
  return handleRequest(publisher, query, {}, ifNoneMatch); // { status, headers, body } — send as-is
}
```

Concretely, for a plain Node HTTP server:

```ts
import { createServer } from "node:http";
import { URL } from "node:url";
import {
  Publisher, handleRequest, parseQuery, queryFromSearchParams,
  WELL_KNOWN_PATH, computedAdapter,
} from "sustainability-wellknown-publisher";

const publisher = new Publisher(computedAdapter({ /* ... */ }));

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname !== WELL_KNOWN_PATH) return res.writeHead(404).end();
  // queryFromSearchParams keeps repeated names, which step 3 ignores.
  const { query } = parseQuery(queryFromSearchParams(url.searchParams));
  const result = await handleRequest(publisher, query, {}, req.headers["if-none-match"] as string);
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
`Publisher.build()` composes these stages with `selectDeclarations()` and the signing step
(`src/publisher.ts`) — read it as the reference wiring if you need to diverge
from it. `validateDocument()`/`assertValid()` stand on their own: they apply the
JTD schema *and* every prose rule of the draft the schema cannot express — the
value ranges, non-finite numbers, the `sci-score`⇒`functional-unit` dependency,
the `updated` and `period` shapes (two RFC 3339 date-times, `start` before `end`), the `target` rules,
the at-least-one rule, the URI form of the `extensions` names, and the URI-reference
requirement on `methodology-uri`, `disclosure-uri`, `verifiable-attestation-uri` and every
`upstream[].declaration` — so a hand-built document (the one
`sustainability-sign` reads, for instance) is held to the same bar as one this
pipeline produced.

## 4. Writing a custom adapter (extensibility)

The package ships twelve adapters (`static`, `static-file`, `computed`, `kepler-prometheus`,
`climatiq`, `co2js`, `carbontxt-api`, `salesforce-nzc`, `ms-sustainability`,
`watershed`, `csv`, `slurm-sacct`), but any data source can plug in by implementing one interface:

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
        // The period the row covers: two RFC 3339 date-times, start included, end excluded.
        // A label ("2026", "2026-02", "2026-02-14") also works, for the whole year, month or day in UTC.
        period: { start: row.start, end: row.end },
        // Set `target` when you scope to a requested path prefix; otherwise the
        // publisher-level normalize.target fallback (below) is used. Both
        // energy and carbon are optional — omit what you do not have.
        // Optionally classify the subject with the `target-type` hint
        // (e.g. targetType: "path" when scoping to a path prefix).
        target: query.target,
        energy: { value: row.kwh, unit: "kWh" },
        carbon: { value: row.gCO2e, unit: "gCO2e" },
        // Publisher-defined data goes under a URI you control: an `https` URI
        // documenting the members for a human (which no consumer ever fetches), or a
        // `urn:uuid:` name if you have no domain. The declaration object itself is
        // closed and takes no other member.
        extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": { "water-consumption-m3": row.m3 } },
        // The providers these figures derive from, if any (a URI reference, and a role of the six).
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
shapes to copy from. Use the closed sets: a `measurementMethod` of the four tokens
(`hardware-metered`, `hardware-estimated`, `cloud-billing`, `third-party-modeled`), a
`functionalUnit` of the twelve, a carbon unit of `gCO2e`, `kgCO2e`, `tCO2e`. Every built-in adapter also ships a `fixture`/`fixturePages`
replay-mode option for offline testing without live credentials — copy that
pattern too if you want your custom adapter to be test-friendly.

**Return everything the source holds.** `fetch()` returns one `RawMetrics`, or an array when the
source holds several periods or targets. The publisher normalizes them, selects those that match the
honored query (§3b), applies the safeguards (day floor, ordering) and refuses a source that holds more than 366 objects and
answers. An adapter does not filter by the request and never adds figures together to answer it;
it may use the honored query to fetch less from a remote source (a `target` or a range
it passes on), but what it returns for a period is that period's own figures. An empty array is a source
that holds nothing: `404` for a Basic publisher (or one with `representation: "single"`), `200` and `[]` for an Extended one.

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
  per-query-variant cache), `representation` (`"array"` by default, or `"single"`:
  what a request that honors no parameter is answered with; see §3b), `onWarning`
  (receives each warning of the safeguards and the validation gate; with no hook
  nothing is written), `security` (see below), `normalize` (`target` — the
  mandatory reporting subject fallback, use the origin host for origin-wide
  reports; `targetType` — optional `target-type` hint classifying the subject,
  one of the nine of the draft: `organization`/`facility`/`origin`/`path`/`service`/
  `product`/`device`/`tenant`/`data-source`; any other value throws;
  `energyUnit`/`carbonUnit` to force specific output units; `clock` — the source
  of `updated` when an adapter gives none, a function returning an RFC 3339
  date-time with `T` and `Z` in upper case, the current time in whole seconds by
  default; pass a fixed one in tests), `signing` (`{ key, keyId? }` — see below).
  The URI members (`methodologyUri`, `disclosureUri`,
  `verifiableAttestationUri` — a single URI, since a declaration carries at most one
  attestation and a subject with more than one links an index of them from
  `disclosureUri` — and every `upstream[].declaration`) must be URI references,
  and `extensions` names must be URIs; the object must report at least one metric
  or evidence link — anything else throws at normalization, never reaching the
  wire. `cacheKeyFor(query)` and `cacheSize` expose the canonical cache key and
  the number of entries held. There is no `now` and no `targetPrefixes`: the
  publisher reads no clock for a period and matches no prefix.
- **`SecurityOptions`** (`src/security.ts`): `maxObjects` (default 366; the most objects the adapter may hold, above it the build is refused and no answer is cut),
  `dayFloor` (`"drop"` by default: an object whose period is not a calendar day
  or longer is left out with a warning; `"warn"` keeps it and warns; `"off"` keeps
  it silently; a 23-hour or 25-hour day of a daylight-saving change qualifies),
  `applyNoise` (default `false` — values are published exactly as measured unless
  you opt in; when `true`, deterministic per-period ±1% noise per the draft's
  Privacy Considerations, keyed by the period's bounds as UTC instants),
  `noiseDisclosed` (required with `applyNoise`) and `onWarning`.
  Enabling `applyNoise` carries an obligation the draft states without a keyword:
  the methodology document states that noise is applied and bounds its
  magnitude (±1% for this implementation). Do not enable it without publishing
  that statement — the library never turns it on for you, and refuses it until you
  confirm with `noiseDisclosed: true` (CLI `--noise-disclosed`).
- **Handler/middleware options** (`HandlerOptions`, `src/handler.ts`): `maxAge`,
  `cors` (default `"*"`; `false` disables), `onError` (the operator channel; it
  receives a FAULT — the adapter threw or the gate refused its output, answered
  `503`, which falls back to `console.error` when you pass no hook so a
  deployment that cannot publish never fails silently — and a DIAGNOSTIC, the reason an
  adapter gave with its own "no data" answer, answered `404`, which is written
  **only** to your hook and to nothing else when you pass none),
  `mediaType`, `contentLanguage`, `rateLimit` (`{ requests, windowMs?, maxClients? }`:
  requests per client address per window, default window 60 000 ms; over it the answer
  is `429` with `Retry-After`; off when unset; in the CLI config under `server`),
  `carbonTxt` (see `README.md` §Adapters for the bidirectional
  carbon.txt setup). Signing is **not** a handler option: the `signed` member is
  part of the document, so it is configured on the `Publisher`.
- **`PublisherOptions.signing`**: `{ key, keyId?, x5c? }`, the key from
  `importSigningKey()`/`generateSigningKey()`. With `keyId` the JWS header names
  the key with `kid` instead of embedding the public key as `jwk`; with `x5c` (base64
  DER certificates, leaf first, the leaf holding the key; `pemToX5c()` reads a PEM
  file) it carries the chain as `x5c` instead.
- **CLI config `signing.keyFile` / `signing.keyId` / `signing.x5cFile`**: path of the private JWK
  written by `keygen --out`, and of a PEM certificate chain; the `SUSTAINABILITY_SIGNING_KEY` environment
  variable (the JWK JSON itself) takes precedence.

See `README.md` for the full adapter-by-adapter config field reference and the
JSON config-file schema used by the CLI.
