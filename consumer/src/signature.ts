/**
 * The OPTIONAL embedded signature: the `signed` member of a declaration object
 * (draft -10 §The signed Member, §Verifying a Signature).
 *
 * The value is a JWS Compact Serialization whose payload is the object it
 * appears in, without `signed`, as the publisher serialized it. Verification
 * therefore needs nothing but the object itself: no second request, no
 * canonicalization, and no dependence on the exact octets an edge cache served.
 *
 * What the outcome means is fixed by the draft and never softened here: an
 * absent member is NOT evidence of anything, and a member that fails to verify
 * makes the object UNVERIFIED, never false. A verified signature establishes
 * integrity and, with a held key, continuity of authorship; it never
 * establishes who holds the key or that a figure is accurate. It protects the
 * other members of its own object and nothing around it: not the array, the
 * HTTP header fields or the retrieval URI.
 *
 * Two payload rules, each with the one reason `payload-not-declaration` or
 * `payload-subject-mismatch`:
 *  - the payload must be a JSON object that validates as a declaration object
 *    and carries no `signed` member;
 *  - the payload's `target`, `period.start`, `period.end`, `carbon-accounting`
 *    and `functional-unit` must be the object's, compared as strings and not as
 *    instants, a member absent from both counting as equal. A signature copied
 *    onto a twin object of the same target and period is caught here.
 *
 * Whether the payload's members take PRECEDENCE over the served ones depends on
 * the key trust level (see `precedence` on {@link SignatureResult}): only an
 * out-of-band, pinned or x5c-anchored key promotes the payload. Where an older
 * signed object arrives than one the caller already holds for the same target,
 * period, accounting method and functional unit, the result carries
 * `replaySuspected`; nothing here shows that no newer object exists.
 */
import { compareDateTimes, canonicalKey, periodError, Period } from "./period";
import { deepEqual, differingMembers, withoutSigned } from "./compare";
import { DECLARATION_CTY, PublicJwk, verifyDeclarationJws, VerifyPolicy } from "./jws";
import { applyCompatibilityReading, CompatReport } from "./sentinel";
import { SignatureResult, SustainabilityMetrics } from "./types";
import { validateDocument } from "./validate";
import { targetsEqual } from "./target";

/** A reading the caller already holds, to recognize the replay of an older signed object. */
export interface HeldReading {
  target: string;
  period: Period;
  "carbon-accounting"?: string;
  "functional-unit"?: string;
  /** The `updated` of the reading held, an RFC 3339 date-time. */
  updated: string;
}

export interface SignaturePolicy extends VerifyPolicy {
  /** Readings already held; the first that names the same subject decides {@link SignatureResult} `replaySuspected`. */
  held?: HeldReading[];
}

export interface SignatureOptions {
  /** Read the payload and the object with the compatibility reading first (default true), as the document was read. */
  legacyCompat?: boolean;
}

export interface EmbeddedSignatureOutcome {
  result: SignatureResult;
  /**
   * The verified payload, present only on a `verified` result.
   *
   * It is the members the consumer USES only when `result.precedence ===
   * "payload"`. With a key trusted no further than the declaration carrying it
   * (`precedence: "origin"`) the payload is reported for inspection and
   * comparison, and the members served by the origin remain the ones in use.
   * Callers substituting members MUST check `precedence` first;
   * `fetchSustainability` does.
   */
  payload?: SustainabilityMetrics;
  /** The member paths at which the payload and the plain members differ: the same list as `result.modifiedMembers`, present only when there are any. */
  differences?: string[];
}

type Rec = Record<string, unknown>;

/** The five members a payload must agree on with its object, by dotted path. */
const MUST_AGREE_MEMBERS = ["target", "period.start", "period.end", "carbon-accounting", "functional-unit"] as const;

function member(o: Rec, path: string): unknown {
  const [head, tail] = path.split(".");
  const value = o[head];
  return tail === undefined ? value : typeof value === "object" && value !== null ? (value as Rec)[tail] : undefined;
}

const show = (v: unknown): string => (v === undefined ? "(absent)" : `"${String(v)}"`);

/**
 * A copy of `object` read like the document was, so a payload of an earlier
 * form compares equal to its object. The reading changes only the top-level
 * members, `period` and the `upstream` entries, so those are copied and the
 * rest (extensions can nest deeply) is shared and never touched.
 */
function read(object: unknown, legacyCompat: boolean): Rec {
  const copy: Rec = { ...(object as Rec) };
  if (typeof copy.period === "object" && copy.period !== null) copy.period = { ...(copy.period as Rec) };
  if (Array.isArray(copy.upstream)) copy.upstream = copy.upstream.map((e) => (typeof e === "object" && e !== null ? { ...(e as Rec) } : e));
  if (legacyCompat) applyCompatibilityReading(copy, "", { converted: [], disregarded: [] } satisfies CompatReport);
  return copy;
}

