/**
 * The OPTIONAL embedded signature: the `signed` member of a declaration object
 * (draft -07 §Signing).
 *
 * The value is a JWS Compact Serialization whose payload is the object it
 * appears in, without `signed`, as the publisher serialized it. Verification
 * therefore needs nothing but the object itself — no second request, no
 * canonicalization, and no dependence on the exact octets an edge cache served
 * (the signature travels inside the body).
 *
 * What the outcome means is fixed by the draft and never softened here:
 * an absent member is NOT evidence of anything, and a member that fails to
 * verify makes the object UNVERIFIED, never false. A verified signature
 * establishes integrity and key continuity — not identity (unless the key was
 * pinned out of band) and never accuracy.
 *
 * Three payload rules of -07 are enforced here, each with its own reason code,
 * because each describes a payload that cannot stand for the object:
 *  - the payload must parse and validate as a declaration object
 *    (`payload-not-declaration`);
 *  - the payload MUST NOT itself contain a `signed` member (§The signed
 *    Member) — `payload-carries-signed`;
 *  - the payload's `target` and `reporting-period` must be the object's, since
 *    "the two then describe different things" (§Verification) —
 *    `payload-subject-mismatch`.
 *
 * And whether the payload's members take PRECEDENCE over the served ones is
 * conditional on how far the key is trusted: see `precedence` on
 * {@link SignatureResult}. A wrongly typed `signed` member is not a failed
 * signature at all: §Value Constraints and Omitted Metrics disregards it and
 * the object is processed as though the member were absent, so it reads here
 * as `unsigned`.
 */
import { deepEqual, differingMembers, withoutSigned } from "./compare";
import { DECLARATION_CTY, PublicJwk, verifyDeclarationJws, VerifyPolicy } from "./jws";
import { SignatureResult, SustainabilityMetrics } from "./types";
import { validateDocument } from "./validate";

export interface EmbeddedSignatureOutcome {
  result: SignatureResult;
  /**
   * The verified payload, present only on a `verified` result.
   *
   * It is the members the consumer USES only when
   * `result.precedence === "payload"` — that is, when the key was pinned or
   * supplied by the caller. With a key that arrived in the JOSE Header
   * (`precedence: "origin"`) the payload is reported for inspection and
   * comparison, and the members served by the origin remain the ones in use
   * (draft -07 §Verification). Callers substituting members MUST check
   * `precedence` first; `fetchSustainability` does.
   */
  payload?: SustainabilityMetrics;
  /** Member names that differ between the payload and the plain object (a warning, not a failure). */
  differences?: string[];
}

/**
 * Verify one declaration object's `signed` member. Never throws; the object is
 * not modified.
 */
export async function verifyEmbeddedSignature(
  object: unknown,
  policy: VerifyPolicy = {},
): Promise<EmbeddedSignatureOutcome> {
  if (typeof object !== "object" || object === null || Array.isArray(object)) {
    return { result: { status: "unsigned" } };
  }
  const signed = (object as Record<string, unknown>).signed;
  // Absent member: the publisher did not sign. Not an error, not evidence.
  if (signed === undefined) return { result: { status: "unsigned" } };
  // Wrong JSON type: draft -07 §Value Constraints and Omitted Metrics — "For
  // `signed`, `upstream` and `extensions`, a value of the wrong JSON type is
  // disregarded and the object is processed as though the member were absent".
  // Absent means UNSIGNED, not "unverified": there is no signature to fail.
  if (typeof signed !== "string") return { result: { status: "unsigned" } };
  if (signed.trim() === "") {
    return { result: { status: "unverified", reason: "malformed", detail: "the signed member is not a JWS string" } };
  }

  const v = await verifyDeclarationJws(signed.trim(), policy);
  if (!v.valid) {
    return {
      result: {
        status: "unverified",
        reason: v.reason ?? "invalid-signature",
        ...(v.alg ? { alg: v.alg } : {}),
        ...(v.kid ? { kid: v.kid } : {}),
      },
    };
  }

  // On success the payload is parsed as JSON and validated as a declaration
  // object: a payload that is not one cannot take precedence over the plain
  // members, so the object is reported as unverified rather than replaced.
  const payload = v.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return {
      result: {
        status: "unverified",
        reason: "payload-not-declaration",
        detail: "the signed payload is not a JSON object",
        ...(v.alg ? { alg: v.alg } : {}),
        ...(v.kid ? { kid: v.kid } : {}),
      },
    };
  }
  const check = validateDocument(payload);
  if (!check.valid) {
    return {
      result: {
        status: "unverified",
        reason: "payload-not-declaration",
        detail: `the signed payload is not a valid declaration object: ${check.errors.join("; ")}`,
        ...(v.alg ? { alg: v.alg } : {}),
        ...(v.kid ? { kid: v.kid } : {}),
      },
    };
  }

  const rec = payload as Record<string, unknown>;

  // Draft -07 §The signed Member: "The payload MUST NOT itself contain a
  // `signed` member." Such a payload cannot stand for the object it
  // accompanies, so the object is unverified.
  if (rec.signed !== undefined) {
    return {
      result: {
        status: "unverified",
        reason: "payload-carries-signed",
        detail: "the signed payload itself contains a signed member, which the draft forbids",
        ...(v.alg ? { alg: v.alg } : {}),
        ...(v.kid ? { kid: v.kid } : {}),
      },
    };
  }

  // Draft -07 §Verification: "A consumer MUST also treat the object as
  // unverified when the payload's `target` or `reporting-period` differs from
  // the object's, since the two then describe different things." Both members
  // are protocol elements compared octet-for-octet.
  const outer = object as Record<string, unknown>;
  const differing = (["target", "reporting-period"] as const).filter((k) => rec[k] !== outer[k]);
  if (differing.length > 0) {
    return {
      result: {
        status: "unverified",
        reason: "payload-subject-mismatch",
        detail:
          `the signed payload describes something else: ${differing
            .map((k) => `${k} is "${String(rec[k])}" in the payload and "${String(outer[k])}" in the object`)
            .join("; ")}`,
        ...(v.alg ? { alg: v.alg } : {}),
        ...(v.kid ? { kid: v.kid } : {}),
      },
    };
  }

  const plain = withoutSigned(object);
  const modifiedAfterSigning = !deepEqual(payload, plain);
  // Draft -07 §Verification: the payload's members take precedence ONLY where
  // the key was obtained out of band, pinned from an earlier retrieval, or
  // validated through an `x5c` chain to an anchor already trusted — which this
  // verifier represents as `keySource: "trusted"` (this package resolves no
  // `x5c` chain, so a key that arrived in the header is never promoted to it).
  // A header key is trusted no further than the declaration carrying it, so
  // the members served by the origin remain the ones in use.
  const precedence = v.keySource === "trusted" ? ("payload" as const) : ("origin" as const);
  return {
    result: {
      status: "verified",
      alg: v.alg!,
      kid: v.kid,
      publicJwk: v.publicJwk as PublicJwk,
      keySource: v.keySource!,
      precedence,
      cty: DECLARATION_CTY,
      modifiedAfterSigning,
    },
    payload: payload as SustainabilityMetrics,
    ...(modifiedAfterSigning ? { differences: differingMembers(payload, plain) } : {}),
  };
}
