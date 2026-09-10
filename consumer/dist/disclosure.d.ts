/**
 * Disclosure link helpers. Passive by design: `resolveDisclosureLinks` never
 * makes a network call — the draft's own posture is "MUST NOT treat as proof",
 * and auto-fetching arbitrary third-party URLs found inside an unsolicited
 * document is an SSRF-shaped footgun. `fetchDisclosure` exists only for a
 * caller that explicitly opts in.
 */
import { SustainabilityMetrics } from "./types";
export interface DisclosureLinks {
    disclosureUri?: string;
    attestationUri?: string;
}
export declare function resolveDisclosureLinks(doc: SustainabilityMetrics): DisclosureLinks;
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
export declare function fetchDisclosure(uri: string, fetchImpl?: typeof fetch): Promise<string>;
