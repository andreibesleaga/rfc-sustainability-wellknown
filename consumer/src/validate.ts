/**
 * Defensive validation of an incoming declaration. The data just arrived from
 * an arbitrary third-party origin, so it is schema-validated (JTD, RFC 8927)
 * AND checked against the draft's prose rules — the ones the formal schemas
 * cannot express — before being handed to caller code: the at-least-one rule,
 * the `sci-score`/`functional-unit` dependency, the absolute-URI form of
 * `extensions` keys with object values, the at-least-one-entry rule on `upstream`, numeric
 * members carrying no actual value (`NaN`/±`Infinity`), and the cross-entry
 * array rules. A non-conformant publisher is the normal case for early
 * ecosystem adoption, not a hypothetical.
 *
 * A non-`https` URI member is deliberately a WARNING here, not an error: the
 * member is kept and the object stays valid, and the rule is enforced where it
 * bites, at dereference time (`disclosure.ts` and the upstream walk refuse to
 * fetch such a URI at all).
 */
import { isolate } from "./text";
import { NUMERIC_MEMBERS } from "./sentinel";
import Ajv, { ValidateFunction } from "ajv/dist/jtd";
import { RESPONSE_JTD_SCHEMA } from "./schema";
import { SustainabilityDocument, SustainabilityMetrics } from "./types";

const ajv = new Ajv({ allErrors: true });
const validateObject: ValidateFunction = ajv.compile(RESPONSE_JTD_SCHEMA as unknown as object);

export interface ValidationResult {
  /**
   * True when the declaration carries NO errors. `warnings` never influence
   * it: a warning is an advisory finding about an object that is valid and
   * usable, and callers (the gateway among them) treat `valid === false` as a
   * hard failure.
   */
  valid: boolean;
  errors: string[];
  /**
   * Advisory findings that do NOT make the declaration invalid: an absolute
   * non-`https` URI member ({@link URI_MEMBERS}) and an unrecognized top-level
   * member ({@link KNOWN_MEMBERS}). The member is kept either way.
   */
  warnings: string[];
}

/**
 * The URI-valued members. Draft -07 §Optional Members: `methodology-uri`,
 * `verifiable-attestation-uri`, `disclosure-uri` and `upstream[].declaration`
 * "MUST be absolute URIs with the 'https' scheme; a consumer MUST NOT
 * automatically dereference any other scheme".
 */
export const URI_MEMBERS = ["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"] as const;

/** Every top-level member this revision defines (the base object is closed). */
export const KNOWN_MEMBERS: readonly string[] = [
  ...Object.keys(RESPONSE_JTD_SCHEMA.properties),
  ...Object.keys(RESPONSE_JTD_SCHEMA.optionalProperties),
];

/**
 * The numeric metric members. Draft -07 §Value Constraints and Omitted
 * Metrics: an object MUST carry at least one of these, or at least one of
 * `disclosure-uri` and `verifiable-attestation-uri`.
 */
export const METRIC_MEMBERS: readonly string[] = [
  "energy-consumption",
  "carbon-footprint",
  "scope-1",
  "scope-2",
  "scope-3",
  "sci-score",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
  "renewable-energy",
];

/**
 * An `extensions` member name (draft -07 §Extensions): an absolute URI, ASCII
 * only, with no whitespace and no fragment. Two forms are named — an "https"
 * URI with a host, which documents the members for a human and which this
 * package NEVER dereferences, and `urn:uuid:` plus a lowercase UUID, the Nil
 * and Max UUIDs excluded — and any other absolute URI is permitted by the rule.
 * Keys are compared octet for octet and are never normalized, so the WHATWG URL
 * parser (which lowercases the scheme and host and may percent-encode) is not
 * used to check one.
 */
/**
 * The shape of an RFC 3986 Section 4.3 `absolute-URI`: a scheme
 * in lowercase (ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ), draft §Extensions:
 * "written in ASCII with the scheme in lowercase"), a colon, then one or more of
 * the characters RFC 3986 allows after it — unreserved, sub-delims, "%", and the
 * gen-delims ":" "/" "?" "@" "[" "]" — so no space, no double quote, and none of
 * < > \ ^ ` { | } , and no "#": a key carries no fragment. It is the repo CDDL's `ext-name` rule,
 * character for character. The WHATWG URL parser
 * is deliberately not used here: it lowercases the scheme and host and may
 * percent-encode, and draft §Extensions compares keys octet for octet.
 */
