/**
 * Conversion of a declaration written for -08 or -09 to the current form (draft
 * Appendix B.1 and Appendix C.1). It converts what converts exactly and drops
 * what does not, and it says which: every change is a note, and an object that
 * is already valid is returned as it was.
 *
 * Only the forms an earlier revision allowed are read: the period, a
 * `measurement-method`, a `functional-unit`, a `carbon-unit`, an upstream
 * `role` and a `target-type` outside today's sets. A value of any other member
 * that is not valid stays as it is, and the result then fails validation.
 */
import { parseStrict } from "./json";
import {
  dayPeriod,
  isDateTime,
  isFullDate,
  Period,
  PeriodError,
  periodFromFullDates,
  periodFromReportingPeriod,
} from "./period";
import {
  isCarbonUnit,
  isFunctionalUnit,
  isMeasurementMethod,
  isTargetType,
  isUpstreamRole,
  legacyCarbonUnit,
  legacyFunctionalUnit,
  MeasurementMethod,
  MEASUREMENT_METHODS,
  RESIDUAL_METHOD,
} from "./tokens";
import { validateDocument } from "./validate";

export interface UpgradeOptions {
  /** The offset (`Z` or `+hh:mm`) in which a calendar day of an earlier revision begins; default `Z`. */
  offset?: string;
  /** The `updated` of every object that is converted; default the value it carries. */
  updated?: string;
  /** The token for a `measurement-method` outside the set; default the residual token. */
  measurementMethod?: MeasurementMethod;
}

export type UpgradeRule =
  | "period"
  | "fiscal-year"
  | "measurement-method"
  | "functional-unit"
  | "carbon-unit"
  | "role"
  | "target-type"
  | "provider"
  | "signed"
  | "updated";

/** One change, or one value dropped. */
export interface UpgradeNote {
  rule: UpgradeRule;
  /** The member, relative to its object: `period`, `upstream[0].role`; an array's objects are prefixed `[i].`. */
  path: string;
  message: string;
}

export interface UpgradeResult {
  /** The converted document: the input itself when no note was made. */
  document: unknown;
  notes: UpgradeNote[];
  /** Why the document cannot be converted, or is not valid once converted; empty when it is. */
  errors: string[];
  warnings: string[];
}

/** Why `options` cannot be used, or `undefined` when they can. */
export function upgradeOptionsError(options: UpgradeOptions): string | undefined {
  const { offset, updated, measurementMethod } = options;
  if (offset !== undefined && !/^(Z|[+-](0[0-9]|1[0-9]|2[0-3]):[0-5][0-9])$/.test(offset)) {
    return `--offset ${JSON.stringify(offset)} is not Z or an offset such as +08:00`;
  }
  if (updated !== undefined && !isDateTime(updated)) {
    return `--updated ${JSON.stringify(updated)} is not an RFC 3339 date-time with upper-case T and Z, such as 2026-11-02T00:00:00Z`;
  }
  if (measurementMethod !== undefined && !isMeasurementMethod(measurementMethod)) {
    return `--measurement-method ${JSON.stringify(measurementMethod)} is not one of ${MEASUREMENT_METHODS.join(", ")}`;
  }
  return undefined;
}

type Record_ = Record<string, unknown>;

const isRecord = (value: unknown): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value);

// The extension in which a gateway data file stated the fiscal year that its
// `reporting-period` label stood for, and its member.
const FISCAL_YEAR_EXTENSION = "urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041";
const FISCAL_YEAR_BASIS = "reporting-period-basis";
const FISCAL_YEAR_ENDED = /^fiscal-year-ended-([0-9]{4}-[0-9]{2}-[0-9]{2})$/;

// The figures that `carbon-unit` gives their unit (draft Optional Members).
const CARBON_FIGURES = ["carbon-footprint", "scope-1", "scope-2", "scope-3"];

const RESTATE_BY_HAND =
  "restate by hand: a score is for one unit over the object's period, and a score in another unit goes in extensions";

/** A value that cannot be converted. */
class Unconvertible extends Error {}

const quote = (value: unknown): string => JSON.stringify(value);

