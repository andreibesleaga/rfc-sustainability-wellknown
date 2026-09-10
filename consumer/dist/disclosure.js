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
async function fetchDisclosure(uri, fetchImpl = globalThis.fetch) {
    let parsed;
    try {
        parsed = new URL(uri);
    }
    catch {
        throw new Error(`fetchDisclosure: "${uri}" is not an absolute URI; the draft requires absolute "https" URIs in the URI members`);
    }
    if (parsed.protocol !== "https:") {
        throw new Error(`fetchDisclosure: refusing to dereference "${uri}": scheme is "${parsed.protocol.replace(/:$/, "")}", and the ` +
            `draft restricts the URI members to "https" — clients MUST NOT dereference a URI member carrying another scheme`);
    }
    const res = await fetchImpl(uri);
    if (!res.ok)
        throw new Error(`fetchDisclosure: ${uri} responded ${res.status}`);
    return res.text();
}
