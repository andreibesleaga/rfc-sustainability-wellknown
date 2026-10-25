/**
 * Validation gate. Every payload the publisher emits is validated BEFORE it is
 * served. This makes the software provably conformant and acts as a
 * circuit-breaker against malformed adapter output (the "never publish corrupt
 * data" rule).
 *
 * Validation is layered. The JSON Type Definition schema (RFC 8927) checks the
 * form: mandatory members, closed token sets, types. The rules no schema states
 * come after it: the exact profile of a date-time (upper-case `T` and `Z`, a
 * real date and time), `start` before `end`, non-negative figures, the range of
 * `renewable-energy`, the at-least-one rule, the names in `extensions`. What the
 * draft only recommends is a warning, with a code, and never makes a document
 * invalid.
 */
import Ajv, { ErrorObject, ValidateFunction } from "ajv/dist/jtd";
import { compareDateTimes, dateTimeError, hasLeapSecond, isOnDayBoundaries, Period, PeriodError } from "./period";
import { RESPONSE_JTD_SCHEMA } from "./schema";
import {
  DEFINED_MEMBERS,
  extensionNameError,
  isUriReference,
  SustainabilityDocument,
  SustainabilityMetrics,
} from "./types";
import { aLabelOf, hasReportableContent, olderPeriodOf } from "./util";

const ajv = new Ajv({ allErrors: true });
const validateObject: ValidateFunction = ajv.compile(RESPONSE_JTD_SCHEMA as unknown as object);

/** What a warning is about; a warning never makes a document invalid. */
export type WarningCode =
  /** A bound is not the first instant of a calendar day in its own offset (the draft recommends a day or longer). */
  | "period-below-day-floor"
  /** `updated` is before `period.end`: a forecast, or a period still running. */
  | "updated-before-period-end"
  /** A bound or `updated` names the leap second 23:59:60, which is read as 23:59:59. */
  | "leap-second-read-as-59"
  /** A member the draft does not define: a consumer ignores it, a publisher adds none. */
  | "unknown-member"
  /** A URI-valued member is not a URI reference. */
  | "uri-not-a-reference"
  /** The scopes accompany `carbon-footprint` and do not account for it. */
  | "scopes-do-not-account-for-footprint"
  /** A host-shaped `target` is written in U-label form; the draft writes the A-label. */
  | "origin-u-label"
  /** `provider` holds a contact address that does not look like a role. */
  | "provider-personal-contact"
  /** The period was read from the form of an earlier revision (compatibility reading only). */
  | "period-read-from-older-form";

export interface ValidationWarning {
  code: WarningCode;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: ValidationWarning[];
}

export interface ValidateOptions {
  /**
   * Read the period of an earlier revision (the `reporting-period` label of -08,
   * the `full-date` bounds of -09) as the period it stands for, and say so in a
   * warning. Default true. `assertValid`, the gate in front of every document
   * this package serves, always validates without it.
   */
  legacyCompat?: boolean;
}

/**
 * Gross-quantity members that MUST NOT be negative (draft §Optional Members).
 * Scopes are deliberately absent: scope-1/2/3 MAY be negative to convey
 * removals/offsets under net accounting. `renewable-energy` has its own range.
 */
const NON_NEGATIVE_FIELDS = [
  "energy-consumption",
  "carbon-footprint",
  "sci-score",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
] as const;

/** URI-valued members other than `upstream[].declaration`; all are URI references (draft §URI-Valued Members). */
const URI_MEMBERS = ["methodology-uri", "verifiable-attestation-uri", "disclosure-uri"] as const;

/** Local parts of an address in `provider` that name a role, not a person (draft §Privacy Considerations). */
const ROLE_ADDRESSES = ["sustainability", "sustain", "esg", "ops", "compliance", "contact", "info", "admin", "support", "security"];

/**
 * One schema error as a sentence. A member outside a closed set names the
 * members of the set, so the reader knows what to write.
 */
