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
/** The media type registered by -06; a conformant 200 response uses exactly this. */
export declare const MEDIA_TYPE = "application/sustainability-data+json";
/**
 * The generic type earlier revisions (through -05) required. Still accepted —
 * a SHOULD in -06 — because documents published under it exist in the field.
 */
export declare const LEGACY_MEDIA_TYPE = "application/json";
/** What this client accepts, most-preferred first. */
export declare const ACCEPTED_MEDIA_TYPES: readonly ["application/sustainability-data+json", "application/json"];
/**
 * The `Accept` header sent on every document fetch: the registered type
 * outright, the legacy type at a lower q-value, so an origin that can serve
 * both is steered to the -06 type without cutting off a -05 publisher.
 */
export declare const ACCEPT_HEADER = "application/sustainability-data+json, application/json;q=0.9";
/**
 * How a response's Content-Type reads to this client:
 *  - `"sustainability-data+json"` — the -06 registered type;
 *  - `"json"` — the pre-06 generic type (v05-compatible, not v06-conformant);
 *  - `"other"` — anything else, including a missing Content-Type. The body is
 *    still parsed (the draft's MAY), just flagged.
 */
export type MediaTypeClassification = "sustainability-data+json" | "json" | "other";
/**
 * Classify a raw `Content-Type` header value. Parameters (`; charset=utf-8`)
 * are stripped and the type is compared case-insensitively, per the media-type
 * matching rules of HTTP semantics; `null` (no header at all) reads as
 * `"other"`, since a document type cannot be concluded from its absence.
 */
export declare function classifyMediaType(header: string | null): MediaTypeClassification;
