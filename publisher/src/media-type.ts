/**
 * Media types for the `/.well-known/sustainability-data` response.
 *
 * Draft -06 §Mandatory Minimum Supported Service: a successful (`200 OK`)
 * response carrying a Sustainability Metadata Document MUST use the
 * `application/sustainability-data+json` media type registered by the draft,
 * and MUST NOT use any other. `LEGACY_MEDIA_TYPE` is `application/json`, the
 * media type documents published before that registration (draft -05 and
 * earlier) carry in the field; clients MUST accept the dedicated type and
 * SHOULD also accept this one. It is exposed here so a publisher can opt into
 * serving it instead (`HandlerOptions.mediaType: "json"`), for a v05-compatible
 * legacy deployment — doing so is NOT -06 conformant.
 *
 * Kept in their own module, separate from every call site, so that if a future
 * draft revision renames the media type (for example, changing the
 * structured-syntax suffix), this is the one place that changes.
 */
export const MEDIA_TYPE = "application/sustainability-data+json";
export const LEGACY_MEDIA_TYPE = "application/json";
