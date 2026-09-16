/**
 * sustainability-wellknown-consumer
 *
 * A reference client for `/.well-known/sustainability-data` (draft-besleaga-
 * sustainability-wellknown, revision -07): fetch, validate, verify, and
 * transform. Complements `sustainability-wellknown-publisher` (the reference
 * producer).
 */
export * from "./types";
export { RESPONSE_JTD_SCHEMA } from "./schema";
export {
  MEDIA_TYPE,
  LEGACY_MEDIA_TYPE,
  ACCEPTED_MEDIA_TYPES,
  ACCEPT_HEADER,
  classifyMediaType,
} from "./media-type";
export type { MediaTypeClassification } from "./media-type";
export {
  validateDocument,
  carriesAtLeastOne,
  PERIOD_RE,
  assertValid,
  ValidationError,
  URI_MEMBERS,
  KNOWN_MEMBERS,
  METRIC_MEMBERS,
  isExtensionName,
  extensionNameError,
  isHttpsExtensionName,
  isUrnUuidExtensionName,
  ABSOLUTE_URI_RE,
  URN_UUID_RE,
  RESERVED_EXTENSION_NAMES,
  NIL_UUID_NAME,
  MAX_UUID_NAME,
} from "./validate";
export type { ValidationResult, ValidateOptions } from "./validate";
export {
  fetchSustainability,
  WELL_KNOWN_PATH,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_OBJECTS,
  resolveWellKnownUrl,
} from "./fetch";
export type { FetchOptions } from "./fetch";
export { verifyJws, verifyDeclarationJws, algForKey, DECLARATION_CTY, VC_JWT_MEDIA_TYPE } from "./jws";
export type { PublicJwk, SigningAlg, VerifyPolicy, VerifyReason, VerifyResult } from "./jws";
export { verifyEmbeddedSignature } from "./signature";
export type { EmbeddedSignatureOutcome } from "./signature";
export { deepEqual, differingMembers, withoutSigned } from "./compare";
export { compareUpstream, MAX_UPSTREAM_DEPTH, DEFAULT_MAX_UPSTREAM_RETRIEVALS } from "./upstream";
export type { UpstreamWalkOptions } from "./upstream";
export {
  verifyAttestation,
  verifyCredentialJwt,
  checkCredentialShape,
  checkBinding,
  declarationCopyOf,
  VC_V2_CONTEXT,
} from "./attestation";
export type { AttestationOptions, AttestationResult, AttestationBinding } from "./attestation";
export { isolate } from "./text";
export { isBlockedAddress, systemAddressLookup } from "./transport";
export type { AddressLookup, SecureGetOptions, TransportRefusal } from "./transport";
export { SustainabilityClient } from "./client";
export type { SustainabilityClientOptions } from "./client";
export {
  isNotReported,
  withoutSentinels,
  NUMERIC_KEYS,
  TARGET_TYPES,
  isRecognizedTargetType,
  isWrongJsonType,
  isNonFiniteNumber,
  NUMERIC_MEMBERS,
  legacyReportingSubject,
  OPTIONAL_MEMBER_JSON_TYPES,
} from "./sentinel";
export { convertEnergy, convertCarbon } from "./units";
export { toCsvRows, toNdjson, flatten, aggregate } from "./transform";
export type { FlatRecord, AggregateOptions, AggregateSummary, PeriodRange } from "./transform";
export { resolveDisclosureLinks, fetchDisclosure } from "./disclosure";
export type { DisclosureLinks, FetchDisclosureOptions } from "./disclosure";
export { runConformanceChecks } from "./conformance";
export type {
  ConformanceReport,
  ConformanceCheck,
  ConformanceOptions,
  ConformanceLevel,
  ConformanceOutcome,
} from "./conformance";
