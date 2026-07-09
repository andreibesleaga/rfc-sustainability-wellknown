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
  if (valid) return { valid: true, errors: [] };
  const errors = (validateObject.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.keyword}${e.schemaPath ? ` (${e.schemaPath})` : ""}`,
  );
  return { valid: false, errors };
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

  // Draft §Payload Format: array entries MUST be sorted ascending by
  // reporting-period, MUST NOT overlap, and MUST share the same period
  // precision and (where present) the same target-path.
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
    if (new Set(entries.map((m) => m["target-path"] ?? "")).size > 1) {
      errors.push("array entries carry differing target-path values");
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
