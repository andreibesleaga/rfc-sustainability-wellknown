/** M2M CLI: fetch (and optionally conformance-check) a /.well-known/sustainability-data origin. */
import { fetchSustainability } from "./fetch";
import { toCsvRows, toNdjson } from "./transform";
import { runConformanceChecks } from "./conformance";

const USAGE =
  "Usage: sustainability-fetch <origin> [--target=] [--period=] [--granularity=] [--format=json|csv|ndjson] [--strict] [--etag=]\n" +
  "\n" +
  "  <origin>  Origin to fetch from, e.g. https://example.org — the\n" +
  "            /.well-known/sustainability-data path is appended for you.\n" +
  "            Options may appear before or after the origin.\n" +
  "\n" +
  "Examples:\n" +
  "  sustainability-fetch https://example.org\n" +
  "  sustainability-fetch https://example.org --strict\n" +
  "  npx -p sustainability-wellknown-consumer sustainability-fetch https://example.org --strict";

/**
 * Options may appear in any position, so `--strict <origin>` works as well as
 * `<origin> --strict`. A leading bare `sustainability-fetch` is dropped: `npx
 * <pkg> sustainability-fetch ...` passes the bin name through as an argument,
 * and reading it as the origin produced a bare "Invalid URL" crash.
 */
function parseArgs(argv: string[]) {
  const opts: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) opts[m[1]] = m[2] ?? true;
    else if (arg === "-h") opts.help = true;
    else positional.push(arg);
  }
  if (positional[0] === "sustainability-fetch") positional.shift();
  return { origin: positional[0], opts };
}

/** Accepts an absolute http(s) origin; bare hostnames are promoted to https. */
export function normalizeOrigin(input: string): string | undefined {
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
}

/** Runs the CLI for the given argv (excluding `node script.js`); returns the process exit code. */
export async function runCli(argv: string[]): Promise<number> {
  const { origin: rawOrigin, opts } = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  if (!rawOrigin) {
    console.error(USAGE);
    return 2;
  }

  const origin = normalizeOrigin(rawOrigin);
  if (!origin) {
    console.error(`Not a usable origin: "${rawOrigin}"\n\n${USAGE}`);
    return 2;
  }

  if (opts.strict) {
    const report = await runConformanceChecks(origin);
    for (const c of report.checks) {
      // A failed SHOULD is reported as WARN: it is a recommendation the origin
      // did not follow, not a conformance failure, and only MUST failures set
      // a non-zero exit code.
      const label = c.pass ? "PASS" : c.level === "MUST" ? "FAIL" : "WARN";
      console.log(`${label}  [${c.level}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    if (report.allPassed && !report.allPassedIncludingRecommended) {
      console.log("\nConformant: all MUST-level checks passed. WARN lines are unmet recommendations.");
    }
    return report.allPassed ? 0 : 1;
  }

  const result = await fetchSustainability(origin, {
    target: typeof opts.target === "string" ? opts.target : undefined,
    period: typeof opts.period === "string" ? opts.period : undefined,
    granularity: opts.granularity === "monthly" || opts.granularity === "daily" ? opts.granularity : undefined,
    ifNoneMatch: typeof opts.etag === "string" ? opts.etag : undefined,
  });

  switch (result.status) {
    case "ok": {
      const format = typeof opts.format === "string" ? opts.format : "json";
      if (format === "csv") console.log(toCsvRows(result.document).join("\n"));
      else if (format === "ndjson") console.log(toNdjson(result.document));
      else console.log(JSON.stringify(result.document, null, 2));
      if (result.etag) console.error(`ETag: ${result.etag}`);
      return 0;
    }
    case "not-modified":
      console.error("304 Not Modified");
      return 0;
    case "not-found":
      console.error("404 Not Found");
      return 1;
    case "no-report":
      // 200 with an empty array: treated as conveying no report (draft SHOULD).
      console.error("Empty array response: no report conveyed");
      return 1;
    case "invalid":
      console.error("Response failed validation:\n" + result.errors.map((e) => ` - ${e}`).join("\n"));
      return 1;
    case "http-error":
      console.error(`HTTP error: ${result.httpStatus}`);
      return 1;
    case "timeout":
      console.error(`Request timed out after ${result.timeoutMs} ms`);
      return 1;
    case "too-large":
      console.error(`Response too large: ${result.detail}`);
      return 1;
  }
}
