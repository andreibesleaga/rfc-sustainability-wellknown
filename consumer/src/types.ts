/** Wire-format types for a Sustainability Declaration (draft -07 §Payload Format). */
import { MediaTypeClassification } from "./media-type";
import type { PublicJwk, SigningAlg } from "./jws";

/**
 * Outcome of checking the OPTIONAL embedded signature — the `signed` member of
 * a declaration object (draft -07 §Signing). Exactly the draft's vocabulary:
 *
 *  - `unsigned` — the member is absent. That means only that the publisher did
 *    not sign; it MUST NOT be read as evidence about the declaration.
 *  - `verified` — the JWS verified under the consumer's own algorithm policy
 *    and the key named below. It establishes integrity and key continuity;
 *    with `keySource: "header"` it says nothing about WHO holds the key, and it
 *    never says anything about the accuracy of a figure.
 *  - `unverified` — the member is present and did not verify. The object is
 *    then treated as unverified, never as false, and MUST NOT be presented
 *    downstream as verified.
 *
 * `modifiedAfterSigning` reports that the members around the signature differ
 * from the signed payload. That is not a verification failure, and what the
 * consumer DOES with the difference depends on `precedence` below: the
 * difference is surfaced as a `modified-after-signing` warning either way.
 *
 * PRECEDENCE IS CONDITIONAL ON KEY TRUST (draft -07 §Verification). The
 * payload's members take precedence over the members around them — the
 * RFC 8414 `signed_metadata` pattern — ONLY where the key was obtained out of
 * band, pinned from an earlier retrieval, or validated through an `x5c` chain
 * to an anchor the consumer already trusts. IN EVERY OTHER CASE the key is
 * trusted no further than the declaration carrying it, the members SERVED BY
 * THE ORIGIN remain the ones the consumer uses and the signature establishes
 * integrity and key continuity only: "letting a self-asserted payload override
 * an origin-authenticated one would let anyone able to add a member replace
 * every figure". The split is on how far the key is trusted, not on where its
 * bytes travelled — an `x5c` chain rides in the JOSE Header too, and one this
 * package has not validated to a trusted anchor is in the second case.
 *
 * Pinning establishes CONTINUITY, not identity: precedence rests on the same
 * holder having signed the earlier declaration, not on knowing who that holder
 * is (draft -07 §Verification).
 */
export type SignatureResult =
  | { status: "unsigned" }
  | {
      status: "verified";
      alg: SigningAlg;
      kid?: string;
      publicJwk: PublicJwk;
      keySource: "trusted" | "header";
      /**
       * Which members the consumer used, and therefore which members the
       * caller is looking at in `document` (draft -07 §Verification):
       *
       *  - `"payload"` — the key was pinned/supplied by this consumer
       *    (`keySource: "trusted"`), so the signed payload's members took
       *    precedence over the members served around them. A pinned key gives
       *    continuity of authorship, not identity;
       *  - `"origin"` — the key is trusted no further than the declaration
       *    carrying it (`keySource: "header"`), so the members SERVED BY THE
       *    ORIGIN are the ones in use; the signature establishes integrity and
       *    key continuity and nothing more.
       *
       * It is derived from `keySource` and stated separately because it, not
       * the key source, is what a caller needs to know to read `document`.
       */
      precedence: "payload" | "origin";
      /**
       * The verified payload type, always reported in the prefix-omitted form
       * the draft writes, `sustainability-data+json`. A header carrying the
       * full `application/sustainability-data+json` names the same media type
       * (RFC 7515 §4.1.10) and verifies; it is reported here in this one form.
       */
      cty: string;
      /** True when the plain members differed from the signed payload (a warning, not a failure). */
      modifiedAfterSigning: boolean;
    }
  | {
      /**
       * `reason` is one of the JWS-level codes ({@link VerifyReason}) or one of
       * this module's own payload-level codes:
       *
       *  - `payload-not-declaration` — the payload is not a valid declaration
       *    object;
       *  - `payload-subject-mismatch` — the payload's `target` or
       *    `reporting-period` differs from the object's, so the two describe
       *    different things (draft -07 §Verification);
       *  - `payload-carries-signed` — the payload itself contains a `signed`
       *    member, which §The signed Member forbids;
       *  - `malformed` — the member is present but is not a JWS string.
       */
      status: "unverified";
      reason: string;
      detail?: string;
      alg?: SigningAlg;
      kid?: string;
    };

