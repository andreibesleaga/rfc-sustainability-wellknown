/**
 * Reporting periods and the Extended service's selection rule — the draft's
 * §Optional Extended Query Parameters, as one pure function over a sorted
 * trend:
 *
 *  - `period` names a calendar year, month or day (UTC); an entry belongs to
 *    it when its own `reporting-period` lies inside it;
 *  - an array is returned ONLY when a `granularity` finer than the period was
 *    requested and the trend holds entries at that precision (draft: "The
 *    server MUST NOT return an array unless a granularity finer than the
 *    period was requested"); a granularity that is not finer, unknown, or
 *    that the data cannot honour is ignored;
 *  - otherwise one object: the entry for the period itself, or — when only
 *    finer entries exist — their aggregate (energy and carbon summed, in one
 *    unit), else no data (404);
 *  - a publisher that does not support the parameters ignores them and
 *    returns the Basic response: the most recently completed period.
 */
import { Capabilities, ServiceQuery, SustainabilityDocument, SustainabilityMetrics } from "./types";
import { round } from "./util";

/**
 * Draft period shape: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Month is bounded to
 * 01-12 and day to 01-31 by the pattern; {@link isCalendarPeriod} also checks
 * the day exists in that month. Exported as the single source of truth;
 * adapters import this rather than duplicating the pattern.
 */
export const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** True for a well-formed period whose day, if any, exists (no "2026-02-30"). */
export function isCalendarPeriod(period: string): boolean {
  if (!PERIOD_RE.test(period)) return false;
  if (period.length < 10) return true;
  const [y, m, d] = period.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 1 = year, 2 = month, 3 = day. */
export function periodPrecision(period: string): 1 | 2 | 3 {
  return period.length === 4 ? 1 : period.length === 7 ? 2 : 3;
}

const GRANULARITY_PRECISION: Record<string, 2 | 3> = { monthly: 2, daily: 3 };

/** True when `entryPeriod` lies inside `period` (same or finer precision). */
export function isWithin(entryPeriod: string, period: string): boolean {
  return entryPeriod === period || entryPeriod.startsWith(`${period}-`);
}

/** The energy and carbon members that sum, with the unit member each one is expressed in. */
const SUMMABLE: ReadonlyArray<{ member: string; unit: string; fallback: string }> = [
  { member: "energy-consumption", unit: "energy-unit", fallback: "kWh" },
  { member: "carbon-footprint", unit: "carbon-unit", fallback: "gCO2e" },
  { member: "scope-1", unit: "carbon-unit", fallback: "gCO2e" },
  { member: "scope-2", unit: "carbon-unit", fallback: "gCO2e" },
  { member: "scope-3", unit: "carbon-unit", fallback: "gCO2e" },
];

/** Members that describe one period's figures and cannot be summed across periods. */
const NOT_AGGREGABLE = [
  "renewable-energy",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
  "sci-score",
  "functional-unit",
];

/**
 * One object for `period` from finer entries inside it (draft: "aggregate
 * into one object ... energy and carbon are summed after unit conversion").
 * Entries are not converted here: they must already share a unit, otherwise
 * there is no honest single figure and the answer is no data.
 */
export function aggregatePeriod(entries: SustainabilityMetrics[], period: string): SustainabilityMetrics | undefined {
  const newest = entries[entries.length - 1];
  const out: Record<string, unknown> = { ...newest, "reporting-period": period };
  for (const member of NOT_AGGREGABLE) delete out[member];
  out.updated = entries.map((e) => e.updated).sort().pop();
  for (const { member, unit, fallback } of SUMMABLE) {
    const reporting = entries.filter((e) => typeof (e as Record<string, unknown>)[member] === "number");
    delete out[member];
    if (reporting.length !== entries.length) continue; // not reported by every entry: not reported
    const units = new Set(reporting.map((e) => (e as Record<string, unknown>)[unit] ?? fallback));
    if (units.size > 1) return undefined;
    out[member] = round(reporting.reduce((sum, e) => sum + ((e as Record<string, unknown>)[member] as number), 0));
    out[unit] = [...units][0];
  }
  for (const { unit } of SUMMABLE) {
    if (!SUMMABLE.some((s) => s.unit === unit && out[s.member] !== undefined)) delete out[unit];
  }
  return out as unknown as SustainabilityMetrics;
}

/**
 * Select what a query returns from a trend sorted ascending by period.
 * `undefined` means no data for the request (the no-data rule, 404).
 */
export function selectPeriod(
  entries: SustainabilityMetrics[],
  query: ServiceQuery,
  capabilities: Capabilities,
): SustainabilityDocument | undefined {
  if (entries.length === 0) return undefined;
  const newest = entries[entries.length - 1];
  if (capabilities !== "extended" || (query.period === undefined && query.granularity === undefined)) return newest;

  const period = query.period ?? newest["reporting-period"];
  const within = entries.filter((e) => isWithin(e["reporting-period"], period));
  if (within.length === 0) return undefined;

  const wanted = query.granularity !== undefined ? GRANULARITY_PRECISION[query.granularity] : undefined;
  if (wanted !== undefined && wanted > periodPrecision(period)) {
    const sliced = within.filter((e) => periodPrecision(e["reporting-period"]) === wanted);
    if (sliced.length > 0) return sliced;
  }
  const exact = within.find((e) => e["reporting-period"] === period);
  if (exact) return exact;
  return aggregatePeriod(within, period);
}
