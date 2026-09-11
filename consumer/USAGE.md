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

> **Extension members (-04 naming):** unknown members in a fetched document are
> preserved, never stripped — the draft's ignore-unknown rule. Implementers
> defining their own extension members should use reverse-domain-name notation
> rooted in a domain they control (e.g. `com.example.pue`); undotted names are
> reserved for the specification, and the older `X-`/`vendor-` prefix style
> SHOULD NOT be used.

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
  | {
      status: "ok";
      document: SustainabilityDocument;
      etag?: string;
      mediaType: "sustainability-data+json" | "json" | "other"; // what the response was typed as
      warnings?: string[];                      // advisory findings; the document is valid
      legacy?: boolean;
      disregarded?: string[];
    }
  | { status: "not-modified" }
  | { status: "not-found" }
  | { status: "no-report" }                   // 200 with an empty array: conveys no report
  | { status: "invalid"; errors: string[] }   // fetched but failed validation
  | { status: "http-error"; httpStatus: number }
  | { status: "timeout"; timeoutMs: number }     // no complete response in time
  | { status: "too-large"; detail: string }      // body exceeded maxBytes
  | { status: "insecure-transport"; url: string; detail: string }; // not retrieved over HTTPS
```

**Media typing (-06).** Every request sends
`Accept: application/sustainability-data+json, application/json;q=0.9` — the
media type the draft registers, plus the `application/json` that every -05-era
publisher still serves, at a lower q-value. The response's own `Content-Type`
comes back as `result.mediaType`:

| `mediaType` | Meaning |
|---|---|
| `"sustainability-data+json"` | the -06 registered media type: conformant |
| `"json"` | the pre-06 generic type: a -05 publisher, accepted (the draft's SHOULD) but not -06 conformant |
| `"other"` | anything else, including a missing `Content-Type` |

A response is **never refused on its media type alone** — the draft permits
parsing one of any type and has the client decide what the document is from the
document's own content, which is exactly what the validation gate does. Use
`MEDIA_TYPE`, `LEGACY_MEDIA_TYPE`, `ACCEPTED_MEDIA_TYPES`, `ACCEPT_HEADER` and
`classifyMediaType()` (all exported) if you need the same names elsewhere.

**HTTPS is required (-06), with one explicit escape hatch.** The draft makes
HTTPS unconditional: the document MUST be published and retrieved over HTTPS,
clients MUST NOT accept one retrieved over unauthenticated HTTP, and every hop
of a followed redirect MUST be HTTPS — that requirement, and nothing in the
data model, is what lets you attribute a document to the origin that served it.
So a non-HTTPS URL — the one you asked for, or the final URL after a redirect —
comes back as `{ status: "insecure-transport", url, detail }` rather than a
document, and rather than a thrown error. Pass `allowInsecure: true` (CLI:
`--allow-http`) to override it for a local development server or CI against
`http://127.0.0.1`. There is deliberately **no automatic loopback exemption**:
the opt-out has to be written down.

```ts
const result = await fetchSustainability("http://127.0.0.1:8080", { allowInsecure: true });
```

**Advisory warnings.** `result.warnings` (present only when non-empty) carries
findings that do **not** make a document invalid. Today that is a URI-valued
member (`methodology-uri`, `disclosure-uri`, `verifiable-attestation-uri`)
holding an absolute non-`https` URI, which -06 restricts to the `https` scheme:
the member is kept, the document stays valid, and the rule is enforced where it
matters — `fetchDisclosure()` refuses to dereference such a URI (§4).
`validateDocument()` reports the same list as `result.warnings`; its `valid`
boolean is unaffected by them, by design.

**Legacy compatibility** (`legacyCompat`, default `true`): per the draft's
field-driven compatibility rules (§Versioning and Extensibility, final -04), a
document without the mandatory `target` member is historical (`"1.0"`/`"1.1"`)
and gets `target` derived before validation — from the historical
`target-path` member's **value** when that member is present (it named the
reporting subject, e.g. `"/api/v1"`), and from the final-response origin's host
(an origin-wide report; redirects are attributed to the final origin, per the
draft) **only when neither member exists**. This applies to a target-less
document or to every entry of a target-less array, and the result is flagged
with `legacy: true`. Historical documents therefore still validate and stay
usable. Pass `legacyCompat: false` for strict mode: legacy documents then come
back as `status: "invalid"`. (The negative-value compatibility rule — a
negative value in a non-negative member reads as "not reported" — is applied on
demand via `withoutSentinels()`/`isNotReported()`, never silently by the fetch
path.)

