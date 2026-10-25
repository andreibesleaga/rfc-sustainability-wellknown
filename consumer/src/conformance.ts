/**
 * A small conformance-check battery for any /.well-known/sustainability-data
 * origin — usable against this repo's own implementations or any third
 * party's, not just via the CLI's --strict flag.
 */
import { DEFAULT_TIMEOUT_MS, fetchSustainability } from "./fetch";
import { resolveWellKnownUrl } from "./fetch";
import { ACCEPT_HEADER, classifyMediaType, LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "./media-type";
import { AddressLookup, discardBody, secureGet } from "./transport";
import { isWholeCalendarPeriod, yearPeriod } from "./period";
import { Capabilities } from "./tokens";
import { FetchResult, SustainabilityMetrics } from "./types";

/**
 * The strength of what a check tests. This matters for reporting: a static
 * host that cannot emit an `Allow` header on its own 405 is not violating
 * the draft, and a battery that renders it as "FAIL" tells a publisher their
 * conformant deployment is broken.
 *
 *  - `"MUST"` — a requirement of the draft;
 *  - `"SHOULD"` — a recommendation of the draft;
 *  - `"INFO"` — HTTP practice or an observation the draft does not require
 *    (RFC 9110 and RFC 9111 leave caching and the other aspects of the exchange
 *    to the publisher); never counted against an origin.
 */
export type ConformanceLevel = "MUST" | "SHOULD" | "INFO";

/**
 * The verdict of a single check.
 *
 *  - `"pass"` — the requirement is met;
 *  - `"fail"` — it is not met (a failed MUST is non-conformance and sets the
 *    battery's exit code; a failed SHOULD is an unmet recommendation);
 *  - `"warn"` — deliberately neither: a state this battery reports but does not
 *    hold against the origin. The cases today are a publisher still serving
 *    the generic `application/json` media type (which the draft has consumers
 *    keep processing, and which is not something to fail an origin over while
 *    the dedicated media type awaits IANA registration) and a verified
 *    signature whose payload differs from the plain members.
 *
 * A `warn` never affects {@link ConformanceReport.allPassed} nor the CLI's
 * exit code — it renders as `WARN`, like an unmet SHOULD.
 */
export type ConformanceOutcome = "pass" | "fail" | "warn";

export interface ConformanceCheck {
  name: string;
  /**
   * Derived from {@link outcome}: true only for `"pass"`. A `"warn"` is not a
   * pass (it is rendered `WARN`, exactly as an unmet SHOULD already was), but
   * it is not counted against conformance either — read `outcome` to tell the
   * two apart, and `allPassed` for the verdict.
   */
  pass: boolean;
  /** The three-valued verdict; `pass` is derived from it. */
  outcome: ConformanceOutcome;
  level: ConformanceLevel;
  /** The section of the draft the check tests, e.g. "Query Parameters". */
  section?: string;
  detail?: string;
}

export interface ConformanceReport {
  origin: string;
  checks: ConformanceCheck[];
  /**
   * The capabilities the origin's Basic response publishes, `undefined` when
   * the response carries no declaration object. A static file reports `basic`;
   * a server that honors at least one query parameter must report `extended`.
   */
  capabilities?: Capabilities;
  /** True when no MUST-level check FAILED; SHOULD-level gaps and warns are advisory. */
  allPassed: boolean;
  /** True when every check of either level passed outright (no fails, no warns). */
  allPassedIncludingRecommended: boolean;
}

/**
 * What a check body may return: `true` (pass), `false` or a string (fail, the
 * string being the detail), or an explicit outcome — which is how a check
 * reports the third state, `"warn"`.
 */
type CheckResult = boolean | string | { outcome: ConformanceOutcome; detail?: string };

async function check(
  name: string,
  level: ConformanceLevel,
  section: string,
  fn: () => Promise<CheckResult>,
): Promise<ConformanceCheck> {
  const made = (outcome: ConformanceOutcome, detail?: string): ConformanceCheck => ({
    name,
    level,
    section,
    outcome,
    pass: outcome === "pass",
    ...(detail !== undefined ? { detail } : {}),
  });
  try {
    const result = await fn();
    if (result === true) return made("pass");
    if (result === false) return made("fail");
    if (typeof result === "string") return made("fail", result);
    return made(result.outcome, result.detail);
  } catch (err) {
    return made("fail", err instanceof Error ? err.message : String(err));
  }
}

export interface ConformanceOptions {
  /** Per-request timeout (ms), forwarded to fetchSustainability and the raw probes. */
  timeoutMs?: number;
  /** Per-response body byte cap, forwarded to fetchSustainability. */
  maxBytes?: number;
  /**
   * Forwarded to fetchSustainability: allow a non-HTTPS origin (default
   * false, per the draft's HTTPS MUST). Needed to run the battery against a
   * local instance — `http://127.0.0.1:8080` in CI — which is exactly the
   * smoke test this battery is meant for. The raw probes obey the same
   * transport rules as every other request.
   */
  allowInsecure?: boolean;
  /** Resolver for the address check, forwarded to fetchSustainability. */
  lookup?: AddressLookup;
  /** Opt out of the address check (default false; `allowInsecure` lifts it for loopback only). */
  allowPrivateAddresses?: boolean;
  /**
   * The clock the battery reads, `() => new Date()` by default.
   *
   * It has exactly one use: choosing the year the Extended granularity check
   * asks about, which is the current one — the period a live publisher is most
   * likely to hold entries for. Nothing else in the battery reads it, and no
   * verdict depends on it beyond which year is asked for (a publisher holding
   * nothing for that year answers `200` with `[]`; a `404` fails the check).
   * Pass a fixed clock so a run is reproducible
   * and a recorded request URL does not change with the date, as the publisher
   * package's `PublisherOptions.now` does for the aggregation rule.
   */
  now?: () => Date;
}

/** The section of the HTTP-practice checks: the draft leaves these aspects of the exchange to the publisher. */
const HTTP_PRACTICE = "HTTP practice, RFC 9110 and RFC 9111; not a requirement of the draft";

/** A target no origin names: an origin that honors `target` answers it with `[]`, one that ignores it answers as usual. */
const PROBE_TARGET = "conformance-probe.invalid";
/** A month long past, for which no origin holds a declaration. */
const PROBE_RANGE = { start: "1900-01-01T00:00:00Z", end: "1900-02-01T00:00:00Z" };
/**
 * Values the query rules exclude: each is ignored by the parameter alone and
 * never read as another value. Most do not match the ABNF; "2025-02-30"
 * matches it but is not a date (RFC 3339 limits the day to the month's length).
 */
const IGNORED_VALUES = [
  "start=2025-01-01",
  "start=2025-01-01t00:00:00z",
  "end=2025-02-30T00:00:00Z",
  "end=2025-01-01T00:00:00%2B01:00",
  "granularity=Monthly",
];

export async function runConformanceChecks(
  origin: string,
  fetchImpl?: typeof fetch,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];
  const { timeoutMs, maxBytes, allowInsecure, allowPrivateAddresses, lookup } = options;
  const year = yearPeriod(Number((options.now ?? (() => new Date()))().toISOString().slice(0, 4)));
  // legacyCompat is disabled here on purpose: a conformance checker must see
  // the document as served. With the compatibility reading on, a document of an
  // earlier revision would be converted and pass the schema gate, masking
  // exactly the non-conformance this battery exists to detect.
  const fetchOpts = { fetchImpl, timeoutMs, maxBytes, legacyCompat: false, allowInsecure, allowPrivateAddresses, lookup };
  // The raw probes go through the same transport as every other fetch: the
  // connect-time address check, bounded redirects and the same timeout, so a
  // hanging or hostile origin cannot stall or steer the battery. A probe's
  // body is discarded unread.
  const probe = async (url: string, method: "GET" | "POST" = "GET") => {
    const got = await secureGet(new URL(url), {
      fetchImpl,
      method,
      timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
      allowInsecure,
      allowPrivateAddresses,
      lookup,
      headers: { Accept: ACCEPT_HEADER },
    });
    if (!got.ok) throw new Error(`${got.refusal.reason}${got.refusal.detail ? `: ${got.refusal.detail}` : ""}`);
    await discardBody(got.res);
    return got.res;
  };
  const wellKnown = resolveWellKnownUrl(origin).toString();

  const basic = await fetchSustainability(origin, fetchOpts).catch((err: unknown) => err as Error);
  const basicObjects: SustainabilityMetrics[] =
    !(basic instanceof Error) && basic.status === "ok" ? (Array.isArray(basic.document) ? basic.document : [basic.document]) : [];
  /** The result of the Basic request, or the reason there is none to use. */
  const basicOk = () => {
    if (basic instanceof Error) throw basic;
    return basic;
  };

  checks.push(
    await check("Basic request returns a schema-valid declaration (one object or an array)", "MUST", "Body", async () => {
      const r = basicOk();
      if (r.status !== "ok") return `expected ok, got ${r.status}`;
      return true;
    }),
  );

  checks.push(
    // The draft publishes the declaration with `application/sustainability-data+json`,
    // and a consumer MAY also process a 200 response of `application/json`. A
    // publisher serving the generic type is reported as WARN rather than FAIL.
    // Any other type is a fail, including a missing Content-Type, since a
    // response carrying another media type is not a declaration.
    await check(`Basic 200 response uses the ${MEDIA_TYPE} media type`, "MUST", "Location and Transport", async () => {
      const res = await probe(wellKnown);
      if (res.status !== 200) return `expected 200 for the Basic request, got ${res.status}`;
      const raw = res.headers.get("content-type");
      switch (classifyMediaType(raw)) {
        case "sustainability-data+json":
          return true;
        case "json":
          return {
            outcome: "warn",
            detail: `generic media type (${LEGACY_MEDIA_TYPE}): a consumer may process it, but the draft publishes the declaration as ${MEDIA_TYPE}`,
          };
        default:
          return `Content-Type is neither ${MEDIA_TYPE} nor ${LEGACY_MEDIA_TYPE}: "${raw ?? ""}"`;
      }
    }),
  );

  // The signature outcomes, kept for the identifier check below.
  let signatures: FetchResult | undefined;
  checks.push(
    // The `signed` member is OPTIONAL and checked only when present. Absent is
    // a pass: the publisher does not sign. When present it must verify under an
    // asymmetric algorithm with the required `cty`; a member that does not
    // verify is a MUST failure, and a payload that differs from the served
    // members is reported, not failed (which set of members a consumer uses
    // depends on how far the key is trusted).
    await check(
      "Embedded signature (OPTIONAL `signed` member): absent, or present and verifiable",
      "MUST",
      "The signed Member",
      async () => {
        const r = await fetchSustainability(origin, { ...fetchOpts, verifySignature: true });
        signatures = r;
        if (r.status !== "ok") return `expected ok, got ${r.status}`;
        const outcomes = r.signatures ?? [];
        if (outcomes.length === 0) return { outcome: "pass", detail: "no declaration object to check" };
        const failed = outcomes.find((s) => s.status === "unverified");
        if (failed && failed.status === "unverified") {
          return `signed member present but not verifiable: ${failed.reason}${failed.detail ? ` (${failed.detail})` : ""}`;
        }
        const verified = outcomes.filter((s) => s.status === "verified");
        if (verified.length === 0) return { outcome: "pass", detail: "not signed (optional)" };
        const first = verified[0];
        if (first.status !== "verified") return "unexpected signature outcome";
        const who =
          `${first.alg}${first.kid ? ` kid=${first.kid}` : ""} (key trust: ${first.keyTrust}; ` +
          `${first.precedence === "payload" ? "the payload's members take precedence" : "the members served by the origin remain in use"})`;
        if (verified.some((s) => s.status === "verified" && s.modifiedAfterSigning)) {
          return { outcome: "warn", detail: `verified ${who}, but the served members differ from the signed payload` };
        }
        return { outcome: "pass", detail: `verified ${who}` };
      },
    ),
  );

  checks.push(
    // EdDSA verifies, as the same algorithm as Ed25519, but RFC 9864 deprecates
    // the identifier: a publisher is told so without being failed.
    await check("Signature algorithm identifier is Ed25519 or ES256 (EdDSA is the deprecated identifier)", "SHOULD", "The signed Member", async () => {
      const outcomes = signatures?.status === "ok" ? (signatures.signatures ?? []) : [];
      const deprecated = outcomes.some((s) => s.status === "verified" && s.deprecatedAlg);
      return deprecated ? { outcome: "warn", detail: "the signature names EdDSA; Ed25519 is the identifier of the same algorithm" } : true;
    }),
  );

  checks.push(
    // The three HTTP-practice checks (ETag, 304, 405) test what RFC 9110 and
    // RFC 9111 describe and the draft leaves to the publisher: an unmet one is
    // a WARN and never an unmet requirement of the draft.
    await check("Response carries an ETag", "INFO", HTTP_PRACTICE, async () => {
      const r = basicOk();
      return r.status === "ok" && !!r.etag ? true : { outcome: "warn", detail: "no ETag (HTTP practice; the draft leaves caching to the publisher)" };
    }),
  );

  checks.push(
    await check("Conditional GET with a fresh ETag returns 304", "INFO", HTTP_PRACTICE, async () => {
      const first = basicOk();
      if (first.status !== "ok" || !first.etag) return { outcome: "warn", detail: "no ETag to test a conditional request with" };
      const second = await fetchSustainability(origin, { ...fetchOpts, ifNoneMatch: first.etag });
      return second.status === "not-modified" || { outcome: "warn", detail: `expected not-modified, got ${second.status}` };
    }),
  );

  checks.push(
    await check("A method other than GET/HEAD gets 405 with Allow", "INFO", HTTP_PRACTICE, async () => {
      const res = await probe(wellKnown, "POST");
      if (res.status !== 405) return { outcome: "warn", detail: `expected 405, got ${res.status}` };
      const allow = res.headers.get("allow") ?? "";
      return allow.includes("GET") || { outcome: "warn", detail: `Allow header missing GET: "${allow}"` };
    }),
  );

  checks.push(
    // A start, end or granularity value that does not match the ABNF is ignored
    // by that parameter alone: the answer is the one for a request without it.
    // A 400 (or a 404) refuses a request the draft says to answer.
    await check("A query value outside the profile is ignored, not refused", "MUST", "Query Parameters", async () => {
      for (const value of IGNORED_VALUES) {
        const res = await probe(`${wellKnown}?${value}`);
        if (res.status !== 200) {
          return `?${value} was answered ${res.status}; a value that does not match the query ABNF is ignored and the request answered as if it were absent, never refused`;
        }
      }
      return true;
    }),
  );

  // What the origin honors, found by asking for what no origin holds: an origin
  // that honors a parameter answers `[]`, one that ignores it answers as usual.
  const honoring = memo(async () => ({
    target: await fetchSustainability(origin, { ...fetchOpts, target: PROBE_TARGET }),
    range: await fetchSustainability(origin, { ...fetchOpts, ...PROBE_RANGE }),
    granularity: await fetchSustainability(origin, { ...fetchOpts, granularity: "daily" }),
  }));

  checks.push(
    await check("A range that selects nothing is answered 200 (an empty array when honored), never 404", "MUST", "Query Parameters", async () => {
      const { range } = await honoring();
      if (range.status !== "ok") return `a range no object falls in was answered ${range.status === "not-found" ? "404" : range.status}; an empty selection is the empty array, not an error`;
      if (Array.isArray(range.document) && range.document.length === 0) return { outcome: "pass", detail: "empty array" };
      return { outcome: "pass", detail: "not honored (allowed: a static file satisfies every request)" };
    }),
  );

  checks.push(
    // A server that honors at least one parameter publishes `capabilities`
    // extended, so a client knows to ask. A static file honors none and says basic.
    await check("A server that honors a query parameter publishes capabilities extended", "MUST", "Mandatory Members", async () => {
      const asked = await honoring();
      // An answer honors a parameter when it is an array every object of which satisfies it; the empty array does.
      const by = (r: (typeof asked)["target"], ...keys: Array<"target" | "start" | "end" | "granularity">) =>
        r.status === "ok" && Array.isArray(r.document) && keys.every((k) => r.honored?.[k] === true);
      const honors: string[] = [];
      if (by(asked.target, "target")) honors.push("target");
      if (by(asked.range, "start", "end")) honors.push("start and end");
      if (by(asked.granularity, "granularity")) honors.push("granularity");
      if (honors.length === 0) return { outcome: "pass", detail: "honors no query parameter (a static file satisfies every request)" };
      const declared = basicObjects[0]?.capabilities;
      if (declared === "basic") return `the origin honors ${honors.join(", ")} but publishes capabilities basic`;
      return { outcome: "pass", detail: `honors ${honors.join(", ")}` };
    }),
  );

  checks.push(
    await check("Extended range request (start, end, granularity=monthly) returns a valid response (ascending by period.start when an array)", "MUST", "Query Parameters", async () => {
      const r = await fetchSustainability(origin, { ...fetchOpts, ...year, granularity: "monthly" });
      if (r.status !== "ok") return `expected ok, got ${r.status}`;
      if (!Array.isArray(r.document)) return { outcome: "pass", detail: "parameters not honored (allowed: a static file satisfies every request)" };
      if (r.warnings?.some((w) => w.startsWith("not-ascending"))) {
        return { outcome: "warn", detail: `${r.document.length} objects; not in ascending order of period.start` };
      }
      return { outcome: "pass", detail: `${r.document.length} objects` };
    }),
  );

  checks.push(
    // Informational: the periods an origin publishes by default are whole
    // calendar years or months. Another period is allowed and is only noted.
    await check("Periods are whole calendar years or months (informational)", "INFO", "Mandatory Members", async () => {
      const other = basicObjects.find((o) => !isWholeCalendarPeriod(o.period, "yearly") && !isWholeCalendarPeriod(o.period, "monthly"));
      return other
        ? { outcome: "warn", detail: `period ${other.period.start}/${other.period.end} is neither a whole calendar year nor a whole month (allowed; noted only)` }
        : true;
    }),
  );

  return {
    origin,
    checks,
    ...(basicObjects[0] ? { capabilities: basicObjects[0].capabilities } : {}),
    // Computed from `outcome`, not from `pass`: a MUST-level WARN (the
    // generic media type) must not read as non-conformance.
    allPassed: checks.every((c) => c.outcome !== "fail" || c.level !== "MUST"),
    allPassedIncludingRecommended: checks.every((c) => c.outcome === "pass"),
  };
}

/** Run an async computation once and share its result. */
function memo<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= fn());
}
