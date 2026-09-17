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

> **Extension members (-07):** data the draft does not define goes in the
> `extensions` member — an object whose member names are absolute URIs (RFC 3986,
> Section 4.3: ASCII, scheme in lowercase, only the characters RFC 3986 allows (so no space, and none of `" < > \ ^ ` { | }`), no fragment) and whose
> values are objects.
> The two forms the draft names are an `https` URI with a host, which should
> identify human-readable documentation of the members, and `urn:uuid:` plus a
> lowercase hyphenated UUID (RFC 9562), the Nil and Max UUIDs excluded. A key is
> a namespace identifier, not a locator: nothing is ever fetched from it — the
> `https` form included, which this package MUST NEVER dereference and never
> does — and nothing inside a value is dereferenced or executed either.
> The top-level member set is closed, but a member this revision does not
> define is still *ignored* rather than rejected: it is preserved in the
> document you get back and reported as an `unknown-member` warning.

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
      mediaType: "sustainability-data+json" | "json";  // what the response was typed as
      warnings?: string[];                      // advisory findings; the declaration is valid
      legacy?: boolean;
      disregarded?: string[];
      signatures?: SignatureResult[];            // one per object; only when verifySignature was requested
      upstream?: UpstreamComparison[];           // only when followUpstream was requested
                                                 // (each entry may carry upstreamDisregarded?: string[])
    }
  | { status: "not-modified" }
  | { status: "not-found" }
  | { status: "no-report" }                   // 200 with an empty array: conveys no report
  | { status: "invalid"; errors: string[] }   // fetched but failed validation
  | { status: "wrong-media-type"; mediaType: string | null }  // not a declaration; refused unread
  | { status: "http-error"; httpStatus: number }
  | { status: "timeout"; timeoutMs: number }     // no complete response in time
  | { status: "too-large"; detail: string }      // body exceeded maxBytes
  | { status: "too-many-objects"; count: number; max: number } // more objects than maxObjects
  | { status: "insecure-transport"; url: string; detail: string }  // not retrieved over HTTPS
  | { status: "refused-uri";                    // this consumer declined to dereference it
      reason: "blocked-address" | "userinfo-in-uri";
      url: string; detail: string };
```

**Media typing (-07).** Every request sends
`Accept: application/sustainability-data+json, application/json;q=0.9` — exactly
the header the draft spells out: the registered media type, plus the generic
`application/json` at a lower q-value. The response's own `Content-Type` comes
back as `result.mediaType`:

| `mediaType` | Meaning |
|---|---|
| `"sustainability-data+json"` | the registered media type: conformant |
| `"json"` | the generic type, under which declarations published before the registration exist: processed (the draft's MAY), not conformant |

The media type is compared **ignoring any parameters** and case, as -07
requires ("this document defines none, and a consumer ignores any it
receives"), so `application/sustainability-data+json; charset=utf-8` is the
registered type. The same comparison is used everywhere the package looks at a
content type: the declaration response, an upstream declaration, the
conformance battery, a fetched attestation, and the `cty` of a signature
header.

Anything else — including a missing `Content-Type` — is **not a declaration**
("A response carrying a media type other than those two is not a declaration"), so the body
is refused unread and you get `{ status: "wrong-media-type", mediaType }`. Use
`MEDIA_TYPE`, `LEGACY_MEDIA_TYPE`, `ACCEPTED_MEDIA_TYPES`, `ACCEPT_HEADER` and
`classifyMediaType()` (all exported) if you need the same names elsewhere.

**Client-side bounds (-07).** The draft removed the server-side array cap and
requires the consumer to impose its own: "a consumer MUST NOT rely on any
server bound: it MUST limit the bytes and objects it accepts and treat an
excess as an error". `maxBytes` (default 10 MB) is enforced while the body
streams, and `maxObjects` (default 500 — the calendar bounds a conformant
response at 366) yields `{ status: "too-many-objects", count, max }`.

**URIs that resolve inward are refused (-07 §Consumer Considerations).** The
draft asks a consumer to "bound the time, size, and redirects of every fetch,
including those of upstream declarations, and … refuse URIs that resolve to
private or link-local addresses, since dereferencing URIs from an untrusted
document exposes it to server-side request forgery". Every URI this package
dereferences was written by some other origin — the declaration's own
`methodology-uri`, `disclosure-uri`, `verifiable-attestation-uri` and
`upstream[].declaration`, and every `Location` along the way — so before each
hop is requested its host is checked, and the request is not sent when the host
is, or resolves to, a loopback, private (RFC 1918), link-local, unique-local or
unspecified address. A URI carrying userinfo is refused too: a declaration is
public, unauthenticated data, so credentials out of a third-party document never
go on the wire. Both come back as
`{ status: "refused-uri", reason, url, detail }`, and the same check guards the
upstream walk, `fetchDisclosure()` and `verifyAttestation()`.

```ts
await fetchSustainability("https://example.org", {
  // Resolve names with your own resolver. A literal IP host is never looked up.
  lookup: async (hostname) => ["93.184.216.34"],
  // Reach an origin on your own network deliberately (allowInsecure implies it,
  // which is what keeps a http://127.0.0.1 development origin reachable).
  allowPrivateAddresses: false,
});
```

`lookup` exists so this is testable and deployable without surprises: pin it in
a test and no suite touches DNS; point it at your own resolver in a deployment
that has one. `isBlockedAddress()` is exported if you want to apply the same
rule to a URI before handing it over. What the check cannot close is the window
between this resolution and the one `fetch` performs — a name whose answer
changes in between (DNS rebinding) is resolved twice and only the first answer
is checked; closing that needs the request pinned to the address that was
checked, which the platform `fetch` gives no way to do, so a deployment that
must be proof against it puts an egress proxy in front of this package.

**HTTPS is required, with one explicit escape hatch.** The draft makes
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

**Did the server answer what you asked? (-07).** A server ignores a query
parameter it does not support and answers the rest of the request, so "a
consumer MUST compare the `reporting-period` and `target` of every object it
receives against what it requested, and MUST NOT record a response as covering
a period or a subject it does not name". Whenever you pass `period` or
`target`, every object received is checked against it, and any mismatch lands
in `result.notAsRequested` (one line each, also repeated in
`result.warnings`; the CLI prints `not as requested: …`). A `period` is
honoured when the object's period is **within** the one requested, so a
`granularity` request that answers `2026` with `2026-01`…`2026-12` is correct
and silent. The declaration itself is still returned and still valid — it just
covers something else, and you must not file it under the request.

```ts
const r = await fetchSustainability("https://example.org", { period: "2025-12" });
if (r.status === "ok" && r.notAsRequested) {
  // The server ignored `period`: do NOT record this as December 2025.
}
```

**A redirect across origins (-07).** A declaration is attributed to the origin
of the final response, which `result.url` names. When that origin differs from
the one you queried, "the declaration is a claim by that other origin, and the
consumer MUST NOT record it as a declaration of the origin it queried unless
the object's `target` names that origin". That case is reported explicitly
rather than silently re-attributed:

```ts
r.redirectedAcrossOrigins; // { queried, final, attributable } — or undefined
```

`attributable` is true only when **every** object's `target` names the origin
you queried (its host, host:port, or full origin, compared case-insensitively);
it is the only case in which you may record the declaration against that
origin. A `cross-origin-redirect` warning says the same in prose. HTTPS is
still required on every hop.

**Advisory warnings.** `result.warnings` (present only when non-empty) carries
findings that do **not** make a declaration invalid:

* a URI-valued member (`methodology-uri`, `disclosure-uri`,
  `verifiable-attestation-uri`, `upstream[].declaration`) holding an absolute
  non-`https` URI, which the draft restricts to the `https` scheme: the member
  is kept, the declaration stays valid, and the rule is enforced where it
  matters — `fetchDisclosure()` and the upstream walk refuse to dereference
  such a URI (§4);
* `unknown-member`: a top-level member this revision does not define. -07
  closes the base object, so it should not be there — but a consumer MUST
  ignore a member it does not recognize, since a later revision may define one;
* `modified-after-signing`: the members served differ from a verified `signed`
  payload (see below), naming which set is in use;
* `not as requested` lines, when the server answered a period or subject other
  than the one requested (also in `result.notAsRequested`);
* `cross-origin-redirect`, when the final origin differs from the one queried
  (also in `result.redirectedAcrossOrigins`).

`validateDocument()` reports the first two as `result.warnings`; its `valid`
boolean is unaffected by them, by design.

**What makes a declaration invalid** (beyond the JTD schema): a missing
mandatory member (there are seven; `version` is gone since -07), an object with
no numeric metric and neither `disclosure-uri` nor `verifiable-attestation-uri`
(the at-least-one MUST — `upstream` deliberately does not count as evidence),
an `extensions` key that is not an absolute URI (a bare UUID, `com.example.pue`,
a relative reference, a fragment, whitespace, non-ASCII, a character RFC 3986
does not allow in a URI such as `" < > \ ^ ` { | }`, an uppercase scheme such
as `HTTPS://…`, or an `https:` key with no host) or is the **Nil or Max UUID** in the `urn:uuid:` form (RFC 9562 §§5.9,
5.10 — -07 forbids both as guaranteed collisions; `isExtensionName()`,
`extensionNameError()` and `RESERVED_EXTENSION_NAMES` are exported), a value
under `extensions` that is
not an object, a `sci-score` without `functional-unit`, a defective value of
any mandatory member other than `capabilities`, and the cross-entry array
rules. A body whose **top-level value is neither an object nor an array** is
not a declaration at all, and is reported in exactly those words.

**The `signed` member** (`verifySignature: true`, CLI `--verify`): each
declaration object may carry a JWS over itself, without `signed`, typed by
`cty: sustainability-data+json`. The outcome per object lands in
`result.signatures`:

| `status` | Meaning |
|---|---|
| `"unsigned"` | the member is absent — the publisher did not sign, which is **not evidence of anything** |
| `"verified"` | it verified under EdDSA or ES256 (this consumer's policy; `none` and MACs are rejected, as is an unknown `crit` or a wrong `cty`), with the key from the header, a pinned key, or one you supply |
| `"unverified"` | it did not verify — the object is **unverified, never false**, and must not be presented downstream as verified |

A `signed` value of the **wrong JSON type** is not a failed signature: -07
disregards it and processes the object as though the member were absent, so it
reads as `"unsigned"` (and is listed in `disregarded`). The same goes for a
wrongly typed `upstream` or `extensions`.

A verified payload is rejected — the object left `"unverified"` — with its own
reason code when it is not a valid declaration object
(`payload-not-declaration`), when its `target` or `reporting-period` differs
from the object's (`payload-subject-mismatch`; "the two then describe different
things"), or when it carries a `signed` member of its own
(`payload-carries-signed`, which §The signed Member forbids).

**Precedence depends on how far the key is trusted** (the -07 security
revision). A `verified` result carries `precedence`:

| `precedence` | When | What `result.document` holds |
|---|---|---|
| `"payload"` | `keySource: "trusted"` — the key was pinned or supplied out of band through `signaturePolicy.trustedKeys` (or validated through an `x5c` chain to an anchor you already trust). Pinning establishes **continuity, not identity**: precedence rests on the same holder having signed the earlier declaration | the **signed payload's** members, taking precedence over the members served, in the manner of RFC 8414 `signed_metadata` |
| `"origin"` | `keySource: "header"` — the key is trusted no further than the declaration carrying it (an `x5c` chain not validated to a trusted anchor included) | the members **served by the origin**; the signature establishes integrity and key continuity only |

The second row is the whole point: letting a self-asserted payload override an
origin-authenticated one would let anyone able to add a member replace every
figure. A difference between payload and served members is reported either way
— the object is still `verified`, `modifiedAfterSigning` is true, and a
`modified-after-signing` warning names the members that differ and says which
set is in use.

**The `upstream` chain** (`followUpstream: true`, CLI `--upstream`): the
declarations a subject's figures derive from are retrieved — https only, the
same time and byte bounds, depth 3 at most, a URI already retrieved in the walk
refused, and **a bounded total number of retrievals for one starting
declaration** (`upstreamMaxRetrievals`, default
`DEFAULT_MAX_UPSTREAM_RETRIEVALS` = 20, shared by every level of the walk).
The budget is not redundant with the depth limit: `upstream` is an array, so a
document naming ten providers, each naming ten, would reach a thousand
retrievals at depth three without a single non-conformant document. Entries the
budget cannot cover come back `unreachable`, saying so.

An upstream that supports the Extended parameters is asked for the subject's
period directly; one that does not is taken at its Basic response, and only
when its period matches — a server ignores a parameter it does not support, so
what came back is compared with what was asked and never recorded as covering a
period it does not name.

**A retrieved declaration is read exactly as any other declaration is.** The
draft says so — "It reads a retrieved declaration exactly as it reads any
other, applying the tolerance rules of Value Constraints and Omitted Metrics
rather than refusing one over a defective value" — so the same tolerance
pre-pass the ordinary fetch path applies (the shared `applyToleranceRules`)
runs on every declaration the walk retrieves, before validation. An upstream
carrying an unrecognized enumerated value (an unrecognized `carbon-accounting`,
say), a wrong-JSON-typed optional member or a `sci-score` without
`functional-unit` is therefore **retrieved and compared with that member
disregarded**, not reported `unreachable`; the member paths stripped are listed
in that entry's `upstreamDisregarded` (same form as `disregarded` on the fetch
result) and printed on the CLI line, so the tolerance is visible rather than
silent. Tolerance stops where readability does: an upstream that is not a
declaration at all, or that omits a mandatory member, still comes back
`unreachable` with `not retrieved: invalid (…)`. `legacyCompat: false`
(`--strict`) turns the pre-pass off for the walk exactly as it does for the
fetch, so a defective upstream is then refused in both places alike —
`fetchSustainability` passes its own setting through, and one strictness
setting governs the whole walk.

**The comparison is defined only for a tenant-scoped upstream declaration**:
one whose `target-type` is `tenant`, i.e. a declaration about what the upstream
delivers to this subject. For it, for the same `reporting-period` and after
conversion to a single unit, "a subject whose declared scope covers what that
upstream delivers cannot report a smaller `energy-consumption`, or a smaller
`carbon-footprint`, than the upstream states it delivered" — so the subject's
own total is compared with the upstream's tenant figures, and a subject
reporting less than its own provider says it supplied is `under-reported`. A
shortfall too small to mean anything is disregarded, as the draft allows: a
consumer "disregards a shortfall no larger than the rounding and unit
conversion behind the two figures could account for", and this client takes
only the unit-conversion part of that allowance — a relative 1e-9, some six
orders of magnitude above the double-precision error a kWh/MWh or
gCO2e/mtCO2e conversion introduces, so 8.21 MWh (which converts to
8210.000000000002 kWh) never reads as a shortfall against a declared 8210 kWh.
It deliberately claims no more of the allowance than that: a consumer sees two
parsed numbers, not the precision each publisher rounded at, so a wider band
would be a guess that forgave real shortfalls, while a narrower band than the
draft permits can only report a finding "to investigate rather than a failure
to conform".
**Those two members are the only ones compared**: every other member is read
for context (the units, the period, `target-type`, `carbon-accounting`) or not
read at all, and none of them takes part in a verdict. Where an upstream
publishes only its own totals "rather than a tenant-scoped declaration, no
relation is defined at all", so the declaration is reported as fetched and
`not-comparable`. Each `result.upstream[]` entry carries both sets of figures
(normalized to kWh and gCO2e), the upstream's
`upstreamTargetType`/`upstreamTarget`, `carbonComparison` when there was a
carbon comparison to make, and one verdict:

| verdict | Meaning |
|---|---|
| `consistent` | the subject's own total for the period is at least the upstream's tenant figures, so the subject reports no less than its own provider says it supplied |
| `under-reported` | the subject's own total for the period is less than the upstream's tenant figures: the subject reports less than its own provider says it supplied |
| `not-comparable` | the upstream is not tenant-scoped, publishes nothing for that period, shares no figure, or shared only `carbon-footprint` on a different accounting basis |
| `unreachable` | not retrieved: refused, unreachable, past the depth/loop/budget bounds, or not readable as a declaration even under the tolerance rules (not a declaration at all, or a mandatory member missing) |

**That is evidence about consistency between two self-asserted claims, never
proof of either** — nothing in the comparison measures anything, and both
figures are published by the party they flatter. It is also "the only relation
defined" and "deliberately loose", in four ways the output states rather than
hides:

1. **`under-reported` is something to investigate, not a failure to conform.**
   Whether a subject's declared scope covers a given upstream "is not
   expressible in this format, so a subject that legitimately excludes one will
   read as inconsistent". The `detail` string of every `under-reported` verdict
   says so in plain words, next to the "evidence about consistency between two
   self-asserted claims, never proof" wording: nothing here has found a breach
   of the draft.
2. **The converse cannot be checked at all.** No member carries the share of a
   subject's figures attributable to one upstream, so a subject reporting far
   *more* than this upstream delivered is exactly what a subject with other
   upstreams, or with figures of its own, looks like. It is never a finding.
3. **Each `upstream` entry is compared on its own.** There is one
   `UpstreamComparison` per entry and the draft "defines no relation over
   several of them together": nothing sums, averages or otherwise combines
   entries, so a set of individually `consistent` verdicts is a set of
   independent findings and says nothing about the subject's upstreams taken
   as a whole. (Two upstreams that are each below the subject's own total, but
   together above it, are both `consistent` — by design.)
4. **`carbon-footprint` is compared only on a shared accounting basis.**
   Figures computed on different bases are not comparable, so the carbon
   figures take part "only where both objects declare the same
   `carbon-accounting` value or neither declares one". Where the two disagree,
   or one declares a basis and the other does not, the carbon comparison is
   **skipped and said to be skipped** — `carbonComparison:
   "skipped-different-accounting-basis"`, and the `detail` string names both
   bases — while the energy comparison proceeds as usual. If the skip leaves
   nothing comparable, the verdict is `not-comparable` and its detail gives
   that as the reason. Both figures are still reported in
   `subject`/`upstreamFigures`; only the verdict leaves carbon out.
   `carbonComparison` is `"compared"` when the carbon figures did take part,
   and absent when there was no carbon comparison to make (one side or both
   reported no `carbon-footprint`, or the declaration was never compared). An
   unrecognized `carbon-accounting` value is disregarded per §Value
   Constraints and Omitted Metrics, so such an object counts as declaring no
   basis rather than as a third basis of its own.

**Legacy compatibility** (`legacyCompat`, default `true`): per the draft's
field-driven compatibility rules (§Value Constraints and Omitted Metrics, final -04), a
document without the mandatory `target` member is historical (`"1.0"`/`"1.1"`)
and gets `target` derived before validation — from the historical
`target-path` member's **value** when that member is present (it named the
reporting subject, e.g. `"/api/v1"`), and from the final-response origin's host
(an origin-wide report; redirects are attributed to the final origin, per the
draft) **only when neither member exists**. This applies to a target-less
document or to every entry of a target-less array, and the result is flagged
with `legacy: true`. Historical documents therefore still validate and stay
usable. Pass `legacyCompat: false` for strict mode: legacy documents then come
back as `status: "invalid"`. (The out-of-range rule — a negative value in a
non-negative member, or a `renewable-energy` above 100, reads as "not
reported" — is the one tolerance rule applied ON DEMAND, via
`withoutSentinels()`/`isNotReported()`, rather than by the fetch path: the
value stays in `document` exactly as served, and every part of this package
that *uses* a figure — `flatten()`, `aggregate()` and the upstream comparison —
skips it. Call `withoutSentinels()` before reading `document` yourself if you
want it gone.)

**Enumerated-member tolerance** (also under `legacyCompat`, default `true`):
the draft's §Value Constraints and Omitted Metrics says an *unrecognized* value
in an enumerated string member — `capabilities`, `energy-unit`, `carbon-unit`,
`carbon-accounting` or `target-type` (`origin`, `path`, `organization`,
`service`, `product`, `device`, `tenant`, `data-source`) — causes that member
to be disregarded; for a unit member the numeric member(s) it parameterizes
(`energy-consumption` for `energy-unit`; `carbon-footprint`, `scope-1`,
`scope-2`, `scope-3` for `carbon-unit`) are then not reported; for
`target-type`, `target` is interpreted as if the member were absent. Because
the JTD schema deliberately keeps the enums closed, `fetchSustainability`
applies this in its pre-pass: the offending member (and the members it
parameterizes) is stripped **before** validation and every path is recorded in
`disregarded` (e.g. `["energy-unit", "energy-consumption"]`, or `"[i].…"` paths
for array entries), so the tolerance is visible, never silent. The upstream
walk applies the same pre-pass to every declaration it retrieves and records it
in that entry's `upstreamDisregarded`, so the same document reads the same way
whether it was fetched directly or reached through an `upstream` entry. `capabilities`
is the one mandatory member with a tolerance rule of its own: -07 says "a
defective `capabilities` value is read as `basic`, and a defective value of any
other mandatory member leaves the object non-conformant", so an unrecognized
value **and a value of the wrong JSON type** both read as the conservative
`"basic"` (a hint anyway — actual support is determined from the server's
behaviour) and `"capabilities"` is recorded in `disregarded`. In strict mode (`legacyCompat: false`) the document is validated
exactly as served and an unrecognized value fails validation. A *recognized*
value flows through untouched. In an array, `target-type` is **all-or-none** (final -04): present
in every entry with the same value or absent from every entry — mixed presence
fails validation in both modes.

**Wrong-JSON-type tolerance** (also under `legacyCompat`, default `true`): the
final -04 draft adds "A value of the wrong JSON type (including `null`) is
treated as not reported" to the §Value Constraints tolerance list. The same
pre-pass strips a defined **optional** member whose value has the wrong JSON
type (e.g. `"carbon-footprint": "345"` or `"renewable-energy": null`) and
records it in `disregarded` (mandatory members other than `capabilities` are
left exactly as served — stripping one could never make the document
processable, so a wrong-typed mandatory member still leaves the object
non-conformant, `status: "invalid"`). For `signed`, `upstream` and
`extensions`, -07 states the outcome explicitly: the member is disregarded and
the object is processed as though it were absent. Strict mode fails such
documents as served.

The same pre-pass strips a **numeric member that is not a finite number**.
JSON has no literal for `NaN` or `Infinity`, but `1e999` is a legal JSON number
that parses to `Infinity` in every JavaScript runtime — the hazard the media
type registration names ("the implementation-dependent handling ... of numbers
outside the range exactly representable in IEEE 754 double precision") — and
such a member re-serializes as `null`. Since "a member that is present always
carries an actual value", it is disregarded like any other defective value, it
is recorded in `disregarded`, and it does not satisfy the at-least-one rule: an
object whose only figure is infinite reports nothing and comes back
`status: "invalid"`. Strict mode reports it as a validation error instead.

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

For a script that wants to inject its own transport (a
proxy, a test double), pass `fetchImpl`. Node 22 (the supported runtime) ships a global `fetch`, so this
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
`legacyCompat` (default `true`) and `allowInsecure` (default `false`, the
draft's HTTPS requirement) and threads both through to every underlying
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

The return value is an **`AggregateSummary`, not a declaration**, and its type
says so. Its `reporting-period` is a RANGE, which is none of the three forms
§Mandatory Members defines, so `validateDocument()` refuses it — that refusal
is the guarantee, not just a naming convention: a summary cannot be published,
signed, or fed back into anything expecting a declaration. It also never carries
a `signed` member, because nothing signed it. The draft defines exactly one way
to combine periods, the server-side aggregate of §Extended Query Parameters step
5, with rules this function does not apply (one precision, no overlap, coverage
of P, the MUST-agree members); a publisher wanting a figure for a longer period
asks its own origin for that period. Read it, print it, put it in a
spreadsheet — do not serve it.

`aggregate` normalizes every entry to a common unit before combining (the
requested unit, or the first *reporting* entry's unit if none is given) — it
never silently mixes `kWh` and `MWh` figures. Since -03 the energy/carbon
quartet is optional: entries that don't report a metric (absent member, or
negative under the legacy rule) simply don't contribute — an `average` divides
by the number of reporting entries, never producing `NaN` — a value carried
without its unit member gets the draft's default (`kWh`/`gCO2e`), and when no
entry reports a metric at all the summary omits it.

## 4. Disclosure links (passive by design)

> **`https` only:** the URI-valued members (`methodology-uri`,
> `disclosure-uri`, `verifiable-attestation-uri`, `upstream[].declaration`)
> MUST be absolute `https` URIs, and a consumer MUST NOT automatically
> dereference one carrying any other scheme. `fetchDisclosure()` therefore refuses a non-`https` (or non-absolute)
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
  make that request on the origin's behalf. `fetchDisclosure()` refuses such a
  URI outright — not `https`, or a host that resolves to a private, loopback,
  link-local, unique-local or unspecified address — but staying passive by
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
`--strict` flag) runs a small battery of six checks against a target origin:
a Basic request returns a single object, the 200 response uses the
`application/sustainability-data+json` media type (a MUST), the OPTIONAL
`signed` member is absent or verifies (MUST), the response carries an ETag, a
conditional GET with that ETag returns `304`, a non-GET/HEAD method returns
`405` with an `Allow` header, and an Extended `granularity` request returns a
valid (sorted, schema-conformant) array. (-07 dropped the
`X-Content-Type-Options: nosniff` recommendation, so the battery no longer
checks for it.)

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

Two states warn today. A publisher still serving the generic
`application/json` media type — detail `generic media type (application/json):
processed, but a conformant 200 response carries
application/sustainability-data+json` — is a **MUST**-level check reporting a
non-conformance the battery deliberately does not fail an origin over while the
dedicated media type is awaiting IANA registration and the draft still has
consumers process it. A verified `signed` member whose payload differs from the
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

Sample output against a publisher still serving the generic media type (valid,
not conformant), which still exits `0`:

```
PASS  [MUST] Basic request returns a schema-valid single object
WARN  [MUST] Basic 200 response uses the application/sustainability-data+json media type — generic media type (application/json): processed, but a conformant 200 response carries application/sustainability-data+json
PASS  [MUST] Embedded signature (OPTIONAL `signed` member): absent, or present and verifiable — not signed (optional)
PASS  [SHOULD] Response carries an ETag
PASS  [SHOULD] Conditional GET with a fresh ETag returns 304
PASS  [SHOULD] A method other than GET/HEAD gets 405 with Allow
PASS  [MUST] Extended granularity request returns a valid response (sorted array when honored)

Conformant: all MUST-level checks passed. WARN lines are unmet recommendations or advisory findings (such as the generic media type).
```

### Tolerance, and what is deliberately not implemented

This is a **-07 client**, and the few places it is lenient are the places the
draft itself is. `fetchSustainability` processes both media types (the
registered one and the generic `application/json`) and refuses any other unread;
the battery **warns** rather than fails on the generic one, and will keep doing
so until the RFC publishes and IANA has registered the dedicated type; an
unrecognized top-level member is ignored and reported as an `unknown-member`
warning; and a non-`https` URI member is a warning that never invalidates a
declaration. The `legacyCompat` tolerances described in §1 go further still:
they are a **courtesy beyond the specification** (deriving a missing `target`
from a 1.x `target-path`, disregarding wrong-typed optional members, reading
`[]` as "no report"), they are not required of a conformant consumer, and they
are scheduled for removal near RFC publication — do not build on them;
`legacyCompat: false` turns them off today.

**Signature verification is never automatic.** The `signed` member is OPTIONAL
and this package checks it only on request (`--verify`, `verifySignature`, and
the battery's signature check). A valid signature proves integrity and key
continuity, not identity — unless the key is already known out of band — and a
valid signature over false data is still false data. That is also why a
verified payload replaces the members served **only** when the key was pinned
or supplied out of band: with a key carried in the signature's own header,
anyone able to add a member to the served document could otherwise replace
every figure in it.

**Upstream retrieval is never automatic either**, it is bounded in depth, in
revisited URIs and in total retrievals, and the comparison it produces is
evidence about consistency between two self-asserted claims, never proof of
either.

**Every SSRF protection §Consumer Considerations asks for is implemented**, on
every dereference path: bounded time, size, objects and redirects; HTTPS on
every hop; the depth, revisit and total-retrieval bounds on the
upstream walk (the last of which is also what bounds its breadth); and — since this revision of the package — the refusal of a URI
whose host is, or resolves to, a private, loopback, link-local, unique-local or
unspecified address, with the resolver injectable. The one thing it does not do
is defeat DNS rebinding, which the platform `fetch` gives no way to do from
library code; see the note in §1.

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
