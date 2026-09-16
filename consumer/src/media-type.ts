/**
 * Media typing for a Sustainability Declaration (draft -07, §Mandatory Minimum
 * Supported Service and §IANA Considerations).
 *
 * The draft registers a dedicated media type and makes it required: a 200
 * response MUST carry `application/sustainability-data+json` and MUST NOT
 * carry any other. A consumer MUST process the registered type and MAY process
 * `application/json`, "under which declarations published before the
 * registration of the dedicated type exist" — and "a response carrying any
 * other media type is not a declaration", which `fetch.ts` enforces by
 * refusing such a response unread.
 *
 * This module is the single place the wire names live. A future rename — a
 * different subtype at IANA registration time — changes this one file, and
 * nothing else in the package.
 */

/** The media type the draft registers; a conformant 200 response carries exactly this. */
export const MEDIA_TYPE = "application/sustainability-data+json";

/**
 * The generic JSON type. Still processed — the draft's MAY — because
 * declarations published before the dedicated type was registered exist in
 * the field under it.
 */
export const LEGACY_MEDIA_TYPE = "application/json";

/** What this client accepts, most-preferred first. */
export const ACCEPTED_MEDIA_TYPES = [MEDIA_TYPE, LEGACY_MEDIA_TYPE] as const;

/**
 * The `Accept` header sent on every document fetch: the registered type
 * outright, the generic type at a lower q-value, exactly as the draft spells
 * the header out, so an origin that can serve both is steered to the
 * registered type without cutting off an older publisher.
 */
export const ACCEPT_HEADER = `${MEDIA_TYPE}, ${LEGACY_MEDIA_TYPE};q=0.9`;

/**
 * How a response's Content-Type reads to this consumer:
 *  - `"sustainability-data+json"` — the registered type: conformant;
 *  - `"json"` — the generic type: processed (the draft's MAY), not conformant;
 *  - `"other"` — anything else, including a missing Content-Type: not a
 *    declaration, and refused unread by `fetch.ts`.
 */
export type MediaTypeClassification = "sustainability-data+json" | "json" | "other";

/**
 * Classify a raw `Content-Type` header value. Parameters (`; charset=utf-8`)
 * are stripped and the type is compared case-insensitively, per the media-type
 * matching rules of HTTP semantics; `null` (no header at all) reads as
 * `"other"`, since a document type cannot be concluded from its absence.
 */
export function classifyMediaType(header: string | null): MediaTypeClassification {
  if (header === null || header === undefined) return "other";
  const essence = header.split(";")[0].trim().toLowerCase();
  if (essence === MEDIA_TYPE) return "sustainability-data+json";
  if (essence === LEGACY_MEDIA_TYPE) return "json";
  return "other";
}