/** The first held reading of the same subject whose `updated` is later than the payload's: the payload is a replay. */
function replayOf(payload: Rec, held: readonly HeldReading[] | undefined): { heldUpdated: string; updated: string } | undefined {
  const updated = payload.updated;
  if (!held?.length || typeof updated !== "string" || periodError(payload.period) !== undefined) return undefined;
  const key = canonicalKey(payload.period as Period);
  for (const h of held) {
    if (!targetsEqual(h.target, payload.target, payload["target-type"]) || canonicalKey(h.period) !== key) continue;
    if (h["carbon-accounting"] !== payload["carbon-accounting"] || h["functional-unit"] !== payload["functional-unit"]) continue;
    if (compareDateTimes(updated, h.updated) < 0) return { heldUpdated: h.updated, updated };
  }
  return undefined;
}

/**
 * Verify one declaration object's `signed` member. Never throws; the object is
 * not modified.
 */
export async function verifyEmbeddedSignature(
  object: unknown,
  policy: SignaturePolicy = {},
  options: SignatureOptions = {},
): Promise<EmbeddedSignatureOutcome> {
  if (typeof object !== "object" || object === null || Array.isArray(object)) {
    return { result: { status: "unsigned" } };
  }
  const signed = (object as Rec).signed;
  // Absent member: the publisher did not sign. Not an error, not evidence.
  if (signed === undefined) return { result: { status: "unsigned" } };
  // Wrong JSON type: a `signed` of the wrong type is disregarded and the object
  // is processed as though the member were absent. Absent means UNSIGNED, not
  // "unverified": there is no signature to fail.
  if (typeof signed !== "string") return { result: { status: "unsigned" } };
  if (signed.trim() === "") {
    return { result: { status: "unverified", reason: "malformed", detail: "the signed member is not a JWS string" } };
  }

  const v = await verifyDeclarationJws(signed.trim(), policy);
  const known = { ...(v.alg ? { alg: v.alg } : {}), ...(v.kid ? { kid: v.kid } : {}) };
  const unverified = (reason: string, detail: string): EmbeddedSignatureOutcome => ({
    result: { status: "unverified", reason, detail, ...known },
  });
  if (!v.valid) return unverified(v.reason ?? "invalid-signature", v.detail ?? "the signature does not verify");

  // On success the payload is read as a declaration object: one that is not
  // cannot take precedence over the plain members, so the object is reported
  // as unverified rather than replaced.
  const compat = options.legacyCompat !== false;
  if (typeof v.payload !== "object" || v.payload === null || Array.isArray(v.payload)) {
    return unverified("payload-not-declaration", "the signed payload is not a JSON object");
  }
  const payload = read(v.payload, compat);
  if (payload.signed !== undefined) {
    return unverified("payload-not-declaration", "the signed payload itself contains a signed member, which the draft forbids");
  }
  const check = validateDocument(payload);
  if (!check.valid) return unverified("payload-not-declaration", `the signed payload is not a valid declaration object: ${check.errors.join("; ")}`);

  // The members that must agree, compared as the strings they are.
  const outer = read(object, compat);
  const differing = MUST_AGREE_MEMBERS.filter((path) => member(payload, path) !== member(outer, path));
  if (differing.length > 0) {
    return unverified(
      "payload-subject-mismatch",
      `the signed payload describes something else: ${differing
        .map((path) => `${path} is ${show(member(payload, path))} in the payload and ${show(member(outer, path))} in the object`)
        .join("; ")}`,
    );
  }

  const plain = withoutSigned(outer);
  const modifiedAfterSigning = !deepEqual(payload, plain);
  // The payload's members take precedence only where the key is trusted
  // beyond the declaration carrying it. A header key is not.
  const precedence = v.keyTrust === "declaration-only" ? ("origin" as const) : ("payload" as const);
  const modifiedMembers = modifiedAfterSigning ? differingMembers(payload, plain) : undefined;
  const replay = replayOf(payload, policy.held);
  return {
    result: {
      status: "verified",
      alg: v.alg!,
      ...(v.deprecatedAlg ? { deprecatedAlg: true as const } : {}),
      ...(v.kid ? { kid: v.kid } : {}),
      thumbprint: v.thumbprint!,
      publicJwk: v.publicJwk as PublicJwk,
      keyTrust: v.keyTrust!,
      precedence,
      cty: DECLARATION_CTY,
      modifiedAfterSigning,
      ...(modifiedMembers ? { modifiedMembers } : {}),
      ...(replay ? { replaySuspected: replay } : {}),
    },
    payload: payload as unknown as SustainabilityMetrics,
    ...(modifiedMembers ? { differences: modifiedMembers } : {}),
  };
}
