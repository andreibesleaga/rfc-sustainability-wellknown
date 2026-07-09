"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDisclosureLinks = resolveDisclosureLinks;
exports.fetchDisclosure = fetchDisclosure;
function resolveDisclosureLinks(doc) {
    return {
        disclosureUri: doc["disclosure-uri"],
        attestationUri: doc["verifiable-attestation-uri"],
    };
}
/** Explicit, caller-invoked fetch of a disclosure/attestation URI. Never called automatically. */
async function fetchDisclosure(uri, fetchImpl = globalThis.fetch) {
    const res = await fetchImpl(uri);
    if (!res.ok)
        throw new Error(`fetchDisclosure: ${uri} responded ${res.status}`);
    return res.text();
}
