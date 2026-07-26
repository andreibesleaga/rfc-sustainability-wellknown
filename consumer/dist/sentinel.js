"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPTIONAL_MEMBER_JSON_TYPES = exports.TARGET_TYPES = exports.NUMERIC_KEYS = void 0;
exports.isNotReported = isNotReported;
exports.withoutSentinels = withoutSentinels;
exports.isRecognizedTargetType = isRecognizedTargetType;
exports.isWrongJsonType = isWrongJsonType;
exports.legacyReportingSubject = legacyReportingSubject;
/**
 * The members the draft defines as non-negative ("gross quantities", plus the
 * 0–100 `renewable-energy` percentage). A negative value in any of these reads
 * as "not reported" under the compatibility rule.
 */
exports.NUMERIC_KEYS = [
    "energy-consumption",
    "carbon-footprint",
    "sci-score",
    "carbon-intensity-gCO2e-per-kWh",
    "estimated-annual-emissions-kgCO2e",
    "renewable-energy",
];
/**
 * True when a value in a non-negative member reads as "not reported" (any
 * negative number). For `renewable-energy` — bounded 0-100 inclusive by the
 * draft — a value above 100 is likewise outside the member's stated range and
 * SHOULD be treated as not reported (draft §Value Constraints), so pass the
 * member key to get the range-aware check.
 */
function isNotReported(value, key) {
    if (typeof value !== "number")
        return false;
    if (value < 0)
        return true;
    return key === "renewable-energy" && value > 100;
}
/**
 * Returns a copy with every out-of-range value in a NON-NEGATIVE member
 * removed (the draft's legacy-compatibility / out-of-range rule applied).
 * Negative scope-1/2/3 values are real data (net accounting) and are left
 * untouched.
 */
function withoutSentinels(doc) {
    const out = { ...doc };
    for (const key of exports.NUMERIC_KEYS) {
        if (isNotReported(out[key], key))
            delete out[key];
    }
    return out;
}
/**
 * The values the -04 draft defines for the enumerated `target-type` member —
 * kept in sync with the JTD schema, which `test/schema.test.ts` byte-checks
 * against the canonical repo schema.
 */
exports.TARGET_TYPES = [
    "origin",
    "path",
    "organization",
    "service",
    "product",
    "device",
    "tenant",
    "data-source",
];
/**
 * True when a `target-type` value is one this revision defines. Any other
 * value falls under the draft's enumerated-member tolerance rule (§Value
 * Constraints and Omitted Metrics): a client SHOULD disregard the member —
 * interpreting `target` as if `target-type` were absent — rather than reject
 * the document. The counterpart of isNotReported() for this string member;
 * the stripping itself happens in fetch.ts's pre-pass (before the schema
 * gate, whose closed enum would otherwise fail on exactly such a value).
 */
function isRecognizedTargetType(value) {
    return typeof value === "string" && exports.TARGET_TYPES.includes(value);
}
/**
 * Expected JSON type of every OPTIONAL member the draft defines. Draft
 * §Value Constraints and Omitted Metrics (-04): "A value of the wrong JSON
 * type (including `null`) is treated as not reported" — fetch.ts's
 * legacy-compatibility pre-pass strips such members (recording them in
 * `disregarded`) before the schema gate would otherwise reject the document.
 *
 * Mandatory members are deliberately NOT listed: stripping one could not make
 * the document processable (it would just fail as "missing" instead of
 * "wrong type"), so a wrong-typed mandatory member still fails validation.
 */
exports.OPTIONAL_MEMBER_JSON_TYPES = {
    "energy-consumption": "number",
    "energy-unit": "string",
    "carbon-footprint": "number",
    "carbon-unit": "string",
    "carbon-accounting": "string",
    "scope-1": "number",
    "scope-2": "number",
    "scope-3": "number",
    "sci-score": "number",
    "functional-unit": "string",
    "carbon-intensity-gCO2e-per-kWh": "number",
    "estimated-annual-emissions-kgCO2e": "number",
    "renewable-energy": "number",
    "verifiable-attestation-uri": "string",
    "disclosure-uri": "string",
    "target-type": "string",
};
/**
 * True when an optional member defined by the draft is present with a value
 * of the wrong JSON type (including `null`). `undefined` (absent) is never
 * wrong-typed; members not defined by the draft are unknown members the
 * ignore-unknown rule covers, never "wrong-typed".
 */
function isWrongJsonType(key, value) {
    const expected = exports.OPTIONAL_MEMBER_JSON_TYPES[key];
    if (expected === undefined || value === undefined)
        return false;
    return typeof value !== expected;
}
/**
 * The reporting subject for a legacy (1.x) entry that lacks the mandatory
 * `target` member (draft §Versioning and Extensibility, -04): when the entry
 * carries the historical `target-path` member, that member's VALUE is the
 * reporting subject; only when neither member exists is the document an
 * origin-wide report attributed to the final response origin's host.
 * A non-string (or empty) `target-path` is a wrong-typed value — treated as
 * not present, so the origin host applies.
 */
function legacyReportingSubject(entry, originHost) {
    const tp = entry["target-path"];
    return typeof tp === "string" && tp !== "" ? tp : originHost;
}