export type EnergyUnit = "Wh" | "kWh" | "MWh" | "GWh";
export type CarbonUnit = "gCO2e" | "kgCO2e" | "mtCO2e";
export type Capabilities = "basic" | "extended";
export type CarbonAccounting = "location-based" | "market-based";
/** The draft's enumerated classification hints for the reporting subject named by `target`. */
export const TARGET_TYPES = ["origin", "path", "organization", "service", "product", "device", "tenant", "data-source"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

/** One entry of the OPTIONAL `upstream` member (draft -07 §Upstream Declarations). */
export interface UpstreamEntry {
  /** Absolute "https" URI of the provider's own declaration. */
  declaration: string;
  /** A token such as `hosting`, `cloud`, `cdn`, `network`, `electricity`. */
  role?: string;
  [key: string]: unknown;
}

export interface SustainabilityMetrics {
  updated: string;
  capabilities: Capabilities;
  provider: string;
  "measurement-method": string;
  "methodology-uri": string;
  "reporting-period": string;
  /**
   * The mandatory reporting subject: an opaque identifier of the entity or
   * scope the metrics are attributed to (origin host, path prefix,
   * organization, product, device, tenant, data source).
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
  "functional-unit"?: string;
  "carbon-intensity-gCO2e-per-kWh"?: number;
  "estimated-annual-emissions-kgCO2e"?: number;
  "renewable-energy"?: number;
  "verifiable-attestation-uri"?: string;
  "disclosure-uri"?: string;
  /**
   * A hint classifying the reporting subject named by `target`. An
   * unrecognized value reads as if the member were absent (draft §Value
   * Constraints and Omitted Metrics) — see FetchResult.disregarded.
   */
  "target-type"?: TargetType;
  /** The declarations this object's figures derive from (-07). */
  upstream?: UpstreamEntry[];
  /**
   * Members defined outside the draft, keyed by an absolute URI naming the
   * party that defined them (-07 §Extensions): an "https" URI with a host, or
   * `urn:uuid:` plus a lowercase UUID. A consumer that does not implement a
   * key's definition ignores the value and MUST NOT dereference or execute
   * anything within it — not even the key itself; this package never does.
   */
  extensions?: Record<string, Record<string, unknown>>;
  /** A JWS Compact Serialization over this object without `signed` (-07 §Signing). */
  signed?: string;
  // The base object is closed in -07, but a consumer MUST ignore a top-level
  // member it does not recognize (a future revision may define one), so the
  // index signature stays: such a member round-trips and is reported as the
  // `unknown-member` warning.
  [key: string]: unknown;
}

/** A declaration is a single object, or an array for a trend (draft §Payload Format). */
export type SustainabilityDocument = SustainabilityMetrics | SustainabilityMetrics[];

export interface FetchParams {
  target?: string;
  period?: string;
  granularity?: "monthly" | "daily";
}

/**
 * One upstream declaration compared with the subject's own figures
 * (draft -07 §Upstream Declarations; opt in with `followUpstream`).
 *
 * The verdict is EVIDENCE ABOUT CONSISTENCY BETWEEN TWO SELF-ASSERTED CLAIMS,
 * never proof of either: both figures are published by their own publisher and
 * nothing here verifies a measurement.
 *
 * WHERE THE COMPARISON IS DEFINED (draft -07 §Upstream Declarations): only
 * where the upstream publishes a declaration about what it delivers to THIS
 * subject — one whose `target-type` is `tenant`. For the same
 * `reporting-period`, and after conversion to a single unit, "a subject whose
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
  /** The `reporting-period` the comparison was made for. */
  reportingPeriod?: string;
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
   * reported one (draft -07 §Upstream Declarations: "figures computed on
   * different bases are not comparable, so a consumer compares
   * `carbon-footprint` only where both objects declare the same
   * `carbon-accounting` value or neither declares one").
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
   * (not tenant-scoped, unreachable, wrong period). An unrecognized
   * `carbon-accounting` value is disregarded per §Value Constraints and
   * Omitted Metrics, so such an object counts as declaring no basis.
   */
  carbonComparison?: "compared" | "skipped-different-accounting-basis";
  /**
   * Member paths the tolerance pre-pass disregarded in the RETRIEVED upstream
   * declaration before comparing it (same form as `FetchResult.disregarded`,
   * e.g. `"carbon-accounting"`, `"[1].energy-unit"`).
   *
   * Draft -07 §Upstream Declarations: a consumer "reads a retrieved
   * declaration exactly as it reads any other, applying the tolerance rules of
   * Value Constraints and Omitted Metrics rather than refusing one over a
   * defective value" — so an upstream carrying a defective value is retrieved
   * and compared with that member disregarded, and this says which members
   * that was. Only set when non-empty.
   */
  upstreamDisregarded?: string[];
  /** The upstream's own upstreams, walked to the depth limit. */
  upstream?: UpstreamComparison[];
}

export type FetchResult =
  | {
      status: "ok";
      document: SustainabilityDocument;
      /**
       * The URL of the final response — after any redirect — which the draft
       * makes the origin the declaration is attributed to (§Mandatory Minimum
       * Supported Service: "MUST attribute the declaration to the origin of
       * the final response").
       */
      url: string;
      etag?: string;
      /**
       * How the response's `Content-Type` read (draft -07 §Mandatory Minimum
       * Supported Service): `"sustainability-data+json"` for the registered
       * media type, or `"json"` for the generic type under which declarations
       * published before the registration exist (a consumer MAY process those,
       * and this one does). Any other type is not a declaration and never
       * reaches an `ok` result — see `wrong-media-type`.
       */
      mediaType: MediaTypeClassification;
      /**
       * Advisory findings about the declaration that are NOT validation
       * errors: the declaration is valid and usable. Today:
       *  - a URI-valued member (`methodology-uri`, `disclosure-uri`,
       *    `verifiable-attestation-uri`, `upstream[].declaration`) carrying an
       *    absolute non-`https` URI, which the draft restricts to "https" and
       *    which a consumer MUST NOT automatically dereference;
       *  - `unknown-member`: a top-level member this revision does not define,
       *    which a consumer MUST ignore (a later revision may define it);
       *  - `modified-after-signing`: the plain members differ from the verified
       *    `signed` payload, whose members take precedence.
       * Only set when non-empty.
       */
      warnings?: string[];
      /**
       * Set when the declaration lacked the mandatory `target` member and the
       * legacy-compatibility pre-pass derived it (a pre-06 form; such a
       * document is NOT conformant, and the draft says a consumer MUST NOT
       * treat it as a declaration): from the historical `target-path` member's
       * value when that member is present, and from the final-response
       * origin's host (origin-wide report) only when neither member exists.
       */
      legacy?: boolean;
      /**
       * Member paths (e.g. "target-type", "[2].sci-score") stripped by the
       * tolerance pre-pass before validation, per the draft's §Value
       * Constraints and Omitted Metrics rules: a wrong-JSON-typed value
       * (including null) in a defined optional member, a reported `sci-score`
       * without `functional-unit`, and an unrecognized value in an
       * enumerated member (`capabilities`, `energy-unit`, `carbon-unit`,
       * `carbon-accounting`, `target-type` — a unit member takes the numeric
       * members it parameterizes with it) all read as "not reported" /
       * "disregard the member" rather than rejecting the object. Only set
       * when at least one member was disregarded.
       *
       * This list is also where a figure that tolerance left unusable is
       * reported: disregarding a value never makes the object non-conformant
       * (the at-least-one rule is judged on the members served), so an object
       * whose only metric was disregarded is still `ok` — it just has less to
       * read, and this list says what.
       */
      disregarded?: string[];
      /**
       * Set when the server answered something OTHER than what was asked for
       * (draft -07 §Extended Query Parameters). "Because a server ignores a
       * parameter it does not support, a consumer MUST compare the
       * `reporting-period` and `target` of every object it receives against
       * what it requested, and MUST NOT record a response as covering a period
       * or a subject it does not name."
       *
       * One human-readable line per mismatch, e.g.
       * `period: requested "2026-03", object [0] reports "2026"`. The
       * declaration itself is still valid and is returned — it simply covers
       * something else, and a caller MUST NOT record it against the request.
       * The same lines appear in `warnings`. Only set when non-empty.
       */
      notAsRequested?: string[];
      /**
       * Set ONLY when the final response came from a DIFFERENT origin than the
       * one queried (draft -07 §Mandatory Minimum Supported Service): "where
       * that origin differs from the one it queried, the declaration is a
       * claim by that other origin, and the consumer MUST NOT record it as a
       * declaration of the origin it queried unless the object's `target`
       * names that origin".
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
   * The server answered 200 with an EMPTY ARRAY — something a conformant
   * server never sends (it follows the no-data rule instead). Per the draft
   * (§Payload Format) the consumer treats it as conveying no report.
   * Returned only under legacyCompat (default); strict mode reports it as
   * `invalid` instead.
   */
  | { status: "no-report" }
  | { status: "invalid"; errors: string[] }
  /**
   * The 200 response carried a media type that is not a declaration (draft
   * -07: "A response carrying a media type other than those two is not a
   * declaration").
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
   * draft removed the server-side cap in -07 and tells the consumer to bound
   * what it accepts itself: "a consumer MUST NOT rely on any server bound: it
   * MUST limit the bytes and objects it accepts and treat an excess as an
   * error" (§Denial of Service).
   */
  | { status: "too-many-objects"; count: number; max: number }
  /**
   * The declaration was NOT retrieved over HTTPS, so it was refused without
   * being used. Draft §Mandatory Minimum Supported Service: the declaration
   * MUST be published and retrieved over HTTPS, a consumer MUST NOT accept one
   * retrieved over unauthenticated HTTP, and a followed redirect MUST require
   * HTTPS on every hop. Returned both for the requested URL and for an `http:`
   * FINAL url after a redirect; `url` names the offending one. Opt out with
   * `allowInsecure: true` (development and CI against a local origin only).
   */
  | { status: "insecure-transport"; url: string; detail: string }
  /**
   * This consumer DECLINED TO DEREFERENCE the URI, before contacting it. Not a
   * failure of the origin — nothing was sent to it — but a rule this consumer
   * applies to a URI it was handed (draft -07 §Consumer Considerations, which
   * has a consumer "refuse URIs that resolve to private or link-local
   * addresses, since dereferencing URIs from an untrusted document exposes it
   * to server-side request forgery").
   *
   *  - `blocked-address` — the host is, or resolves to, a loopback, private
   *    (RFC 1918), link-local, unique-local or unspecified address. Applies to
   *    the requested URL and to every redirect hop alike, so an origin cannot
   *    answer honestly and then point inward. Override with
   *    `allowPrivateAddresses` (which `allowInsecure` already implies, since a
   *    local development server is exactly that case), and pin what a name
   *    resolves to with `lookup`.
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
