/** Wire-format types for a declaration (draft -10 §Body, §Mandatory Members, §Optional Members). */
import { MediaTypeClassification } from "./media-type";
import type { KeyTrust, PublicJwk, SigningAlg } from "./jws";
import type { Period } from "./period";
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

export type {
  Capabilities,
  CarbonAccounting,
  CarbonUnit,
  EnergyUnit,
  FunctionalUnit,
  Granularity,
  MeasurementMethod,
  TargetType,
  UpstreamRole,
};

/**
 * Outcome of checking the OPTIONAL embedded signature, the `signed` member of
 * a declaration object (draft -10 §The signed Member, §Verifying a Signature).
 * Exactly the draft's vocabulary:
 *
 *  - `unsigned`: the member is absent. That means only that the publisher did
 *    not sign; it MUST NOT be read as evidence about the declaration.
 *  - `verified`: the JWS verified under the consumer's own algorithm policy
 *    and the key named below. It establishes integrity and, with a held key,
 *    continuity of authorship; it says nothing about WHO holds the key, and it
 *    never says anything about the accuracy of a figure. It protects the other
 *    members of its own object, not the array around it, the HTTP header
 *    fields or the retrieval URI.
 *  - `unverified`: the member is present and did not verify. The object is
 *    then treated as unverified, never as false, and MUST NOT be presented
 *    downstream as verified.
 *
 * `keyTrust` says how far the key is trusted, and `precedence` what that
 * means for the members (draft -10 §Verifying a Signature):
 *
 *  - `out-of-band`: a key the caller supplied independently of the
 *    declaration, never from a URI the declaration or its header names;
 *  - `pinned`: a key the caller kept from an earlier retrieval (continuity of
 *    authorship, not identity);
 *  - `x5c-anchored`: the header's `x5c` chain validated to an anchor the caller
 *    trusts, with an end-entity certificate that identifies the publisher's
 *    host;
 *  - `declaration-only`: any other key, trusted no further than the
 *    declaration carrying it.
 *
 * The payload's members take precedence over the members around them for the
 * first three; for `declaration-only` the members SERVED BY THE ORIGIN remain
 * the ones in use, because whoever can publish the declaration can publish a
 * key. `provider` is never matched against a key or a certificate: the holder
 * of the key signed that name, which is not saying the name is the holder's.
 */
export type SignatureResult =
  | { status: "unsigned" }
  | {
      status: "verified";
      /** The identifier the header carries. */
      alg: SigningAlg;
      /** True when that identifier is `EdDSA`, which RFC 9864 replaces with `Ed25519`; the key and the signature are the same. */
      deprecatedAlg?: true;
      kid?: string;
      /** The RFC 7638 thumbprint of the key the signature verified under: the holder of this key signed. */
      thumbprint: string;
      publicJwk: PublicJwk;
      keyTrust: KeyTrust;
      /**
       * Which members the consumer used, and therefore which members the
       * caller is looking at in `document`: `"payload"` for an out-of-band,
       * pinned or x5c-anchored key, `"origin"` for `declaration-only`. It is
       * derived from `keyTrust` and stated separately because it, not the
       * trust level, is what a caller needs to know to read `document`.
       */
      precedence: "payload" | "origin";
      /** The verified payload type, in the prefix-omitted form the draft writes; the full form names the same type and verifies. */
      cty: string;
      /** True when the plain members differed from the signed payload (a warning, not a failure). */
      modifiedAfterSigning: boolean;
      /** The member paths at which they differed. Only set when `modifiedAfterSigning`. */
      modifiedMembers?: string[];
      /**
       * An older signed object than one the caller holds for the same target,
       * period, accounting method and functional unit: the later `updated` the
       * caller holds, and this object's. Nothing shows that no newer object
       * exists, and nothing here shows that this one is the newest.
       */
      replaySuspected?: { heldUpdated: string; updated: string };
    }
  | {
      /**
       * `reason` is one of the JWS-level codes ({@link VerifyReason}:
       * `alg-none`, `mac-alg`, `alg-rejected`, `cty-missing`, `cty-wrong`,
       * `crit-unknown`, `no-key`, `private-key-in-header`, `key-alg-mismatch`,
       * `pin-mismatch`, `invalid-signature`, `malformed`) or one of the two
       * payload codes:
       *
       *  - `payload-not-declaration`: the payload is not a JSON object that
       *    validates as a declaration object, or itself carries `signed`;
       *  - `payload-subject-mismatch`: the payload's `target`, `period.start`,
       *    `period.end`, `carbon-accounting` or `functional-unit` differs from
       *    the object's, compared as strings with a member absent from both
       *    counting as equal, so the two describe different things.
       *
       * `pin-mismatch` means the declaration carries a key other than the one
       * the caller holds for the origin: the embedded key is not accepted.
       */
      status: "unverified";
      reason: string;
      detail?: string;
      alg?: SigningAlg;
      kid?: string;
    };

