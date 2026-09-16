/**
 * Canonical types for the `/.well-known/sustainability-data` data model.
 *
 * These mirror draft-besleaga-sustainability-wellknown (the current revision). Field names use
 * the wire (kebab-case) spelling so a `SustainabilityMetrics` object serializes
 * directly to a conformant payload.
 */

export type Capabilities = "basic" | "extended";
export type EnergyUnit = "Wh" | "kWh" | "MWh" | "GWh";
export type CarbonUnit = "gCO2e" | "kgCO2e" | "mtCO2e";
export type CarbonAccounting = "location-based" | "market-based";

/**
 * Values of the optional `target-type` member (draft -04, §Optional Response
 * Fields): a hint classifying the reporting subject named by `target`.
 * Single source of truth — the schema enum, the normalizer, and `fromWire`
 * all check against this list.
 */
export const TARGET_TYPES = [
  "origin",
  "path",
  "organization",
  "service",
  "product",
  "device",
  "tenant",
  "data-source",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/**
 * One declaration object (draft §"Payload Format"). The member set is CLOSED:
 * -07 removed the `version` member, forbids any other top-level member, and
 * gives publisher-defined data its own home in `extensions`.
 */
export interface SustainabilityMetrics {
  // Mandatory (seven members since -07)
  updated: string;
  capabilities: Capabilities;
  provider: string;
  "measurement-method": string;
  "methodology-uri": string;
  "reporting-period": string;
  /** Reporting subject: origin host, path prefix, entity, product, … (free-form). */
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
  "functional-unit"?: string;
  "carbon-intensity-gCO2e-per-kWh"?: number;
  "estimated-annual-emissions-kgCO2e"?: number;
  "renewable-energy"?: number;
  "verifiable-attestation-uri"?: string;
  "disclosure-uri"?: string;
  /** Hint classifying the kind of subject named by `target` (draft -04). */
  "target-type"?: TargetType;
  /** Declarations this object's figures derive from (draft §Upstream Declarations). */
  upstream?: UpstreamEntry[];
  /** Publisher-defined data, keyed by absolute URI (draft §Extensions). */
  extensions?: Extensions;
  /**
   * JWS Compact Serialization over this object without `signed` (draft
   * §Signing). Emitted last, and only when the publisher is configured with a
   * signing key.
   */
  signed?: string;
}

/**
 * One entry of the `upstream` array: the declaration of a provider this
 * object's figures derive from, with an OPTIONAL role token
 * (`hosting`, `cloud`, `cdn`, `network`, `electricity`, …).
 */
export interface UpstreamEntry {
  /** Absolute "https" URI of that provider's declaration. */
  declaration: string;
  role?: string;
}

/**
 * The `extensions` member: an object whose keys are absolute URIs (RFC 3986,
 * Section 4.3 — scheme ":" hier-part [ "?" query ], with no fragment) and whose
 * values are objects. The draft names two forms: an "https" URI, which should
 * identify human-readable documentation but is NEVER dereferenced, and
 * `urn:uuid:` followed by a lowercase UUID. The key identifies the party that
 * defined the members of its value; nothing is ever fetched from it.
 */
export type Extensions = Record<string, Record<string, unknown>>;

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

/**
 * Numeric metric members. A declaration object MUST carry at least one of
 * these or at least one evidence link (draft §Value Constraints and Omitted
 * Metrics); `util.ts`'s `hasReportableContent` applies the rule.
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

/** Either a single object or an array (trend), per the draft root schema. */
export type SustainabilityDocument = SustainabilityMetrics | SustainabilityMetrics[];

/**
 * Loosely-typed metrics emitted by a {@link SourceAdapter}. The normalizer turns
 * this into a strict {@link SustainabilityMetrics}. Adapters supply whatever they
 * have; the normalizer fills units, computes carbon from energy×intensity when
 * carbon is absent, and applies defaults.
 */
export interface RawMetrics {
  provider: string;
  measurementMethod: string;
  methodologyUri: string;
  /** RFC 3339 period: "YYYY", "YYYY-MM", or "YYYY-MM-DD". */
  reportingPeriod: string;

  /** Supply energy as a value+unit, or as raw joules (converted to kWh). */
  energy?: { value: number; unit: EnergyUnit };
  energyJoules?: number;

  /** Supply carbon directly, or omit and provide carbonIntensity to compute it. */
  carbon?: { value: number; unit: CarbonUnit };
  /** gCO2e per kWh; used to derive carbon when `carbon` is absent. */
  carbonIntensity?: number;

  capabilities?: Capabilities;
  updated?: string;
  /**
   * Emitted as the mandatory `target` member: the free-form reporting subject
   * of the metrics (origin host, path prefix, entity, product, …). Adapters
   * that scope a response to a requested `query.target` MUST set this to the
   * matched prefix. When absent, the normalizer falls back to
   * {@link NormalizeOptions.target}.
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
  functionalUnit?: string;
  estimatedAnnualEmissionsKg?: number;
  renewableEnergy?: number;
  verifiableAttestationUri?: string;
  /** URI of a disclosure index (e.g. a Green Web Foundation carbon.txt file). */
  disclosureUri?: string;
  /**
   * Emitted as the optional `target-type` member: a hint classifying the kind
   * of subject named by `target` (draft -04, §Optional Members). Must
   * be one of {@link TARGET_TYPES}; the normalizer fails loudly on anything
   * else. When absent, {@link NormalizeOptions.targetType} is the fallback.
   */
  targetType?: TargetType;

  /**
   * Publisher-defined data, emitted as the `extensions` member: keys are
   * absolute URIs (an "https" URI with a host, or `urn:uuid:` + a lowercase
   * UUID), values are objects. The normalizer rejects any other key.
   */
  extensions?: Extensions;

  /**
   * Emitted as the `upstream` member: the declarations of providers this
   * object's figures derive from. Each `declaration` must be an absolute
   * "https" URI.
   */
  upstream?: UpstreamEntry[];

  /**
   * Members outside the draft's closed set. The -07 declaration object admits
   * no such member, so the normalizer REJECTS anything supplied here and names
   * `extensions` as the place it belongs. Kept as a typed field so an adapter
   * written against -06 fails with that message instead of silently publishing
   * a non-conformant document.
   */
  extra?: Record<string, unknown>;
}

/** Query parameters for the Extended service level (draft §"Extended Query Parameters"). */
export interface ServiceQuery {
  target?: string;
  period?: string;
  granularity?: "daily" | "monthly";
}

/** A pluggable metric source. */
export interface SourceAdapter {
  /** Stable identifier, e.g. "static-file", "kepler-prometheus". */
  readonly name: string;
  /** Whether this adapter honours query parameters (sets `capabilities`). */
  readonly capabilities: Capabilities;
  /** Return one object, or an array for a trend/granularity request. */
  fetch(query: ServiceQuery): Promise<RawMetrics | RawMetrics[]>;
}

export interface NormalizeOptions {
  /**
   * Fallback reporting subject emitted as the mandatory `target` member when
   * the adapter does not set one. For an origin-wide report the origin's host
   * (e.g. "example.com") is RECOMMENDED by the draft.
   */
  target?: string;
  /**
   * Optional `target-type` hint emitted alongside `target` when the adapter
   * does not set one (e.g. "origin" for an origin-wide report). Must be one
   * of {@link TARGET_TYPES}.
   */
  targetType?: TargetType;
  /** Force a target energy unit; default keeps the adapter's unit (kWh for joules). */
  energyUnit?: EnergyUnit;
  /** Force a target carbon unit; default keeps the adapter's unit (gCO2e when computed). */
  carbonUnit?: CarbonUnit;
}
