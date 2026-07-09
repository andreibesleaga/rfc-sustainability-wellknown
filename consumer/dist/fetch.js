"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WELL_KNOWN_PATH = void 0;
exports.fetchSustainability = fetchSustainability;
const validate_1 = require("./validate");
exports.WELL_KNOWN_PATH = "/.well-known/sustainability";
async function fetchSustainability(origin, options = {}) {
    const doFetch = options.fetchImpl ?? globalThis.fetch;
    if (!doFetch) {
        throw new Error("fetchSustainability: no fetch implementation available; pass options.fetchImpl");
    }
    const url = new URL(exports.WELL_KNOWN_PATH, origin);
    if (options.target)
        url.searchParams.set("target", options.target);
    if (options.period)
        url.searchParams.set("period", options.period);
    if (options.granularity)
        url.searchParams.set("granularity", options.granularity);
    const headers = {};
    if (options.ifNoneMatch)
        headers["If-None-Match"] = options.ifNoneMatch;
    const res = await doFetch(url.toString(), { method: "GET", headers });
    if (res.status === 304)
        return { status: "not-modified" };
    if (res.status === 404)
        return { status: "not-found" };
    if (res.status < 200 || res.status >= 300)
        return { status: "http-error", httpStatus: res.status };
    let parsed;
    try {
        parsed = await res.json();
    }
    catch {
        return { status: "invalid", errors: ["response body is not valid JSON"] };
    }
    const result = (0, validate_1.validateDocument)(parsed);
    if (!result.valid)
        return { status: "invalid", errors: result.errors };
    const etag = res.headers.get("etag") ?? undefined;
    return { status: "ok", document: parsed, etag };
}
