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
`Access-Control-Allow-Origin: *` on every response — the final -04 draft says
successful responses SHOULD carry it (WebFinger practice), and echoing it on the
error statuses too lets cross-origin aggregators read those as well (`cors`
option to override/disable). They also share the draft's query-parameter
tolerance: an unrecognized `granularity` value (e.g. `weekly`) and a malformed
`period` are ignored rather than erroring, and `granularity` without `period`
applies to the default reporting period; an array is returned only for a
granularity finer than the period — see `USAGE.md` §3b.

## Media type and -05 compatibility

Draft -06 §Mandatory Minimum Supported Service requires that a successful
(`200 OK`) response carrying a Sustainability Metadata Document use the
registered `application/sustainability-data+json` media type, and forbids any
other media type on that response. By default, every entry point in this
package (the standalone server, `expressSustainability`, `fastifySustainability`,
and `handleRequest` directly) does exactly that, and also sends
`X-Content-Type-Options: nosniff` on the document response, as the draft says
servers SHOULD, so a client cannot be induced to interpret the document as some
other, more dangerous type.

Documents published before that media type was registered (draft -05 and
earlier) are found in the field as plain `application/json`; the draft
acknowledges this and says clients SHOULD also accept it. For a deployment that
still needs to serve that legacy media type, pass `mediaType: "json"` to any
entry point's options:

```ts
app.use(expressSustainability(publisher, { mediaType: "json" }));
```

`mediaType: "json"` is **v05-compatible but NOT -06 conformant** — use it only
when you know a consumer in your deployment depends on the older, undifferentiated
`application/json` type. It still sends `X-Content-Type-Options: nosniff`. Error
responses (404/405/503 JSON error objects) are never Sustainability Metadata
Documents, so they always use `application/json` regardless of this option, and
a `304 Not Modified` response carries no `Content-Type` at all (there is no
body to type). `HEAD` responses carry the same `Content-Type` as the
corresponding `GET`, per the draft's "same status and header fields, no body"
rule. The two media-type strings are exported as `MEDIA_TYPE` and
`LEGACY_MEDIA_TYPE` from the package root.

## Signing the document (draft -06, Document Integrity and Signing)

Since 0.6.5 the publisher can sign its document. The mechanism is the draft's
OPTIONAL detached JWS: a compact serialization with an empty payload part
(RFC 7515 Appendix F), served at `/.well-known/sustainability-data.jws` as
`application/jose`, over the **exact bytes** of the parameterless document —
there is no canonicalization, so the handler signs the very string it serves and
keeps one signature per document generation (on the cached document itself, so
the document request and the signature request are served from one generation;
a signing publisher therefore needs `cacheTtlMs` above 0, and the server refuses
`0` at start-up).
Algorithms are the two the draft recommends, EdDSA (Ed25519) and ES256; all JOSE
work is done by [`jose`](https://github.com/panva/jose).

```bash
# 1. one key, once; the PRIVATE half goes to a file (0600), the PUBLIC half is printed
sustainability-publisher keygen --out ~/.config/sustainability-publisher/private.jwk > public.jwk

# 2a. a served deployment: the key by environment variable (its JWK JSON) …
SUSTAINABILITY_SIGNING_KEY="$(cat ~/.config/sustainability-publisher/private.jwk)" \
  sustainability-publisher --config config.json
# … or by config: "server": { "signingKeyFile": "~/.config/sustainability-publisher/private.jwk" }

# 2b. a static host: sign the file you serve, and serve the output next to it
sustainability-publisher sign /var/www/.well-known/sustainability-data --key ~/.config/sustainability-publisher/private.jwk \
  > /var/www/.well-known/sustainability-data.jws     # Content-Type: application/jose
```

In code, pass `signingKey` (from `importSigningKey()` or `generateSigningKey()`)
in the options of `createSustainabilityServer`, `expressSustainability` or
`fastifySustainability`, and the `.jws` route appears; `handleSignatureRequest()`
is the framework-agnostic handler. Without a key the path is `404`, which the
draft defines as meaning only that the publisher does not sign. The public key
travels in the signature's own header (`jwk`, the draft's SHOULD) and should
also be hosted out of band so verifiers can pin it. `signAttached()` produces
an attached JWS — used to secure a Verifiable Credential as `vc+jwt` for the
`verifiable-attestation-uri` member (see
[`internet-drafts/draft-verifiable-credential.md`](../internet-drafts/draft-verifiable-credential.md)).

What the signature establishes is integrity after the fact and key continuity,
not identity and not accuracy: a signed estimate is still an estimate, and the
draft says a failed or absent signature makes a document *unverified*, never
*false*. Key rotation: run `keygen` again, host the new public key, replace the
variable, redeploy — earlier signatures then stop verifying against the new key,
which is the point. The end-to-end procedure for publishers, attesters and
consumers is in [SIGNING-AND-ATTESTATION.md](../SIGNING-AND-ATTESTATION.md).

## Adapters

