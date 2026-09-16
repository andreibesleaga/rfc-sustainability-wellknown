/**
 * Legacy-compatibility helpers, and the draft's tolerance rules
 * (draft -07 §Value Constraints and Omitted Metrics).
 *
 * Since -03 there is no in-band "not reported" marker: omitting a member is the
 * only way to convey that a metric is unreported. Historical documents,
 * however, used a negative value as a "not reported" sentinel. The draft's
 * out-of-range rule subsumes the old sentinel: a value "outside a member's
 * stated range ... is treated as not reported", so a negative value in a member
 * defined as NON-NEGATIVE reads as unreported rather than making the object
 * unreadable.
 *
 * `scope-1`/`scope-2`/`scope-3` are deliberately NOT in the list below: since
 * -03 they MAY legitimately be negative (net accounting / removals, draft
 * §Value Constraints and Omitted Metrics) and must never be stripped.
 */
import { RESPONSE_JTD_SCHEMA } from "./schema";
import { SustainabilityMetrics, TARGET_TYPES } from "./types";

/**
 * The members the draft defines as non-negative ("gross quantities", plus the
 * 0–100 `renewable-energy` percentage). A negative value in any of these reads
 * as "not reported" under the compatibility rule.
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
 * True when a value in a non-negative member reads as "not reported" (any
 * negative number). For `renewable-energy` — bounded 0-100 inclusive by the
 * draft — a value above 100 is likewise outside the member's stated range and
 * SHOULD be treated as not reported (draft §Value Constraints), so pass the
 * member key to get the range-aware check.
 */
export function isNotReported(value: unknown, key?: string): boolean {
  if (typeof value !== "number") return false;
  // NaN and ±Infinity are not values a member can carry: JSON has no literal
  // for either, but `1e999` parses to Infinity, so an origin can put one on the
  // wire. "A member that is present always carries an actual value" (draft -07
  // §Value Constraints and Omitted Metrics), and re-serializing one yields
  // `null` — a wrongly typed member — so it reads as not reported.
  if (!Number.isFinite(value)) return true;
  if (value < 0) return true;
  return key === "renewable-energy" && value > 100;
}

/**
 * Returns a copy with every out-of-range value in a NON-NEGATIVE member
 * removed (the draft's legacy-compatibility / out-of-range rule applied).
 * Negative scope-1/2/3 values are real data (net accounting) and are left
 * untouched.
 */
export function withoutSentinels(doc: SustainabilityMetrics): Partial<SustainabilityMetrics> {
  const out: Record<string, unknown> = { ...doc };
  for (const key of NUMERIC_KEYS) {
    if (isNotReported(out[key], key)) delete out[key];
  }
  return out as Partial<SustainabilityMetrics>;
}

/**
 * The values the -04 draft defines for the enumerated `target-type` member —
 * kept in sync with the JTD schema, which `test/schema.test.ts` byte-checks
 * against the canonical repo schema.
 */
export { TARGET_TYPES };

/**
 * True when a `target-type` value is one this revision defines. Any other
 * value falls under the draft's enumerated-member tolerance rule (§Value
 * Constraints and Omitted Metrics): a client SHOULD disregard the member —
 * interpreting `target` as if `target-type` were absent — rather than reject
 * the document. The counterpart of isNotReported() for this string member;
 * the stripping itself happens in fetch.ts's pre-pass (before the schema
 * gate, whose closed enum would otherwise fail on exactly such a value).
 */
export function isRecognizedTargetType(value: unknown): value is (typeof TARGET_TYPES)[number] {
  return typeof value === "string" && (TARGET_TYPES as readonly string[]).includes(value);
}

/**
 * The enumerated string members the draft's tolerance rule names
 * (§Value Constraints and Omitted Metrics) and, for the two unit members,
 * the numeric members they parameterize — which read as "not reported" once
 * their unit is disregarded. The value sets come from the schema itself.
 */
