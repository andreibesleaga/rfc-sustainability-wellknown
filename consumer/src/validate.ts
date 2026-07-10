/**
 * Defensive validation of an incoming document. The data just arrived from an
 * arbitrary third-party origin, so it is schema-validated (JTD, RFC 8927) AND
 * checked against the draft's cross-entry array rules (a non-conformant
 * upstream server is the normal case for early ecosystem adoption, not a
 * hypothetical) before being handed to caller code.
 */
import Ajv, { ValidateFunction } from "ajv/dist/jtd";
import { RESPONSE_JTD_SCHEMA } from "./schema";
import { SustainabilityDocument, SustainabilityMetrics } from "./types";

const ajv = new Ajv({ allErrors: true });
const validateObject: ValidateFunction = ajv.compile(RESPONSE_JTD_SCHEMA as unknown as object);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function validateMetrics(obj: unknown): ValidationResult {
  const valid = validateObject(obj) as boolean;
  const errors = valid
    ? []
    : (validateObject.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.keyword}${e.schemaPath ? ` (${e.schemaPath})` : ""}`,
      );

  // Draft §Optional Response Fields: "If sci-score is present, functional-unit
  // MUST also be present." This cross-field dependency cannot be expressed in
  // JTD (or CDDL), so the schema gate above can't catch it — check it here so a
  // conformance-checking client actually enforces the full prose MUST.
  if (
    obj &&
    typeof obj === "object" &&
    "sci-score" in obj &&
    (obj as Record<string, unknown>)["functional-unit"] === undefined
  ) {
    errors.push("sci-score is present but functional-unit is missing (draft MUST)");
  }

  return { valid: errors.length === 0, errors };
}

/** Validate a full document (single object or array), incl. cross-entry array rules. */
export function validateDocument(doc: unknown): ValidationResult {
  const items = Array.isArray(doc) ? doc : [doc];
  const errors: string[] = [];
  items.forEach((item, i) => {
    const r = validateMetrics(item);
    if (!r.valid) {
      const prefix = Array.isArray(doc) ? `[${i}]` : "";
      errors.push(...r.errors.map((e) => `${prefix}${e}`));
    }
  });

  // Note on out-of-range values: the draft says a client encountering a value
  // outside a member's stated range (e.g. a negative energy-consumption)
  // SHOULD treat that member as not reported rather than reject the document —
  // so no negative-value rejection happens here; that treatment lives in
  // sentinel.ts (the legacy-compatibility module).

  // Draft §Payload Format: array entries MUST be sorted ascending by
  // reporting-period, MUST NOT overlap, and MUST share the same period
  // precision and the same target value.
  if (Array.isArray(doc) && doc.length > 1 && errors.length === 0) {
    const entries = doc as SustainabilityMetrics[];
    const periods = entries.map((m) => String(m["reporting-period"] ?? ""));
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
    // target is mandatory (schema-gated above), so compare the actual values.
    if (new Set(entries.map((m) => m.target)).size > 1) {
      errors.push("array entries carry differing target values");
    }
  }

  return { valid: errors.length === 0, errors };
}

export class ValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Sustainability document failed validation:\n - ${errors.join("\n - ")}`);
    this.name = "ValidationError";
  }
}

export function assertValid(doc: unknown): SustainabilityDocument {
  const r = validateDocument(doc);
  if (!r.valid) throw new ValidationError(r.errors);
  return doc as SustainabilityDocument;
}
