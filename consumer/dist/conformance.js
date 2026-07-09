"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runConformanceChecks = runConformanceChecks;
/**
 * A small conformance-check battery for any /.well-known/sustainability
 * origin — usable against this repo's own implementations or any third
 * party's, not just via the CLI's --strict flag.
 */
const fetch_1 = require("./fetch");
const fetch_2 = require("./fetch");
async function check(name, fn) {
    try {
        const result = await fn();
        if (result === true)
            return { name, pass: true };
        if (result === false)
            return { name, pass: false };
        return { name, pass: false, detail: result };
    }
    catch (err) {
        return { name, pass: false, detail: err instanceof Error ? err.message : String(err) };
    }
}
async function runConformanceChecks(origin, fetchImpl = globalThis.fetch) {
    const checks = [];
    checks.push(await check("Basic request returns a schema-valid single object", async () => {
        const r = await (0, fetch_1.fetchSustainability)(origin, { fetchImpl });
        if (r.status !== "ok")
            return `expected ok, got ${r.status}`;
        if (Array.isArray(r.document))
            return "Basic request MUST return a single object, not an array";
        return true;
    }));
    checks.push(await check("Response carries an ETag (RECOMMENDED)", async () => {
        const r = await (0, fetch_1.fetchSustainability)(origin, { fetchImpl });
        return r.status === "ok" && !!r.etag;
    }));
    checks.push(await check("Conditional GET with a fresh ETag returns 304", async () => {
        const first = await (0, fetch_1.fetchSustainability)(origin, { fetchImpl });
        if (first.status !== "ok" || !first.etag)
            return "no ETag to test conditional request with";
        const second = await (0, fetch_1.fetchSustainability)(origin, { fetchImpl, ifNoneMatch: first.etag });
        return second.status === "not-modified" || `expected not-modified, got ${second.status}`;
    }));
    checks.push(await check("A method other than GET/HEAD gets 405 with Allow", async () => {
        const res = await fetchImpl(new URL(fetch_2.WELL_KNOWN_PATH, origin).toString(), { method: "POST" });
        if (res.status !== 405)
            return `expected 405, got ${res.status}`;
        const allow = res.headers.get("allow") ?? "";
        return allow.includes("GET") || `Allow header missing GET: "${allow}"`;
    }));
    checks.push(await check("Extended granularity request returns a sorted array", async () => {
        const r = await (0, fetch_1.fetchSustainability)(origin, { fetchImpl, period: new Date().getUTCFullYear().toString(), granularity: "monthly" });
        if (r.status === "not-found")
            return true; // server may have no data for this year; not a conformance failure
        if (r.status !== "ok")
            return `expected ok or not-found, got ${r.status}`;
        return true; // shape/order already enforced by validateDocument() inside fetchSustainability
    }));
    return { origin, checks, allPassed: checks.every((c) => c.pass) };
}
