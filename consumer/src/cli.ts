/** M2M CLI: fetch (and optionally conformance-check) a /.well-known/sustainability-data origin. */
import { readBodyCapped, secureGet } from "./transport";
import { readFileSync } from "node:fs";
import { fetchSustainability } from "./fetch";
import { toCsvRows, toNdjson } from "./transform";
import { runConformanceChecks } from "./conformance";
import { verifyAttestation, AttestationResult } from "./attestation";
import { PublicJwk } from "./jws";
import { isolate } from "./text";
import { SignatureResult, SustainabilityMetrics } from "./types";

const USAGE =
  "Usage: sustainability-fetch <origin> [--target=] [--period=] [--granularity=] [--format=json|csv|ndjson] [--strict] [--etag=] [--allow-http]\n" +
  "                            [--verify] [--verify-attestation[=<issuer JWK url or file>]]\n" +
  "\n" +
  "  <origin>      Origin to fetch from, e.g. https://example.org — the\n" +
  "                /.well-known/sustainability-data path is appended for you.\n" +
  "                A base URL with a path prefix (a multi-subject gateway, e.g.\n" +
  "                https://gateway.example/cloudflare.com) resolves the well-known\n" +
  "                path under that prefix, and a full document URL is used as-is.\n" +
  "                A bare hostname is promoted to https://.\n" +
  "                Options may appear before or after the origin.\n" +
  "  --allow-http  Permit a plain-HTTP origin. The draft requires HTTPS and says\n" +
  "                clients MUST NOT accept a document retrieved over unauthenticated\n" +
  "                HTTP, so an http:// origin is refused without this flag — use it\n" +
  "                only against a local development server or in CI.\n" +
  "  --verify      Also retrieve /.well-known/sustainability-data.jws (the OPTIONAL\n" +
  "                detached signature) and verify it over the exact bytes served.\n" +
  "                Reports verified / absent / unverified (<reason>); the document's\n" +
  "                own outcome is unchanged either way, as the draft requires.\n" +
  "  --verify-attestation[=<source>]\n" +
  "                Dereference the document's verifiable-attestation-uri (explicitly —\n" +
  "                never automatic) and verify it as a W3C Verifiable Credential secured\n" +
  "                as vc+jwt. <source> pins the issuer's public JWK (an https URL or a\n" +
  "                local file); without it the key in the credential's own header is\n" +
  "                used and the result is reported as self-asserted.\n" +
  "\n" +
  "Examples:\n" +
  "  sustainability-fetch https://example.org\n" +
  "  sustainability-fetch https://example.org --strict\n" +
  "  sustainability-fetch http://127.0.0.1:8080 --strict --allow-http\n" +
  "  sustainability-fetch https://example.org --verify --verify-attestation\n" +
  "  npx -p sustainability-wellknown-consumer sustainability-fetch https://example.org --strict";

/** One line describing a signature outcome, for stderr. */
export function describeSignature(sig: SignatureResult): string {
  switch (sig.status) {
    case "verified":
      return (
        `signature: verified ${sig.alg}${sig.kid ? ` kid=${isolate(sig.kid)}` : ""}` +
        ` (key from ${sig.keySource === "trusted" ? "pinned key" : "signature header"}` +
        `${sig.mediaTypeOk ? "" : `; served as "${sig.mediaType ?? ""}", not application/jose`})`
      );
    case "absent":
      return "signature: absent (the publisher does not sign; not evidence of anything)";
    case "unverified":
      return `signature: unverified (${sig.reason}${sig.detail ? `: ${sig.detail}` : ""}) — the document is unverified, not false`;
    case "not-applicable":
      return "signature: not applicable (the signature covers the parameterless document only)";
  }
}

/** One line describing an attestation outcome, for stderr. */
export function describeAttestation(a: AttestationResult): string {
  if (!a.valid) return `attestation: invalid (${a.reason}${a.detail ? `: ${a.detail}` : ""})`;
  const window = `${a.validFrom}${a.validUntil ? ` .. ${a.validUntil}` : " (no validUntil)"}`;
  const key = a.assurance === "issuer-key-pinned" ? "issuer key pinned" : "self-asserted key from the credential header";
  return `attestation: valid — issuer ${isolate(a.issuer)}, ${a.alg}, valid ${window}, ${key}${a.mediaTypeOk ? "" : `; served as "${a.mediaType ?? ""}", not application/vc+jwt`}`;
}

/** Load pinned issuer keys from an https URL (a JWK or a JWK Set) or a local file. */
async function loadIssuerKeys(source: string): Promise<PublicJwk[]> {
  let text: string;
  if (/^https:\/\//.test(source)) {
    const got = await secureGet(new URL(source), { timeoutMs: 30_000, headers: { Accept: "application/jwk+json, application/jwk-set+json, application/json;q=0.5" } });
    if (!got.ok) throw new Error(`issuer key source ${source}: ${got.refusal.reason}${got.refusal.detail ? ` (${got.refusal.detail})` : ""}`);
    if (got.res.status !== 200) throw new Error(`issuer key source ${source} responded ${got.res.status}`);
    ({ text } = await readBodyCapped(got.res, 65_536));
  } else {
    text = readFileSync(source, "utf8");
  }
  const parsed = JSON.parse(text);
  const keys: unknown[] = Array.isArray(parsed?.keys) ? parsed.keys : [parsed];
  return keys.filter((k): k is PublicJwk => typeof k === "object" && k !== null && !("d" in (k as object)));
}

