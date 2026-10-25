/**
 * Media types for the `/.well-known/sustainability-data` response.
 *
 * Draft, Location and Transport: a declaration is published with the
 * `application/sustainability-data+json` media type the draft registers; a
 * consumer MAY also process a `200 OK` response of `application/json` as a
 * declaration, and a response of any other media type is not a declaration.
 * `LEGACY_MEDIA_TYPE` is `application/json`, the media type declarations
 * published before that registration carry in the field. It is exposed here so a
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