**`target-type` tolerance** (also under `legacyCompat`, default `true`): -04
adds the optional enumerated `target-type` member (`origin`, `path`,
`organization`, `service`, `product`, `device`, `tenant`, `data-source`), a
hint classifying the reporting subject named by `target`. Per the draft's
enumerated-member tolerance rule (§Value Constraints and Omitted Metrics), a
client that encounters an *unrecognized* value there SHOULD disregard the
member — interpreting `target` as if `target-type` were absent — rather than
reject the document. Because the JTD schema deliberately keeps the enum closed,
`fetchSustainability` applies this in its pre-pass: the offending member is
stripped **before** validation and the result carries
`disregarded: ["target-type"]` (or `"[i].target-type"` paths for array
entries), so the tolerance is visible, never silent. In strict mode
(`legacyCompat: false`) the document is validated exactly as served and an
unrecognized value fails validation. A *recognized* value flows through
untouched. In an array, `target-type` is **all-or-none** (final -04): present
in every entry with the same value or absent from every entry — mixed presence
fails validation in both modes.

**Wrong-JSON-type tolerance** (also under `legacyCompat`, default `true`): the
final -04 draft adds "A value of the wrong JSON type (including `null`) is
treated as not reported" to the §Value Constraints tolerance list. The same
pre-pass strips a defined **optional** member whose value has the wrong JSON
type (e.g. `"carbon-footprint": "345"` or `"renewable-energy": null`) and
records it in `disregarded` (mandatory members are left alone — stripping one
could never make the document processable, so a wrong-typed mandatory member
still fails validation). Strict mode fails such documents as served.

**`sci-score` dependency tolerance** (also under `legacyCompat`, default
`true`): the draft's tolerance list also says "A `sci-score` unaccompanied by
`functional-unit` is treated as not reported". The pre-pass strips a *reported*
(non-negative) `sci-score` whose document lacks `functional-unit`, recording
`"sci-score"` in `disregarded`. A **negative** `sci-score` (the legacy 1.x
sentinel) is already "not reported" under the out-of-range rule and flows
through for `withoutSentinels()` to interpret on demand. Strict mode keeps
flagging a reported `sci-score` without `functional-unit` as `invalid`
(cross-field MUST).

**Empty array** (also under `legacyCompat`, default `true`): a conformant
server never sends `[]` — it follows the no-data rule (404) instead — but the
final -04 draft says a client that nevertheless receives an empty array SHOULD
treat it as conveying **no report**. `fetchSustainability` returns the distinct
`{ status: "no-report" }` outcome for it, so callers can tell "the origin
published nothing usable" apart from both `ok` and `invalid`. In strict mode
(`legacyCompat: false`) an empty array is reported as `invalid` ("empty array
conveys no report"), preserving the validate-as-served contract.

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
    case "no-report":
      console.warn(`${ORIGIN} answered with an empty array (no report conveyed)`);
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
`legacyCompat` (default `true`) and `allowInsecure` (default `false`, the -06
HTTPS requirement) and threads both through to every underlying
`fetchSustainability` call — see §1. An `ok` result resolved from the cache
after a `304` reports the `mediaType` (and any `warnings`) of the cached
representation, since a `304` carries no `Content-Type` of its own.

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
    // { provider, "reporting-period", target, "target-type"?, metric, value, unit }
    timeSeriesDb.write(row.metric, row.value, { unit: row.unit, period: row["reporting-period"] });
  }
}
```

`flatten` skips absent values, applies the draft's default units (`kWh`/`gCO2e`)
when a value is present without its unit member, and — for the non-negative
members only — skips negative values (the legacy 1.x "not reported" sentinel),
so a time-series backend never ingests a `-1` as a real measurement. Negative
`scope-1`/`scope-2`/`scope-3` values are real net-accounting data since -03 and
flow through. When the document carries the -04 `target-type` hint, every row
gets it as a plain `"target-type"` string (omitted when absent); `toCsvRows`
likewise has a `target-type` column (empty cell when absent), and `aggregate`
copies `target-type` into the summary only when it is uniform across every
entry — mixed or partially-present classifications are omitted rather than
guessed at.

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

> **-06 (`https` only):** the three URI-valued members MUST be absolute `https`
> URIs, and clients MUST NOT automatically dereference one carrying any other
> scheme. `fetchDisclosure()` therefore refuses a non-`https` (or non-absolute)
> URI **before** making a request — `http:`, `ftp:`, `file:` and `data:` never
> reach your fetch implementation. A document carrying one is still valid and
> still usable; you just cannot follow that link with this helper.

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

`runConformanceChecks(origin, fetchImpl?, options?)` (also exposed as the CLI's
`--strict` flag) runs a small battery of seven checks against a target origin:
a Basic request returns a single object, the 200 response uses the
`application/sustainability-data+json` media type (a -06 MUST), the response
sends `X-Content-Type-Options: nosniff` (a -06 SHOULD), the response carries an
ETag, a conditional GET with that ETag returns `304`, a non-GET/HEAD method
returns `405` with an `Allow` header, and an Extended `granularity` request
returns a valid (sorted, schema-conformant) array.

Each check carries the BCP 14 strength of the requirement it tests in
`check.level` (`"MUST"` or `"SHOULD"`), because the two are not equivalent
verdicts: `report.allPassed` is true when no **MUST**-level check failed —
that is the conformance verdict — while `report.allPassedIncludingRecommended`
additionally requires every SHOULD to pass. An origin on static hosting that
returns `405` but cannot be configured to add an `Allow` header is conformant,
and should not be reported as failing.

Each check also carries a three-valued `check.outcome`:

| `outcome` | `pass` | Meaning |
|---|---|---|
| `"pass"` | `true` | the requirement is met |
| `"fail"` | `false` | it is not — a failed MUST is non-conformance and sets the exit code; a failed SHOULD is an unmet recommendation |
| `"warn"` | `false` | reported, but not held against the origin: it affects neither `allPassed` nor the exit code |

The only `warn` today is a publisher still serving the pre-06
`application/json` media type — detail `pre-06 media type (application/json):
v05-compatible, not v06-conformant`. That is a **MUST**-level check reporting a
non-conformance the battery deliberately does not fail an origin over while the
dedicated media type is awaiting IANA registration and -06 still tells clients
to accept it. There is no strict/`--require-06` flag: the `WARN` line is the
whole message. Anything that is neither media type (`text/html`, say) is a
plain `fail`. The `check.pass` boolean is unchanged and is exactly
`outcome === "pass"`, so existing code keeps working — read `outcome` to tell a
`warn` apart from a `fail`:

```ts
import { runConformanceChecks } from "sustainability-wellknown-consumer";

