# Requirements, use cases and rule keys of the behaviour suite

Generated from the design of the software for draft-besleaga-sustainability-wellknown-10; do not edit by hand.

How the tags of `features/*.feature` resolve:

- `@REQ-<AREA>-<nn>`: a requirement of this file (section 1). One verifiable statement each.
- `@req-xxxxxxxx`: a normative sentence of the draft, by the id `traceability/extract.mjs` computes (`traceability/requirements.json`); `npm run trace` fails when a sentence has no scenario.
- `@UC-x.y`: a use case (section 2).
- `@rk-<key>`: a rule key (section 3); the example corpus (`schemas-validators/examples/manifest.json`, field `rk`) uses the same keys.
- `@golden`, `@error`, `@edge`: the path the draft describes, a refusal or report, a boundary.

## 1. Requirements

#### URI - Location and transport (Section 2.1)

#### REQ-URI-01 (Ubiquitous, Section 2.1)

- **EARS.** The publisher shall serve the declaration at the path /.well-known/sustainability-data of the origin it publishes for, and at no other well-known suffix.
- **Draft (Section 2.1).** "The declaration is published at the path /.well-known/sustainability-data on the origin"
- **Implemented by.** publisher: src/handler.ts WELL_KNOWN_PATH; src/server.ts; src/middleware/express.ts, fastify.ts; gateway: src/app.ts route; src/adapters/self-report.ts; kits: every deploy/static, deploy/proxies, deploy/frameworks and server-configurations recipe serves exactly this path
- **Verified by.** UT: publisher/test/server.test.ts; gateway/test/routes.test.ts; fitness/http-invariants.test.mjs; deploy/e2e/run.sh. BDD: @REQ-URI-01 (g: GET the path returns 200; e: GET /.well-known/sustainability.json returns 404; x: trailing slash and query string on the same path). SCH: -.

#### REQ-URI-02 (Ubiquitous, Section 2.1)

- **EARS.** The publisher shall send Content-Type application/sustainability-data+json, with no media type parameter, on every 200 OK response that carries a declaration.
- **Draft (Section 2.1).** "with the media type application/sustainability-data+json; this document registers both (Section 7)"
- **Implemented by.** publisher: src/media-type.ts MEDIA_TYPE; src/handler.ts; gateway: src/media-type.ts; src/app.ts; kits: static recipes map the extensionless path to this Content-Type (Netlify _headers, Cloudflare Pages _headers, S3 object metadata, nginx types, Apache AddType)
- **Verified by.** UT: publisher/test/server.test.ts; gateway/test/media-type.test.ts; deploy/e2e/run.sh (header check per kit). BDD: @REQ-URI-02 (g: header equals the registered type; e: no charset parameter; x: HEAD request, 304 response keeps the header). SCH: -.

#### REQ-URI-03 (group heading, Section 2.1)

One draft sentence [req-7faa5bea] holds two verifiable statements; the requirements are REQ-URI-03a (the URLs the publisher derives) and REQ-URI-03b (the deployment kits).

#### REQ-URI-03a (Ubiquitous, Section 2.1)

