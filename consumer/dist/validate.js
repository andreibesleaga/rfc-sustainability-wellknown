"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationError = void 0;
exports.validateDocument = validateDocument;
exports.assertValid = assertValid;
/**
 * Defensive validation of an incoming document. The data just arrived from an
 * arbitrary third-party origin, so it is schema-validated (JTD, RFC 8927) AND
 * checked against the draft's cross-entry array rules (a non-conformant
 * upstream server is the normal case for early ecosystem adoption, not a
 * hypothetical) before being handed to caller code.
 */
const jtd_1 = __importDefault(require("ajv/dist/jtd"));
const schema_1 = require("./schema");
const ajv = new jtd_1.default({ allErrors: true });
const validateObject = ajv.compile(schema_1.RESPONSE_JTD_SCHEMA);
function validateMetrics(obj) {
    const valid = validateObject(obj);
    const errors = valid
        ? []
        : (validateObject.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.keyword}${e.schemaPath ? ` (${e.schemaPath})` : ""}`);
    // Draft §Optional Response Fields: "If sci-score is present, functional-unit
    // MUST also be present." This cross-field dependency cannot be expressed in
    // JTD (or CDDL), so the schema gate above can't catch it — check it here so a
    // conformance-checking client actually enforces the full prose MUST.
    // Exception (draft §Versioning compatibility rule): a NEGATIVE sci-score is
    // the historical "not reported" sentinel and reads as absent, so it carries
    // no functional-unit dependency — a legacy document with sci-score: -1 and
    // no functional-unit is conformantly processable, not invalid.
    if (obj && typeof obj === "object" && "sci-score" in obj) {
        const rec = obj;
        const sci = rec["sci-score"];
        const reported = !(typeof sci === "number" && sci < 0);
        if (reported && rec["functional-unit"] === undefined) {
            errors.push("sci-score is present but functional-unit is missing (draft MUST)");
        }
    }
    return { valid: errors.length === 0, errors };
}
/** Validate a full document (single object or array), incl. cross-entry array rules. */
function validateDocument(doc) {
    // An empty array conveys no report at all — the publisher side answers the
    // equivalent situation with 404 rather than serving []; treat it as invalid
    // instead of handing callers a vacuous "valid" document.
    if (Array.isArray(doc) && doc.length === 0) {
        return { valid: false, errors: ["empty array conveys no report"] };
    }
    const items = Array.isArray(doc) ? doc : [doc];
    const errors = [];
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
        const entries = doc;
        const periods = entries.map((m) => String(m["reporting-period"] ?? ""));
        if (new Set(periods.map((p) => p.length)).size > 1) {
            errors.push("array entries mix reporting-period precisions");
        }
        for (let i = 1; i < periods.length; i++) {
            if (periods[i] <= periods[i - 1]) {
                errors.push(`array entries not strictly ascending by reporting-period at [${i}] ("${periods[i]}" after "${periods[i - 1]}")`);
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
class ValidationError extends Error {
    constructor(errors) {
        super(`Sustainability document failed validation:\n - ${errors.join("\n - ")}`);
        this.errors = errors;
        this.name = "ValidationError";
    }
}
exports.ValidationError = ValidationError;
function assertValid(doc) {
    const r = validateDocument(doc);
    if (!r.valid)
        throw new ValidationError(r.errors);
    return doc;
}
