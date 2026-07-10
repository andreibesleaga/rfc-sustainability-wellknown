# sustainability-wellknown-publisher

A production-grade gateway that serves a **fully draft-conformant** `/.well-known/sustainability`
document, as defined by
[draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

It ingests metrics from pluggable **source adapters**, normalizes them to the draft's
field model, **validates every payload against this repository's JTD and CDDL schemas
before serving** (publish-only-if-valid), and exposes the Basic and Extended service
levels with the draft's mandated DoS and privacy safeguards.

It ships three ways to deploy:

- **Express** middleware (`expressSustainability`)
- **Fastify** plugin (`fastifySustainability`)
- a **standalone HTTP server** / CLI that any web server (nginx, Apache, a CDN) can
  reverse-proxy `/.well-known/sustainability` to (see `../server-configurations/`).

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
curl -s http://localhost:8080/.well-known/sustainability | jq
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
    capabilities: "extended",     // the intensity field is an optional (Extended) field
  }),
  // `target` = the mandatory reporting subject; use the origin host for
  // origin-wide reports (adapters that scope by path set it themselves).
  { normalize: { target: "example.com" } },
);

const app = express();
app.use(expressSustainability(publisher));   // serves GET /.well-known/sustainability
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
    "normalize": { "version": "2.0", "target": "example.com", "energyUnit": "kWh", "carbonUnit": "gCO2e" },
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
[carbon.txt](https://carbontxt.org/) at `/carbon.txt` and `/.well-known/carbon.txt` whose
first disclosure points back to this origin's `/.well-known/sustainability` — a two-way link
with the Green Web Foundation disclosure ecosystem. `sustainability-publisher --config c.json
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
  the sign of negative scope values (removals).
- **Trust**: link a signed W3C Verifiable Credential via the adapter's attestation field
  (`verifiable-attestation-uri`).

## Conformance

`test/conformance.test.ts` asserts the embedded JTD schema is byte-identical to
`../schemas-validators/response-schema.json` and validates every
`../example-responses/*.json`. Generated documents are additionally checked against the
repo's **independent** Python (JTD) and Ruby (CDDL) validators in CI — see
`.github/workflows/publisher.yml`.

> Note on extensibility: the bundled JTD/CDDL schemas are open per the draft (unknown
> members are permitted and clients MUST ignore them). Vendor-namespaced fields supplied
> by an adapter via `raw.extra` pass through `normalize` and the validation gate onto the
> wire; the gateway itself emits only spec-defined fields unless an adapter adds extras.

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.
