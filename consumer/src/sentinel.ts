/**
 * The compatibility reading of the forms that draft -10 no longer allows
 * (draft -10 Appendices B.1 and C.1: "the consumer will read both forms").
 *
 * A document of -08 or -09 is not a valid -10 document. This module reads six
 * forms of such a document as the -10 forms they stand for, in place, and
 * reports each reading: the period (a -08 `reporting-period` label, a -09
 * `period` of two full-dates), a `measurement-method`, a `functional-unit`, a
 * `carbon-unit` (`mtCO2e`), an upstream `role` and a `target-type` outside
 * today's sets. Nothing else is read: a value of any other member that is not
 * valid, an `energy-unit`, a `carbon-accounting` or a `capabilities` outside
 * its set included, stays as served and the document is invalid, because
 * those members never had another spelling.
 *
 * The reading follows the same rules as `sustainability-publisher upgrade`, so
 * that what the consumer reads and what the tool writes agree. What it reports
 * is split in two lists of member paths, relative to the object and prefixed
 * `[i].` in an array:
 *
 *  - `converted`: the value is used, in another spelling (`period`,
 *    `functional-unit`, `carbon-unit`);
 *  - `disregarded`: the value is not used, and a stand-in or nothing takes its
 *    place (`measurement-method`, `sci-score` with its unit, `upstream[0].role`,
 *    `target-type`).
 *
 * With `legacyCompat: false` nothing here is called, and a document of an
 * earlier revision is reported invalid as served.
 */
import { dayPeriod, isFullDate, Period, PeriodError, periodFromFullDates, periodFromReportingPeriod } from "./period";
import {
  isFunctionalUnit,
  isMeasurementMethod,
  isTargetType,
  isUpstreamRole,
  legacyCarbonUnit,
  legacyFunctionalUnit,
  RESIDUAL_METHOD,
} from "./tokens";

/** What the compatibility reading did to one document: member paths, in the order the members were read. */
export interface CompatReport {
  converted: string[];
  disregarded: string[];
}

type Rec = Record<string, unknown>;

const isRecord = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The members that hold a metric. Negative figures and numbers past what
 * binary64 holds are invalid in -10 (there is no in-band "not reported" value,
 * draft -10 §Optional Members), and a figure that is wrong in this way is never
 * repaired by the compatibility reading; the list is for code that computes
 * with a document it has not validated.
 */
export const NUMERIC_KEYS = [
  "energy-consumption",
  "carbon-footprint",
  "sci-score",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
  "renewable-energy",
] as const;

/**
 * True for a value that cannot be a reported figure of a non-negative member:
 * a negative number, `NaN` or an infinity, and for `renewable-energy` a value
 * above 100. A valid -10 document has none; code that computes with a document
 * it has not validated uses this to leave such a value out of a sum.
 */
export function isNotReported(value: unknown, key?: string): boolean {
  if (typeof value !== "number") return false;
  if (!Number.isFinite(value) || value < 0) return true;
  return key === "renewable-energy" && value > 100;
}

/** A copy with every value that {@link isNotReported} flags removed; negative scopes are real data (net accounting) and stay. */
export function withoutSentinels<T extends object>(doc: T): Partial<T> {
  const out: Rec = { ...(doc as Rec) };
  for (const key of NUMERIC_KEYS) {
    if (isNotReported(out[key], key)) delete out[key];
  }
  return out as Partial<T>;
}

// The extension in which a gateway data file stated the fiscal year that its
// `reporting-period` label stood for, and its member.
const FISCAL_YEAR_EXTENSION = "urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041";
const FISCAL_YEAR_BASIS = "reporting-period-basis";
const FISCAL_YEAR_ENDED = /^fiscal-year-ended-([0-9]{4}-[0-9]{2}-[0-9]{2})$/;

// The fiscal year that ended on `end`: from the day after the same date a year earlier to the day after `end`.
function fiscalYear(end: string): Period {
  const [year, month, day] = end.split("-");
  const before = dayPeriod(`${Number(year) - 1}-${month}-${month === "02" && day === "29" ? "28" : day}`);
  return { start: before.end, end: dayPeriod(end).end };
}

function fiscalYearEnd(rec: Rec): string | undefined {
  const extension = isRecord(rec.extensions) ? rec.extensions[FISCAL_YEAR_EXTENSION] : undefined;
  const basis = isRecord(extension) ? extension[FISCAL_YEAR_BASIS] : undefined;
  return typeof basis === "string" ? FISCAL_YEAR_ENDED.exec(basis)?.[1] : undefined;
}

// Remove the fiscal-year basis from `extensions`, and what that leaves empty.
function dropFiscalYearBasis(rec: Rec): void {
  const extensions = rec.extensions as Rec;
  const { [FISCAL_YEAR_BASIS]: _basis, ...rest } = extensions[FISCAL_YEAR_EXTENSION] as Rec;
  const { [FISCAL_YEAR_EXTENSION]: _extension, ...others } = extensions;
  const kept = Object.keys(rest).length > 0 ? { ...others, [FISCAL_YEAR_EXTENSION]: rest } : others;
  if (Object.keys(kept).length > 0) rec.extensions = kept;
  else delete rec.extensions;
}

