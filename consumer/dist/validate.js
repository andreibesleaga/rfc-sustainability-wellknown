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
    if (valid)
        return { valid: true, errors: [] };
    const errors = (validateObject.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.keyword}${e.schemaPath ? ` (${e.schemaPath})` : ""}`);
    return { valid: false, errors };
}
/** Validate a full document (single object or array), incl. cross-entry array rules. */
function validateDocument(doc) {
    const items = Array.isArray(doc) ? doc : [doc];
    const errors = [];
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
        if (new Set(entries.map((m) => m["target-path"] ?? "")).size > 1) {
            errors.push("array entries carry differing target-path values");
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
