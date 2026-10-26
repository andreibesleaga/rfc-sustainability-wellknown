/**
 * sustainability-wellknown-consumer
 *
 * A reference client for `/.well-known/sustainability-data` (draft-besleaga-
 * sustainability-wellknown, revision -10): fetch, validate, verify, and
 * transform. Complements `sustainability-wellknown-publisher` (the reference
 * producer).
 */
export * from "./types";
export * from "./tokens";
export * from "./period";
export { parseStrict } from "./json";
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
  assertValid,
  ValidationError,
  URI_MEMBERS,
  KNOWN_MEMBERS,
  METRIC_MEMBERS,
  isExtensionName,
  extensionNameError,
  isUriReference,
} from "./validate";
export type { ValidationResult, ValidationWarning, WarningCode } from "./validate";
export {
  fetchSustainability,
  WELL_KNOWN_PATH,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_OBJECTS,
  resolveWellKnownUrl,
  queryBound,
} from "./fetch";
export type { FetchOptions } from "./fetch";
export { verifyJws, verifyDeclarationJws, algForKey, algsForKey, DECLARATION_CTY, VC_JWT_MEDIA_TYPE } from "./jws";
export type { KeyTrust, PublicJwk, SigningAlg, VerifyPolicy, VerifyReason, VerifyResult } from "./jws";
export { verifyEmbeddedSignature } from "./signature";
export type { EmbeddedSignatureOutcome, HeldReading, SignatureOptions, SignaturePolicy } from "./signature";
export { deepEqual, differingMembers, withoutSigned } from "./compare";
export { DEFAULT_MAX_DEPTH } from "./body";
export { compareUpstream, MAX_UPSTREAM_DEPTH, DEFAULT_MAX_UPSTREAM_RETRIEVALS } from "./upstream";
export type { UpstreamWalkOptions } from "./upstream";
export {
  verifyAttestation,
  verifyCredentialJwt,
  checkCredentialShape,
  checkBinding,
  checkCoverage,
  declarationCopyOf,
  VC_V2_CONTEXT,
} from "./attestation";
export type { AttestationOptions, AttestationResult, AttestationBinding, AttestationCoverage } from "./attestation";
export { isolate } from "./text";
export { isBlockedAddress, systemAddressLookup, secureGet } from "./transport";
export type { AddressLookup, SecureGetOptions, TransportRefusal } from "./transport";
export { SustainabilityClient } from "./client";
export type { SustainabilityClientOptions } from "./client";
export { isNotReported, withoutSentinels, NUMERIC_KEYS, applyCompatibilityReading, readDocument } from "./sentinel";
export type { CompatReport } from "./sentinel";
export { convertEnergy, convertCarbon } from "./units";
export { toCsvRows, toNdjson, flatten, total, aggregate, TotalPreconditionError } from "./transform";
export type { ExportSource, FlatRecord, TotalOptions, TotalRefusal, TotalSummary } from "./transform";
export { resolveDisclosureLinks, fetchDisclosure, DisclosureError } from "./disclosure";
export type { DisclosureContent, DisclosureLinks, FetchDisclosureOptions } from "./disclosure";
export { processExtensions } from "./extensions";
export type { ExtensionHandler, ExtensionOutcome } from "./extensions";
export { runConformanceChecks } from "./conformance";
export type {
  ConformanceReport,
  ConformanceCheck,
  ConformanceOptions,
  ConformanceLevel,
  ConformanceOutcome,
} from "./conformance";