/** One entry of the OPTIONAL `upstream` member (draft -10 §Upstream Declarations). */
export interface UpstreamEntry {
  /** URI reference to the provider's own declaration, resolved against the retrieval URI. */
  declaration: string;
  /** One of the six role tokens, or absent. */
  role?: UpstreamRole;
  [key: string]: unknown;
}

export interface SustainabilityMetrics {
  updated: string;
  capabilities: Capabilities;
  provider: string;
  "measurement-method": MeasurementMethod;
  "methodology-uri": string;
  /** Start included, end excluded: two RFC 3339 date-times, `start` before `end`. */
  period: Period;
  /**
   * What the object is about: an opaque identifier of the entity or scope the
   * metrics are attributed to (origin host, path prefix, organization,
   * product, device, tenant, data source). Compared as a string.
   */
  target: string;
  /** Optional; when `energy-unit` is absent the value is in kWh. */
  "energy-consumption"?: number;
  "energy-unit"?: EnergyUnit;
  /** Optional; when `carbon-unit` is absent the value is in gCO2e. */
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
  /** The declarations this object's figures derive from (draft -10 §Upstream Declarations). */
  upstream?: UpstreamEntry[];
  /**
   * Members defined outside the draft, keyed by an extension name, which is a
   * URI (RFC 3986, Section 3) compared as a string (draft -10 §Extensions). A
   * consumer that does not implement a name's definition ignores the value;
   * this package never dereferences a name or executes anything within a value.
   */
  extensions?: Record<string, Record<string, unknown>>;
  /** A JWS Compact Serialization over this object without `signed` (draft -10 §The signed Member). */
  signed?: string;
  // A consumer ignores a top-level member it does not recognize (draft -10
  // §Body), so the index signature stays: such a member round-trips and is
  // reported as the `unknown-member` warning.
  [key: string]: unknown;
}

/** The body is one declaration object or an array of them; an empty array is a valid body (draft -10 §Body, §Query Parameters). */
export type SustainabilityDocument = SustainabilityMetrics | SustainabilityMetrics[];

/**
 * The query parameters of draft -10 §Query Parameters. `start` and `end` are
 * written in UTC with the offset `Z`; a server may ignore any of them.
 */
export interface FetchParams {
  target?: string;
  start?: string;
  end?: string;
  granularity?: Granularity;
}