export const ENUMERATED_MEMBERS: ReadonlyArray<{ member: string; values: readonly string[]; parameterizes: readonly string[] }> = [
  { member: "capabilities", values: RESPONSE_JTD_SCHEMA.properties.capabilities.enum, parameterizes: [] },
  { member: "energy-unit", values: RESPONSE_JTD_SCHEMA.optionalProperties["energy-unit"].enum, parameterizes: ["energy-consumption"] },
  {
    member: "carbon-unit",
    values: RESPONSE_JTD_SCHEMA.optionalProperties["carbon-unit"].enum,
    parameterizes: ["carbon-footprint", "scope-1", "scope-2", "scope-3"],
  },
  { member: "carbon-accounting", values: RESPONSE_JTD_SCHEMA.optionalProperties["carbon-accounting"].enum, parameterizes: [] },
  { member: "target-type", values: TARGET_TYPES, parameterizes: [] },
];

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
export type MemberJsonType = "number" | "string" | "array" | "object";

export const OPTIONAL_MEMBER_JSON_TYPES: Readonly<Record<string, MemberJsonType>> = {
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
  upstream: "array",
  extensions: "object",
  signed: "string",
};

/**
 * True when an optional member defined by the draft is present with a value
 * of the wrong JSON type (including `null`). `undefined` (absent) is never
 * wrong-typed; members not defined by the draft are unknown members the
 * ignore-unknown rule covers, never "wrong-typed".
 */
export function isWrongJsonType(key: string, value: unknown): boolean {
  const expected = OPTIONAL_MEMBER_JSON_TYPES[key];
  if (expected === undefined || value === undefined) return false;
  if (expected === "array") return !Array.isArray(value);
  if (expected === "object") return typeof value !== "object" || value === null || Array.isArray(value);
  return typeof value !== expected;
}

/**
 * Every OPTIONAL member the draft types as a number, the scopes included.
 * Derived from {@link OPTIONAL_MEMBER_JSON_TYPES} so the two cannot drift.
 */
export const NUMERIC_MEMBERS: readonly string[] = Object.keys(OPTIONAL_MEMBER_JSON_TYPES).filter(
  (k) => OPTIONAL_MEMBER_JSON_TYPES[k] === "number",
);

/**
 * True when a numeric member carries a value JSON can express but the format
 * cannot: `NaN` or ±`Infinity`.
 *
 * JSON has no literal for either ({{RFC8259}}, Section 6), but a number
 * literal outside the double-precision range — `1e999` — parses to `Infinity`
 * in every JavaScript runtime, which the media type's own security
 * considerations call out ("the implementation-dependent handling ... of
 * numbers outside the range exactly representable in IEEE 754 double
 * precision"). Such a member has no actual value and re-serializes as `null`,
 * so it is disregarded like any other defective value.
 */
export function isNonFiniteNumber(key: string, value: unknown): boolean {
  return NUMERIC_MEMBERS.includes(key) && typeof value === "number" && !Number.isFinite(value);
}

/**
 * The reporting subject for a legacy (1.x) entry that lacks the mandatory
 * `target` member (a pre-06 form, kept readable here): when the entry
 * carries the historical `target-path` member, that member's VALUE is the
 * reporting subject; only when neither member exists is the document an
 * origin-wide report attributed to the final response origin's host.
 * A non-string (or empty) `target-path` is a wrong-typed value — treated as
 * not present, so the origin host applies.
 */
export function legacyReportingSubject(entry: Record<string, unknown>, originHost: string): string {
  const tp = entry["target-path"];
  return typeof tp === "string" && tp !== "" ? tp : originHost;
}