// The edits of one object, applied in the member order of the original.
interface Edits {
  set: Map<string, unknown>;
  drop: Set<string>;
  notes: UpgradeNote[];
}

// The fiscal year that ended on `end`: the day after the same date a year earlier up to the day after `end`.
function fiscalYear(end: string, zone: string): Period {
  const last = dayPeriod(end, zone);
  const [year, month, day] = end.split("-");
  const before = dayPeriod(`${Number(year) - 1}-${month}-${month === "02" && day === "29" ? "28" : day}`, zone);
  return { start: before.end, end: last.end };
}

function fiscalYearEnd(raw: Record_): string | undefined {
  const extension = isRecord(raw.extensions) ? raw.extensions[FISCAL_YEAR_EXTENSION] : undefined;
  const basis = isRecord(extension) ? extension[FISCAL_YEAR_BASIS] : undefined;
  return typeof basis === "string" ? FISCAL_YEAR_ENDED.exec(basis)?.[1] : undefined;
}

// `extensions` without the fiscal-year basis, and without what it leaves empty.
function withoutFiscalYearBasis(extensions: Record_): Record_ | undefined {
  const { [FISCAL_YEAR_BASIS]: _basis, ...rest } = extensions[FISCAL_YEAR_EXTENSION] as Record_;
  const { [FISCAL_YEAR_EXTENSION]: _extension, ...others } = extensions;
  const kept = Object.keys(rest).length > 0 ? { ...others, [FISCAL_YEAR_EXTENSION]: rest } : others;
  return Object.keys(kept).length > 0 ? kept : undefined;
}

function convertPeriod(raw: Record_, zone: string, edits: Edits): void {
  const label = raw["reporting-period"];
  const dates = raw.period;
  try {
    if (dates === undefined && label !== undefined) {
      if (typeof label !== "string") throw new Unconvertible(`reporting-period ${quote(label)} is not a string`);
      const end = fiscalYearEnd(raw);
      if (end !== undefined && label !== end.slice(0, 4)) {
        throw new Unconvertible(`reporting-period ${quote(label)} is not the year of the fiscal year that ended ${end}`);
      }
      const period = end === undefined ? periodFromReportingPeriod(label, zone) : fiscalYear(end, zone);
      edits.set.set("reporting-period", period);
      if (end === undefined) {
        edits.notes.push({ rule: "period", path: "period", message: `reporting-period ${quote(label)} -> period ${period.start} to ${period.end}` });
        return;
      }
      const extensions = withoutFiscalYearBasis(raw.extensions as Record_);
      if (extensions === undefined) edits.drop.add("extensions");
      else edits.set.set("extensions", extensions);
      edits.notes.push({
        rule: "fiscal-year",
        path: "period",
        message: `reporting-period ${quote(label)} with the fiscal year that ended ${end} -> period ${period.start} to ${period.end}; the fiscal-year extension member is removed`,
      });
    } else if (isRecord(dates) && isFullDate(dates.start) && isFullDate(dates.end)) {
      const period = periodFromFullDates({ start: dates.start, end: dates.end }, zone);
      edits.set.set("period", period);
      edits.notes.push({
        rule: "period",
        path: "period",
        message: `period ${dates.start} to ${dates.end} (inclusive dates) -> ${period.start} to ${period.end}`,
      });
    }
  } catch (e) {
    if (!(e instanceof PeriodError)) throw e;
    const shown = dates === undefined ? `reporting-period ${quote(label)}` : `period ${quote(dates)}`;
    throw new Unconvertible(`${shown} cannot be converted: ${e.message}`);
  }
}

function convertMeasurementMethod(raw: Record_, options: UpgradeOptions, edits: Edits): void {
  const method = raw["measurement-method"];
  if (method === undefined || isMeasurementMethod(method)) return;
  if (typeof method !== "string") throw new Unconvertible(`measurement-method ${quote(method)} is not a string, and is not converted`);
  const token = options.measurementMethod ?? RESIDUAL_METHOD;
  edits.set.set("measurement-method", token);
  edits.notes.push({
    rule: "measurement-method",
    path: "measurement-method",
    message:
      `measurement-method ${quote(method)} -> ${token}` +
      (options.measurementMethod === undefined
        ? "; move the description to the methodology document, or pass --measurement-method"
        : " (--measurement-method)"),
  });
}

