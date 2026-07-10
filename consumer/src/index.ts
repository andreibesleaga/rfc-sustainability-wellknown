/**
 * sustainability-wellknown-consumer
 *
 * A reference client for `/.well-known/sustainability` (draft-besleaga-
 * sustainability-wellknown): fetch, validate, and transform. Complements
 * `sustainability-wellknown-publisher` (the reference producer).
 */
export * from "./types";
export { RESPONSE_JTD_SCHEMA } from "./schema";
export { validateDocument, assertValid, ValidationError } from "./validate";
export { fetchSustainability, WELL_KNOWN_PATH } from "./fetch";
export type { FetchOptions } from "./fetch";
export { SustainabilityClient } from "./client";
export type { SustainabilityClientOptions } from "./client";
export { isNotReported, withoutSentinels, NUMERIC_KEYS } from "./sentinel";
export { convertEnergy, convertCarbon } from "./units";
export { toCsvRows, toNdjson, flatten, aggregate } from "./transform";
export type { FlatRecord, AggregateOptions } from "./transform";
export { resolveDisclosureLinks, fetchDisclosure } from "./disclosure";
export type { DisclosureLinks } from "./disclosure";
export { runConformanceChecks } from "./conformance";
export type { ConformanceReport, ConformanceCheck, ConformanceOptions } from "./conformance";