/**
 * One upstream declaration compared with the subject's own figures
 * (draft -10 §Evidence and Upstream Consistency; opt in with `followUpstream`).
 *
 * The verdict is EVIDENCE ABOUT CONSISTENCY BETWEEN TWO SELF-ASSERTED CLAIMS,
 * never proof of either: both figures are published by their own publisher and
 * nothing here verifies a measurement.
 *
 * WHERE THE COMPARISON IS DEFINED (draft -10 §Evidence and Upstream Consistency): only
 * where the upstream publishes a declaration about what it delivers to THIS
 * subject — one whose `target-type` is `tenant`. For the same
 * period, and after conversion to a single unit, "a subject whose
 * declared scope covers what that upstream delivers cannot report less energy,
 * or fewer emissions, than the upstream states it delivered". That is "the
 * only relation defined", and it "is deliberately loose": no member carries
 * the share of the subject's figures attributable to one upstream, so the
 * converse cannot be checked. Where an upstream publishes only its own totals
 * "rather than a tenant-scoped declaration, no relation is defined at all",
 * and the declaration is reported as fetched but `not-comparable`.
 *
 * The compared members are `energy-consumption` and `carbon-footprint`, those
 * two and no other. `carbon-footprint` is compared "only where both objects
 * declare the same `carbon-accounting` value or neither declares one" —
 * see {@link UpstreamComparison.carbonComparison}.
 *
 * ONE ENTRY AT A TIME: "each `upstream` entry is compared on its own, and no
 * relation is defined over several of them together". There is one of these
 * per entry, and a list of them is a list of independent findings, never a
 * statement about the subject's upstreams taken together.
 *
 *  - `consistent` — the upstream is tenant-scoped and the subject's own total
 *    for the period is at least what the upstream states it delivered to the
 *    tenant, so the subject reports no less than its own provider says it
 *    supplied.
 *  - `under-reported` — the subject's own total for the period is LESS than
 *    what the upstream states it delivered to that tenant: the subject reports
 *    less than its own provider says it supplied, which is an inconsistency
 *    between two self-asserted claims and nothing more. It is NOT a
 *    non-conformance: whether the subject's declared scope covers this
 *    upstream is not expressible in the format, so a subject that legitimately
 *    excludes one reads the same way, and the finding is something to
 *    investigate rather than a failure to conform. The `detail` string says so
 *    in plain words.
 *  - `not-comparable` — the upstream declaration was fetched but no arithmetic
 *    relation is defined for it (it is not `target-type: tenant`), or the two
 *    share no metric, or the only shared metric was `carbon-footprint` on
 *    differing accounting bases, or the upstream publishes nothing for that
 *    period.
 *  - `unreachable` — the declaration could not be retrieved (or was refused:
 *    a non-https URI, a loop, the depth limit, or the retrieval budget).
 */
export interface UpstreamComparison {
  /** The `upstream[].declaration` URI as published. */
  declaration: string;
  role?: string;
  /** 1 for a direct upstream of the fetched declaration, up to the depth limit. */
  depth: number;
  verdict: "consistent" | "under-reported" | "not-comparable" | "unreachable";
  /** One sentence of plain text explaining the verdict. */
  detail: string;
  /** The `period` the comparison was made for. */
  period?: Period;
  /** The subject's own figures, normalized to kWh / gCO2e. */
  subject?: { energyKWh?: number; carbonGCO2e?: number };
  /** The upstream's figures for the same period, normalized to kWh / gCO2e. */
  upstreamFigures?: { energyKWh?: number; carbonGCO2e?: number };
  /**
   * The `target-type` of the upstream declaration that was retrieved, when one
   * was. The draft defines the arithmetic comparison only for `tenant`; any
   * other value (or none) is reported here and the verdict is
   * `not-comparable`.
   */
  upstreamTargetType?: string;
  /**
   * The `target` of the upstream declaration that was retrieved — the tenant
   * identifier the upstream itself chose, when the declaration is
   * tenant-scoped.
   */
  upstreamTarget?: string;
  /**
   * Whether `carbon-footprint` took part in the verdict, when both objects
   * reported one (draft -10 §Evidence and Upstream Consistency: it is
   * comparable "only where both objects declare the same `carbon-accounting`
   * value or neither does").
   *
   *  - `compared` — both declare the same basis, or neither declares one, and
   *    the carbon figures took part in the verdict.
   *  - `skipped-different-accounting-basis` — the two disagree, or one
   *    declares a basis and the other does not, so the carbon figures were
   *    left out while the energy comparison proceeded. `detail` names both
   *    bases. When this leaves nothing comparable the verdict is
   *    `not-comparable`.
   *
   * Absent when there was no carbon comparison to make at all — one side or
   * both reported no `carbon-footprint`, or the declaration was never compared
   * (not tenant-scoped, unreachable, wrong period).
   */
  carbonComparison?: "compared" | "skipped-different-accounting-basis";
  /**
   * What the compatibility reading did to the RETRIEVED upstream declaration
   * before comparing it, in the form of `FetchResult.converted` and
   * `FetchResult.disregarded` (for example `"period"`, `"[1].carbon-unit"`):
   * an upstream declaration is read exactly as any other. Each is only set
   * when non-empty, and neither is set with `legacyCompat: false`.
   */
  upstreamConverted?: string[];
  upstreamDisregarded?: string[];
  /** The upstream's own upstreams, walked to the depth limit. */
  upstream?: UpstreamComparison[];
}

