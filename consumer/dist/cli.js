"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCli = runCli;
/** M2M CLI: fetch (and optionally conformance-check) a /.well-known/sustainability origin. */
const fetch_1 = require("./fetch");
const transform_1 = require("./transform");
const conformance_1 = require("./conformance");
function parseArgs(argv) {
    const [origin, ...rest] = argv;
    const opts = {};
    for (const arg of rest) {
        const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
        if (m)
            opts[m[1]] = m[2] ?? true;
    }
    return { origin, opts };
}
/** Runs the CLI for the given argv (excluding `node script.js`); returns the process exit code. */
async function runCli(argv) {
    const { origin, opts } = parseArgs(argv);
    if (!origin) {
        console.error("Usage: sustainability-fetch <origin> [--target=] [--period=] [--granularity=] [--format=json|csv|ndjson] [--strict] [--etag=]");
        return 2;
    }
    if (opts.strict) {
        const report = await (0, conformance_1.runConformanceChecks)(origin);
        for (const c of report.checks) {
            console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
        }
        return report.allPassed ? 0 : 1;
    }
    const result = await (0, fetch_1.fetchSustainability)(origin, {
        target: typeof opts.target === "string" ? opts.target : undefined,
        period: typeof opts.period === "string" ? opts.period : undefined,
        granularity: opts.granularity === "monthly" || opts.granularity === "daily" ? opts.granularity : undefined,
        ifNoneMatch: typeof opts.etag === "string" ? opts.etag : undefined,
    });
    switch (result.status) {
        case "ok": {
            const format = typeof opts.format === "string" ? opts.format : "json";
            if (format === "csv")
                console.log((0, transform_1.toCsvRows)(result.document).join("\n"));
            else if (format === "ndjson")
                console.log((0, transform_1.toNdjson)(result.document));
            else
                console.log(JSON.stringify(result.document, null, 2));
            if (result.etag)
                console.error(`ETag: ${result.etag}`);
            return 0;
        }
        case "not-modified":
            console.error("304 Not Modified");
            return 0;
        case "not-found":
            console.error("404 Not Found");
            return 1;
        case "invalid":
            console.error("Response failed validation:\n" + result.errors.map((e) => ` - ${e}`).join("\n"));
            return 1;
        case "http-error":
            console.error(`HTTP error: ${result.httpStatus}`);
            return 1;
    }
}