function convertFunctionalUnit(raw: Record_, edits: Edits): void {
  const unit = raw["functional-unit"];
  const score = raw["sci-score"];
  if (typeof unit !== "string" || isFunctionalUnit(unit)) return;
  const read = legacyFunctionalUnit(unit, typeof score === "number" ? score : undefined);
  if (read === undefined) {
    edits.drop.add("functional-unit");
    if (score !== undefined) edits.drop.add("sci-score");
    edits.notes.push({
      rule: "functional-unit",
      path: "functional-unit",
      message: `functional-unit ${quote(unit)} removed${score === undefined ? "" : " with its sci-score"}; ${RESTATE_BY_HAND}`,
    });
    return;
  }
  edits.set.set("functional-unit", read.unit);
  let message = `functional-unit ${quote(unit)} -> ${quote(read.unit)}`;
  if (read.score !== undefined) {
    edits.set.set("sci-score", read.score);
    message += read.factor === 1 ? "" : `, sci-score ${score} -> ${read.score}`;
  }
  edits.notes.push({ rule: "functional-unit", path: "functional-unit", message });
}

function convertCarbonUnit(raw: Record_, edits: Edits): void {
  const unit = raw["carbon-unit"];
  if (typeof unit !== "string" || isCarbonUnit(unit)) return;
  const read = legacyCarbonUnit(unit);
  if (read !== undefined) {
    edits.set.set("carbon-unit", read);
    edits.notes.push({ rule: "carbon-unit", path: "carbon-unit", message: `carbon-unit ${quote(unit)} -> ${quote(read)}; the figures are unchanged` });
    return;
  }
  const figures = CARBON_FIGURES.filter((name) => raw[name] !== undefined);
  for (const name of ["carbon-unit", ...figures]) edits.drop.add(name);
  edits.notes.push({
    rule: "carbon-unit",
    path: "carbon-unit",
    message: `carbon-unit ${quote(unit)} removed with ${figures.length ? figures.join(", ") : "no figure"}; restate the figures in gCO2e, kgCO2e or tCO2e by hand`,
  });
}

function convertRoles(raw: Record_, edits: Edits): void {
  if (!Array.isArray(raw.upstream)) return;
  let changed = false;
  const upstream = raw.upstream.map((entry, i) => {
    if (!isRecord(entry) || typeof entry.role !== "string" || isUpstreamRole(entry.role)) return entry;
    changed = true;
    edits.notes.push({
      rule: "role",
      path: `upstream[${i}].role`,
      message: `upstream[${i}].role ${quote(entry.role)} removed; the entry and its declaration are kept`,
    });
    const { role: _role, ...rest } = entry;
    return rest;
  });
  if (changed) edits.set.set("upstream", upstream);
}

function convertTargetType(raw: Record_, edits: Edits): void {
  const type = raw["target-type"];
  if (typeof type !== "string" || isTargetType(type)) return;
  edits.drop.add("target-type");
  edits.notes.push({ rule: "target-type", path: "target-type", message: `target-type ${quote(type)} is not one of the nine and is removed` });
}

// The object with the edits applied; `period` stands where `reporting-period` stood.
function applyEdits(raw: Record_, edits: Edits): Record_ {
  const out: Record_ = {};
  for (const [name, value] of Object.entries(raw)) {
    if (edits.drop.has(name)) continue;
    const edited = edits.set.has(name) ? edits.set.get(name) : value;
    out[name === "reporting-period" && edits.set.has(name) ? "period" : name] = edited;
  }
  return out;
}

