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

export function resolveDisclosureLinks(doc: SustainabilityMetrics): DisclosureLinks {
  return {
    disclosureUri: doc["disclosure-uri"],
    attestationUri: doc["verifiable-attestation-uri"],
  };
}

/** Explicit, caller-invoked fetch of a disclosure/attestation URI. Never called automatically. */
export async function fetchDisclosure(uri: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  const res = await fetchImpl(uri);
  if (!res.ok) throw new Error(`fetchDisclosure: ${uri} responded ${res.status}`);
  return res.text();
}
