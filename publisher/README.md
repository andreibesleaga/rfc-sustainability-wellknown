# sustainability-wellknown-publisher

A reference publisher that serves a **fully draft-conformant** `/.well-known/sustainability-data`
document, as defined by
[draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/),
revision -10 (version 0.8.1 of this package; the older forms are covered in
[Migrating from 0.7.x](#migrating-from-07x)).

It ingests metrics from pluggable **source adapters**, normalizes them to the draft's
field model, **validates every payload against this repository's JTD schema at runtime
before serving** (publish-only-if-valid; the CDDL schema cross-checks the same
documents independently in CI), and exposes the Basic and Extended service
levels with the draft's day floor and optional noise, and a server-side object cap of its own.

It ships three ways to deploy:

- **Express** middleware (`expressSustainability`)
- **Fastify** plugin (`fastifySustainability`)
- a **standalone HTTP server** / CLI that any web server (nginx, Apache, a CDN) can
  reverse-proxy `/.well-known/sustainability-data` to (see `../server-configurations/`).

## Pipeline (the four layers)

```
  source adapter  ──▶  normalize  ──▶  security safeguards  ──▶  JTD validation gate  ──▶  cache  ──▶  HTTP
  (Salesforce,         (units,          (366 held, day floor,    (RFC 8927, the repo      (ETag,       (200 / 404
   MS, Watershed,       J→kWh,           ~1% noise)               schema; never publish    24h)         503 / 304)
   Kepler, Climatiq,    E×I→carbon,                               an invalid document)
   static/computed)     SCI)
```

A request is answered `200` with the objects selected, `404` when a Basic publisher (or one with
`representation: "single"`) holds nothing, `304` for a matching `If-None-Match`, `405` for a method other than `GET` and
`HEAD`, and `503` when the adapter fails or its output does not validate.

If a payload fails validation, the gateway returns **503 and serves nothing** — it never
publishes unverified or malformed data (the circuit-breaker rule).

## Install & build

**Node.js 22.13 or newer** is required. Two small libraries do the date and JSON work: `temporal-polyfill` for
RFC 3339 date-times and calendar arithmetic (the only place the package reads a date is `src/period.ts`), and
`lossless-json` for reading files as I-JSON (RFC 7493: duplicate member names, numbers beyond binary64 precision and unpaired
surrogates are refused).

```bash
cd publisher
npm install
npm run build      # tsc → dist/
npm test           # vitest: the full suite (unit + adapters + carbon.txt + conformance + hardening + E2E server/Express/Fastify/CLI)
```

## Quick start (any web server, zero credentials)

`examples/config.computed.json` computes carbon from an energy figure and a grid
intensity factor — enough for any host to publish immediately:

```bash
# Print one document and exit:
node bin/sustainability-publisher.js --config examples/config.computed.json --once

# Or serve it:
node bin/sustainability-publisher.js --config examples/config.computed.json --port 8080
curl -s http://localhost:8080/.well-known/sustainability-data | jq
```

For every adapter with a real upstream shape to show (Climatiq, CO2.js, the carbon.txt
hosted API, Kepler/Prometheus, Salesforce Net Zero Cloud, Microsoft Sustainability
Manager, Watershed, computed, and the file-backed `static-file` round-trip),
`examples/originals/` has a real, source-verified upstream response and
`examples/transformed/` has the exact document this repo's code derives from it — see
[`examples/README.md`](examples/README.md) for the full pairing, sources, and how to
regenerate them.

Point your web server at it (the repo's `server-configurations/nginx.conf` /
`apache.conf` show the matching reverse-proxy / alias blocks).

## Quick guide

1. **Say what the figures cover.** Every object has a `period`: `{ "start": …, "end": … }`, two RFC 3339
   date-times, `start` included and `end` excluded, so calendar 2025 is `2025-01-01T00:00:00Z` to
   `2026-01-01T00:00:00Z` and the next period starts where it ends. In an adapter's configuration you may write
   `"2025"`, `"2025-02"` or `"2025-02-14"` for the whole year, month or day in UTC. Without one, the adapters
   that read a live source publish the last full calendar month.
2. **Say how the figures were obtained.** `measurement-method` is one of four tokens, from the most to the least
   direct: `hardware-metered` (a meter in the power path, a utility bill), `hardware-estimated` (counters with a
   model, such as Kepler or Slurm), `cloud-billing` (a provider's report to its customer) and `third-party-modeled`
   (models, factors, activity data, anything else). Applying an emission factor to metered energy does not change
   the token.
3. **Use the closed sets.** `functional-unit` is one of twelve units, `carbon-unit` one of `gCO2e`, `kgCO2e`,
   `tCO2e`, `role` one of six. A score in another unit goes in `extensions`, under a URI name whose definition
   states the unit, and `sci-score` and `functional-unit` are left out.
4. **Choose the service level.** `capabilities: "basic"` serves what the source holds and honors no query
   parameter. `"extended"` honors `target`, `start`, `end` and `granularity` and returns the objects that match.
5. **Optionally sign** (below) and serve with the standalone server, a middleware, or `--once` into a static file.

The publisher refuses to emit anything else: a value outside its set, a period that is not two date-times with `start`
before `end`, or a member the draft does not define stops the build with a message that names it.

## Express middleware

```ts
import express from "express";
import { Publisher, computedAdapter, expressSustainability } from "sustainability-wellknown-publisher";

const publisher = new Publisher(
  computedAdapter({
    provider: "Example Corp (sustain@example.org)",
    methodologyUri: "https://example.com/methodology",
    period: "2026-02",            // the whole month, in UTC; or { start, end }
    energy: { value: 1250, unit: "kWh" },
    gridIntensity: 276,           // gCO2e/kWh → carbon-footprint computed for you
    capabilities: "basic",        // "basic" honors no query parameter; "extended" honors all four
  }),
  // `target` = the mandatory reporting subject; use the origin host for
  // origin-wide reports (adapters that scope by path set it themselves).
  { normalize: { target: "example.com" } },
);

const app = express();
app.use(expressSustainability(publisher));   // serves GET /.well-known/sustainability-data
app.listen(8080);
```

## Fastify plugin

```ts
import Fastify from "fastify";
import { Publisher, computedAdapter, fastifySustainability } from "sustainability-wellknown-publisher";

const app = Fastify();
await app.register(fastifySustainability, { publisher: new Publisher(computedAdapter({ /* … */ })) });
await app.listen({ port: 8080 });
```

All entry points (standalone server, both middlewares, `handleRequest`) emit
`Access-Control-Allow-Origin: *` on every response — the draft says successful
responses SHOULD carry it (WebFinger practice; not a requirement of the draft), and echoing it on the error
statuses too lets cross-origin aggregators read those as well (`cors` option to
override/disable).

### Query parameters

An adapter that declares `capabilities: "basic"` honors no parameter: every request, with any query string, gets what
the source holds. An `"extended"` adapter honors `target`, `start`, `end` and `granularity` (draft, Query Parameters).
All entry points share one procedure:

- Names and values are compared after percent-decoding, and the draft's ABNF is **case-sensitive**: `Start=`,
  `TARGET=` and `granularity=Monthly` name or hold nothing the draft defines, and are ignored.
- A parameter that appears more than once is ignored, since the request is ambiguous. A repeated name the draft does
  not define is not looked at.
- `start` and `end` are UTC date-times written `2026-02-01T00:00:00Z`. Any other form is **ignored, never read as
  another value, and never answered with an error**: a date alone, a lower-case `t` or `z`, an offset (a `+` in a URL
  is turned into a space by form decoding, so a client converts to UTC first), and a leap second `:60`. A request
  carrying only such values is answered exactly like the bare request, `ETag` included.
- `granularity` is `yearly`, `monthly` or `daily`; any other value is ignored. An empty `target` is ignored.
- The objects returned are those held that satisfy every honored parameter: the period **overlaps** the range (it
  starts before `end` and ends after `start`, compared as instants, an absent bound unbounded); the `target` **equals**
  the value (the same characters once JSON escapes are decoded, host names compared without regard to ASCII case, no
  prefix matching); and, for `granularity`, the period is a **whole calendar** year, month or day, each bound read in
  its own offset (a Berlin March, `+01:00` to `+02:00`, is one whole month).
- They are returned as a JSON array in ascending order of the instant `period.start`, then of `period.end`, then of
  `target` by code point, then in the order held. **Nothing is summed, merged or split**: an object is returned as it is
  held, and a period nobody published has no answer made up for it.
- When no object matches, the answer is `200` with `[]`.

A request that honors no parameter (none sent, or all ignored) to an Extended publisher is answered with the objects
held as a sorted array, even when it holds one. A deployment that publishes one current report and wants an object may
set `representation: "single"` on the `Publisher`, which then answers such a request with the object of the latest
period. A Basic publisher serves the objects the adapter returns, after the day floor, in ascending order of `period.start`.

Because a server may ignore any parameter, the consumer compares the `period` and `target` of every object it receives with
what it asked for. `parseQuery` returns `{ query, ignored }`; `ignored` names each parameter that was left out and why,
for the operator's log.

### What the server is obliged to serve

A `GET` without query parameters is answered `200 OK` with the declaration; when
the source holds nothing, a Basic publisher (or one with `representation: "single"`) answers `404` and
an Extended one answers `200` with `[]`. Access control is outside the scope of
the specification: a server **MAY** restrict access to the declaration, and a
deployment that restricts or rate-limits a request responds as RFC 9110 defines
(`401`, `403`, `429`) — nothing in this package presumes otherwise, so
put the publisher behind whatever authorization or rate limiter your deployment
needs. What the package does guarantee is that whatever it *does* serve as a
`200` is a conformant declaration with the draft's media type.

### Caching and the cache key

`Publisher` computes its cache key from the parameters it **honors**, in the
order `target`, `start`, `end`, `granularity`, never from the query string as
received, and with `start` and `end` as the instants they name (`…:00Z` and
`…:00.000Z` share one entry). Two requests differing only in a parameter the
publisher ignores — an analytics parameter, a malformed `start`, anything sent to a
Basic publisher — therefore share one cache entry and one `ETag`, so a client cannot
flood the cache with `?a=1`, `?a=2`, … (draft, Security Considerations).
This is the **origin's own response cache**: a shared cache keys on the request
URI (RFC 9111 §4), so each distinct query string is a distinct entry there.
`cacheKeyFor(query)` is exported so a reverse proxy you control can key the
same way, and `cacheSize` reports the number of entries held. The honored query
is also what reaches the adapter, so a custom adapter cannot make its output
depend on a parameter the publisher ignores.

### Rate limiting

A server that computes responses to query parameters on demand should rate-limit requests to the well-known URI (draft,
Security Considerations). The limit is off unless you set it: `rateLimit: { requests, windowMs? }` on the standalone
server, the Express middleware and the Fastify plugin, or `"rateLimit"` under `server` in the config file. Each client
address may make `requests` requests in a window of `windowMs` (default 60 000); over it the answer is `429` with a
`Retry-After` in seconds. The counts are kept in memory in each process and for at most `maxClients` addresses (default
10 000). Behind a reverse proxy the address is the proxy's unless the framework is told to trust it (`trust proxy` in
Express, `trustProxy` in Fastify); the standalone server uses the socket's address.
An Extended publisher with no `rateLimit` reports once, through `onWarning`, when the server or middleware is set up.

## Media type and the `application/json` fallback

The draft (Location and Transport) requires that a successful
(`200 OK`) response carrying a declaration use the draft's
`application/sustainability-data+json` media type; a response with any other media
type except `application/json` is not a declaration. By default, every entry point in this package (the
standalone server, `expressSustainability`, `fastifySustainability`, and
`handleRequest` directly) does exactly that, and also sends
`X-Content-Type-Options: nosniff` on the document response, so a client cannot
be induced to interpret the document as some other, more dangerous type. (The
header is this package's own hardening: the draft does not require it.)

Declarations published before that media type was defined (-06) are found in the
field as plain `application/json`; the draft says a consumer MAY process such a
response as a declaration. For a deployment that still needs to serve that
media type, pass `mediaType: "json"` to any entry point's options:

```ts
app.use(expressSustainability(publisher, { mediaType: "json" }));
```

`mediaType: "json"` is **NOT conformant publishing** — use it only when you know
a consumer in your deployment depends on the older, undifferentiated
`application/json` type. It still sends `X-Content-Type-Options: nosniff`. Error
responses (404/405/503 JSON error objects) are never declarations, so they
always use `application/json` regardless of this option, and
a `304 Not Modified` response carries no `Content-Type` at all (there is no
body to type). `HEAD` responses carry the same `Content-Type` as the
corresponding `GET` (RFC 9110, Section 9.3.2: the same header fields, no body). The two media-type strings are exported as `MEDIA_TYPE` and
`LEGACY_MEDIA_TYPE` from the package root.

## Signing the declaration (draft §Signing)

The signature is the OPTIONAL **`signed` member embedded in every
declaration object** — a JWS Compact Serialization (RFC 7515 §7.1) whose payload
is the UTF-8 JSON serialization of that same object *without* `signed`, with the
protected header `{ alg, cty: "sustainability-data+json", jwk }` (`jwk` is the public key as `kty`, `crv`, `x` and, for ES256, `y`
only; `kid`, `alg` and `use` are never inside it). There is one
resource and one file: the signature travels inside the body, so an edge cache
that serves a re-encoded copy cannot separate the two. In an array every object
carries its own `signed`. Algorithms are the two the draft recommends, `Ed25519`
(RFC 9864, with the key representation of RFC 8037) and `ES256`; the identifier `EdDSA`, which RFC 9864
deprecates, is never written. All JOSE work is done by
[`jose`](https://github.com/panva/jose).

Signing is a property of the document, so it is configured on the `Publisher`
and happens **once per built (and therefore cached) document**, never per
request:

```ts
import { Publisher, computedAdapter, importSigningKey } from "sustainability-wellknown-publisher";

const key = await importSigningKey(process.env.SUSTAINABILITY_SIGNING_KEY!);
const publisher = new Publisher(computedAdapter({ /* … */ }), {
  normalize: { target: "example.com" },
  signing: { key },                       // every object gets `signed`
  // signing: { key, keyId: "https://example.com/keys/2026#1" },
  //   ^ names an out-of-band key with `kid` instead of embedding `jwk`
  // signing: { key, x5c: pemToX5c(readFileSync("chain.pem", "utf8")) },
  //   ^ a certificate chain, leaf first: the header carries `x5c` instead of `jwk`
});
```

```bash
# 1. one key, once; the PRIVATE half goes to a file (0600), the PUBLIC half is printed
#    (--alg Ed25519 is the default; ES256 is the other choice)
sustainability-publisher keygen --out ~/.config/sustainability-publisher/private.jwk > public.jwk

# 2a. a served deployment: the key by environment variable (its JWK JSON) …
SUSTAINABILITY_SIGNING_KEY="$(cat ~/.config/sustainability-publisher/private.jwk)" \
  sustainability-publisher --config config.json
# … or by config: "signing": { "keyFile": "~/.config/…/private.jwk", "keyId": "https://…#1" }
#   (add "x5cFile": "chain.pem" to carry a certificate chain as x5c instead of jwk)

# 2b. a static host: sign the file you serve, in place of a running publisher
sustainability-sign in.json /var/www/.well-known/sustainability-data \
  --key ~/.config/sustainability-publisher/private.jwk [--kid https://example.com/keys#1] [--x5c chain.pem]
```

`sustainability-sign <in.json> <out.json> --key <private.jwk> [--kid <id>] [--x5c <chain.pem>]`
(also available as `sustainability-publisher sign …`) reads one declaration
object or an array, validates it, signs **every object individually**, inserts
`signed` as each object's last member and writes the result. It refuses to sign
a document that would not pass the validation gate — a file it did not build
goes through `assertValid()` and nothing else, so that gate carries every prose
rule of the draft in its own right, the URI-valued members included: a
`methodology-uri`, `disclosure-uri`, `verifiable-attestation-uri` or
`upstream[].declaration` that is not a URI reference is refused rather
than signed.

The header identifies the verification key in one of three ways. By default the public key is embedded as `jwk`. With
`--x5c` (`signing.x5cFile`, or the `x5c` sign option, a list of base64 DER certificates) the header carries the
certificate chain as `x5c` instead; the first certificate must hold the signing key, or signing is refused. With `--kid`
(`keyId`) the header names a key the publisher distributes out of band; given together with `--x5c` it is added next to
`x5c`.

A private key written by 0.7.x, which names `EdDSA`, imports unchanged: it is the same Ed25519 key, it keeps its
`kid`, and it signs with `alg` `Ed25519`. `keygen --alg EdDSA` is refused with a message naming `Ed25519`. A consumer
must accept `Ed25519` to verify what this version signs.

Without a key nothing changes: the member is simply absent, which the draft says
means only that the publisher did not sign. The public key travels in the
signature's own header (`jwk`, the draft's SHOULD) and should also be hosted out
of band so verifiers can pin it. `signAttached()` produces an attached JWS —
used to secure a Verifiable Credential as `vc+jwt` for the
`verifiable-attestation-uri` member, which is served under the
`VC_JWT_MEDIA_TYPE` (`application/vc+jwt`) this package exports for the purpose
(see
[`internet-drafts/draft-verifiable-credential.md`](../internet-drafts/draft-verifiable-credential.md)).

What the signature establishes is integrity after the fact and key continuity,
not identity and not accuracy: a signed estimate is still an estimate, and the
draft says a failed or absent signature makes a declaration *unverified*, never
*false*. Key rotation: run `keygen` again, host the new public key, replace the
variable, redeploy — earlier signatures then stop verifying against the new key,
which is the point. The end-to-end procedure for publishers, attesters and
consumers is in [SIGNING-AND-ATTESTATION.md](../SIGNING-AND-ATTESTATION.md).

## Adapters

Every adapter implements `SourceAdapter { name, capabilities, fetch(query) }` and returns
loosely-typed `RawMetrics`; the normalizer does the rest. Credential-bearing adapters all
support a **replay mode** (`fixture` / `fixturePages`) so they run in CI and offline.

Product and organization names are used only to identify the data sources these adapters read; they are trademarks of their owners and imply no affiliation or endorsement.

| Adapter | Factory | Source | Live-mode inputs | Offline |
|---|---|---|---|---|
| Static (inline) | `staticAdapter` | fixed values | — | n/a |
| Static (file) | `staticFileAdapter` | a JSON file (`raw` or `wire`) | `file` | n/a |
| Computed | `computedAdapter` | energy × grid intensity | `energy`, `gridIntensity` | n/a |
| Kepler / Prometheus | `keplerPrometheusAdapter` | `kepler_*_joules_total`; `hardware-estimated`; `zone` sets the time zone of a calendar-label period | `prometheusUrl`, `gridIntensity` | `fixture` |
| Climatiq | `climatiqAdapter` | `/data/v1/estimate` | `apiKey`/`CLIMATIQ_API_KEY`, `activityId`, `dataVersion` (e.g. `"^34"`, required by the API) | `fixture` |
| CO2.js (Green Web Foundation) | `co2jsAdapter` | bytes → carbon (SWD model) + bundled grid data | `bytes`, `gridZone`/`gridIntensity`, `green`/`greencheckDomain` | bundled/`greencheckFixture` |
| carbon.txt API (Green Web Foundation) | `carbonTxtApiAdapter` | hosted validator API `/validate/{domain,url,file}` | `domain`/`url`/`text`, `apiKey`/`GWF_API_KEY`, `compute` or measured metrics | `fixture` |
| Salesforce Net Zero Cloud | `salesforceNzcAdapter` | SOQL on `AnnualEmssnInventory` | `instanceUrl`, `accessToken` | `fixture` |
| Microsoft Sustainability Manager | `msSustainabilityAdapter` | OData (`$skiptoken` paged) (targets the Microsoft Sustainability Manager preview API retired 2025-05-30; replay fixtures only) | `baseUrl`, `accessToken`, `endpoint` | `fixturePages` |
| Watershed | `watershedAdapter` | footprint REST pull; its year, month, day and `YYYY-Qn` quarter labels become the period | `apiUrl`, `apiKey` | `fixture` |
| CSV export (any ESG tool) | `csvAdapter` (CLI type `csv`) | one row per period: `period` (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`, the whole unit in UTC) or the pair `period_start` and `period_end` (RFC 3339 date-times, any offset, kept as written), `energy`, `energy_unit`, `carbon`, `carbon_unit`, `scope_1..3`, `carbon_accounting`, `renewable_percent`, optional `provider`/`measurement_method`/`methodology_uri`/`disclosure_uri`/`target`/`target_type`/`updated`; header names matched loosely; `;` exports and `decimalComma` supported, numbers read strictly in that locale; every row checked (period, numbers, 0..100 share, units, basis, target type, URI references, RFC 3339 `updated`, a measurement method of the four tokens — never defaulted — and a figure or a disclosure link) and a failing row skipped and reported via `onSkip`, never published; helpers `parseCsv`, `rowsToMetrics` | `text` or `file` | — (the file is the source) |
| Slurm (`sacct` energy accounting) | `slurmSacctAdapter` (CLI type `slurm-sacct`) | sums `ConsumedEnergyRaw` of finished top-level jobs per calendar month (`sacct --parsable2 --format=JobID,Start,End,ConsumedEnergyRaw`; header in any order, or none in that order; a header missing a column is an error); monthly exports may be concatenated (a job spanning the boundary counts once, in the month it ended); joules → kWh; each month is a whole calendar month with its bounds written in `utcOffset` (`Z` by default, or a fixed offset such as `+01:00`; an invalid one is refused); carbon from `gridIntensity`; `hardware-estimated` by default; the energy is a job's own only with exclusive node allocation; helpers `parseSacct`, `energyByMonth` | `text` or `file` | — |

### Field mapping (source → draft)

| Draft field | Computed/Kepler | Climatiq | Salesforce NZC | MS Sustainability | Watershed |
|---|---|---|---|---|---|
| `energy-consumption` / `-unit` | energy or J→kWh | `parameters.energy` | `ActualEnergyConsumption` (MWh) | `energyKwh` (or configured) | `energyKwh` |
| `carbon-footprint` / `-unit` | E × `gridIntensity` (gCO2e) | `co2e` (kg→gCO2e) | `TotalEmissions` (tCO2e) | `totalEmissions` (tCO2e) | `totalEmissionsKgCo2e` (kg) |
| `scope-1/2/3` | — | — | `TotalScope{1,2,3}*` | tenant usage → `scope-3` | `scope{1,2,3}Kg` |
| `carbon-accounting` | config | — | `market-based` (`carbonAccounting` sets it; a location-based `fieldMap.scope2` needs `"location-based"`) | — | footprint field |
| `period` | config / last full month | config / last full month | `Year`: the whole year | config | footprint label / config |

### What every adapter does with the closed sets

- **Period.** The configuration key is `period` (an object `{ start, end }`, or a year, month or day label for the
  whole unit in UTC); the 0.7.x key `reportingPeriod` is gone and is refused. An adapter that holds several periods (CSV,
  Slurm) returns all of them and the publisher selects; it never filters by the request.
- **Measurement method.** Kepler, computed and Slurm default to `hardware-estimated`; CO2.js, Climatiq, carbon.txt,
  Salesforce and Watershed to `third-party-modeled`; Microsoft Sustainability Manager to `cloud-billing`; CSV takes it
  per row or from the configuration and never defaults it. Set `hardware-metered` only for a figure read from a meter or
  a bill. A value outside the four tokens is refused (CSV: the row is skipped, with the reason).
- **Units.** Carbon units are `gCO2e`, `kgCO2e` and `tCO2e`; the Salesforce and Microsoft adapters default to `tCO2e`
  (formerly written `mtCO2e`, with the same numbers). Per-gigabyte figures use 10^9 octets, not 2^30.
- **Functional unit.** `functionalUnit` is one of the twelve units, each defined in the draft (Optional Members): `per-request`,
  `per-transaction`, `per-page-view`, `per-session`, `per-user`, `per-job`, `per-token`, `per-inference`,
  `per-gigabyte`, `per-gigabyte-hour`, `per-vcpu-hour`, `per-device`. `sciScore` is the score for exactly that one unit.
  A score in a unit the draft does not list goes in `extensions` (the `computedAdapter` takes an `extensions` option for
  it), under a URI name whose definition states the unit, with `sciScore` and `functionalUnit` left out; the publisher
  refuses any other `functionalUnit` and says so.
- **Empty source.** A CSV or Slurm export that yields no usable row holds nothing: a Basic publisher (or one with
  `representation: "single"`) answers `404` and an Extended one `200` with `[]`. Skipped CSV rows are reported through `onSkip`.


## Configuration file

The CLI loads a JSON config:

```jsonc
{
  "adapter":  { "type": "computed", "options": { /* adapter options */ } },
  "publisher": {
    "normalize": { "target": "example.com", "targetType": "origin", "energyUnit": "kWh", "carbonUnit": "gCO2e" },
    "security":  { "maxObjects": 366, "dayFloor": "drop", "applyNoise": false },
    "representation": "array",
    "cacheTtlMs": 86400000
  },
  "signing": { "keyFile": "/run/secrets/private.jwk" },
  "server": { "port": 8080, "maxAge": 86400, "extraPaths": ["/sustainability"], "rateLimit": { "requests": 60, "windowMs": 60000 } }
}
```

`normalize.target` sets the draft's mandatory `target` member — the reporting subject of
the document. For an origin-wide report the origin's host (e.g. `"example.com"`) is the
recommended value; an adapter that scopes a response to a requested path prefix sets
`raw.target` itself, which takes precedence. If neither is configured, the publisher
fails loudly rather than emit a document without a reporting subject.

`normalize.targetType` (or an adapter-supplied `raw.targetType`, which wins) emits the
optional `target-type` member: an enumerated hint classifying the
kind of subject `target` names — one of the nine of the draft: `organization`, `facility`, `origin`, `path`, `service`,
`product`, `device`, `tenant`, `data-source`. The publisher throws on any other value
(fail-loud on its own output); when re-ingesting a foreign document, `fromWire()`
instead **drops** an unrecognized `target-type` by its compatibility reading of older
documents.

`publisher.security.dayFloor` is what happens to an object whose period is not a calendar day or longer
(`start` and `end` each the first instant of a calendar day in its own offset; a 23-hour or 25-hour day at a change of
daylight-saving time qualifies): `"drop"` (the default) leaves it out and warns, `"warn"` keeps it and warns, `"off"`
keeps it silently. The draft makes the day floor a recommendation (Mandatory Members and Privacy Considerations); the
default protects the person who has not thought about it, and an operator who publishes sub-day periods on purpose
sets `"warn"` or `"off"`. Warnings go to `publisher.onWarning`; with no hook nothing is written, and the CLI writes them to stderr.

`publisher.representation` is `"array"` (default) or `"single"`; see Query parameters above.

`energy-consumption`/`energy-unit` and `carbon-footprint`/`carbon-unit`
are **optional**: a metric that is not reported is simply omitted (there is no negative
"not reported" sentinel anymore). When a unit member is absent, the defaults `kWh` and
`gCO2e` apply — this publisher always emits the unit explicitly alongside a reported
value. Gross metrics must be non-negative and `renewable-energy` must be 0–100;
`scope-1/2/3` may be negative (removals under net accounting). Every
declaration MUST report **something**: at least one numeric metric member, or
`disclosure-uri`, or `verifiable-attestation-uri` — the normalizer and the
validation gate both refuse an object that carries none.

### Extensions and upstream declarations

The declaration object is **closed**: a publisher MUST NOT add top-level members
of its own. Publisher-defined data goes in `extensions`, an object whose member names
are extension names and whose values are objects (draft, Extensions). An extension
name is a URI (RFC 3986, Section 3) under the definer's control, or a UUID URN
(RFC 9562) for a definer without a domain. It is an identifier, compared as a string,
written as its definer published it, and never dereferenced; a consumer that does not
implement a name ignores its value. `upstream` is an array of
`{ declaration, role? }` naming the declarations of the providers a subject's
figures derive from (`declaration` is a URI reference, relative or absolute, resolved against the
retrieval URI; `role` is one of `hosting`, `colocation`, `cloud`, `cdn`, `network`, `electricity`).
Adapters supply both through `raw.extensions` / `raw.upstream`:

```ts
return {
  provider: "Acme Retail plc (sustainability@acme.example)",
  // …
  upstream: [{ declaration: "https://cloud.example/tenants/acme.json", role: "cloud" }],
  extensions: {
    "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": { "water-consumption-m3": 1250, "waste-generated-kg": 340 },
    "https://example.com/sustainability/extensions/water-and-waste": { "water-consumption-m3": 1250 },
  },
};
```

A name that is not a URI (a bare UUID, `com.example.pue`, whitespace, non-ASCII, a character RFC 3986 does not
allow in a URI such as `" < > \ ^ ` { | }`), a non-object value, an `upstream` entry without a `declaration` or
with a `role` outside the six, or any member outside the closed set is rejected at normalization **and** by
the validation gate, with a message naming it — never published.

Adapter `type` is one of: `static`, `static-file`, `computed`, `kepler-prometheus`,
`climatiq`, `co2js`, `carbontxt-api`, `salesforce-nzc`, `ms-sustainability`, `watershed`, `csv`, `slurm-sacct`.

### Bidirectional carbon.txt

Set `server.carbonTxt` (or the `carbonTxt` option on the middleware) to also serve a
[carbon.txt](https://carbontxt.org/) file at the locations that project's own specification
defines for it, whose first disclosure points back to this origin's
`/.well-known/sustainability-data` — a two-way link with the Green Web Foundation
disclosure ecosystem. The declaration is listed as `doc_type = "other"`, carbon.txt's type for
something that is not a page or a report. (Those paths are carbon.txt's convention, defined by
that project and not in the IANA well-known registry; this specification neither defines nor
recommends any path for a disclosure index.) `sustainability-publisher --config c.json
--emit-carbon-txt` prints the file. The `co2js` and `carbontxt-api` adapters and the
carbon.txt emit/parse/discover helpers depend on `@tgwf/co2` (Apache-2.0) and `@iarna/toml`
(ISC); see [`NOTICE`](NOTICE) for the CO2.js grid-data attribution.

## Security & privacy safeguards (draft §Security / §Privacy)

- **DoS**: the number of objects the adapter holds is capped at 366; above it the build is refused with an error
  naming `maxObjects` (`SecurityOptions.maxObjects` raises or lowers it). The cap bounds what is held; an answer is
  never truncated. (This is a deployment safeguard; the draft bounds the consumer, not the server.) Responses are cached (in-memory) and `Cache-Control`/`ETag` set; the cache
  key is derived from the honored parameters in a canonical order, so requests that differ only in parameters the
  publisher ignores cannot multiply cache entries (above).
- **Traffic analysis**: a period shorter than a calendar day can tie figures to individual requests, and real-time
  telemetry is NOT RECOMMENDED (draft, Privacy Considerations). By default an object whose period is not a calendar
  day or longer is left out with a warning; `security.dayFloor` keeps it with or without a warning.
- **Hardware fingerprinting**: optional ~1% noise (`security.applyNoise`, **off by
  default** — nothing in this package perturbs a published value unless the operator
  opts in). When enabled it is applied once at document-generation time, deterministically
  per period (keyed by the period's bounds as UTC instants, so `Z` and `+00:00` spellings of one period get the same
  factor), with a single factor per report so related fields, the annual estimate included, stay consistent
  (per the draft's Privacy Considerations); the multiplicative factor preserves
  the sign of negative scope values (removals). Noise covers only the additive family
  (energy, footprint, scopes): the range-bounded `renewable-energy` member is **never
  noised**, and this package keeps bounded members in range.
  The library **refuses** `applyNoise` unless you also set `noiseDisclosed: true` (CLI: `--noise-disclosed`),
  your confirmation that the statement below is made.
  **Disclosure is yours to make**: the draft says the methodology document states that noise is applied and
  bounds its magnitude; if you enable `applyNoise`, the document must do so
  (at most ±1% for this implementation). The library cannot write that statement for you
  and cannot check that you wrote it, which is exactly why it never enables noise on your
  behalf — opting in *is* taking on the disclosure obligation. `methodology-uri` is where
  the statement belongs.
- **Trust**: sign each declaration object (`signing`, above) and link a signed W3C
  Verifiable Credential via the adapter's attestation field
  (`verifiable-attestation-uri`; a declaration carries **at most one** such URI —
  a subject with more than one attestation links an index of them, or the
  remaining ones, from `disclosure-uri`). The signature is produced as the **last** step of
  building a document, over the object without its `signed` member — so the payload
  never contains `signed` itself, every object of an array response is signed, and no
  cache or conditional-request path can serve a signature that does not match the body
  beside it ("A publisher that regenerates an object regenerates its signature in the same step"). `assertSignedMatches()` enforces that invariant on every
  document the publisher and the `sign` CLI emit, and is exported for your own checks.

## Conformance

`test/conformance.test.ts` asserts the embedded JTD schema is identical (equal as a JSON value; the CDDL and JSON files are byte-identical) to
`../schemas-validators/response-schema.json` and validates every
`../example-responses/*.json`. Generated documents are additionally checked against the
repo's **independent** Python (JTD) and Ruby (CDDL) validators in CI — see
`.github/workflows/publisher.yml`.

> Note on extensibility: the bundled JTD/CDDL schemas are open (unknown members pass), as the draft's CDDL is; the publisher's gate, `assertValid`, refuses a top-level member the draft does not define, and publisher-defined data lives under `extensions`, keyed by a URI. The
> schemas cannot express the form of those keys, the URI-reference form of the URI
> members, the value ranges, the date-time and `start`-before-`end` rules or the at-least-one rule;
> `src/validate.ts` enforces those prose rules alongside the schema, so nothing
> non-conformant reaches the wire.

## Verifying a deployment once it's live

Once a server built with this publisher is deployed, verify it the same way any
`/.well-known/sustainability-data` origin is verified — curl for headers/body plus the
consumer's `--strict` conformance battery. See
[consumer/README.md § CLI](../consumer/README.md#cli)
for the four commands and expected output (`--verify` reports the outcome of the
`signed` member's verification).

## Migrating from 0.7.x

0.8.0 implements revision -10, which changes the wire format: a -09 document is not a valid -10 document. Nothing in
0.8.0 writes the older forms; there are no switches for them.

**What the documents look like now**

- `period` is an object `{ "start", "end" }` of two RFC 3339 date-times (upper-case `T` and `Z`), half-open, `start` before
  `end`. The `reporting-period` string (-08) and the pair of `full-date` bounds (-09) are gone. A bound is written in the
  offset in force at its boundary; `Z` for midnight UTC is recommended.
- `measurement-method`, `functional-unit`, `carbon-unit` and `upstream[].role` take values from closed sets; free text and
  `mtCO2e` (now `tCO2e`, same numbers) are refused. `functional-unit` gained `per-session` and `per-vcpu-hour`, `role` gained
  `colocation`, and `target-type` has nine values (`facility` is new).
- `signed` uses `alg` `Ed25519`; see Signing.

**What changes in your code and configuration**

| 0.7.x | 0.8.0 |
|---|---|
| adapter option `reportingPeriod: "2026-02"` | `period: "2026-02"` (the whole month in UTC) or `period: { start, end }`; the old key is refused |
| `RawMetrics.reportingPeriod`, `ServiceQuery.period` | `RawMetrics.period` (object or label); `ServiceQuery` has `target`, `start`, `end`, `granularity` |
| `?period=2026-02`, a `400` on a bad or repeated parameter | `?start=2026-02-01T00:00:00Z&end=2026-03-01T00:00:00Z`; a value outside the ABNF or a repeated parameter is ignored, never a `400` |
| a year answered by summing its months (`aggregatePeriod`, `UnservableAggregateError`, `PublisherOptions.now`) | removed: the publisher returns what it holds and sums nothing. Publish the year as an object of its own |
| `PublisherOptions.targetPrefixes`, `matchTargetPrefix` | removed: `target` selects objects whose `target` equals the value |
| `parseQuery` returns `{ ok, query }` or `{ ok: false, error }`; `badRequestResult` | `parseQuery` returns `{ query, ignored }`; `badRequestResult` is removed |
| `security.enforceDailyFloor` | `security.dayFloor`: `"drop"` (default), `"warn"` or `"off"` |
| `security.applyNoise` alone | also `noiseDisclosed: true` (CLI `--noise-disclosed`) |
| a Basic or Extended request without parameters returned the newest object | an Extended publisher returns the sorted array; `representation: "single"` restores the latest object |
| `generateSigningKey("EdDSA")`, `keygen --alg EdDSA` | `"Ed25519"` (default) or `"ES256"`; an existing `EdDSA` key file still imports |
| `isCalendarPeriod`, `lastFullMonth`, `periodEndMs`, `PERIOD_RE` and the precision helpers | `lastFullMonthPeriod`, and from `src/period.ts`: `monthPeriod`, `yearPeriod`, `dayPeriod`, `quarterPeriod`, `toPeriod`, `overlapsRange`, `isWholeCalendarPeriod`, `wholeCalendarUnit` |
| CSV and Slurm adapters returned the newest row or filtered by the request | they return every row; Slurm gains `utcOffset`, CSV gains `period_start`/`period_end` |
| CSV `https`-only links | any URI reference |
| Node 22.12 | Node 22.13 |

**Reading an older document.** `fromWire(document)` and `staticFileAdapter({ format: "wire" })` read a -08 or -09
document and build the -10 object from it: a `reporting-period` or a pair of full-dates becomes the period it stands for,
and a negative figure from before the "not reported" rule is read as not reported. Pass `{ legacyCompat: false }` to read a
document exactly as it stands. A token the sets do not contain (a free-text `measurement-method`, `per-thousand-requests`) is
not converted for you: the publisher refuses it and names it, and you choose the token that fits.

**Converting a file.** `sustainability-publisher upgrade` converts a declaration file written for -08 or -09:

```bash
sustainability-publisher upgrade old.json > new.json          # the result on stdout, the notes on stderr
sustainability-publisher upgrade old.json new.json            # written to new.json
sustainability-publisher upgrade data.json data.json          # in place: only the same path twice replaces the input
sustainability-publisher upgrade old.json --check             # writes nothing; exit 1 if it would change
```

It converts what converts exactly: a `reporting-period` label or a pair of full-dates becomes the `period` object, an
earlier `measurement-method`, `functional-unit`, `carbon-unit` or upstream `role` becomes today's token or is removed, and a
`target-type` outside the nine is removed. A file that is already current comes out byte for byte as it went in. Every change
is a note on standard error; a `signed` member is dropped from a converted object (its payload is no longer the object), so
sign the result again with `sustainability-sign`. Flags: `--offset <+hh:mm>` (the offset in which a calendar day of the earlier
form begins; `Z` by default), `--updated <date-time>` (the `updated` of every converted object), `--measurement-method
<token>` (the token for a free-text `measurement-method`; the residual token by default). Exit status: `0` converted, or
nothing to convert; `1` the file cannot be converted or is not valid once converted, or `--check` would change it; `2` a usage
error. Nothing is written on `1` or `2`.

**Before you deploy.** Run `npm test`, then request the endpoint once with no parameters and once with
`?start=…&end=…&granularity=monthly`, and validate what comes back with the consumer's `--strict` battery.

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.

## Version history (moved from the root README, 2026-10-09)

- **Versions:** `0.1.0` = draft `-02`; `0.4.0`–`0.5.2` = `-04` (no schema change in `-05` or `-06`); `0.6.x` = `-06`
  (media type, HTTPS, detached signature, Extended selection rule); `0.7.0` = `-07` (no `version` member, embedded
  `signed`, `upstream`, `extensions`); `0.7.1`–`0.7.3` = fixes (same 404 body for an unmatched `target`, at least
  four significant figures, `nosniff` on the library's own errors, Kepler defaults to `hardware-estimated`,
  Normalization Form C for `provider`) and the CSV and Slurm adapters; `0.8.0` = `-10` (`period` as an object of two RFC 3339
  date-times, half-open; closed sets for the four tokens; `start`, `end` and `granularity` queries with no aggregation;
  `Ed25519` signing; `temporal-polyfill` and `lossless-json`).
- The package is also mirrored on GitHub Packages
  ([`@andreibesleaga/sustainability-wellknown-publisher`](https://github.com/andreibesleaga/rfc-sustainability-wellknown/pkgs/npm/sustainability-wellknown-publisher));
  npmjs.com is the canonical registry. The reference gateway's tests and its live deployment use the publisher and the consumer together.
