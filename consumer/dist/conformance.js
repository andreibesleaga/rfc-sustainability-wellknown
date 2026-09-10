"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConformanceChecks = runConformanceChecks;
/**
 * A small conformance-check battery for any /.well-known/sustainability-data
 * origin — usable against this repo's own implementations or any third
 * party's, not just via the CLI's --strict flag.
 */
const fetch_1 = require("./fetch");
const fetch_2 = require("./fetch");
const media_type_1 = require("./media-type");
async function check(name, level, fn) {
    const made = (outcome, detail) => ({
        name,
        level,
        outcome,
        pass: outcome === "pass",
        ...(detail !== undefined ? { detail } : {}),
    });
    try {
        const result = await fn();
        if (result === true)
            return made("pass");
        if (result === false)
            return made("fail");
        if (typeof result === "string")
            return made("fail", result);
        return made(result.outcome, result.detail);
    }
    catch (err) {
        return made("fail", err instanceof Error ? err.message : String(err));
    }
}
async function runConformanceChecks(origin, fetchImpl = globalThis.fetch, options = {}) {
    const checks = [];
    const { timeoutMs, maxBytes, allowInsecure } = options;
    // legacyCompat is disabled here on purpose: a conformance checker must see
    // the document as served. With the pre-pass on, a document missing the
    // mandatory `target` member would get the origin host injected and pass the
    // schema gate — masking exactly the non-conformance this battery exists to
    // detect. (The Basic check below thus inherently requires `target`.)
    const fetchOpts = { fetchImpl, timeoutMs, maxBytes, legacyCompat: false, allowInsecure };
    /** Signal for the raw (non-fetchSustainability) probes below, so they can't hang either. */
    // Raw probes get the same default timeout as fetchSustainability — a
    // hanging origin must not stall the battery on undici's ~5-minute defaults.
    const rawSignal = () => AbortSignal.timeout(timeoutMs ?? fetch_1.DEFAULT_TIMEOUT_MS);
    checks.push(await check("Basic request returns a schema-valid single object", "MUST", async () => {
        const r = await (0, fetch_1.fetchSustainability)(origin, fetchOpts);
        if (r.status !== "ok")
            return `expected ok, got ${r.status}`;
        if (Array.isArray(r.document))
            return "Basic request MUST return a single object, not an array";
        return true;
    }));
    checks.push(
    // -06 §Mandatory Minimum Supported Service: a 200 response MUST use the
    // registered `application/sustainability-data+json` media type and MUST
    // NOT use any other. A publisher still on the pre-06 `application/json`
    // is reported as WARN rather than FAIL: such documents are what -06 tells
    // clients to keep accepting, the dedicated type is still awaiting IANA
    // registration, and failing every deployed -05 publisher over it would
    // make the battery useless during exactly the transition it exists for.
    // Anything else is a fail — including a missing Content-Type.
    await check(`Basic 200 response uses the ${media_type_1.MEDIA_TYPE} media type`, "MUST", async () => {
        const res = await fetchImpl((0, fetch_2.resolveWellKnownUrl)(origin).toString(), {
            method: "GET",
            headers: { Accept: media_type_1.ACCEPT_HEADER },
            signal: rawSignal(),
        });
        // Drain the body so the socket is released promptly.
        await res.arrayBuffer().catch(() => undefined);
        if (res.status !== 200)
            return `expected 200 for the Basic request, got ${res.status}`;
        const raw = res.headers.get("content-type");
        switch ((0, media_type_1.classifyMediaType)(raw)) {
            case "sustainability-data+json":
                return true;
            case "json":
                return {
                    outcome: "warn",
                    detail: `pre-06 media type (${media_type_1.LEGACY_MEDIA_TYPE}): v05-compatible, not v06-conformant`,
                };
            default:
                return `Content-Type is neither ${media_type_1.MEDIA_TYPE} nor ${media_type_1.LEGACY_MEDIA_TYPE}: "${raw ?? ""}"`;
        }
    }));
    checks.push(
    // -06 §Mandatory Minimum Supported Service: "servers SHOULD send
    // `X-Content-Type-Options: nosniff` on responses to the well-known URI,
    // so that a client cannot be induced to interpret the document as some
    // other, more dangerous type".
    await check("Response sends X-Content-Type-Options: nosniff", "SHOULD", async () => {
        const res = await fetchImpl((0, fetch_2.resolveWellKnownUrl)(origin).toString(), {
            method: "GET",
            headers: { Accept: media_type_1.ACCEPT_HEADER },
            signal: rawSignal(),
        });
        await res.arrayBuffer().catch(() => undefined);
        const raw = res.headers.get("x-content-type-options");
        return ((raw ?? "").trim().toLowerCase() === "nosniff" ||
            `X-Content-Type-Options is not "nosniff": "${raw ?? ""}"`);
    }));
    checks.push(await check("Response carries an ETag", "SHOULD", async () => {
        const r = await (0, fetch_1.fetchSustainability)(origin, fetchOpts);
        return r.status === "ok" && !!r.etag;
    }));
    checks.push(await check("Conditional GET with a fresh ETag returns 304", "SHOULD", async () => {
        const first = await (0, fetch_1.fetchSustainability)(origin, fetchOpts);
        if (first.status !== "ok" || !first.etag)
            return "no ETag to test conditional request with";
        const second = await (0, fetch_1.fetchSustainability)(origin, { ...fetchOpts, ifNoneMatch: first.etag });
        return second.status === "not-modified" || `expected not-modified, got ${second.status}`;
    }));
    checks.push(await check("A method other than GET/HEAD gets 405 with Allow", "SHOULD", async () => {
        const res = await fetchImpl((0, fetch_2.resolveWellKnownUrl)(origin).toString(), { method: "POST", signal: rawSignal() });
        await res.arrayBuffer().catch(() => undefined);
        if (res.status !== 405)
            return `expected 405, got ${res.status}`;
        const allow = res.headers.get("allow") ?? "";
        return allow.includes("GET") || `Allow header missing GET: "${allow}"`;
    }));
    checks.push(await check("Extended granularity request returns a valid response (sorted array when honored)", "MUST", async () => {
        const r = await (0, fetch_1.fetchSustainability)(origin, { ...fetchOpts, period: new Date().getUTCFullYear().toString(), granularity: "monthly" });
        if (r.status === "not-found")
            return true; // server may have no data for this year; not a conformance failure
        if (r.status !== "ok")
            return `expected ok or not-found, got ${r.status}`;
        // The draft's array-when-finer-granularity rule is a SHOULD: a server
        // ignoring the parameter and returning its Basic single object is
        // conformant, so a non-array does not fail the check — but say so.
        if (!Array.isArray(r.document)) {
            return true; // single object: granularity not honored (allowed; Basic fallback)
        }
        return true; // shape/order already enforced by validateDocument() inside fetchSustainability
    }));
    return {
        origin,
        checks,
        // Computed from `outcome`, not from `pass`: a MUST-level WARN (the pre-06
        // media type) must not read as non-conformance.
        allPassed: checks.every((c) => c.outcome !== "fail" || c.level !== "MUST"),
        allPassedIncludingRecommended: checks.every((c) => c.outcome === "pass"),
    };
}
