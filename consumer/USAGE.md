# Using `sustainability-wellknown-consumer`

Version 0.8.1, for revision -10 of the draft. The package is used at **three tiers**, all from the
same package: pick whichever fits, or mix them (the one-call function in a quick script, the client
class in a long-running service).

| Tier | When to use it | Section |
|---|---|---|
| **One-call** | A quick script or a project that wants nothing beyond a function call | [§1](#1-one-call-usage) |
| **`SustainabilityClient`** | A long-running service polling one or many origins repeatedly | [§2](#2-sustainabilityclient-for-repeated-polling) |
| **Transformation utilities** | You have a fetched document and need CSV, NDJSON, flat rows or a total | [§3](#3-transformation-utilities) |

Then: [§4 Disclosure links](#4-disclosure-links-passive-by-design),
[§5 Conformance-checking any origin](#5-conformance-checking-any-origin),
[§6 Using it as a library](#6-using-it-as-a-library). Upgrading from 0.7.x: see the README.

---

## 1. One-call usage

`fetchSustainability(origin, options)` builds the URL, sends the request, reads the body, validates it
and returns a tagged result. It never throws for a protocol-level outcome (a 404, an invalid document,
a refused URI); it throws only for a network or TLS failure.

```ts
import { fetchSustainability } from "sustainability-wellknown-consumer";

const result = await fetchSustainability("https://example.org");
```

`origin` is a plain origin, a base URL with a path prefix (a gateway serving many subjects:
`https://gateway.example/cloudflare.com` resolves the well-known path under the prefix), or the full
declaration URL.

### The result

| `status` | Meaning |
|---|---|
| `ok` | A valid declaration. `document` is one object or an array (an empty array is a valid answer: the server holds nothing). Also `url`, `etag`, `lastModified`, `mediaType`, `covers`, and, when they apply, `honored`, `notAsRequested`, `warnings`, `converted`, `disregarded`, `signatures`, `upstream`, `redirectedAcrossOrigins` |
| `not-modified` | A 304 for the `ifNoneMatch` or `ifModifiedSince` you sent |
| `too-many-redirects` | A redirect loop or more than five hops; `url` is the hop not followed, `detail` says why |
| `not-found` | 404 |
| `invalid` | The body is not valid: `errors` lists why (strict-parse failures included) |
| `wrong-media-type` | A 200 whose media type is neither `application/sustainability-data+json` nor `application/json`; refused unread |
| `timeout` / `too-large` | The request exceeded `timeoutMs`, or the body `maxBytes` |
| `too-many-objects` | More objects than `maxObjects` (default 500) |
| `insecure-transport` | A non-HTTPS URL or redirect hop, without `allowInsecure` |
| `refused-uri` | The address is not public unicast, or the URI carries userinfo (`reason` says which) |
| `signature-required` | `requireSigned` was set and `failures` names each object (counting from 1) that is unsigned or did not verify |
| `http-error` | Any other HTTP status (`httpStatus`) |

### Selecting: `target`, `start`, `end`, `granularity`

```ts
const r = await fetchSustainability("https://example.org", {
  target: "example.org",
  start: "2026-01-01T00:00:00Z",
  end: "2027-01-01T00:00:00Z",
  granularity: "monthly",
});
```

`start` and `end` are RFC 3339 date-times; the request goes out in UTC whatever offset you give. A
request with no parameter is answered, by a server that supports the query parameters (`capabilities: "extended"`),
with what it holds as an array in ascending order of `period.start`; a Basic server or a static file may answer with one
object. An empty array is a valid answer and means nothing was selected. A server may ignore any parameter, so:

* `r.honored` says per parameter whether every object received matches it (`start: true`, `granularity: false`, ...).
* `r.notAsRequested` lists, one line per mismatch, what the server sent that you did not ask for. Such a response must not be recorded as covering the period or target you requested.
* `r.covers` is what each object says it covers: `[{ target, period: { start, end } }]`. That, not the request, is what the response is about.

### Bounds and transport

`timeoutMs` (30 s), `maxBytes` (10 MB after decoding), `maxObjects` (500) and `maxDepth` (32, nesting of the JSON) bound a hostile or broken
origin. The body is read as I-JSON: a duplicated member name, a number beyond binary64 and an unpaired surrogate make the document `invalid`.

HTTPS is required on every hop, and a redirect is followed by hand, a bounded number of times, with the same checks on each hop. The address of
every connection is checked when it is made: only public unicast addresses pass; an IPv4-mapped (`::ffff:`) or NAT64 (`64:ff9b::/96`) address is
judged by the IPv4 address inside it; a literal IP host is checked before connecting. For a local server in a test:

```ts
const r = await fetchSustainability("http://127.0.0.1:8080", { allowInsecure: true }); // also allows the loopback address
```

`allowInsecure` permits the http scheme and loopback addresses only; private, link-local and the other refused ranges stay refused. Set `allowPrivateAddresses` (CLI: `--allow-private`) to reach an origin on your own network, and `ca` to trust a private certificate authority
(verification stays on). `lookup` replaces the system resolver, so a test never needs live DNS:

```ts
await fetchSustainability("https://asked.example", { lookup: async () => ["93.184.216.34"] });
```

A declaration retrieved from another origin than the one you queried is attributed to the final origin (`url`); `redirectedAcrossOrigins` carries
`attributable`, true only when every object's `target` names the origin you queried.

### Reading earlier revisions: `legacyCompat`

By default (`legacyCompat: true`) a document written for -08 or -09 is read as the -10 document it stands for, and the result says what was done. Six legacy forms are read, and
nothing else:

| Legacy form | Read as | Listed in |
|---|---|---|
| `reporting-period` (`"2026"`, `"2026-02"`, `"2026-02-03"`), or a `period` of two full dates | a `period` with `start` and `end` (UTC) | `converted` |
| `carbon-unit` `mtCO2e` | `tCO2e` | `converted` |
| a `functional-unit` of an earlier set | the unit it stands for, with its `sci-score` | `converted` |
| a `measurement-method` outside the set | `third-party-modeled` | `disregarded` |
| `functional-unit` that no rule converts | removed with its `sci-score` | `disregarded` |
| an upstream `role` or a `target-type` outside its set | removed | `disregarded` |

The paths are relative to the object and prefixed `[i].` in an array (`"period"`, `"[2].carbon-unit"`). A fiscal year that an extension of a gateway data file recorded is honoured. A defective `energy-unit`, `carbon-accounting` or
`capabilities`, a value of the wrong type, and a negative figure are invalid in both modes. A leap second (`:60`) in a declaration is read as `:59` and noted
(`leap-second-read-as-59`). Use `legacyCompat: false` for strict mode: the document is validated exactly as served, so a document of an earlier revision is `invalid`. The publisher package's `upgrade` command
rewrites a document into -10 by the same rules.

### Warnings

`result.warnings` holds advisory findings as `code: message` strings (a document that is valid and usable): `unknown-member` (a top-level member -10 does not define; it is kept and ignored),
`uri-not-a-reference`, `period-below-day-floor`, `updated-before-period-end`, `leap-second-read-as-59`, `scopes-do-not-account-for-footprint`, `origin-u-label`, `provider-personal-contact`, and from the signature check `modified-after-signing` and `deprecated-alg`. `validateDocument()` returns them as `{ code, message }` objects and never lets them change `valid`.

### Extension members

Data the draft does not define goes under `extensions`, an object whose values are objects. An extension name is a URI under the definer's control when the name was minted (for example an `https` URI), or a UUID URN (`urn:uuid:…`) for a definer without a domain. It is an identifier, compared as a string after JSON escapes are decoded, and never dereferenced; nothing inside a value is executed.

### Signatures

`verifySignature: true` checks the `signed` member of each object and reports one entry per object in `signatures`; it never changes the declaration's own status. `requireSigned: true` fails the response
with `signature-required` unless every object carries a signature that verifies. This is the only way to notice a removed signature or a dropped unsigned object.

```ts
const r = await fetchSustainability("https://example.org", {
  verifySignature: true,
  signaturePolicy: {
    trustedKeys: [keyFromTheirHomepageOrContract], // out of band: never from jku, x5u or the declaration
    pinnedKeys: [keyFromEarlierRetrieval],
    trustAnchors: [caPem], // PEM; for an x5c chain whose end-entity certificate names the host
    held: [{ target: "example.org", period, updated: "2026-03-01T12:00:00Z" }], // readings you already hold
    allowedAlgs: ["Ed25519", "ES256"],
  },
});
```

| Result | Fields |
|---|---|
| `{ status: "unsigned" }` | No `signed` member. This is not evidence of anything |
| `{ status: "verified", ... }` | `alg`, `deprecatedAlg` (when the identifier is `EdDSA`), `kid`, `thumbprint` (RFC 7638), `publicJwk`, `keyTrust`, `precedence`, `cty`, `modifiedAfterSigning`, `modifiedMembers`, `replaySuspected` |
| `{ status: "unverified", reason }` | Never "false". `reason`: `malformed`, `alg-none`, `mac-alg`, `alg-rejected`, `cty-missing`, `cty-wrong`, `crit-unknown`, `no-key`, `private-key-in-header`, `key-alg-mismatch`, `pin-mismatch`, `invalid-signature`, `payload-not-declaration`, `payload-subject-mismatch` |

`keyTrust` and what it means for the members you use:

| `keyTrust` | The key | `precedence` |
|---|---|---|
| `out-of-band` | You supplied it independently (`trustedKeys`, matched by `kid` first) | `payload` |
| `pinned` | You kept it from an earlier retrieval (`pinnedKeys`): continuity of authorship, not identity | `payload` |
| `x5c-anchored` | The header's `x5c` chain leads to a `trustAnchors` entry, every certificate is in date (`now`), and the end-entity certificate names the host (`host`, default the host of the final response) | `payload` |
| `declaration-only` | Any other key, such as one embedded as `jwk`, or an `x5c` chain not anchored | `origin` |

With `precedence: "payload"` the signed payload's members are the ones in `document`; with `"origin"` the members served stay in use and the signature shows integrity only, because whoever can publish a
declaration can publish a key. Further rules: `Ed25519` and `ES256` are accepted, `EdDSA` is accepted on input and marked deprecated; `none` and MAC algorithms are refused; `cty` must name
`sustainability-data+json`; an unknown `crit` is refused; a held key that differs from the key presented is a `pin-mismatch`; the payload's `target`, `period.start`, `period.end`, `carbon-accounting` and
`functional-unit` must equal the object's (compared as strings; absent from both counts as equal); `provider` is never matched against a key or certificate. A signature protects the other members of its own
object, not the array around it, the HTTP header fields or the retrieval URI.

### Upstream

`followUpstream: true` retrieves the declarations the first object's `upstream` member names and compares their figures with its own for the same period. It is never automatic.
The walk goes three levels down at most (`upstreamMaxDepth` can lower it), refuses a URI it has already retrieved, and stops after `upstreamMaxRetrievals` retrievals (default 20); https only. Each retrieved
declaration is read exactly as any other (the compatibility reading included). Per entry the verdict is:

* `consistent`: the subject reports at least as much `energy-consumption` (and, on the same basis, `carbon-footprint`) as a tenant-scoped upstream states it delivered;
* `under-reported`: less. This is something to investigate, not a failure to conform: the format cannot say whether the subject's scope covers the upstream, and the detail says so;
* `not-comparable`: the upstream is not a `tenant` declaration, or nothing is comparable (different `carbon-accounting` basis leaves carbon out: `carbonComparison: "skipped-different-accounting-basis"`);
* `unreachable`: not retrieved, not a declaration, or invalid as read.

Entries are compared one by one; nothing is summed across them. A shortfall within rounding and unit conversion (a relative 1e-9) is disregarded. A verdict is evidence about consistency between two
self-asserted claims, never proof of either.

---

## 2. `SustainabilityClient` for repeated polling

`SustainabilityClient` keeps the ETag and the `Last-Modified` of each distinct origin and parameter combination and sends them as `If-None-Match` and `If-Modified-Since` (a consumer that keeps a reading beyond its freshness lifetime revalidates it before relying on it). A `304` is resolved to the last known document, so the caller never has to special-case
"not modified". `Z`, `+00:00` and `.000Z` spellings of a bound share one cache entry.

```ts
import { SustainabilityClient } from "sustainability-wellknown-consumer";

const client = new SustainabilityClient();

async function poll(origin: string) {
  const result = await client.get(origin, { start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" });
  if (result.status !== "ok") return console.error(`${origin}: ${result.status}`);
  console.log(result.document);
}
```

`getTrend(origin, { granularity, start?, end?, target? })` asserts the response is an array and throws if the origin ignored `granularity`:

```ts
const monthly = await client.getTrend("https://example.org", { start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z", granularity: "monthly" });
```

Options: `maxCacheEntries` (256), `timeoutMs`, `maxBytes`, `maxObjects`, `maxDepth`, `legacyCompat`, `allowInsecure`, `allowPrivateAddresses`, `lookup`, `ca`, `fetchImpl`, and the signature and upstream options `verifySignature`, `requireSigned`, `signaturePolicy` (trusted keys, pinned keys, trust anchors, held readings), `followUpstream`, `upstreamMaxDepth`, `upstreamMaxRetrievals`. They are applied to every fetch.
Signature verification is on when `verifySignature` or `requireSigned` is true, or when a `signaturePolicy` is given (an explicit `verifySignature: false` turns it off); the same rule holds for `fetchSustainability`.
A client that follows upstream declarations sends no conditional request, so each poll is a full fetch and the comparison is current. A result resolved
from the cache reports the `mediaType`, `covers`, `honored`, `warnings`, `notAsRequested` of the cached representation, and its `signatures`.

---

## 3. Transformation utilities

These operate on a validated document: a result's `document`, with the `url` it came from (`source.url`) and, if you verified, its `signatures`. A figure is a claim by the origin that served it, so
every output says where it came from.

```ts
import { fetchSustainability, toCsvRows, toNdjson, flatten, total } from "sustainability-wellknown-consumer";

const r = await fetchSustainability("https://example.org", { verifySignature: true });
if (r.status === "ok") {
  const source = { url: r.url, signatures: r.signatures };
  const csv = toCsvRows(r.document, source); // header first
  const ndjson = toNdjson(r.document, source); // one {source-url, claimed-by, declaration} per line
  const rows = flatten(r.document, source); // one row per numeric metric, for a time-series store
}
```

* `toCsvRows` columns: `source-url`, `claimed-by`, `signature`, `provider`, `target`, `target-type`, `carbon-accounting`, `period-start`, `period-end`, `energy-consumption`, `energy-unit`, `carbon-footprint`, `carbon-unit`.
  Values with a comma, quote or line break are quoted (RFC 4180).
* `flatten` rows carry `period` as `{ start, end }`, `metric`, `value` and `unit`. A negative scope is real data (net accounting) and passes through.
* `total(objects, { energyUnit?, carbonUnit? })` adds `energy-consumption`, `carbon-footprint` and the three scopes after converting to one unit. It is defined only across objects of **one target**, whose
  **periods do not overlap** (periods that meet do not overlap), and that declare **the same `carbon-accounting` value or none**; anything else throws `TotalPreconditionError` with a `reason`
  (`no-objects`, `mixed-targets`, `overlapping-periods`, `mixed-accounting`), because a year and its months are two views of the same figures, not additional ones. The result is a client-side summary and
  **not a declaration**: it has no mandatory members and `validateDocument()` refuses it. `coverage` says whether the periods are `contiguous` or have `gaps`; `incomplete` lists members some objects do not report.
  `aggregate` is kept as an alias of `total`.

---
## 4. Disclosure links (passive by design)

> **URI references, https to follow:** `methodology-uri`, `disclosure-uri`,
> `verifiable-attestation-uri` and `upstream[].declaration` are URI references,
> resolved against the URI the declaration was retrieved from
> (`FetchResult.url`; pass it as `base`). `fetchDisclosure()` resolves the
> reference first and dereferences only an `https` result: an `http:`, `ftp:`,
> `file:` or `data:` result, or a relative reference with no `base`, is refused
> before any request. A document carrying such a value is still valid; you just
> cannot follow that link with this helper.

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
  make that request on the origin's behalf. `fetchDisclosure()` refuses such a
  URI outright — not `https`, or an address that is not public unicast — but staying passive by
  default is the first line, and the address check the second.

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
`--strict` flag) runs a battery of twelve checks against a target origin, in
this order:

| Check | Level | Draft section |
|---|---|---|
| Basic request returns a schema-valid declaration (one object or an array) | MUST | Body |
| Basic 200 response uses the `application/sustainability-data+json` media type (generic `application/json` warns) | MUST | Location and Transport |
| Embedded signature (OPTIONAL `signed` member): absent, or present and verifiable | MUST | The signed Member |
| Signature algorithm identifier is Ed25519 or ES256 (`EdDSA` warns) | SHOULD | The signed Member |
| Response carries an ETag | INFO | HTTP practice |
| Conditional GET with a fresh ETag returns 304 | INFO | HTTP practice |
| A method other than GET/HEAD gets 405 with Allow | INFO | HTTP practice |
| A query value outside the profile is ignored, not refused | MUST | Query Parameters |
| A range that selects nothing is answered 200 (an empty array when honored), never 404 | MUST | Query Parameters |
| A server that honors a query parameter publishes capabilities extended | MUST | Mandatory Members |
| Extended range request (start, end, granularity=monthly) returns a valid response (ascending by period.start when an array) | MUST | Query Parameters |
| Periods are whole calendar years or months (informational) | INFO | Mandatory Members |

Every request of the battery, the raw probes included, goes through the same
transport as `fetchSustainability`: the connect-time address check, bounded
redirects (a redirect onto a refused address is never requested), the timeout,
and bodies that are discarded unread.

Each check carries the strength of what it tests in `check.level`:
`"MUST"` and `"SHOULD"` are the draft's own keywords, and `"INFO"` marks HTTP
practice (ETag, conditional requests, `405`) that RFC 9110 and RFC 9111 describe
and the draft leaves to the publisher. An unmet `INFO` check is a `WARN`, never
a failure. `report.allPassed` is true when no **MUST**-level check failed, which
is the conformance verdict, while `report.allPassedIncludingRecommended`
additionally requires every other check to pass. An origin on static hosting that
cannot add an `Allow` header or an ETag is conformant, and is not reported as
failing.

Each check also carries a three-valued `check.outcome`:

| `outcome` | `pass` | Meaning |
|---|---|---|
| `"pass"` | `true` | the requirement is met |
| `"fail"` | `false` | it is not — a failed MUST is non-conformance and sets the exit code; a failed SHOULD or INFO check is an unmet recommendation |
| `"warn"` | `false` | reported, but not held against the origin: it affects neither `allPassed` nor the exit code |

Two states warn today. A publisher still serving the generic
`application/json` media type — detail `generic media type (application/json):
a consumer may process it, but the draft publishes the declaration as
application/sustainability-data+json` — is reported on the **MUST**-level media
type check as a warning, because the draft lets a consumer process a `200`
response of that type. A verified `signed` member whose payload differs from the
plain members warns too: the difference is reported, not held against the
origin. There is no strict flag: the `WARN` line is the whole message. Anything
that is neither media type (`text/html`, say) is a plain `fail`, and the
declaration is refused unread with it. The `check.pass` boolean is unchanged and is exactly
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

`options` accepts `timeoutMs`, `maxBytes`, `now` (the clock the Extended
granularity check reads), `lookup`/`allowPrivateAddresses` (the address check)
and `allowInsecure` — all forwarded to `fetchSustainability`. The last one is
what you need to run the battery against a local instance over plain HTTP
(`http://127.0.0.1:8080` in CI), since the draft otherwise refuses a non-HTTPS
retrieval, and it implies the loopback exemption so the address check does not
refuse `127.0.0.1` in the same breath:

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

Sample output against a publisher serving the generic media type (valid and
conformant, with a warning), which exits `0`:

```
PASS  [MUST] Basic request returns a schema-valid declaration (one object or an array) (Body)
WARN  [MUST] Basic 200 response uses the application/sustainability-data+json media type (Location and Transport) — generic media type (application/json): a consumer may process it, but the draft publishes the declaration as application/sustainability-data+json
PASS  [MUST] Embedded signature (OPTIONAL `signed` member): absent, or present and verifiable (The signed Member) — not signed (optional)
PASS  [SHOULD] Signature algorithm identifier is Ed25519 or ES256 (EdDSA is the deprecated identifier) (The signed Member)
PASS  [INFO] Response carries an ETag (HTTP practice, RFC 9110 and RFC 9111; not a requirement of the draft)
PASS  [INFO] Conditional GET with a fresh ETag returns 304 (HTTP practice, RFC 9110 and RFC 9111; not a requirement of the draft)
PASS  [INFO] A method other than GET/HEAD gets 405 with Allow (HTTP practice, RFC 9110 and RFC 9111; not a requirement of the draft)
PASS  [MUST] A query value outside the profile is ignored, not refused (Query Parameters)
PASS  [MUST] A range that selects nothing is answered 200 (an empty array when honored), never 404 (Query Parameters) — not honored (allowed: a static file satisfies every request)
PASS  [MUST] A server that honors a query parameter publishes capabilities extended (Mandatory Members) — honors no query parameter (a static file satisfies every request)
PASS  [MUST] Extended range request (start, end, granularity=monthly) returns a valid response (ascending by period.start when an array) (Query Parameters) — parameters not honored (allowed: a static file satisfies every request)
PASS  [INFO] Periods are whole calendar years or months (informational) (Mandatory Members)
capabilities: basic

Conformant: all MUST-level checks passed. WARN lines are unmet recommendations, HTTP practice the draft leaves to the publisher, or advisory findings (such as the generic media type).
```

### Tolerance, and what is deliberately not implemented

This is a **-10 client**, and the few places it is lenient are the places the
draft itself is. `fetchSustainability` processes both media types (the
registered one and the generic `application/json`) and refuses any other unread;
the battery **warns** rather than fails on the generic one; an
unrecognized top-level member is ignored and reported as an `unknown-member`
warning; and a URI member that is not a URI reference is a warning
(`uri-not-a-reference`) that never invalidates a declaration. The `legacyCompat` reading described in §1 goes further: it reads the forms of -08 and -09 that -10 replaced, and it is a courtesy beyond the specification, not
required of a conformant consumer; do not build new publishers on it. `legacyCompat: false` turns it off.

**Signature verification is never automatic.** The `signed` member is OPTIONAL
and this package checks it only on request (`--verify`, `verifySignature`, and
the battery's signature check). A valid signature proves integrity and key
continuity, not identity — unless the key is already known out of band — and a
valid signature over false data is still false data. That is also why a
verified payload replaces the members served **only** when the key was pinned,
supplied out of band, or validated through an `x5c` chain to one of your
`trustAnchors`: with a key carried in the signature's own header,
anyone able to add a member to the served document could otherwise replace
every figure in it.

**Upstream retrieval is never automatic either**, it is bounded in depth, in
revisited URIs and in total retrievals, and the comparison it produces is
evidence about consistency between two self-asserted claims, never proof of
either.

**Every protection the draft's Security Considerations asks of a consumer is implemented**, on
every dereference path: bounded time, size, objects and redirects; HTTPS on
every hop; the depth, revisit and total-retrieval bounds on the
upstream walk (the last of which is also what bounds its breadth); and the refusal of a connection to an address that is not public unicast,
with the resolver injectable. The address is checked when the connection is made, with the address that
connection uses, so a name that resolves differently between a check and a
connection (DNS rebinding) cannot pass.

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

  const [, ...rows] = toCsvRows(result.document, { url: result.url }); // drop header; log file keeps one running header
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

