/**
 * Media types for the `/.well-known/sustainability-data` response.
 *
 * Draft §Mandatory Minimum Supported Service: a successful (`200 OK`) response
 * carrying a declaration MUST use the `application/sustainability-data+json`
 * media type registered by the draft, and MUST NOT carry any other.
 * `LEGACY_MEDIA_TYPE` is `application/json`, the media type declarations
 * published before that registration carry in the field; a consumer MUST
 * process the dedicated type and MAY process this one. It is exposed here so a
 * publisher can opt into serving it instead
 * (`HandlerOptions.mediaType: "json"`) for such a deployment — doing so is not
 * conformant publishing.
 *
 * Kept in their own module, separate from every call site, so that if a future
 * draft revision renames the media type (for example, changing the
 * structured-syntax suffix), this is the one place that changes.
 */
export const MEDIA_TYPE = "application/sustainability-data+json";
export const LEGACY_MEDIA_TYPE = "application/json";