function upgradeObject(raw: Record_, options: UpgradeOptions): { object: Record_; notes: UpgradeNote[] } {
  const edits: Edits = { set: new Map(), drop: new Set(), notes: [] };
  convertPeriod(raw, options.offset ?? "Z", edits);
  convertMeasurementMethod(raw, options, edits);
  convertFunctionalUnit(raw, edits);
  convertCarbonUnit(raw, edits);
  convertRoles(raw, edits);
  convertTargetType(raw, edits);
  if (edits.notes.length === 0) return { object: raw, notes: [] };

  // What goes with a converted object: its provider in one spelling, the signature
  // of the object it no longer is dropped, and the time it was converted.
  if (typeof raw.provider === "string" && raw.provider !== raw.provider.normalize("NFC")) {
    edits.set.set("provider", raw.provider.normalize("NFC"));
    edits.notes.push({ rule: "provider", path: "provider", message: "provider normalized to Normalization Form C" });
  }
  if (raw.signed !== undefined) {
    edits.drop.add("signed");
    edits.notes.push({ rule: "signed", path: "signed", message: "signed is not carried over; sign the result again with sustainability-sign" });
  }
  if (options.updated !== undefined) {
    edits.set.set("updated", options.updated);
    edits.notes.push({ rule: "updated", path: "updated", message: `updated ${quote(raw.updated)} -> ${quote(options.updated)} (--updated)` });
  }
  return { object: applyEdits(raw, edits), notes: edits.notes };
}

// The objects of an array, or the one object, converted; a problem is added to `errors` and the object left as it was.
function upgradeDeclarations(value: unknown, what: string, options: UpgradeOptions, result: UpgradeResult): unknown {
  const convert = (item: unknown, index?: number): unknown => {
    const where = index === undefined ? "" : `[${index}]`;
    if (!isRecord(item)) {
      result.errors.push(`${where || what} is not a declaration object`);
      return item;
    }
    try {
      const { object, notes } = upgradeObject(item, options);
      result.notes.push(...notes.map((note) => (where ? { ...note, path: `${where}.${note.path}`, message: `${where} ${note.message}` } : note)));
      return object;
    } catch (e) {
      if (!(e instanceof Unconvertible)) throw e;
      result.errors.push(`${where ? `${where} ` : ""}${e.message}`);
      return item;
    }
  };
  if (Array.isArray(value)) return value.map((item, i) => convert(item, i));
  if (isRecord(value)) return convert(value);
  result.errors.push(`${what} is not a declaration object or an array of declaration objects`);
  return value;
}

/**
 * Convert a parsed document: a declaration object, an array of them, or the
 * `{ "document": ... }` wrapper of a gateway data file, which is kept around the
 * converted declaration. When nothing is converted the same value comes back,
 * and a document that is valid as it stands is never changed. The result is
 * checked as the publisher checks what it serves; what it still lacks is in
 * `errors`.
 */
export function upgradeDocument(input: unknown, options: UpgradeOptions = {}): UpgradeResult {
  const problem = upgradeOptionsError(options);
  if (problem !== undefined) throw new RangeError(`upgrade: ${problem}`);
  const result: UpgradeResult = { document: input, notes: [], errors: [], warnings: [] };
  const wrapped = isRecord(input) && "document" in input && !("target" in input);
  const converted = upgradeDeclarations(wrapped ? input.document : input, wrapped ? 'the "document" member' : "the document", options, result);
  if (result.notes.length > 0) result.document = wrapped ? { ...(input as Record_), document: converted } : converted;
  if (result.errors.length === 0) {
    const checked = validateDocument(converted as Parameters<typeof validateDocument>[0], { legacyCompat: false });
    result.errors.push(...checked.errors);
    result.warnings.push(...checked.warnings.map((warning) => warning.message));
  }
  return result;
}

/** The text of a converted document: two-space indentation and a final newline. */
export const upgradedText = (document: unknown): string => JSON.stringify(document, null, 2) + "\n";

/**
 * Convert the JSON text of a file. Returns the text to write, which is `text`
 * itself when nothing is converted, so that a document that is already current
 * comes out byte for byte as it went in. Text that is not I-JSON gives
 * `text: undefined` and the reason in `errors`.
 */
export function upgradeText(text: string, options: UpgradeOptions = {}): UpgradeResult & { text?: string } {
  let input: unknown;
  try {
    input = parseStrict(text);
  } catch (e) {
    return { document: undefined, notes: [], errors: [`the file is not valid I-JSON (${(e as Error).message})`], warnings: [] };
  }
  const result = upgradeDocument(input, options);
  return { ...result, text: result.notes.length === 0 ? text : upgradedText(result.document) };
}
