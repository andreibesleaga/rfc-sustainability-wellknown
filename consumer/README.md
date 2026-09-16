# sustainability-wellknown-consumer

A reference **client** for a `/.well-known/sustainability-data` document, as defined by
[draft-besleaga-sustainability-wellknown](https://datatracker.ietf.org/doc/draft-besleaga-sustainability-wellknown/).

It fetches, defensively validates, and transforms the document a third-party origin
publishes — complementing [`publisher/`](../publisher/), this repo's reference
**producer**. Together they demonstrate the full protocol lifecycle: produce →
discover → fetch → validate → transform → use. The document just arrived from an
arbitrary origin, so it is schema-validated (RFC 8927 JTD) **and** checked against
the draft's cross-entry array rules (ascending, non-overlapping, uniform
precision/target; `target-type` all-or-none — present in every entry with the same
value or absent from every entry) before it's ever handed to caller code — a non-conformant server
is the normal case for early ecosystem adoption, not a hypothetical. Built
basic-first and M2M-oriented: every API is one line to call from a script (a cron
job, a crawler, a carbon-aware scheduler) and fails loudly and legibly on bad input.

> **Version note:** consumer **0.7.0** implements the **-07** draft revision,
> and only that one: there is no -06 compatibility path left in the package.
> What -07 changed, and what this release does about it:
>
> * **The signature is embedded.** The separate signature resource of -06 is
>   withdrawn — the well-known URI is the only resource the draft defines. A
>   declaration object MAY carry a `signed` member whose value is a JWS
>   over that object without `signed`, typed by `cty:
>   sustainability-data+json`. `--verify` / `verifySignature: true` checks it
>   per object: absent is `unsigned` (not evidence of anything), a failure is
>   `unverified` (never "false"), and a difference between the payload and the
>   members served is surfaced as a `modified-after-signing` warning.
> * **Signature precedence is conditional on key trust** (the -07 security
>   revision). The signed payload's members take precedence over the members
>   served *only* when the verification key was pinned or supplied out of band
>   (`signaturePolicy.trustedKeys`); the result then reports
>   `precedence: "payload"`. When the key arrived in the JOSE Header it is
>   trusted no further than the declaration carrying it, so the **members served
>   by the origin remain the ones reported** (`precedence: "origin"`) and the
>   signature establishes integrity and key continuity only. A payload is also
>   rejected — the object left `unverified` — when it is not a valid
>   declaration (`payload-not-declaration`), when its `target` or
>   `reporting-period` differs from the object's
>   (`payload-subject-mismatch`), or when it carries a `signed` member of its
>   own (`payload-carries-signed`). A `signed` value of the wrong JSON type is
>   disregarded and reads as `unsigned`.
> * **No `version` member.** The media type identifies the format. Seven
>   mandatory members: `updated`, `capabilities`, `provider`,
>   `measurement-method`, `methodology-uri`, `reporting-period`, `target`.
> * **The base object is closed**, and extension data lives under `extensions`,
>   keyed by absolute URIs whose values are objects (never dereferenced, never
>   executed). The two forms the draft names are an `https` URI with a host,
>   which documents the members for a human, and `urn:uuid:` plus a lowercase
>   hyphenated UUID; a key is never fetched, not even the `https` one. An
>   unrecognized top-level member is still *ignored*, and reported as an
>   `unknown-member` warning.
> * **`upstream`** names the declarations a subject's figures derive from.
>   `--upstream` / `followUpstream: true` retrieves them (https only, depth 3 at
>   most, revisited URIs refused, **and a bounded total of 20 retrievals per
>   starting declaration** — `upstreamMaxRetrievals`, since `upstream` is an
>   array and depth alone permits an enormous fan-out). The arithmetic
>   comparison is defined only where the upstream publishes a **tenant-scoped**
>   declaration (`target-type: tenant`) about what it delivers to this subject;
>   any other upstream declaration is reported as fetched but `not-comparable`,
>   because "where an upstream publishes only its own totals rather than a
>   tenant-scoped declaration, no relation is defined at all". For a
>   tenant-scoped one, and for the same period after unit conversion, **a
>   subject cannot report a smaller `energy-consumption`, or a smaller
>   `carbon-footprint`, than the upstream states it delivered**: at least as
>   much is `consistent`, less is `under-reported`. Those two members are the
>   only ones compared — no other member takes part in a verdict. The verdicts
>   are `consistent`, `under-reported`, `not-comparable` and `unreachable` —
>   evidence about consistency between two self-asserted claims, never proof of
>   either. **A retrieved upstream declaration is read exactly as any other
>   declaration is**: the same tolerance pre-pass runs on it (§Value Constraints
>   and Omitted Metrics), so an upstream carrying an unrecognized enumerated
>   value, a wrong-JSON-typed optional member or a `sci-score` without
>   `functional-unit` is retrieved and compared with that member disregarded —
>   the members stripped are listed in `upstreamDisregarded` (and on the CLI
>   line) — rather than refused as `unreachable`. Tolerance stops where
>   readability does: an upstream that is not a declaration at all, or that
>   omits a mandatory member, is still `unreachable`, and `legacyCompat: false`
>   (`--strict`) turns the pre-pass off for the walk exactly as it does for the
>   fetch. Where a figure falls short, the consumer **disregards a shortfall no
>   larger than the rounding and unit conversion behind the two figures could
>   account for**, as the draft allows: a relative 1e-9, which covers the
>   floating-point error of a unit conversion and nothing wider, since a
>   consumer cannot know the precision each publisher rounded at and every
>   widening would forgive a real shortfall.
> * **The relation is loose in four ways, and the output says so.** (1) Whether
>   a subject's declared scope covers a given upstream is not expressible in
>   this format, so a subject that legitimately excludes one reads as
>   inconsistent: an `under-reported` verdict is **something to investigate,
>   not a failure to conform**, and every `under-reported` detail string says
>   that in plain words. (2) No member carries the share of a subject's figures
>   attributable to one upstream, so the converse — that the subject has not
>   claimed *more* than the upstream delivered — is not checked at all. (3)
>   **Each `upstream` entry is compared on its own**, one verdict per entry, and
>   the draft defines no relation over several together: a list of `consistent`
>   verdicts is a list of independent findings and never a statement about the
>   subject's upstreams as a whole (nothing here sums or averages them). (4)
>   Figures computed on different bases are not comparable, so
>   **`carbon-footprint` is compared only where both objects declare the same
>   `carbon-accounting` value, or neither declares one**. Where they differ, or
>   one declares a basis and the other does not, the carbon figures are left out
>   of the verdict — `carbonComparison: "skipped-different-accounting-basis"`,
>   with both bases named in `detail` — while the energy comparison still
>   proceeds; if that leaves nothing comparable the verdict is
>   `not-comparable`, and the detail says why. Both figures are still reported
>   in `subject`/`upstreamFigures`; only the verdict leaves carbon out. An
>   unrecognized `carbon-accounting` value is disregarded (§Value Constraints
>   and Omitted Metrics), so such an object counts as declaring no basis.
> * **A consumer checks it got what it asked for.** A server ignores a
>   parameter it does not support, so the `reporting-period` and `target` of
>   every object received are compared with what was requested; a mismatch is
>   reported in `notAsRequested` (and as a warning, and on the CLI as
>   `not as requested: …`), and such a response must not be recorded as
>   covering the period or subject requested.
> * **A redirect across origins is not silently re-attributed.** The
>   declaration is attributed to the final origin (`url`), and when that origin
>   differs from the one queried the result carries
>   `redirectedAcrossOrigins: { queried, final, attributable }` —
>   `attributable` is true only when every object's `target` names the origin
>   queried, which is the only case in which the declaration may be recorded
>   against it.
> * **Tolerance is for optional members.** A defective `capabilities` value —
>   unrecognized *or* of the wrong JSON type — is read as `basic`; a defective
>   value of any other mandatory member leaves the object non-conformant
>   (`status: "invalid"`). A body whose top-level value is neither an object
>   nor an array is reported plainly as not a declaration.
> * **Nil and Max UUIDs are rejected** as `extensions` keys
>   (`urn:uuid:00000000-…` / `urn:uuid:ffffffff-…`, RFC 9562 §§5.9, 5.10:
>   guaranteed collisions), as is a bare UUID, `com.example.pue`, an uppercase
>   scheme such as `HTTPS://…`, a key carrying a character RFC 3986 does not
>   allow in a URI (`" < > \ ^ ` { | }` or a space), or any other key that is
>   not an absolute URI.
> * **Media types are compared ignoring parameters**, everywhere: a response
>   typed `application/sustainability-data+json; charset=utf-8` is accepted, and
>   so is the equivalent `cty` spelling in a signature header.
> * **At least one figure or link.** An object with no numeric metric and
>   neither `disclosure-uri` nor `verifiable-attestation-uri` is non-conformant
>   and comes back as `invalid`.
> * **The consumer bounds the response**, since -07 removed the server-side
>   cap: `maxBytes` (10 MB) and `maxObjects` (500) are enforced here, the
>   latter as `status: "too-many-objects"`.
> * **Media typing is enforced.** `Accept: application/sustainability-data+json,
>   application/json;q=0.9`; a `200` carrying the registered type or the generic
>   `application/json` is processed, and **any other media type is refused
>   unread** (`status: "wrong-media-type"`) — the draft says such a response is
>   not a declaration.
> * **Attestation binds to the declaration**: the credential carries a copy of
>   the object (without `signed`) in its `credentialSubject`, and
>   `--verify-attestation` deep-compares that copy with the object served,
>   reporting `match`, `mismatch` (naming the members), or `no-copy`.
>
> Carried over unchanged: the unconditional **HTTPS MUST** (an `http://`
> origin, or an `http://` final URL after a redirect, is refused unless you opt
> out with `--allow-http` / `allowInsecure: true`), the `https`-only URI members
> (a non-`https` one is a warning, and `fetchDisclosure()` refuses to
> dereference it), and the draft's field-driven tolerance rules (out-of-range
> numerics, wrong-JSON-typed values including `null`, a reported `sci-score`
> without `functional-unit`, and unrecognized enumerated values all read as
> "not reported"/"disregarded", never as a rejection). A legacy 1.x document
> without `target` still gets its reporting subject from the historical
> `target-path` member's value when present, and from the origin host only when
> neither member exists; a received empty array reads as conveying no report.
> **0.5.0 fixed a CLI argument-parsing bug in 0.4.0** (`sustainability-fetch`
> read `argv[0]` as the origin, so an option given before the origin — or the
> bin-name token `npx <pkg> sustainability-fetch` passes through — crashed with
> a bare `Invalid URL`); see "Verify a live deployment" below. **0.5.2 adds
> path-prefixed base URLs**: `fetchSustainability` and the CLI accept a plain
> origin (well-known at the root, the RFC 8615 case), a base URL with a path
> prefix (`https://gateway.example/cloudflare.com` — the multi-subject
> gateway/mirror pattern, resolving the well-known path under the prefix), or
> the full declaration URL pasted as-is. The earlier published **0.1.0**
> implements the -02 (`"1.1"`) model.

