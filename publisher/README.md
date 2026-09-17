# sustainability-wellknown-publisher

A reference publisher that serves a **fully draft-conformant** `/.well-known/sustainability-data`
document, as defined by
[draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

It ingests metrics from pluggable **source adapters**, normalizes them to the draft's
field model, **validates every payload against this repository's JTD schema at runtime
before serving** (publish-only-if-valid; the CDDL schema cross-checks the same
documents independently in CI), and exposes the Basic and Extended service
levels with the draft's mandated DoS and privacy safeguards.

It ships three ways to deploy:

- **Express** middleware (`expressSustainability`)
- **Fastify** plugin (`fastifySustainability`)
- a **standalone HTTP server** / CLI that any web server (nginx, Apache, a CDN) can
  reverse-proxy `/.well-known/sustainability-data` to (see `../server-configurations/`).

## Pipeline (the four layers)

```
  source adapter  ──▶  normalize  ──▶  security safeguards  ──▶  JTD validation gate  ──▶  cache  ──▶  HTTP
  (Salesforce,         (units,          (366 cap, 24h floor,     (RFC 8927, the repo      (ETag,       (200 / 404 /
   MS, Watershed,       J→kWh,           ~1% noise)               schema; never publish    24h)         503 / 304)
   Kepler, Climatiq,    E×I→carbon,                               an invalid document)
   static/computed)     SCI)
```

If a payload fails validation, the gateway returns **503 and serves nothing** — it never
publishes unverified or malformed data (the circuit-breaker rule).

## Install & build

**Node.js 22.12 or newer** is required (runtime and tests: the JOSE library is loaded as an ES module through `require()`, unflagged since 22.12; Vitest 5 needs 22.12 too).

```bash
cd publisher
npm install
npm run build      # tsc → dist/
npm test           # vitest: the full suite, 100+ tests (unit + adapters + carbon.txt + conformance + hardening + E2E server/Express/Fastify/CLI)
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

## Express middleware

```ts
import express from "express";
import { Publisher, computedAdapter, expressSustainability } from "sustainability-wellknown-publisher";

const publisher = new Publisher(
  computedAdapter({
    provider: "Example Corp (sustain@example.org)",
    methodologyUri: "https://example.com/methodology",
    reportingPeriod: "2026-02",
    energy: { value: 1250, unit: "kWh" },
    gridIntensity: 276,           // gCO2e/kWh → carbon-footprint computed for you
    capabilities: "basic",        // "basic" = no Extended query-param support (-03 semantics)
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
responses SHOULD carry it (WebFinger practice), and echoing it on the error
statuses too lets cross-origin aggregators read those as well (`cors` option to
override/disable). They also share the draft's query-processing procedure
(§Extended Query Parameters): a repeated parameter name and a `period` that is
not a real calendar year/month/day (the ABNF's `period-value` rule) are
`400 Bad Request`; an unrecognized `granularity` value (e.g. `weekly`), and one
whose **precision** is not finer than the period's, are ignored; a `target`
outside the publisher's published prefix set is `404`; an array is returned only
for a granularity finer than the period, and `404` when no held entry has that
precision — see `USAGE.md` §3b.

A period with no entry of its own is answered with the **aggregate** of the finer
entries inside it (step 5). The contributing entries are the held entries of
**one precision** that lie inside the period, and where more than one precision
lies inside it the draft requires the **coarsest** of them (the months, where a
publisher holds both the twelve months of a year and some days inside January),
"so that two servers holding the same data return the same figures" — see
`USAGE.md` §3b. They must meet two further conditions. They **must not overlap**:
a publisher holding both a month and a day inside that month never sums the two,
since the day would be counted twice. And they **must cover** the period — or,
where it has not yet completed, the completed portion of it that step 6 provides
for, since "a server holding figures for only part of a finished period cannot
present their sum as a figure for the whole of it". Coverage is a *tiling*: a
publisher holding three months of a finished year has no year to serve, and nor
has one whose year is missing its June. For a period still running, what must be
covered is every sub-period that has **completed** by the clock the publisher
reads (`PublisherOptions.now`, the wall clock by default), so a year-to-date
aggregate is served while the months that have ended are all held.

The aggregate then carries sums converted into the unit declared by the **last
contributing entry in ascending order of `reporting-period`** (a dimension of its
own: not the entry with the latest `updated`), each summable member only where
**every** contributing entry reports it, the latest `updated`, and a non-metric
optional member other than the two unit members — whose values the rule on sums
fixes — only where every contributing entry carries it with the same
value. Where the contributing entries disagree on `provider`,
`measurement-method`, `methodology-uri`, `target` or `target-type`, overlap, or
leave a gap, "a server whose held data cannot meet these conditions has no
aggregate it can honestly serve and responds as it does when it has no data": the
requester gets the ordinary **`404`**, not a `503`, while the `onError` hook
still fires with an `UnservableAggregateError` — the member and values that
disagreed, the period held twice, or the sub-periods missing — so an operator
learns that the published data set is inconsistent or incomplete. That
diagnostic is written to your hook and **nowhere else**: pass no hook and
nothing is printed, since the server is not broken, the finding repeats on every
request that touches the period, and its message names the periods you hold. (A
genuine fault — the adapter throwing, answered `503` — is the other thing
`onError` receives, and that one does fall back to `console.error`.)

The -07 ABNF is **case-sensitive** throughout (RFC 7405 `%s` notation), and this
package matches it exactly: `Period=`, `TARGET=` and `Granularity=` name none of
the three parameters and are ignored as undefined names, and `MONTHLY` is not a
`granularity-value`. A `target` value carries any `&` or `=` of its own
percent-encoded on the wire, and is compared with the published prefix set after
percent-decoding.

### What the server is obliged to serve

A `GET` without query parameters is answered `200 OK` with the declaration; when
nothing is published the answer is `404`. Access control is outside the scope of
the specification: a server **MAY** restrict access to the declaration, and a
deployment that restricts or rate-limits a request responds as RFC 9110 defines
(`401`, `403`, `429`) — nothing in this package presumes otherwise, so
put the publisher behind whatever authorization or rate limiter your deployment
needs. What the package does guarantee is that whatever it *does* serve as a
`200` is a conformant declaration with the registered media type.

### Caching and the cache key

`Publisher` computes its cache key from the parameters it **honors**, in the
draft's canonical order (`target`, `period`, `granularity`), never from the query
string as received (§Extended Query Parameters, step 7). Two requests differing
only in a parameter the publisher ignores — an analytics parameter, a `target`
when no prefix set is configured, a `granularity` that is not finer than the
period — therefore share one cache entry and one `ETag`, so a client cannot flood
the cache with `?a=1`, `?a=2`, … A honored `target` is keyed by the **matched
prefix**, so every path under one prefix shares an entry too (§Denial of Service:
"honoring `target` only for a published prefix set bounds the cache-key space").
This is the **origin's own response cache**: a shared cache keys on the request
URI (RFC 9111 §4), so each distinct query string is a distinct entry there.
`cacheKeyFor(query)` is exported so a reverse proxy you control can key the
same way, and `cacheSize` reports the number of entries held. The honored query
is also what reaches the adapter, so a custom adapter cannot make its output
depend on a parameter the publisher ignores.

## Media type and the `application/json` fallback

The draft's §Mandatory Minimum Supported Service requires that a successful
(`200 OK`) response carrying a declaration use the registered
`application/sustainability-data+json` media type, and forbids any other media
type on that response. By default, every entry point in this package (the
standalone server, `expressSustainability`, `fastifySustainability`, and
`handleRequest` directly) does exactly that, and also sends
`X-Content-Type-Options: nosniff` on the document response, so a client cannot
be induced to interpret the document as some other, more dangerous type. (The
header is this package's own hardening: -07 no longer mentions it.)

Declarations published before that media type was registered are found in the
field as plain `application/json`; the draft says a consumer MAY process such a
response as a declaration. For a deployment that still needs to serve that
media type, pass `mediaType: "json"` to any entry point's options:

```ts
app.use(expressSustainability(publisher, { mediaType: "json" }));
```

`mediaType: "json"` is **NOT conformant publishing** — use it only when you know
a consumer in your deployment depends on the older, undifferentiated
`application/json` type. It still sends `X-Content-Type-Options: nosniff`. Error
responses (400/404/405/503 JSON error objects) are never declarations, so they
always use `application/json` regardless of this option, and
a `304 Not Modified` response carries no `Content-Type` at all (there is no
body to type). `HEAD` responses carry the same `Content-Type` as the
corresponding `GET`, per the draft's "same status and header fields, no body"
rule. The two media-type strings are exported as `MEDIA_TYPE` and
`LEGACY_MEDIA_TYPE` from the package root.

## Signing the declaration (draft §Signing)

Since 0.7.0 the signature is the OPTIONAL **`signed` member embedded in every
declaration object** — a JWS Compact Serialization (RFC 7515 §7.1) whose payload
is the UTF-8 JSON serialization of that same object *without* `signed`, with the
protected header `{ alg, cty: "sustainability-data+json", jwk }`. There is one
resource and one file: the signature travels inside the body, so an edge cache
that serves a re-encoded copy cannot separate the two. In an array every object
carries its own `signed`. Algorithms are the two the draft recommends, EdDSA
(Ed25519) and ES256; all JOSE work is done by
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
});
```

```bash
# 1. one key, once; the PRIVATE half goes to a file (0600), the PUBLIC half is printed
sustainability-publisher keygen --out ~/.config/sustainability-publisher/private.jwk > public.jwk

# 2a. a served deployment: the key by environment variable (its JWK JSON) …
SUSTAINABILITY_SIGNING_KEY="$(cat ~/.config/sustainability-publisher/private.jwk)" \
  sustainability-publisher --config config.json
# … or by config: "signing": { "keyFile": "~/.config/…/private.jwk", "keyId": "https://…#1" }

# 2b. a static host: sign the file you serve, in place of a running publisher
sustainability-sign in.json /var/www/.well-known/sustainability-data \
  --key ~/.config/sustainability-publisher/private.jwk [--kid https://example.com/keys#1]
```

`sustainability-sign <in.json> <out.json> --key <private.jwk> [--kid <id>]`
(also available as `sustainability-publisher sign …`) reads one declaration
object or an array, validates it, signs **every object individually**, inserts
`signed` as each object's last member and writes the result. It refuses to sign
a document that would not pass the validation gate — a file it did not build
goes through `assertValid()` and nothing else, so that gate carries every prose
rule of the draft in its own right, the URI-valued members included: a
`methodology-uri`, `disclosure-uri`, `verifiable-attestation-uri` or
`upstream[].declaration` that is not an absolute `https` URI is refused rather
than signed.

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
| Kepler / Prometheus | `keplerPrometheusAdapter` | `kepler_*_joules_total` | `prometheusUrl`, `gridIntensity` | `fixture` |
| Climatiq | `climatiqAdapter` | `/data/v1/estimate` | `apiKey`/`CLIMATIQ_API_KEY`, `activityId`, `dataVersion` (e.g. `"^34"`, required by the API) | `fixture` |
| CO2.js (Green Web Foundation) | `co2jsAdapter` | bytes → carbon (SWD model) + bundled grid data | `bytes`, `gridZone`/`gridIntensity`, `green`/`greencheckDomain` | bundled/`greencheckFixture` |
| carbon.txt API (Green Web Foundation) | `carbonTxtApiAdapter` | hosted validator API `/validate/{domain,url,file}` | `domain`/`url`/`text`, `apiKey`/`GWF_API_KEY`, `compute` or measured metrics | `fixture` |
| Salesforce Net Zero Cloud | `salesforceNzcAdapter` | SOQL on `AnnualEmssnInventory` | `instanceUrl`, `accessToken` | `fixture` |
| Microsoft Sustainability Manager | `msSustainabilityAdapter` | OData (`$skiptoken` paged) (targets the Microsoft Sustainability Manager preview API retired 2025-05-30; replay fixtures only) | `baseUrl`, `accessToken`, `endpoint` | `fixturePages` |
| Watershed | `watershedAdapter` | footprint REST pull | `apiUrl`, `apiKey` | `fixture` |

### Field mapping (source → draft)

| Draft field | Computed/Kepler | Climatiq | Salesforce NZC | MS Sustainability | Watershed |
|---|---|---|---|---|---|
| `energy-consumption` / `-unit` | energy or J→kWh | `parameters.energy` | `ActualEnergyConsumption` (MWh) | `energyKwh` (or configured) | `energyKwh` |
| `carbon-footprint` / `-unit` | E × `gridIntensity` (gCO2e) | `co2e` (kg→gCO2e) | `TotalEmissions` (mtCO2e) | `totalEmissions` (mtCO2e) | `totalEmissionsKgCo2e` (kg) |
| `scope-1/2/3` | — | — | `TotalScope{1,2,3}*` | tenant usage → `scope-3` | `scope{1,2,3}Kg` |
| `carbon-accounting` | config | — | `market-based` | — | footprint field |
| `reporting-period` | config / last full month | config | `Year` (YYYY) | config | footprint / config |

## Configuration file

The CLI loads a JSON config:

```jsonc
{
  "adapter":  { "type": "computed", "options": { /* adapter options */ } },
  "publisher": {
    "normalize": { "target": "example.com", "targetType": "origin", "energyUnit": "kWh", "carbonUnit": "gCO2e" },
    "security":  { "maxObjects": 366, "enforceDailyFloor": true, "applyNoise": false },
    "targetPrefixes": ["/api", "/app/storage"],
    "cacheTtlMs": 86400000
  },
  "signing": { "keyFile": "/run/secrets/private.jwk" },
  "server": { "port": 8080, "maxAge": 86400, "extraPaths": ["/sustainability"] }
}
```

`normalize.target` sets the draft's mandatory `target` member — the reporting subject of
the document. For an origin-wide report the origin's host (e.g. `"example.com"`) is the
recommended value; an adapter that scopes a response to a requested path prefix sets
`raw.target` itself, which takes precedence. If neither is configured, the publisher
fails loudly rather than emit a document without a reporting subject.

`normalize.targetType` (or an adapter-supplied `raw.targetType`, which wins) emits the
optional `target-type` member added in draft -04: an enumerated hint classifying the
kind of subject `target` names — one of `origin`, `path`, `organization`, `service`,
`product`, `device`, `tenant`, `data-source`. The publisher throws on any other value
(fail-loud on its own output); when re-ingesting a foreign document, `fromWire()`
instead **drops** an unrecognized `target-type` per the draft's tolerance rule for
enumerated members. In an array (trend) response, `target-type` is **all-or-none**
(final -04 rule): it must be present in **every** entry with the same value, or absent
from every entry — mixed presence is invalid, and the validation gate enforces this
alongside the shared-`target` rule.

`publisher.targetPrefixes` is the set of path prefixes this origin honours for the
Extended `target` parameter — the set a server honouring the parameter **MUST**
publish in the document its `methodology-uri` identifies (-07 step 4; there is no
in-band list, because one would disclose the path information Privacy
Considerations protects). A `target` matching none of them is answered `404`, and a
matching one becomes the `target` member of every returned object (matching is
byte-wise, case-sensitive and on complete segments, so `/api` matches `/api/v1`
but not `/apifoo`). Leave it unset and the publisher does not support the
parameter: every value gets the same response, which is what Privacy
Considerations asks for.

Since draft -03, `energy-consumption`/`energy-unit` and `carbon-footprint`/`carbon-unit`
are **optional**: a metric that is not reported is simply omitted (there is no negative
"not reported" sentinel anymore). When a unit member is absent, the defaults `kWh` and
`gCO2e` apply — this publisher always emits the unit explicitly alongside a reported
value. Gross metrics must be non-negative and `renewable-energy` must be 0–100;
`scope-1/2/3` may be negative (removals under net accounting). Since -07 every
declaration MUST report **something**: at least one numeric metric member, or
`disclosure-uri`, or `verifiable-attestation-uri` — the normalizer and the
validation gate both refuse an object that carries none.

### Extensions and upstream declarations (-07)

The declaration object is **closed**: a publisher MUST NOT add top-level members
of its own. Publisher-defined data goes in `extensions`, an object whose keys are
absolute URIs (RFC 3986, Section 4.3: ASCII, scheme in lowercase, only the characters RFC 3986 allows (so no space, and none of `" < > \ ^ ` { | }`), no fragment) and
whose values are objects. The draft names two forms: an `https` URI with a host,
which should point at human-readable documentation of the members but which a
consumer MUST NEVER dereference, and `urn:uuid:` followed by a lowercase
hyphenated UUID you generate once — and a consumer that does not implement a key
ignores its value. `upstream` is an array of
`{ declaration, role? }` naming the declarations of the providers a subject's
figures derive from (`declaration` is an absolute `https` URI). Adapters supply
both through `raw.extensions` / `raw.upstream`:

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

A key that is not an absolute URI (a bare UUID, `com.example.pue`, a relative
reference, a fragment, whitespace, non-ASCII, a character RFC 3986 does not
allow in a URI such as `" < > \ ^ ` { | }`, an uppercase scheme such as
`HTTPS://…`, `https:` with no host), a
`urn:uuid:` key in uppercase or holding the Nil or Max UUID (which the draft
forbids as guaranteed collisions), a
non-object value, a relative or non-`https` upstream URI, or any member outside
the closed set is rejected at normalization **and** by the validation gate, with
a message naming it — never published.

Adapter `type` is one of: `static`, `static-file`, `computed`, `kepler-prometheus`,
`climatiq`, `co2js`, `carbontxt-api`, `salesforce-nzc`, `ms-sustainability`, `watershed`.

### Bidirectional carbon.txt

Set `server.carbonTxt` (or the `carbonTxt` option on the middleware) to also serve a
[carbon.txt](https://carbontxt.org/) file at the locations that project's own specification
defines for it, whose first disclosure points back to this origin's
`/.well-known/sustainability-data` — a two-way link with the Green Web Foundation
disclosure ecosystem. (Those paths are carbon.txt's convention, defined and registered by
that project, not by this specification, which neither defines nor recommends any path
for a disclosure index.) `sustainability-publisher --config c.json
--emit-carbon-txt` prints the file. The `co2js` and `carbontxt-api` adapters and the
carbon.txt emit/parse/discover helpers depend on `@tgwf/co2` (Apache-2.0) and `@iarna/toml`
(ISC); see [`NOTICE`](NOTICE) for the CO2.js grid-data attribution.

## Security & privacy safeguards (draft §Security / §Privacy)

- **DoS**: arrays capped at 366 objects (-07 dropped the server-side cap in favour of a
  consumer-side bound, and bounds only a response to a request naming a granularity by the
  calendar — nothing bounds the size of a Basic response — so the cap
  stays as this package's own safeguard — `SecurityOptions.maxObjects` raises or lowers it).
  Note the one interaction: the cap keeps the **most recent** entries, so a publisher holding
  more than a year of daily figures and asked for a year aggregate can lose contributors to the
  cap, fail the draft's coverage rule for that year, and answer `404` rather than a sum over
  part of it — raise `maxObjects` past the number of entries you hold if you serve aggregates
  over a period that long. Responses are cached (in-memory) and `Cache-Control`/`ETag` set;
  the cache key is derived from the honored parameters in a canonical order, so requests that
  differ only in parameters the publisher ignores cannot multiply cache entries (above).
- **Traffic analysis**: the normalizer constrains `reporting-period` to day granularity at
  the finest; the security layer additionally drops any sub-daily entry.
- **Hardware fingerprinting**: optional ~1% noise (`security.applyNoise`, **off by
  default** — nothing in this package perturbs a published value unless the operator
  opts in). When enabled it is applied once at document-generation time, deterministically
  per reporting period, with a single factor per report so related fields stay consistent
  (per the draft's Privacy Considerations); the multiplicative factor preserves
  the sign of negative scope values (removals). Noise covers only the additive family
  (energy, footprint, scopes): the range-bounded `renewable-energy` member is **never
  noised**, so the draft's stay-in-range MUST ("bounded members MUST remain within their
  range") is trivially satisfied.
  **Disclosure is a MUST, and it is yours to make**: if you enable `applyNoise`, the
  methodology document MUST state that noise is applied and MUST bound its magnitude
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
  beside it ("a publisher MUST NOT serve an object whose `signed` payload differs from
  the object it accompanies"). `assertSignedMatches()` enforces that invariant on every
  document the publisher and the `sign` CLI emit, and is exported for your own checks.

## Conformance

`test/conformance.test.ts` asserts the embedded JTD schema is identical (equal as a JSON value; the CDDL and JSON files are byte-identical) to
`../schemas-validators/response-schema.json` and validates every
`../example-responses/*.json`. Generated documents are additionally checked against the
repo's **independent** Python (JTD) and Ruby (CDDL) validators in CI — see
`.github/workflows/publisher.yml`.

> Note on extensibility: since -07 the bundled JTD/CDDL schemas **close** the top-level
> member set, and publisher-defined data lives under `extensions`, keyed by an absolute
> URI. The schemas cannot express that form of those keys, the `https` form of the URI
> members, the value ranges or the at-least-one rule; `src/validate.ts` enforces those
> prose rules alongside the schema, so nothing non-conformant reaches the wire.

## Verifying a deployment once it's live

Once a server built with this publisher is deployed, verify it the same way any
`/.well-known/sustainability-data` origin is verified — curl for headers/body plus the
consumer's `--strict` conformance battery. See
[consumer/README.md § Verify a live deployment](../consumer/README.md#verify-a-live-deployment)
for the four commands and expected output (`--verify` reports the outcome of the
`signed` member's verification).

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.
