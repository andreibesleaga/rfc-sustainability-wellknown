import { SustainabilityDocument } from "./types";
export interface ValidationResult {
    /**
     * True when the document carries NO errors. `warnings` never influence it:
     * a warning is an advisory finding about a document that is valid and
     * usable, and callers (the gateway among them) treat `valid === false` as
     * a hard failure.
     */
    valid: boolean;
    errors: string[];
    /**
     * Advisory findings that do NOT make the document invalid. See
     * {@link URI_MEMBERS}: an absolute non-`https` URI member is reported here,
     * never as an error, and the member is kept.
     */
    warnings: string[];
}
/**
 * The three URI-valued members. Draft -06 §Payload Format: they "MUST be
 * absolute URIs {{RFC3986}} using the 'https' scheme, for the same reason the
 * document itself is served over HTTPS", and "clients MUST NOT automatically
 * dereference a URI member carrying any other scheme".
 */
export declare const URI_MEMBERS: readonly ["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"];
/**
 * Validate a full document (single object or array), incl. cross-entry array
 * rules. `valid` reflects errors ONLY; `warnings` are advisory and never
 * change it.
 */
export declare function validateDocument(doc: unknown): ValidationResult;
export declare class ValidationError extends Error {
    readonly errors: string[];
    constructor(errors: string[]);
}
export declare function assertValid(doc: unknown): SustainabilityDocument;
