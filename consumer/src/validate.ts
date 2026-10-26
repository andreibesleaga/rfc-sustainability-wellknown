/**
 * Defensive validation of an incoming declaration. The data just arrived from
 * an arbitrary third-party origin, so it is checked in layers before it is
 * handed to caller code. A JSON Type Definition schema (RFC 8927) checks the
 * form: the seven mandatory members, the closed token sets, the types. The
 * rules no schema states come after it: the exact profile of a date-time (upper
 * case `T` and `Z`, a real date and time), `start` before `end`, non-negative
 * figures, the range of `renewable-energy`, the at-least-one rule, the names in
 * `extensions`, and I-JSON (finite numbers, well-formed strings). What the draft
 * only recommends, or what a consumer ignores, is a warning with a code and
 * never makes a document invalid.
 *
 * The verdict is on the document as served. A document of an earlier revision is
 * read by the compatibility reading (`sentinel.ts`) before it gets here, or is
 * invalid here; an `energy-unit`, `carbon-accounting` or `capabilities` outside
 * its set, a wrong type and a negative figure are invalid in both cases.
 */
import Ajv, { ErrorObject, ValidateFunction } from "ajv/dist/jtd";
import { domainToASCII } from "node:url";
import { compareDateTimes, dateTimeError, hasLeapSecond, isFullDate, isOnDayBoundaries, Period } from "./period";
import { RESPONSE_JTD_SCHEMA } from "./schema";
import { isolate } from "./text";
import type { SustainabilityDocument } from "./types";

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
  /** A member the draft does not define: a consumer ignores it. */
  | "unknown-member"
  /** A URI-valued member is not a URI reference. */
  | "uri-not-a-reference"
  /** The scopes accompany `carbon-footprint` and do not account for it. */
  | "scopes-do-not-account-for-footprint"
  /** A host-shaped `target` is written in U-label form; the draft writes the A-label. */
  | "origin-u-label"
  /** `provider` holds a contact address that does not look like a role. */
  | "provider-personal-contact";

export interface ValidationWarning {
  code: WarningCode;
  message: string;
}

export interface ValidationResult {
  /**
   * True when the declaration carries NO errors. `warnings` never influence
   * it: a warning is an advisory finding about an object that is valid and
   * usable, and callers (the gateway among them) treat `valid === false` as a
   * hard failure.
   */
  valid: boolean;
  errors: string[];
  warnings: ValidationWarning[];
}

/**
 * The URI-valued members other than `upstream[].declaration`: URI references
 * (draft -10 §URI-Valued Members), resolved against the retrieval URI.
 */
export const URI_MEMBERS = ["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"] as const;

/** Every top-level member the draft defines, as the schema lists them. */
export const KNOWN_MEMBERS: readonly string[] = [
  ...Object.keys(RESPONSE_JTD_SCHEMA.properties),
  ...Object.keys(RESPONSE_JTD_SCHEMA.optionalProperties),
];

/**
 * The numeric metric members. Draft -10 §Optional Members: an object MUST carry
 * at least one of these, or at least one of `disclosure-uri` and
 * `verifiable-attestation-uri`.
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
 * Gross-quantity members that MUST NOT be negative (draft -10 §Optional
 * Members). Scopes are deliberately absent: they MAY be negative to convey
 * removals under net accounting. `renewable-energy` has its own range.
 */
const NON_NEGATIVE_FIELDS = [
  "energy-consumption",
  "carbon-footprint",
  "sci-score",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
] as const;

/** Local parts of an address in `provider` that name a role, not a person (draft -10 §Privacy Considerations). */
const ROLE_ADDRESSES = ["sustainability", "sustain", "esg", "ops", "compliance", "contact", "info", "admin", "support", "security"];