## Install & build

**Node.js 22.12 or newer** is required (runtime and tests: the JOSE library is loaded as an ES module through `require()`, unflagged since 22.12; Vitest 5 needs 22.12 too).

```bash
cd consumer
npm install
npm run build      # tsc → dist/
npm test           # vitest: unit + fetch (static-file server) + interop (live publisher/) tests
```

Published: **[`sustainability-wellknown-consumer`](https://www.npmjs.com/package/sustainability-wellknown-consumer)**
(`npm install sustainability-wellknown-consumer`) — see [USAGE.md §6](USAGE.md#6-using-it-as-a-library)
for that and the git-checkout alternative.

## Quick start

```ts
import { fetchSustainability } from "sustainability-wellknown-consumer";

const result = await fetchSustainability("https://example.org");

switch (result.status) {
  case "ok":
    console.log(result.document); // schema-validated SustainabilityDocument
    break;
  case "not-found":
    console.log("origin has no sustainability document");
    break;
  case "invalid":
    console.error("fetched but failed validation:", result.errors);
    break;
  default:
    console.error(result.status);
}
```

One call, zero dependencies beyond the platform's native `fetch()`. See
[USAGE.md](USAGE.md) for the richer `SustainabilityClient` (ETag-cached polling),
the transformation helpers, disclosure-link handling, and the conformance checker.

## Exports

| Module | Exports |
|---|---|
| `types` | `SustainabilityMetrics`/`SustainabilityDocument`, `UpstreamEntry`, `FetchParams`, `FetchResult`, `SignatureResult`, `UpstreamComparison`, `EnergyUnit`, `CarbonUnit`, `TargetType` — wire-format types mirroring the -07 member set (seven mandatory members; no `version`) |
| `schema` | `RESPONSE_JTD_SCHEMA` — the JTD (RFC 8927) schema for a single declaration object, an exact embedded copy of `schemas-validators/response-schema.json`; the base object is closed, as -07 makes it |
| `media-type` | `MEDIA_TYPE` (`application/sustainability-data+json`), `LEGACY_MEDIA_TYPE` (`application/json`), `ACCEPTED_MEDIA_TYPES`, `ACCEPT_HEADER`, `classifyMediaType()` — the draft's media typing, in the one file a future rename would touch |
| `validate` | `validateDocument()`/`assertValid()`/`ValidationError`/`carriesAtLeastOne()`/`URI_MEMBERS`/`KNOWN_MEMBERS`/`METRIC_MEMBERS`/`isExtensionName`/`extensionNameError`/`isHttpsExtensionName`/`isUrnUuidExtensionName`/`RESERVED_EXTENSION_NAMES` — defensive validation of an incoming declaration: the JTD schema gate plus the prose rules the schemas cannot express (a top-level value that is neither an object nor an array, the at-least-one rule, `sci-score`⇒`functional-unit`, absolute-URI `extensions` keys with object values and neither the Nil nor the Max UUID, the at-least-one-entry rule on `upstream`, a numeric member carrying a value the format cannot express (`NaN`/±`Infinity`, which a `1e999` on the wire produces), and the cross-entry array rules). A non-`https` URI member — `methodology-uri`, `disclosure-uri`, `verifiable-attestation-uri` or an `upstream[].declaration` — is deliberately a WARNING rather than an error: the member is kept and the object stays valid, and the rule is enforced where it bites, at dereference time (`fetchDisclosure` and the upstream walk refuse such a URI outright). `result.warnings` carries those advisory findings (a non-`https` URI member, an `unknown-member`) and never changes `result.valid` |
| `jws` | `verifyJws()`, `verifyDeclarationJws()`, `algForKey()`, `DECLARATION_CTY`, `VC_JWT_MEDIA_TYPE` — JWS verification on top of [`jose`](https://github.com/panva/jose) with the draft's verifier policy (RFC 8725): the algorithm is determined by the key and the caller's policy, `none`/MACs and unknown `crit` are rejected, a `signed` member whose `cty` is not `sustainability-data+json` is rejected, a header `jwk` must be a public key and is ignored when the caller pins `trustedKeys`; every failure is a stable `reason`, never a throw |
| `signature` | `verifyEmbeddedSignature(object, policy)` — the `signed` member of one declaration object: `unsigned` / `verified` / `unverified`, the verified payload, `precedence` (`"payload"` only for a pinned/out-of-band key, `"origin"` for a key that arrived in the JOSE Header), and the members that differ when the object was changed after signing. A payload that is not a declaration, that describes another `target`/`reporting-period`, or that carries `signed` itself leaves the object unverified; a wrongly typed `signed` member reads as `unsigned` |
| `compare` | `deepEqual()`, `differingMembers()`, `withoutSigned()` — the structural comparison both the signature and the attestation binding use |
| `upstream` | `compareUpstream(subject, options)`, `MAX_UPSTREAM_DEPTH`, `DEFAULT_MAX_UPSTREAM_RETRIEVALS` — the bounded upstream walk: https only, depth 3 at most, revisited URIs refused, a total-retrieval budget shared by every level, one verdict per upstream entry (each compared on its own; no relation is defined over several together); every retrieved declaration is read with the same tolerance pre-pass the fetch path applies (`applyToleranceRules`, reported per entry in `upstreamDisregarded`; `legacyCompat: false` turns it off for the walk too), so a defective value is disregarded rather than making the upstream `unreachable`; the arithmetic comparison applies only to a tenant-scoped upstream declaration, covers `energy-consumption` and `carbon-footprint` only, compares `carbon-footprint` only on a shared `carbon-accounting` basis (`carbonComparison` records a skip), and disregards a shortfall no larger than rounding and unit conversion could account for (relative 1e-9) |
| `attestation` | `verifyAttestation(uri, options)` (explicit; never automatic), `verifyCredentialJwt()`, `checkCredentialShape()`, `checkBinding()`, `declarationCopyOf()`, `VC_V2_CONTEXT` — a W3C Verifiable Credential 2.0 secured as `vc+jwt`: HTTPS only, signature + VC shape + validity window, `assurance: "issuer-key-pinned" \| "self-asserted-key"`, and the -07 binding — the copy of the declaration the credential carries, deep-compared with the object served (`match` / `mismatch` / `no-copy`) |
| `text` | `isolate()` — Unicode bidi isolation (FSI…PDI) for document-derived text in human-readable output |
| `transport` | `isBlockedAddress()`, `systemAddressLookup`, and the `AddressLookup` / `SecureGetOptions` / `TransportRefusal` types — the one path every fetch in this package takes: HTTPS checked on each hop before it is requested, redirects followed by hand under a bound, bodies read under a streaming byte cap, and the §Consumer Considerations address check (a host that is, or resolves to, a loopback/private/link-local/unique-local/unspecified address is refused unrequested, as is a URI carrying userinfo). The resolver is injectable, so nothing here needs live DNS |
| `fetch` | `fetchSustainability(origin, options)` — the one-call fetch-and-validate function. `verifySignature: true` verifies each object's `signed` member and reports one `SignatureResult` per object in `signatures`; `followUpstream: true` walks the `upstream` chain and reports one verdict per upstream in `upstream`. It sends the draft's `Accept` header and refuses any other media type unread (`wrong-media-type`), enforces its own `maxBytes`/`maxObjects` bounds (`too-many-objects`), reports the response's media type as `mediaType` (compared ignoring parameters) and the final URL as `url` (redirects are followed by hand, every hop must be HTTPS, and a redirect to another origin is reported as `redirectedAcrossOrigins` rather than silently re-attributed), compares the `reporting-period`/`target` of every object received with what was requested (`notAsRequested`), and refuses a non-HTTPS retrieval (`insecure-transport`) unless `allowInsecure: true`, or a URI it declines to dereference at all (`refused-uri`, for a host that resolves to a private address or a URI carrying userinfo — `lookup` pins the resolver, `allowPrivateAddresses` opts out). Its `legacyCompat` option (default true) derives a missing `target` from the legacy `target-path` value (origin host only when neither exists), disregards (strips + records in `disregarded`) wrong-JSON-typed optional members, a reported `sci-score` without `functional-unit`, and unrecognized values of the enumerated members (a unit member takes the numerics it parameterizes with it), and returns the distinct `no-report` status for a 200 empty array. `WELL_KNOWN_PATH`, `resolveWellKnownUrl()` and the `DEFAULT_TIMEOUT_MS` / `DEFAULT_MAX_BYTES` / `DEFAULT_MAX_OBJECTS` bounds are exported alongside it |
| `client` | `SustainabilityClient` — a class for repeated polling, with ETag-based conditional-request caching (threads `legacyCompat` through) |
| `sentinel` | `isNotReported()`, `withoutSentinels()`, `NUMERIC_KEYS`, `NUMERIC_MEMBERS`, `TARGET_TYPES`, `isRecognizedTargetType()`, `isWrongJsonType()`, `isNonFiniteNumber()`, `legacyReportingSubject()`, `OPTIONAL_MEMBER_JSON_TYPES`, `applyToleranceRules()` (the one pre-pass both the fetch path and the upstream walk apply, so a retrieved declaration is read exactly as any other) — the legacy-compatibility/tolerance module: a negative value in a non-negative member reads as "not reported" (subsumes the historical 1.x sentinel — negative scopes are real data and are never stripped), a wrong-JSON-typed value (including `null`) in a defined optional member reads as "not reported", an unrecognized value in an enumerated member (`ENUMERATED_MEMBERS`: `capabilities`, the two unit members, `carbon-accounting`, `target-type`) reads as "disregard the member", and a numeric member carrying `NaN` or ±`Infinity` — which a `1e999` on the wire produces — reads as "not reported", since no member can carry one and it would re-serialize as `null` (`isNonFiniteNumber()`, `NUMERIC_MEMBERS`) (draft §Value Constraints and Omitted Metrics), and `legacyReportingSubject()` resolves a 1.x document's subject from `target-path` (origin host as the fallback) |
| `units` | `convertEnergy()`, `convertCarbon()` — unit conversion, matching `publisher/src/normalize.ts`'s tables exactly (parity-tested) |
| `transform` | `toCsvRows()`, `toNdjson()`, `flatten()`, `aggregate()` — format transformations for a validated document |
| `disclosure` | `resolveDisclosureLinks()` (passive), `fetchDisclosure()` (explicit opt-in, and refuses any non-`https` URI before making a request) — disclosure/attestation link helpers |
| `conformance` | `runConformanceChecks()` — a conformance-check battery for any origin, usable standalone or via the CLI's `--strict`; each check carries a three-valued `outcome` (`"pass"`/`"fail"`/`"warn"`) alongside the original `pass` boolean. `ConformanceOptions.now` injects the clock the Extended granularity check reads (the only thing in the battery that reads one), so a run is reproducible |
| `cli` | `runCli()` — argument parsing and dispatch for `bin/sustainability-fetch.js` |

All of the above are re-exported from the package root (`src/index.ts`), with two
exceptions: `runCli()`, which `bin/sustainability-fetch.js` loads from
`dist/cli.js` directly, and `applyToleranceRules()`/`ENUMERATED_MEMBERS`, which
the fetch path and the upstream walk share internally — `fetchSustainability`
applies them for you and reports what they disregarded.

## CLI usage

```bash
sustainability-fetch <origin> [--target=/path] [--period=2026-02] [--granularity=monthly] \
  [--format=json|csv|ndjson] [--strict] [--etag=<cached-etag>] [--allow-http] \
  [--verify] [--upstream] [--verify-attestation[=<issuer JWK url or file>]]
```

Options may appear before or after the origin. A bare hostname is promoted to
`https://`. The `<origin>` argument accepts three shapes (since 0.5.2): a plain
origin (`https://example.org` — the well-known path is resolved at the root, the
ordinary RFC 8615 case), a base URL with a path prefix
(`https://gateway.example/cloudflare.com` — the multi-subject gateway/mirror
pattern; the well-known path is resolved *under* the prefix), or the full
document URL pasted as-is. `--strict` runs the conformance battery and prints
one line per check, tagged with the strength of the requirement it tests: a
failed `MUST` prints `FAIL` and exits non-zero, while an unmet `SHOULD` prints
`WARN` and does not — an origin whose static host cannot emit an `Allow` header
on a 405, for instance, is still conformant.

An `http://` origin is **refused** with a one-line message and exit
code `2`: the draft makes HTTPS unconditional and says clients MUST NOT accept a
document retrieved over unauthenticated HTTP. Pass `--allow-http` to override it
against a local development server or in CI (`sustainability-fetch
http://127.0.0.1:8080 --strict --allow-http`); there is deliberately no
automatic loopback exemption. A bare hostname is still promoted to `https://`,
and an `https` origin that redirects to plain HTTP is refused mid-flight.

```bash
# Fetch and print as JSON (default):
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org

# Pipe-friendly CSV, for ingestion elsewhere:
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org --format=csv

# Conformance-check a target origin (any implementation, not just this repo's):
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org --strict

# Also verify the OPTIONAL `signed` member, walk the upstream chain, and check
# the linked attestation:
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org --verify --upstream --verify-attestation
```

`--verify` verifies the OPTIONAL `signed` member of each declaration object —
a JWS whose payload is that object without `signed` — and prints one line per
object on stderr: `signature: verified EdDSA kid=…`, `signature: unsigned …`
or `signature: unverified (<reason>) …`. It never changes the declaration's own
outcome, as the draft requires (absent is not evidence; failed means
*unverified*, never *false*). Each line also says which members the output
carries: with a key pinned by the caller the payload's members take precedence,
and with a key that arrived in the signature's own header the members served by
the origin are the ones reported. A difference between the two is printed as a
`modified-after-signing` warning either way.

`--upstream` retrieves the declarations named by the `upstream` member — https
only, depth 3 at most, revisited URIs refused, a bounded total of retrievals —
and prints one verdict per upstream, each entry compared on its own:
`consistent`, `under-reported`, `not-comparable` or `unreachable`, with both
sets of figures. A subject cannot report a smaller `energy-consumption`, or a
smaller `carbon-footprint`, than a tenant-scoped upstream states it delivered
for the same period: reporting at least as much is `consistent`, reporting less
is `under-reported`. Those two members are the only ones compared, and
`carbon-footprint` only where both objects declare the same `carbon-accounting`
value or neither declares one — otherwise the carbon figures are left out of the
verdict, the line says so and names both bases, and the energy comparison still
proceeds (if nothing is left to compare the verdict is `not-comparable`). An
upstream declaration that is not tenant-scoped is printed as fetched but
`not-comparable`, since the draft defines no relation for it. A retrieved
upstream is read exactly as any other declaration — the same tolerance rules
apply, so one carrying a defective value (an unrecognized enumerated value, for
instance) is compared with that member disregarded and the line names what was
disregarded, while one that is not a declaration at all, or that omits a
mandatory member, is still `unreachable`. A shortfall no larger than the
rounding and unit conversion behind the two figures could account for is
disregarded, as the draft allows. **That comparison
is evidence about consistency between two self-asserted claims, never proof of
either**, and `under-reported` is something to investigate rather than a failure
to conform — a subject may legitimately exclude an upstream from its declared
scope, which this format cannot express. The CLI says both things on its last
two upstream lines, and adds that no relation is defined over several entries
together.

`--verify-attestation` dereferences the declaration's
`verifiable-attestation-uri` — explicitly, never automatically — verifies it as
a W3C Verifiable Credential (Data Model 2.0) secured as `vc+jwt`, and compares
the copy of the declaration the credential carries with the object served
(`match`, `mismatch` naming the members, or `no-copy`). Give it the issuer's
public JWK (an `https` URL or a file) to pin the issuer key, otherwise the key
in the credential's header is used and the result is reported as self-asserted.
Under `--strict` the signature is part of the battery, and an invalid
attestation sets exit code 1. Human-readable output isolates declaration text
with Unicode FSI/PDI, per the draft's Internationalization Considerations;
JSON/CSV/NDJSON output carries the data unchanged.

Non-zero exit code on any HTTP error, validation failure, or (for `--strict`) any
conformance check failure — directly scriptable in cron/CI (`&&`/`set -e`). See
[USAGE.md](USAGE.md) for the full flag reference and worked examples.

## Verify a live deployment

The four checks that should pass before citing a `/.well-known/sustainability-data`
URL to anyone — the exact battery used to verify
`https://andreibesleaga.com/.well-known/sustainability-data`, this repository's
reference deployment:

```bash
# 1. correct media type (application/sustainability-data+json) + CORS + caching
curl -sI https://example.org/.well-known/sustainability-data | grep -Ei 'HTTP/|content-type|cache-control|access-control'

# 2. valid JSON, correct content
curl -s https://example.org/.well-known/sustainability-data | python3 -m json.tool

# 3. full conformance battery (works against ANY implementation, not just this repo's)
npx -y -p sustainability-wellknown-consumer sustainability-fetch https://example.org --strict

# 4. any linked methodology/disclosure pages actually resolve
curl -sI https://example.org/sustainability-methodology.html | head -1
```

Expected `--strict` output for a fully conformant origin — every `MUST` PASS,
`SHOULD`s advisory:

```
PASS  [MUST] Basic request returns a schema-valid single object
PASS  [MUST] Basic 200 response uses the application/sustainability-data+json media type
PASS  [MUST] Embedded signature (OPTIONAL `signed` member): absent, or present and verifiable — not signed (optional)
PASS  [SHOULD] Response carries an ETag
PASS  [SHOULD] Conditional GET with a fresh ETag returns 304
PASS  [SHOULD] A method other than GET/HEAD gets 405 with Allow
PASS  [MUST] Extended granularity request returns a valid response (sorted array when honored)
```

A `WARN` line (not `FAIL`) is normal and does not affect the exit code. It means
one of two things:

* **an unmet `SHOULD`** — a recommendation the origin did not follow, not
  non-conformance. The most common one in practice is the 405-with-`Allow`
  check on static hosting (Cloudflare Pages, GitHub Pages, S3): these platforms
  return `405` to a non-GET/HEAD request but cannot be configured to add an
  `Allow` header, and the draft states that requirement as a `SHOULD` for
  exactly this reason;
* **an advisory finding** — the media-type check against a publisher still
  serving the generic type:

```
WARN  [MUST] Basic 200 response uses the application/sustainability-data+json media type — generic media type (application/json): processed, but a conformant 200 response carries application/sustainability-data+json
```

That line says the origin publishes a declaration the draft still has consumers
process, under the generic type rather than the registered one. It is reported
rather than failed on purpose (see "Media types and tolerance" below), so
`report.allPassed` stays true and the CLI still exits `0`. Programmatically, `check.outcome` is `"pass" | "fail" | "warn"`; the
original `check.pass` boolean is still there and is exactly
`outcome === "pass"`, so a `warn` reads as "not a pass" without being counted
as a failure by `allPassed` (`allPassedIncludingRecommended` does drop, just as
an unmet `SHOULD` drops it).

> **Hardening notes.** The body is read with a byte cap and an object cap
> (`maxBytes`, `maxObjects` — -07 removed the server-side cap and tells the
> consumer to impose its own) and parsed with `JSON.parse`, whose documented
> behaviour keeps the *last* value of a duplicated member name; that behaviour
> is applied consistently, which is the alternative the draft permits to
> rejecting such a document. The upstream and attestation fetches carry the same
> timeouts and byte caps, and the upstream walk is bounded in depth and refuses
> a URI it has already retrieved, so a chain of declarations cannot be used for
> amplification.
>
> **Requires consumer 0.5.0 or later.** In 0.4.0, `sustainability-fetch` read
> `argv[0]` as the origin, so both `--strict <origin>` and
> `<origin> --strict` — and the bin-name token `npx <pkg> sustainability-fetch`
> passes through as an argument — could land a flag or the literal string
> `"sustainability-fetch"` in `new URL()` and crash with a bare `Invalid URL`,
> failing every check regardless of the endpoint's actual conformance. Since
> 0.5.0, options are accepted before or after the origin, a leading bin-name
> token is dropped, a bare hostname is promoted to `https://`, and an unusable
> origin prints a clear message and exits `2` instead of throwing.

## Media types and tolerance

0.7.0 is a **-07 client**, and the few places it is lenient are the places the
draft itself is:

* **Both media types are processed.** Every fetch sends
  `Accept: application/sustainability-data+json, application/json;q=0.9`. A
  `200` carrying the registered type is a declaration; one carrying the generic
  `application/json` is processed too (the draft's MAY, for declarations
  published before the type was registered), and `result.mediaType` says which.
  **Any other media type is refused unread** — `status: "wrong-media-type"` —
  because the draft says such a response is not a declaration.
* **The battery warns rather than fails** on `application/json`, and will keep
  doing so until the RFC publishes and IANA has registered the dedicated media
  type. There is no strict flag: the `WARN` line is the whole message.
* **An unrecognized top-level member is ignored, not rejected.** The base
  object is closed in -07, so such a member should not be there — but a later
  revision may define one, so it is kept, reported as an `unknown-member`
  warning, and otherwise ignored.
* **`legacyCompat` tolerance is a courtesy beyond the spec** — deriving a
  missing `target` from a 1.x `target-path`, disregarding wrong-typed optional
  members, reading an empty array as "no report". It is not required of a
  conformant consumer and it is scheduled for removal near RFC publication; do
  not build on it. `legacyCompat: false` turns it off today.
* **A non-`https` URI member is a warning, not a rejection** (`result.warnings`,
  and `validateDocument().warnings`): the member is kept and the declaration
  stays valid. The rule bites where it matters — `fetchDisclosure()` and the
  upstream walk refuse to dereference such a URI at all.
* **Signature verification is never automatic.** The `signed` member is
  OPTIONAL and is checked only on request (`--verify`, `verifySignature`, and
  the battery's signature check). Verifying one proves integrity and key
  continuity — not identity, unless the key is already known out of band, and
  never accuracy.

The one place the draft is enforced without compromise is transport: an
`http://` origin is refused (`--allow-http` / `allowInsecure: true` to
override), because that requirement is what lets a declaration be attributed to
the origin that served it at all. Alongside it, and on every hop of every fetch
this package makes, a URI whose host is — or resolves to — a loopback, private
(RFC 1918), link-local, unique-local or unspecified address is refused before
the request is sent (`{ status: "refused-uri", reason: "blocked-address" }`),
as is any URI carrying userinfo: every URI dereferenced here came out of a
document some other origin wrote, and §Consumer Considerations asks a consumer
not to let that turn it into a probe for its own network. The resolver is
injectable (`lookup`), the check is opt-out-able for a deployment that means to
reach its own network (`allowPrivateAddresses`, which `allowInsecure` already
implies), and `isBlockedAddress()` is exported for callers applying the same
rule to a URI of their own.

## Conformance

`test/schema.test.ts` asserts the embedded JTD schema (`src/schema.ts`) is
byte-identical to `../schemas-validators/response-schema.json` — the same
canonical repo schema `publisher/`'s own copy is checked against — so drift across
all three copies is caught in CI. `test/fetch.test.ts` fetches and validates every
file in `../example-responses/*.json` via a local static-file server, and
`test/interop.test.ts` performs a live, in-process round trip against a real
`Publisher` instance from `publisher/`, exercising conditional GET, both response
shapes, and 404 handling end-to-end — see
[`.github/workflows/consumer.yml`](../.github/workflows/consumer.yml).

> Note on extensibility (-07): data the draft does not define goes in the
> `extensions` member, an object whose member names are absolute URIs (RFC 3986,
> Section 4.3, written in ASCII with the scheme in lowercase, restricted to the
> characters RFC 3986 allows and carrying no fragment) and whose values
> are objects: an `https` URI with a host, which
> should identify human-readable documentation of the members, or `urn:uuid:`
> plus a lowercase hyphenated UUID (RFC 9562), the Nil and Max UUIDs excluded. A
> key is a namespace identifier, not a locator: this package never fetches one —
> the `https` form included — and never dereferences or executes anything inside
> a value; it is
> carried through as data. The top-level member set is closed, but a member this
> revision does not define is still ignored rather than rejected, and reported
> as an `unknown-member` warning; `SustainabilityMetrics` carries an index
> signature so such a member round-trips through
> `validateDocument()`/`toNdjson()` untouched instead of being stripped.

## License

BSD-3-Clause. Part of the `rfc-sustainability-wellknown` repository.
