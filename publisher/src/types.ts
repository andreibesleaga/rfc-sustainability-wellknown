/**
 * Canonical types for the `/.well-known/sustainability-data` data model.
 *
 * These mirror draft-besleaga-sustainability-wellknown (the current revision). Field names use
 * the wire (kebab-case) spelling so a `SustainabilityMetrics` object serializes
 * directly to a conformant payload. The closed token sets and their types are
 * in `tokens.ts`.
 */
import type { Period, PeriodInput } from "./period";
import type {
  Capabilities,
  CarbonAccounting,
  CarbonUnit,
  EnergyUnit,
  FunctionalUnit,
  Granularity,
  MeasurementMethod,
  TargetType,
  UpstreamRole,
} from "./tokens";

/**
 * One declaration object (draft §Mandatory Members and §Optional Members). A
 * publisher adds no top-level member the draft does not define; data of its own
 * goes in `extensions`.
 */
export interface SustainabilityMetrics {
  // Mandatory (seven members)
  updated: string;
  capabilities: Capabilities;
  provider: string;
  "measurement-method": MeasurementMethod;
  "methodology-uri": string;
  /** Start included, end excluded; two RFC 3339 date-times, `start` before `end`. */
  period: Period;
  /** What the object is about: an origin host, a path prefix, an organization, a product, … (opaque text). */
  target: string;

  // Optional (absence = "not reported"; defaults kWh / gCO2e apply to the units)
  "energy-consumption"?: number;
  "energy-unit"?: EnergyUnit;
  "carbon-footprint"?: number;
  "carbon-unit"?: CarbonUnit;
  "carbon-accounting"?: CarbonAccounting;
  "scope-1"?: number;
  "scope-2"?: number;
  "scope-3"?: number;
  "sci-score"?: number;
  "functional-unit"?: FunctionalUnit;
  "carbon-intensity-gCO2e-per-kWh"?: number;
  "estimated-annual-emissions-kgCO2e"?: number;
  "renewable-energy"?: number;
  "verifiable-attestation-uri"?: string;
  "disclosure-uri"?: string;
  /** Classifies the kind of target named by `target`; it changes neither its syntax nor its comparison. */
  "target-type"?: TargetType;
  /** Declarations this object's figures derive from (draft §Upstream Declarations). */
  upstream?: UpstreamEntry[];
  /** Publisher-defined data, keyed by extension name (draft §Extensions). */
  extensions?: Extensions;
  /**
   * JWS Compact Serialization over this object without `signed` (draft
   * §The signed Member). Emitted last, and only when the publisher is
   * configured with a signing key.
   */
  signed?: string;
}

/**
 * One entry of the `upstream` array: the declaration of a provider this
 * object's figures derive from, with an OPTIONAL role for the six kinds of
 * provider the draft names.
 */
export interface UpstreamEntry {
  /** URI reference to that provider's declaration, resolved against the retrieval URI. */
  declaration: string;
  role?: UpstreamRole;
}

/**
 * The `extensions` member: an object whose member names are extension names and
 * whose values are objects. An extension name is a URI (RFC 3986, Section 3),
 * compared as a string, written as its definer published it, and never
 * dereferenced.
 */
export type Extensions = Record<string, Record<string, unknown>>;

// The characters a URI holds (RFC 3986): the unreserved and reserved characters,
// and "%" only as a percent-encoded octet. No space, no control character, no
// non-ASCII character, and none of " < > \ ^ ` { | }.
const URI_CHAR = "(?:[!#$&'()*+,\\-./0-9:;=?@A-Z\\[\\]_a-z~]|%[0-9A-Fa-f]{2})";
const SCHEME = "[A-Za-z][A-Za-z0-9+.-]*";
const URI_RE = new RegExp(`^${SCHEME}:${URI_CHAR}*$`);
const URI_REFERENCE_RE = new RegExp(`^${URI_CHAR}*$`);

/**
 * Whether `value` is a URI reference (RFC 3986, Section 4.1): a URI, or a
 * relative reference. Syntax only; nothing is resolved or retrieved.
 */
