# sustainability-wellknown-publisher

A production-grade gateway that serves a **fully draft-conformant** `/.well-known/sustainability`
document, as defined by
[draft-besleaga-green-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-green-sustainability-wellknown/).

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
npm test           # vitest: 25 tests (unit + adapters + conformance + live server)
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
  }),
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
    "normalize": { "version": "1.0", "energyUnit": "kWh", "carbonUnit": "gCO2e" },
    "security":  { "maxObjects": 366, "enforceDailyFloor": true, "applyNoise": false },
    "cacheTtlMs": 86400000
  },
  "server": { "port": 8080, "maxAge": 86400, "extraPaths": ["/sustainability"] }
}
```

Adapter `type` is one of: `static`, `static-file`, `computed`, `kepler-prometheus`,
`climatiq`, `salesforce-nzc`, `ms-sustainability`, `watershed`.

## Security & privacy safeguards (draft §Security / §Privacy)

- **DoS**: arrays capped at 366 objects; responses cached (in-memory) and `Cache-Control`/`ETag` set.
- **Traffic analysis**: the normalizer constrains `reporting-period` to day granularity at
  the finest; the security layer additionally drops any sub-daily entry.
- **Hardware fingerprinting**: optional ~1% noise (`security.applyNoise`, off by default for
  deterministic output).
- **Trust**: link a signed W3C Verifiable Credential via the adapter's attestation field
  (`verifiable-attestation-uri`).

## Conformance

`test/conformance.test.ts` asserts the embedded JTD schema is byte-identical to
`../schemas-validators/response-schema.json` and validates every
`../example-responses/*.json`. Generated documents are additionally checked against the
repo's **independent** Python (JTD) and Ruby (CDDL) validators in CI — see
`.github/workflows/publisher.yml`.

> Note on extensibility: the bundled JTD/CDDL schemas are strict (no additional members),
> so the gateway emits only spec-defined fields. The draft permits unknown fields and
> requires clients to ignore them; to actually emit vendor-namespaced fields, relax the
> deployed schema to allow additional properties.

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.