export const ABSOLUTE_URI_RE = /^[a-z][a-z0-9+.-]*:[!$-;=?-Z\[\]_a-z~]+$/;

/** `urn:uuid:` followed by the lowercase hyphenated UUID text form (RFC 9562, Section 4). */
export const URN_UUID_RE = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The Nil and Max UUIDs (RFC 9562 §§5.9, 5.10) in the `urn:uuid:` form. Draft
 * §Extensions forbids them: an `extensions` key identifies the party that
 * defined its members, and these two identify everyone.
 */
export const NIL_UUID_NAME = "urn:uuid:00000000-0000-0000-0000-000000000000";
export const MAX_UUID_NAME = "urn:uuid:ffffffff-ffff-ffff-ffff-ffffffffffff";
export const RESERVED_EXTENSION_NAMES: readonly string[] = [NIL_UUID_NAME, MAX_UUID_NAME];

/**
 * The "https" form of an `extensions` key (draft §Extensions): `https://` and a
 * non-empty host. It should identify human-readable documentation, and a
 * consumer MUST NEVER dereference it.
 */
export function isHttpsExtensionName(key: string): boolean {
  if (!ABSOLUTE_URI_RE.test(key) || !key.startsWith("https://")) return false;
  return httpsHost(key) !== "";
}

/**
 * The `urn:uuid:` form of an `extensions` key (draft §Extensions): a lowercase
 * hyphenated UUID (RFC 9562, Section 4) that is neither the Nil nor the Max UUID.
 */
export function isUrnUuidExtensionName(key: string): boolean {
  return URN_UUID_RE.test(key) && !RESERVED_EXTENSION_NAMES.includes(key);
}

/** The host of an `https://` key: the authority without userinfo and without port. */
function httpsHost(key: string): string {
  const authority = key.slice("https://".length).split(/[/?]/, 1)[0];
  const hostport = authority.slice(authority.lastIndexOf("@") + 1);
  if (hostport.startsWith("[")) return hostport.slice(0, hostport.indexOf("]") + 1);
  return hostport.split(":", 1)[0];
}

/**
 * Why `key` is not a usable `extensions` member name, or `undefined` when it is
 * one. The rule (draft §Extensions): an absolute URI, ASCII only, restricted to
 * the characters RFC 3986 allows, so no whitespace and no fragment; the CDDL
 * rule is `ext-name`. The two named forms are an "https" URI with a host and
 * `urn:uuid:` + a lowercase UUID that is neither the Nil nor the Max UUID. Any
 * other absolute URI (`urn:oid:1.3.6.1.4.1.32473.1`, say) is permitted by the
 * rule. Keys are compared octet for octet and are never normalized.
 */