function schemaErrorMessage(e: ErrorObject): string {
  const where = e.instancePath || "/";
  if (e.keyword === "enum" && Array.isArray(e.params.allowedValues)) {
    return `${where} must be one of ${e.params.allowedValues.join(", ")}`;
  }
  if (e.keyword === "properties" && typeof e.params.missingProperty === "string") {
    return `${where === "/" ? "" : where}/${e.params.missingProperty} is a mandatory member and is missing${e.schemaPath ? ` (${e.schemaPath})` : ""}`;
  }
  return `${where} ${e.keyword}${e.schemaPath ? ` (${e.schemaPath})` : ""}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Digits after the decimal point in the shortest form of `n`. */
function decimals(n: number): number {
  const [mantissa, exponent] = n.toExponential().split("e");
  return Math.max(0, (mantissa.split(".")[1] ?? "").length - Number(exponent));
}

/**
 * Every number in the value is finite, and every string and member name is
 * well-formed (no unpaired surrogate): the I-JSON a publisher emits (draft
 * §Body). JTD's `float64` accepts NaN and the infinities, which serialize as
 * `null`.
 */
function ijsonErrors(value: unknown, path: string, errors: string[]): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    errors.push(`${path} is not a finite number (${String(value)})`);
  } else if (typeof value === "string" && !value.isWellFormed()) {
    errors.push(`${path} holds an unpaired surrogate (RFC 7493, Section 2.1)`);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => ijsonErrors(item, `${path}/${i}`, errors));
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (!key.isWellFormed()) errors.push(`${path}/${key} is a member name with an unpaired surrogate (RFC 7493, Section 2.1)`);
      ijsonErrors(item, `${path}/${key}`, errors);
    }
  }
}

function dateTimeChecks(rec: Record<string, unknown>, errors: string[], warnings: ValidationWarning[]): void {
  const period = isRecord(rec.period) ? rec.period : {};
  const bounds: [string, unknown][] = [["updated", rec.updated], ["period/start", period.start], ["period/end", period.end]];
  for (const [path, value] of bounds) {
    const why = dateTimeError(value);
    if (why !== undefined) errors.push(`/${path} ${why}`);
    else if (hasLeapSecond(value as string)) {
      warnings.push({ code: "leap-second-read-as-59", message: `/${path} names the leap second 23:59:60, which is read as 23:59:59` });
    }
  }
  const { start, end } = period;
  if (dateTimeError(start) !== undefined || dateTimeError(end) !== undefined) return;
  if (compareDateTimes(start as string, end as string) >= 0) {
    errors.push(`/period/start must be before /period/end (got ${start} and ${end})`);
    return;
  }
  const bounded: Period = { start: start as string, end: end as string };
  if (!isOnDayBoundaries(bounded)) {
    // A bound at the leap second is already noted above: it is read as another instant, and no day boundary.
    if (!hasLeapSecond(bounded.start) && !hasLeapSecond(bounded.end)) {
      warnings.push({
        code: "period-below-day-floor",
        message:
          "/period bounds are not both the first instant of a calendar day in their own offset; " +
          "the draft recommends a calendar day or longer (Mandatory Members, Privacy Considerations)",
      });
    }
  } else if (dateTimeError(rec.updated) === undefined && compareDateTimes(rec.updated as string, bounded.end) < 0) {
    warnings.push({ code: "updated-before-period-end", message: `/updated (${rec.updated}) is before /period/end (${end})` });
  }
}

function figureChecks(rec: Record<string, unknown>, errors: string[], warnings: ValidationWarning[]): void {
  // Range rules (draft §Optional Members) are prose rules no schema expresses.
  for (const field of NON_NEGATIVE_FIELDS) {
    const v = rec[field];
    if (typeof v === "number" && v < 0) {
      errors.push(`/${field} must not be negative (got ${v}); omit unreported metrics`);
    }
  }
  const renewable = rec["renewable-energy"];
  if (typeof renewable === "number" && (renewable < 0 || renewable > 100)) {
    errors.push(`/renewable-energy must be between 0 and 100 inclusive (got ${renewable})`);
  }
  // "sci-score ... functional-unit, which MUST then be present." JTD cannot express dependencies.
  if (rec["sci-score"] !== undefined && rec["functional-unit"] === undefined) {
    errors.push("/sci-score requires functional-unit to be present");
  }
  // "A declaration object MUST carry at least one numeric metric member or at
  // least one of disclosure-uri and verifiable-attestation-uri."
  if (!hasReportableContent(rec)) {
    errors.push(
      "/ carries no numeric metric member and neither disclosure-uri nor verifiable-attestation-uri (draft, Optional Members)",
    );
  }
  // Scopes that accompany carbon-footprint SHOULD account for it, to the
  // precision of the least precise of the four figures.
  const figures = ["scope-1", "scope-2", "scope-3", "carbon-footprint"].map((m) => rec[m]);
  if (figures.every((v) => typeof v === "number" && Number.isFinite(v))) {
    const [s1, s2, s3, footprint] = figures as number[];
    const tolerance = 0.5 * 10 ** -Math.min(...figures.map((v) => decimals(v as number)));
    if (Math.abs(s1 + s2 + s3 - footprint) > tolerance + Math.abs(footprint) * 1e-12) {
      warnings.push({
        code: "scopes-do-not-account-for-footprint",
        message:
          `/scope-1, /scope-2 and /scope-3 sum to ${s1 + s2 + s3} and carbon-footprint is ${footprint}; ` +
          "scopes that cover only part of the footprint are explained in the methodology document (draft, Optional Members)",
      });
    }
  }
}

function textChecks(rec: Record<string, unknown>, errors: string[], warnings: ValidationWarning[]): void {
  if (rec["provider"] === "") errors.push("/provider must not be empty");
  if (rec["target"] === "") errors.push("/target must not be empty (it names what the object is about)");
  if (typeof rec["provider"] === "string") {
    // One linear split into address-shaped words; the local part is what precedes the first "@".
    for (const word of rec["provider"].split(/[\s()<>,;]+/)) {
      const [local, domain] = word.split("@");
      if (!local || !domain) continue;
      if (!ROLE_ADDRESSES.includes(local.toLowerCase())) {
        warnings.push({
          code: "provider-personal-contact",
          message: `/provider holds the address "${local}@…"; a role address is better than a personal one (draft, Privacy Considerations)`,
        });
      }
    }
  }
  const target = rec["target"];
  if (typeof target === "string") {
    if (rec["target-type"] === "path" && !target.startsWith("/")) {
      errors.push(`/target "${target}" has target-type path, so it begins with "/"`);
    }
    const alabel = aLabelOf(target);
    if (alabel !== undefined) {
      warnings.push({
        code: "origin-u-label",
        message: `/target "${target}" is a host in U-label form; the draft writes an internationalized host in A-label form${alabel ? `: "${alabel}"` : ""}`,
      });
    }
  }
}

function linkChecks(rec: Record<string, unknown>, errors: string[], warnings: ValidationWarning[]): void {
  const notReference = (path: string, value: unknown) =>
    warnings.push({ code: "uri-not-a-reference", message: `${path} is not a URI reference (got ${JSON.stringify(value)})` });
  for (const member of URI_MEMBERS) {
    const value = rec[member];
    if (typeof value === "string" && !isUriReference(value)) notReference(`/${member}`, value);
  }
  const upstream = rec["upstream"];
  if (Array.isArray(upstream)) {
    if (upstream.length === 0) errors.push("/upstream must carry at least one entry");
    upstream.forEach((entry, i) => {
      const uri = isRecord(entry) ? entry["declaration"] : undefined;
      if (typeof uri === "string" && !isUriReference(uri)) notReference(`/upstream/${i}/declaration`, uri);
    });
  }
  // Draft §Extensions: the member names of `extensions` are URIs, and its values are objects. JTD cannot constrain the names.
  const extensions = rec["extensions"];
  if (isRecord(extensions)) {
    for (const [key, value] of Object.entries(extensions)) {
      const why = extensionNameError(key);
      if (why !== undefined) errors.push(`/extensions/${key} ${why}`);
      if (!isRecord(value)) errors.push(`/extensions/${key} must be a JSON object`);
    }
  }
}

/** The members of the object, `period` and the `upstream` entries that the draft does not define: ignored by a consumer, and worth a note. */
function unknownMembers(rec: Record<string, unknown>): { path: string; name: string }[] {
  const found = Object.keys(rec).filter((name) => !DEFINED_MEMBERS.includes(name)).map((name) => ({ path: "", name }));
  if (isRecord(rec.period)) {
    for (const name of Object.keys(rec.period)) if (name !== "start" && name !== "end") found.push({ path: "/period", name });
  }
  if (Array.isArray(rec.upstream)) {
    rec.upstream.forEach((entry, i) => {
      if (!isRecord(entry)) return;
      for (const name of Object.keys(entry)) if (name !== "declaration" && name !== "role") found.push({ path: `/upstream/${i}`, name });
    });
  }
  return found;
}

// What a document of an earlier revision gets as a hint: the way forward.
const OLDER_FORM =
  "the form of an earlier revision: convert the document with sustainability-publisher upgrade (the period is two RFC 3339 date-times)";

/**
 * Validate a single metrics object: the JTD schema first, then the rules it
 * cannot state. Unknown members are a warning, since a consumer ignores them;
 * a publisher refuses to emit one ({@link assertValid}).
 */
export function validateMetrics(obj: unknown, options: ValidateOptions = {}): ValidationResult {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];
  let subject = obj;

  if (options.legacyCompat !== false && isRecord(obj)) {
    try {
      const period = olderPeriodOf(obj);
      if (period !== undefined) {
        const { "reporting-period": older, ...rest } = obj;
        subject = { ...rest, period };
        warnings.push({
          code: "period-read-from-older-form",
          message: `the period was read from ${JSON.stringify(older ?? obj.period)} as ${period.start} to ${period.end}`,
        });
      }
    } catch (e) {
      if (!(e instanceof PeriodError)) throw e;
      return { valid: false, errors: [e.message], warnings };
    }
  }

  if (!validateObject(subject)) {
    for (const e of validateObject.errors ?? []) {
      errors.push(schemaErrorMessage(e));
    }
    if (isRecord(obj) && ("reporting-period" in obj || isRecord(obj.period) && /^\d{4}-\d{2}-\d{2}$/.test(String(obj.period.start)))) {
      errors.push(`/period is ${OLDER_FORM}`);
    }
    return { valid: false, errors, warnings };
  }

  const rec = subject as Record<string, unknown>;
  ijsonErrors(rec, "", errors);
  dateTimeChecks(rec, errors, warnings);
  figureChecks(rec, errors, warnings);
  textChecks(rec, errors, warnings);
  linkChecks(rec, errors, warnings);
  for (const { path, name } of unknownMembers(rec)) {
    warnings.push({
      code: "unknown-member",
      message: `${path}/${name} is not a member the draft defines; a consumer ignores it, and a publisher puts its own data in extensions`,
    });
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Validate a full document (single object or array). */
export function validateDocument(doc: SustainabilityDocument, options: ValidateOptions = {}): ValidationResult {
  const items = Array.isArray(doc) ? doc : [doc];
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  items.forEach((item, i) => {
    const r = validateMetrics(item, options);
    const prefix = Array.isArray(doc) ? `[${i}]` : "";
    result.errors.push(...r.errors.map((e) => `${prefix}${e}`));
    result.warnings.push(...r.warnings.map((w) => ({ ...w, message: `${prefix}${w.message}` })));
  });
  result.valid = result.errors.length === 0;
  return result;
}

/** Thrown by the publisher when a payload fails the validation gate. */
export class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Sustainability payload failed validation:\n - ${errors.join("\n - ")}`);
    this.name = "ValidationError";
  }
}

/**
 * The gate in front of everything this package serves or signs. A document must
 * be valid as it stands (no older form is read), and must carry no top-level
 * member the draft does not define: "A publisher MUST NOT add a top-level member
 * this document does not define; other data goes in extensions" (draft §Body).
 * Throws {@link ValidationError} otherwise.
 */
export function assertValid(doc: SustainabilityDocument): SustainabilityDocument {
  const r = validateDocument(doc, { legacyCompat: false });
  const errors = [...r.errors];
  // The consumer-side reading stays lenient about a URI member that is not a URI reference; a publisher does not sign or serve one.
  for (const w of r.warnings) if (w.code === "uri-not-a-reference") errors.push(w.message);
  (Array.isArray(doc) ? doc : [doc]).forEach((item, i) => {
    if (!isRecord(item)) return;
    const prefix = Array.isArray(doc) ? `[${i}]` : "";
    for (const name of Object.keys(item).filter((n) => !DEFINED_MEMBERS.includes(n))) {
      errors.push(`${prefix}/${name} is not a member the draft defines; a publisher adds none, and puts its own data in extensions`);
    }
  });
  if (errors.length > 0) throw new ValidationError(errors);
  return doc;
}

export type { SustainabilityMetrics };
