# Using `sustainability-wellknown-consumer`

This package is designed to be used at **three tiers**, all from the same
package — pick whichever fits your use case, or mix them (e.g. the one-call
function in a quick script, the client class in a long-running service).

| Tier | When to use it | Section |
|---|---|---|
| **One-call, zero dependencies** | A quick script or a project that doesn't want a dependency beyond `fetch()` | [§1](#1-one-call-zero-dependency-usage) |
| **`SustainabilityClient`** | A long-running service polling one or many origins repeatedly | [§2](#2-sustainabilityclient-for-repeated-polling) |
| **Transformation utilities** | You have a fetched document and need CSV/NDJSON/flattened/aggregated output | [§3](#3-transformation-utilities) |

Then: [§4 Disclosure links](#4-disclosure-links-passive-by-design),
[§5 Conformance-checking any origin](#5-conformance-checking-any-origin),
[§6 Using it as a library](#6-using-it-as-a-library).

---

## 1. One-call, zero-dependency usage

`fetchSustainability(origin, options)` does the whole job: build the URL, send
the request (with `If-None-Match` if you have a cached ETag), and defensively
validate the response — schema (RFC 8927 JTD) plus the draft's cross-entry array
rules — before ever handing you a `document`. It never throws on a well-formed
HTTP response; every outcome, including a fetched-but-invalid document, is a
tagged `FetchResult`:

```ts
type FetchResult =
  | { status: "ok"; document: SustainabilityDocument; etag?: string; legacy?: boolean }
  | { status: "not-modified" }
  | { status: "not-found" }
  | { status: "invalid"; errors: string[] }   // fetched but failed validation
  | { status: "http-error"; httpStatus: number };
```

**Legacy compatibility** (`legacyCompat`, default `true`): per the draft's
field-driven compatibility rules (§Versioning and Extensibility), a document
without the mandatory `target` member SHOULD be treated as an origin-wide
report — so before validation, `fetchSustainability` injects the request
origin's host as `target` into a target-less document (or every entry of a
target-less array) and flags the result with `legacy: true`. Historical
`"1.0"`/`"1.1"` documents therefore still validate and stay usable. Pass
`legacyCompat: false` for strict mode: legacy documents then come back as
`status: "invalid"`. (The other compatibility rule — a negative value in a
non-negative member reads as "not reported" — is applied on demand via
`withoutSentinels()`/`isNotReported()`, never silently by the fetch path.)

### 1a. Plain `fetch()` — no extra dependency

```ts
import { fetchSustainability } from "sustainability-wellknown-consumer";

const result = await fetchSustainability("https://example.org", {
  period: "2026-02",
});

if (result.status === "ok" && !Array.isArray(result.document)) {
  console.log(`${result.document.provider}: ${result.document["carbon-footprint"]} ${result.document["carbon-unit"]}`);
}
```

Basic (no params) and Extended (`target`/`period`/`granularity`) requests are
both supported, and the draft's "clients MUST accept both response shapes" rule
is handled for you — `document` is a single object or an array depending on
what the origin returned, never a shape the caller has to guess at up front.

### 1b. Node `http`-based polling script (no `fetch()` dependency assumption)

For an older runtime, or a script that wants to inject its own transport (a
proxy, a test double), pass `fetchImpl`. Node 18+ ships a global `fetch`, so this
is mostly useful for tests and non-standard environments — here it's shown
polling on an interval from a plain script:

```ts
import { fetchSustainability } from "sustainability-wellknown-consumer";

const ORIGIN = "https://example.org";
let lastEtag: string | undefined;

async function poll() {
  const result = await fetchSustainability(ORIGIN, { ifNoneMatch: lastEtag });
  switch (result.status) {
    case "ok":
      lastEtag = result.etag;
      console.log(new Date().toISOString(), "updated:", result.document);
      break;
    case "not-modified":
      console.log(new Date().toISOString(), "no change");
      break;
    case "not-found":
      console.warn(`${ORIGIN} has no sustainability document`);
      break;
    case "invalid":
      console.error("upstream document failed validation:", result.errors);
      break;
    case "http-error":
      console.error(`HTTP ${result.httpStatus} from ${ORIGIN}`);
      break;
  }
}

setInterval(poll, 60 * 60 * 1000); // hourly
poll();
```

This hand-rolled ETag bookkeeping is exactly what `SustainabilityClient` (§2)
does for you automatically, including across multiple origins.

## 2. `SustainabilityClient` for repeated polling

For a service that polls one or many origins on a schedule, `SustainabilityClient`
keeps one ETag per distinct `origin` + params combination and sends it
automatically as `If-None-Match`, so a `304` collapses back into the last known
document rather than an empty result — the caller never has to special-case
"not modified" itself:

```ts
import { SustainabilityClient } from "sustainability-wellknown-consumer";

const client = new SustainabilityClient();

async function pollHourly(origin: string) {
  const result = await client.get(origin);
  if (result.status !== "ok") {
    console.error(`${origin}: ${result.status}`);
    return;
  }
  // result.status === "ok" here even on a 304 upstream — the client
  // resolves it to the cached document, tagged with its cached ETag.
  processDocument(result.document);
}

function processDocument(doc: unknown) {
  // Only reached when the document is new or changed since the last poll.
  console.log("re-processing:", doc);
}

const origins = ["https://a.example.org", "https://b.example.org"];
setInterval(() => origins.forEach(pollHourly), 60 * 60 * 1000);
origins.forEach(pollHourly);
```

`getTrend(origin, { period, granularity })` is a convenience wrapper for
Extended trend requests that asserts the response is an array (throwing if the
origin ignored `granularity` and returned a single object instead):

```ts
const monthly = await client.getTrend("https://example.org", {
  period: "2026",
  granularity: "monthly",
});
console.log(monthly.length, "months returned");
```

`maxCacheEntries` (default 256) bounds the client's internal ETag cache — useful
when polling a large, dynamic set of origins. The client also accepts
`legacyCompat` (default `true`) and threads it through to every underlying
`fetchSustainability` call — see §1.

## 3. Transformation utilities

These operate on an already-validated document (a `fetchSustainability`/
`SustainabilityClient` result's `.document`, or an array of `SustainabilityMetrics`
for `aggregate`).

### `toCsvRows` — convert a fetched document to CSV and append to a file

```ts
import { appendFile } from "node:fs/promises";
import { fetchSustainability, toCsvRows } from "sustainability-wellknown-consumer";

const result = await fetchSustainability("https://example.org");
if (result.status === "ok") {
  const [header, ...rows] = toCsvRows(result.document);
  await appendFile("sustainability-log.csv", rows.map((r) => r + "\n").join(""));
  // write the header once, e.g. on first run, separately from the append loop
}
```

### `toNdjson` — one JSON object per line, for log shipping

```ts
import { toNdjson } from "sustainability-wellknown-consumer";

if (result.status === "ok") {
  process.stdout.write(toNdjson(result.document) + "\n");
}
```

### `flatten` — one row per numeric metric, for time-series ingestion

```ts
import { flatten } from "sustainability-wellknown-consumer";

if (result.status === "ok") {
  for (const row of flatten(result.document)) {
    // { provider, "reporting-period", target, metric, value, unit }
    timeSeriesDb.write(row.metric, row.value, { unit: row.unit, period: row["reporting-period"] });
  }
}
```

`flatten` skips absent values, applies the draft's default units (`kWh`/`gCO2e`)
when a value is present without its unit member, and — for the non-negative
members only — skips negative values (the legacy 1.x "not reported" sentinel),
so a time-series backend never ingests a `-1` as a real measurement. Negative
`scope-1`/`scope-2`/`scope-3` values are real net-accounting data since -03 and
flow through.

### `aggregate` — collapse a fetched year-trend into one annual figure

```ts
import { SustainabilityClient, aggregate } from "sustainability-wellknown-consumer";

const client = new SustainabilityClient();
const monthly = await client.getTrend("https://example.org", {
  period: "2026",
  granularity: "monthly",
});

const annual = aggregate(monthly, { by: "sum", energyUnit: "MWh", carbonUnit: "mtCO2e" });
console.log(`2026 total: ${annual["energy-consumption"]} MWh, ${annual["carbon-footprint"]} mtCO2e`);
// annual["reporting-period"] === "<first>..<last>", e.g. "2026-01..2026-12"
```

`aggregate` normalizes every entry to a common unit before combining (the
requested unit, or the first *reporting* entry's unit if none is given) — it
never silently mixes `kWh` and `MWh` figures. Since -03 the energy/carbon
quartet is optional: entries that don't report a metric (absent member, or
negative under the legacy rule) simply don't contribute — an `average` divides
by the number of reporting entries, never producing `NaN` — a value carried
without its unit member gets the draft's default (`kWh`/`gCO2e`), and when no
entry reports a metric at all the summary omits it.

## 4. Disclosure links (passive by design)

`resolveDisclosureLinks(doc)` reads the `disclosure-uri` and
`verifiable-attestation-uri` fields off an already-fetched document. **It never
makes a network call.** This is deliberate, not an oversight:

- The draft's own posture on these fields is **"MUST NOT treat as proof"** — a
  disclosure or attestation link is a pointer for a human or a separate,
  deliberate verification step, not something the protocol itself certifies.
- Auto-following a URI that arrived inside a document from an origin the caller
  didn't explicitly ask to be fetched from is an **SSRF-shaped footgun**: a
  hostile or compromised origin could point `disclosure-uri` at an internal
  address, and a client that auto-fetches every link it's handed would dutifully
  make that request on the origin's behalf.

```ts
import { resolveDisclosureLinks } from "sustainability-wellknown-consumer";

if (result.status === "ok" && !Array.isArray(result.document)) {
  const links = resolveDisclosureLinks(result.document);
  console.log(links.disclosureUri, links.attestationUri); // strings or undefined — nothing fetched
}
```

`fetchDisclosure(uri, fetchImpl?)` exists for a caller that has decided, as an
**explicit, separate, opt-in step**, that it wants to follow one of these links
(e.g. an operator reviewing a specific origin's evidence, not an unattended
crawler processing thousands of documents automatically):

```ts
import { fetchDisclosure } from "sustainability-wellknown-consumer";

// Only call this because a human (or an explicitly-configured, allow-listed
// job) decided to — never wire this into the default fetch/poll path.
const disclosureText = await fetchDisclosure(links.disclosureUri!);
console.log(disclosureText);
```

If you're building an unattended pipeline and want to follow disclosure links
anyway, put an explicit allow-list and network-egress policy in front of your
own call to `fetchDisclosure` — this package intentionally does not do that for
you.

## 5. Conformance-checking any origin

`runConformanceChecks(origin)` (also exposed as the CLI's `--strict` flag) runs
a small battery of six checks against a target origin: a Basic request returns
a single object, the 200 response uses the `application/json` media type (a
draft MUST), the response carries an ETag, a conditional GET with that ETag
returns `304`, a non-GET/HEAD method returns `405` with an `Allow` header, and
an Extended `granularity` request returns a valid (sorted, schema-conformant)
array. It's usable as a library, standalone of the CLI:

```ts
import { runConformanceChecks } from "sustainability-wellknown-consumer";

const report = await runConformanceChecks("https://new-server-im-building.example.org");
for (const c of report.checks) {
  console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
process.exitCode = report.allPassed ? 0 : 1;
```

This is **not limited to this repo's own `publisher/`** — point it at any
`/.well-known/sustainability` origin, including one you're implementing from
scratch in a different language entirely. It's the same battery the CLI runs:

```bash
sustainability-fetch https://new-server-im-building.example.org --strict
```

Useful in your own server's CI: run it against a locally-started instance of
your implementation as a smoke test before shipping a change.

## 6. Using it as a library

Published: **[`sustainability-wellknown-consumer`](https://www.npmjs.com/package/sustainability-wellknown-consumer)**.

```bash
npm install sustainability-wellknown-consumer
```

A git checkout or git-based install also work, e.g. for tracking `main` ahead of a release:

```bash
npm install /path/to/rfc-sustainability-wellknown/consumer
npm install github:andreibesleaga/rfc-sustainability-wellknown#main:consumer
```

### Worked example: a cron-style fetch → CSV → log-file script

A realistic, unattended M2M script — fetch once, convert, append to a running
log file, exit. Suitable for an hourly cron entry or a scheduled CI job:

```ts
// scripts/log-sustainability.ts
import { appendFile, readFile } from "node:fs/promises";
import { fetchSustainability, toCsvRows } from "sustainability-wellknown-consumer";

const ORIGIN = process.argv[2];
const LOG_FILE = "sustainability-log.csv";

async function main() {
  if (!ORIGIN) {
    console.error("usage: log-sustainability.ts <origin>");
    process.exit(2);
  }

  let lastEtag: string | undefined;
  try {
    lastEtag = (await readFile(`${LOG_FILE}.etag`, "utf8")).trim();
  } catch {
    // no prior run yet
  }

  const result = await fetchSustainability(ORIGIN, { ifNoneMatch: lastEtag });

  if (result.status === "not-modified") {
    console.log("no change since last run");
    return;
  }
  if (result.status !== "ok") {
    console.error(`fetch failed: ${result.status}`);
    process.exitCode = 1;
    return;
  }

  const [, ...rows] = toCsvRows(result.document); // drop header; log file keeps one running header
  await appendFile(LOG_FILE, rows.map((r) => r + "\n").join(""));
  if (result.etag) await appendFile(`${LOG_FILE}.etag`, result.etag, { flag: "w" });
  console.log(`appended ${rows.length} row(s) from ${ORIGIN}`);
}

main();
```

```bash
# crontab: run hourly, log both stdout and stderr
0 * * * * cd /opt/monitor && node scripts/log-sustainability.js https://example.org >> cron.log 2>&1
```

A "crawl N origins and aggregate" tool is a reasonable thing to *build with*
this library (loop the script above over a list of origins, `Promise.all`-ed
with modest concurrency), but a full crawler with politeness/rate-limiting/
persistence is a separate project, not a feature of this package (see
[PLAN.md §2](PLAN.md#2-non-goals-explicitly-out-of-scope-for-v0)).