export function extensionNameError(key: string): string | undefined {
  if (typeof key !== "string" || key === "") {
    return "is empty; an extensions key is an absolute URI (draft, Extensions)";
  }
  if (/[^\x21-\x7E]/.test(key)) {
    return /^[\x00-\x7f]*$/.test(key)
      ? "contains whitespace or a control character; an extensions key is an absolute URI with none (draft, Extensions)"
      : "is not ASCII; an extensions key is an ASCII absolute URI (draft, Extensions)";
  }
  if (key.includes("#")) {
    return 'contains "#"; an extensions key is an absolute-URI (RFC 3986, Section 4.3) and carries no fragment (draft, Extensions)';
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(key) && !/^[a-z][a-z0-9+.-]*:/.test(key)) {
    return (
      "has an uppercase scheme; an extensions key is written in ASCII with the scheme " +
      'in lowercase (e.g. "https://…", not "HTTPS://…") (draft, Extensions)'
    );
  }
  const disallowed = /["<>\\^`{|}]/.exec(key);
  if (disallowed) {
    return (
      `contains ${JSON.stringify(disallowed[0])}, which RFC 3986 does not allow in a URI; ` +
      "an extensions key is an absolute-URI (RFC 3986, Section 4.3) (draft, Extensions)"
    );
  }
  if (!ABSOLUTE_URI_RE.test(key)) {
    return (
      "is not an absolute URI: it must begin with a scheme and a colon " +
      '(e.g. "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845" or ' +
      '"https://example.com/sustainability/extensions/water-and-waste") (draft, Extensions)'
    );
  }
  const scheme = key.slice(0, key.indexOf(":")).toLowerCase();
  if (scheme === "https") {
    if (!key.startsWith("https://") || httpsHost(key) === "") {
      return 'is an "https" key without "https://" and a host, in lowercase (draft, Extensions)';
    }
  } else if (scheme === "urn" && key.slice(4, 9).toLowerCase() === "uuid:") {
    if (!URN_UUID_RE.test(key)) {
      return (
        'is not "urn:uuid:" followed by a UUID in the RFC 9562 Section 4 lowercase ' +
        'hyphenated text form (e.g. "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845") (draft, Extensions)'
      );
    }
    if (key === NIL_UUID_NAME) {
      return "is the Nil UUID (RFC 9562 §5.9), which MUST NOT be used as an extensions key: it is a guaranteed collision (draft, Extensions)";
    }
    if (key === MAX_UUID_NAME) {
      return "is the Max UUID (RFC 9562 §5.10), which MUST NOT be used as an extensions key: it is a guaranteed collision (draft, Extensions)";
    }
  }
  return undefined;
}

/** Whether `key` is a usable `extensions` member name (draft §Extensions). */
export function isExtensionName(key: string): boolean {
  return extensionNameError(key) === undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Advisory findings for URI members carrying an absolute non-`https` URI.
 *
 * Deliberately a WARNING, not an error: the member is kept and the object
 * stays valid (failing a whole declaration over a supporting link would lose
 * the metrics with it). What the rule actually buys is protection at
 * dereference time, which `disclosure.ts` and the upstream walk enforce by
 * refusing to fetch such a URI at all.
 *
 * A value that is not an absolute URI at all (a relative reference, or
 * anything `new URL()` rejects) is left alone here: the draft's absolute-URI
 * requirement is not this function's subject, and guessing a base would be
 * worse than saying nothing.
 */
function uriMemberWarnings(obj: unknown): string[] {
  if (!isRecord(obj)) return [];
  const warnings: string[] = [];
  const check = (key: string, value: unknown) => {
    if (typeof value !== "string" || value === "") return;
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return; // not an absolute URI: out of scope for this check
    }
    if (parsed.protocol !== "https:") {
      warnings.push(
        `${key} is an absolute non-https URI ("${isolate(value)}"): the draft restricts URI members to the "https" scheme ` +
          `and a consumer MUST NOT automatically dereference another scheme (member kept; not a validation error)`,
      );
    }
  };
  for (const key of URI_MEMBERS) check(key, obj[key]);
  if (Array.isArray(obj.upstream)) {
    obj.upstream.forEach((entry, i) => {
      if (isRecord(entry)) check(`upstream[${i}].declaration`, entry.declaration);
    });
  }
  return warnings;
}

/** Unrecognized top-level members: a warning, and the member is ignored (draft -07 §Payload Format). */
function unknownMemberWarnings(obj: unknown): string[] {
  if (!isRecord(obj)) return [];
  return Object.keys(obj)
    .filter((k) => !KNOWN_MEMBERS.includes(k))
    .map(
      (k) =>
        `unknown-member: "${isolate(k)}" is not a member this revision defines; it is ignored ` +
        `(the base object is closed — other data belongs under "extensions" — but a consumer MUST ignore a ` +
        `top-level member it does not recognize, since a revision may define one)`,
    );
}

function validateMetrics(obj: unknown, atLeastOneAsServed?: boolean): ValidationResult {
  const warnings = [...uriMemberWarnings(obj), ...unknownMemberWarnings(obj)];

  // The schema gate runs against the object WITHOUT its unrecognized
  // top-level members: the -07 JTD closes the base object, so leaving them in
  // would turn "ignore what you do not recognize" into a rejection.
  const gated = isRecord(obj)
    ? Object.fromEntries(Object.entries(obj).filter(([k]) => KNOWN_MEMBERS.includes(k)))
    : obj;
  const valid = validateObject(gated) as boolean;
  const errors = valid
    ? []
    : (validateObject.errors ?? []).map(
        (e) => `${e.instancePath || "/"} ${e.keyword}${e.schemaPath ? ` (${e.schemaPath})` : ""}`,
      );

  // Draft §Optional Members: "sci-score ... in grams of CO2e per
  // functional-unit, which MUST then be present." This cross-field dependency
  // cannot be expressed in JTD (or CDDL), so the schema gate above can't catch
  // it — check it here so a conformance-checking consumer enforces the full
  // prose MUST. Exception: a NEGATIVE sci-score is out of the member's stated
  // range and therefore already "not reported", so it carries no dependency.
  if (isRecord(obj) && "sci-score" in obj) {
    const sci = obj["sci-score"];
    const reported = !(typeof sci === "number" && sci < 0);
    if (reported && obj["functional-unit"] === undefined) {
      errors.push("sci-score is present but functional-unit is missing (draft MUST)");
    }
  }

  if (isRecord(obj)) {
    // The at-least-one rule is judged on the members the object carried AS
    // SERVED (draft -07 §Value Constraints and Omitted Metrics). When a caller
    // has already applied the tolerance rules to `obj` — stripping a defective
    // value before this gate — it passes that verdict in, and a stripped
    // member does not turn a conformant object into a non-conformant one.
    errors.push(
      ...periodShapeErrors(obj),
      ...nonFiniteErrors(obj),
      ...extensionErrors(obj),
      ...upstreamErrors(obj),
      ...(atLeastOneAsServed === true ? [] : atLeastOneError(obj)),
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Draft -07 §Extensions: the member names of `extensions` are absolute URIs
 * (RFC 3986, Section 4.3). The CDDL says so formally, so a key of any other
 * form is a schema-level defect rather than a tolerated value. Values are
 * objects, and nothing inside one — a documentation URI included — is ever
 * dereferenced or executed by this package.
 */
function extensionErrors(obj: Record<string, unknown>): string[] {
  if (obj.extensions === undefined) return [];
  const ext = obj.extensions;
  if (!isRecord(ext)) return ["extensions is present but is not a JSON object"];
  const errors: string[] = [];
  for (const [key, value] of Object.entries(ext)) {
    const why = extensionNameError(key);
    if (why !== undefined) {
      errors.push(`extensions key "${isolate(key)}" ${why}`);
    }
    // The JTD `values` form ajv compiles does not itself reject a non-object
    // value here, and the draft requires one ("whose values are objects").
    if (!isRecord(value)) {
      errors.push(`extensions["${isolate(key)}"] is not a JSON object, which the draft requires of every extensions value`);
    }
  }
  return errors;
}

/**
 * Draft -07 §Upstream Declarations: "The `upstream` member is an array of at
 * least one object ... A publisher with nothing to name omits the member rather
 * than carrying an empty array." §Formal Definition (JTD) names it among the
 * rules "which the CDDL captures and the JTD cannot ... prose rules of this
 * document; validating implementations enforce them" — so, like the absolute-URI
 * form of an `extensions` key, an empty array is a schema-level defect rather than a
 * value the tolerance rules cover (those reach a value "of the wrong JSON
 * type", and an empty array is the right type).
 */
function upstreamErrors(obj: Record<string, unknown>): string[] {
  if (!Array.isArray(obj.upstream) || obj.upstream.length > 0) return [];
  return [
    "upstream is present but empty; the draft requires at least one entry and has a publisher with " +
      "nothing to name omit the member rather than carry an empty array",
  ];
}

/**
 * The three `period-value` forms (draft -07 §Mandatory Members: `reporting-period`
 * is "in the `period` form of Extended Query Parameters (`YYYY`, `YYYY-MM`, or
 * `YYYY-MM-DD`)"). Month is bounded 01-12 and day 01-31 by the pattern; a day
 * that does not exist in its month is left to the publisher's own gate, since
 * nothing a consumer does with the value depends on it.
 */
export const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/**
 * `reporting-period` is a MANDATORY member with a stated form, and §Value
 * Constraints and Omitted Metrics is explicit that "a defective value of any
 * other mandatory member leaves the object non-conformant" — only `capabilities`
 * gets a fallback. So a value that is not one of the three `period-value` forms
 * is an error, not something to disregard: the whole of this package's period
 * handling (the within-P comparison, the array precision and ordering rules, the
 * upstream period match) reads those three forms and nothing else.
 *
 * It is also what keeps a client-side {@link AggregateSummary} — whose
 * `reporting-period` is a RANGE, `"2026-01..2026-12"` — from being republished
 * or round-tripped as a declaration.
 */
function periodShapeErrors(obj: Record<string, unknown>): string[] {
  const period = obj["reporting-period"];
  if (typeof period !== "string" || PERIOD_RE.test(period)) return [];
  return [
    `reporting-period "${isolate(period)}" is not one of the three forms this revision defines ` +
      `(YYYY, YYYY-MM, YYYY-MM-DD); it is a mandatory member, and a defective value of a mandatory ` +
      `member other than capabilities leaves the object non-conformant`,
  ];
}

/**
 * Numeric members carrying `NaN` or ±`Infinity`. JSON has no literal for
 * either, but a `1e999` on the wire parses to `Infinity` in every JavaScript
 * runtime — a hazard the media type's own security considerations name. Such a
 * member carries no actual value and re-serializes as `null`, so a strict
 * validation reports it; the tolerance pre-pass (`sentinel.ts`) strips it
 * before this gate on the ordinary fetch path, exactly as it does for a
 * `sci-score` without `functional-unit`.
 */
function nonFiniteErrors(obj: Record<string, unknown>): string[] {
  return NUMERIC_MEMBERS.filter((k) => typeof obj[k] === "number" && !Number.isFinite(obj[k] as number)).map(
    (k) =>
      `${k} is ${String(obj[k])}, which is not a value this member can carry (JSON has no literal for it; ` +
      `a number outside double precision, such as 1e999, parses to it and re-serializes as null)`,
  );
}

/**
 * Whether an object satisfies the at-least-one rule: "A declaration object
 * MUST carry at least one numeric metric member or at least one of
 * `disclosure-uri` and `verifiable-attestation-uri`" (draft -07 §Value
 * Constraints and Omitted Metrics). `upstream` deliberately does not count as
 * evidence.
 *
 * The rule "is judged on the members the object carries as served", so this is
 * asked of the object as it arrived: a consumer that applies the tolerance
 * rules first (see `fetch.ts`) asks it BEFORE stripping anything, since "a
 * consumer that disregards a defective value under the rules below does not
 * thereby make the object non-conformant, it simply has less to read".
 */
export function carriesAtLeastOne(obj: unknown): boolean {
  if (!isRecord(obj)) return false;
  // A non-finite number (`1e999` on the wire parses to Infinity) is not an
  // actual value, so it is not a metric the object "carries" for this rule.
  const hasMetric = METRIC_MEMBERS.some((k) => typeof obj[k] === "number" && Number.isFinite(obj[k]));
  return hasMetric || typeof obj["disclosure-uri"] === "string" || typeof obj["verifiable-attestation-uri"] === "string";
}

/** The at-least-one rule as an error list; see {@link carriesAtLeastOne}. */
function atLeastOneError(obj: Record<string, unknown>): string[] {
  if (carriesAtLeastOne(obj)) return [];
  return [
    "object carries no numeric metric member and neither disclosure-uri nor verifiable-attestation-uri " +
      "(draft MUST: at least one of them)",
  ];
}

/** Options for {@link validateDocument}. */
export interface ValidateOptions {
  /**
   * The verdict of the at-least-one rule on the object AS SERVED, one entry
   * per declaration object (index 0 for a single object, index i for array
   * entry i). Only a caller that has applied the draft's tolerance rules to
   * `doc` before validating — stripping a defective value out of the object —
   * supplies it, so that the rule is still judged on the members the object
   * carried as served (draft -07 §Value Constraints and Omitted Metrics); what
   * tolerance removed is reported through that caller's own channel (the
   * `disregarded` list), not by making the document invalid. `true` suppresses
   * the at-least-one error for that object; anything else leaves the rule to
   * be judged on `doc` itself.
   */
  atLeastOneAsServed?: readonly boolean[];
}

/**
 * Validate a full declaration (single object or array), incl. cross-entry
 * array rules. `valid` reflects errors ONLY; `warnings` are advisory and never
 * change it.
 */
export function validateDocument(doc: unknown, options: ValidateOptions = {}): ValidationResult {
  // Draft -07 §Payload Format: "The body is one declaration object or an array
  // of them ... a body whose top-level value is neither an object nor an array
  // is not a declaration." Said plainly here, rather than left to the schema
  // gate to report as a member-shaped error about a number or a string.
  if (typeof doc !== "object" || doc === null) {
    return {
      valid: false,
      errors: [
        `the top-level value is ${doc === null ? "null" : `a JSON ${typeof doc}`}, so the body is not a declaration: ` +
          `a declaration is one declaration object or an array of them`,
      ],
      warnings: [],
    };
  }
  // An empty array conveys no report at all — the publisher side answers the
  // equivalent situation with 404 rather than serving []; treat it as invalid
  // instead of handing callers a vacuous "valid" declaration.
  if (Array.isArray(doc) && doc.length === 0) {
    return { valid: false, errors: ["empty array conveys no report"], warnings: [] };
  }
  const items = Array.isArray(doc) ? doc : [doc];
  const errors: string[] = [];
  const warnings: string[] = [];
  items.forEach((item, i) => {
    const r = validateMetrics(item, options.atLeastOneAsServed?.[i]);
    const prefix = Array.isArray(doc) ? `[${i}]` : "";
    if (!r.valid) {
      errors.push(...r.errors.map((e) => `${prefix}${e}`));
    }
    // Advisory findings are collected whether or not the entry validated:
    // they describe the declaration, they do not judge it.
    warnings.push(...r.warnings.map((w) => `${prefix}${w}`));
  });

  // Note on out-of-range values: the draft says a consumer encountering a
  // value outside a member's stated range (e.g. a negative energy-consumption)
  // SHOULD treat that member as not reported rather than reject the object —
  // so no negative-value rejection happens here; that treatment lives in
  // sentinel.ts (the legacy-compatibility module).

  // Draft §Payload Format: array entries MUST be in ascending order of
  // reporting-period, MUST NOT overlap, and MUST share the same period
  // precision and the same target value; target-type MUST be present in every
  // object with the same value or absent from all.
  if (Array.isArray(doc) && doc.length > 1 && errors.length === 0) {
    const entries = doc as SustainabilityMetrics[];
    const periods = entries.map((m) => String(m["reporting-period"] ?? ""));
    if (new Set(periods.map((p) => p.length)).size > 1) {
      errors.push("array entries mix reporting-period precisions");
    }
    for (let i = 1; i < periods.length; i++) {
      if (periods[i] <= periods[i - 1]) {
        errors.push(
          `array entries not strictly ascending by reporting-period at [${i}] ("${isolate(periods[i])}" after "${isolate(periods[i - 1])}")`,
        );
        break;
      }
    }
    // target is mandatory (schema-gated above), so compare the actual values.
    if (new Set(entries.map((m) => m.target)).size > 1) {
      errors.push("array entries carry differing target values");
    }
    // target-type is ALL-OR-NONE across an array: "present in every object
    // with the same value or absent from all" — mixed presence is invalid,
    // not just mixed values.
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
    super(`Sustainability declaration failed validation:\n - ${errors.join("\n - ")}`);
    this.name = "ValidationError";
  }
}

export function assertValid(doc: unknown): SustainabilityDocument {
  const r = validateDocument(doc);
  if (!r.valid) throw new ValidationError(r.errors);
  return doc as SustainabilityDocument;
}