const report = await runConformanceChecks("https://new-server-im-building.example.org");
for (const c of report.checks) {
  const label =
    c.outcome === "pass" ? "PASS" : c.outcome === "warn" ? "WARN" : c.level === "MUST" ? "FAIL" : "WARN";
  console.log(`${label}  [${c.level}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
}
// allPassed = MUST-level failures only; use allPassedIncludingRecommended to
// hold yourself to the recommendations (and to the warns) too.
process.exitCode = report.allPassed ? 0 : 1;
```

`options` accepts `timeoutMs`, `maxBytes` and `allowInsecure` — the last one
forwarded to `fetchSustainability`, which is what you need to run the battery
against a local instance over plain HTTP (`http://127.0.0.1:8080` in CI), since
-06 otherwise refuses a non-HTTPS retrieval:

```ts
const report = await runConformanceChecks("http://127.0.0.1:8080", undefined, { allowInsecure: true });
```

This is **not limited to this repo's own `publisher/`** — point it at any
`/.well-known/sustainability-data` origin, including one you're implementing from
scratch in a different language entirely. It's the same battery the CLI runs:

```bash
sustainability-fetch https://new-server-im-building.example.org --strict

# ...or against a locally started instance, over plain HTTP:
sustainability-fetch http://127.0.0.1:8080 --strict --allow-http
```

Useful in your own server's CI: run it against a locally-started instance of
your implementation as a smoke test before shipping a change. Without
`--allow-http` an `http://` origin exits `2` with a one-line message naming the
flag — the draft's HTTPS requirement is unconditional, and a bare hostname is
promoted to `https://` rather than downgraded.

Sample output against a **-05** publisher (valid, not yet -06 conformant), which
still exits `0`:

```
PASS  [MUST] Basic request returns a schema-valid single object
WARN  [MUST] Basic 200 response uses the application/sustainability-data+json media type — pre-06 media type (application/json): v05-compatible, not v06-conformant
PASS  [SHOULD] Response sends X-Content-Type-Options: nosniff
PASS  [SHOULD] Response carries an ETag
PASS  [SHOULD] Conditional GET with a fresh ETag returns 304
PASS  [SHOULD] A method other than GET/HEAD gets 405 with Allow
PASS  [MUST] Extended granularity request returns a valid response (sorted array when honored)

Conformant: all MUST-level checks passed. WARN lines are unmet recommendations or advisory findings (such as a pre-06 media type).
```

### -05 compatibility, and what is deliberately not implemented

This is a **-06 client that still works against every -05 publisher**, because
-06 asks for exactly that. `fetchSustainability` accepts both media types (the
registered one and `application/json`), the battery **warns** rather than fails
on the old one — and will keep doing so until the RFC publishes and IANA has
registered the dedicated type — and a non-`https` URI member is a warning that
never invalidates a document. The `legacyCompat` tolerances described in §1 go
further still: they are a **courtesy beyond the specification** (deriving a
missing `target` from a 1.x `target-path`, disregarding wrong-typed optional
members, reading `[]` as "no report"), they are not required of a conformant
client, and they are scheduled for removal near RFC publication — do not build
on them; `legacyCompat: false` turns them off today.

**No signature verification is implemented.** -06 defines an OPTIONAL detached
JWS at `/.well-known/sustainability-data.jws`; a valid signature proves
integrity and key continuity, not identity, unless the key is already known out
of band — and a valid signature over false data is still false data. Nothing in
this package fetches or checks one.

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
the library's non-goals: no built-in crawler).
