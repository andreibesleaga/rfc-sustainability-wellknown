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
  /**
   * True when the document carries NO errors. `warnings` never influence it:
   * a warning is an advisory finding about a document that is valid and
   * usable, and callers (the gateway among them) treat `valid === false` as
   * a hard failure.
   */
  valid: boolean;
  errors: string[];
  /**
   * Advisory findings that do NOT make the document invalid. See
   * {@link URI_MEMBERS}: an absolute non-`https` URI member is reported here,
   * never as an error, and the member is kept.
   */
  warnings: string[];
}

/**
 * The three URI-valued members. Draft -06 §Payload Format: they "MUST be
 * absolute URIs {{RFC3986}} using the 'https' scheme, for the same reason the
 * document itself is served over HTTPS", and "clients MUST NOT automatically
 * dereference a URI member carrying any other scheme".
 */
export const URI_MEMBERS = ["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"] as const;

/**
 * Advisory findings for URI members carrying an absolute non-`https` URI.
 *
 * Deliberately a WARNING, not an error: the member is kept and the document
 * stays valid (a -05-era publisher may legitimately carry an `http` link, and
 * failing the whole document over a supporting link would lose the metrics
 * with it). What the rule actually buys is protection at dereference time,
 * which disclosure.ts enforces by refusing to fetch such a URI at all.
 *
 * A value that is not an absolute URI at all (a relative reference, or
 * anything `new URL()` rejects) is left alone here: the draft's absolute-URI
 * requirement is not this function's subject, and guessing a base would be
 * worse than saying nothing.
 */
function uriMemberWarnings(obj: unknown): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const rec = obj as Record<string, unknown>;
  const warnings: string[] = [];
  for (const key of URI_MEMBERS) {
    const value = rec[key];
    if (typeof value !== "string" || value === "") continue;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      continue; // not an absolute URI: out of scope for this check
    }
    if (parsed.protocol !== "https:") {
      warnings.push(
        `${key} is an absolute non-https URI ("${value}"): the draft restricts URI members to the "https" scheme ` +
          `and clients MUST NOT automatically dereference another scheme (member kept; not a validation error)`,
      );
    }
  }
  return warnings;
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
  // Exception (draft §Versioning compatibility rule): a NEGATIVE sci-score is
  // the historical "not reported" sentinel and reads as absent, so it carries
  // no functional-unit dependency — a legacy document with sci-score: -1 and
  // no functional-unit is conformantly processable, not invalid.
  if (obj && typeof obj === "object" && "sci-score" in obj) {
    const rec = obj as Record<string, unknown>;
    const sci = rec["sci-score"];
    const reported = !(typeof sci === "number" && sci < 0);
    if (reported && rec["functional-unit"] === undefined) {
      errors.push("sci-score is present but functional-unit is missing (draft MUST)");
    }
  }

  return { valid: errors.length === 0, errors, warnings: uriMemberWarnings(obj) };
}

/**
 * Validate a full document (single object or array), incl. cross-entry array
 * rules. `valid` reflects errors ONLY; `warnings` are advisory and never
 * change it.
 */
export function validateDocument(doc: unknown): ValidationResult {
  // An empty array conveys no report at all — the publisher side answers the
  // equivalent situation with 404 rather than serving []; treat it as invalid
  // instead of handing callers a vacuous "valid" document.
  if (Array.isArray(doc) && doc.length === 0) {
    return { valid: false, errors: ["empty array conveys no report"], warnings: [] };
  }
  const items = Array.isArray(doc) ? doc : [doc];
  const errors: string[] = [];
  const warnings: string[] = [];
  items.forEach((item, i) => {
    const r = validateMetrics(item);
    const prefix = Array.isArray(doc) ? `[${i}]` : "";
    if (!r.valid) {
      errors.push(...r.errors.map((e) => `${prefix}${e}`));
    }
    // Advisory findings are collected whether or not the entry validated:
    // they describe the document, they do not judge it.
    warnings.push(...r.warnings.map((w) => `${prefix}${w}`));
  });

  // Note on out-of-range values: the draft says a client encountering a value
  // outside a member's stated range (e.g. a negative energy-consumption)
  // SHOULD treat that member as not reported rather than reject the document —
  // so no negative-value rejection happens here; that treatment lives in
  // sentinel.ts (the legacy-compatibility module).

  // Draft §Payload Format: array entries MUST be sorted ascending by
  // reporting-period, MUST NOT overlap, and MUST share the same period
  // precision and the same target value; target-type MUST be either present
  // in every entry with the same value or absent from every entry.
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
    // target-type is ALL-OR-NONE across an array (-04 final): "`target-type`
    // MUST be either present in every entry with the same value or absent
    // from every entry" — mixed presence is invalid, not just mixed values.
    const withType = entries.filter((m) => m["target-type"] !== undefined);
    if (withType.length > 0 && withType.length < entries.length) {
      errors.push(
        "target-type must be present in every array entry or absent from every entry (mixed presence)",
      );
    } else if (new Set(withType.map((m) => m["target-type"])).size > 1) {
      errors.push("array entries carry differing target-type values");
    }
  }

  return { valid: errors.length === 0, errors, warnings };
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
