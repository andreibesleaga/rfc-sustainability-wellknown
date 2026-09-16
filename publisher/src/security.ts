/**
 * The three safeguards from the draft's Security and Privacy sections,
 * ported from `example-scripts/security.js` into the gateway:
 *
 *  1. DoS protection      — cap arrays at 366 objects. -07 dropped the server-side
 *                           cap in favour of a consumer-side bound, but a conforming
 *                           response is bounded by the calendar anyway (at most 366
 *                           daily objects in a year), so the cap is kept as this
 *                           package's own safeguard (draft §Denial of Service).
 *  2. Traffic analysis    — drop entries finer than 24h (draft §Privacy Considerations:
 *                           SHOULD NOT report at a granularity finer than 24 hours).
 *  3. Anti-fingerprinting — apply ~1% noise to numeric members (draft §Privacy
 *                           Considerations, MAY; OFF BY DEFAULT — nothing here
 *                           perturbs a published value unless the operator sets
 *                           `applyNoise: true`).
 *
 * DISCLOSURE (draft §Privacy Considerations, a MUST): a publisher that enables
 * `applyNoise` MUST state in its methodology document that noise is applied and
 * MUST bound its magnitude. This library applies at most +/-1% multiplicative
 * noise, so a bound of 1% is accurate for the default configuration; nothing in
 * this module writes that statement for the operator, and nothing here can
 * verify that it was written. The library therefore never enables noise on the
 * operator's behalf: opting in is the same act as taking on the disclosure
 * obligation. `methodology-uri` is the designated place for the statement.
 */
import { SustainabilityMetrics } from "./types";

export interface SecurityOptions {
  /** Max array length. Default 366 (a year of daily objects). */
  maxObjects?: number;
  /** Drop entries whose reporting-period is finer than a day. Default true. */
  enforceDailyFloor?: boolean;
  /**
   * Apply ~1% multiplicative fuzz to `energy-consumption`, `carbon-footprint`
   * and the scope members (draft §Privacy Considerations, a MAY). Default
   * FALSE: values are published exactly as the adapter measured them unless
   * the operator opts in here.
   *
   * Enabling this carries a MUST: the methodology document at
   * `methodology-uri` has to state that noise is applied and bound its
   * magnitude (at most +/-1% for this implementation). Do not enable it
   * without publishing that statement.
   */
  applyNoise?: boolean;
}

// The noise list deliberately covers only the additive family (energy,
// footprint, scopes): the same multiplicative factor keeps scopes summing to
// the footprint and E x I = C intact (intensity stays truthful un-noised).
// carbon-intensity / estimated-annual / sci-score / renewable-energy are left
// un-noised by owner decision — note that a publisher pairing a noised
// footprint with an un-noised annual estimate lets a reader reconstruct the
// pre-noise footprint (annual/365); deployments that care should omit the
// annual member or extend this list themselves.
//
// Draft §Privacy Considerations: "bounded members MUST remain within their
// range" after noise.
// Because `renewable-energy` (the only range-bounded member) is NOT in this
// list, it is never noised and the range rule is trivially satisfied — a
// deployment extending the list to any range-bounded member must add
// post-noise clamping to keep that MUST holding.
const NUMERIC_KEYS = [
  "energy-consumption",
  "carbon-footprint",
  "scope-1",
  "scope-2",
  "scope-3",
] as const;

/** A `reporting-period` longer than "YYYY-MM-DD" (10 chars) implies sub-daily data. */
function isDailyOrCoarser(period: string): boolean {
  return (period ?? "").length <= 10;
}

/**
 * Deterministic ~±1% fuzz factor derived from the reporting period (djb2 hash).
 * The draft requires noise to be applied "once, at generation time,
 * deterministically per period" — regenerating the same period
 * (e.g. after cache expiry) must yield the same published values. A single
 * factor per report keeps arithmetically related fields consistent (scopes
 * still sum to the fuzzed carbon-footprint, modulo rounding).
 */
function fuzzFactorFor(period: string): number {
  let h = 5381;
  for (let i = 0; i < period.length; i++) h = ((h << 5) + h + period.charCodeAt(i)) >>> 0;
  return 0.99 + ((h % 1000) / 1000) * 0.02; // 0.99 – 1.01
}

/** Apply safeguards to a list of metrics objects; returns a new array. */
export function secureReports(
  reports: SustainabilityMetrics[],
  opts: SecurityOptions = {},
): SustainabilityMetrics[] {
  const maxObjects = opts.maxObjects ?? 366;
  const enforceDailyFloor = opts.enforceDailyFloor ?? true;
  const applyNoise = opts.applyNoise ?? false;

  // Filter before capping so floor-dropped entries do not consume cap slots.
  let out = reports;
  if (enforceDailyFloor) {
    out = out.filter((r) => isDailyOrCoarser(String(r["reporting-period"] ?? "")));
  }

  // Trend arrays MUST be sorted ascending by reporting-period (draft §Payload
  // Format); when the cap is exceeded, keep the MOST RECENT periods.
  out = [...out].sort((a, b) =>
    String(a["reporting-period"] ?? "").localeCompare(String(b["reporting-period"] ?? "")),
  );
  if (out.length > maxObjects) out = out.slice(out.length - maxObjects);

  if (applyNoise) {
    out = out.map((r) => {
      const fuzz = fuzzFactorFor(String(r["reporting-period"] ?? ""));
      const secured: SustainabilityMetrics = { ...r };
      for (const key of NUMERIC_KEYS) {
        const v = secured[key];
        // Multiplicative noise applies to every reported value regardless of
        // sign (scopes MAY be negative under net accounting): multiplication
        // preserves sign and keeps arithmetically related fields consistent.
        // An unreported metric is simply absent (-03 removed the sentinel).
        if (typeof v === "number") {
          secured[key] = Math.round(v * fuzz * 100) / 100;
        }
      }
      return secured;
    });
  }

  return out;
}