- **EARS.** The publisher shall be deployed behind HTTPS only: every URL it derives for itself shall use the https scheme.
- **Draft (Section 2.1).** "A declaration MUST be published and retrieved over HTTPS." [req-7faa5bea]
- **Implemented by.** publisher: src/handler.ts (scheme default "https" for derived URLs); README/USAGE state that TLS terminates in front of the Node server; gateway: Railway edge terminates TLS; src/config.ts public base URL is https
- **Verified by.** UT: publisher/test/server.test.ts (derived URLs are https). BDD: @REQ-URI-03a (g: derived URLs begin with https://; e: a configured public base URL with http:// is refused; x: X-Forwarded-Proto handling). SCH: -.

#### REQ-URI-03b (Ubiquitous, Section 2.1)

- **EARS.** Every deployment kit shall redirect or refuse plain HTTP for the well-known path.
- **Draft (Section 2.1).** "A declaration MUST be published and retrieved over HTTPS." [req-7faa5bea]
- **Implemented by.** kits: deploy/proxies/* (HTTP to HTTPS redirect, HSTS), deploy/static/* (HTTPS-only hosts), deploy/frameworks/*
- **Verified by.** UT: deploy/e2e/run.sh (HTTP request is redirected or refused). BDD: @REQ-URI-03b (g: a plain HTTP request to the kit is redirected to https or refused; e: kit config without redirect fails the kit check; x: a kit that redirects to an http:// URL fails the kit check). SCH: -.

#### REQ-URI-04 (Unwanted behaviour, Section 2.1)

- **EARS.** If the retrieval URI, or the target of any redirect, is not an https URI, then the consumer shall not retrieve the declaration and shall return status insecure-transport; only a caller that sets allowInsecure (CLI --allow-http) may retrieve over http, for loopback testing.
- **Draft (Section 2.1).** "A declaration MUST be published and retrieved over HTTPS." [req-7faa5bea]
- **Implemented by.** consumer: src/transport.ts hopRefusal, secureGet; src/fetch.ts (status insecure-transport); tools: sustainability-fetch --allow-http is the only override; GitHub Action and deploy/e2e never pass it for a remote origin
- **Verified by.** UT: consumer/test/transport.test.ts; consumer/test/fetch.test.ts. BDD: @REQ-URI-04 (g: https origin retrieved; e: http origin refused; x: https origin redirecting to http refused, http to https redirect from a loopback test server allowed only with allowInsecure). SCH: -.

#### REQ-URI-05 (Event-driven, Section 2.1)

- **EARS.** When a 200 OK response carries Content-Type application/sustainability-data+json (parameters ignored, type compared case-insensitively), the consumer shall process the body as a declaration.
- **Draft (Section 2.1).** "A consumer MAY also process a 200 OK response whose Content-Type is application/json as a declaration"
- **Implemented by.** consumer: src/media-type.ts classifyMediaType; src/fetch.ts; gateway: src/validate.ts (check of any origin)
- **Verified by.** UT: consumer/test/fetch.test.ts; consumer/test/media-type cases in fetch.test.ts. BDD: @REQ-URI-05 (g: registered type accepted; x: type with ;charset=utf-8, upper-case type name; e: a type that only resembles it (application/sustainability-data+jsonx) is not processed as a declaration). SCH: -.

#### REQ-URI-06 (Optional feature, Section 2.1)

- **EARS.** Where the 200 OK response carries Content-Type application/json, the consumer shall process the body as a declaration, and shall report that the registered type was not used.
- **Draft (Section 2.1).** "A consumer MAY also process a 200 OK response whose Content-Type is application/json as a declaration" [req-3b435062]
- **Implemented by.** consumer: src/media-type.ts (legacy class); src/fetch.ts warnings; gateway: src/validate.ts reports the legacy type as a note; tools: sustainability-fetch --conformance reports it as a warning, not a failure
- **Verified by.** UT: consumer/test/fetch.test.ts. BDD: @REQ-URI-06 (g: application/json accepted with a note; x: application/json;charset=utf-8; e: application/json carrying a body that is not JSON returns status invalid). SCH: -.

#### REQ-URI-07 (Unwanted behaviour, Section 2.1)

- **EARS.** If a 200 OK response carries any media type other than the two above, or none, then the consumer shall not parse the body and shall return status wrong-media-type.
- **Draft (Section 2.1).** "a response carrying any other media type is not a declaration" [req-3b435062]
- **Implemented by.** consumer: src/fetch.ts (wrong-media-type, body not read); gateway: src/validate.ts
- **Verified by.** UT: consumer/test/fetch.test.ts. BDD: @REQ-URI-07 (e: text/html, application/vc+jwt, text/plain, missing header; x: application/jsonp, application/json-seq; g: the registered type and application/json are not refused by this rule). SCH: -.

#### REQ-URI-08 (Ubiquitous, Section 2.1)

- **EARS.** The publisher shall leave access control, cache lifetime and the other HTTP header fields to the operator's configuration and shall implement validators and conditional requests as RFC 9110 and RFC 9111 define them (ETag, If-None-Match, 304).
- **Draft (Section 2.1).** "Access control, caching, and every other aspect of the HTTP exchange are as [RFC9110] and [RFC9111] define them and are the publisher's to configure."
- **Implemented by.** publisher: src/handler.ts (HandlerOptions maxAge, cors, ifNoneMatchMatches); consumer: src/fetch.ts sends If-None-Match when given a validator and returns not-modified on 304; gateway: src/http.ts; src/app.ts; kits: deploy/proxies/* and deploy/static/* expose Cache-Control and ETag settings with a documented default
- **Verified by.** UT: publisher/test/server.test.ts; consumer/test/fetch.test.ts. BDD: @REQ-URI-08 (g: If-None-Match with the current ETag returns 304; e: stale ETag returns 200; x: weak validator form W/"..."). SCH: -.

#### QRY - Query parameters (Section 2.2)

#### REQ-QRY-01 (Optional feature, Section 2.2)

- **EARS.** Where a publisher supports a query parameter among target, start, end and granularity, it shall honor it as REQ-QRY-03 to REQ-QRY-16 define; a publisher that honors at least one shall publish capabilities extended (REQ-MND-03).
- **Draft (Section 2.2).** "A server MAY support the query parameters target, start, end, and granularity" [req-227b9272]
- **Implemented by.** publisher: src/publisher.ts honor(); src/handler.ts parseQuery; src/selection.ts; gateway: src/app.ts query routing (same selection module); kits: example-scripts/request-handler.py, security.{js,php,py} apply the same four parameters
- **Verified by.** UT: publisher/test/selection.test.ts (new); publisher/test/server.test.ts; gateway/test/self-extended.test.ts. BDD: @REQ-QRY-01 (g: an extended publisher honors each of the four; x: a publisher that honors only target; e: a publisher that honors a parameter but publishes capabilities basic fails the conformance check). SCH: -.

#### REQ-QRY-02 (State-driven, Section 2.2)

- **EARS.** While a publisher does not honor a parameter (Basic adapter, static file, unsupported name), the publisher shall ignore that parameter and answer 200 with the same body it sends without it.
- **Draft (Section 2.2).** "A server that does not support a parameter ignores it and answers the rest of the request; a static file therefore satisfies every request."
- **Implemented by.** publisher: src/publisher.ts honor() (basic adapter honors nothing); src/handler.ts; gateway: src/app.ts (unknown parameters ignored); kits: all deploy/static and deploy/proxies recipes serve the file for any query string (no 400, no 404, no cache key split that returns a different body)
- **Verified by.** UT: publisher/test/server.test.ts; gateway/test/routes.test.ts; deploy/e2e/run.sh (request with ?start=...&target=x). BDD: @REQ-QRY-02 (g: Basic publisher with ?start=1999-... returns its file; x: unknown parameter name ?foo=1 on an extended publisher is ignored; e: a parameter honored elsewhere (target on a Basic adapter) is ignored without 400 or 404). SCH: -.

#### REQ-QRY-03 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall accept as the value of start or end only a utc-date-time: full-date, upper-case T, partial-time, upper-case Z (no offset, no date-only, no lower-case, no space), checked by the ABNF form and then by calendar validity; a second of 60 (23:59:60Z) is treated as not matching.
- **Draft (Section 2.2).** "start = %s"start=" utc-date-time end = %s"end=" utc-date-time"
- **Implemented by.** publisher: src/period.ts UTC_DATE_TIME_RE, isUtcDateTime, dateTimeError; src/handler.ts parseQuery; consumer: src/period.ts (byte-identical copy) used to build and to check request values; gateway: same functions (imported from the publisher package)
- **Verified by.** UT: publisher/test/period.test.ts (table: 2025-01-01T00:00:00Z ok; .000Z ok; 2025-01-01 no; ...T00:00:00z no; ...T00:00:00+00:00 no; 2025-02-30T00:00:00Z no; 2025-13-01T00:00:00Z no; 24:00:00Z no; 2016-12-31T23:59:60Z no). BDD: @REQ-QRY-03 (g: valid UTC range honored; e: each malformed form ignored (REQ-QRY-07); x: fractional seconds .5Z honored; 23:59:60Z ignored, since Temporal would read it as 23:59:59, another value). SCH: ABNF checked on https://author-tools.ietf.org/abnf.

#### REQ-QRY-04 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall accept as the value of granularity exactly yearly, monthly or daily, compared case-sensitively.
- **Draft (Section 2.2).** "granularity = %s"granularity=" granularity-value granularity-value = %s"yearly" / %s"monthly" / %s"daily""
- **Implemented by.** publisher: src/tokens.ts or src/selection.ts GRANULARITIES; src/handler.ts; gateway: same
- **Verified by.** UT: publisher/test/selection.test.ts (new): Monthly, MONTHLY, weekly, hourly, empty value, monthly%20 are not granularity values. BDD: @REQ-QRY-04 (g: each of the three values; e: Monthly ignored; x: percent-encoded monthly (%6Dnthly) decodes to a valid value and is honored). SCH: -.

#### REQ-QRY-05 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall match the parameter names target, start, end and granularity case-sensitively, so that Start=, GRANULARITY= and similar are unknown parameters.
- **Draft (Section 2.2).** "defined by this ABNF [RFC5234], with the case-sensitive strings of [RFC7405]"
- **Implemented by.** publisher: src/handler.ts queryFromSearchParams / parseQuery; gateway: src/app.ts
- **Verified by.** UT: publisher/test/server.test.ts. BDD: @REQ-QRY-05 (e: ?Start=2025-01-01T00:00:00Z is ignored and the full set is returned; x: a repeated name; g: ?start=2025-01-01T00:00:00Z in the exact case is honored). SCH: -.

#### REQ-QRY-06 (Event-driven, Section 2.2)

- **EARS.** When the consumer or any client tool builds a request with a start or end, it shall convert the bound to UTC and write it with the offset Z, so that no character of the value needs percent-encoding; the consumer (0.8.2) also reads a calendar date, month or year as the UTC date-times it stands for (start its first instant, end the first instant after it), and refuses what the wire cannot carry (a leap second, an instant outside years 0000 to 9999).
- **Draft (Section 2.2).** "so the "+" of a positive offset, which form decoding turns into a space, cannot occur; a client converts other offsets first."
- **Implemented by.** consumer: src/period.ts toUtcQueryValue; src/fetch.ts queryBound, used by fetchSustainability, src/client.ts and src/cli.ts (any RFC 3339 input, or a calendar date, month or year, written as UTC Z); gateway: src/index-page.ts links; src/examples.ts request builders; tools: tools/create-sustainability-data and tools/report-to-declaration helpers that print a request; kits: deploy/one-click/railway/server.mjs (SD_START, SD_END), deploy/home-assistant, WordPress plugin, example-scripts
- **Verified by.** UT: consumer/test/period-parity.test.ts; consumer/test/fetch.test.ts (+08:00 input becomes ...Z in the request; dates, months and years; leap second and out-of-range refusals); consumer/test/cli.test.ts (--start=2025-01 --end=2025-03); gateway/test/routes.test.ts. BDD: @REQ-QRY-06 (g: a client holding 2026-03-01T00:00:00+08:00 sends 2026-02-28T16:00:00Z; g: a calendar date, month or year is sent as the UTC date-times it stands for; x: a bound with fractional seconds, a bound before 1970; e: an input that is neither a date-time nor a real calendar date is refused before any request is made). SCH: -.

#### REQ-QRY-07 (Unwanted behaviour, Section 2.2)

- **EARS.** If a start, end or granularity value does not match the ABNF, then the publisher shall ignore that parameter alone, answer 200 as for a request without it, and shall not answer 400 or 404 and shall not repair, truncate, round, clamp, re-case or offset-convert the value into another value.
- **Draft (Section 2.2).** "A server that honors start, end, or granularity and receives a value not matching the ABNF ignores the parameter and never reads it as another value."
- **Implemented by.** publisher: src/handler.ts parseQuery returns { query, ignored }; badRequestResult removed; src/selection.ts; gateway: src/app.ts uses the same parseQuery and selection (one policy); kits: example-scripts/request-handler.py, security.{js,php,py} parse with the host language's RFC 3339 library, not Date.parse
- **Verified by.** UT: publisher/test/selection.test.ts (new); publisher/test/server.test.ts; gateway/test/routes.test.ts; example-scripts/test_request_handler.py. BDD: @REQ-QRY-07 (e: date-only start=2025-01-01, offset start=2025-01-01T00:00:00%2B01:00, space from a decoded plus, lower-case z, 2025-02-30, granularity=Monthly: each answers as if the parameter were absent; x: one valid and one malformed parameter together, only the malformed one is dropped; the date-only value is never read as midnight; the -08 parameter ?period=2025 is an unknown name and is ignored; g: valid start, end and granularity are all honored). SCH: -.

#### REQ-QRY-08 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall read the target parameter, after percent-decoding, as a target member value and shall accept a path-prefix value that begins with "/".
- **Draft (Section 2.2).** "The value of the target parameter is a target member value (Section 3.2); a path prefix begins with "/"."
- **Implemented by.** publisher: src/handler.ts; src/selection.ts; gateway: src/app.ts
- **Verified by.** UT: publisher/test/selection.test.ts (new). BDD: @REQ-QRY-08 (g: ?target=/api/v1 and ?target=%2Fapi%2Fv1 select the same object; x: ?target=example.com and ?target=EXAMPLE.COM select the same host target (REQ-TGT-04); e: ?target=api/v1 (no leading slash) matches no path-prefix object and returns []). SCH: -.

#### REQ-QRY-09 (Event-driven, Section 2.2)

- **EARS.** When the publisher honors at least one parameter of a request, it shall answer 200 with a JSON array that holds exactly the objects it holds that satisfy every parameter it honors, and no others.
- **Draft (Section 2.2).** "A server that supports these parameters returns the objects it holds that satisfy every parameter it honors, as a JSON array"
- **Implemented by.** publisher: src/selection.ts selectDeclarations; src/publisher.ts build(); gateway: src/app.ts; src/adapters/self-report.ts (held set: whole days of the last 120 days, plus all whole months and years since go-live)
- **Verified by.** UT: publisher/test/selection.test.ts (new); gateway/test/self-extended.test.ts. BDD: @REQ-QRY-09 (g: a range returns the months inside it as an array; x: a single matching object is still wrapped in an array; e: a range that matches nothing returns [] (REQ-QRY-11), not 404). SCH: -.

#### REQ-QRY-10 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall order a selected array by ascending period.start compared as instants, whatever the offsets written, breaking ties by period.end, then by target in code point order, and keeping the held order for objects equal in all three.
- **Draft (Section 2.2).** "in ascending order of period.start, compared as instants"
- **Implemented by.** publisher: src/period.ts comparePeriodStart; src/selection.ts; consumer: consumer reports unordered arrays as a note (order is a server rule, not a body rule); gateway: same
- **Verified by.** UT: publisher/test/period.test.ts; publisher/test/selection.test.ts (new). BDD: @REQ-QRY-10 (g: months arrive in order; x: a +08:00 object and a Z object whose written strings sort the opposite way to their instants; equal starts are ordered by end, then target; objects equal in all three keep the held order; e: an array served in descending order, when a range was requested, is noted as not ascending and stays usable). SCH: -.

#### REQ-QRY-11 (Event-driven, Section 2.2)

- **EARS.** When no object held satisfies the honored parameters, the publisher shall answer 200 with the empty array [] and shall not answer 404.
- **Draft (Section 2.2).** "when none does, the array is empty."
- **Implemented by.** publisher: src/selection.ts; src/publisher.ts (NotFoundError only when no parameter is honored and nothing is held, see ); consumer: src/validate.ts: [] is a valid body; src/fetch.ts returns status ok with an empty document and the CLI prints [] (exit 0); gateway: src/app.ts
- **Verified by.** UT: publisher/test/selection.test.ts (new); consumer/test/validate.test.ts; consumer/test/fetch.test.ts; gateway/test/routes.test.ts. BDD: @REQ-QRY-11 (g: a range with no data returns [] ; x: [] followed by followUpstream does not crash (consumer verifier #4); e: a range with no data never answers 404 or 204). SCH: [] validates under CDDL and JTD (validate-all.sh).

#### REQ-QRY-12 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall select an object for a start and end only when period.start is strictly before end and period.end is strictly after start, compared as instants, so that an object that merely meets the range at one instant is not selected.
- **Draft (Section 2.2).** "An object satisfies start and end when its period overlaps the range they bound: its period.start is before end and its period.end after start, as instants"
- **Implemented by.** publisher: src/period.ts overlapsRange; src/selection.ts; gateway: same
- **Verified by.** UT: publisher/test/period.test.ts (table of overlap and meet cases). BDD: @REQ-QRY-12 (g: a month inside the range is selected; x: an object ending exactly at start is not selected; an object starting exactly at end is not selected; a +08:00 object overlapping by one hour is selected; e: an object that lies wholly outside the range is not selected). SCH: -.

#### REQ-QRY-13 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall treat an absent, or ignored, start as no lower bound and an absent, or ignored, end as no upper bound.
- **Draft (Section 2.2).** "an absent bound is unbounded."
- **Implemented by.** publisher: src/period.ts overlapsRange(p, { start?, end? }); gateway: same
- **Verified by.** UT: publisher/test/period.test.ts; publisher/test/selection.test.ts (new). BDD: @REQ-QRY-13 (g: only start; only end; x: start given and end malformed gives an open upper bound; e: end earlier than start is evaluated as written (REQ-QRY-12), not as an unbounded range). SCH: -.

#### REQ-QRY-14 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall select an object for a target parameter only when the object's target member equals the value as REQ-TGT-02 and REQ-TGT-04 define, and shall not match by prefix.
- **Draft (Section 2.2).** "It satisfies target when its target member equals the value, compared as Section 3.2 says"
- **Implemented by.** publisher: src/selection.ts; src/publisher.ts (matchTargetPrefix and the longest-prefix rule removed); gateway: src/app.ts
- **Verified by.** UT: publisher/test/selection.test.ts (new). BDD: @REQ-QRY-14 (g: ?target=/api/v1 returns the second object of Section 4.3 alone; e: ?target=/api returns []; x: ?target=/api/v1/ (trailing slash) returns []). SCH: -.

#### REQ-QRY-15 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall select an object for granularity yearly, monthly or daily only when its period is a whole calendar year, month or day respectively as REQ-PER-05 defines.
- **Draft (Section 2.2).** "and granularity when its period is a whole calendar year, month, or day, for yearly, monthly, or daily respectively (Section 3.2)."
- **Implemented by.** publisher: src/period.ts isWholeCalendarPeriod / wholeCalendarUnit; src/selection.ts; gateway: same
- **Verified by.** UT: publisher/test/period.test.ts (table: 2025 year; 2024-02 month of 29 days; DST month 2025-03-01T00:00:00+01:00 to 2025-04-01T00:00:00+02:00; Samoa December 2011; two whole months are not a month). BDD: @REQ-QRY-15 (g: granularity=monthly returns only the whole months; e: a 28-day period is in no granularity; x: monthly request when only a year is held returns []). SCH: -.

#### REQ-QRY-16 (Ubiquitous, Section 2.2)

- **EARS.** The publisher shall return each selected object member for member as it holds it, shall not sum, average, merge, split or re-period objects, and shall leave an object's signed member valid.
- **Draft (Section 2.2).** "A server returns what it holds, as it holds it, and computes no aggregate."
- **Implemented by.** publisher: src/selection.ts (pure filter and sort); the aggregation engine (UnservableAggregateError and its subclasses, aggregatePeriod, selectPeriod) is deleted; gateway: src/app.ts; src/adapters/self-report.ts holds its days, months and years itself and never sums on request
- **Verified by.** UT: publisher/test/selection.test.ts (new): deep-equal of selected objects to held objects; signature of a selected object still verifies; publisher/test/draft-10-revision.test.ts. BDD: @REQ-QRY-16 (g: a year query with months held returns the months, not a sum (Section 4.2: without granularity the year object is returned too, if held); x: an object signed offline stays verified after selection; e: a handler that would sum two months into a year is not built; no aggregate is ever served). SCH: -.

#### REQ-QRY-17 (group heading, Section 2.2)

One draft sentence [req-d2b6ec62] holds two verifiable statements: REQ-QRY-17a (compare) and REQ-QRY-17b (report per parameter).

#### REQ-QRY-17a (Event-driven, Section 2.2)

- **EARS.** When the consumer receives a response to a request that carried target, start, end or granularity, it shall compare the period and target of every object it receives with what it requested.
- **Draft (Section 2.2).** "Because a server may ignore any parameter, a consumer MUST compare the period and target of every object it receives with what it requested" [req-d2b6ec62]
- **Implemented by.** consumer: src/fetch.ts honoured-query check; src/period.ts overlapsRange, isWholeCalendarPeriod; src/client.ts; gateway: src/validate.ts conformance of a third-party origin runs the same comparison
- **Verified by.** UT: consumer/test/fetch.test.ts; consumer/test/conformance.test.ts. BDD: @REQ-QRY-17a (g: every object returned by an extended origin is compared with the request; e: an object outside the requested range is found by the comparison; x: an empty array is compared as honoring a range). SCH: -.

#### REQ-QRY-17b (Event-driven, Section 2.2)

- **EARS.** When the comparison of REQ-QRY-17a has run, the consumer shall report, per parameter, whether the response honored it.
- **Draft (Section 2.2).** "Because a server may ignore any parameter" [req-d2b6ec62]
- **Implemented by.** consumer: src/fetch.ts FetchResult.honored; gateway: src/validate.ts reports the same result for a third-party origin; tools: sustainability-fetch prints the comparison; --conformance extended check (src/conformance.ts)
- **Verified by.** UT: consumer/test/fetch.test.ts; consumer/test/conformance.test.ts. BDD: @REQ-QRY-17b (g: an extended origin honors all four; e: a Basic origin ignoring ?start=1999 is reported as not honored; x: target ignored, granularity ignored while start honored, empty array honors a range). SCH: -.

#### REQ-QRY-18 (Unwanted behaviour, Section 2.2)

- **EARS.** If an object's period does not overlap the requested range, or its target differs from the requested target, or its period is not a whole unit of the requested granularity, then the consumer shall not record that response as covering the requested period or target, and shall record the period and target the objects name.
- **Draft (Section 2.2).** "and MUST NOT record a response as covering a period or a target it does not name." [req-d2b6ec62]
- **Implemented by.** consumer: src/fetch.ts (FetchResult.covers built from the objects, never from the request); src/transform.ts flatten/total use the object's period; gateway: src/verify.ts, src/validate.ts record what the origin named; tools: sustainability-fetch CSV/NDJSON export carries period.start, period.end, target of each object, not the request
- **Verified by.** UT: consumer/test/fetch.test.ts; consumer/test/transform.test.ts. BDD: @REQ-QRY-18 (e: a 2026 object returned for a 1999 request is recorded as 2026; the /api/v1 object returned for target=/other is recorded as /api/v1; x: partial overlap records the object's own period, not the requested one; g: objects that match the request are recorded with their own period and target, which equal the request). SCH: -.

#### REQ-QRY-19 (Event-driven, Section 2.2)

- **EARS.** When an extended publisher receives a request in which no parameter is honored (none sent, or every one ignored), it shall answer 200 with the representation its operator configured: by default the held objects as a JSON array in ascending order of period.start; a publisher configured for a single current object (the reference gateway for its own report, the one-click kit) answers that object.
- **Draft (Section 2.2).** "A server that supports these parameters returns the objects it holds that satisfy every parameter it honors, as a JSON array in ascending order of period.start"
- **Implemented by.** publisher: src/selection.ts (the same sort when nothing is honored); src/publisher.ts (representation option: array by default, single object on request); gateway: src/app.ts (its own report stays a single object); kits: deploy/one-click/railway/server.mjs (single object)
- **Verified by.** UT: publisher/test/selection.test.ts (new); gateway/test/self-extended.test.ts; gateway/test/routes.test.ts. BDD: @REQ-QRY-19 (g: a bare GET to an extended publisher holding three months returns the three as an array in ascending order; e: ?start=%&&&=&=x (every parameter ignored) returns the same array as a bare GET; x: the reference gateway answers its own report as one object, and equal period.start values are ordered by period.end, then target). SCH: -.

#### PRT - Partial answers (Section 2.3)

#### REQ-PRT-01 (Ubiquitous, Section 2.3)

- **EARS.** The publisher shall emit an object only for a target and period for which the operator supplied figures, and shall not synthesise figures for periods or targets without them.
- **Draft (Section 2.3).** "A publisher declares the target it can measure or estimate, for the periods it has figures for."
- **Implemented by.** publisher: src/normalize.ts; adapters return only what they hold; gateway: src/adapters/self-report.ts, src/adapters/demo-specs.ts; tools: tools/create-sustainability-data, tools/report-to-declaration emit nothing for an empty source
- **Verified by.** UT: publisher/test/adapters.test.ts; publisher/test/csv-slurm.test.ts. BDD: @REQ-PRT-01 (g: an adapter with two months emits two objects; x: an empty CSV emits no object; e: a month with no figures yields no object, and no zero is written in its place). SCH: -.

#### REQ-PRT-02 (Ubiquitous, Section 2.3)

- **EARS.** The publisher, the consumer and both schemas shall accept an object that carries the seven mandatory members and exactly one metric member.
- **Draft (Section 2.3).** "Every metric member is optional, so an object carrying one measured quantity conforms"
- **Implemented by.** publisher: src/validate.ts; src/schema.ts; consumer: src/validate.ts; src/schema.ts; tools: schemas-validators/response-schema.cddl and response-schema.json
- **Verified by.** UT: publisher/test/schema.test.ts; consumer/test/schema.test.ts; consumer/test/validate.test.ts. BDD: @REQ-PRT-02 (g: only energy-consumption; only renewable-energy; only carbon-footprint; e: an object with the seven mandatory members and no metric and no link is invalid (REQ-MIN-01); x: the same object with a second metric member still conforms). SCH: V17 (solo-metric-members: one metric member per object).

#### REQ-PRT-03 (Optional feature, Section 2.3)

- **EARS.** Where a figure rests partly on estimation, the publisher tools shall ask for, and the templates shall carry, a methodology-uri whose document states what is measured and what is estimated.
- **Draft (Section 2.3).** "a figure may rest partly on estimation if the methodology document says what is measured and what is estimated."
- **Implemented by.** tools: tools/create-sustainability-data prompt and template; tools/report-to-declaration; gateway/METHODOLOGY.md pattern; kits: deploy/FIGURES.md and the methodology template in every kit README
- **Verified by.** UT: tools/create-sustainability-data/test/create.test.mjs. BDD: @REQ-PRT-03 (g: the generated declaration has a methodology-uri; x: a relative methodology-uri is kept relative; e: a declaration built from an estimate with no methodology-uri is refused by the tool). SCH: -.

#### REQ-PRT-04 (Ubiquitous, Section 2.3)

- **EARS.** The publisher shall write in target and period exactly what the figures cover, shall publish an in-progress period only with period.end not after updated (the warning for a period that ends after updated is REQ-PER-08's).
- **Draft (Section 2.3).** "An object's period and target say what it covers; figures covering part of a target or part of a period MUST NOT be presented as though they covered the whole." [req-23c17076]
- **Implemented by.** publisher: src/normalize.ts (the warning updated-before-period-end belongs to REQ-PER-08); src/util.ts lastFullMonthPeriod(now) (clock passed in); gateway: src/adapters/self-report.ts publishes completed months and years only; tools: tools/report-to-declaration refuses a calendar-year period for a source that covers fewer months, unless told so
- **Verified by.** UT: publisher/test/normalize.test.ts; gateway/test/self-extended.test.ts. BDD: @REQ-PRT-04 (g: last completed month published; e: 20 days of data labelled as the whole month raises the REQ-PER-08 warning; x: period.end equal to updated is accepted). SCH: -.

#### REQ-PRT-05 (Unwanted behaviour, Section 2.3)

- **EARS.** If selected objects leave a gap inside the range they span, then the consumer shall not present their total as covering the whole range; it shall return coverage "gaps" and the periods covered.
- **Draft (Section 2.3).** "figures covering part of a target or part of a period MUST NOT be presented as though they covered the whole." [req-23c17076]
- **Implemented by.** consumer: src/transform.ts total() coverage "contiguous" | "gaps"; src/cli.ts output; gateway: src/index-page.ts and /validate present each object with its own period
- **Verified by.** UT: consumer/test/transform.test.ts. BDD: @REQ-PRT-05 (g: twelve contiguous months give coverage contiguous; e: eleven months give gaps; x: months in two offsets that still meet are contiguous). SCH: -.

#### BDY - Body (Section 3.1)

#### REQ-BDY-01 (Ubiquitous, Section 3.1)

- **EARS.** The publisher shall emit a single JSON text, encoded in UTF-8 without a byte order mark, whose value is one declaration object or one array of declaration objects.
- **Draft (Section 3.1).** "The body is a single JSON text ([RFC8259], Section 2), encoded in UTF-8 ([RFC8259], Section 8.1), whose value is one declaration object or one JSON array of them."
- **Implemented by.** publisher: src/handler.ts serialization; src/publisher.ts; gateway: src/http.ts; tools: tools write the same form (create-sustainability-data, report-to-declaration, sustainability-sign output)
- **Verified by.** UT: publisher/test/server.test.ts; gateway/test/routes.test.ts. BDD: @REQ-BDY-01 (g: body parses and is an object or an array of objects; x: no BOM; non-ASCII provider is UTF-8, not escaped differently; e: a body that starts with a byte order mark, or is UTF-16, fails the byte-level test). SCH: all ex/ files.

#### REQ-BDY-02 (Unwanted behaviour, Section 3.1)

- **EARS.** If the body is not valid UTF-8 JSON, or its value is neither an object nor an array whose elements are all objects, then the consumer shall return status invalid with the reason.
- **Draft (Section 3.1).** "whose value is one declaration object or one JSON array of them."
- **Implemented by.** consumer: src/fetch.ts parse step; src/validate.ts; gateway: src/validate.ts
- **Verified by.** UT: consumer/test/validate.test.ts; consumer/test/fetch.test.ts. BDD: @REQ-BDY-02 (e: body "x", 12, null, [1,2], [[{}]], an array with one non-object element, invalid UTF-8 bytes, a leading BOM decision (accepted and noted); g: an object and an array of objects are accepted; x: [] is a valid body; an array of one object is valid). SCH: I45, I46, I47, I48 (root string, number, null; array with a non-object element).

#### REQ-BDY-03 (Ubiquitous, Section 3.1)

- **EARS.** The publisher shall be able to emit, and the consumer, the validators and the gateway shall accept, an array whose objects differ in period and target, overlap each other, or stand in any order.
- **Draft (Section 3.1).** "The objects of an array may cover different periods and targets of the same origin [...] an organization's yearly figures beside its months, or an origin beside the services and paths it measures separately (Section 5.2)."
- **Implemented by.** publisher: src/validate.ts (no uniformity, ordering or overlap rule on arrays); consumer: src/validate.ts (array rules of -08 and -09 removed); gateway: src/validate.ts; tools: validators accept arrays of mixed targets (Section 4.3 is one)
- **Verified by.** UT: consumer/test/validate.test.ts (array block rewritten); publisher/test/draft-10-revision.test.ts. BDD: @REQ-BDY-03 (g: Section 4.3 origin plus path array accepted; x: a year beside its months, unsorted array, two objects with identical period and target but different carbon-accounting; e: an array in which one element is invalid is invalid, and the error names the element). SCH: example-3.json (Section 4.3), example-2.json (Section 4.2).

#### REQ-BDY-04 (Ubiquitous, Section 3.1)

- **EARS.** The publisher shall emit one object for each carbon-accounting value and one object for each functional-unit when figures for the same target and period differ in those members, and shall not put two values of either member in one object.
- **Draft (Section 3.1).** "Figures that differ only in their accounting method or functional unit are separate objects for the same target and period: one object each for location- based and market-based scope 2 emissions [GHG-SCOPE2], and one object per functional-unit of a Software Carbon Intensity (SCI) score."
- **Implemented by.** publisher: src/normalize.ts (a RawMetrics carries one accounting value and one unit); adapters split by accounting and by unit; consumer: src/validate.ts accepts twins; src/transform.ts total() treats twins with different accounting as not summable (REQ-TOT-03); gateway: src/adapters/sfc-ledger-bridge.ts emits location-based and market-based as separate objects; tools: tools/report-to-declaration emits twins; sfc-compliance 2.0.0
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts; gateway/test/adapters-sfc-ledger.test.ts. BDD: @REQ-BDY-04 (g: location-based and market-based scope 2 as two objects; per-request and per-user scores as two objects; x: twins are not reported as duplicates; e: one object that holds two carbon-accounting values (an array in the member) is invalid). SCH: the example corpus: accounting-pair.example (array of 2) and functional-units.example (array of 12).

#### REQ-BDY-05 (Ubiquitous, Section 3.1)

- **EARS.** The consumer shall accept a single declaration object and a one-object array and shall produce the same result for both.
- **Draft (Section 3.1).** "A single object is equivalent to a one-object array, and a consumer MUST accept both forms." [req-d243887d]
- **Implemented by.** consumer: src/validate.ts; src/fetch.ts normalises to an array internally; src/transform.ts; gateway: src/validate.ts and src/verify.ts accept both; tools: schemas-validators CDDL root is object / [* object]; sustainability-fetch prints identically
- **Verified by.** UT: consumer/test/fetch.test.ts; consumer/test/validate.test.ts. BDD: @REQ-BDY-05 (g: same fetch result for {obj} and [obj]; x: signature verification of the one-object array; e: a one-element array holding a non-object is invalid like the bare non-object). SCH: example-0.json as object and as one-object array (V07).

#### REQ-BDY-06 (Ubiquitous, Section 3.1)

- **EARS.** The publisher shall emit I-JSON: UTF-8, no duplicate member names, every number within IEEE 754 binary64 magnitude and precision, no unpaired surrogate in a string, and updated, start and end with upper-case T and Z.
- **Draft (Section 3.1).** "Publishers follow I-JSON [RFC7493]. [...] the last three of which a conforming publisher does not emit (Section 3.1)."
- **Implemented by.** publisher: src/normalize.ts and src/validate.ts (finite numbers, String.prototype.isWellFormed on every string); src/json.ts strict reading of input files; src/period.ts upper-case gate; gateway: src/registry.ts round-trip gate over gateway/data; tools: sustainability-publisher upgrade --check and sustainability-sign refuse an input with a literal beyond binary64 precision or a lone surrogate
- **Verified by.** UT: publisher/test/normalize.test.ts; publisher/test/hardening.test.ts; publisher/test/draft-10-revision.test.ts. BDD: @REQ-BDY-06 (e: a value of 1e400, a 9007199254740993 literal in an input file, a string with a lone surrogate are refused; x: 0.1+0.2 style values serialise to the shortest round-trip form; g: an ordinary document of finite numbers within binary64 and Z timestamps passes the I-JSON gate). SCH: -.

#### REQ-BDY-07 (Unwanted behaviour, Section 3.1)

- **EARS.** If an adapter, a data file or an operator supplies a top-level member that the document does not define (the 26 members of Sections 3.2 and 3.3), then the publisher gate shall refuse to emit the object, naming the member and pointing to extensions; the consumer ignores such a member (REQ-BDY-08) and the schemas accept it (REQ-FRM-03, 04 prose set).
- **Draft (Section 3.1).** "A publisher MUST NOT add a top-level member this document does not define; other data goes in extensions (Section 3.4)." [req-9201dff3]
- **Implemented by.** publisher: src/validate.ts and src/normalize.ts (assertDefinedMembers, new: the schema itself stays open, see REQ-FRM-03); gateway: src/registry.ts load gate for gateway/data/*.json; src/examples.ts; tools: sustainability-publisher upgrade moves nothing silently: -08 reporting-period and unknown members are reported
- **Verified by.** UT: publisher/test/normalize.test.ts; publisher/test/draft-10-revision.test.ts; gateway/test/registry.test.ts. BDD: @REQ-BDY-07 (e: reporting-period, version, language, foo each refuse with the member named; g: the same data under extensions is accepted; x: a member with a -08 name (reporting-period) is refused with the member named, pointing to period and extensions). SCH: V23 (the same data under extensions is accepted); the refusal belongs to the publisher gate, so no schema case.

#### REQ-BDY-08 (Unwanted behaviour, Section 3.1)

- **EARS.** If an object carries a top-level member the consumer does not recognise, then the consumer shall ignore it and shall not change the validity, the status or the exit code because of it.
- **Draft (Section 3.1).** "A consumer ignores a top-level member it does not recognize and MUST NOT treat its presence as an error ([RFC7493], Section 4.2)" [req-4f13e73d]
- **Implemented by.** consumer: src/validate.ts KNOWN_MEMBERS (informational note at most); src/schema.ts (JTD additionalProperties true); gateway: src/validate.ts; tools: CDDL ends with * tstr => any; JTD additionalProperties true; check-live.py
- **Verified by.** UT: consumer/test/validate.test.ts; consumer/test/schema.test.ts; gateway/test/validate.test.ts. BDD: @REQ-BDY-08 (g: an object with member "x-future" validates; x: unknown member in period, in an upstream entry, and in the signed payload; e: a known member with a wrong type (period as a string) is still invalid; only unknown names are ignored). SCH: V08 (unknown members at top level, in period and in an upstream entry).

#### REQ-BDY-09 (Ubiquitous, Section 3.1)

- **EARS.** The publisher shall not emit a version member and the consumer shall not select behaviour from any version-like member; the format is identified by the media type alone.
- **Draft (Section 3.1).** "this document defines no version member, since the media type identifies the format." [req-4f13e73d]
- **Implemented by.** publisher: src/validate.ts (version is an undefined member, REQ-BDY-07); consumer: src/validate.ts, src/sentinel.ts (-08 and -09 are recognised by member shape, never by a version member)
- **Verified by.** UT: consumer/test/sentinel.test.ts; publisher/test/draft-10-revision.test.ts. BDD: @REQ-BDY-09 (e: a declaration with "version": 2 is read exactly as without it; g: a declaration without a version member is valid; x: a -09 document is recognised by the shape of its period, never by a version member). SCH: -.

#### REQ-BDY-10 (Ubiquitous, Section 3.1)

- **EARS.** Every component shall compare the strings this document compares (target, extension names, tokens, granularity values, signature-payload members) with strict equality of the JSON-decoded values, with no case folding and no Unicode normalization, except for host names (REQ-TGT-04).
- **Draft (Section 3.1).** "Where this document compares strings, they are equal when they are the same sequence of Unicode characters once JSON escapes are decoded ([RFC8259], Section 8.3; [RFC7493], Section 2.3), with no case folding or normalization unless this document says otherwise."
- **Implemented by.** publisher: src/selection.ts, src/tokens.ts guards, src/normalize.ts (the NFC pass applies to provider only, never to target or extension names); consumer: src/signature.ts, src/upstream.ts, src/validate.ts (=== on parsed values); gateway: src/app.ts, src/registry.ts
- **Verified by.** UT: publisher/test/selection.test.ts; consumer/test/signature.test.ts; consumer/test/validate.test.ts. BDD: @REQ-BDY-10 (g: "\u0065xample.com" equals example.com; e: precomposed e-acute is not equal to e + combining acute; x: Turkish dotless i and Kelvin sign do not fold). SCH: -.

#### MND - Mandatory members (Section 3.2)

#### REQ-MND-01 (Ubiquitous, Sections 3.2 and 1)

- **EARS.** The publisher shall emit, and the consumer and both schemas shall require, the seven mandatory members updated, capabilities, provider, measurement-method, methodology-uri, period and target in every declaration object.
- **Draft (Sections 3.2 and 1).** "A small conformant declaration carries the seven mandatory members and at least one metric or evidence link"
- **Implemented by.** publisher: src/validate.ts; src/schema.ts (JTD properties); consumer: src/validate.ts; src/schema.ts; gateway: src/validate.ts; tools: CDDL sustainability-metrics mandatory block; validator-json.py
- **Verified by.** UT: publisher/test/schema.test.ts; consumer/test/schema.test.ts; consumer/test/validate.test.ts (one test per missing member). BDD: @REQ-MND-01 (e: each of the seven omitted in turn gives invalid and names the member; x: a null value for a mandatory member; g: the Introduction object, with all seven mandatory members, validates). SCH: example-0.json (the Introduction) valid; I38 to I44 (one mandatory member omitted each).

#### REQ-MND-02 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall write updated as an RFC 3339 date-time with upper-case T and Z, set from an injectable clock; the consumer, the publisher gate and the CDDL shall reject a value that does not match the date-time form, and the consumer and the publisher gate shall also reject a form-valid value that names no real date and time (the CDDL accepts it; 04 prose set).
- **Draft (Section 3.2).** "The [RFC3339] date-time at which the object was last updated, with T and Z in upper case, as [RFC3339], Section 5.6, allows and [RFC7493], Section 4.3, recommends."
- **Implemented by.** publisher: src/period.ts DATE_TIME_RE / dateTimeError; src/util.ts nowDateTime (the only wall-clock read in src/); consumer: src/validate.ts updatedErrors (new: updated was validated nowhere); tools: CDDL date-time = tstr .regexp (dt-head .cat dt-tail); JTD timestamp plus the code gate (JTD timestamp alone accepts lower case); a second of 60 is read as 59 with the note leap-second-read-as-59 and is never emitted
- **Verified by.** UT: publisher/test/period.test.ts; consumer/test/validate.test.ts. BDD: @REQ-MND-02 (g: updated with Z, with +01:00, with fractional seconds; e: date-only, lower-case t, lower-case z, space separator, no seconds, +0100 without colon, 2026-02-30T00:00:00Z; x: 23:59:60Z is accepted, read as 23:59:59 and noted with leap-second-read-as-59). SCH: neg-updated-date-only.json, neg-updated-lowercase-z.json, neg-space-separator.json, neg-no-seconds.json, neg-offset-without-colon.json, pos-fractional-seconds.json, pos-negative-offset.json, neg-leading-garbage-anchoring.json, neg-trailing-garbage-anchoring.json.

#### REQ-MND-03 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall set capabilities to basic when it honors no query parameter and to extended when it honors at least one, and the consumer shall take which parameters were honored from the response and not from capabilities.
- **Draft (Section 3.2).** ""basic" when the server supports no query parameter, "extended" when it supports at least one; which parameters it honored is seen in the response (Section 2.2)."
- **Implemented by.** publisher: src/publisher.ts (derives capabilities from honor()); adapters declare basic or extended; consumer: src/fetch.ts honored check (REQ-QRY-17b); capabilities is informational; gateway: src/adapters/self-report.ts publishes extended
- **Verified by.** UT: publisher/test/server.test.ts; consumer/test/fetch.test.ts. BDD: @REQ-MND-03 (g: Basic adapter publishes basic; extended adapter publishes extended; e: a value other than the two (Extended, full) is invalid; x: an extended object returned by a server that ignored the query is reported as not honoring). SCH: all-* cases use basic; example-2.json uses extended.

#### REQ-MND-04 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall accept provider as a non-empty string in any script, and the consumer shall treat it as display text: isolated from surrounding text with Unicode bidirectional isolates and stripped of control characters on output.
- **Draft (Section 3.2).** "Human-readable identification of the publisher in any script, such as a name and a role contact address"
- **Implemented by.** publisher: src/normalize.ts (non-empty string; NFC as library practice since 0.7.3); consumer: src/text.ts isolate (FSI to PDI); src/cli.ts output escaping; gateway: src/index-page.ts HTML-escapes and isolates
- **Verified by.** UT: consumer/test/text.test.ts; publisher/test/normalize.test.ts; gateway/test/legal.test.ts. BDD: @REQ-MND-04 (g: provider in Arabic, Han, Cyrillic round-trips unchanged in meaning; e: empty provider invalid; x: right-to-left override in provider is isolated, an ESC byte is not printed raw). SCH: V21 (Cyrillic and Japanese provider).

#### REQ-MND-05 (Optional feature, Section 3.2)

- **EARS.** Where the operator states a language, the publisher shall send it in the Content-Language header field of the response and shall not add a language member to the object.
- **Draft (Section 3.2).** "a publisher that states its language does so with the Content-Language header field ([RFC9110], Section 8.5), which applies to the whole response."
- **Implemented by.** publisher: src/handler.ts HandlerOptions.contentLanguage; gateway: src/http.ts (error bodies carry Content-Language already)
- **Verified by.** UT: publisher/test/server.test.ts; gateway/test/routes.test.ts. BDD: @REQ-MND-05 (g: header present when configured, absent when not; e: a language member is refused (REQ-BDY-07); x: a language configured as an empty string sends no header). SCH: -.

#### REQ-MND-06 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall accept methodology-uri as a URI reference, relative or absolute, and the consumer shall resolve it as REQ-URF-02 defines and shall not retrieve it as part of retrieval, validation or verification.
- **Draft (Section 3.2).** "A URI reference (Section 3.3.1) to a document for people, in any format and language [...] Nothing a consumer does under this document depends on reading it."
- **Implemented by.** publisher: src/validate.ts (URI reference syntax, no scheme restriction); consumer: src/validate.ts uriMemberWarnings; nothing in fetch.ts, signature.ts or upstream.ts depends on the methodology document
- **Verified by.** UT: consumer/test/validate.test.ts; consumer/test/fetch.test.ts (no request to the methodology URI). BDD: @REQ-MND-06 (g: relative /sustainability/methodology accepted; e: a value with a space warns; x: a methodology link to a host that is down does not change the result). SCH: example-0.json (relative reference).

#### REQ-MND-07 (Ubiquitous, Section 3.2)

- **EARS.** The deployment kits and the gateway shall ship a methodology template that states what is measured and estimated, the allocation to a part of a target, what counts as one functional-unit, the extension names used, and whether and how much perturbation was applied.
- **Draft (Section 3.2).** "describes the method well enough to interpret the figures: what is measured and what is estimated, how figures are allocated to a part of a target, what counts as one functional-unit, which extension names are used, and whether perturbation was applied (Section 6.1)."
- **Implemented by.** gateway: gateway/METHODOLOGY.md and the page served at its methodology-uri; tools: tools/create-sustainability-data writes a methodology stub with the five headings; kits: deploy/FIGURES.md; methodology template in deploy/static/*, deploy/one-click, deploy/wordpress, deploy/home-assistant
- **Verified by.** UT: tools/create-sustainability-data/test/create.test.mjs; fitness/repository-invariants.test.mjs (each kit template has the five headings). BDD: @REQ-MND-07 (g: the stub lists extension names found in the declaration; x: noise on lists the bound (REQ-PRV-06); e: a kit template without one of the five headings fails the fitness test). SCH: -.

#### MTH - measurement-method (Section 3.2)

#### REQ-MTH-01 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall emit measurement-method as exactly one of hardware-metered, hardware-estimated, cloud-billing, third-party-modeled (case-sensitive), and shall refuse any other value; the consumer and both schemas shall reject any other value as served.
- **Draft (Section 3.2).** "as one of four tokens, from the most to the least direct:"
- **Implemented by.** publisher: src/tokens.ts MEASUREMENT_METHODS, isMeasurementMethod; src/normalize.ts throws naming the four tokens and the upgrade command; src/adapters/csv.ts skips the row with the reason; consumer: src/tokens.ts (byte-identical copy); src/validate.ts; src/schema.ts JTD enum; gateway: src/adapters/sfc-ledger-bridge.ts, src/adapters/demo-specs.ts; src/registry.ts rejects data files with another value; tools: CDDL enum; validator-cddl.py and validator-json.py on different libraries; sustainability-publisher upgrade
- **Verified by.** UT: publisher/test/tokens.test.ts (new, parity with JTD and CDDL); consumer/test/tokens-parity.test.ts (new); publisher/test/normalize.test.ts; consumer/test/schema.test.ts; fitness/repository-invariants.test.mjs. BDD: @REQ-MTH-01 (g: Outline over the four tokens; e: Hardware-Metered, metered, spend-based, free text, a number; x: the compatibility reading of REQ-CMP-03). SCH: pos-method-{hardware-metered,hardware-estimated,cloud-billing,third-party-modeled}.json, all-mm-*.json (4), neg-method-case-variant.json, neg-method-free-text.json, neg-method-token-not-in-set.json, neg-mm-spend-based.json.

#### REQ-MTH-02 (Ubiquitous, Section 3.2)

- **EARS.** Each adapter, tool and data file shall use the token whose definition its data source meets, and its documentation shall say which: meters and bills give hardware-metered; counters with a model give hardware-estimated; a provider's report to its customer gives cloud-billing; models, assumptions, activity data and anything else give third-party-modeled.
- **Draft (Section 3.2).** "hardware-metered: read from meters or power instruments on the target's equipment or energy supply, utility bills and fuel delivery records included; [...] hardware-estimated: allocated to the target from energy or power counters on its hardware, with a model where the counters do not reach; [...] cloud-billing: taken from what a hosting, cloud, content delivery, or network provider reports to its customer, for example in a tenant declaration (Section 3.5); [...] third-party-modeled: computed with a model, the publisher's own or one with published coefficients, from assumed values or from activity such as power draw, utilization, traffic, or spend; also any figure that no other token describes."
- **Implemented by.** publisher: src/adapters/*: kepler-prometheus, computed, slurm-sacct default hardware-estimated; co2js, climatiq, carbontxt-api default third-party-modeled; csv takes it per row or per configuration; gateway: src/adapters/dist.ts hardware-estimated; src/adapters/self-report.ts and demo-specs.ts third-party-modeled; data/*.json reviewed token by token; tools: tools/create-sustainability-data choice list with the four one-line definitions; tools/report-to-declaration; sfc-compliance; kits: deploy/FIGURES.md organization-report row: third-party-modeled for an inventory that combines metered energy with modeled categories; deploy/static/aws-s3-cloudfront cloud-billing
- **Verified by.** UT: publisher/test/adapters.test.ts; gateway/test/data.test.ts (each file's token appears in a reviewed table); tools tests. BDD: @REQ-MTH-02 (g: one scenario per token with a realistic source (utility bill, Kepler counters, cloud invoice, grid-factor model); x: an invoice from a hosting provider is cloud-billing even when the provider estimated it; e: an adapter that labels a modeled figure hardware-metered fails the reviewed token table). SCH: all-mm-*.json.

#### REQ-MTH-03 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall keep the token of the energy or activity data when it converts energy to carbon with an emission factor and when it allocates figures to a part of a target.
- **Draft (Section 3.2).** "An emission factor or an allocation to a part of a target (Section 5.2) does not change the token."
- **Implemented by.** publisher: src/normalize.ts carbonFromEnergy / computeSci do not touch measurement-method; adapters set the token from the energy basis; gateway: src/adapters/self-report.ts, src/adapters/sfc-ledger-bridge.ts; tools: tools/report-to-declaration
- **Verified by.** UT: publisher/test/normalize.test.ts; publisher/test/co2js.test.ts. BDD: @REQ-MTH-03 (g: metered kWh multiplied by a grid factor stays hardware-metered; x: a path object allocated from the origin's metered total keeps hardware-metered; e: an adapter that sets third-party-modeled only because it applied an emission factor to metered energy fails). SCH: -.

#### REQ-MTH-04 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall give an object whose figures combine methods the least direct of their tokens (order: hardware-metered, hardware-estimated, cloud-billing, third-party-modeled), and shall give third-party-modeled when the set is empty.
- **Draft (Section 3.2).** "Figures that combine methods carry the least direct token"
- **Implemented by.** publisher: src/tokens.ts leastDirect(methods); consumer: src/tokens.ts leastDirect (copy; used by upgrade and by the compatibility reading); gateway: src/adapters/sfc-ledger-bridge.ts: operators' tokens combine by leastDirect; "not stated" becomes third-party-modeled; tools: tools/report-to-declaration; sfc-compliance 2.0.0
- **Verified by.** UT: publisher/test/tokens.test.ts (new): all 16 ordered pairs, a triple, an empty set, a value outside the set; gateway/test/adapters-sfc-ledger.test.ts. BDD: @REQ-MTH-04 (g: metered plus modeled gives third-party-modeled; x: metered plus cloud-billing gives cloud-billing; order of the inputs does not matter; e: a value outside the set in the combination is refused). SCH: -.

#### REQ-MTH-05 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall give an object that carries only disclosure-uri or verifiable-attestation-uri the measurement-method token of the figures those links describe.
- **Draft (Section 3.2).** "an object carrying only evidence links carries the token of the figures they describe."
- **Implemented by.** publisher: src/normalize.ts (token required even without metrics); tools: tools/create-sustainability-data evidence-only mode asks for the token
- **Verified by.** UT: publisher/test/normalize.test.ts. BDD: @REQ-MTH-05 (g: evidence-only object with hardware-metered accepted; e: evidence-only object without a token refused; x: an object with both links carries one token). SCH: V18 (evidence-only objects).

#### PER - period (Section 3.2)

#### REQ-PER-01 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall write period as an object with the members start and end, each an RFC 3339 date-time with upper-case T and Z, and the consumer and both schemas shall reject a period that lacks either member or whose value is not a date-time; unknown members of period are ignored.
- **Draft (Section 3.2).** "The period the object covers, as two members start and end, each an [RFC3339] date-time written as updated is"
- **Implemented by.** publisher: src/period.ts parsePeriod, periodError; src/types.ts Period; src/schema.ts; consumer: src/period.ts (copy); src/validate.ts periodErrors; src/sentinel.ts (compat); gateway: src/validate.ts; tools: CDDL period = { start, end, * tstr => any }; JTD timestamp
- **Verified by.** UT: publisher/test/period.test.ts; consumer/test/period-parity.test.ts (new, byte identity); consumer/test/validate.test.ts. BDD: @REQ-PER-01 (e: date-only bound (-09 form), reporting-period string (-08 form), missing end, period as a string, lower-case t or z; x: period with an extra member is valid; g: start and end with upper-case T and Z are accepted). SCH: neg-period-date-only.json, neg-period-date-only-in-array.json, neg-period-start-lowercase-t.json, neg-period-start-lowercase-z.json, neg-period-end-lowercase-z.json, V08.

#### REQ-PER-02 (Unwanted behaviour, Section 3.2)

- **EARS.** If period.start is not before period.end, compared as instants, then the publisher gate shall refuse the object and the consumer shall report it invalid; an equal start and end is invalid; the schemas accept both.
- **Draft (Section 3.2).** "start MUST be before end; bounds are compared as the instants they denote, whatever their offsets." [req-24108bed]
- **Implemented by.** publisher: src/period.ts parsePeriod throws PeriodError with code; src/normalize.ts wraps it; consumer: src/period.ts; src/validate.ts; gateway: src/validate.ts; tools: sustainability-publisher upgrade --check; schemas are silent (CDDL cannot compare), so the rule lives in code and in this requirement
- **Verified by.** UT: publisher/test/period.test.ts; consumer/test/validate.test.ts. BDD: @REQ-PER-02 (g: start before end; e: equal bounds, end before start; x: start 2025-01-01T00:00:00+02:00 against end 2025-01-01T00:00:00Z is valid because the instants differ by two hours). SCH: R01, R02, R03 (prose set; the schemas accept them), mixed-offsets.example.

#### REQ-PER-03 (Ubiquitous, Section 3.2)

- **EARS.** The publisher, consumer and gateway shall treat a period as half-open: start included, end excluded, so that the next period starts where the previous one ends and two periods that meet do not overlap.
- **Draft (Section 3.2).** "from start, included, to end, excluded. [...] a reporting year ending on 31 March is written the same way. [...] and the next period starts where it ends [...] Period: start included, end excluded; start is before end"
- **Implemented by.** publisher: src/period.ts periodsOverlap, overlapsRange (strict inequalities); consumer: src/period.ts; src/transform.ts total(); gateway: src/adapters/self-report.ts: consecutive months and the year share boundaries
- **Verified by.** UT: publisher/test/period.test.ts; consumer/test/period-parity.test.ts. BDD: @REQ-PER-03 (g: Calendar 2025 is 2025-01-01T00:00:00Z to 2026-01-01T00:00:00Z; a year ending on 31 March is written the same way; x: January and February meet and do not overlap; e: a range that starts exactly at an object's end does not select it). SCH: example-0.json.

#### REQ-PER-04 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall write boundaries at midnight UTC with the offset Z by default, and shall write each bound of a local accounting day in the offset in force at that boundary (a fixed offset or an IANA zone through Temporal), never +00:00 for UTC.
- **Draft (Section 3.2).** "A bound is written in the offset of its boundary: boundaries at midnight UTC, written with the offset Z, are RECOMMENDED, and a publisher whose accounting day begins at a local midnight writes in each bound the offset in force at that boundary. [...] The publisher's accounting day begins at its local midnight, eight hours ahead of UTC and the same all year: both bounds carry that offset" [req-8322eb9f]
- **Implemented by.** publisher: src/period.ts yearPeriod, monthPeriod, dayPeriod, quarterPeriod (offset = "Z"; zone option); src/cli.ts and adapters: slurm-sacct utcOffset; tools: tools/create-sustainability-data --offset; tools/report-to-declaration; sustainability-publisher upgrade --offset; kits: deploy/one-click (SD_START, SD_END), Home Assistant server.mjs monthPeriod, WordPress plugin
- **Verified by.** UT: publisher/test/period.test.ts; publisher/test/csv-slurm.test.ts; tools tests. BDD: @REQ-PER-04 (g: default Z; Section 4.3 March 2026 at +08:00; x: Europe/Berlin March 2025 has +01:00 start and +02:00 end; +00:00 input is written as Z; e: an adapter that writes +00:00 for UTC fails the test (Z is written)). SCH: pos-negative-offset.json, example-3.json (+08:00).

#### REQ-PER-05 (Ubiquitous, Section 3.2)

- **EARS.** The publisher, consumer and gateway shall decide whether a period is a whole calendar day, month or year from the calendar fields of each bound in that bound's own offset (both bounds at 00:00:00; day plus one day, month plus one month, year plus one year), never by instant arithmetic, and shall treat several whole months as no whole month.
- **Draft (Section 3.2).** "A period is a whole calendar day when start is the first instant of a calendar day and end the first instant of the next, each bound read in its own offset; a whole calendar month or year is defined likewise, and several whole months are not a whole month."
- **Implemented by.** publisher: src/period.ts wholeCalendarUnit, isWholeCalendarPeriod, isOnDayBoundaries (Temporal PlainDate / PlainYearMonth, overflow reject); consumer: src/period.ts (copy); gateway: src/adapters/self-report.ts, src/examples.ts
- **Verified by.** UT: publisher/test/period.test.ts (table-driven: leap day, 28 to 31 day months, DST month, Samoa December 2011 with -10:00 to +14:00, .000Z bounds, 25-hour and 23-hour days, two months, a year plus a day); consumer/test/period-parity.test.ts. BDD: @REQ-PER-05 (g: 2025, 2025-03, 2025-03-14 recognised; e: 2025-01-01..2025-03-01 is no month; x: DST month and Samoa are whole months). SCH: V14 (samoa-2011), dst-month.example.

#### REQ-PER-06 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall give both bounds of a period the same offset, except where the local offset changes inside the period, and then shall give each bound the offset in force at that bound.
- **Draft (Section 3.2).** "The bounds carry the same offset unless the local offset changes within the period, as across a change of daylight-saving time."
- **Implemented by.** publisher: src/period.ts builders with zone option; adapters; tools: sustainability-publisher upgrade --offset applies one offset only and says so for a zone with changes
- **Verified by.** UT: publisher/test/period.test.ts. BDD: @REQ-PER-06 (g: fixed +08:00 both bounds; x: Europe/Berlin March, Pacific/Apia December 2011; e: a period across a daylight-saving change with one offset on both bounds is not produced by the builders (the test compares with the zone)). SCH: dst-month.example.

#### REQ-PER-07 (Ubiquitous, Section 3.2)

- **EARS.** The publisher and the tools shall default to a whole calendar year or month, and the conformance report shall note, without failing, a period that is neither.
- **Draft (Section 3.2).** "Whole calendar years and months are RECOMMENDED, being the periods reports state and consumers compare." [req-658f55db]
- **Implemented by.** publisher: src/period.ts yearPeriod / monthPeriod are the only builders the CLI and adapters use by default; src/util.ts lastFullMonthPeriod; consumer: src/conformance.ts informational outcome period-not-calendar-year-or-month; tools: tools/create-sustainability-data defaults to the last whole year; tools/report-to-declaration
- **Verified by.** UT: consumer/test/conformance.test.ts; tools tests. BDD: @REQ-PER-07 (g: default period is a whole year or month; x: a 14-day period passes with a note; e: a period that is neither a whole year nor a whole month never fails conformance (note only)). SCH: -.

#### REQ-PER-08 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall warn, and by default shall not publish, an object whose period is shorter than a calendar day or whose bounds are not the first instant of a calendar day in their own offset; the 23-hour and 25-hour days of a daylight-saving change satisfy the rule; the operator may switch the default to warn or off. The publisher shall also warn, without dropping the object, when period.end is after updated. This requirement is the only place where either warning is stated; REQ-PRT-04 and REQ-PRV-02 cite it.
- **Draft (Section 3.2).** "A period SHOULD be a calendar day or longer, each bound the first instant of a calendar day in its own offset (Section 6.1)." [req-305ad347]
- **Implemented by.** publisher: src/security.ts secureReports dayFloor: "drop" | "warn" | "off" (default drop, with a diagnostic per dropped object; see ); src/period.ts isOnDayBoundaries; src/validate.ts warning updated-before-period-end; consumer: src/validate.ts period-below-day-floor warning, never an error; gateway: src/config.ts LIMITS; self report holds no object shorter than a day; kits: example-scripts/security.{js,php,py} floor on day boundaries parsed by the host RFC 3339 library
- **Verified by.** UT: publisher/test/server.test.ts (12-hour period dropped, off-midnight period dropped, 23-hour DST day kept); publisher/test/hardening.test.ts; consumer/test/validate.test.ts; example-scripts/test_security.*. BDD: @REQ-PER-08 (g: whole days kept; e: a 12-hour period is dropped with a diagnostic; a period whose end is after updated keeps the object and warns; x: dayFloor warn keeps and warns, off keeps silently). SCH: -.

#### TGT - target (Section 3.2)

#### REQ-TGT-01 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall emit target as a non-empty string in every object, and the consumer and both schemas shall require it.
- **Draft (Section 3.2).** "Names what the object is about (Section 1.1)."
- **Implemented by.** publisher: src/validate.ts; src/normalize.ts; consumer: src/validate.ts (a missing target is not injected in strict mode; the legacy injection of fetch.ts applies only under compatibility)
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts. BDD: @REQ-TGT-01 (e: missing, empty and non-string target are invalid; g: a non-empty string target is accepted; x: a one-character target and a target with spaces are accepted). SCH: I44.

#### REQ-TGT-02 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall emit target exactly as the operator supplied it, without translation, transliteration, case change or normalization, and the consumer shall compare it as a string and shall not translate or transliterate it for any output.
- **Draft (Section 3.2).** "It is an opaque protocol element: it MUST NOT be translated or transliterated, and is compared as a string (Section 3.1)." [req-d38c718d]
- **Implemented by.** publisher: src/normalize.ts (target passes through; only the host rule of REQ-TGT-03 applies); consumer: src/signature.ts and src/upstream.ts compare with ===; src/cli.ts prints target verbatim (isolated); gateway: src/index-page.ts shows target verbatim
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/signature.test.ts. BDD: @REQ-TGT-02 (g: target in Cyrillic, Han and Arabic unchanged; x: decomposed and precomposed forms stay distinct; e: an adapter that offers a translation hook for target is refused (Grün GmbH is never rewritten as Gruen GmbH)). SCH: V21.

#### REQ-TGT-03 (Optional feature, Section 3.2)

- **EARS.** Where target-type is origin or the value is otherwise a host name, the publisher shall write an internationalized host in A-label form and shall refuse a U-label host for target-type origin; for another type it shall warn when a host-shaped value is not in A-label form.
- **Draft (Section 3.2).** "an internationalized host is written in A-label form ([RFC5890], Section 2.3.2.1)"
- **Implemented by.** publisher: src/normalize.ts hostTarget() using the WHATWG domainToASCII of node:url (no hand-written punycode); host-shaped means no whitespace or slash and at least one dot; tools: tools/create-sustainability-data converts the host it is given and prints the A-label
- **Verified by.** UT: publisher/test/normalize.test.ts. BDD: @REQ-TGT-03 (g: xn--grn-ioa.example accepted; e: grun with umlaut as U-label refused for origin; x: an organization named "Example.com Ltd" is not host-shaped). SCH: V22 (Example.COM and xn--grn-ioa.example), T10 (U-label origin).

#### REQ-TGT-04 (Ubiquitous, Section 3.2)

- **EARS.** The publisher and the consumer shall compare a host-name target case-insensitively and every other target by strict string equality; the signature check of REQ-VER-06 is the exception and compares strictly.
- **Draft (Section 3.2).** "and the host is compared case-insensitively ([RFC3986], Section 3.2.2)."
- **Implemented by.** publisher: src/selection.ts targetEquals(); consumer: src/upstream.ts, src/fetch.ts attribution (the origin host of the final URL against a host target); gateway: src/app.ts
- **Verified by.** UT: publisher/test/selection.test.ts; consumer/test/fetch.test.ts. BDD: @REQ-TGT-04 (g: Example.COM equals example.com; e: /API/v1 does not equal /api/v1; x: grun U-label never equals its A-label (no IDNA mapping in comparison)). SCH: -.

#### REQ-TGT-05 (Ubiquitous, Section 3.2)

- **EARS.** The publisher shall default target to the origin's host for an origin-wide object and shall accept an organization name as written; the consumer and the publisher gate shall reject a path-prefix target (target-type path) that does not begin with "/", and the schemas accept it, because the CDDL types target as a string; target-type classifies every other kind.
- **Draft (Section 3.2).** "For an organization its name is used; for an origin-wide report the origin's host (for example "example.com") is RECOMMENDED; a path prefix is written like "/api/v1"; target-type classifies the other kinds." [req-cdc28d84]
- **Implemented by.** publisher: src/normalize.ts, src/publisher.ts (default target from the configured origin host); src/validate.ts path target begins with "/" when target-type is path (publisher gate and consumer); gateway: src/adapters/self-report.ts target is the gateway host; tools: tools/create-sustainability-data asks for the kind of target and sets target-type
- **Verified by.** UT: publisher/test/normalize.test.ts; tools tests. BDD: @REQ-TGT-05 (g: origin host default; e: target-type path with target api/v1 (no slash) refused; x: facility and device targets are free text). SCH: example-3.json, R17 (path target without slash; prose set, to be added to the example corpus).

#### REQ-TGT-06 (Ubiquitous, Section 3.2)

- **EARS.** The gateway and any intermediary that publishes figures for a target other than its own origin shall present them as claims of its own origin about that target and shall never present them as the target's own declaration.
- **Draft (Section 3.2).** "Figures for a target other than the origin are a claim by the origin's publisher about that target (Section 5.1)."
- **Implemented by.** consumer: src/cli.ts attributes every figure to the origin that served the final response; gateway: src/legal.ts and gateway/LEGAL.md wording; data/*.json provider and methodology-uri name the gateway operator as the source; src/index-page.ts labels
- **Verified by.** UT: gateway/test/legal.test.ts; gateway/test/data.test.ts. BDD: @REQ-TGT-06 (g: gateway page for mozilla.org says it is the gateway operator's claim; x: a badge for a third-party origin does not say verified; e: a gateway page for a relayed target that says the target published the figures fails the legal test). SCH: -.

#### NUM - Numeric members (Section 3.3)

#### REQ-NUM-01 (Unwanted behaviour, Section 3.3)

- **EARS.** If energy-consumption, carbon-footprint, sci-score, carbon-intensity-gCO2e-per-kWh, estimated-annual-emissions-kgCO2e or renewable-energy is negative, then the publisher gate shall refuse the object and the consumer shall report it invalid; the schemas accept a negative value; scope-1, scope-2 and scope-3 are the stated exception.
- **Draft (Section 3.3).** "Unless stated otherwise, a numeric member MUST NOT be negative" [req-27e5209f]
- **Implemented by.** publisher: src/validate.ts; src/normalize.ts; consumer: src/validate.ts; src/sentinel.ts (in compatibility mode the member is disregarded and listed); gateway: src/validate.ts; tools: CDDL comments say non-negative; the code is the check
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts. BDD: @REQ-NUM-01 (e: -1 in each of the six members; g: 0 accepted; x: -0 is never emitted (JSON.stringify writes 0) and a read -0 equals 0). SCH: R06, R07, R09 (prose set; the schemas accept them).

#### REQ-NUM-02 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall emit only finite numbers that binary64 represents exactly as written, and the consumer shall report a number beyond binary64 magnitude or precision as a warning in compatibility mode and as an error in strict mode.
- **Draft (Section 3.3).** "a publisher MUST NOT emit a number whose magnitude or precision exceeds what IEEE 754 binary64 represents ([RFC7493], Section 2.2)." [req-27e5209f]
- **Implemented by.** publisher: src/normalize.ts finite and safe-literal checks; src/json.ts for input files; src/util.ts readJson/fromWire; consumer: src/json.ts parseStrict with the lossless-json number guard (isSafeNumber), L15 of the design
- **Verified by.** UT: publisher/test/hardening.test.ts; consumer/test/fetch.test.ts. BDD: @REQ-NUM-02 (e: 1e309, 12345678901234567890, 0.1234567890123456789; x: 1e308 and 5e-324 accepted; strict mode makes the warning an error; g: ordinary values such as 0.1 and 12345.678 are emitted and read unchanged). SCH: -.

#### REQ-NUM-03 (Ubiquitous, Section 3.3)

- **EARS.** The adapters and tools that convert a source's quantities shall map them onto the GHG Protocol and ESRS E1 quantities the numeric members name (gross emissions, scope 1, 2 and 3, energy consumed, renewable share) and shall document the mapping.
- **Draft (Section 3.3).** "Numeric members align with the GHG Protocol [GHG-PROTOCOL] and ESRS E1 [ESRS-E1]; product-level regimes such as [EU-ESPR] use the same quantities."
- **Implemented by.** publisher: src/adapters/enterprise/{salesforce-nzc,ms-sustainability,watershed}.ts; src/adapters/climatiq.ts; tools: tools/report-to-declaration mapping table; sfc-compliance; kits: deploy/FIGURES.md
- **Verified by.** UT: publisher/test/adapters.test.ts; fitness/repository-invariants.test.mjs (the mapping table is present); tools/report-to-declaration/test/verify.test.mjs. BDD: @REQ-NUM-03 (g: a Salesforce Net Zero Cloud export maps to scope-1, scope-2, scope-3 and carbon-footprint; e: n/a: documentation, checked by fitness test fitness/repository-invariants.test.mjs; x: n/a: documentation, checked by fitness test fitness/repository-invariants.test.mjs). SCH: -.

#### TTY - target-type (Section 3.3)

#### REQ-TTY-01 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall emit target-type as one of origin, path, organization, facility, service, product, device, tenant, data-source (case-sensitive), and the consumer and both schemas shall reject any other value as served; the value never changes how target is written or compared.
- **Draft (Section 3.3).** "One of these nine; it does not change the syntax or comparison of target:"
- **Implemented by.** publisher: src/tokens.ts TARGET_TYPES (moved from types.ts); src/normalize.ts; consumer: src/tokens.ts (copy; sentinel.ts imports it); src/validate.ts; src/schema.ts; gateway: src/registry.ts; tools: CDDL enum; sustainability-publisher upgrade rule 14 drops an unknown target-type and prints it; create-sustainability-data choice list
- **Verified by.** UT: publisher/test/tokens.test.ts; consumer/test/schema.test.ts (table of nine); consumer/test/sentinel.test.ts. BDD: @REQ-TTY-01 (g: Outline over the nine; e: datacenter, warehouse, Facility; x: target-type absent is valid). SCH: all-tt-*.json (9), pos-tt-facility.json, neg-tt-datacenter.json.

#### REQ-TTY-02 (Ubiquitous, Section 3.3)

- **EARS.** The tools and kits shall describe each target-type with the one-line definition of the draft and shall offer no other, and the consumer shall treat tenant as the only type with behaviour of its own (upstream comparison, REQ-EVD-04).
- **Draft (Section 3.3).** "organization: a legal or reporting entity, such as a company; [...] facility: one site, such as a data center or a plant; [...] origin: the publishing origin as a whole; [...] path: a path prefix of the origin; [...] service: an operated service, such as an API or an inference endpoint; [...] product: a good or a released artifact, assessed per unit; [...] device: one physical unit of equipment, with its components; [...] tenant: a customer's share of a provider's figures; [...] data-source: a dataset or data feed."
- **Implemented by.** consumer: src/upstream.ts tenant branch; tools: tools/create-sustainability-data, tools/report-to-declaration; sfc-compliance; kits: deploy/one-click/railway/server.mjs, WordPress readme.txt, Home Assistant lists show the nine
- **Verified by.** UT: tools tests; fitness/repository-invariants.test.mjs (closed sets agree everywhere, REQ-FRM-02). BDD: @REQ-TTY-02 (g: one example per type (facility with colocation upstream; device; product; data-source); e: a kit list that offers a tenth target-type fails the fitness test; x: tenant is the only type whose upstream comparison differs). SCH: all-tt-*.json.

#### ENG - energy (Section 3.3)

#### REQ-ENG-01 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall emit energy-unit only as Wh, kWh, MWh or GWh, and the consumer shall apply kWh when it is absent and convert with the factors 0.001, 1, 1000 and 1000000 to kWh.
- **Draft (Section 3.3).** "One of Wh, kWh, MWh, GWh; when absent, kWh applies."
- **Implemented by.** publisher: src/normalize.ts convertEnergy; src/types.ts EnergyUnit; consumer: src/units.ts convertEnergy; src/schema.ts enum; tools: CDDL enum
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/units.test.ts. BDD: @REQ-ENG-01 (g: Outline over the four units; e: TWh, kwh, joule; x: unit present with no energy-consumption is valid). SCH: all-eu-{Wh,kWh,MWh,GWh}.json, neg-eu-TWh.json.

#### REQ-ENG-02 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall state energy-consumption in the unit of energy-unit (or kWh when absent) for the object's period and target, and shall not convert units silently after signing.
- **Draft (Section 3.3).** "Energy consumed by the target during the period, in the unit of energy-unit."
- **Implemented by.** publisher: src/normalize.ts joulesToKwh, convertEnergy; consumer: src/units.ts
- **Verified by.** UT: publisher/test/normalize.test.ts. BDD: @REQ-ENG-02 (g: 2.4 GWh in Section 4.1 is read as 2400000 kWh; e: a conversion of energy-consumption to another unit after signing leaves the signature unverified; x: energy-unit absent reads the value as kWh). SCH: example-1.json.

#### CAR - carbon (Section 3.3)

#### REQ-CAR-01 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall emit carbon-unit only as gCO2e, kgCO2e or tCO2e, the consumer and both schemas shall reject mtCO2e and every other value as served, and the default gCO2e shall apply to carbon-footprint, scope-1, scope-2 and scope-3 only.
- **Draft (Section 3.3).** "One of gCO2e, kgCO2e, tCO2e, the gram, kilogram, and metric tonne of CO2e; when absent, gCO2e applies to carbon-footprint and the scope members."
- **Implemented by.** publisher: src/tokens.ts CARBON_UNITS, CARBON_TO_G; src/adapters/csv.ts allow-list; src/adapters/enterprise/salesforce-nzc.ts and ms-sustainability.ts default tCO2e; consumer: src/tokens.ts (copy); src/units.ts convertCarbon; src/sentinel.ts carbon-unit parameterises the four members; gateway: src/adapters/sfc-ledger-bridge.ts KG_EXPONENT; the 38 mtCO2e members in gateway/data (27 files) rewritten; tools: sustainability-publisher upgrade rule: mtCO2e becomes tCO2e with the numbers unchanged; CDDL enum; kits: WordPress readme.txt, one-click, Home Assistant unit lists
- **Verified by.** UT: publisher/test/tokens.test.ts; consumer/test/units.test.ts; consumer/test/fetch.test.ts (lbCO2e is the new unrecognized-unit fixture). BDD: @REQ-CAR-01 (g: Outline over the three; e: mtCO2e, MtCO2e, kg; x: object without carbon-unit has its footprint read in grams). SCH: all-cu-{gCO2e,kgCO2e,tCO2e}.json, pos-cu-tCO2e.json, neg-cu-mtCO2e.json.

#### REQ-CAR-02 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall state carbon-footprint as gross emissions in the unit of carbon-unit (grams when absent) and shall not net removals into it.
- **Draft (Section 3.3).** "Gross emissions of the target during the period, in the unit of carbon-unit."
- **Implemented by.** publisher: src/normalize.ts convertCarbon; consumer: src/units.ts
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/units.test.ts. BDD: @REQ-CAR-02 (g: 610 tCO2e in Section 4.1; x: a removals-only organization publishes removals in scope members, not in carbon-footprint; e: removals netted into carbon-footprint are not produced; a negative footprint is invalid (REQ-NUM-01)). SCH: example-1.json.

#### REQ-CAR-03 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall emit carbon-accounting only as location-based or market-based, and the consumer and both schemas shall reject any other value as served.
- **Draft (Section 3.3).** "location-based or market-based [GHG-SCOPE2]."
- **Implemented by.** publisher: src/types.ts CarbonAccounting; src/normalize.ts; consumer: src/validate.ts; src/schema.ts enum; tools: CDDL enum
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/schema.test.ts. BDD: @REQ-CAR-03 (g: Outline over the two; e: hourly-market-based, Location-Based; x: carbon-accounting on an object with no carbon figure is valid). SCH: all-ca-{location-based,market-based}.json, neg-ca-hourly-market-based.json.

#### SCP - scopes (Section 3.3)

#### REQ-SCP-01 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall warn when scope-1, scope-2 and scope-3 accompany carbon-footprint and their sum differs from it by more than half a unit in the last decimal place of the least precise of the four figures, and the warning shall point to the methodology document; the consumer shall report the difference as a note, never as an error.
- **Draft (Section 3.3).** "Where they accompany carbon-footprint for the same period they SHOULD account for it; scopes that cover only part of that figure are explained in the methodology document." [req-4edc4aed]
- **Implemented by.** publisher: src/validate.ts scopes-do-not-account-for-footprint warning (tolerance rule is a design choice, ); consumer: src/validate.ts note
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts. BDD: @REQ-SCP-01 (g: 90 + 220 + 300 = 610 in Section 4.1 raises nothing; e: 90 + 220 + 100 against 610 raises the warning; x: rounding-level differences (2.1 + 1.1 + 0 against 3.2) raise nothing). SCH: example-1.json, example-4.json.

#### REQ-SCP-02 (Optional feature, Section 3.3)

- **EARS.** Where the accounting method conveys removals or net figures, the publisher may emit a negative scope-1, scope-2 or scope-3, and the consumer shall accept a negative scope without warning or error.
- **Draft (Section 3.3).** "These MAY be negative where the declared accounting method conveys removals or net figures, which the methodology document then explains." [req-48bd044c]
- **Implemented by.** publisher: src/validate.ts (scope members excluded from REQ-NUM-01); consumer: src/validate.ts; src/transform.ts total() sums scopes with their sign; gateway: example-response-removals.json demo
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts; consumer/test/transform.test.ts. BDD: @REQ-SCP-02 (g: scope-1 = -12 accepted; x: negative scopes in a total; e: a negative carbon-footprint is invalid (REQ-NUM-01); only the three scope members may be negative). SCH: V16 (negative scope).

#### REQ-SCP-03 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall state scope-1 as direct emissions, scope-2 as purchased-energy emissions and scope-3 as value-chain emissions, in the unit of carbon-unit (grams when absent), and the tools shall describe them so.
- **Draft (Section 3.3).** "Direct, purchased- energy, and value-chain emissions in the unit of carbon-unit."
- **Implemented by.** publisher: src/normalize.ts convertCarbon applies carbon-unit to the three members; consumer: src/units.ts convertCarbon; tools: tools/create-sustainability-data and report-to-declaration labels; sfc-compliance scope mapping
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/units.test.ts. BDD: @REQ-SCP-03 (g: Section 4.1 scopes 90, 220, 300 tCO2e; x: carbon-unit absent reads the three scopes in grams; e: scope-1 written in kilograms with carbon-unit tCO2e is read by carbon-unit, never guessed). SCH: example-1.json.

#### SCI - sci-score (Section 3.3)

#### REQ-SCI-01 (Unwanted behaviour, Section 3.3)

- **EARS.** If sci-score is present without functional-unit, then the publisher gate shall refuse the object and the consumer shall report it invalid, because a score without a unit cannot be disregarded; the schemas accept it.
- **Draft (Section 3.3).** "Software Carbon Intensity [GSF-SCI], in grams of CO2e per functional-unit, which MUST then be present." [req-c340c99a]
- **Implemented by.** publisher: src/normalize.ts computeSci; src/validate.ts; consumer: src/validate.ts; gateway: src/validate.ts; tools: the CDDL comment says requires functional-unit; the check is code (CDDL group choice optional)
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts. BDD: @REQ-SCI-01 (e: sci-score alone; g: sci-score with functional-unit; x: functional-unit without sci-score is valid). SCH: R05 (prose set; the schemas accept it), pos-fu-per-request.json.

#### REQ-SCI-02 (Ubiquitous, Section 3.3)

- **EARS.** The publisher and the consumer shall read sci-score always in grams of CO2e per unit, whatever carbon-unit says.
- **Draft (Section 3.3).** "Software Carbon Intensity [GSF-SCI], in grams of CO2e per functional-unit"
- **Implemented by.** publisher: src/normalize.ts computeSci (grams); consumer: src/units.ts (sci-score is outside the carbon-unit family)
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/units.test.ts. BDD: @REQ-SCI-02 (g: an object with carbon-unit tCO2e and sci-score 0.012 is read as 0.012 g per request; e: a consumer that rescales sci-score by carbon-unit fails the unit test; x: carbon-unit kgCO2e leaves a score of 0.012 as 0.012). SCH: example-3.json.

#### FUN - functional-unit (Section 3.3)

#### REQ-FUN-01 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall emit functional-unit only as per-request, per-transaction, per-page-view, per-session, per-user, per-job, per-token, per-inference, per-gigabyte, per-gigabyte-hour, per-vcpu-hour or per-device, and the consumer and both schemas shall reject any other value as served.
- **Draft (Section 3.3).** "The unit of sci-score, one of these twelve:"
- **Implemented by.** publisher: src/tokens.ts FUNCTIONAL_UNITS (12), isFunctionalUnit; src/normalize.ts; consumer: src/tokens.ts (copy); src/schema.ts enum; src/validate.ts; gateway: src/adapters/demo-specs.ts; data/*.json; tools: CDDL enum; create-sustainability-data list; sustainability-publisher upgrade rules 4 to 6; kits: deploy lists (one-click, WordPress, Home Assistant)
- **Verified by.** UT: publisher/test/tokens.test.ts; consumer/test/schema.test.ts (table of twelve); fitness/repository-invariants.test.mjs. BDD: @REQ-FUN-01 (g: Outline over the twelve; e: per-minute, Per-Request, per-visit, per-thousand-requests, per-terabyte-day; x: functional-unit without sci-score is valid). SCH: pos-fu-* (12), all-fu-* (10 present; the two missing units per-session and per-vcpu-hour are covered by the all-pairs set of the example corpus and GT1), neg-fu-case-Per-Request.json, neg-fu-per-terabyte-day.json, neg-fu-per-thousand-requests.json, neg-functional-unit-per-thousand-requests.json, neg-functional-unit-per-visit.json, neg-functional-unit-single-object.json.

#### REQ-FUN-02 (Ubiquitous, Section 3.3)

- **EARS.** The adapters and tools shall use each unit with its one-line meaning, and wherever they derive a per-gigabyte or per-gigabyte-hour figure they shall use 10^9 octets, not 2^30.
- **Draft (Section 3.3).** "per-request: one request the target serves; [...] per-transaction: one transaction the target completes, such as a purchase; [...] per-page-view: one web page loaded from the target; [...] per-session: one user session with the target; [...] per-user: one user of the target during the period; [...] per-job: one run of a batch job, pipeline, or workflow; [...] per-token: one token a language model of the target processes in inference; [...] per-inference: one inference by a model of the target, such as a prediction or a generated image; [...] per-gigabyte: one gigabyte (10^9 octets) the target transfers; [...] per-gigabyte-hour: one gigabyte (10^9 octets) held in the target's storage for one hour; [...] per-vcpu-hour: one virtual processor allocated to the target for one hour; [...] per-device: one device that is the target or runs its software, during the period."
- **Implemented by.** publisher: src/adapters/co2js.ts and carbontxt-api.ts byte conversions use 1e9; tools: create-sustainability-data and report-to-declaration unit help text; kits: example-scripts and deploy lists
- **Verified by.** UT: publisher/test/co2js.test.ts (bytes to gigabytes uses 1e9); tools tests. BDD: @REQ-FUN-02 (g: 1.5e9 bytes is 1.5 per-gigabyte; x: a GiB input is converted by 1.073741824; e: a conversion that divides bytes by 2^30 fails the test). SCH: -.

#### REQ-FUN-03 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall state sci-score for exactly one unit and shall carry the time only in the object's period; sustainability-publisher upgrade shall convert a legacy per-thousand or per-million unit to the per-unit score (per-thousand-requests 12 becomes per-request 0.012) and shall drop a compound or unlisted unit with a note to restate it by hand.
- **Draft (Section 3.3).** "A score is for one unit, and the object's period carries the time."
- **Implemented by.** publisher: src/normalize.ts; src/cli.ts upgrade (rules 5, 5a, 6 of the conversion list); consumer: src/sentinel.ts compatibility reading applies the same rules from tokens.ts legacyFunctionalUnit and records converted; tools: sustainability-publisher upgrade --check lists each conversion
- **Verified by.** UT: publisher/test/upgrade.test.ts (new); consumer/test/sentinel.test.ts. BDD: @REQ-FUN-03 (g: 12 per-thousand-requests becomes 0.012 per-request and is reported converted; per-terabyte-day 0.85 becomes per-gigabyte-hour 0.0000354; e: per-active-user-per-month is dropped with its score; x: per-requests plural, per-1000-api-requests). SCH: neg-fu-per-thousand-requests.json, neg-fu-per-terabyte-day.json.

#### REQ-FUN-04 (Optional feature, Section 3.3)

- **EARS.** Where a score is in a unit not listed, the publisher shall carry it in extensions under a URI name whose definition states the unit, and shall leave sci-score and functional-unit out.
- **Draft (Section 3.3).** "A score in a unit not listed here, which [GSF-SCI] permits, goes in extensions (Section 3.4) under a name whose definition states the unit."
- **Implemented by.** publisher: src/normalize.ts (an unlisted unit in functional-unit is refused with this advice); tools: sustainability-publisher upgrade prints the extension hint; create-sustainability-data offers it
- **Verified by.** UT: publisher/test/normalize.test.ts. BDD: @REQ-FUN-04 (g: per-minute score in an extension, object valid; e: per-minute in functional-unit refused; x: a score in an extension is not counted as sci-score by a total or by the minimum-content rule). SCH: V24 (extension-score-other-unit).

#### REQ-FUN-05 (Ubiquitous, Section 3.3)

- **EARS.** The methodology template shall ask what counts as one unit whenever sci-score is published (see REQ-MND-07).
- **Draft (Section 3.3).** "The methodology document says what counts as one unit (Section 3.2)."
- **Implemented by.** tools: tools/create-sustainability-data methodology stub; kits: deploy/FIGURES.md
- **Verified by.** UT: tools/create-sustainability-data/test/create.test.mjs; fitness/repository-invariants.test.mjs (each kit template has the headings). BDD: @REQ-FUN-05 (g: stub contains the heading when a score is given; e: n/a: documentation, checked by fitness test fitness/repository-invariants.test.mjs; x: n/a: documentation, checked by fitness test fitness/repository-invariants.test.mjs). SCH: -.

#### DRV - derived and range members (Section 3.3)

#### REQ-DRV-01 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall state carbon-intensity-gCO2e-per-kWh in grams of CO2e per kWh whatever carbon-unit and energy-unit say, and the consumer shall not convert it.
- **Draft (Section 3.3).** "Weighted carbon intensity of the energy consumed."
- **Implemented by.** publisher: src/normalize.ts carbonFromEnergy (energy in kWh times intensity in g per kWh); consumer: src/units.ts (no conversion for the member)
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/units.test.ts. BDD: @REQ-DRV-01 (g: 175 g/kWh with GWh and tCO2e units unchanged; x: ratio carbon over energy equals the intensity within rounding; e: a consumer that rescales the intensity by energy-unit fails the unit test). SCH: example-4.json.

#### REQ-DRV-02 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall state estimated-annual-emissions-kgCO2e in kilograms of CO2e whatever carbon-unit says and shall describe any extrapolation for a period shorter than a year in the methodology document; the consumer shall not convert it.
- **Draft (Section 3.3).** "Annualized gross emissions in kilograms of CO2e regardless of carbon-unit; for a period shorter than a year, an extrapolation the methodology document describes."
- **Implemented by.** publisher: src/normalize.ts; consumer: src/units.ts; kits: methodology template (REQ-MND-07)
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/units.test.ts. BDD: @REQ-DRV-02 (g: 1168 kg for one day in Section 4.4; x: carbon-unit tCO2e does not rescale the member; e: a consumer that rescales the member by carbon-unit fails the unit test). SCH: example-4.json.

#### REQ-DRV-03 (Unwanted behaviour, Section 3.3)

- **EARS.** If renewable-energy is below 0 or above 100, then the publisher gate shall refuse the object and the consumer shall report it invalid; the schemas accept it; 0 and 100 are valid and the value is a percentage, not a fraction.
- **Draft (Section 3.3).** "Percentage of energy from renewable sources, between 0 and 100 inclusive."
- **Implemented by.** publisher: src/validate.ts range check; consumer: src/validate.ts; gateway: src/validate.ts; tools: CDDL comment 0 to 100; code is the check
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts. BDD: @REQ-DRV-03 (g: 0, 45, 100; e: -0.01, 100.01, 4500 written as a fraction mistake is not detected; x: noise never pushes 100 above 100 (REQ-PRV-05)). SCH: R08, R09 (prose set; the schemas accept them), V19 (boundary values).

#### LNK - evidence links (Section 3.3)

#### REQ-LNK-01 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall emit verifiable-attestation-uri as one string, never an array, and shall put any further attestations in the index that disclosure-uri links; the gateway's own attestation shall state when its issuer is not independent of the publisher.
- **Draft (Section 3.3).** "A URI reference to a statement about the published metrics, cryptographically signed by a party other than the publisher, such as a verifiable credential [VC-DATA-MODEL-2]. An object carries at most one; an index of further attestations is linked from disclosure-uri."
- **Implemented by.** publisher: src/validate.ts (type string); consumer: src/validate.ts; src/attestation.ts; gateway: src/adapters/self-report.ts; gateway/GUIDE.md attestation notes
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/attestation.test.ts. BDD: @REQ-LNK-01 (e: an array value is invalid; g: Section 4.4 attestation link; x: a disclosure-uri may lead to an index of several attestations while the object still carries one). SCH: I49 (attestation array; to be added to 04), example-4.json.

#### REQ-LNK-02 (Ubiquitous, Section 3.3)

- **EARS.** The consumer shall resolve disclosure-uri as a URI reference, retrieve it only on request, and return the bytes with their media type without requiring a particular format.
- **Draft (Section 3.3).** "A URI reference to a machine-readable index, in any format, of the target's sustainability disclosures: reports, certificates, hosting and energy-source evidence."
- **Implemented by.** consumer: src/disclosure.ts resolveDisclosureLinks, fetchDisclosure
- **Verified by.** UT: consumer/test/disclosure.test.ts. BDD: @REQ-LNK-02 (g: a JSON index and an HTML index both returned; x: relative reference resolved against the retrieval URI; e: a disclosure-uri that answers 404 returns that failure and does not invalidate the declaration). SCH: example-1.json.

#### MIN - minimum content (Section 3.3)

#### REQ-MIN-01 (Unwanted behaviour, Section 3.3)

- **EARS.** If an object carries none of energy-consumption, carbon-footprint, scope-1, scope-2, scope-3, sci-score, carbon-intensity-gCO2e-per-kWh, estimated-annual-emissions-kgCO2e, renewable-energy, disclosure-uri and verifiable-attestation-uri, then the publisher gate shall refuse it and the consumer shall report it invalid; the schemas accept it.
- **Draft (Section 3.3).** "A declaration object MUST carry at least one numeric metric member or at least one of disclosure-uri and verifiable-attestation-uri" [req-7f33240f]
- **Implemented by.** publisher: src/normalize.ts hasReportableContent; src/validate.ts; consumer: src/validate.ts carriesAtLeastOne; gateway: src/validate.ts; tools: the schemas cannot express it; code and this requirement
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts. BDD: @REQ-MIN-01 (e: seven mandatory members only; energy-unit alone; extensions alone; upstream alone; g: one evidence link alone; x: a metric of 0 counts as carried; each of the eleven members alone satisfies the rule). SCH: R04 (prose set; the schemas accept it), V18 (evidence only).

#### REQ-MIN-02 (Ubiquitous, Section 3.3)

- **EARS.** The publisher shall omit a metric it does not report and shall never emit null, -1, an empty string or a text such as n/a in its place; the consumer shall treat such a value as an invalid value, not as not reported.
- **Draft (Section 3.3).** "a metric not reported is omitted, and there is no in-band "not reported" value."
- **Implemented by.** publisher: src/normalize.ts (undefined omitted; null refused); consumer: src/validate.ts; src/sentinel.ts (compatibility mode lists the sentinel as disregarded)
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/sentinel.test.ts. BDD: @REQ-MIN-02 (g: unreported metric absent; e: null, -1, "n/a" in energy-consumption invalid in strict mode; x: a reported value of 0 is kept and never treated as not reported). SCH: I50 (metric null; to be added to 04), I36 (metric as a string), R06 and R07 (negative values).

#### URF - URI-valued members (Section 3.3.1)

#### REQ-URF-01 (Ubiquitous, Section 3.3.1)

- **EARS.** The publisher shall accept these four members as URI references, relative or absolute, shall not rewrite a relative reference into an absolute one, and shall refuse a value that is not a URI reference.
- **Draft (Section 3.3.1).** "methodology-uri, verifiable-attestation-uri, disclosure-uri, and the declaration member of an upstream entry are URI references ([RFC3986], Section 4.1)"
- **Implemented by.** publisher: src/validate.ts (new URL(value, base) as the syntax check); consumer: src/validate.ts uriMemberWarnings(obj, base)
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts (a value with a space warns; non-https does not). BDD: @REQ-URF-01 (g: /sustainability/methodology, ../x, https://x.example/y; e: "not a uri"; x: a fragment-only reference (#top) and a query-only reference (?x) are accepted). SCH: example-0.json.

#### REQ-URF-02 (Event-driven, Section 3.3.1)

- **EARS.** When the consumer follows or reports a URI-valued member, it shall resolve it against the retrieval URI of the declaration (the final URL after redirects, fragment removed) with a standard URL resolver, and only then apply its own policy.
- **Draft (Section 3.3.1).** "resolved as [RFC3986], Section 5 specifies. For a retrieved declaration the base URI is the retrieval URI ([RFC3986], Section 5.1.3)"
- **Implemented by.** consumer: src/fetch.ts finalUrl threaded as base to src/disclosure.ts, src/upstream.ts, src/attestation.ts; gateway: src/verify.ts and src/validate.ts pass the retrieval URI
- **Verified by.** UT: consumer/test/disclosure.test.ts; consumer/test/upstream.test.ts; consumer/test/attestation.test.ts. BDD: @REQ-URF-02 (g: /methodology against https://a.example/.well-known/sustainability-data; x: relative reference after a redirect resolves against the redirect target; e: a reference that cannot be resolved against the base is reported and not retrieved). SCH: -.

#### REQ-URF-03 (Ubiquitous, Section 3.3.1)

- **EARS.** The consumer, the gateway and the tools shall keep the retrieval URI with every declaration they store, export or relay, so that relative references stay resolvable.
- **Draft (Section 3.3.1).** "so a party that stores, forwards, or relays a declaration keeps the URI it retrieved it from."
- **Implemented by.** consumer: src/transform.ts toCsvRows / toNdjson carry a source-url column; FetchResult.url; gateway: src/verify.ts and relay output carry retrievedFrom; tools: tools/report-to-declaration output keeps the source URL
- **Verified by.** UT: consumer/test/transform.test.ts; gateway/test/validate.test.ts. BDD: @REQ-URF-03 (g: exported rows include the URL; x: a relayed declaration with a relative methodology-uri is resolved by the recipient from the carried URL; e: an export row without the source URL fails the transform test). SCH: -.

#### EXT - Extensions (Section 3.4)

#### REQ-EXT-01 (Ubiquitous, Section 3.4)

- **EARS.** The publisher shall carry data the document does not define only in extensions, as an object whose member names are extension names and whose values are objects, and the consumer and both schemas shall reject an extensions value that is not an object or an extension value that is not an object.
- **Draft (Section 3.4).** "Data that this document does not define is carried in the extensions member, an object whose member names are extension names and whose values are objects defined by the name's definer. [...] Members defined outside this document (Section 3.4)."
- **Implemented by.** publisher: src/normalize.ts assertExtensions; src/validate.ts; consumer: src/validate.ts; src/schema.ts; tools: CDDL extensions: { * ext-name => { * tstr => any } }
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts; consumer/test/schema.test.ts. BDD: @REQ-EXT-01 (g: Section 4.1 carries two extensions; e: an extension value that is a string, an array or null; x: an empty extensions object is valid). SCH: example-1.json, I35 (extension value not an object), V23 (second object: extensions {}).

#### REQ-EXT-02 (Ubiquitous, Section 3.4)

- **EARS.** The publisher and the consumer shall accept as an extension name any URI (an https URL or a urn:uuid in any letter case, among others), shall keep it exactly as written, shall compare it as a string and shall never dereference it.
- **Draft (Section 3.4).** "An extension name is a URI ([RFC3986], Section 3) under the definer's control when the name was minted; a definer without a domain can use a UUID URN ([RFC9562]). A name is an identifier, compared as a string (Section 3.1), written as its definer published it, and never dereferenced."
- **Implemented by.** publisher: src/types.ts extensionNameError reduced to: non-empty, URI syntax with a scheme, no whitespace or control characters; the https-only, lower-case-scheme and Nil/Max UUID rules are dropped; consumer: src/validate.ts extensionNameError, ABSOLUTE_URI_RE with [A-Za-z] scheme
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts (HTTPS://Example.com/x, upper-case UUID, Nil UUID, urn:oid, a fragment all accepted; "not a uri" and the empty string rejected); consumer/test/fetch.test.ts (no request is made to a name). BDD: @REQ-EXT-02 (g: https name and urn:uuid name from Section 4.1; e: a name without a scheme; x: two names that differ only in case are two extensions; a name pointing at a local test server receives no request). SCH: example-1.json, V23 (https, UUID URN and OID URN names), R15 and R16 (names that are not URIs).

#### REQ-EXT-03 (Optional feature, Section 3.4)

- **EARS.** Where the consumer implements the definition of an extension name, it shall process the value of that name through the handler registered for it.
- **Draft (Section 3.4).** "A consumer that implements a name's definition processes its value" [req-8e5210f0]
- **Implemented by.** consumer: src/index.ts extension handler registry (new, optional; no handler is built in)
- **Verified by.** UT: consumer/test/validate.test.ts (handler receives the value of its name only). BDD: @REQ-EXT-03 (g: a registered handler for the water-and-waste name receives its object; x: a handler error does not invalidate the declaration; e: a handler registered for another name never receives this value). SCH: -.

#### REQ-EXT-04 (Unwanted behaviour, Section 3.4)

- **EARS.** If the consumer does not implement an extension name, then it shall ignore the value and shall not retrieve, evaluate or execute any URL, script or markup inside it.
- **Draft (Section 3.4).** "a consumer that does not ignores the value and MUST NOT automatically dereference or execute anything within it." [req-8e5210f0]
- **Implemented by.** consumer: src/validate.ts, src/fetch.ts (no code path reads extension values); src/cli.ts prints them as escaped data; gateway: src/index-page.ts escapes extension values (REQ-SEC-13)
- **Verified by.** UT: consumer/test/fetch.test.ts (a recording server sees no request for links inside extensions); consumer/test/validate.test.ts. BDD: @REQ-EXT-04 (e: an extension value holding https://127.0.0.1:port/ping, a script tag and a javascript: URL causes no request and no execution; g: an unknown extension name is ignored and the declaration validates; x: an extension value that holds a javascript: URL is carried as data and escaped on output). SCH: -.

#### REQ-EXT-05 (Ubiquitous, Section 3.4)

- **EARS.** The consumer shall not look up a registry, DNS or ownership data to interpret an extension name, and the meaning of a published name shall not change when its domain changes hands.
- **Draft (Section 3.4).** "The definer publishes the definition where it chooses; no registry is defined. A later change of ownership or loss of a domain in a name does not change the meaning of a document already published."
- **Implemented by.** consumer: no network access in extension handling
- **Verified by.** UT: consumer/test/fetch.test.ts. BDD: @REQ-EXT-05 (x: a handler registered for a name keeps working when the name's domain does not resolve; g: a name is read the same before and after its domain changes hands; e: a recording resolver sees no DNS query for the name). SCH: -.

#### UPS - Upstream declarations (Section 3.5)

#### REQ-UPS-01 (Ubiquitous, Section 3.5)

- **EARS.** The publisher shall emit upstream only as a non-empty array of objects each carrying declaration (a URI reference), and the consumer and both schemas shall reject an empty array, a non-array and an entry without declaration; unknown members of an entry are ignored.
- **Draft (Section 3.5).** "The declarations of providers from which this object's figures derive (Section 3.5). [...] The upstream member is an array of at least one object, each with a declaration member, a URI reference to that provider's declaration"
- **Implemented by.** publisher: src/normalize.ts assertUpstream; src/validate.ts; consumer: src/validate.ts; src/schema.ts; tools: CDDL upstream: [+ upstream-entry]
- **Verified by.** UT: publisher/test/normalize.test.ts; consumer/test/validate.test.ts. BDD: @REQ-UPS-01 (e: upstream [], an entry {}, a string entry; x: an entry with an unknown member is valid; g: an upstream with two entries, each with declaration, is accepted). SCH: example-1.json, R14 (upstream []), I34 (entry without declaration), V08 (unknown member in an entry).

#### REQ-UPS-02 (Ubiquitous, Section 3.5)

- **EARS.** The publisher shall emit role only as hosting, colocation, cloud, cdn, network or electricity and shall omit it for any other kind of provider; the consumer and both schemas shall reject any other value as served.
- **Draft (Section 3.5).** "colocation (space, power, and cooling for the target's own equipment) [...] an OPTIONAL role member, one of hosting, colocation, cloud, cdn, network, and electricity, for those six kinds of provider; an entry for any other provider has no role." [req-9299a528]
- **Implemented by.** publisher: src/tokens.ts UPSTREAM_ROLES, isUpstreamRole; src/normalize.ts assertUpstream throws on another value; consumer: src/tokens.ts (copy); src/validate.ts; src/schema.ts enum; gateway: data/*.json; one new facility file with a colocation upstream; tools: CDDL enum; sustainability-publisher upgrade rule 9 removes an unknown role and keeps declaration
- **Verified by.** UT: publisher/test/tokens.test.ts; consumer/test/schema.test.ts (table of six); consumer/test/sentinel.test.ts. BDD: @REQ-UPS-02 (Outline over the six; e: transit, Cloud, colo; g: an entry without role; x: compatibility reading drops the role and keeps the entry). SCH: all-role-* (6), pos-role-* (5), pos-upstream-role-electricity.json, pos-upstream-without-role.json, neg-role-transit.json, neg-upstream-role-transit.json, neg-upstream-role-case-variant.json.

#### REQ-UPS-03 (Ubiquitous, Section 3.5)

- **EARS.** The gateway and the publisher shall be able to publish a tenant declaration (target-type tenant, target an identifier chosen by the provider) at any URI the operator chooses, not only at the well-known path.
- **Draft (Section 3.5).** "A provider that reports what it delivers to one customer publishes a declaration whose target-type is tenant and whose target is an identifier of its choosing, at any URI it chooses, for example one it gives that customer"
- **Implemented by.** publisher: src/server.ts and middleware: extra routes serve a tenant declaration (HandlerOptions.path); gateway: data/tenant-demo.example.json and data/cloud-demo.example.json served at their own URIs; registry routes; kits: deploy examples show a tenant route
- **Verified by.** UT: publisher/test/server.test.ts; gateway/test/routes.test.ts; gateway/test/registry.test.ts. BDD: @REQ-UPS-03 (g: tenant declaration at /tenants/acme.json with Content-Type of the registered type; x: its target is an opaque identifier, not a host; e: a tenant declaration whose target is empty is invalid). SCH: all-tt-tenant.json, example-1.json (the cloud provider's tenant object described in Section 4.1).

#### REQ-UPS-04 (Event-driven, Section 3.5)

- **EARS.** When the consumer is asked to follow upstream declarations, it shall retrieve each declaration at the URI the entry names (resolved per REQ-URF-02, at any path), apply the same media-type, size and validation rules as for a top-level declaration, and continue with that declaration's own upstream entries within the bounds of REQ-SEC-10a to REQ-SEC-10c.
- **Draft (Section 3.5).** "its own upstream member, if any, names its sources in turn."
- **Implemented by.** consumer: src/upstream.ts compareUpstream, retrieve(); src/fetch.ts followUpstream option; gateway: src/upstream via the consumer; gateway/test/upstream.test.ts; tools: sustainability-fetch --follow-upstream
- **Verified by.** UT: consumer/test/upstream.test.ts; gateway/test/upstream.test.ts. BDD: @REQ-UPS-04 (g: a two-level chain; e: an upstream URL answering text/html is reported, not parsed; x: an upstream served at a non-well-known path is retrieved). SCH: -.

#### SIG - The signed member (Section 3.6)

#### REQ-SIG-01 (Ubiquitous, Section 3.6)

- **EARS.** The publisher shall write signed as a JWS Compact Serialization whose payload is the JSON serialization, made by the publisher, of the object without the signed member.
- **Draft (Section 3.6).** "The value of signed is a JSON Web Signature in the JWS Compact Serialization ([RFC7515], Section 7.1) whose payload is the declaration object in which it appears, without the signed member, serialized as JSON by the publisher. [...] A signature over this object (Section 3.6)."
- **Implemented by.** publisher: src/jws.ts signDeclaration, signAttached, signDocument (jose CompactSign); gateway: src/adapters/self-report.ts signing; tools: sustainability-sign F F --key K.jwk writes the same form; sfc-compliance
- **Verified by.** UT: publisher/test/jws.test.ts; consumer/test/jws.test.ts (round trip). BDD: @REQ-SIG-01 (g: signed object verifies; e: signed value that is not three base64url parts is unverified; x: payload decodes to the object without signed). SCH: example-response-signed.json (re-signed with Ed25519).

#### REQ-SIG-02 (Ubiquitous, Section 3.6)

- **EARS.** The publisher and sustainability-sign shall sign each object of an array separately and shall not sign the array as a whole.
- **Draft (Section 3.6).** "In an array each signed object carries its own signed member."
- **Implemented by.** publisher: src/jws.ts signDocument maps over the array; tools: sustainability-sign handles files holding an array and the gateway {document} wrapper
- **Verified by.** UT: publisher/test/jws.test.ts. BDD: @REQ-SIG-02 (g: a signed monthly array verifies object by object; x: one unsigned object among signed ones is reported unsigned for that object only; e: a signature that covers the whole array is reported unverified for each object). SCH: S03 (signed-array).

#### REQ-SIG-03 (Ubiquitous, Section 3.6)

- **EARS.** The publisher shall sign only with alg Ed25519 (default) or ES256, shall refuse to generate or sign with EdDSA, none or any HMAC algorithm, and shall import a 0.7.x EdDSA private key as an Ed25519 key without changing its kid.
- **Draft (Section 3.6).** "The JOSE Header MUST contain alg naming an asymmetric digital-signature algorithm; Ed25519 ([RFC9864], with the key representation of [RFC8037]) and ES256 ([RFC7518], Section 3.4) are RECOMMENDED, and none and MAC algorithms MUST NOT be used, since a consumer shares no secret with the publisher." [req-0a3342fc]
- **Implemented by.** publisher: src/jws.ts SigningAlg = "Ed25519" | "ES256", generateSigningKey, importSigningKey (algForJwk from kty/crv), exportPrivateJwk; src/cli.ts keygen --alg; tools: sustainability-sign; keygen refuses --alg EdDSA with a message naming Ed25519
- **Verified by.** UT: publisher/test/jws.test.ts (header alg is Ed25519; kid of an old key unchanged; HS256 and none refused). BDD: @REQ-SIG-03 (g: header alg Ed25519 and ES256; e: a request to sign with HS256 or none is refused; x: old EdDSA JWK file signs as Ed25519). SCH: -.

#### REQ-SIG-04 (Ubiquitous, Section 3.6)

- **EARS.** The publisher shall put cty with the value sustainability-data+json in the protected header of every signature it makes.
- **Draft (Section 3.6).** "The header MUST also contain cty ([RFC7515], Section 4.1.10) with the value sustainability-data+json, which distinguishes it from a JWS made for another purpose." [req-6b141664]
- **Implemented by.** publisher: src/jws.ts SIGNED_CTY; tools: sustainability-sign
- **Verified by.** UT: publisher/test/jws.test.ts. BDD: @REQ-SIG-04 (g: decoded header has cty; x: the header is protected (integrity covered); e: a signature made without cty, or with cty only in the unprotected header, is refused by the publisher test). SCH: -.

#### REQ-SIG-05 (Ubiquitous, Section 3.6)

- **EARS.** The publisher shall embed the public key as jwk in the header by default (x5c when a certificate chain is supplied), and, where the operator distributes the key out of band, shall identify it with kid alone.
- **Draft (Section 3.6).** "The header SHOULD carry the verification key as jwk or x5c, so that verification needs nothing but the declaration; a publisher that distributes its key out of band MAY instead identify it with kid." [req-2a853416]
- **Implemented by.** publisher: src/jws.ts SignOptions.embedKey (jwk | x5c | kid-only); kid is the JWK thumbprint; tools: sustainability-sign --kid-only
- **Verified by.** UT: publisher/test/jws.test.ts. BDD: @REQ-SIG-05 (g: jwk embedded; g: kid-only header verifies against a pinned key; x: the private key members are never embedded; e: a header with neither jwk, x5c nor an out-of-band key gives unverifiable). SCH: -.

#### REQ-SIG-06 (Event-driven, Section 3.6)

- **EARS.** When the publisher regenerates an object, it shall regenerate that object's signature in the same step, and shall never serve an object whose signed value was made for an earlier version; sustainability-publisher upgrade shall not carry a signed value over.
- **Draft (Section 3.6).** "A publisher that regenerates an object regenerates its signature in the same step."
- **Implemented by.** publisher: src/publisher.ts build(): adapter, normalize, secureReports, select, validate, sign in one pass; the cache stores the signed result; gateway: src/adapters/self-report.ts, scripts that rebuild gateway/data sign in the same command; tools: sustainability-publisher upgrade removes signed (rule 12) and tells the operator to run sustainability-sign
- **Verified by.** UT: publisher/test/server.test.ts; publisher/test/jws.test.ts; publisher/test/upgrade.test.ts (new). BDD: @REQ-SIG-06 (g: a regenerated month verifies; e: an object changed after signing is reported unverified by the consumer; x: upgrade output has no signed). SCH: -.

#### FRM - Formal definition (Section 3.7)

#### REQ-FRM-01 (Ubiquitous, Section 3.7)

- **EARS.** The repository's response-schema.cddl shall be byte-identical to the CDDL block of the draft, and the CDDL validator shall support the .cat and .regexp controls.
- **Draft (Section 3.7).** "The structure of a declaration is described in CDDL [RFC8610]."
- **Implemented by.** tools: schemas-validators/response-schema.cddl; validate-all.sh runs the Ruby gem cddl 0.12.14 (supports .cat and .regexp; the npm cddl 0.23.0 cannot parse the -10 CDDL, so it is not used); internet-drafts/build.sh compares the block
- **Verified by.** UT: fitness/repository-invariants.test.mjs; schemas-validators/validate-all.sh. BDD: none, fitness test only (fitness/repository-invariants.test.mjs; schemas-validators/validate-all.sh). SCH: all 104 ex/ files through validate-all.sh.

#### REQ-FRM-02 (Ubiquitous, Section 3.7)

- **EARS.** The closed token sets shall be identical in the CDDL, the three JTD copies (publisher/src/schema.ts, consumer/src/schema.ts, schemas-validators/response-schema.json) and tokens.ts, and publisher/src/tokens.ts, publisher/src/period.ts and their consumer copies shall be byte-identical.
- **Draft (Section 3.7).** "measurement-method: "hardware-metered" / "hardware-estimated" / "cloud-billing" / "third-party-modeled""
- **Implemented by.** publisher: src/tokens.ts, src/period.ts, src/schema.ts; consumer: src/tokens.ts, src/period.ts, src/schema.ts (copies); tools: schemas-validators/response-schema.json; kits: kit lists (WordPress, one-click, Home Assistant, create-sustainability-data) are checked by the same rule
- **Verified by.** UT: consumer/test/tokens-parity.test.ts and period-parity.test.ts (new); consumer/test/schema.test.ts; fitness/repository-invariants.test.mjs (closed token sets agree everywhere). BDD: @REQ-FRM-02 (g: arrays equal enums; e: a copy that drifts by one byte fails CI; x: a token added to the CDDL only fails the parity test naming the file). SCH: -.

#### REQ-FRM-03 (Ubiquitous, Section 3.7)

- **EARS.** The CDDL and every JTD schema shall accept unknown top-level members and unknown members of period and of an upstream entry, so that the schemas check form and the publisher's own gate (REQ-BDY-07) enforces the closed member list.
- **Draft (Section 3.7).** "Top-level members that this document does not define are ignored, as Section 3.1 says. [...] Members a later revision may define; a consumer ignores them"
- **Implemented by.** publisher: src/schema.ts additionalProperties true; consumer: src/schema.ts additionalProperties true; tools: response-schema.cddl * tstr => any in three places
- **Verified by.** UT: publisher/test/schema.test.ts; consumer/test/schema.test.ts. BDD: @REQ-FRM-03 (g: unknown members validate; e: an undefined top-level member passes the schemas and is refused by the publisher gate (REQ-BDY-07); x: an unknown member nested inside an extension value is accepted). SCH: V08.

#### REQ-FRM-04 (Ubiquitous, Section 3.7)

- **EARS.** The code gate DATE_TIME_RE shall equal the CDDL regular expression character for character, anchored at both ends, and a value that passes it shall still be rejected by the consumer and the publisher gate when it names no real date and time (month 13, 30 February, hour 24, offset +99:99); the CDDL accepts such a value.
- **Draft (Section 3.7).** "It matches the upper-case form that Section 3.2 prescribes and checks only the form of a value; whether the value names a real date and time is a matter of [RFC3339]. [...] The .cat operator is the string concatenation operator of [RFC9165], Section 2.2; the regular expression it builds is an I-Regexp ([RFC9485])"
- **Implemented by.** publisher: src/period.ts DATE_TIME_RE, dateTimeError (form gate then Temporal); consumer: src/period.ts (copy); tools: a fitness test extracts the regular expression from the draft and compares it with the code
- **Verified by.** UT: publisher/test/period.test.ts; fitness/repository-invariants.test.mjs. BDD: @REQ-FRM-04 (e: 2025-02-30T00:00:00Z passes the CDDL and fails the code gate; x: leading and trailing garbage fail; g: 2025-01-01T00:00:00Z passes the form gate and Temporal). SCH: I16, I17 (also the draft-build files neg-leading-garbage-anchoring.json and neg-trailing-garbage-anchoring.json), R11 (impossible date: the CDDL accepts it, the code rejects it; kept out of the CDDL suite).

#### REQ-FRM-05 (Ubiquitous, Sections 3.7 and 4)

- **EARS.** Every manifest entry gets the verdict of `manifest.json` from both schema validators and from the consumer's validateDocument, and [] passes.
- **Draft (Sections 3.7 and 4).** "A small conformant declaration carries the seven mandatory members and at least one metric or evidence link; this one also classifies its target and states its unit:"
- **Implemented by.** publisher: publisher/test/conformance.test.ts validates every example-responses file with the gate; consumer: consumer/test/interop.test.ts; gateway: gateway/test/examples-live.test.ts requires byte identity of gateway/examples with example-responses; tools: schemas-validators/validate-all.sh reads manifest.json (CDDL and JTD validators on different libraries); the corpus and its manifest are owned by the design
- **Verified by.** UT: schemas-validators/validate-all.sh; publisher/test/conformance.test.ts; consumer/test/interop.test.ts; gateway/test/examples-live.test.ts. BDD: @REQ-FRM-05 (g: every entry marked valid or tolerated gets its manifest verdict; e: every entry marked invalid or prose gets its manifest verdict; x: the one entry the manifest records as failing a single engine (leap-second, J(py)-) fails that engine only). SCH: the whole 04 corpus, each entry with its manifest verdict.

#### EXM - Examples (Section 4)

#### REQ-EXM-01 (Ubiquitous, Sections 1 and 4.1)

- **EARS.** The repository shall keep the Introduction example and the Section 4.1 example verbatim in example-responses (and gateway/examples), and both shall validate under both schemas, the consumer and the BDD suite.
- **Draft (Sections 1 and 4.1).** "A static file written from the organization's annual report. [...] It names the cloud provider whose tenant-scoped declaration covers what the organization consumed there, and carries two extensions: [...] has "target-type": "tenant" and "target": "acme", and its energy-consumption and carbon-footprint are what the cloud provider states it delivered to that tenant in 2025. [...] water and waste figures under an "https" name the organization defined, and one member defined by an industry group under a UUID URN."
- **Implemented by.** publisher: publisher/test/conformance.test.ts; consumer: consumer/test/interop.test.ts; gateway: gateway/test/examples-live.test.ts; tools: schemas-validators/validate-all.sh; example-0.json, example-1.json
- **Verified by.** UT: as listed. BDD: @REQ-EXM-01 (g: Section 4.1 declares a cloud upstream with role and two extensions; its tenant-scoped declaration has target-type tenant and target acme; e: the Introduction example with one byte changed fails the verbatim check; x: gateway/examples holds a byte-identical copy). SCH: example-0.json, example-1.json.

#### REQ-EXM-02 (Event-driven, Section 4.2)

- **EARS.** When a request carries start=2025-01-01T00:00:00Z, end=2026-01-01T00:00:00Z and granularity=monthly, the publisher shall return one object per whole month it holds, and when granularity is absent it shall return the year object as well, if it holds one.
- **Draft (Section 4.2).** "GET /.well-known/sustainability-data with the query parameters start=2025-01-01T00:00:00Z, end=2026-01-01T00:00:00Z, and granularity=monthly. [...] A publisher that holds monthly figures returns one object per month; two are shown. Without granularity the same publisher would also return the object for the whole year, if it holds one."
- **Implemented by.** publisher: src/selection.ts; gateway: src/app.ts; scenario in 02-extended-query.feature
- **Verified by.** UT: publisher/test/selection.test.ts; gateway/test/self-extended.test.ts. BDD: @REQ-EXM-02 (g: monthly query returns the months only; g: the same query without granularity returns months and the year; e: the same request on a publisher that holds only 2026 returns []; x: the January month and the year object share a start, and the order follows REQ-QRY-10). SCH: example-2.json.

#### REQ-EXM-03 (Event-driven, Section 4.3)

- **EARS.** When a request carries target=/api/v1, the publisher shall return an array that holds the path object alone, and the March period with +08:00 bounds shall be recognised as a whole calendar month.
- **Draft (Section 4.3).** "the API under the path prefix /api/v1, which target-type classifies as a path. [...] A request with ?target=/api/v1 would return an array holding the second object alone. [...] both bounds carry that offset, and the period is the whole calendar month of March in it"
- **Implemented by.** publisher: src/selection.ts; src/period.ts; gateway: src/examples.ts
- **Verified by.** UT: publisher/test/selection.test.ts; publisher/test/period.test.ts. BDD: @REQ-EXM-03 (g: array with the second object only; x: the +08:00 month is whole; e: ?target=/api returns []). SCH: example-3.json.

#### REQ-EXM-04 (Event-driven, Section 4.4)

- **EARS.** When a request carries target=/app/storage, start=2026-03-20T00:00:00Z and end=2026-03-21T00:00:00Z, the publisher shall return the one-object array of Section 4.4, signed, with measurement-method unchanged by the emission factor.
- **Draft (Section 4.4).** "Its measurement-method stays hardware-estimated although scope 3 comes from an emission factor (Section 3.2). The signed value is a JWS whose payload is this object without signed"
- **Implemented by.** publisher: src/selection.ts; src/jws.ts; consumer: consumer verifies it (pinned key in the test); gateway: src/examples.ts; example-response-signed.json re-signed with Ed25519
- **Verified by.** UT: publisher/test/selection.test.ts; consumer/test/signature.test.ts. BDD: @REQ-EXM-04 (g: request returns the signed array; the signature verifies; e: the same request for another day returns []; x: the returned object's signature still verifies after selection). SCH: example-4.json.

#### CLM - Self-asserted claims (Section 5.1)

#### REQ-CLM-01 (Unwanted behaviour, Section 5.1)

- **EARS.** If a declaration or a member is present, then the consumer shall not treat it as verification of any claim and shall derive no verified status from retrieval, from a signature, from verifiable-attestation-uri or from conformance.
- **Draft (Section 5.1).** "Retrieval establishes that the origin published these claims and nothing more: a consumer MUST NOT treat the presence of a declaration, or of any member in it, as verification of a claim" [req-3229f5af]
- **Implemented by.** consumer: src/types.ts SignatureResult and attestation results never map to a boolean 'accurate'; src/cli.ts wording; gateway: src/validate.ts and the badge say conformant, never verified; tools: sustainability-fetch output vocabulary (REQ-VER-11)
- **Verified by.** UT: consumer/test/cli.test.ts; gateway/test/validate.test.ts. BDD: @REQ-CLM-01 (g: an unsigned conformant declaration is printed as a claim of the origin; e: a declaration with verifiable-attestation-uri is not printed as attested before validation; x: a signed and attested declaration is still presented as a claim of the origin). SCH: -.

#### REQ-CLM-02 (Unwanted behaviour, Section 5.1)

- **EARS.** If the consumer, the gateway or a tool presents, stores or forwards declaration data, then it shall not represent the data as verified, certified, approved or endorsed, and exports shall carry the claim's origin and the signature status.
- **Draft (Section 5.1).** "and one that presents, stores, or forwards the data MUST NOT represent it as verified. [...] These are processing rules on conforming consumers, not statements about what any party may conclude by other means." [req-3229f5af]
- **Implemented by.** consumer: src/transform.ts exports include claimed-by and signature columns; gateway: src/index-page.ts, src/legal.ts, README wording; badge text; tools: tools/report-to-declaration output header; fitness test greps user-facing strings for forbidden words; kits: deploy READMEs
- **Verified by.** UT: fitness/repository-invariants.test.mjs (forbidden words: verified figure, certified, approved, endorsed, IETF standard, registered); consumer/test/transform.test.ts. BDD: @REQ-CLM-02 (g: CSV export has claimed-by; e: a page that says verified fails the fitness rule; x: the word verified inside a provider value is data and not output wording). SCH: -.

#### REQ-CLM-03 (Ubiquitous, Section 5.1)

- **EARS.** The consumer shall attribute every value to the origin of the URL that served the final response, after redirects, and not to the origin first requested.
- **Draft (Section 5.1).** "Every value in a declaration is a claim of the publisher of the origin that served the final response."
- **Implemented by.** consumer: src/fetch.ts finalUrl origin as the claimant; every redirect hop must be https (REQ-SEC-11b); gateway: src/verify.ts, src/validate.ts attribute to the final host
- **Verified by.** UT: consumer/test/fetch.test.ts. BDD: @REQ-CLM-03 (g: no redirect: claimant is the requested origin; x: a redirect to another host attributes to the other host; e: a redirect to another origin never attributes the figures to the first origin). SCH: -.

#### REQ-CLM-04 (Optional feature, Section 5.1)

- **EARS.** Where the caller asks for evidence, the consumer shall follow disclosure-uri, verifiable-attestation-uri and the upstream declarations on request only; by default it shall make no request beyond the declaration itself.
- **Draft (Section 5.1).** "The declaration is a discovery mechanism: a consumer that needs evidence follows methodology-uri, disclosure-uri, verifiable-attestation-uri, and the upstream declarations, and checks claims against external sources when it matters. [...] A consumer needs no link, follows one only within the rules below, and never takes a key fetched from a header URI as obtained out of band (Section 5.4)."
- **Implemented by.** consumer: src/fetch.ts options followUpstream, verifyAttestation, fetchDisclosure (default off); src/cli.ts flags; tools: sustainability-fetch --follow-upstream, --verify-attestation, --disclosure
- **Verified by.** UT: consumer/test/fetch.test.ts (recording server counts requests); consumer/test/cli.test.ts. BDD: @REQ-CLM-04 (g: default fetch makes one request; x: each option adds only its own requests; e: --disclosure on a declaration with no disclosure-uri makes no request and says so). SCH: -.

#### ORG - Parts of an origin (Section 5.2)

#### REQ-ORG-01 (Ubiquitous, Section 5.2)

- **EARS.** The tools and the gateway shall describe the figures of a part (service, path, device, product) as the publisher's allocation by the method the methodology document describes.
- **Draft (Section 5.2).** "Parts of one origin, such as a service, a path prefix, a device, or a product, may be measured or estimated separately. [...] Such an object's figures are the publisher's allocation of the origin's or the organization's resources to that part, by the method the methodology document describes. [...] The service's figures are the publisher's allocation of shared resources to that service (Section 5.2); the methodology document says how."
- **Implemented by.** gateway: gateway/METHODOLOGY.md; src/index-page.ts labels; tools: tools/create-sustainability-data methodology stub (allocation heading)
- **Verified by.** UT: gateway/test/legal.test.ts. BDD: @REQ-ORG-01 (g: the Section 4.3 path object is labelled as an allocation; e: a page that presents the path object as the path's own measurement fails the legal test; x: a device and a product object carry the same allocation label). SCH: example-3.json.

#### REQ-ORG-02 (Unwanted behaviour, Section 5.2)

- **EARS.** If the figures of the parts do not add up to the figure of the whole, then the consumer shall report no error and no warning and shall not scale, complete or reconcile them.
- **Draft (Section 5.2).** "Parts need not add up to the whole, since infrastructure is shared and estimation intervenes, and a consumer does not assume that they do"
- **Implemented by.** consumer: src/validate.ts and src/transform.ts contain no parts-equal-whole check
- **Verified by.** UT: consumer/test/validate.test.ts; consumer/test/transform.test.ts. BDD: @REQ-ORG-02 (g: Section 4.3 path 8.6 kg beside origin 12.7 kg; x: parts that sum to 140 percent of the whole are accepted silently; e: a total over the whole and a part is refused by REQ-ORG-03, while the comparison itself raises nothing). SCH: example-3.json (V04).

#### REQ-ORG-03 (Ubiquitous, Section 5.2)

- **EARS.** The consumer shall accept the whole and its parts in one array and shall never add them to each other in a total (a total is for one target, REQ-TOT-03).
- **Draft (Section 5.2).** "the whole and its parts may be present together."
- **Implemented by.** consumer: src/transform.ts total() rejects mixed targets
- **Verified by.** UT: consumer/test/transform.test.ts. BDD: @REQ-ORG-03 (e: total over the origin object and the path object is refused; g: an array holding the origin object and the path object is accepted; x: three levels (origin, service, path) in one array). SCH: example-3.json.

#### TOT - Periods, totals and freshness (Section 5.3)

#### REQ-TOT-01 (Ubiquitous, Section 5.3)

- **EARS.** The consumer shall present a figure with the period its two bounds name and shall infer no wider or later coverage from it.
- **Draft (Section 5.3).** "A period is what its two bounds say, and no more."
- **Implemented by.** consumer: src/cli.ts and src/transform.ts show period.start and period.end for every figure; gateway: src/index-page.ts shows the period of each object
- **Verified by.** UT: consumer/test/cli.test.ts. BDD: @REQ-TOT-01 (g: output shows 2025-01-01T00:00:00Z to 2026-01-01T00:00:00Z; e: a figure for 2025 is never shown as covering 2026; x: a 12-hour period is shown with both bounds). SCH: -.

#### REQ-TOT-02 (Unwanted behaviour, Section 5.3)

- **EARS.** If selected objects of one target overlap, as a year and its months do, then the consumer shall refuse to add them and shall say which periods overlap.
- **Draft (Section 5.3).** "A year and its months are two views of the same figures, not additional ones."
- **Implemented by.** consumer: src/transform.ts total() throws TotalError("overlap") using periodsOverlap
- **Verified by.** UT: consumer/test/transform.test.ts. BDD: @REQ-TOT-02 (e: year plus twelve months refused; g: twelve months alone summed; x: December and January meet and do not overlap). SCH: example-2.json.

#### REQ-TOT-03 (Event-driven, Section 5.3)

- **EARS.** When the consumer computes a total, it shall add energy-consumption, carbon-footprint, scope-1, scope-2 and scope-3 after conversion to one unit, only across objects of one target (string equality), with no two periods overlapping and with the same carbon-accounting value on every object or none on any; it shall not add sci-score, carbon-intensity, renewable-energy or estimated-annual-emissions-kgCO2e.
- **Draft (Section 5.3).** "A consumer that wants a total adds energy-consumption, carbon-footprint, and the scope members, after conversion to one unit, across objects for one target whose periods do not overlap and that declare the same carbon-accounting value or none; two periods that meet, one's end being the next one's start, do not overlap."
- **Implemented by.** consumer: src/transform.ts total() (aggregate kept as a deprecated alias for one minor version; by: "average" dropped); src/units.ts; tools: sustainability-fetch --total
- **Verified by.** UT: consumer/test/transform.test.ts. BDD: @REQ-TOT-03 (g: twelve months of one target, kWh and MWh mixed, summed in kWh; e: two targets, mixed accounting, accounting present on some and absent on others, objects that overlap; x: scope-1 negative; twins with the same period overlap and are refused). SCH: example-2.json.

#### REQ-TOT-04 (Optional feature, Section 5.3)

- **EARS.** Where the client keeps readings between calls (the freshness cache is deferred, library L10 and question Q5 of the design), the consumer shall regard a stored reading as current while it is within the freshness lifetime of the response that carried it, using http-cache-semantics, and may use it without a new request.
- **Draft (Section 5.3).** "A reading is current for the freshness lifetime of the response that carried it ([RFC9111], Section 4.2)"
- **Implemented by.** consumer: src/client.ts optional cache (http-cache-semantics ^4.3.0, only if the feature is added); without it the consumer stores nothing and every use is a new request
- **Verified by.** UT: consumer/test/fetch.test.ts (fixed clock). BDD: @REQ-TOT-04 (g: second read inside max-age makes no request; x: no Cache-Control uses heuristic freshness only if the caller allows it; e: a reading older than max-age triggers a new request (REQ-TOT-05)). SCH: -.

#### REQ-TOT-05 (Event-driven, Section 5.3)

- **EARS.** When the consumer relies on a reading older than its freshness lifetime, or one it cannot show to be fresh, it shall revalidate first with a conditional request (ETag, Last-Modified) and, on 304, keep the reading and extend its lifetime.
- **Draft (Section 5.3).** "a consumer that keeps it longer revalidates before relying on it"
- **Implemented by.** consumer: src/fetch.ts If-None-Match / If-Modified-Since, status not-modified
- **Verified by.** UT: consumer/test/fetch.test.ts (fixed clock). BDD: @REQ-TOT-05 (g: stale reading triggers If-None-Match; e: 200 replaces the reading; x: 304 keeps it). SCH: -.

#### REQ-TOT-06 (Ubiquitous, Section 5.3)

- **EARS.** The consumer shall present figures as covering their period with the retrieval time and freshness, and shall not label them as current.
- **Draft (Section 5.3).** "and presents the figures as covering their period, not as current."
- **Implemented by.** consumer: src/cli.ts and FetchResult carry retrievedAt and freshUntil; gateway: src/index-page.ts and /validate show period and retrieval time
- **Verified by.** UT: consumer/test/cli.test.ts; gateway/test/validate.test.ts. BDD: @REQ-TOT-06 (g: output says covers 2025, retrieved at T; e: the word current never appears next to a figure; x: a response with no freshness information shows the retrieval time and no freshUntil). SCH: -.

#### VER - Verifying a signature (Section 5.4)

#### REQ-VER-01 (Unwanted behaviour, Section 5.4)

- **EARS.** If alg is none or a MAC algorithm (HS256, HS384, HS512), in any letter case, then the consumer shall reject the signed member, report the object unverified with reason alg-none or mac-alg, and not use the key.
- **Draft (Section 5.4).** "A consumer that verifies signed MUST reject the member when alg is none or a MAC algorithm" [req-37bd6981]
- **Implemented by.** consumer: src/jws.ts verifyJws SUPPORTED_ALGS allow-list; VerifyReason; gateway: src/verify.ts calls the consumer's signature check
- **Verified by.** UT: consumer/test/jws.test.ts; consumer/test/signature.test.ts. BDD: @REQ-VER-01 (e: alg none, None, HS256 with the public key used as secret; g: Ed25519 and ES256 accepted; x: a header with no alg at all). SCH: -.

#### REQ-VER-02 (Unwanted behaviour, Section 5.4)

- **EARS.** If cty is absent or names any media type other than application/sustainability-data+json, then the consumer shall reject the signed member; the value sustainability-data+json is the same media type with application/ prepended (RFC 7515, Section 4.1.10).
- **Draft (Section 5.4).** "when cty is absent or identifies any other media type" [req-37bd6981]
- **Implemented by.** consumer: src/jws.ts DECLARATION_CTY, cty normalisation; VerifyReason cty-missing, cty-wrong
- **Verified by.** UT: consumer/test/jws.test.ts. BDD: @REQ-VER-02 (e: cty absent; cty application/vc+jwt; cty sustainability-data+json+x; g: short and full form both accepted; x: letter case of the media type). SCH: -.

#### REQ-VER-03 (Unwanted behaviour, Section 5.4)

- **EARS.** If the header carries crit naming any parameter the consumer does not understand, or an empty or malformed crit, then the consumer shall reject the signed member.
- **Draft (Section 5.4).** "or when the header carries a crit parameter the consumer does not understand." [req-37bd6981]
- **Implemented by.** consumer: src/jws.ts (the consumer understands no critical parameter); VerifyReason crit-unknown
- **Verified by.** UT: consumer/test/jws.test.ts. BDD: @REQ-VER-03 (e: crit ["exp"] with exp present, crit [], crit naming a registered but not understood name; g: no crit; x: crit with a duplicated name). SCH: -.

#### REQ-VER-04 (Ubiquitous, Section 5.4)

- **EARS.** The consumer shall choose the acceptable algorithm from the key type and its own policy and shall reject a header alg that does not fit the key (an Ed25519 key with ES256, an EC key with Ed25519, an oct key with any alg).
- **Draft (Section 5.4).** "It determines the acceptable algorithm from the key and its own policy, never from alg alone ([RFC8725], Sections 3.1 and 3.2)."
- **Implemented by.** consumer: src/jws.ts algForKey, verifyJws; embedded jwk of kty oct is refused
- **Verified by.** UT: consumer/test/jws.test.ts. BDD: @REQ-VER-04 (e: header alg ES256 with an OKP key; header alg RS256 with an EC key; x: EdDSA header with an Ed25519 key accepted with a deprecation warning (REQ-VER-13); g: an Ed25519 key with alg Ed25519 and a P-256 key with ES256 are accepted). SCH: -.

#### REQ-VER-05 (Unwanted behaviour, Section 5.4)

- **EARS.** If the verified payload is not a JSON object that validates as a declaration object, or carries a signed member, then the consumer shall report the object unverified with reason payload-not-declaration.
- **Draft (Section 5.4).** "On success it reads the payload as a declaration object; a consumer MUST treat the object as unverified when the payload is not one" [req-6f3b1824]
- **Implemented by.** consumer: src/signature.ts verifyEmbeddedSignature; src/validate.ts on the payload
- **Verified by.** UT: consumer/test/signature.test.ts. BDD: @REQ-VER-05 (e: payload is an array, a string, an object without mandatory members, an object that itself carries a signed member; g: payload is the object without signed; x: a payload with an extra unknown member that still validates is accepted). SCH: -.

#### REQ-VER-06 (Unwanted behaviour, Section 5.4)

- **EARS.** If the payload's target, period.start, period.end, carbon-accounting or functional-unit differs from the object's, compared as strings and not as instants, with a member absent from both counting as equal, then the consumer shall report the object unverified with reason payload-subject-mismatch.
- **Draft (Section 5.4).** "or when the payload's target, period.start, period.end, carbon-accounting, or functional-unit differs from the object's. These are compared as strings (Section 3.1), not as instants, and a member absent from both counts as equal." [req-6f3b1824]
- **Implemented by.** consumer: src/signature.ts MUST_AGREE_MEMBERS (target, period.start, period.end, carbon-accounting, functional-unit); gateway: src/verify.ts calls the consumer's signature check
- **Verified by.** UT: consumer/test/signature.test.ts. BDD: @REQ-VER-06 (e: a signature copied from the location-based twin onto the market-based twin; copied from per-request onto per-user; payload period.start +00:00 where the object says Z; g: both absent is equal; x: target host in different case is unverified). SCH: N06 to N10 (a signature moved between objects), accounting-pair.example.

#### REQ-VER-07 (State-driven, Section 5.4)

- **EARS.** While the key was obtained out of band, was pinned from an earlier retrieval, or was validated through an x5c chain to an anchor the consumer already trusts with an end-entity certificate that identifies the publisher, the consumer shall read the members of the verified payload in place of the members around it and shall report the key trust level.
- **Draft (Section 5.4).** "What a verified payload is worth depends on how far the key is trusted. [...] The payload's members take precedence over those around them when the key was obtained out of band, pinned from an earlier retrieval, or validated through an x5c chain to an anchor the consumer already trusts, with an end-entity certificate that identifies the publisher ([RFC9110], Section 4.3.4)."
- **Implemented by.** consumer: src/signature.ts trust levels out-of-band | pinned | x5c-anchored; certificate checks with node:crypto X509Certificate (checkHost, verify) rather than hand-written parsing; tools: sustainability-fetch --trusted-key FILE, --pin STORE, --trust-anchor PEM
- **Verified by.** UT: consumer/test/signature.test.ts; consumer/test/jws.test.ts. BDD: @REQ-VER-07 (g: a pinned key makes the payload's energy-consumption the one reported when the outer value was altered; x: x5c chain to a supplied anchor; an end-entity certificate for another host is not trusted; e: a key from an x5c chain to an unknown anchor is not promoted; the outer members stay in use). SCH: -.

#### REQ-VER-08 (Ubiquitous, Section 5.4)

- **EARS.** The consumer shall count a key as out of band only when the caller supplied it independently of the declaration, and shall never fetch or trust a key from a URI named by the declaration or its header (jku, x5u).
- **Draft (Section 5.4).** ""Out of band" means from a source the consumer chose independently of the declaration, never from a URI the declaration or its JOSE Header names."
- **Implemented by.** consumer: src/jws.ts ignores jku and x5u; no code path fetches a key
- **Verified by.** UT: consumer/test/jws.test.ts (a recording server sees no request for jku or x5u). BDD: @REQ-VER-08 (e: header with jku pointing at a local server: no request, key not trusted; g: a key the caller supplies from a file is out of band; x: a key fetched from the same origin earlier is not out of band unless pinned). SCH: -.

#### REQ-VER-09 (State-driven, Section 5.4)

- **EARS.** While the key is embedded in the declaration and no other trust applies, the consumer shall report the signature as valid for that embedded key only (key trust declaration-only) and shall keep using the members served by the origin.
- **Draft (Section 5.4).** "Any other key is trusted no further than the declaration carrying it, since whoever can publish the declaration can publish a key, and the members served by the origin remain the ones the consumer uses."
- **Implemented by.** consumer: src/signature.ts keyTrust "declaration-only"
- **Verified by.** UT: consumer/test/signature.test.ts. BDD: @REQ-VER-09 (g: embedded jwk verifies and is reported declaration-only; x: the outer members, not the payload, are reported; e: an embedded key that differs from a pinned key is pin-mismatch (REQ-VER-14), not declaration-only). SCH: -.

#### REQ-VER-10 (Unwanted behaviour, Section 5.4)

- **EARS.** If provider names a person or organization, then the consumer shall not match it against a certificate subject or a key and shall not say that the provider signed; it shall say that the holder of the key identified by its thumbprint signed.
- **Draft (Section 5.4).** "The payload includes provider, so a verified signature shows that the holder of the key signed that name, not that the name is the holder's: provider is never matched against a certificate or a key ([RFC7515], Section 10.3)."
- **Implemented by.** consumer: src/signature.ts and src/cli.ts wording; no comparison of provider with x5c subject
- **Verified by.** UT: consumer/test/signature.test.ts; consumer/test/cli.test.ts. BDD: @REQ-VER-10 (e: a certificate whose subject equals provider adds no trust; the output never reads signed by <provider>; g: the output says that the holder of the key with the given thumbprint signed; x: a provider equal to the x5c subject adds no trust). SCH: -.

#### REQ-VER-11 (Ubiquitous, Section 5.4)

- **EARS.** The consumer shall report a verified signature as integrity verified (continuity of authorship when pinned) and shall always state that accuracy is unknown, in one fixed vocabulary: claim of the origin; integrity verified; attested by an issuer; accuracy unknown.
- **Draft (Section 5.4).** "A verified signature establishes integrity and, with pinning, continuity of authorship; it establishes nothing about accuracy (Section 5.1)."
- **Implemented by.** consumer: src/cli.ts describeSignature, describeAttestation; FetchResult fields; gateway: src/validate.ts, badge
- **Verified by.** UT: consumer/test/cli.test.ts; gateway/test/validate.test.ts. BDD: @REQ-VER-11 (g: Appendix A step 6 outcome line is produced; e: the words accurate or true never follow a verified status; x: a pinned key adds continuity of authorship to the integrity line). SCH: -.

#### REQ-VER-12 (Ubiquitous, Section 5.4)

- **EARS.** The consumer shall report an absent signed member as unsigned without a fault, and a failed verification as unverified, never as false or invalid, and shall keep the object usable as a claim.
- **Draft (Section 5.4).** "An absent signed member means only that the publisher did not sign; one that fails to verify leaves the object unverified, never false."
- **Implemented by.** consumer: src/types.ts SignatureResult unsigned | verified | unverified; fetch status stays ok
- **Verified by.** UT: consumer/test/signature.test.ts; consumer/test/fetch.test.ts. BDD: @REQ-VER-12 (g: unsigned object has fetch status ok; e: a tampered signature gives unverified and the figures are still returned; x: an empty signed value is reported unverified, not unsigned). SCH: -.

#### REQ-VER-13 (Ubiquitous, Section 5.4)

- **EARS.** The consumer shall verify Ed25519 and ES256, and shall still verify EdDSA, reporting it verified with a deprecated-alg warning, because published 0.7.x files carry EdDSA until they are re-signed.
- **Draft (Section 5.4).** "Ed25519 ([RFC9864], with the key representation of [RFC8037]) and ES256 ([RFC7518], Section 3.4) are RECOMMENDED"
- **Implemented by.** consumer: src/jws.ts SUPPORTED_ALGS Ed25519, ES256, EdDSA; DEPRECATED_ALGS EdDSA; conformance detail text
- **Verified by.** UT: consumer/test/jws.test.ts (the pinned-key path reports the identifier from the header). BDD: @REQ-VER-13 (g: Ed25519 and EdDSA tokens both verify the same key; x: EdDSA gives a warning, ES256 does not; e: alg EdDSA with an EC key is rejected (REQ-VER-04)). SCH: -.

#### REQ-VER-14 (Unwanted behaviour, Section 6)

- **EARS.** If a pin or an out-of-band key exists for the origin and the declaration carries a different key, then the consumer shall report pin-mismatch, shall not accept the embedded key, and shall leave the object unverified.
- **Draft (Section 6).** "Out of scope, since a consumer cannot tell them from the publisher, are attackers that control the origin's server, its DNS zone, a certificate for its host, or the signing key; against the first three, a pinned or out-of-band key still reveals replaced signatures."
- **Implemented by.** consumer: src/signature.ts pin store comparison by JWK thumbprint; tools: sustainability-fetch --pin STORE
- **Verified by.** UT: consumer/test/signature.test.ts. BDD: @REQ-VER-14 (g: first retrieval pins; e: a re-signed object with a new key is reported pin-mismatch; x: the original key keeps verifying). SCH: -.

#### REQ-VER-15 (Ubiquitous, Section 6)

- **EARS.** The consumer shall report a verified signature as protecting only the other members of its own object, and shall not report the array around the object, the HTTP header fields or the retrieval URI as signed.
- **Draft (Section 6).** "For a consumer that trusts the signing key, the signed member protects the other members of its object beyond the TLS session (Section 5.4), but not the array around the object, the HTTP header fields, or the retrieval URI against which relative references resolve (Section 3.3.1)."
- **Implemented by.** consumer: src/cli.ts and FetchResult wording; src/signature.ts covers the object only; gateway: src/validate.ts output
- **Verified by.** UT: consumer/test/cli.test.ts. BDD: @REQ-VER-15 (g: the output says what is covered; x: an array with one signed and one unsigned object reports each separately; e: wording that says the HTTP header fields or the retrieval URI were signed fails the wording test). SCH: -.

#### EVD - Evidence and upstream consistency (Section 5.5)

#### REQ-EVD-01 (Unwanted behaviour, Section 5.5)

- **EARS.** If the consumer has not retrieved the attestation, validated it against an issuer it trusts and found that it covers the object's target and period (target equal as a string, attested period including the object's period as instants), then it shall not report the object as attested.
- **Draft (Section 5.5).** "An attestation at verifiable-attestation-uri speaks to their authenticity only once the consumer has retrieved it, validated it against an issuer it trusts, and found that it covers the object's target and period."
- **Implemented by.** consumer: src/attestation.ts verifyAttestation, checkBinding; trusted issuers supplied by the caller (jose verifies the credential JWT); gateway: src/adapters/self-report.ts attestation endpoint and gateway/test/attestation-tool.test.ts; tools: sustainability-fetch --verify-attestation --trusted-issuer FILE
- **Verified by.** UT: consumer/test/attestation.test.ts. BDD: @REQ-EVD-01 (g: valid credential from a trusted issuer covering target and period; e: no trusted issuer, wrong target, period not covered, expired, retrieval fails; x: issuer not independent of the publisher is recorded as such (Appendix A step 5)). SCH: -.

#### REQ-EVD-02 (Ubiquitous, Section 5.5)

- **EARS.** The consumer shall treat methodology-uri and disclosure-uri as links for people and for further retrieval, and shall draw no conclusion about a figure from them.
- **Draft (Section 5.5).** "The methodology document explains the figures. [...] disclosure-uri leads to the reports and certificates behind them."
- **Implemented by.** consumer: src/disclosure.ts
- **Verified by.** UT: consumer/test/disclosure.test.ts. BDD: @REQ-EVD-02 (g: links returned resolved; x: an unreachable link changes nothing; e: a methodology document that contradicts a figure changes nothing in the result). SCH: -.

#### REQ-EVD-03 (Optional feature, Section 5.5)

- **EARS.** Where the caller asks for an upstream comparison and an upstream publishes a tenant declaration for the same period (both bounds equal as instants), the consumer shall compare energy-consumption and carbon-footprint after conversion to one unit.
- **Draft (Section 5.5).** "Where an upstream publishes a tenant declaration about what it delivers to this target, a consumer MAY compare the two for the same period after conversion to one unit." [req-35a72fee]
- **Implemented by.** consumer: src/upstream.ts compareUpstream (tenant branch, periodsEqual, convertEnergy, convertCarbon); gateway: gateway/test/upstream.test.ts; tools: sustainability-fetch --follow-upstream
- **Verified by.** UT: consumer/test/upstream.test.ts. BDD: @REQ-EVD-03 (g: Section 4.1 organization against its cloud tenant declaration; x: MWh against kWh; periods in Z and +00:00 spelling match; e: periods that differ by one hour are not compared). SCH: example-1.json.

#### REQ-EVD-04 (Unwanted behaviour, Section 5.5)

- **EARS.** If the target's energy-consumption or carbon-footprint is smaller than the upstream's figure beyond rounding, then the consumer shall report an inconsistency between two claims to investigate and shall not change validity, status, exit code or conformance result because of it.
- **Draft (Section 5.5).** "A target whose declared scope covers what the upstream delivers cannot have consumed less energy, or caused fewer emissions, than the upstream states it delivered, rounding aside; a smaller figure is an inconsistency between two claims, to investigate, not a conformance failure."
- **Implemented by.** consumer: src/upstream.ts UpstreamComparison.inconsistencies; src/conformance.ts ignores it; tools: sustainability-fetch prints it; exit code unchanged even with --strict
- **Verified by.** UT: consumer/test/upstream.test.ts; consumer/test/conformance.test.ts. BDD: @REQ-EVD-04 (e: target 2.0 GWh, upstream 2.4 GWh; g: equal, and larger; x: difference inside rounding is silent). SCH: -.

#### REQ-EVD-05 (Ubiquitous, Section 5.5)

- **EARS.** The consumer shall compare each upstream separately, shall assume no share and no scope relation, shall compare carbon-footprint only when both objects declare the same carbon-accounting value or neither does, and shall word a finding conditionally (if the target's scope covers what the upstream delivers).
- **Draft (Section 5.5).** "The comparison is limited: the format does not say whether a target's scope covers a given upstream, carries no per-upstream share, and makes carbon-footprint comparable only where both objects declare the same carbon-accounting value or neither does."
- **Implemented by.** consumer: src/upstream.ts
- **Verified by.** UT: consumer/test/upstream.test.ts. BDD: @REQ-EVD-05 (e: location-based target against market-based upstream: carbon not compared, energy compared; x: two upstreams are not summed against the target; g: the same carbon-accounting value on both sides: carbon-footprint is compared). SCH: -.

#### SEC - Security considerations (Section 6)

#### REQ-SEC-01 (Ubiquitous, Section 6)

- **EARS.** The publisher shall emit no active content (no script, markup instruction or executable construct as a member of the format) and no compression of its own, and shall rely on HTTPS alone for transport security; HTTP content coding is the server's, applied by the web server.
- **Draft (Section 6).** "A declaration has no active content and no compression of its own, and in transit it relies on HTTPS (Section 2.1) for integrity, confidentiality, and the identity of the origin, and on nothing else."
- **Implemented by.** publisher: src/handler.ts (identity body; gzip only by the fronting server); src/validate.ts members are data types only; kits: proxy and static recipes enable HTTP compression at the server, not in the file
- **Verified by.** UT: publisher/test/server.test.ts. BDD: @REQ-SEC-01 (g: body served is plain UTF-8 JSON; x: Content-Encoding comes only from the fronting server; e: a member that would carry executable content is not defined, and an undefined member is refused (REQ-BDY-07)). SCH: -.

#### REQ-SEC-02 (Ubiquitous, Section 6)

- **EARS.** Each kit and the publisher documentation shall state the RFC 8615 Section 4 caution (nobody but the publisher may write under /.well-known/ on a shared origin) and the RFC 8725 practices the signing code follows (explicit algorithm, cty, no embedded secret).
- **Draft (Section 6).** "The security considerations of [RFC8615], Section 4, [RFC3986], Section 7, [RFC8259], Section 12, and [RFC9110], Section 17, apply, and those of [RFC7515], Section 10, and [RFC8725] apply to the signed member. [...] on a shared origin, through write access to /.well-known/ ([RFC8615], Section 4.1), or in an intermediary."
- **Implemented by.** publisher: README.md and USAGE.md security sections; gateway: gateway/GUIDE.md; kits: deploy/* READMEs; SIGNING-AND-ATTESTATION.md
- **Verified by.** UT: fitness/repository-invariants.test.mjs (each kit README has the section). BDD: none, fitness test only (fitness/repository-invariants.test.mjs). SCH: -.

#### REQ-SEC-03 (Optional feature, Section 6)

- **EARS.** Where the consumer or the gateway displays provider or target, it shall isolate the text with Unicode bidirectional isolates (FSI to PDI) so that bidirectional controls inside it cannot reorder the surrounding text, and it shall never present the value as verified (REQ-CLM-02) or the attestation as valid before REQ-EVD-01 is met.
- **Draft (Section 6).** "An attacker could publish false or selective figures, or a misleading or look-alike name, or bidirectional controls, in provider or target. [...] Every value is a claim of the origin's publisher and is never presented as verified (Section 5.1); an attestation counts only once validated (Section 5.5); a consumer that displays a name can isolate it from the surrounding text ([UAX9])."
- **Implemented by.** consumer: src/text.ts isolate; src/cli.ts; gateway: src/index-page.ts, /validate pages
- **Verified by.** UT: consumer/test/text.test.ts; gateway/test/live-requests.test.ts. BDD: @REQ-SEC-03 (e: provider with U+202E is displayed isolated; x: a provider that already contains PDI does not close the isolate early; g: an ordinary provider is wrapped in FSI and PDI and shown unchanged). SCH: V26 (hostile-strings; to be added to 04).

#### REQ-SEC-04 (Ubiquitous, Section 6)

- **EARS.** The consumer shall verify the certificate chain and host name on every https connection and shall offer no option that switches verification off.
- **Draft (Section 6).** "An attacker could read, alter, insert, or remove objects in transit, answer in the origin's place, or inject a redirect. HTTPS with certificate verification prevents each (Section 2.1; [RFC9110], Section 4.3.4)."
- **Implemented by.** consumer: src/transport.ts (no rejectUnauthorized override; allowInsecure only permits http for testing)
- **Verified by.** UT: consumer/test/transport.test.ts. BDD: @REQ-SEC-04 (e: a certificate for another host, an expired one, a self-signed one and one from an untrusted issuer are each refused and no body is read; x: there is no CLI flag to skip verification; g: a certificate for the right host from a trusted test CA is accepted). SCH: -.

#### REQ-SEC-05 (Optional feature, Section 6)

- **EARS.** Where the caller requires signatures, the consumer shall fail the response when any object lacks signed or fails verification, and shall name the object.
- **Draft (Section 6).** "Only a key trusted further than the declaration carrying it (Section 5.4) reveals an altered or re-signed object; a removed signature or a dropped or added unsigned object shows only to a consumer that expects every object signed."
- **Implemented by.** consumer: src/fetch.ts option requireSigned; src/cli.ts --require-signed; tools: GitHub Action input require-signed
- **Verified by.** UT: consumer/test/fetch.test.ts. BDD: @REQ-SEC-05 (g: all objects signed passes; e: one unsigned object among signed ones fails the policy; x: array of one object). SCH: -.

#### REQ-SEC-06 (Optional feature, Section 6)

- **EARS.** Where the consumer holds an earlier reading, it shall report replay-suspected when a verified object for the same target, period, carbon-accounting and functional-unit carries an earlier updated (compared as instants) than the stored one, shall keep the stored reading, and shall never claim that an object is the newest.
- **Draft (Section 6).** "An attacker could present a weak JWS, one made for something else or copied from another object, or replay an older signed object. [...] A consumer rejects alg none, a MAC algorithm, an unknown crit parameter, and a JWS made for another media type, and treats a copy as unverified when its target, period, accounting method, or functional unit differs from the object's (Section 5.4). A replayed object stays bound to its signed updated and period, so a consumer holding a later updated for the same target and period recognizes it; nothing shows that no newer object exists"
- **Implemented by.** consumer: src/signature.ts and src/fetch.ts replay check against a caller-supplied store; updated is read from the verified payload
- **Verified by.** UT: consumer/test/signature.test.ts (fixed clock). BDD: @REQ-SEC-06 (e: older updated replayed; g: newer updated replaces; x: the same updated is not a replay). SCH: -.

#### REQ-SEC-07 (Ubiquitous, Section 6)

- **EARS.** The publisher shall select without aggregating (REQ-QRY-16) and shall bound the work of a request; where a configured maximum would cut a selection it shall say so in its diagnostics, and the gateway shall hold at most 200 objects at any clock, so that no selection is cut: whole days for the last 120 days, plus all whole months and years since go-live.
- **Draft (Section 6).** "A server selects without aggregating (Section 2.2); the rules below bound what a server computes and what a consumer accepts."
- **Implemented by.** publisher: src/security.ts maxObjects (default 366) with a diagnostic when it cuts; src/selection.ts; gateway: src/config.ts LIMITS.maxArrayEntries (200); src/adapters/self-report.ts held set = whole days of the last 120 days plus all whole months and years since go-live, at most 200 objects at any clock, so that a range is never cut
- **Verified by.** UT: publisher/test/hardening.test.ts; gateway/test/self-extended.test.ts (held set at most 200 at any clock; no response of the suite is cut). BDD: @REQ-SEC-07 (g: at the fixed clock the held set is 83 objects and a range over the live window returns every object; e: a publisher whose maximum is 10 with 11 matching objects logs the omission; x: clock moved to 2027-12-31: the held set is at most 200 and granularity=daily returns 120; floor before cap order is kept). SCH: -.

#### REQ-SEC-08 (Ubiquitous, Section 6)

- **EARS.** The consumer shall limit the decoded bytes (default 10,000,000) and the objects (default 500) it accepts and the nesting depth (default 32), shall stop reading at the limit, and shall return too-large or too-many-objects, or invalid for depth, without using any part of the body.
- **Draft (Section 6).** "An attacker could send costly queries, or serve a body that is oversized, deeply nested, expanded by a content coding [...] MUST limit the bytes and objects it accepts and treat an excess as an error;" [req-b55a61c6]
- **Implemented by.** consumer: src/fetch.ts DEFAULT_MAX_BYTES, DEFAULT_MAX_OBJECTS, maxDepth (new); src/transport.ts readBodyCapped counts bytes after content decoding; gateway: src/config.ts LIMITS.maxDocumentBytes; tools: sustainability-fetch --max-bytes --max-objects
- **Verified by.** UT: consumer/test/fetch.test.ts; consumer/test/transport.test.ts. BDD: @REQ-SEC-08 (e: a body one byte over the limit; a gzip body that expands past it; 501 objects; nesting of 33; g: exactly at the limit; x: a stream that never ends is cut at the limit). SCH: -.

#### REQ-SEC-09 (Ubiquitous, Section 6)

- **EARS.** The consumer shall parse with the shared strict parser json.ts (lossless-json ^4.3.1 plus String.isWellFormed), shall treat every value as data, and shall reject an object that contains a duplicate member name or a string with an unpaired surrogate.
- **Draft (Section 6).** "SHOULD parse with a JSON parser hardened against untrusted input ([RFC8259], Section 12) and treat every value as data; one whose parser exposes duplicate member names SHOULD reject an object containing them;" [req-2feb22c3]
- **Implemented by.** publisher: src/json.ts for upgrade and sign input (util.ts, jws.ts, cli.ts reads); consumer: src/json.ts parseStrict (identical copy in the publisher, listed in the same identity check as period.ts and tokens.ts); used by src/fetch.ts, src/upstream.ts, src/jws.ts payload read and gateway/src/verify.ts; library choice L15 of the design (RUN: duplicate key throws)
- **Verified by.** UT: consumer/test/fetch.test.ts; publisher/test/hardening.test.ts; consumer/test/json-parity.test.ts (new, byte identity). BDD: @REQ-SEC-09 (e: {"a":1,"a":2} is rejected; a lone surrogate escape is rejected; __proto__ and constructor members stay plain data; x: a valid document with the same name in two different objects is accepted; g: a document with distinct member names parses and numbers read exactly). SCH: -.

#### REQ-SEC-10 (group heading, Section 6)

One draft sentence [req-6bbbce7c] holds three verifiable statements: REQ-SEC-10a (depth), REQ-SEC-10b (visited set) and REQ-SEC-10c (retrieval bound).

#### REQ-SEC-10a (Ubiquitous, Section 6)

- **EARS.** The consumer that follows upstream declarations shall go no deeper than three declarations below the one it started from.
- **Draft (Section 6).** "MUST NOT go deeper than three declarations below the one it started from" [req-6bbbce7c]
- **Implemented by.** consumer: src/upstream.ts MAX_UPSTREAM_DEPTH = 3; gateway: gateway/test/upstream.test.ts
- **Verified by.** UT: consumer/test/upstream.test.ts. BDD: @REQ-SEC-10a (g: a chain of three declarations below the start is walked; e: a chain of five (the fourth below the start is not fetched); x: the fourth declaration is reported as not followed, not as an error). SCH: -.

#### REQ-SEC-10b (Ubiquitous, Section 6)

- **EARS.** The consumer that follows upstream declarations shall refuse any URI it has already retrieved during the walk.
- **Draft (Section 6).** "MUST refuse any URI it has already retrieved during the walk" [req-6bbbce7c]
- **Implemented by.** consumer: src/upstream.ts visited set of retrieval URIs without fragment; gateway: gateway/test/upstream.test.ts
- **Verified by.** UT: consumer/test/upstream.test.ts. BDD: @REQ-SEC-10b (g: a chain of three distinct declarations is retrieved once each; e: a loop A to B to A is refused at the repeat; x: a diamond retrieves the shared declaration once, and the same URI with another fragment counts as the same). SCH: -.

#### REQ-SEC-10c (Ubiquitous, Section 6)

- **EARS.** The consumer that follows upstream declarations shall stop at a configured maximum number of retrievals in one walk.
- **Draft (Section 6).** "MUST bound the total number of retrievals in one walk." [req-6bbbce7c]
- **Implemented by.** consumer: src/upstream.ts DEFAULT_MAX_UPSTREAM_RETRIEVALS; tools: sustainability-fetch --max-retrievals
- **Verified by.** UT: consumer/test/upstream.test.ts. BDD: @REQ-SEC-10c (g: a walk under the maximum completes; e: a fan-out beyond the maximum stops at the bound and says so; x: a maximum of 1 retrieves nothing beyond the first declaration). SCH: -.

#### REQ-SEC-11 (group heading, Section 6)

One draft sentence [req-0c34adda] holds three verifiable statements here: REQ-SEC-11a (time, size, redirects), REQ-SEC-11b (https on every hop and reference) and REQ-SEC-11c (user information). The address rule of the same sentence is REQ-SEC-12.

#### REQ-SEC-11a (Ubiquitous, Section 6)

- **EARS.** The consumer shall bound the time (default 30 s), the size and the redirects (at most five) of every fetch.
- **Draft (Section 6).** "SHOULD bound the time, size, and redirects of every fetch" [req-0c34adda]
- **Implemented by.** consumer: src/transport.ts secureGet; src/fetch.ts DEFAULT_TIMEOUT_MS; five-hop manual redirect loop kept; tools: sustainability-fetch --timeout
- **Verified by.** UT: consumer/test/transport.test.ts. BDD: @REQ-SEC-11a (g: three redirects followed; e: a sixth redirect; a timeout; x: a redirect loop stops at the sixth hop). SCH: -.

#### REQ-SEC-11b (Ubiquitous, Section 6)

- **EARS.** The consumer shall require https on every hop and on every dereferenced reference.
- **Draft (Section 6).** "dereference only "https" references" [req-0c34adda]
- **Implemented by.** consumer: src/transport.ts hopRefusal (literal-IP check stays, because a literal host skips the lookup hook)
- **Verified by.** UT: consumer/test/transport.test.ts. BDD: @REQ-SEC-11b (g: an https to https redirect is followed; e: a redirect to http; x: allowInsecure permits http for a loopback test server only). SCH: -.

#### REQ-SEC-11c (Ubiquitous, Section 6)

- **EARS.** The consumer shall refuse a URI that carries user information.
- **Draft (Section 6).** "dereference only "https" references" [req-0c34adda]
- **Implemented by.** consumer: src/transport.ts hopRefusal (user information is a hardening step beyond the quoted sentence; library practice kept)
- **Verified by.** UT: consumer/test/transport.test.ts. BDD: @REQ-SEC-11c (g: https://host/path is accepted; e: https://user:pass@host/ is refused; x: user information in a redirect target is refused). SCH: -.

#### REQ-SEC-12 (Ubiquitous, Section 6)

- **EARS.** The consumer shall allow a connection only to an address whose ipaddr.js range is unicast (so loopback, private, link-local, unique-local, unspecified, carrier-grade NAT, reserved, multicast, broadcast, NAT64 of a blocked address, 6to4 and Teredo are refused), at every connection it makes, redirects included, and shall check the address the connection actually uses, so that DNS rebinding cannot change it after the check.
- **Draft (Section 6).** "An attacker could point a URI-valued member, a jku or x5u header parameter, or an upstream chain at the consumer's internal network, directly or by DNS rebinding, at a third party or a logging server, or into a loop. [...] and refuse a loopback, private, or link-local address at every connection it makes, redirects included;" [req-0c34adda]
- **Implemented by.** consumer: src/transport.ts: undici ^7.30.1 Agent with connect.lookup as the check point (the checked address is the connected address), ipaddr.js ^2.5.0 range() === "unicast", ::ffff:a.b.c.d unwrapped with process(), NAT64 64:ff9b::/96 handled by testing the embedded IPv4 (library map question Q3); SecureGetOptions.lookup stays the test seam. Today the host is resolved once, checked against a short node:net BlockList and resolved again by fetch (a rebinding gap), and 100.64.0.0/10, 198.18.0.0/15, multicast, NAT64, 6to4 and Teredo pass (library map L14, RUN).
- **Verified by.** UT: consumer/test/transport.test.ts (injected lookup; no DNS). BDD: @REQ-SEC-12 (e: 127.0.0.1, 10.0.0.1, 169.254.169.254, 100.64.0.1, 198.18.0.1, 224.0.0.1, ::1, fe80::1, ::ffff:127.0.0.1, 64:ff9b::7f00:1, 2002:7f00:1::1, a name that resolves to a private address, a redirect to one; g: 8.8.8.8 and 2606:4700::1111; x: a name that resolves differently on the second lookup (the injected resolver is asked once per connection); a literal-IP host that skips the lookup hook). SCH: -.

#### REQ-SEC-13 (Ubiquitous, Section 6)

- **EARS.** The consumer, the gateway and the tools shall treat every string as data: HTML-escape it in HTML output, remove control characters and escape sequences in terminal output, and neutralise a leading =, +, - or @ in CSV cells.
- **Draft (Section 6).** "An attacker could put a script or markup in any string, or reuse a lapsed domain in an extension name. Every value is data; an extension name is never dereferenced and keeps its published meaning (Section 3.4)."
- **Implemented by.** consumer: src/text.ts (isolate removes explicit embedding, override and isolate controls before wrapping, so a provider containing U+2069 cannot close the isolate); src/cli.ts; src/transform.ts toCsvRows; gateway: src/index-page.ts auto-escaping template output; src/legal.ts; tools: tools/report-to-declaration output
- **Verified by.** UT: consumer/test/text.test.ts; consumer/test/transform.test.ts; gateway/test/live-requests.test.ts. BDD: @REQ-SEC-13 (e: provider with a script tag, with an ANSI escape, with =HYPERLINK(...); g: ordinary text unchanged; x: a string that looks like an HTML entity is escaped once, not twice). SCH: V26 (hostile-strings; to be added to 04).

#### REQ-SEC-14 (Optional feature, Section 6)

- **EARS.** Where the server computes responses to query parameters on demand, it shall rate-limit requests to the well-known URI (429 with Retry-After) and shall cache what it computes under a key that does not depend on the spelling of a bound.
- **Draft (Section 6).** "A server that computes responses to query parameters on demand SHOULD rate-limit requests to the well-known URI and SHOULD cache what it computes." [req-e700cd62]
- **Implemented by.** publisher: src/publisher.ts cacheKeyFor (canonical UTC instants); optional rate-limit hook in the middleware; gateway: src/rate-limit.ts (rate-limiter-flexible ^11.2.3, fixed window per client, Retry-After); src/app.ts cache; kits: deploy/proxies/{nginx,apache,caddy,traefik,haproxy,envoy,iis} limit_req or equivalent
- **Verified by.** UT: gateway/test/rate-limit.test.ts; publisher/test/server.test.ts (…00Z and …00.000Z share one cache entry). BDD: @REQ-SEC-14 (g: requests under the limit pass; e: the next request gets 429 with Retry-After; x: two spellings of one bound hit one cache entry). SCH: -.

#### REQ-SEC-15 (Ubiquitous, Section 6)

- **EARS.** The publisher documentation, the consumer documentation and the gateway pages shall state what is out of scope: attackers who control the origin's server, DNS zone, certificate or signing key, and the accuracy of figures.
- **Draft (Section 6).** "So is the accuracy of figures (Section 1)."
- **Implemented by.** publisher: README.md, USAGE.md; consumer: README.md, USAGE.md; gateway: gateway/GUIDE.md; gateway/LEGAL.md; kits: deploy READMEs
- **Verified by.** UT: fitness/repository-invariants.test.mjs (the section exists). BDD: none, fitness test only (fitness/repository-invariants.test.mjs). SCH: -.

#### PRV - Privacy considerations (Section 6.1)

#### REQ-PRV-01 (Ubiquitous, Section 6.1)

- **EARS.** The publisher shall publish only what the operator configured, at the aggregation the operator chose, and the documentation and tools shall warn about the four disclosures (capacity and load, hardware, which parts exist, contact strings).
- **Draft (Section 6.1).** "A declaration is readable by whoever the publisher lets retrieve it. Energy and utilization figures can reveal capacity and load patterns, precise metrics hardware, per-part objects which services and paths exist, and contact strings personal data. The publisher decides what to publish and at what aggregation."
- **Implemented by.** publisher: adapters publish only mapped members; README privacy section; tools: tools/create-sustainability-data prints the four warnings before writing; kits: deploy READMEs
- **Verified by.** UT: tools/create-sustainability-data/test/create.test.mjs. BDD: @REQ-PRV-01 (g: the warnings are printed; x: access control stays the operator's (REQ-URI-08); e: an adapter given a member it was not configured to map publishes nothing for it). SCH: -.

#### REQ-PRV-02 (Ubiquitous, Section 6.1)

- **EARS.** The publisher shall not publish real-time telemetry: it applies the day floor and the updated-before-period-end warning of REQ-PER-08.
- **Draft (Section 6.1).** "A period shorter than a calendar day, which Section 3.2 recommends against, can tie figures to individual requests; real-time telemetry is NOT RECOMMENDED." [req-182dbb2b]
- **Implemented by.** publisher: the day floor and the warning of REQ-PER-08; gateway: no live per-request or per-minute object in gateway/data or the self report
- **Verified by.** UT: publisher/test/hardening.test.ts. BDD: @REQ-PRV-02 (e: a one-hour period is dropped by default (REQ-PER-08); g: a whole-day period ending at updated passes with no warning; x: dayFloor warn keeps a six-hour period and warns). SCH: -.

#### REQ-PRV-03 (Optional feature, Section 6.1)

- **EARS.** Where the operator turns noise on, the publisher shall multiply the perturbed members by one factor within 0.99 to 1.01, and shall never turn noise on by itself (default off).
- **Draft (Section 6.1).** "A publisher MAY perturb the published values by multiplicative noise within 1% of the true values to blunt hardware fingerprinting." [req-dda38f04]
- **Implemented by.** publisher: src/security.ts applyNoise (default false); kits: example-scripts/security.{js,php,py} same factor range and default
- **Verified by.** UT: publisher/test/hardening.test.ts; example-scripts/test_security.*. BDD: @REQ-PRV-03 (g: off by default publishes exact values; g: on keeps every factor within 1 percent; x: a factor never leaves [0.99, 1.01]; e: a configured noise amplitude above 1 percent is refused). SCH: -.

#### REQ-PRV-04 (Ubiquitous, Section 6.1)

- **EARS.** The publisher shall apply noise once, when it generates the object, with a factor derived deterministically from the period's canonical UTC instants, so that Z, +00:00 and .000Z spellings of one period give the same factor.
- **Draft (Section 6.1).** "Noise is applied once, at generation time, deterministically per period"
- **Implemented by.** publisher: src/security.ts fuzzFactorFor(canonicalKey(period)); src/period.ts canonicalKey; kits: example-scripts/security.{js,php,py} use the same key
- **Verified by.** UT: publisher/test/hardening.test.ts; example-scripts/test_security.*. BDD: @REQ-PRV-04 (g: two builds of one period give identical values; x: noise is not applied a second time to a cached or signed object; e: a build whose factor depends on the clock fails the determinism test). SCH: -.

#### REQ-PRV-05 (Ubiquitous, Section 6.1)

- **EARS.** The publisher shall apply the one factor of an object to energy-consumption, carbon-footprint, scope-1, scope-2, scope-3, estimated-annual-emissions-kgCO2e and sci-score together, and shall leave ratios (carbon-intensity-gCO2e-per-kWh) and percentages (renewable-energy, kept within 0 to 100) unperturbed.
- **Draft (Section 6.1).** "and consistently across arithmetically related members, annualized or derived ones included, so that ratios are preserved and no unperturbed member discloses a perturbed one."
- **Implemented by.** publisher: src/security.ts NOISE_MEMBERS extended to the annualized and derived members (the -09 code noised only energy, footprint and scopes, so an unperturbed annual estimate disclosed the footprint); kits: example-scripts/security.{js,php,py} extended the same way
- **Verified by.** UT: publisher/test/hardening.test.ts (ratio of scope-2 to footprint unchanged; annual/365 does not recover the true footprint); example-scripts/test_security.*. BDD: @REQ-PRV-05 (g: every related member moves by the same factor; e: a build that noises the footprint but not the annual estimate fails; x: renewable-energy 100 stays 100). SCH: -.

#### REQ-PRV-06 (Optional feature, Section 6.1)

- **EARS.** Where noise is on, the publisher shall require the operator to confirm that the methodology document states that noise is applied and bounds its magnitude, and the methodology template shall carry that statement.
- **Draft (Section 6.1).** "The methodology document states that noise is applied and bounds its magnitude."
- **Implemented by.** publisher: src/security.ts and src/cli.ts: applyNoise needs noiseDisclosed: true (or the CLI flag --noise-disclosed); gateway: gateway/METHODOLOGY.md; kits: methodology templates
- **Verified by.** UT: publisher/test/hardening.test.ts. BDD: @REQ-PRV-06 (e: noise on without the confirmation is refused; g: with it, accepted; x: the CLI flag --noise-disclosed and the option noiseDisclosed behave the same). SCH: -.

#### REQ-PRV-07 (Ubiquitous, Section 6.1)

- **EARS.** The tools shall warn when provider holds an address whose local part is not a role, and the tools and kits shall advise aggregating or omitting a metric that could be linked to individual users or small groups.
- **Draft (Section 6.1).** "A publisher SHOULD aggregate or omit any metric that could be linked to individual users or small groups, and SHOULD use a role rather than a personal contact address in provider." [req-23ad5bde]
- **Implemented by.** publisher: src/validate.ts provider-personal-contact advisory (role list: sustainability, sustain, esg, ops, compliance, contact, info, admin, support, security); tools: tools/create-sustainability-data prompt text; kits: deploy READMEs
- **Verified by.** UT: publisher/test/normalize.test.ts; tools tests. BDD: @REQ-PRV-07 (g: sustain@example.com passes; e: jane.doe@example.com warns; x: no address at all passes). SCH: -.

#### IAN - IANA considerations (Section 7)

#### REQ-IAN-01 (Ubiquitous, Section 7.1)

- **EARS.** Every component shall use the single suffix sustainability-data under /.well-known/ and shall use it only with https, and the repository's registration runbook shall state the entry of Section 7.1 (provisional, change controller as the draft).
- **Draft (Section 7.1).** "*URI Suffix*: sustainability-data [...] *Status*: provisional [...] Used with the "https" URI scheme. [...] The suffix names the data the resource carries, not the topic of sustainability at large ([RFC8615], Section 3)."
- **Implemented by.** publisher: src/handler.ts WELL_KNOWN_PATH (single constant); consumer: src/fetch.ts WELL_KNOWN_PATH; gateway: src/app.ts; kits: all recipes
- **Verified by.** UT: fitness/repository-invariants.test.mjs (no other suffix spelling in code or kits). BDD: @REQ-IAN-01 (g: the path constant is the same in publisher, consumer and gateway; e: n/a: documentation, checked by fitness test fitness/repository-invariants.test.mjs; x: n/a: documentation, checked by fitness test fitness/repository-invariants.test.mjs). SCH: -.

#### REQ-IAN-02 (Ubiquitous, Section 7.2)

- **EARS.** The publisher shall send the media type with no parameter, and the consumer shall accept it with any parameter present and shall ignore the parameter.
- **Draft (Section 7.2).** "*Type name*: application [...] *Subtype name*: sustainability-data+json [...] *Required parameters*: N/A [...] *Optional parameters*: N/A [...] the "+json" suffix is registered in [RFC6839], Section 3.1."
- **Implemented by.** publisher: src/media-type.ts; consumer: src/media-type.ts classifyMediaType; gateway: src/media-type.ts
- **Verified by.** UT: consumer/test/fetch.test.ts; gateway/test/media-type.test.ts. BDD: @REQ-IAN-02 (g: exact type; x: type with charset parameter accepted by the consumer; e: a publisher that adds a parameter to the media type fails the header test). SCH: -.

#### REQ-IAN-03 (Ubiquitous, Section 7.2)

- **EARS.** The publisher shall produce UTF-8 JSON that follows I-JSON (REQ-BDY-06) and the consumer shall ignore a fragment identifier of the retrieval URI as application/json does.
- **Draft (Section 7.2).** "*Encoding considerations*: binary. Documents are JSON text encoded in UTF-8 ([RFC8259], Section 8.1); publishers follow I-JSON [RFC7493]. [...] consumers ignore top-level members they do not recognize. [...] generic JSON parsers differ in their treatment of duplicate names and of large or high-precision numbers. [...] *Fragment identifier considerations*: As specified for "application/json" ([RFC6839], Section 3.1)."
- **Implemented by.** publisher: see REQ-BDY-06; consumer: src/fetch.ts strips the fragment before the request and from the base URI
- **Verified by.** UT: consumer/test/fetch.test.ts. BDD: @REQ-IAN-03 (x: a retrieval URI with #frag is requested without the fragment; g: a UTF-8 JSON body without a byte order mark passes; e: a body with a byte order mark or in UTF-16 is not what the publisher emits). SCH: -.

#### REQ-IAN-04 (Ubiquitous, Section 7.2)

- **EARS.** Every static recipe shall serve the extensionless path /.well-known/sustainability-data with the registered Content-Type, and a sustainability-data.json file shall be served with the same type if offered.
- **Draft (Section 7.2).** "File extension(s): .json. [...] The type also names, as cty, the payload of the signature the specification defines."
- **Implemented by.** kits: deploy/static/* header or type mapping; deploy/www/index.html; server-configurations
- **Verified by.** UT: deploy/e2e/run.sh and deploy-kit.yml: header check per static recipe. BDD: @REQ-IAN-04 (g: each static kit returns the registered type; e: a kit that returns text/plain or octet-stream fails; x: sustainability-data.json is served with the same type if offered). SCH: -.

#### REQ-IAN-05 (Ubiquitous, Section 7)

- **EARS.** The software and its documentation shall say that registration is requested or provisional, as the draft says, and shall not say that the suffix or the media type is registered, approved or an IETF standard until IANA has done so.
- **Draft (Section 7).** "IANA is requested to register the following entry in the "Well-Known URIs" registry [...] Provisional status is requested, as [RFC8615], Section 3.1, directs for a document that is not an open standard. [...] this document requests the standards-tree registration subject to IESG approval under [RFC6838], Section 3.1"
- **Implemented by.** gateway: src/legal.ts, src/index-page.ts, README wording; tools: fitness forbidden-word rule (REQ-CLM-02); kits: deploy READMEs
- **Verified by.** UT: fitness/repository-invariants.test.mjs. BDD: none, fitness test only (fitness/repository-invariants.test.mjs). SCH: -.

#### CMP - Compatibility with -08 and -09 (Appendix B.1 and C.1)

#### REQ-CMP-01 (Ubiquitous, Appendices B.1 and C.1)

- **EARS.** The consumer shall, unless legacyCompat is false, read a -08 reporting-period string and a -09 period of two full-dates by converting them to a -10 period, shall list each conversion in converted, and shall, with legacyCompat false (CLI --strict, the Action, deploy/e2e), convert nothing and report a -08 or -09 document invalid as served. A -09 object whose payload and outer members are converted by the same rule shall still verify under compatibility.
- **Draft (Appendices B.1 and C.1).** "A -09 document is not a valid -10 document: the bounds of period are date-times, and a measurement-method, functional-unit, carbon-unit, or upstream role outside its set is no longer allowed."
- **Implemented by.** consumer: src/sentinel.ts applyCompatibilityReading; src/period.ts periodFromReportingPeriod, periodFromFullDates; src/fetch.ts, src/upstream.ts and src/signature.ts call it; gateway: src/validate.ts reports converted for an origin that still serves -09 or -08; tools: schemas-validators/check-live.py converts old files by default; --require 10 added when the last origin is on -10
- **Verified by.** UT: consumer/test/sentinel.test.ts; consumer/test/fetch.test.ts; gateway/test/validate.test.ts. BDD: @REQ-CMP-01 (g: a -09 document is read and reported converted; e: --strict reports it invalid; x: a signed -09 object still verifies (payload converted by the same rule)). SCH: L01 (08-year), L05 (09-year).

#### REQ-CMP-02 (Ubiquitous, Appendix C.1)

- **EARS.** The publisher shall emit only the -10 form, shall accept the older forms only as input (fromWire, adapters, data files), and shall never write reporting-period, full-date bounds or an out-of-set token.
- **Draft (Appendix C.1).** "A -09 document is not a valid -10 document"
- **Implemented by.** publisher: src/util.ts fromWire; src/period.ts toPeriod; src/normalize.ts
- **Verified by.** UT: publisher/test/normalize.test.ts; publisher/test/draft-10-revision.test.ts. BDD: @REQ-CMP-02 (g: input in -09 form yields a -10 object; e: the output never contains reporting-period; x: a -09 full-date input yields a -10 object, and a fiscal-year extension is left to upgrade). SCH: -.

#### REQ-CMP-03 (Ubiquitous, Appendix C.1)

- **EARS.** The consumer, with legacyCompat on, shall read the legacy forms only: a -08 or -09 period (REQ-CMP-01), a measurement-method outside the set as third-party-modeled (listed in disregarded), a legacy functional-unit by the upgrade rules (listed in converted), a carbon-unit of mtCO2e as tCO2e, an upstream role outside the set by dropping the role, and a target-type outside the set by dropping it; with legacyCompat off each is invalid. An energy-unit, a carbon-accounting or a capabilities value outside its set is invalid in both modes, because these three never had a legacy form.
- **Draft (Appendix C.1).** "a measurement-method, functional-unit, carbon-unit, or upstream role outside its set is no longer allowed."
- **Implemented by.** consumer: src/sentinel.ts (the six legacy forms only); src/tokens.ts legacyFunctionalUnit, leastDirect
- **Verified by.** UT: consumer/test/sentinel.test.ts. BDD: @REQ-CMP-03 (g: Outline: Hardware-Metered, metered, the removals text, per-thousand-requests 12, mtCO2e, role transit and target-type datacenter are each read and reported; e: with legacyCompat off each is invalid as served, and energy-unit TWh, carbon-accounting hourly-market-based and capabilities full stay invalid in both modes; x: a legacy token and a -10 token in one array are each read by their own rule). SCH: neg-* cases remain invalid as served.

#### REQ-CMP-04 (group heading, Appendices B.1 and C.1)

The command sustainability-publisher upgrade IN [OUT] [--updated] [--offset] [--measurement-method TOKEN] [--check] holds nine verifiable statements, REQ-CMP-04a to REQ-CMP-04i. The compatibility reading of the consumer (REQ-CMP-03) and this command apply the same rules to the same legacy forms.

#### REQ-CMP-04a (Ubiquitous, Appendices B.1 and C.1)

- **EARS.** The command sustainability-publisher upgrade shall convert -08 and -09 files to -10 by the conversion rules (13 rules, rule 5a storage over time, rule 10 mtCO2e to tCO2e, rule 14 unknown target-type), and --measurement-method TOKEN shall never override a measurement-method that already is a token.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand (13 conversion rules plus rule 5a storage over time, rule 10 mtCO2e to tCO2e, rule 14 unknown target-type); gateway: gateway/data/*.json converted with it (27 declaration files, two withheld; _self-measured.json is not a declaration and stays unchanged); tools: the single conversion tool
- **Verified by.** UT: publisher/test/upgrade.test.ts (new): one test per rule. BDD: @REQ-CMP-04a (g: a -09 file becomes a valid -10 file; e: reporting-period "2026-13" cannot be converted and the error names the value; x: per-thousand-requests 12 becomes per-request 0.012; mtCO2e becomes tCO2e unchanged in value; --measurement-method does not replace Hardware-Metered once it is a token). SCH: L01 to L14.

#### REQ-CMP-04b (Ubiquitous, Appendices B.1 and C.1)

- **EARS.** The command shall print every conversion it makes and every value it drops.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand prints one line per rule applied
- **Verified by.** UT: publisher/test/upgrade.test.ts (new). BDD: @REQ-CMP-04b (g: each rule applied is printed with its name; e: a dropped unit prints "restate by hand"; x: a file with nothing to change prints that nothing changed). SCH: L01 to L19 (the golden notes).

#### REQ-CMP-04c (Optional feature, Appendices B.1 and C.1)

- **EARS.** Where --check is given, the command shall write nothing and shall exit 1 when any rule other than keep applies.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand --check
- **Verified by.** UT: publisher/test/upgrade.test.ts (new). BDD: @REQ-CMP-04c (g: --check on a valid -10 file exits 0; e: --check on a -09 file exits 1; x: --check with an OUT path still writes no file). SCH: L19, L01.

#### REQ-CMP-04d (Ubiquitous, Appendices B.1 and C.1)

- **EARS.** The command shall be idempotent and shall change nothing in a document that is already valid -10.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand
- **Verified by.** UT: publisher/test/upgrade.test.ts (new). BDD: @REQ-CMP-04d (g: a valid -10 file comes out byte-identical; e: the output of a first run is unchanged by a second run; x: a -10 document with unknown members keeps them). SCH: L19.

#### REQ-CMP-04e (Ubiquitous, Appendices B.1 and C.1)

- **EARS.** The command shall convert the gateway {document} wrapper, keeping the wrapper and converting the declaration inside it, and shall convert a fiscal-year extension to the exact period.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand (wrapper handling; fiscal-year extension rule); gateway: go.eco.json and hmrc.gov.uk.json
- **Verified by.** UT: publisher/test/upgrade.test.ts (new). BDD: @REQ-CMP-04e (g: the wrapper is kept and the inner declaration converted; e: a wrapper whose document member is not an object exits 1; x: the go.eco fiscal-year file becomes the exact period 2024-10-01 to 2025-10-01 and the extension is removed). SCH: L15, L16.

#### REQ-CMP-04f (Ubiquitous, Appendices B.1 and C.1)

- **EARS.** The command shall not carry a signed member over a conversion and shall tell the operator to run sustainability-sign.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand (rule 12 removes signed)
- **Verified by.** UT: publisher/test/upgrade.test.ts (new). BDD: @REQ-CMP-04f (g: a converted signed -08 file has no signed member and the note says to re-sign; e: the old signed value is never written next to converted members; x: a signed object that is already valid -10 keeps its signed member). SCH: L17.

#### REQ-CMP-04g (Ubiquitous, Appendices B.1 and C.1)

- **EARS.** The command shall exit 0 when there is nothing to do, 1 when it would change the document or cannot convert it, and 2 for a usage error such as an unknown flag.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand (exit statuses)
- **Verified by.** UT: publisher/test/upgrade.test.ts (new). BDD: @REQ-CMP-04g (g: nothing to do exits 0; e: an unknown flag exits 2 and prints the usage; x: an unconvertible file exits 1 with the same status under --check and without it). SCH: L19, L07.

#### REQ-CMP-04h (Unwanted behaviour, Appendices B.1 and C.1)

- **EARS.** If a conversion fails, then the command shall write no output file and no partial document.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand (the output is built in memory and written once)
- **Verified by.** UT: publisher/test/upgrade.test.ts (new). BDD: @REQ-CMP-04h (g: a successful conversion writes the whole file; e: reporting-period "2026-13" exits 1 and no output file exists; x: an array whose second element cannot be converted writes nothing for the first). SCH: L07.

#### REQ-CMP-04i (Optional feature, Appendices B.1 and C.1)

- **EARS.** Where OUT is not given, the command shall write the result to standard output, and it shall write in place only when the same path is given twice.
- **Draft (Appendices B.1 and C.1).** "the consumer will read both forms."
- **Implemented by.** publisher: src/cli.ts upgrade subcommand (IN [OUT] argument handling)
- **Verified by.** UT: publisher/test/upgrade.test.ts (new). BDD: @REQ-CMP-04i (g: IN alone prints the document to standard output; e: IN and a different OUT write OUT and leave IN untouched; x: IN given twice converts the file in place). SCH: L01.

#### APX - Worked example (Appendix A) (Appendix A)

#### REQ-APX-01 (Ubiquitous, Appendix A)

- **EARS.** The gateway's own declaration shall be built as Appendix A step 2 says: the last completed month, target-type service, capabilities extended, disclosure-uri and verifiable-attestation-uri, and no upstream member.
- **Draft (Appendix A).** "The object for the last completed month carries target (an identifier of the service), target-type service, capabilities extended (it also answers ?start= and ?end= with its months), a disclosure-uri and a verifiable-attestation-uri."
- **Implemented by.** gateway: src/adapters/self-report.ts (clock injected; third-party-modeled; last 120 days, months and years held)
- **Verified by.** UT: gateway/test/self-extended.test.ts. BDD: @REQ-APX-01 (g: the self report answers ?start= and ?end= with its months; e: a self report that carries an upstream member fails; x: the clock set to the first day of a month builds the month before). SCH: -.

#### REQ-APX-02 (Ubiquitous, Appendix A)

- **EARS.** The gateway shall sign each object of its array with Ed25519, cty sustainability-data+json and the public key as jwk, and shall serve it with the registered Content-Type, Cache-Control max-age=3600 and an ETag.
- **Draft (Appendix A).** "The publisher signs the serialized object with an Ed25519 key (alg Ed25519, cty sustainability-data+json, the public key as jwk) and inserts the result as signed; each object of the monthly array likewise."
- **Implemented by.** gateway: src/adapters/self-report.ts; src/app.ts headers
- **Verified by.** UT: gateway/test/signature.test.ts; gateway/test/routes.test.ts. BDD: @REQ-APX-02 (g: the served array verifies with its embedded key (declaration-only trust); e: an object whose signed value was made for an earlier version is unverified; x: in a monthly array each object carries its own signature). SCH: -.

#### REQ-APX-03 (Ubiquitous, Appendix A)

- **EARS.** The gateway's credential shall carry the derivation model, constants, formulas and entered months, shall be re-issued when any changes, and shall state that its issuer is not independent of the publisher.
- **Draft (Appendix A).** "Its credentialSubject carries the derivation model, its constants and formulas, and the entered months; it is re-issued when any of them changes. Here the issuer is not independent of the publisher; the credential says so"
- **Implemented by.** gateway: gateway attestation tool and endpoint (attestation-tool.test.ts)
- **Verified by.** UT: gateway/test/attestation-tool.test.ts. BDD: @REQ-APX-03 (g: the credential binds target and period; x: the consumer records the attestation as no stronger than that relationship allows; e: a credential for another period is not accepted as binding). SCH: -.

#### REQ-APX-04 (Ubiquitous, Appendix A)

- **EARS.** The offline tools (create-sustainability-data, sustainability-sign) shall produce one static file, signed when a key is given, ready to upload to any static kit.
- **Draft (Appendix A).** "An organization with a yearly report writes the object by hand, or produces it with an offline tool that signs and writes one file, and uploads it."
- **Implemented by.** tools: tools/create-sustainability-data; sustainability-sign; kits: deploy/static/*
- **Verified by.** UT: tools/create-sustainability-data/test/create.test.mjs; publisher/test/jws.test.ts. BDD: @REQ-APX-04 (g: one command writes one valid, signed file; e: a key with alg HS256 is refused (REQ-SIG-03); x: no key given writes an unsigned file and says so). SCH: -.

#### GWY - Reference gateway demos (none; Appendix B.2)

#### REQ-GWY-01 (Ubiquitous)

- **EARS.** The gateway shall serve each curated registry subject at /<domain>/.well-known/sustainability-data as its -10 file with X-Robots-Tag noindex and a Link header that names the legal notice as terms of service (rel terms-of-service), shall never add its own signature to a relayed declaration, and shall answer 404 with a JSON error for an unknown domain and for each of the seven withheld domains.
- **Draft (Appendix B.1).** "relays declarations for third-party targets"
- **Implemented by.** gateway: src/app.ts (subject routes, X-Robots-Tag, Link header); src/legal.ts; src/registry.ts (curated data and the withheld list); data/*.json (20 served subjects) and withheld/ (7)
- **Verified by.** UT: gateway/test/registry.test.ts; gateway/test/withheld.test.ts; gateway/test/routes.test.ts. BDD: @REQ-GWY-01 (g: GET /basic.example/.well-known/sustainability-data returns the -10 file with noindex and the terms Link, unsigned by the gateway; e: an unknown domain and akamai.com answer 404 with a JSON error, never a declaration; x: a conditional GET answers 304 and keeps both headers; each of the seven withheld domains answers 404). SCH: -.

#### REQ-GWY-02 (Unwanted behaviour)

- **EARS.** If a data file of the gateway is not equal to its served -10 form, then the gateway shall refuse to start and shall print the sustainability-publisher upgrade command in its message.
- **Draft.** No -10 sentence; reference gateway behaviour.
- **Implemented by.** gateway: src/registry.ts load gate (round trip of gateway/data/*.json against the served form); src/index.ts start-up
- **Verified by.** UT: gateway/test/registry.test.ts; gateway/test/data.test.ts. BDD: @REQ-GWY-02 (g: the 27 declaration files in -10 form start the gateway; e: a -09 file stops the start with the upgrade message; x: _self-measured.json, which is not a declaration, is not gated). SCH: L01 (a -08 input).

#### REQ-GWY-03 (Event-driven)

- **EARS.** When /validate?origin=<https origin> is requested, the gateway shall retrieve that origin's well-known URI once with the published consumer and answer JSON with status valid, invalid or unreachable, format current or legacy, converted[], disregarded[], period (an object), signature and detail.
- **Draft (Appendix B.1).** "offers a public check of any origin's declaration"
- **Implemented by.** gateway: src/validate.ts Validator; src/app.ts route /validate; the consumer package for the retrieval and the check
- **Verified by.** UT: gateway/test/validate.test.ts; gateway/test/live-requests.test.ts. BDD: @REQ-GWY-03 (g: a valid -10 file gives valid, format current, period as an object, signature unsigned; e: a -09 file gives valid with format legacy and converted ["period"]; a lower-case t in a bound gives invalid; a refused connection gives unreachable; x: an empty array gives valid with detail "no report"; a signed file reports signature verified with the note that a header key proves integrity only). SCH: -.

#### REQ-GWY-04 (Ubiquitous)

- **EARS.** The gateway shall check an origin only over https on port 443, shall refuse an origin that resolves to a private address, shall read at most 64 KiB within 5 s, shall cache the outcome per host for one hour, shall keep a per-client and a global request budget that answers 503 with Retry-After when spent (never as an outcome about the origin), and shall not fetch a host named in VALIDATOR_EXCLUDE.
- **Draft.** No -10 sentence; reference gateway behaviour.
- **Implemented by.** gateway: src/validate.ts (checkHost, parseOrigin, isBusy); src/config.ts validator limits and VALIDATOR_EXCLUDE; src/app.ts 503 with Retry-After
- **Verified by.** UT: gateway/test/validate.test.ts; gateway/test/live-requests.test.ts. BDD: @REQ-GWY-04 (g: https://host on port 443 is checked; e: http://x.example, https://127.0.0.1 and a missing origin answer 400; a host that resolves to a private address is refused; a body over 64 KiB is cut; x: the second request within the hour comes from the cache; a spent budget answers 503 with Retry-After; an excluded host is not fetched). SCH: -.

#### REQ-GWY-05 (Ubiquitous)

- **EARS.** The gateway shall serve /badge/<host>.svg with the same outcome as /validate gives for that host, and the badge shall carry a text alternative and a status word and shall not use the words verified or certified.
- **Draft.** No -10 sentence; reference gateway behaviour.
- **Implemented by.** gateway: src/validate.ts badgeSvg, noticeBadgeSvg; src/app.ts route /badge/<host>.svg
- **Verified by.** UT: gateway/test/validate.test.ts; gateway/test/legal.test.ts. BDD: @REQ-GWY-05 (g: a valid host gets the valid badge with its text alternative; e: an invalid host and an unreachable host get their own badges, and no badge says verified; x: a spent budget returns the notice badge with Retry-After and is never cached as an outcome). SCH: -.

#### REQ-GWY-06 (Ubiquitous)

- **EARS.** The gateway shall list on / and in /index.json every example, adapter demonstration and request, and the 42 wire examples, each with period as an object (start and end) and with no period= parameter anywhere.
- **Draft.** No -10 sentence; reference gateway behaviour.
- **Implemented by.** gateway: src/index-page.ts; src/examples.ts; src/app.ts (/ and /index.json)
- **Verified by.** UT: gateway/test/live-requests.test.ts; gateway/test/examples-live.test.ts. BDD: @REQ-GWY-06 (g: / lists each example with its exact request and /index.json lists subjects, adapter demonstrations and wire examples; e: a link or an entry that uses period= fails the check; x: a wire example carries range and granularity, and the period column shows both bounds in a title). SCH: -.

#### REQ-GWY-07 (Ubiquitous)

- **EARS.** The gateway shall answer /healthz with {"status":"ok","subjects":N} and /legal with its legal notice as text/plain.
- **Draft.** No -10 sentence; reference gateway behaviour.
- **Implemented by.** gateway: src/app.ts (/healthz); src/legal.ts (LEGAL_PATH, LEGAL_TEXT)
- **Verified by.** UT: gateway/test/routes.test.ts; gateway/test/legal.test.ts. BDD: @REQ-GWY-07 (g: /healthz answers ok with the subject count and /legal answers the notice; e: POST to /healthz answers 405 with Allow; x: /healthz is exempt from the rate limit). SCH: -.

#### REQ-GWY-08 (Ubiquitous)

- **EARS.** The gateway shall allow 600 requests per minute per client on every route except /healthz, shall answer the next request with 429 and Retry-After, and shall never cache a 429 as a declaration (REQ-SEC-14 states the rule for a publisher).
- **Draft.** No -10 sentence; reference gateway behaviour.
- **Implemented by.** gateway: src/rate-limit.ts (rate-limiter-flexible, fixed window per client); config RATE_LIMIT_PER_MINUTE (default 600); src/app.ts
- **Verified by.** UT: gateway/test/rate-limit.test.ts. BDD: @REQ-GWY-08 (g: requests under the limit pass; e: the 601st request in a minute gets 429 with Retry-After; x: /healthz is never limited, and a 429 is not stored as a declaration in the cache). SCH: -.

#### REQ-GWY-09 (Ubiquitous)

- **EARS.** The gateway shall answer HEAD with the headers of GET and no body, a conditional GET carrying the current ETag with 304, and any other method with 405 and Allow: GET, HEAD, on every route.
- **Draft.** No -10 sentence; reference gateway behaviour.
- **Implemented by.** gateway: src/http.ts; src/app.ts
- **Verified by.** UT: gateway/test/routes.test.ts. BDD: @REQ-GWY-09 (g: HEAD on the self report has the headers of GET and no body; e: POST answers 405 with Allow: GET, HEAD; x: a conditional GET on a query route answers 304 with the same ETag). SCH: -.

#### REQ-GWY-10 (Ubiquitous)

- **EARS.** The gateway pages shall declare the page language, carry one h1, label every form control, announce the validator result in an aria-live region, keep text contrast in light and dark, reflow at 320 px, and need no script to be read.
- **Draft.** No -10 sentence; reference gateway behaviour.
- **Implemented by.** gateway: src/index-page.ts; src/legal.ts; src/images
- **Verified by.** UT: gateway/test/live-requests.test.ts (rendered HTML checks); an automated accessibility run on / and the validator page (axe-core or chrome-devtools-mcp; /legal is text/plain per REQ-GWY-07, so the HTML rules do not apply to it). BDD: @REQ-GWY-10 (g: / has lang, one h1 and labelled controls; e: a status shown by colour alone, or a control without a label, fails the run; x: the page is readable with scripts off and at 320 px). SCH: -.

#### LIB - Library practice kept (no -10 sentence) (none)

#### REQ-LIB-01 (Ubiquitous)

- **EARS.** The consumer shall send Accept: application/sustainability-data+json, application/json;q=0.9. (The -09 recommendation was dropped from -10; the behaviour stays because it costs nothing.)
- **Draft.** No -10 sentence.
- **Implemented by.** consumer: src/media-type.ts ACCEPT_HEADER
- **Verified by.** UT: consumer/test/fetch.test.ts. BDD: none, unit test only. SCH: -.

#### REQ-LIB-02 (Ubiquitous)

- **EARS.** The publisher shall send Access-Control-Allow-Origin: * by default, with an option to change or disable it, so that browser consumers can read a public declaration.
- **Draft.** No -10 sentence.
- **Implemented by.** publisher: src/handler.ts cors; gateway: src/http.ts
- **Verified by.** UT: publisher/test/server.test.ts. BDD: none, unit test only. SCH: -.

#### REQ-LIB-03 (Event-driven)

- **EARS.** When the publisher honors no parameter and holds nothing at all (an empty CSV), it shall answer 404; when it honors a parameter it answers 200 [] (REQ-QRY-11).
- **Draft.** No -10 sentence.
- **Implemented by.** publisher: src/publisher.ts NotFoundError
- **Verified by.** UT: publisher/test/csv-slurm.test.ts. BDD: @REQ-LIB-03 (e: empty source and no query gives 404; g: a non-empty source with no query answers 200; x: an extended publisher that holds nothing and receives a query answers 200 []). SCH: -.

## 2. Use cases


**P1, organization publishing a yearly static file**

- `UC-1.1` Write a yearly declaration from an annual report
- `UC-1.2` Convert an existing -08/-09 file
- `UC-1.3` Serve on a static host

**P2, website owner**

- `UC-2.1` Install and publish (WordPress 0.2.0, one-click, framework recipes in node/python/php/go/rust/dotnet/ruby/java)
- `UC-2.2` Range query on a server

**P3, cloud/hosting provider with tenant declarations**

- `UC-3.1` Publish one declaration per tenant
- `UC-3.2` Many tenants, many chains

**P4, device/edge operator**

- `UC-4.1` Publish device or facility figures
- `UC-4.2` Small payloads

**P5, aggregator/consumer tool**

- `UC-5.1` Fetch and read a declaration
- `UC-5.2` Check what the server actually answered
- `UC-5.3` Read -08 and -09 documents
- `UC-5.4` Totals and comparisons
- `UC-5.5` Follow upstream
- `UC-5.6` Conformance battery

**P6, auditor checking a signature**

- `UC-6.1` Verify a signed object
- `UC-6.2` Signed arrays
- `UC-6.3` Attestations

**P7, reference-gateway visitor**

- `UC-7.1` Read the gateway's own declaration
- `UC-7.2` Read a registry subject
- `UC-7.3` Public validator and badge
- `UC-7.4` Learn from examples

## 3. Rule keys

| Key | Draft section | Rule | Requirements |
|---|---|---|---|
| `body-1` | 3.1 | One object and a one-object array are the same declaration; a consumer accepts both | REQ-BDY-05, REQ-BDY-03 |
| `body-2` | 3.1, 2.2 | An empty array is a valid body and the answer to an unmatched query | REQ-BDY-01, REQ-QRY-11 |
| `body-3` | 3.1 | A consumer ignores an unrecognized top-level member; a publisher never emits one | REQ-BDY-07, REQ-BDY-08 |
| `body-4` | 3.1 | Strings are equal after JSON escapes are decoded; no case folding | REQ-BDY-10 |
| `body-5` | 3.1 | Figures that differ only in accounting method or functional unit are separate objects for one target and period | REQ-BDY-04 |
| `body-6` | 3.1, 3.3 | Numbers are binary64 (I-JSON); no duplicate member names | REQ-BDY-06, REQ-NUM-02 |
| `mand-1` | 3.2 | `updated` is an RFC 3339 date-time with T and Z in upper case | REQ-MND-02 |
| `mand-2` | 3.2 | `capabilities` is basic or extended | REQ-MND-03 |
| `mand-3` | 3.2 | `measurement-method` is one of four tokens, closed | REQ-MTH-01 |
| `mand-4` | 3.2 | The token says how energy or activity was obtained; an emission factor or an allocation does not change it; combined methods carry the least direct | REQ-MTH-03, REQ-MTH-04 |
| `mand-5` | 3.2 | `period` is an object of two RFC 3339 date-times, upper case, written as updated is | REQ-PER-01, REQ-FRM-04 |
| `mand-6` | 3.2 | `start` MUST be before `end`, compared as instants | REQ-PER-02 |
| `mand-7` | 3.2 | Half-open: start included, end excluded; consecutive periods meet | REQ-PER-03 |
| `mand-8` | 3.2 | Each bound is written in the offset in force at its boundary; Z recommended; offsets may differ within a period | REQ-PER-04, REQ-PER-06 |
| `mand-9` | 3.2 | A whole calendar day, month or year is defined on each bound read in its own offset; several whole months are not a whole month | REQ-PER-05 |
| `mand-10` | 3.2, 6.1 | SHOULD: a period is a calendar day or longer, bounds on first instants of a day (advisory) | REQ-PER-07, REQ-PER-08, REQ-PRV-02 |
| `mand-11` | 3.2 | `target` is opaque; an origin host is in A-label form and compared case-insensitively | REQ-TGT-02, REQ-TGT-03, REQ-TGT-04, REQ-TGT-05 |
| `mand-12` | 3.1 | An array may mix targets, periods and offsets, and may overlap | REQ-BDY-03 |
| `mand-13` | 1, 3.2 | The seven mandatory members are required in every declaration object | REQ-MND-01 |
| `opt-1` | 3.3 | `target-type` is one of nine tokens | REQ-TTY-01 |
| `opt-2` | 3.3 | `energy-unit` is Wh, kWh, MWh or GWh; kWh when absent | REQ-ENG-01 |
| `opt-3` | 3.3 | `carbon-unit` is gCO2e, kgCO2e or tCO2e; gCO2e when absent | REQ-CAR-01 |
| `opt-4` | 3.3 | `carbon-accounting` is location-based or market-based | REQ-CAR-03 |
| `opt-5` | 3.3 | Numbers are non-negative unless the member says otherwise | REQ-NUM-01 |
| `opt-6` | 3.3 | Scopes may be negative; they should account for the footprint (advisory) | REQ-SCP-01, REQ-SCP-02 |
| `opt-7` | 3.3 | `sci-score` requires `functional-unit` | REQ-SCI-01 |
| `opt-8` | 3.3 | `functional-unit` is one of twelve tokens; a score in another unit goes in extensions | REQ-FUN-01, REQ-FUN-03, REQ-FUN-04 |
| `opt-9` | 3.3 | `renewable-energy` is between 0 and 100 inclusive | REQ-DRV-03 |
| `opt-10` | 3.3 | At least one metric or one evidence link; at most one attestation URI | REQ-MIN-01, REQ-LNK-01 |
| `opt-11` | 3.3.1 | URI-valued members are URI references resolved against the retrieval URI | REQ-URF-01, REQ-URF-02, REQ-URF-03 |
| `opt-12` | 3.4 | Extension names are URIs compared as strings; values are objects; unknown ones are ignored and never dereferenced | REQ-EXT-01, REQ-EXT-02, REQ-EXT-03, REQ-EXT-04 |
| `opt-13` | 3.5 | `upstream` has at least one entry; `declaration` is required; `role` is one of six or absent | REQ-UPS-01, REQ-UPS-02, REQ-UPS-03 |
| `opt-14` | 3.5, 5.5 | A tenant declaration can be compared with the target for the same period; a smaller figure is flagged, not a failure | REQ-EVD-03, REQ-EVD-04, REQ-EVD-05 |
| `opt-15` | 6 | A walk goes at most three declarations deep, never retrieves a URI twice, bounds its retrievals, dereferences only https | REQ-UPS-04, REQ-SEC-10a, REQ-SEC-10b, REQ-SEC-10c |
| `sig-1` | 3.6 | `signed` is a JWS Compact over the object without `signed`; each object of an array has its own | REQ-SIG-01, REQ-SIG-02 |
| `sig-2` | 3.6, 5.4 | Only asymmetric algorithms; Ed25519 and ES256 recommended; none and MAC refused | REQ-SIG-03, REQ-VER-01 |
| `sig-3` | 3.6, 5.4 | `cty` is `sustainability-data+json` (with or without the `application/` prefix) | REQ-SIG-04, REQ-VER-02 |
| `sig-4` | 5.4 | An unknown `crit` parameter is refused | REQ-VER-03 |
| `sig-5` | 5.4 | Payload target, period.start, period.end, carbon-accounting and functional-unit must equal the object's, as strings | REQ-VER-06 |
| `sig-6` | 5.4 | A payload that is not an object, or carries `signed`, or does not match leaves the object unverified, never false | REQ-VER-05, REQ-VER-12 |
| `sig-7` | 5.4 | Header keys (jwk, x5c) are trusted no further than the declaration; kid or a pinned key is out of band; header URLs are never fetched as out of band | REQ-VER-07, REQ-VER-08, REQ-VER-09 |
| `sig-8` | impl | RFC 9864: EdDSA is still verified and reported as deprecated; the publisher emits Ed25519 only | REQ-VER-13 |
| `qry-1` | 2.2 | An unsupported parameter is ignored; a static file satisfies every request | REQ-QRY-01, REQ-QRY-02 |
| `qry-2` | 2.2 | A start, end or granularity value outside the ABNF is ignored and never read as another value | REQ-QRY-03, REQ-QRY-04, REQ-QRY-05, REQ-QRY-07 |
| `qry-3` | 2.2 | A value is read after percent-decoding | REQ-QRY-03, REQ-QRY-06 |
| `qry-4` | 2.2 | An object is selected when its period overlaps the half-open range; an absent bound is unbounded | REQ-QRY-12, REQ-QRY-13 |
| `qry-5` | 2.2 | `target` selects by equality as Section 3.2 compares | REQ-QRY-14, REQ-TGT-04 |
| `qry-6` | 2.2 | `granularity` selects whole calendar years, months or days | REQ-QRY-15 |
| `qry-7` | 2.2 | Results are ascending by `period.start` as instants; an empty selection is `[]`; nothing is aggregated | REQ-QRY-09, REQ-QRY-10, REQ-QRY-11, REQ-QRY-16, REQ-QRY-19 |
| `qry-8` | 2.2 | A consumer compares the period and target it received with what it asked and does not record a mismatch as coverage | REQ-QRY-17a, REQ-QRY-17b, REQ-QRY-18 |
| `agg-1` | 5.3 | A total adds only objects of one target and one accounting basis whose periods do not overlap, after unit conversion | REQ-TOT-02, REQ-TOT-03 |
| `agg-2` | 5.2 | Parts of an origin need not add up to the whole | REQ-ORG-02, REQ-ORG-03 |
| `agg-3` | 5.1 | Nothing is presented as verified because it was retrieved or signed | REQ-CLM-01, REQ-CLM-02, REQ-VER-11 |
| `cmp-1` | Appendix B, C.1 | Consumer 0.8.0 reads -08 and -09 forms as `converted`; strict mode rejects them | REQ-CMP-01, REQ-CMP-03 |
| `cmp-2` | tool | `upgrade` converts by fixed rules, prints each change, is idempotent, `--check` reports | REQ-CMP-04a, REQ-CMP-04b, REQ-CMP-04c, REQ-CMP-04d, REQ-CMP-04e, REQ-CMP-04f, REQ-CMP-04g, REQ-CMP-04h, REQ-CMP-04i, REQ-CMP-02 |
| `tls-1` | 6 | A consumer verifies the certificate chain and host name and offers no option that switches verification off | REQ-SEC-04 |
| `lim-1` | 6 | A consumer bounds size, objects, nesting, redirects, addresses and retrievals | REQ-SEC-08, REQ-SEC-09, REQ-SEC-10a, REQ-SEC-10b, REQ-SEC-10c, REQ-SEC-11a, REQ-SEC-11b, REQ-SEC-11c, REQ-SEC-12 |
