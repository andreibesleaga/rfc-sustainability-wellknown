/**
 * The one-call, zero-extra-dependency client: fetchSustainability(origin, options).
 *
 * Transport rule (draft -06 §Mandatory Minimum Supported Service): "The
 * resource MUST be published and retrieved over HTTPS, and clients MUST NOT
 * accept a Sustainability Metadata Document retrieved over unauthenticated
 * HTTP" — that requirement, and nothing in the data model, is what lets a
 * consumer attribute a document to the origin that served it. It applies to
 * every hop of a followed redirect ("clients that follow a redirect ... MUST
 * require HTTPS for every hop"), so an `http:` FINAL url is refused too.
 * This module therefore refuses a non-HTTPS URL before and after the request,
 * returning `{ status: "insecure-transport" }` rather than throwing. The one
 * escape hatch is `allowInsecure: true`, for a local development server or a
 * CI battery run against `http://127.0.0.1` — there is deliberately NO
 * automatic loopback exemption: the refusal is the specified behaviour and an
 * opt-out has to be written down by the caller.
 *
 * Media typing (same section, -06): the request advertises
 * `application/sustainability-data+json` and, at a lower q-value, the pre-06
 * `application/json`; the response's own type is classified and reported as
 * `mediaType`, but a response is never refused on media type alone.
 */
import { FetchParams, FetchResult } from "./types";
export declare const WELL_KNOWN_PATH = "/.well-known/sustainability-data";
/**
 * Resolves the well-known document URL for an origin or base URL.
 *
 * Three input shapes are accepted:
 *  - a plain origin (`https://example.org`) — the ordinary RFC 8615 case: the
 *    well-known path is resolved at the origin root;
 *  - a base URL with a path prefix (`https://gateway.example/cloudflare.com`) —
 *    the well-known path is resolved UNDER the prefix. This is the multi-subject
 *    gateway/mirror pattern, where one origin republishes documents for many
 *    reporting subjects at `/{subject}/.well-known/sustainability-data`;
 *  - the full document URL itself — used as-is, so a copy-pasted URL works.
 */
export declare function resolveWellKnownUrl(origin: string): URL;
/**
 * Default overall request timeout (ms). A non-responding origin must not hang
 * the caller forever; 30s is a generous ceiling for a well-known GET that a
 * server SHOULD be serving from cache (see draft §Operational Considerations).
 */
export declare const DEFAULT_TIMEOUT_MS = 30000;
/**
 * Default response-body byte cap. The document is small by design (a handful of
 * metrics, or a bounded trend array — the draft RECOMMENDS at most 366 entries).
 * 10 MB is far above any legitimate payload while bounding memory against a
 * hostile or misbehaving origin sending a multi-GB body.
 */
export declare const DEFAULT_MAX_BYTES = 10000000;
export interface FetchOptions extends FetchParams {
    ifNoneMatch?: string;
    /** Injectable for older runtimes or tests; defaults to the global fetch (Node 18+). */
    fetchImpl?: typeof fetch;
    /** Abort the request if the response has not completed within this many ms (default {@link DEFAULT_TIMEOUT_MS}). */
    timeoutMs?: number;
    /** Reject a response body larger than this many bytes, without buffering it (default {@link DEFAULT_MAX_BYTES}). */
    maxBytes?: number;
    /**
     * Opt out of the HTTPS requirement (default false — the requirement is
     * unconditional in the draft, and the draft makes no exception for
     * constrained or legacy origins).
     *
     * With the default, a URL whose scheme is not `https:` — and an `http:`
     * FINAL url after a redirect, where the runtime exposes one — is refused
     * with `{ status: "insecure-transport" }` before the document is used.
     * Set true ONLY for a local development server or a CI run against an
     * `http://127.0.0.1` instance; there is no loopback exemption on purpose.
     */
    allowInsecure?: boolean;
    /**
     * Legacy-compatibility pre-pass (default true). Draft §Versioning and
     * Extensibility (-04): a document without the mandatory `target` member is
     * historical ("1.0"/"1.1"). Before validation, such a document (object, or
     * every entry of an array) gets `target` derived: from the historical
     * `target-path` member's VALUE when that member is present (it named the
     * reporting subject), otherwise from the final-response origin's host
     * (an origin-wide report; redirects are attributed to the final origin,
     * per the draft). Such a result is flagged with `legacy: true`.
     *
     * The same pre-pass applies the draft's tolerance rules (§Value Constraints
     * and Omitted Metrics), stripping the affected member before validation and
     * recording it in `disregarded` (mirroring how out-of-range numerics read as
     * "not reported" without failing the document):
     *  - a defined OPTIONAL member whose value has the wrong JSON type
     *    (including `null`) is treated as not reported;
     *  - a reported `sci-score` unaccompanied by `functional-unit` is treated
     *    as not reported (a negative sci-score is the legacy sentinel, already
     *    "not reported" under the out-of-range rule, and is left for
     *    sentinel.ts's on-demand interpretation);
     *  - an unrecognized value in the enumerated `target-type` member is
     *    disregarded — `target` is then interpreted as if it were absent.
     *
     * A received EMPTY ARRAY — which a conformant server never sends (it follows
     * the no-data rule instead) — SHOULD be treated as conveying no report, and
     * yields the distinct `{ status: "no-report" }` outcome.
     *
     * Set to false for strict mode: the document is validated exactly as served —
     * legacy documents, wrong-typed values, a reported sci-score without
     * functional-unit, unrecognized target-type values, and empty arrays then
     * fail validation.
     */
    legacyCompat?: boolean;
}
export declare function fetchSustainability(origin: string, options?: FetchOptions): Promise<FetchResult>;