Every adapter implements `SourceAdapter { name, capabilities, fetch(query) }` and returns
loosely-typed `RawMetrics`; the normalizer does the rest. Credential-bearing adapters all
support a **replay mode** (`fixture` / `fixturePages`) so they run in CI and offline.

| Adapter | Factory | Source | Live-mode inputs | Offline |
|---|---|---|---|---|
| Static (inline) | `staticAdapter` | fixed values | — | n/a |
| Static (file) | `staticFileAdapter` | a JSON file (`raw` or `wire`) | `file` | n/a |
| Computed | `computedAdapter` | energy × grid intensity | `energy`, `gridIntensity` | n/a |
| Kepler / Prometheus | `keplerPrometheusAdapter` | `kepler_*_joules_total` | `prometheusUrl`, `gridIntensity` | `fixture` |
| Climatiq | `climatiqAdapter` | `/data/v1/estimate` | `apiKey`/`CLIMATIQ_API_KEY`, `activityId` | `fixture` |
| CO2.js (Green Web Foundation) | `co2jsAdapter` | bytes → carbon (SWD model) + bundled grid data | `bytes`, `gridZone`/`gridIntensity`, `green`/`greencheckDomain` | bundled/`greencheckFixture` |
| carbon.txt API (Green Web Foundation) | `carbonTxtApiAdapter` | hosted validator API `/validate/{domain,url,file}` | `domain`/`url`/`text`, `apiKey`/`GWF_API_KEY`, `compute` or measured metrics | `fixture` |
| Salesforce Net Zero Cloud | `salesforceNzcAdapter` | SOQL on `AnnualEmssnInventory` | `instanceUrl`, `accessToken` | `fixture` |
| Microsoft Sustainability Manager | `msSustainabilityAdapter` | OData (`$skiptoken` paged) | `baseUrl`, `accessToken`, `endpoint` | `fixturePages` |
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
    "normalize": { "version": "2.0", "target": "example.com", "targetType": "origin", "energyUnit": "kWh", "carbonUnit": "gCO2e" },
    "security":  { "maxObjects": 366, "enforceDailyFloor": true, "applyNoise": false },
    "cacheTtlMs": 86400000
  },
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

Since draft -03, `energy-consumption`/`energy-unit` and `carbon-footprint`/`carbon-unit`
are **optional**: a metric that is not reported is simply omitted (there is no negative
"not reported" sentinel anymore). When a unit member is absent, the defaults `kWh` and
`gCO2e` apply — this publisher always emits the unit explicitly alongside a reported
value. Gross metrics must be non-negative and `renewable-energy` must be 0–100;
`scope-1/2/3` may be negative (removals under net accounting).

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

- **DoS**: arrays capped at 366 objects; responses cached (in-memory) and `Cache-Control`/`ETag` set.
- **Traffic analysis**: the normalizer constrains `reporting-period` to day granularity at
  the finest; the security layer additionally drops any sub-daily entry.
- **Hardware fingerprinting**: optional ~1% noise (`security.applyNoise`, off by default).
  When enabled it is applied once at document-generation time, deterministically per
  reporting period, with a single factor per report so related fields stay consistent
  (per the draft's Hardware Fingerprinting rules); the multiplicative factor preserves
  the sign of negative scope values (removals). Noise covers only the additive family
  (energy, footprint, scopes): the range-bounded `renewable-energy` member is **never
  noised**, so the draft's stay-in-range MUST ("members bounded to a range MUST remain
  within their stated range after noise") is trivially satisfied.
- **Trust**: link a signed W3C Verifiable Credential via the adapter's attestation field
  (`verifiable-attestation-uri`).

## Conformance

`test/conformance.test.ts` asserts the embedded JTD schema is byte-identical to
`../schemas-validators/response-schema.json` and validates every
`../example-responses/*.json`. Generated documents are additionally checked against the
repo's **independent** Python (JTD) and Ruby (CDDL) validators in CI — see
`.github/workflows/publisher.yml`.

> Note on extensibility: the bundled JTD/CDDL schemas are open per the draft (unknown
> members are permitted and clients MUST ignore them). Extension members supplied by an
> adapter via `raw.extra` pass through `normalize` and the validation gate onto the wire;
> the gateway itself emits only spec-defined fields unless an adapter adds extras. Since
> draft -04, member names without a "." are reserved for the specification — name your
> extension members using reverse-domain notation rooted in a domain you control (e.g.
> `com.example.pue`), not an `X-`/`vendor-` prefix.

## Verifying a deployment once it's live

Once a server built with this publisher is deployed, verify it the same way any
`/.well-known/sustainability-data` origin is verified — curl for headers/body plus the
consumer's `--strict` conformance battery. See
[consumer/README.md § Verify a live deployment](../consumer/README.md#verify-a-live-deployment)
for the four commands and expected output (requires `sustainability-wellknown-consumer`
0.6.5 or later for the signature check; `--verify` reports the signature outcome).

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.