// Replace `reporting-period` by `period` where it stood, keeping the order of the members.
function replaceLabel(rec: Rec, period: Period): void {
  const entries = Object.entries(rec).map(([name, value]): [string, unknown] => (name === "reporting-period" ? ["period", period] : [name, value]));
  for (const name of Object.keys(rec)) delete rec[name];
  Object.assign(rec, Object.fromEntries(entries));
}

/**
 * The period of a -08 `reporting-period` label (the whole year, month or day,
 * or the exact fiscal year a gateway data file states beside it) or of a -09
 * `period` of two inclusive full-dates (the start of the first day to the start
 * of the day after the last). A value that names no date, a `period` that
 * holds one full-date and one date-time, and a label beside a `period` object
 * are left as served, and the document then fails validation.
 */
function readPeriod(rec: Rec, path: string, report: CompatReport): void {
  const label = rec["reporting-period"];
  const period = rec.period;
  try {
    if (period === undefined && typeof label === "string") {
      const end = fiscalYearEnd(rec);
      if (end !== undefined && label !== end.slice(0, 4)) return;
      replaceLabel(rec, end === undefined ? periodFromReportingPeriod(label) : fiscalYear(end));
      if (end !== undefined) dropFiscalYearBasis(rec);
    } else if (isRecord(period) && isFullDate(period.start) && isFullDate(period.end)) {
      rec.period = periodFromFullDates({ start: period.start, end: period.end });
    } else {
      return;
    }
    report.converted.push(`${path}period`);
  } catch (e) {
    if (!(e instanceof PeriodError)) throw e;
  }
}

function readMeasurementMethod(rec: Rec, path: string, report: CompatReport): void {
  const method = rec["measurement-method"];
  if (typeof method !== "string" || isMeasurementMethod(method)) return;
  rec["measurement-method"] = RESIDUAL_METHOD;
  report.disregarded.push(`${path}measurement-method`);
}

function readFunctionalUnit(rec: Rec, path: string, report: CompatReport): void {
  const unit = rec["functional-unit"];
  if (typeof unit !== "string" || isFunctionalUnit(unit)) return;
  const score = rec["sci-score"];
  const read = legacyFunctionalUnit(unit, typeof score === "number" ? score : undefined);
  if (read === undefined) {
    delete rec["functional-unit"];
    report.disregarded.push(`${path}functional-unit`);
    if (score !== undefined) {
      delete rec["sci-score"];
      report.disregarded.push(`${path}sci-score`);
    }
    return;
  }
  rec["functional-unit"] = read.unit;
  if (read.score !== undefined) rec["sci-score"] = read.score;
  report.converted.push(`${path}functional-unit`);
}

function readCarbonUnit(rec: Rec, path: string, report: CompatReport): void {
  const unit = rec["carbon-unit"];
  const read = typeof unit === "string" ? legacyCarbonUnit(unit) : undefined;
  if (read === undefined) return;
  rec["carbon-unit"] = read;
  report.converted.push(`${path}carbon-unit`);
}

function readRoles(rec: Rec, path: string, report: CompatReport): void {
  if (!Array.isArray(rec.upstream)) return;
  rec.upstream.forEach((entry: unknown, i: number) => {
    if (!isRecord(entry) || typeof entry.role !== "string" || isUpstreamRole(entry.role)) return;
    delete entry.role;
    report.disregarded.push(`${path}upstream[${i}].role`);
  });
}

function readTargetType(rec: Rec, path: string, report: CompatReport): void {
  const type = rec["target-type"];
  if (typeof type !== "string" || isTargetType(type)) return;
  delete rec["target-type"];
  report.disregarded.push(`${path}target-type`);
}

/**
 * Read one declaration object of an earlier revision as a -10 object, in
 * place, and append what was read to `report`. An object that is already a -10
 * object is left exactly as it is and adds nothing. Anything but an object is
 * ignored.
 *
 * It is the one reading for every declaration the consumer meets: the document
 * it retrieved, each declaration of an upstream walk, and the payload of a
 * signature, which must be read like the object it signs for the two to
 * compare equal.
 *
 * @param o the declaration object
 * @param path prefix of the reported member paths, `"[2]."` for the third object of an array
 */
export function applyCompatibilityReading(o: unknown, path: string, report: CompatReport): void {
  if (!isRecord(o)) return;
  readPeriod(o, path, report);
  readMeasurementMethod(o, path, report);
  readFunctionalUnit(o, path, report);
  readCarbonUnit(o, path, report);
  readRoles(o, path, report);
  readTargetType(o, path, report);
}

/** The compatibility reading of a body: one object, or each object of an array. */
export function readDocument(doc: unknown, report: CompatReport): void {
  if (Array.isArray(doc)) doc.forEach((item, i) => applyCompatibilityReading(item, `[${i}].`, report));
  else applyCompatibilityReading(doc, "", report);
}
