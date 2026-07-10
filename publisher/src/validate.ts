/**
 * Validation gate. Every payload the publisher emits is validated against the
 * draft's JTD schema (RFC 8927) BEFORE it is served. This makes the software
 * provably conformant and acts as a circuit-breaker against malformed adapter
 * output (the "never publish corrupt data" rule).
 */
import Ajv, { ValidateFunction } from "ajv/dist/jtd";
import { PERIOD_RE } from "./normalize";
import { RESPONSE_JTD_SCHEMA } from "./schema";
import { SustainabilityDocument, SustainabilityMetrics } from "./types";

const ajv = new Ajv({ allErrors: true });
const validateObject: ValidateFunction = ajv.compile(RESPONSE_JTD_SCHEMA as unknown as object);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Every numeric field defined by the draft. JTD's `float64` only checks
 * `typeof === "number"`, so NaN and ±Infinity pass it and then serialize as
 * JSON `null` (or invalid JSON). This list lets the gate reject non-finite
 * values before a payload is ever published.
 */
const NUMERIC_FIELDS = [
  "energy-consumption",
  "carbon-footprint",
  "scope-1",
  "scope-2",
  "scope-3",
  "sci-score",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
  "renewable-energy",
] as const;

/**
 * Gross-quantity members that MUST NOT be negative (draft §Value Constraints
 * and Omitted Metrics). Scopes are deliberately absent: scope-1/2/3 MAY be
 * negative to convey removals/offsets under net accounting.
 */
const NON_NEGATIVE_FIELDS = [
  "energy-consumption",
  "carbon-footprint",
  "sci-score",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
] as const;

/** Validate a single metrics object against the JTD schema. */
export function validateMetrics(obj: unknown): ValidationResult {
  const valid = validateObject(obj) as boolean;
  if (!valid) {
    const errors = (validateObject.errors ?? []).map(
      (e) => `${e.instancePath || "/"} ${e.keyword}${e.schemaPath ? ` (${e.schemaPath})` : ""}`,
    );
    return { valid: false, errors };
  }

  // Post-JTD guard: reject non-finite numbers (NaN, Infinity, -Infinity). These
  // pass JTD's float64 (typeof === "number") but serialize to JSON `null`,
  // which would let malformed adapter output be published as valid data.
  const errors: string[] = [];
  if (obj && typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    for (const field of NUMERIC_FIELDS) {
      const v = rec[field];
      if (typeof v === "number" && !Number.isFinite(v)) {
        errors.push(`/${field} is not a finite number (${String(v)})`);
      }
    }

    // Range rules (draft §Value Constraints and Omitted Metrics) are prose
    // rules JTD cannot express; enforce them here so no invalid document can
    // ship regardless of which adapter/normalization path produced it.
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

    // Draft §Optional Response Fields: "If sci-score is present,
    // functional-unit MUST also be present." JTD cannot express dependencies.
    if (rec["sci-score"] !== undefined && rec["functional-unit"] === undefined) {
      errors.push("/sci-score requires functional-unit to be present");
    }

    // Draft §Mandatory Response Fields: reporting-period uses the calendar
    // forms YYYY, YYYY-MM, or YYYY-MM-DD. All Publisher paths normalize first
    // (which checks this), but validateDocument/assertValid are exported API —
    // guard hand-built documents here too (defense in depth).
    const period = rec["reporting-period"];
    if (typeof period === "string" && !PERIOD_RE.test(period)) {
      errors.push(`/reporting-period is not a valid YYYY[-MM[-DD]] value ("${period}")`);
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Validate a full document (single object or array). */
export function validateDocument(doc: SustainabilityDocument): ValidationResult {
  const items = Array.isArray(doc) ? doc : [doc];
  const errors: string[] = [];
  items.forEach((item, i) => {
    const r = validateMetrics(item);
    if (!r.valid) {
      const prefix = Array.isArray(doc) ? `[${i}]` : "";
      errors.push(...r.errors.map((e) => `${prefix}${e}`));
    }
  });

  // Cross-entry array rules (draft §Payload Format): entries MUST be sorted
  // ascending by reporting-period, MUST NOT overlap, and MUST share the same
  // period precision and the same target value. The per-object JTD schema
  // cannot express these, so they are checked here.
  if (Array.isArray(doc) && doc.length > 1) {
    const periods = doc.map((m) => String(m["reporting-period"] ?? ""));
    if (new Set(periods.map((p) => p.length)).size > 1) {
      errors.push("array entries mix reporting-period precisions");
    }
    for (let i = 1; i < periods.length; i++) {
      if (periods[i] <= periods[i - 1]) {
        errors.push(
          `array entries not strictly ascending by reporting-period at [${i}] ("${periods[i]}" after "${periods[i - 1]}")`,
        );
        break;
      }
    }
    if (new Set(doc.map((m) => m.target ?? "")).size > 1) {
      errors.push("array entries carry differing target values");
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Thrown by the publisher when a payload fails the validation gate. */
export class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Sustainability payload failed JTD validation:\n - ${errors.join("\n - ")}`);
    this.name = "ValidationError";
  }
}

/** Assert a document is valid; throw {@link ValidationError} otherwise. */
export function assertValid(doc: SustainabilityDocument): SustainabilityDocument {
  const r = validateDocument(doc);
  if (!r.valid) throw new ValidationError(r.errors);
  return doc;
}

export type { SustainabilityMetrics };
