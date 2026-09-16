/**
 * Disclosure link helpers. Passive by design: `resolveDisclosureLinks` never
 * makes a network call — the draft's own posture is "MUST NOT treat as proof",
 * and auto-fetching arbitrary third-party URLs found inside an unsolicited
 * document is an SSRF-shaped footgun. `fetchDisclosure` exists only for a
 * caller that explicitly opts in.
 */
import { AddressLookup, discardBody, readBodyCapped, secureGet } from "./transport";
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
 * Draft -07 §Optional Members: the URI-valued members "MUST be absolute URIs
 * with the 'https' scheme; a consumer MUST NOT automatically dereference any
 * other scheme, and one that dereferences them applies the protections of
 * Consumer Considerations". Refusing here also keeps the obvious footguns out
 * of reach — `file:`, `data:` and friends never reach the fetch
 * implementation.
 */
export interface FetchDisclosureOptions {
  /** Resolver for the address check; see {@link AddressLookup}. */
  lookup?: AddressLookup;
  /**
   * Opt out of refusing a URI that resolves to a loopback, private, link-local,
   * unique-local or unspecified address (default false). A `disclosure-uri`
   * comes out of a third-party document, so the check is on by default here
   * even though this function is already explicit, caller-invoked and never
   * automatic.
   */
  allowPrivateAddresses?: boolean;
  /** Per-request timeout (ms); default 30 000. */
  timeoutMs?: number;
}

export async function fetchDisclosure(
  uri: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  options: FetchDisclosureOptions = {},
): Promise<string> {
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
        `draft restricts the URI members to "https" — a consumer MUST NOT dereference a URI member carrying another scheme`,
    );
  }
  // Same transport rules as the document: HTTPS on every hop, checked before
  // each hop is requested, a bounded wait and a bounded body.
  const got = await secureGet(parsed, {
    fetchImpl,
    timeoutMs: options.timeoutMs ?? 30_000,
    lookup: options.lookup,
    allowPrivateAddresses: options.allowPrivateAddresses,
    headers: { Accept: "*/*" },
  });
  if (!got.ok) throw new Error(`fetchDisclosure: ${uri}: ${got.refusal.reason}${got.refusal.detail ? ` (${got.refusal.detail})` : ""}`);
  if (got.res.status !== 200) {
    await discardBody(got.res);
    throw new Error(`fetchDisclosure: ${uri} responded ${got.res.status}`);
  }
  return (await readBodyCapped(got.res, MAX_DISCLOSURE_BYTES)).text;
}

/** A disclosure page is read for a person; one megabyte bounds a hostile one. */
const MAX_DISCLOSURE_BYTES = 1_048_576;