/** The attestation URI of a fetched document (first entry of an array). */
function attestationUriOf(document: SustainabilityMetrics | SustainabilityMetrics[]): string | undefined {
  const first = Array.isArray(document) ? document[0] : document;
  return first?.["verifiable-attestation-uri"];
}

async function runAttestationCheck(
  document: SustainabilityMetrics | SustainabilityMetrics[],
  source: string | true,
  allowInsecure: boolean,
): Promise<AttestationResult | undefined> {
  const uri = attestationUriOf(document);
  if (!uri) {
    console.error("attestation: none (the document carries no verifiable-attestation-uri)");
    return undefined;
  }
  const trustedIssuerKeys = typeof source === "string" ? await loadIssuerKeys(source) : undefined;
  const result = await verifyAttestation(uri, { trustedIssuerKeys, allowInsecure });
  console.error(describeAttestation(result));
  return result;
}

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

  // Draft MUST: clients MUST NOT accept a document retrieved over
  // unauthenticated HTTP. A bare hostname was already promoted to https above;
  // an explicit http:// origin is a deliberate choice, so it gets a deliberate
  // flag rather than a silent downgrade.
  const allowInsecure = opts["allow-http"] === true;
  if (!allowInsecure && new URL(origin).protocol === "http:") {
    console.error(
      `Refusing plain HTTP for ${origin}: the draft requires HTTPS — pass --allow-http for a local/CI origin.`,
    );
    return 2;
  }

  const verifyAttestationOpt = opts["verify-attestation"] as string | true | undefined;

  if (opts.strict) {
    const report = await runConformanceChecks(origin, undefined, { allowInsecure });
    for (const c of report.checks) {
      // A failed SHOULD is reported as WARN: it is a recommendation the origin
      // did not follow, not a conformance failure, and only MUST failures set
      // a non-zero exit code. A check whose own outcome is "warn" (a pre-06
      // media type) renders the same way, at either level.
      const label =
        c.outcome === "pass" ? "PASS" : c.outcome === "warn" ? "WARN" : c.level === "MUST" ? "FAIL" : "WARN";
      console.log(`${label}  [${c.level}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    if (report.allPassed && !report.allPassedIncludingRecommended) {
      console.log(
        "\nConformant: all MUST-level checks passed. WARN lines are unmet recommendations" +
          " or advisory findings (such as a pre-06 media type).",
      );
    }
    // The signature is part of the battery; the attestation is an explicit extra.
    let attestationOk = true;
    if (verifyAttestationOpt !== undefined) {
      const doc = await fetchSustainability(origin, { allowInsecure, legacyCompat: false });
      if (doc.status === "ok") {
        const a = await runAttestationCheck(doc.document, verifyAttestationOpt, allowInsecure);
        attestationOk = a === undefined || a.valid;
      }
    }
    return report.allPassed && attestationOk ? 0 : 1;
  }

  const result = await fetchSustainability(origin, {
    target: typeof opts.target === "string" ? opts.target : undefined,
    period: typeof opts.period === "string" ? opts.period : undefined,
    granularity: opts.granularity === "monthly" || opts.granularity === "daily" ? opts.granularity : undefined,
    ifNoneMatch: typeof opts.etag === "string" ? opts.etag : undefined,
    allowInsecure,
    verifySignature: opts.verify === true,
  });

  switch (result.status) {
    case "ok": {
      const format = typeof opts.format === "string" ? opts.format : "json";
      if (format === "csv") console.log(toCsvRows(result.document).join("\n"));
      else if (format === "ndjson") console.log(toNdjson(result.document));
      else console.log(JSON.stringify(result.document, null, 2));
      if (result.etag) console.error(`ETag: ${result.etag}`);
      if (result.legacy) {
        console.error(
          "note: the document lacks the mandatory target member (a pre-06 form); target was derived by the " +
            "legacy-compatibility pre-pass and the document is not -06 conformant (use --strict to reject it)",
        );
      }
      if (result.disregarded) console.error(`disregarded (draft tolerance rules): ${result.disregarded.join(", ")}`);
      if (result.signature) console.error(describeSignature(result.signature));
      if (verifyAttestationOpt !== undefined) {
        await runAttestationCheck(result.document, verifyAttestationOpt, allowInsecure);
      }
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
    case "insecure-transport":
      // With an http:// origin already refused above, this can only be an
      // https origin redirecting to plain HTTP — a server-side conformance
      // failure, not a usage error, so it exits 1 like the other fetch faults.
      console.error(`Insecure transport: ${result.detail}`);
      return 1;
  }
}