/**
 * Per query parameter that was sent, whether the response honored it
 * (draft -10 §Query Parameters): every object received satisfies it. An empty
 * array honors a range. A server may ignore any parameter, and a static file
 * ignores them all.
 */
export interface Honored {
  target?: boolean;
  start?: boolean;
  end?: boolean;
  granularity?: boolean;
}

export type FetchResult =
  | {
      status: "ok";
      document: SustainabilityDocument;
      /**
       * What the response covers: the target and period each object NAMES, in
       * document order. It is built from the objects and never from the
       * request, because "a consumer MUST NOT record a response as covering a
       * period or a target it does not name".
       */
      covers: { target: string; period: Period }[];
      /** Whether the response honored each parameter sent; absent when none was sent. */
      honored?: Honored;
      /**
       * The URL of the final response — after any redirect — which the draft
       * makes the origin the declaration is attributed to (§Mandatory Minimum
       * Supported Service: "MUST attribute the declaration to the origin of
       * the final response").
       */
      url: string;
      etag?: string;
      /** The `Last-Modified` the response carried, kept so a later request can revalidate with `If-Modified-Since`. */
      lastModified?: string;
      /**
       * How the response's `Content-Type` read (draft -10 §Location and
       * Transport): `"sustainability-data+json"` for the registered
       * media type, or `"json"` for the generic type under which declarations
       * published before the registration exist (a consumer MAY process those,
       * and this one does). Any other type is not a declaration and never
       * reaches an `ok` result — see `wrong-media-type`.
       */
      mediaType: MediaTypeClassification;
      /**
       * Advisory findings about the declaration that are NOT validation
       * errors: the declaration is valid and usable. Each is `code: message`;
       * the codes are those of `ValidationWarning` (`unknown-member`,
       * `uri-not-a-reference`, `period-below-day-floor`, ...) and, from the
       * other checks, `modified-after-signing` (the plain members differ from
       * the verified `signed` payload) and `deprecated-alg` (the signature
       * names `EdDSA`). Only set when non-empty.
       */
      warnings?: string[];
      /**
       * True when the compatibility reading changed the document: `converted`
       * or `disregarded` is not empty. Only set with `legacyCompat` on (the
       * default), and then only when true.
       */
      legacy?: boolean;
      /**
       * What the compatibility reading of draft -10 Appendices B.1 and C.1 read
       * in another spelling, as member paths (`"period"`, `"[2].carbon-unit"`,
       * `"[1].functional-unit"`): a -08 `reporting-period` or a -09 `period` of
       * two full-dates read as a -10 period, `mtCO2e` read as `tCO2e`, and a
       * legacy `functional-unit` read as the unit it stands for with its
       * score. Only set when non-empty; never set with `legacyCompat: false`,
       * where a document of an earlier revision is invalid as served.
       */
      converted?: string[];
      /**
       * What the compatibility reading did not use, as member paths: a
       * `measurement-method` outside its set read as `third-party-modeled`, a
       * `functional-unit` that no rule converts removed with its `sci-score`,
       * an upstream `role` or a `target-type` outside its set removed. Only
       * set when non-empty. A defective `energy-unit`, `carbon-accounting` or
       * `capabilities`, a wrong type or a negative figure is not disregarded:
       * the document is invalid.
       */
      disregarded?: string[];
      /**
       * Set when the server answered something OTHER than what was asked for
       * (draft -10 §Query Parameters). "Because a server may ignore any
       * parameter, a consumer MUST compare the period and target of every
       * object it receives with what it requested, and MUST NOT record a
       * response as covering a period or a target it does not name."
       *
       * One human-readable line per mismatch. The declaration itself is still
       * valid and is returned — it simply covers something else, and a caller
       * MUST NOT record it against the request. The same lines appear in
       * `warnings`. Only set when non-empty.
       */
      notAsRequested?: string[];
      /**
       * Set ONLY when the final response came from a DIFFERENT origin than the
       * one queried. Such a declaration is a claim by that other origin, and
       * this consumer does not record it as a declaration of the origin it
       * queried unless the object's `target` names that origin.
       *
       * `url` already names the final origin, which the declaration is
       * attributed to. This field is the distinct signal that the attribution
       * moved: `attributable` says whether the caller may nevertheless record
       * the declaration against the origin it queried, which it may only when
       * every object's `target` names that origin.
       */
      redirectedAcrossOrigins?: {
        /** The origin the consumer queried. */
        queried: string;
        /** The origin of the final response, which the declaration is attributed to. */
        final: string;
        /** True only when every object's `target` names the queried origin. */
        attributable: boolean;
      };
      /**
       * Present only when `verifySignature` was requested: one outcome per
       * declaration object, in document order (a single object yields one
       * entry). See {@link SignatureResult}.
       */
      signatures?: SignatureResult[];
      /**
       * Present only when `followUpstream` was requested: one comparison per
       * `upstream[]` entry of the first declaration object, nested to the
       * draft's depth limit of three. See {@link UpstreamComparison}.
       */
      upstream?: UpstreamComparison[];
    }
  | { status: "not-modified" }
  | { status: "not-found" }
  /**
   * The caller required every object signed (`requireSigned`) and at least one
   * is not: `failures` names each, counting objects from 1. The figures are not
   * returned; the per-object outcomes are.
   */
  | {
      status: "signature-required";
      failures: { object: number; status: "unsigned" | "unverified"; reason?: string }[];
      signatures: SignatureResult[];
    }
  | { status: "invalid"; errors: string[] }
  /**
   * The 200 response carried a media type that is not a declaration (draft
   * -10 §Location and Transport: "a response carrying any other media type is
   * not a declaration").
   * Only `application/sustainability-data+json` and the generic
   * `application/json` are processed; anything else — including a missing
   * `Content-Type` — is refused without parsing the body.
   */
  | { status: "wrong-media-type"; mediaType: string | null }
  | { status: "http-error"; httpStatus: number }
  | { status: "timeout"; timeoutMs: number }
  | { status: "too-large"; detail: string }
  /**
   * The body held more declaration objects than this consumer accepts. The
   * draft tells the consumer to bound what it accepts itself: "A consumer
   * MUST limit the bytes and objects it accepts and treat an excess as an
   * error" (§Security Considerations).
   */
  | { status: "too-many-objects"; count: number; max: number }
  /**
   * The declaration was NOT retrieved over HTTPS, so it was refused without
   * being used. Draft -10 §Location and Transport: a declaration MUST be
   * published and retrieved over HTTPS; this consumer refuses one retrieved
   * over unauthenticated HTTP, and requires HTTPS on every hop of a redirect.
   * Returned both for the requested URL and for an `http:` FINAL url after a
   * redirect; `url` names the offending one. Opt out with
   * `allowInsecure: true` (development and CI against a local origin only).
   */
  | { status: "insecure-transport"; url: string; detail: string }
  /**
   * A redirect chain of more than five hops, or one that loops. Nothing is
   * read from the last response; `url` is the hop that was not followed.
   */
  | { status: "too-many-redirects"; url: string; detail: string }
  /**
   * This consumer DECLINED TO DEREFERENCE the URI, before contacting it. Not a
   * failure of the origin — nothing was sent to it — but a rule this consumer
   * applies to a URI it was handed (draft -10 §Security Considerations: a
   * consumer SHOULD refuse a loopback, private, or link-local address at every
   * connection it makes, redirects included).
   *
   *  - `blocked-address` — the host is, or resolves to, an address that is not
   *    public unicast: loopback, private (RFC 1918), link-local, unique-local,
   *    unspecified, carrier-grade NAT, reserved, multicast, broadcast, or the
   *    NAT64, 6to4 or Teredo form of one of those. Applies to
   *    the requested URL and to every redirect hop alike, so an origin cannot
   *    answer honestly and then point inward. Override with
   *    `allowPrivateAddresses` (`allowInsecure` permits loopback only, for a
   *    local test server), and pin what a name resolves to with `lookup`.
   *  - `userinfo-in-uri` — the URI carried credentials in its authority. A
   *    declaration is public, unauthenticated data, so a URI in one has no
   *    reason to carry any; there is no override.
   *
   * `detail` names the offending address or the reason in plain words.
   */
  | {
      status: "refused-uri";
      reason: "blocked-address" | "userinfo-in-uri";
      url: string;
      detail: string;
    };