/**
 * The draft's tolerance rules (§Value Constraints and Omitted Metrics) applied
 * to ONE declaration object, in place: the affected member is stripped before
 * the schema gate — which would otherwise fail the whole object on exactly
 * that value — and its path is appended to `disregarded`, so a caller can
 * still see that tolerance was applied and to what.
 *
 *  1. "A value ... of the wrong JSON type (including `null`) is treated as not
 *     reported", for the draft-defined OPTIONAL members — and, for the same
 *     reason, a numeric member carrying `NaN` or ±`Infinity`, which a `1e999`
 *     literal on the wire produces and which re-serializes as `null`.
 *  1b. Mandatory members take no tolerance, with the one exception the draft
 *     names: "a defective `capabilities` value is read as `basic`, and a
 *     defective value of any other mandatory member leaves the object
 *     non-conformant".
 *  2. "A `sci-score` without `functional-unit` is treated as not reported." A
 *     negative `sci-score` is already "not reported" under the out-of-range
 *     rule and is left in place for this module's on-demand interpretation.
 *  3. "An unrecognized value of `capabilities`, `energy-unit`, `carbon-unit`,
 *     `carbon-accounting`, or `target-type` causes that member to be
 *     disregarded; for a unit member the numeric members it parameterizes are
 *     then treated as not reported, and for `target-type` the consumer reads
 *     `target` as if the member were absent."
 *
 * It is shared rather than inlined because the draft asks for one reading, not
 * two: the fetch path applies it to the declaration it retrieved, and the
 * upstream walk applies it to every declaration it retrieves, which "reads a
 * retrieved declaration exactly as it reads any other, applying the tolerance
 * rules of Value Constraints and Omitted Metrics rather than refusing one over
 * a defective value" (draft -07 §Upstream Declarations).
 *
 * What it deliberately does NOT do is make an unreadable object readable: a
 * missing mandatory member, or a body that is not a declaration at all, is
 * left exactly as served for validation to reject.
 *
 * @param o the declaration object (anything else is ignored)
 * @param path prefix for the reported member paths (e.g. `"[2]."`)
 * @param disregarded collector, appended to in place
 */
export function applyToleranceRules(o: unknown, path: string, disregarded: string[]): void {
  if (typeof o !== "object" || o === null || Array.isArray(o)) return;
  const rec = o as Record<string, unknown>;
  // (1) Wrong JSON type in a draft-defined OPTIONAL member (stripping a
  // mandatory member could not make the object processable), and — the same
  // defect one step in — a numeric member carrying NaN or ±Infinity, which
  // `1e999` on the wire produces and which no member can actually carry
  // ({@link isNonFiniteNumber}).
  for (const key of Object.keys(rec)) {
    if (isWrongJsonType(key, rec[key]) || isNonFiniteNumber(key, rec[key])) {
      delete rec[key];
      disregarded.push(`${path}${key}`);
    }
  }
  // (1b) A value of the wrong JSON type is as defective as an unrecognized
  // one, and the enumerated-member loop below covers the unrecognized-string
  // case; this covers the rest. Every other mandatory member is left exactly
  // as served, so the schema gate reports the object as non-conformant.
  if ("capabilities" in rec && typeof rec.capabilities !== "string") {
    rec.capabilities = "basic";
    disregarded.push(`${path}capabilities`);
  }
  // (2) sci-score without functional-unit.
  const sci = rec["sci-score"];
  if (typeof sci === "number" && sci >= 0 && rec["functional-unit"] === undefined) {
    delete rec["sci-score"];
    disregarded.push(`${path}sci-score`);
  }
  // (3) Enumerated-member tolerance. `capabilities` is mandatory, so the
  // conservative value stands in for it rather than a hole.
  for (const { member, values, parameterizes } of ENUMERATED_MEMBERS) {
    const value = rec[member];
    if (typeof value !== "string" || values.includes(value)) continue;
    if (member === "capabilities") rec[member] = "basic";
    else delete rec[member];
    disregarded.push(`${path}${member}`);
    for (const dependent of parameterizes) {
      if (dependent in rec) {
        delete rec[dependent];
        disregarded.push(`${path}${dependent}`);
      }
    }
  }
}
