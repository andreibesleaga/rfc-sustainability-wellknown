/**
 * Disclosure link helpers. Passive by design: `resolveDisclosureLinks` never
 * makes a network call — the draft's own posture is "MUST NOT treat as proof",
 * and auto-fetching arbitrary third-party URLs found inside an unsolicited
 * document is an SSRF-shaped footgun. `fetchDisclosure` exists only for a
 * caller that explicitly opts in.
 */
import { discardBody, readBodyCapped, secureGet } from "./transport";
import { SustainabilityMetrics } from "./types";

export interface DisclosureLinks {
  disclosureUri?: string;
  attestationUri?: string;
}

export function resolveDisclosureLinks(doc: SustainabilityMetrics): DisclosureLinks {
  return {
    disclosureUri: doc["disclosure-uri"],
    attestationUri: doc["verifiable-attestation-uri"],
  };
}

/**
 * Explicit, caller-invoked fetch of a disclosure/attestation URI. Never called
 * automatically.
 *
 * Refuses any URI that is not an absolute `https` one, BEFORE making a request.
 * Draft -06 §Payload Format: the three URI-valued members "MUST be absolute
 * URIs using the 'https' scheme, for the same reason the document itself is
 * served over HTTPS: a supporting resource fetched over an unauthenticated
 * channel would carry none of the assurance for which it is being fetched.
 * Clients MUST NOT automatically dereference a URI member carrying any other
 * scheme". Refusing here also keeps the obvious footguns out of reach —
 * `file:`, `data:` and friends never reach the fetch implementation.
 */
export async function fetchDisclosure(uri: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(
      `fetchDisclosure: "${uri}" is not an absolute URI; the draft requires absolute "https" URIs in the URI members`,
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `fetchDisclosure: refusing to dereference "${uri}": scheme is "${parsed.protocol.replace(/:$/, "")}", and the ` +
        `draft restricts the URI members to "https" — clients MUST NOT dereference a URI member carrying another scheme`,
    );
  }
  // Same transport rules as the document: HTTPS on every hop, checked before
  // each hop is requested, a bounded wait and a bounded body.
  const got = await secureGet(parsed, { fetchImpl, timeoutMs: 30_000, headers: { Accept: "*/*" } });
  if (!got.ok) throw new Error(`fetchDisclosure: ${uri}: ${got.refusal.reason}${got.refusal.detail ? ` (${got.refusal.detail})` : ""}`);
  if (got.res.status !== 200) {
    await discardBody(got.res);
    throw new Error(`fetchDisclosure: ${uri} responded ${got.res.status}`);
  }
  return (await readBodyCapped(got.res, MAX_DISCLOSURE_BYTES)).text;
}

/** A disclosure page is read for a person; one megabyte bounds a hostile one. */
const MAX_DISCLOSURE_BYTES = 1_048_576;
