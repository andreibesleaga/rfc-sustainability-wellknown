/**
 * The three safeguards from the draft's Security and Privacy sections,
 * ported from `example-scripts/security.js` into the gateway:
 *
 *  1. DoS protection      — cap arrays at 366 objects, keeping the most recent, and
 *                           say so when the cap cuts (draft §Security Considerations:
 *                           a server bounds the work of a request).
 *  2. Traffic analysis    — keep to periods of a calendar day or longer (draft
 *                           §Mandatory Members and §Privacy Considerations: a SHOULD,
 *                           and real-time telemetry is NOT RECOMMENDED). By default an
 *                           object whose bounds are not the first instant of a calendar
 *                           day in their own offset is dropped with a warning; the
 *                           operator may keep it with a warning, or without.
 *  3. Anti-fingerprinting — apply ~1% noise to the numeric members (draft §Privacy
 *                           Considerations, MAY; OFF BY DEFAULT — nothing here
 *                           perturbs a published value unless the operator sets
 *                           `applyNoise: true`).
 *
 * DISCLOSURE (draft §Privacy Considerations, a MUST): a publisher that enables
 * `applyNoise` MUST state in its methodology document that noise is applied and
 * MUST bound its magnitude. This library applies at most +/-1% multiplicative
 * noise, so a bound of 1% is accurate; nothing in this module writes that
 * statement for the operator, and nothing here can verify that it was written.
 * The library therefore never enables noise on the operator's behalf, and
 * refuses to apply it until the operator confirms with `noiseDisclosed: true`
 * that the statement is in the document at `methodology-uri`.
 */
import { canonicalKey, isOnDayBoundaries } from "./period";
import { sortDeclarations } from "./selection";
import { SustainabilityMetrics } from "./types";

export interface SecurityOptions {
  /** Max array length. Default 366 (a year of daily objects). */
  maxObjects?: number;
  /**
   * What to do with an object whose bounds are not the first instant of a
   * calendar day in their own offset (so a period shorter than a day, or off
   * midnight): `"drop"` leaves it out and warns (default), `"warn"` keeps it and
   * warns, `"off"` keeps it silently. A 23-hour or 25-hour day of a change of
   * daylight-saving time satisfies the rule.
   */
  dayFloor?: "drop" | "warn" | "off";
  /**
   * Apply ~1% multiplicative fuzz to `energy-consumption`, `carbon-footprint`,
   * the scope members, `estimated-annual-emissions-kgCO2e` and `sci-score`
   * (draft §Privacy Considerations, a MAY). Default FALSE: values are published
   * exactly as the adapter measured them unless the operator opts in here, and
   * the opt-in needs {@link SecurityOptions.noiseDisclosed}.
   */
  applyNoise?: boolean;
  /**
   * The operator's confirmation that the methodology document at
   * `methodology-uri` states that noise is applied and bounds its magnitude (at
   * most +/-1% here). Without it `applyNoise` is refused.
   */
  noiseDisclosed?: boolean;
  /**
   * Receives each warning: an object dropped or kept below the day floor, and a
   * selection cut by `maxObjects`. A message names the periods held, which the
   * response never does (draft §Privacy Considerations), so it goes to the
   * operator's channel only; with no hook nothing is written.
   */
  onWarning?: (message: string) => void;
}

// The members the one factor applies to: the additive quantities and the members
// derived from them, so that no unperturbed member discloses a perturbed one (the
// annual estimate over 365 is the footprint). Ratios and percentages are left as
// they are: the factor keeps energy x intensity = footprint intact, and a
// percentage must stay within its range.
const NOISE_MEMBERS = [
  "energy-consumption",
  "carbon-footprint",
  "scope-1",
  "scope-2",
  "scope-3",
  "estimated-annual-emissions-kgCO2e",
  "sci-score",
] as const;

/**
 * Deterministic ~±1% fuzz factor derived from the period, by its canonical key
 * in UTC (djb2 hash), so that `Z`, `+00:00` and `.000Z` spellings of one period
 * give one factor. The draft requires noise to be applied "once, at generation
 * time, deterministically per period": regenerating the same period (after
 * cache expiry, say) yields the same published values. A single factor per
 * object keeps arithmetically related members consistent.
 */
function fuzzFactorFor(key: string): number {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return 0.99 + ((h % 1000) / 1000) * 0.02; // 0.99 – 1.01
}

/**
 * Apply the safeguards to a list of objects; returns a new array, in ascending
 * order of period, of at most `maxObjects` objects.
 */
export function secureReports(reports: SustainabilityMetrics[], opts: SecurityOptions = {}): SustainabilityMetrics[] {
  const maxObjects = opts.maxObjects ?? 366;
  const dayFloor = opts.dayFloor ?? "drop";
  const warn = opts.onWarning ?? (() => {});
  if (opts.applyNoise && !opts.noiseDisclosed) {
    throw new Error(
      "security: applyNoise needs noiseDisclosed: true, your confirmation that the methodology document " +
        "states that noise is applied and bounds its magnitude (draft, Privacy Considerations)",
    );
  }

  // Filter before capping so floor-dropped entries do not consume cap slots.
  let out = reports;
  if (dayFloor !== "off") {
    out = out.filter((r) => {
      if (isOnDayBoundaries(r.period)) return true;
      warn(
        `period ${r.period.start} to ${r.period.end} of ${JSON.stringify(r.target)} is not a calendar day or longer on day boundaries` +
          (dayFloor === "drop" ? "; the object is not published (dayFloor: drop)" : ""),
      );
      return dayFloor === "warn";
    });
  }

  // Ascending by the instants of the period; when the cap is exceeded, keep the MOST RECENT.
  out = sortDeclarations(out);
  if (out.length > maxObjects) {
    warn(`${out.length} objects selected; the ${maxObjects} most recent are published (maxObjects)`);
    out = out.slice(out.length - maxObjects);
  }

  if (opts.applyNoise) {
    out = out.map((r) => {
      const fuzz = fuzzFactorFor(canonicalKey(r.period));
      const secured: SustainabilityMetrics = { ...r };
      for (const key of NOISE_MEMBERS) {
        const v = secured[key];
        // Multiplication preserves sign (scopes MAY be negative under net accounting).
        if (typeof v === "number") secured[key] = Number((v * fuzz).toPrecision(6));
      }
      return secured;
    });
  }

  return out;
}