// The characters a URI holds (RFC 3986): the unreserved and reserved characters,
// and "%" only as a percent-encoded octet. No space, no control character, no
// non-ASCII character, and none of " < > \ ^ ` { | }.
const URI_CHAR = "(?:[!#$&'()*+,\\-./0-9:;=?@A-Z\\[\\]_a-z~]|%[0-9A-Fa-f]{2})";
const SCHEME = "[A-Za-z][A-Za-z0-9+.-]*";
const URI_RE = new RegExp(`^${SCHEME}:${URI_CHAR}*$`);
const URI_REFERENCE_RE = new RegExp(`^${URI_CHAR}*$`);
const SCHEME_ONLY_RE = new RegExp(`^${SCHEME}$`);

/**
 * Whether `value` is a URI reference (RFC 3986, Section 4.1): a URI, or a
 * relative reference. Syntax only; nothing is resolved or retrieved.
 */
export function isUriReference(value: string): boolean {
  if (!URI_REFERENCE_RE.test(value)) return false;
  // A colon before the first "/", "?" or "#" ends a scheme, which must then be one (Section 4.2).
  const end = value.search(/[:/?#]/);
  return end === -1 || value[end] !== ":" || SCHEME_ONLY_RE.test(value.slice(0, end));
}

/**
 * Why `key` is not a usable `extensions` member name, or `undefined` when it is
 * one. The rule (draft -10 §Extensions): a URI, so a scheme, a colon and the
 * characters RFC 3986 allows; no other form is required, and no scheme, letter
 * case or fragment is excluded. Names are compared as strings and never
 * normalized, and never dereferenced.
 */
export function extensionNameError(key: string): string | undefined {
  if (typeof key !== "string" || key === "") {
    return "is empty; an extension name is a URI (draft, Extensions)";
  }
  if (/[\s\x00-\x1f\x7f]/.test(key)) {
    return "contains whitespace or a control character; an extension name is a URI (draft, Extensions)";
  }
  if (/[^\x21-\x7e]/.test(key)) {
    return "is not ASCII; an extension name is a URI, which RFC 3986 writes in ASCII (draft, Extensions)";
  }
  if (!URI_RE.test(key)) {
    return (
      "is not a URI: it begins with a scheme and a colon (for example " +
      '"https://example.com/extensions/water" or "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845") ' +
      "and holds only the characters RFC 3986 allows (draft, Extensions)"
    );
  }
  return undefined;
}

/** Whether `key` is a usable `extensions` member name (draft -10 §Extensions). */
export function isExtensionName(key: string): boolean {
  return extensionNameError(key) === undefined;
}

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

/** `JSON.stringify` of a value from the document, isolated for display next to other text. */
const shown = (value: unknown): string => isolate(JSON.stringify(value));

/** Digits after the decimal point in the shortest form of `n`. */
function decimals(n: number): number {
  const [mantissa, exponent] = n.toExponential().split("e");
  return Math.max(0, (mantissa.split(".")[1] ?? "").length - Number(exponent));
}

/**
 * Every number in the value is finite, and every string and member name is
 * well-formed (no unpaired surrogate): the I-JSON a publisher emits (draft -10
 * §Body). A number beyond binary64 reaches here as an infinity when the body was
 * parsed with `JSON.parse`; `json.ts` refuses it earlier.
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
      if (!key.isWellFormed()) errors.push(`${path}/${isolate(key)} is a member name with an unpaired surrogate (RFC 7493, Section 2.1)`);
      ijsonErrors(item, `${path}/${isolate(key)}`, errors);
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
    errors.push(`/period/start must be before /period/end, compared as instants (got ${start} and ${end})`);
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

/**
 * Whether an object satisfies the at-least-one rule: "A declaration object
 * MUST carry at least one numeric metric member or at least one of
 * `disclosure-uri` and `verifiable-attestation-uri`" (draft -10 §Optional
 * Members). `upstream` and `extensions` do not count as evidence. A number that
 * is not finite is not a figure the object carries.
 */
export function carriesAtLeastOne(obj: unknown): boolean {
  if (!isRecord(obj)) return false;
  if (METRIC_MEMBERS.some((m) => typeof obj[m] === "number" && Number.isFinite(obj[m]))) return true;
  return ["disclosure-uri", "verifiable-attestation-uri"].some((m) => typeof obj[m] === "string" && obj[m] !== "");
}

function figureChecks(rec: Record<string, unknown>, errors: string[], warnings: ValidationWarning[]): void {
  for (const field of NON_NEGATIVE_FIELDS) {
    const v = rec[field];
    if (typeof v === "number" && v < 0) errors.push(`/${field} must not be negative (got ${v}); omit a metric that is not reported`);
  }
  const renewable = rec["renewable-energy"];
  if (typeof renewable === "number" && (renewable < 0 || renewable > 100)) {
    errors.push(`/renewable-energy must be between 0 and 100 inclusive (got ${renewable})`);
  }
  // "sci-score ... functional-unit, which MUST then be present." JTD cannot express dependencies.
  if (rec["sci-score"] !== undefined && rec["functional-unit"] === undefined) {
    errors.push("/sci-score requires functional-unit to be present");
  }
  if (!carriesAtLeastOne(rec)) {
    errors.push("/ carries no numeric metric member and neither disclosure-uri nor verifiable-attestation-uri (draft, Optional Members)");
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

/**
 * True when `value` reads as a host name: no whitespace or "/", and a "." with at least one character on each
 * side. Written without a regular expression so the check stays linear on any input.
 */
function isHostShaped(value: string): boolean {
  if (/[\s/]/.test(value)) return false;
  const dot = value.indexOf(".", 1);
  return dot > 0 && dot < value.length - 1;
}

/** The A-label form of a host-shaped `target` written with non-ASCII characters, "" when it has none, `undefined` otherwise. */
function aLabelOf(target: string): string | undefined {
  if (!isHostShaped(target) || !/[^\x00-\x7f]/.test(target)) return undefined;
  return domainToASCII(target);
}

function textChecks(rec: Record<string, unknown>, errors: string[], warnings: ValidationWarning[]): void {
  if (rec["provider"] === "") errors.push("/provider must not be empty");
  if (rec["target"] === "") errors.push("/target must not be empty (it names what the object is about)");
  if (typeof rec["provider"] === "string") {
    // One linear pass: words split on the characters an address cannot contain, then each `local@domain` pair
    // inside a word, left to right and non-overlapping, exactly as the former regular expression matched.
    for (const word of rec["provider"].split(/[\s()<>,;]+/)) {
      const parts = word.split("@");
      for (let i = 0; i + 1 < parts.length; i += 1) {
        const local = parts[i];
        if (!local || !parts[i + 1]) continue;
        i += 1;
        if (!ROLE_ADDRESSES.includes(local.toLowerCase())) {
        warnings.push({
          code: "provider-personal-contact",
          message: `/provider holds the address ${isolate(`${local}@…`)}; a role address is better than a personal one (draft, Privacy Considerations)`,
        });
        }
      }
    }
  }
  const target = rec["target"];
  if (typeof target === "string") {
    if (rec["target-type"] === "path" && !target.startsWith("/")) {
      errors.push(`/target ${shown(target)} has target-type path, so it begins with "/"`);
    }
    const alabel = aLabelOf(target);
    if (alabel !== undefined) {
      warnings.push({
        code: "origin-u-label",
        message: `/target ${shown(target)} is a host in U-label form; the draft writes an internationalized host in A-label form${alabel ? `: ${shown(alabel)}` : ""}`,
      });
    }
  }
}

function linkChecks(rec: Record<string, unknown>, errors: string[], warnings: ValidationWarning[]): void {
  const notReference = (path: string, value: unknown) =>
    warnings.push({
      code: "uri-not-a-reference",
      message: `${path} is not a URI reference (got ${shown(value)}); it is kept, and this consumer never dereferences it`,
    });
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
  // Draft -10 §Extensions: the member names of `extensions` are URIs, and its values are objects. JTD cannot constrain the names.
  const extensions = rec["extensions"];
  if (isRecord(extensions)) {
    for (const [key, value] of Object.entries(extensions)) {
      const why = extensionNameError(key);
      if (why !== undefined) errors.push(`/extensions/${isolate(key)} ${why}`);
      if (!isRecord(value)) errors.push(`/extensions/${isolate(key)} must be a JSON object`);
    }
  }
}

/** The members of the object, of `period` and of the `upstream` entries that the draft does not define: ignored by a consumer, and worth a note. */
function unknownMembers(rec: Record<string, unknown>): { path: string; name: string }[] {
  const found = Object.keys(rec).filter((name) => !KNOWN_MEMBERS.includes(name)).map((name) => ({ path: "", name }));
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

// What a document of an earlier revision gets as a hint: how it is read, and the value that is not.
function olderFormHint(obj: Record<string, unknown>): string | undefined {
  const period = obj.period;
  const reading =
    "this consumer reads that form in compatibility mode (legacyCompat, the default) when it names a date, and finds it invalid as served";
  if ("reporting-period" in obj && period === undefined) {
    return `/reporting-period ${shown(obj["reporting-period"])} is the -08 form of the period; ${reading}`;
  }
  if (isRecord(period) && (isFullDate(period.start) || isFullDate(period.end))) {
    return `/period holds ${shown(period.start)} and ${shown(period.end)}, the -09 form of two full-dates; ${reading}`;
  }
  return undefined;
}

/**
 * Validate one declaration object: the JTD schema first, then the rules it
 * cannot state. An unknown member is a warning, since a consumer ignores it.
 */
function validateObjectRules(obj: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: ValidationWarning[] = [];

  if (!validateObject(obj)) {
    for (const e of validateObject.errors ?? []) {
      errors.push(schemaErrorMessage(e));
    }
    const hint = isRecord(obj) ? olderFormHint(obj) : undefined;
    if (hint !== undefined) errors.push(hint);
    return { valid: false, errors, warnings };
  }

  const rec = obj as Record<string, unknown>;
  ijsonErrors(rec, "", errors);
  dateTimeChecks(rec, errors, warnings);
  figureChecks(rec, errors, warnings);
  textChecks(rec, errors, warnings);
  linkChecks(rec, errors, warnings);
  for (const { path, name } of unknownMembers(rec)) {
    warnings.push({
      code: "unknown-member",
      message: `${path}/${isolate(name)} is not a member the draft defines; this consumer ignores it`,
    });
  }
  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Validate a full declaration: one object or an array of them. The objects of
 * an array are validated one by one; their periods and targets may differ and
 * overlap, and no order is required of the body (draft -10 §Body). An empty
 * array is a valid body. `valid` reflects errors ONLY.
 */
export function validateDocument(doc: unknown): ValidationResult {
  // Draft -10 §Body: "whose value is one declaration object or one JSON array
  // of them". Said plainly here, rather than left to the schema gate to report
  // as a member-shaped error about a number or a string.
  if (typeof doc !== "object" || doc === null) {
    return {
      valid: false,
      errors: [
        `the top-level value is ${doc === null ? "null" : `a JSON ${typeof doc}`}, so the body is not a declaration: ` +
          "a declaration is one declaration object or an array of them",
      ],
      warnings: [],
    };
  }
  const items = Array.isArray(doc) ? doc : [doc];
  const result: ValidationResult = { valid: true, errors: [], warnings: [] };
  items.forEach((item, i) => {
    const r = validateObjectRules(item);
    const prefix = Array.isArray(doc) ? `[${i}]` : "";
    result.errors.push(...r.errors.map((e) => `${prefix}${e}`));
    // Advisory findings are collected whether or not the entry validated: they describe the declaration, they do not judge it.
    result.warnings.push(...r.warnings.map((w) => ({ ...w, message: `${prefix}${w.message}` })));
  });
  result.valid = result.errors.length === 0;
  return result;
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
