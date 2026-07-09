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
/** Explicit, caller-invoked fetch of a disclosure/attestation URI. Never called automatically. */
export declare function fetchDisclosure(uri: string, fetchImpl?: typeof fetch): Promise<string>;