export function isUriReference(value: string): boolean {
  if (!URI_REFERENCE_RE.test(value)) return false;
  // A colon before the first "/", "?" or "#" ends a scheme, which must then be one (Section 4.2).
  const end = value.search(/[:/?#]/);
  return end === -1 || value[end] !== ":" || new RegExp(`^${SCHEME}$`).test(value.slice(0, end));
}

/**
 * Why `key` is not a usable `extensions` member name, or `undefined` when it is
 * one. The rule (draft §Extensions): a URI, so a scheme, a colon and the
 * characters RFC 3986 allows; no other form is required, and no scheme, letter
 * case or fragment is excluded. Names are never normalized.
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

/** Whether `key` is a usable `extensions` member name (draft §Extensions). */
export function isExtensionName(key: string): boolean {
  return extensionNameError(key) === undefined;
}

/**
 * Numeric metric members. A declaration object MUST carry at least one of
 * these or at least one evidence link (draft §Optional Members); `util.ts`'s
 * `hasReportableContent` applies the rule.
 */
export const METRIC_MEMBERS = [
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

/** The two evidence links that can stand in for a metric. */
export const EVIDENCE_MEMBERS = ["disclosure-uri", "verifiable-attestation-uri"] as const;

/**
 * The members of a declaration object that the draft defines: the seven
 * mandatory members and the optional ones. A publisher adds no other.
 */
export const DEFINED_MEMBERS: readonly string[] = [
  "updated",
  "capabilities",
  "provider",
  "measurement-method",
  "methodology-uri",
  "period",
  "target",
  "energy-consumption",
  "energy-unit",
  "carbon-footprint",
  "carbon-unit",
  "carbon-accounting",
  "scope-1",
  "scope-2",
  "scope-3",
  "sci-score",
  "functional-unit",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
  "renewable-energy",
  "target-type",
  "verifiable-attestation-uri",
  "disclosure-uri",
  "upstream",
  "extensions",
  "signed",
];

/** Either a single object or an array, per the draft's root rule. */
export type SustainabilityDocument = SustainabilityMetrics | SustainabilityMetrics[];

/**
 * Loosely-typed metrics emitted by a {@link SourceAdapter}. The normalizer turns
 * this into a strict {@link SustainabilityMetrics}. Adapters supply whatever they
 * have; the normalizer fills units, computes carbon from energy×intensity when
 * carbon is absent, and applies defaults.
 */
export interface RawMetrics {
  provider: string;
  measurementMethod: MeasurementMethod;
  methodologyUri: string;
  /**
   * The period the figures cover: an object with `start` and `end`, two RFC 3339
   * date-times, or a calendar label ("YYYY", "YYYY-MM" or "YYYY-MM-DD") for the
   * whole year, month or day in UTC.
   */
  period: PeriodInput;

  /** Supply energy as a value+unit, or as raw joules (converted to kWh). */
  energy?: { value: number; unit: EnergyUnit };
  energyJoules?: number;

  /** Supply carbon directly, or omit and provide carbonIntensity to compute it. */
  carbon?: { value: number; unit: CarbonUnit };
  /** gCO2e per kWh; used to derive carbon when `carbon` is absent. */
  carbonIntensity?: number;

  capabilities?: Capabilities;
  /** The RFC 3339 date-time of the last update; when absent, the normalizer reads its clock. */
  updated?: string;
  /**
   * Emitted as the mandatory `target` member: what the metrics are about
   * (origin host, path prefix, entity, product, …). When absent, the
   * normalizer falls back to {@link NormalizeOptions.target}.
   */
  target?: string;
  carbonAccounting?: CarbonAccounting;
  /**
   * Unit the scope values are expressed in when no `carbon` measurement is
   * present to carry it (a wire document may declare `carbon-unit` for its
   * scopes without a `carbon-footprint`). Ignored when `carbon.unit` is set.
   */
  carbonUnitHint?: CarbonUnit;
  scope1?: number;
  scope2?: number;
  scope3?: number;
  sciScore?: number;
  functionalUnit?: FunctionalUnit;
  estimatedAnnualEmissionsKg?: number;
  renewableEnergy?: number;
  verifiableAttestationUri?: string;
  /** URI reference to a disclosure index (e.g. a Green Web Foundation carbon.txt file). */
  disclosureUri?: string;
  /**
   * Emitted as the optional `target-type` member. Must be one of the nine
   * tokens of the draft; the normalizer fails loudly on anything else. When
   * absent, {@link NormalizeOptions.targetType} is the fallback.
   */
  targetType?: TargetType;

  /**
   * Publisher-defined data, emitted as the `extensions` member: keys are
   * extension names (URIs), values are objects. The normalizer rejects any
   * other key.
   */
  extensions?: Extensions;

  /**
   * Emitted as the `upstream` member: the declarations of providers this
   * object's figures derive from. Each `declaration` is a URI reference.
   */
  upstream?: UpstreamEntry[];

  /**
   * Members outside the draft's set. A declaration object admits no top-level
   * member the draft does not define, so the normalizer REJECTS anything
   * supplied here and names `extensions` as the place it belongs. Kept as a
   * typed field so an adapter written for an earlier revision fails with that
   * message instead of silently publishing a non-conformant document.
   */
  extra?: Record<string, unknown>;
}

/**
 * The query parameters a publisher can honor (draft §Query Parameters). Every
 * value has already matched its rule in the draft's ABNF; a parameter that did
 * not is absent.
 */
export interface ServiceQuery {
  /** A `target` member value; a path prefix begins with "/". */
  target?: string;
  /** A UTC date-time: the start of the range, included. */
  start?: string;
  /** A UTC date-time: the end of the range, excluded. */
  end?: string;
  granularity?: Granularity;
}

/** A pluggable metric source. */
export interface SourceAdapter {
  /** Stable identifier, e.g. "static-file", "kepler-prometheus". */
  readonly name: string;
  /** Whether this adapter honours query parameters (sets `capabilities`). */
  readonly capabilities: Capabilities;
  /**
   * Return every object the source holds for the query; the publisher selects
   * among them. An adapter may use the query to fetch less, and never computes
   * an aggregate.
   */
  fetch(query: ServiceQuery): Promise<RawMetrics | RawMetrics[]>;
}

export interface NormalizeOptions {
  /**
   * Fallback target emitted as the mandatory `target` member when the adapter
   * does not set one. For an origin-wide report the origin's host (e.g.
   * "example.com") is RECOMMENDED by the draft.
   */
  target?: string;
  /**
   * Optional `target-type` emitted alongside `target` when the adapter does
   * not set one (e.g. "origin" for an origin-wide report).
   */
  targetType?: TargetType;
  /** Force a target energy unit; default keeps the adapter's unit (kWh for joules). */
  energyUnit?: EnergyUnit;
  /** Force a target carbon unit; default keeps the adapter's unit (gCO2e when computed). */
  carbonUnit?: CarbonUnit;
  /**
   * The clock for `updated` when the adapter gives none: returns an RFC 3339
   * date-time with `T` and `Z` in upper case. Default: the current time in
   * whole seconds, UTC.
   */
  clock?: () => string;
}
