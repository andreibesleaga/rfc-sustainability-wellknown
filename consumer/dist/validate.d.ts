import { SustainabilityDocument } from "./types";
export interface ValidationResult {
    valid: boolean;
    errors: string[];
}
/** Validate a full document (single object or array), incl. cross-entry array rules. */
export declare function validateDocument(doc: unknown): ValidationResult;
export declare class ValidationError extends Error {
    readonly errors: string[];
    constructor(errors: string[]);
}
export declare function assertValid(doc: unknown): SustainabilityDocument;
