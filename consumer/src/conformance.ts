/**
 * A small conformance-check battery for any /.well-known/sustainability-data
 * origin — usable against this repo's own implementations or any third
 * party's, not just via the CLI's --strict flag.
 */
import { DEFAULT_TIMEOUT_MS, fetchSustainability } from "./fetch";
import { resolveWellKnownUrl } from "./fetch";
import { ACCEPT_HEADER, classifyMediaType, LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "./media-type";
import { AddressLookup } from "./transport";

/**
 * BCP 14 strength of the requirement a check tests. This matters for reporting:
 * a static host that cannot emit an `Allow` header on its own 405 is violating
 * a SHOULD, not a MUST, and a battery that renders both as "FAIL" tells a
 * publisher their conformant deployment is broken.
 */
export type ConformanceLevel = "MUST" | "SHOULD";

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
  detail?: string;
}

export interface ConformanceReport {
  origin: string;
  checks: ConformanceCheck[];
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
  fn: () => Promise<CheckResult>,
): Promise<ConformanceCheck> {
  const made = (outcome: ConformanceOutcome, detail?: string): ConformanceCheck => ({
    name,
    level,
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
   * smoke test this battery is meant for; the raw probes below speak to
   * whatever URL the caller named either way.
   */
  allowInsecure?: boolean;
  /** Resolver for the address check, forwarded to fetchSustainability. */
  lookup?: AddressLookup;
  /** Opt out of the address check (default: the value of `allowInsecure`). */
  allowPrivateAddresses?: boolean;
  /**
   * The clock the battery reads, `() => new Date()` by default.
   *
   * It has exactly one use: choosing the year the Extended granularity check
   * asks about, which is the current one — the period a live publisher is most
   * likely to hold entries for. Nothing else in the battery reads it, and no
   * verdict depends on it (a publisher holding nothing for that year answers
   * `404`, which the check accepts). Pass a fixed clock so a run is reproducible
   * and a recorded request URL does not change with the date, as the publisher
   * package's `PublisherOptions.now` does for the aggregation rule.
   */
  now?: () => Date;
}

export async function runConformanceChecks(
  origin: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];
  const { timeoutMs, maxBytes, allowInsecure, allowPrivateAddresses, lookup } = options;
  const year = (options.now ?? (() => new Date()))().getUTCFullYear().toString();
  // legacyCompat is disabled here on purpose: a conformance checker must see
  // the document as served. With the pre-pass on, a document missing the
  // mandatory `target` member would get the origin host injected and pass the
  // schema gate — masking exactly the non-conformance this battery exists to
  // detect. (The Basic check below thus inherently requires `target`.)
  const fetchOpts = { fetchImpl, timeoutMs, maxBytes, legacyCompat: false, allowInsecure, allowPrivateAddresses, lookup };
  /** Signal for the raw (non-fetchSustainability) probes below, so they can't hang either. */
  // Raw probes get the same default timeout as fetchSustainability — a
  // hanging origin must not stall the battery on undici's ~5-minute defaults.
  const rawSignal = () => AbortSignal.timeout(timeoutMs ?? DEFAULT_TIMEOUT_MS);

  checks.push(
    await check("Basic request returns a schema-valid single object", "MUST", async () => {
      const r = await fetchSustainability(origin, fetchOpts);
      if (r.status !== "ok") return `expected ok, got ${r.status}`;
      if (Array.isArray(r.document)) return "Basic request MUST return a single object, not an array";
      return true;
    }),
  );

  checks.push(
    // Draft -07 §Mandatory Minimum Supported Service: a 200 response MUST
    // carry `application/sustainability-data+json` and MUST NOT carry any
    // other media type. A publisher still serving the generic
    // `application/json` is reported as WARN rather than FAIL: the draft has
    // consumers keep processing those (declarations published before the
    // registration exist under it) and the type is still awaiting IANA
    // registration. Anything else is a fail — including a missing
    // Content-Type, since a response of another type is not a declaration.
    await check(`Basic 200 response uses the ${MEDIA_TYPE} media type`, "MUST", async () => {
      const res = await fetchImpl(resolveWellKnownUrl(origin).toString(), {
        method: "GET",
        headers: { Accept: ACCEPT_HEADER },
        signal: rawSignal(),
      });
      // Drain the body so the socket is released promptly.
      await res.arrayBuffer().catch(() => undefined);
      if (res.status !== 200) return `expected 200 for the Basic request, got ${res.status}`;
      const raw = res.headers.get("content-type");
      switch (classifyMediaType(raw)) {
        case "sustainability-data+json":
          return true;
        case "json":
          return {
            outcome: "warn",
            detail: `generic media type (${LEGACY_MEDIA_TYPE}): processed, but a conformant 200 response carries ${MEDIA_TYPE}`,
          };
        default:
          return `Content-Type is neither ${MEDIA_TYPE} nor ${LEGACY_MEDIA_TYPE}: "${raw ?? ""}"`;
      }
    }),
  );

  checks.push(
    // Draft -07 §Signing: the `signed` member is OPTIONAL and a consumer
    // checks it only when it is present. Absent (`unsigned`) is therefore a
    // pass — it means only that the publisher does not sign. When it IS
    // published it must verify under an asymmetric algorithm with the
    // required `cty`; a member that does not verify is a MUST failure, and a
    // payload that differs from the served members is reported, not failed
    // (which set of members a consumer USES depends on how far the key is
    // trusted — see SignatureResult.precedence).
    await check(
      "Embedded signature (OPTIONAL `signed` member): absent, or present and verifiable",
      "MUST",
      async () => {
        const r = await fetchSustainability(origin, { ...fetchOpts, verifySignature: true });
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
          `${first.alg}${first.kid ? ` kid=${first.kid}` : ""} (key from ` +
          `${first.keySource === "trusted" ? "pinned key; the payload's members take precedence" : "signature header; the members served by the origin remain in use"})`;
        if (verified.some((s) => s.status === "verified" && s.modifiedAfterSigning)) {
          return { outcome: "warn", detail: `verified ${who}, but the served members differ from the signed payload` };
        }
        return { outcome: "pass", detail: `verified ${who}` };
      },
    ),
  );

  checks.push(
    await check("Response carries an ETag", "SHOULD", async () => {
      const r = await fetchSustainability(origin, fetchOpts);
      return r.status === "ok" && !!r.etag;
    }),
  );

  checks.push(
    await check("Conditional GET with a fresh ETag returns 304", "SHOULD", async () => {
      const first = await fetchSustainability(origin, fetchOpts);
      if (first.status !== "ok" || !first.etag) return "no ETag to test conditional request with";
      const second = await fetchSustainability(origin, { ...fetchOpts, ifNoneMatch: first.etag });
      return second.status === "not-modified" || `expected not-modified, got ${second.status}`;
    }),
  );

  checks.push(
    await check("A method other than GET/HEAD gets 405 with Allow", "SHOULD", async () => {
      const res = await fetchImpl(resolveWellKnownUrl(origin).toString(), { method: "POST", signal: rawSignal() });
      await res.arrayBuffer().catch(() => undefined);
      if (res.status !== 405) return `expected 405, got ${res.status}`;
      const allow = res.headers.get("allow") ?? "";
      return allow.includes("GET") || `Allow header missing GET: "${allow}"`;
    }),
  );

  checks.push(
    await check("Extended granularity request returns a valid response (sorted array when honored)", "MUST", async () => {
      const r = await fetchSustainability(origin, { ...fetchOpts, period: year, granularity: "monthly" });
      if (r.status === "not-found") return true; // server may have no data for this year; not a conformance failure
      if (r.status !== "ok") return `expected ok or not-found, got ${r.status}`;
      // The draft's array-when-finer-granularity rule is a SHOULD: a server
      // ignoring the parameter and returning its Basic single object is
      // conformant, so a non-array does not fail the check — but say so.
      if (!Array.isArray(r.document)) {
        return true; // single object: granularity not honored (allowed; Basic fallback)
      }
      return true; // shape/order already enforced by validateDocument() inside fetchSustainability
    }),
  );

  return {
    origin,
    checks,
    // Computed from `outcome`, not from `pass`: a MUST-level WARN (the
    // generic media type) must not read as non-conformance.
    allPassed: checks.every((c) => c.outcome !== "fail" || c.level !== "MUST"),
    allPassedIncludingRecommended: checks.every((c) => c.outcome === "pass"),
  };
}
