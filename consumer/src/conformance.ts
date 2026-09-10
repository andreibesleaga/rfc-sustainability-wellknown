/**
 * A small conformance-check battery for any /.well-known/sustainability-data
 * origin — usable against this repo's own implementations or any third
 * party's, not just via the CLI's --strict flag.
 */
import { DEFAULT_TIMEOUT_MS, fetchSustainability } from "./fetch";
import { resolveWellKnownUrl } from "./fetch";
import { ACCEPT_HEADER, classifyMediaType, LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "./media-type";

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
 *    hold against the origin. The one case today is a publisher still serving
 *    the pre-06 `application/json` media type: valid for -05, not conformant
 *    with -06, and not something to fail an origin over while the dedicated
 *    media type is still awaiting IANA registration.
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
}

export async function runConformanceChecks(
  origin: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const checks: ConformanceCheck[] = [];
  const { timeoutMs, maxBytes, allowInsecure } = options;
  // legacyCompat is disabled here on purpose: a conformance checker must see
  // the document as served. With the pre-pass on, a document missing the
  // mandatory `target` member would get the origin host injected and pass the
  // schema gate — masking exactly the non-conformance this battery exists to
  // detect. (The Basic check below thus inherently requires `target`.)
  const fetchOpts = { fetchImpl, timeoutMs, maxBytes, legacyCompat: false, allowInsecure };
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
    // -06 §Mandatory Minimum Supported Service: a 200 response MUST use the
    // registered `application/sustainability-data+json` media type and MUST
    // NOT use any other. A publisher still on the pre-06 `application/json`
    // is reported as WARN rather than FAIL: such documents are what -06 tells
    // clients to keep accepting, the dedicated type is still awaiting IANA
    // registration, and failing every deployed -05 publisher over it would
    // make the battery useless during exactly the transition it exists for.
    // Anything else is a fail — including a missing Content-Type.
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
            detail: `pre-06 media type (${LEGACY_MEDIA_TYPE}): v05-compatible, not v06-conformant`,
          };
        default:
          return `Content-Type is neither ${MEDIA_TYPE} nor ${LEGACY_MEDIA_TYPE}: "${raw ?? ""}"`;
      }
    }),
  );

  checks.push(
    // -06 §Mandatory Minimum Supported Service: "servers SHOULD send
    // `X-Content-Type-Options: nosniff` on responses to the well-known URI,
    // so that a client cannot be induced to interpret the document as some
    // other, more dangerous type".
    await check("Response sends X-Content-Type-Options: nosniff", "SHOULD", async () => {
      const res = await fetchImpl(resolveWellKnownUrl(origin).toString(), {
        method: "GET",
        headers: { Accept: ACCEPT_HEADER },
        signal: rawSignal(),
      });
      await res.arrayBuffer().catch(() => undefined);
      const raw = res.headers.get("x-content-type-options");
      return (
        (raw ?? "").trim().toLowerCase() === "nosniff" ||
        `X-Content-Type-Options is not "nosniff": "${raw ?? ""}"`
      );
    }),
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
      const r = await fetchSustainability(origin, { ...fetchOpts, period: new Date().getUTCFullYear().toString(), granularity: "monthly" });
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
    // Computed from `outcome`, not from `pass`: a MUST-level WARN (the pre-06
    // media type) must not read as non-conformance.
    allPassed: checks.every((c) => c.outcome !== "fail" || c.level !== "MUST"),
    allPassedIncludingRecommended: checks.every((c) => c.outcome === "pass"),
  };
}
