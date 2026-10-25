/**
 * The three safeguards from the draft's Security and Privacy sections,
 * ported from `example-scripts/security.js` into the gateway:
 *
 *  1. DoS protection      — bound the number of objects HELD (366 by default) and
 *                           refuse to build above it; an answer is never truncated
 *                           (a deployment safeguard; -10 bounds the consumer, not
 *                           the server).
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
 * DISCLOSURE (draft, Privacy Considerations): the methodology document states
 * that noise is applied and bounds its magnitude; a publisher that enables
 * `applyNoise` must write that statement. This library applies at most +/-1% multiplicative
 * noise, so a bound of 1% is accurate; nothing in this module writes that
 * statement for the operator, and nothing here can verify that it was written.
 * The library therefore never enables noise on the operator's behalf, and
 * refuses to apply it until the operator confirms with `noiseDisclosed: true`
 * that the statement is in the document at `methodology-uri`.
 */
import { canonicalKey, isOnDayBoundaries } from "./period";
import { sortDeclarations } from "./selection";
import { SustainabilityMetrics } from "./types";

const DEFAULT_MAX_OBJECTS = 366;

export interface SecurityOptions {
  /**
   * Max objects held by the adapter. Default 366 (a year of daily objects). Above it
   * the build is refused: an answer is never cut.
   */
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
   * Receives each warning: an object dropped or kept below the day floor. A message names the periods held, which the
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
 * Refuse a held set larger than `maxObjects`. The cap bounds what is held, not
 * what is answered: a selection is never cut.
 */
export function assertHeldWithinCap(held: readonly unknown[], maxObjects: number = DEFAULT_MAX_OBJECTS): void {
  if (held.length > maxObjects) {
    throw new Error(
      `security: the adapter holds ${held.length} objects, more than maxObjects (${maxObjects}); ` +
        "raise maxObjects or hold fewer objects (an answer is never truncated)",
    );
  }
}

/**
 * Apply the safeguards to a list of objects; returns a new array, in ascending
 * order of period. The number of objects is bounded by {@link assertHeldWithinCap}.
 */
export function secureReports(reports: SustainabilityMetrics[], opts: SecurityOptions = {}): SustainabilityMetrics[] {
  const dayFloor = opts.dayFloor ?? "drop";
  const warn = opts.onWarning ?? (() => {});
  if (opts.applyNoise && !opts.noiseDisclosed) {
    throw new Error(
      "security: applyNoise needs noiseDisclosed: true, your confirmation that the methodology document " +
        "states that noise is applied and bounds its magnitude (draft, Privacy Considerations)",
    );
  }

  let out = reports;
  if (dayFloor !== "off") {
    out = out.filter((r) => {
      if (isOnDayBoundaries(r.period)) return true;
      warn(
        `period ${r.period.start}/${r.period.end} of ${JSON.stringify(r.target)} is not a calendar day or longer on day boundaries` +
          (dayFloor === "drop" ? "; the object is not published (dayFloor: drop)" : ""),
      );
      return dayFloor === "warn";
    });
  }

  // Ascending by the instants of the period.
  out = sortDeclarations(out);

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
