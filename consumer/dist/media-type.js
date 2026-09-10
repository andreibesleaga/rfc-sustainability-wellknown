"use strict";
/**
 * Media typing for a Sustainability Metadata Document (draft -06,
 * §Mandatory Minimum Supported Service and §IANA Considerations).
 *
 * -06 registers a dedicated media type and makes it required: a successful
 * response MUST use `application/sustainability-data+json` and MUST NOT use
 * any other media type. Clients MUST accept it and SHOULD also accept
 * `application/json`, under which documents published before the registration
 * (i.e. every -05-era publisher) are found in the field. A client MAY parse a
 * response whose media type is neither, but MUST NOT rely on media typing
 * alone to conclude that a response is a Sustainability Metadata Document —
 * which is why this module only ever CLASSIFIES a response, and never refuses
 * one: the decision is made from the document's own content, by validate.ts.
 *
 * This module is the single place the wire names live. A future rename — the
 * open well-known-suffix question noted in the draft's front matter, or a
 * different subtype at IANA registration time — changes this one file, and
 * nothing else in the package.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCEPT_HEADER = exports.ACCEPTED_MEDIA_TYPES = exports.LEGACY_MEDIA_TYPE = exports.MEDIA_TYPE = void 0;
exports.classifyMediaType = classifyMediaType;
/** The media type registered by -06; a conformant 200 response uses exactly this. */
exports.MEDIA_TYPE = "application/sustainability-data+json";
/**
 * The generic type earlier revisions (through -05) required. Still accepted —
 * a SHOULD in -06 — because documents published under it exist in the field.
 */
exports.LEGACY_MEDIA_TYPE = "application/json";
/** What this client accepts, most-preferred first. */
exports.ACCEPTED_MEDIA_TYPES = [exports.MEDIA_TYPE, exports.LEGACY_MEDIA_TYPE];
/**
 * The `Accept` header sent on every document fetch: the registered type
 * outright, the legacy type at a lower q-value, so an origin that can serve
 * both is steered to the -06 type without cutting off a -05 publisher.
 */
exports.ACCEPT_HEADER = `${exports.MEDIA_TYPE}, ${exports.LEGACY_MEDIA_TYPE};q=0.9`;
/**
 * Classify a raw `Content-Type` header value. Parameters (`; charset=utf-8`)
 * are stripped and the type is compared case-insensitively, per the media-type
 * matching rules of HTTP semantics; `null` (no header at all) reads as
 * `"other"`, since a document type cannot be concluded from its absence.
 */
function classifyMediaType(header) {
    if (header === null || header === undefined)
        return "other";
    const essence = header.split(";")[0].trim().toLowerCase();
    if (essence === exports.MEDIA_TYPE)
        return "sustainability-data+json";
    if (essence === exports.LEGACY_MEDIA_TYPE)
        return "json";
    return "other";
}
