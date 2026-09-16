/** M2M CLI: fetch (and optionally conformance-check) a /.well-known/sustainability-data origin. */
import { readBodyCapped, secureGet } from "./transport";
import { readFileSync } from "node:fs";
import { fetchSustainability } from "./fetch";
import { toCsvRows, toNdjson } from "./transform";
import { runConformanceChecks } from "./conformance";
import { verifyAttestation, AttestationResult } from "./attestation";
import { PublicJwk } from "./jws";
import { isolate } from "./text";
import { SignatureResult, SustainabilityDocument, SustainabilityMetrics, UpstreamComparison } from "./types";

const USAGE =
  "Usage: sustainability-fetch <origin> [--target=] [--period=] [--granularity=] [--format=json|csv|ndjson] [--strict] [--etag=] [--allow-http]\n" +
  "                            [--verify] [--upstream] [--verify-attestation[=<issuer JWK url or file>]]\n" +
  "\n" +
  "  <origin>      Origin to fetch from, e.g. https://example.org — the\n" +
  "                /.well-known/sustainability-data path is appended for you.\n" +
  "                A base URL with a path prefix (a multi-subject gateway, e.g.\n" +
  "                https://gateway.example/cloudflare.com) resolves the well-known\n" +
  "                path under that prefix, and a full declaration URL is used as-is.\n" +
  "                A bare hostname is promoted to https://.\n" +
  "                Options may appear before or after the origin.\n" +
  "  --allow-http  Permit a plain-HTTP origin. The draft requires HTTPS and says\n" +
  "                a consumer MUST NOT accept a declaration retrieved over\n" +
  "                unauthenticated HTTP, so an http:// origin is refused without\n" +
  "                this flag — use it only against a local server or in CI.\n" +
  "  --verify      Verify the OPTIONAL `signed` member of each declaration object\n" +
  "                (a JWS over the object itself). Reports verified / unsigned /\n" +
  "                unverified (<reason>); the declaration's own outcome is\n" +
  "                unchanged either way, as the draft requires.\n" +
  "  --upstream    Retrieve the declarations named by `upstream` (depth 3 at most,\n" +
  "                loops refused, total retrievals bounded) and compare their\n" +
  "                figures for the same reporting-period: consistent /\n" +
  "                under-reported / not-comparable / unreachable. A subject cannot\n" +
  "                report less than a tenant-scoped upstream states it delivered;\n" +
  "                one that does is under-reported. The comparison is defined only\n" +
  "                for a tenant-scoped upstream declaration; any other is reported\n" +
  "                as fetched but not comparable. Only energy-consumption and\n" +
  "                carbon-footprint are compared, and carbon-footprint only where\n" +
  "                both objects declare the same carbon-accounting value or\n" +
  "                neither declares one; otherwise it is skipped, the reason is\n" +
  "                printed, and the energy comparison still proceeds. Each entry\n" +
  "                is compared on its own. This is evidence about consistency\n" +
  "                between two self-asserted claims, never proof of either, and\n" +
  "                under-reported is something to investigate, not a failure to\n" +
  "                conform.\n" +
  "  --verify-attestation[=<source>]\n" +
  "                Dereference the declaration's verifiable-attestation-uri\n" +
  "                (explicitly — never automatic) and verify it as a W3C Verifiable\n" +
  "                Credential secured as vc+jwt, then compare the copy of the\n" +
  "                declaration it carries with the object served. <source> pins the\n" +
  "                issuer's public JWK (an https URL or a local file); without it the\n" +
  "                key in the credential's own header is used and the result is\n" +
  "                reported as self-asserted.\n" +
  "\n" +
  "Examples:\n" +
  "  sustainability-fetch https://example.org\n" +
  "  sustainability-fetch https://example.org --strict\n" +
  "  sustainability-fetch http://127.0.0.1:8080 --strict --allow-http\n" +
  "  sustainability-fetch https://example.org --verify --upstream --verify-attestation\n" +
  "  npx -p sustainability-wellknown-consumer sustainability-fetch https://example.org --strict";

/** One line describing a signature outcome, for stderr. */
export function describeSignature(sig: SignatureResult, index?: number): string {
  const at = index === undefined ? "" : `[${index}] `;
  switch (sig.status) {
    case "verified": {
      // Which members the caller is looking at depends on how far the key is
      // trusted (draft -07 §Verification), so the line says so outright.
      const source =
        sig.precedence === "payload"
          ? "key from pinned key; the payload's members take precedence and are the ones reported"
          : "key from signature header, trusted no further than the declaration carrying it; the members served by " +
            "the origin are the ones reported — integrity and key continuity only";
      return (
        `signature: ${at}verified ${sig.alg}${sig.kid ? ` kid=${isolate(sig.kid)}` : ""}` +
        ` (${source}${sig.modifiedAfterSigning ? "; the served members DIFFER from the signed payload" : ""})`
      );
    }
    case "unsigned":
      return `signature: ${at}unsigned (the publisher did not sign; not evidence of anything)`;
    case "unverified":
      return `signature: ${at}unverified (${sig.reason}${sig.detail ? `: ${sig.detail}` : ""}) — the object is unverified, not false`;
  }
}

/** One line per upstream comparison, for stderr. */
export function describeUpstream(c: UpstreamComparison): string {
  const indent = "  ".repeat(c.depth - 1);
  const figures =
    c.subject || c.upstreamFigures
      ? ` [subject ${formatFigures(c.subject)} vs upstream ${formatFigures(c.upstreamFigures)}]`
      : "";
  // A retrieved upstream is read with the draft's tolerance rules, like any
  // other declaration; say so where they were applied rather than comparing on
  // a quietly altered reading.
  const disregarded =
    c.upstreamDisregarded && c.upstreamDisregarded.length > 0
      ? ` [disregarded in the upstream declaration (draft tolerance rules): ${c.upstreamDisregarded.map(isolate).join(", ")}]`
      : "";
  return `upstream: ${indent}${isolate(c.declaration)}${c.role ? ` (${c.role})` : ""} — ${c.verdict}: ${c.detail}${figures}${disregarded}`;
}

function formatFigures(f?: { energyKWh?: number; carbonGCO2e?: number }): string {
  if (!f || (f.energyKWh === undefined && f.carbonGCO2e === undefined)) return "no figures";
  const parts: string[] = [];
  if (f.energyKWh !== undefined) parts.push(`${f.energyKWh} kWh`);
  if (f.carbonGCO2e !== undefined) parts.push(`${f.carbonGCO2e} gCO2e`);
  return parts.join(", ");
}

function flattenUpstream(list: UpstreamComparison[]): UpstreamComparison[] {
  return list.flatMap((c) => [c, ...flattenUpstream(c.upstream ?? [])]);
}

/** One line describing an attestation outcome, for stderr. */
export function describeAttestation(a: AttestationResult): string {
  if (!a.valid) return `attestation: invalid (${a.reason}${a.detail ? `: ${a.detail}` : ""})`;
  const window = `${a.validFrom}${a.validUntil ? ` .. ${a.validUntil}` : " (no validUntil)"}`;
  const key = a.assurance === "issuer-key-pinned" ? "issuer key pinned" : "self-asserted key from the credential header";
  const binding =
    a.binding.status === "match"
      ? "; the credential carries a copy of this declaration and it matches"
      : a.binding.status === "mismatch"
        ? `; the credential's copy of the declaration DIFFERS (${a.binding.differences.join(", ")})`
        : a.binding.status === "no-copy"
          ? "; the credential carries no copy of the declaration, so it attests something else"
          : "";
  return `attestation: valid — issuer ${isolate(a.issuer)}, ${a.alg}, valid ${window}, ${key}${binding}${a.mediaTypeOk ? "" : `; served as "${a.mediaType ?? ""}", not application/vc+jwt`}`;
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

/** The first declaration object of a fetched declaration (an array conveys a trend). */
function firstObject(document: SustainabilityDocument): SustainabilityMetrics | undefined {
  return Array.isArray(document) ? document[0] : document;
}

async function runAttestationCheck(
  document: SustainabilityDocument,
  source: string | true,
  allowInsecure: boolean,
): Promise<AttestationResult | undefined> {
  const first = firstObject(document);
  const uri = first?.["verifiable-attestation-uri"];
  if (!uri) {
    console.error("attestation: none (the declaration carries no verifiable-attestation-uri)");
    return undefined;
  }
  const trustedIssuerKeys = typeof source === "string" ? await loadIssuerKeys(source) : undefined;
  // The credential binds to the declaration by carrying a copy of it: the
  // object compared is the one this consumer reports (the verified `signed`
  // payload when there was one, since its members take precedence).
  const result = await verifyAttestation(uri, { trustedIssuerKeys, allowInsecure, declaration: first });
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

  // Draft MUST: a consumer MUST NOT accept a declaration retrieved over
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
      // a non-zero exit code. A check whose own outcome is "warn" (the generic
      // media type) renders the same way, at either level.
      const label =
        c.outcome === "pass" ? "PASS" : c.outcome === "warn" ? "WARN" : c.level === "MUST" ? "FAIL" : "WARN";
      console.log(`${label}  [${c.level}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    if (report.allPassed && !report.allPassedIncludingRecommended) {
      console.log(
        "\nConformant: all MUST-level checks passed. WARN lines are unmet recommendations" +
          " or advisory findings (such as the generic media type).",
      );
    }
    // The signature is part of the battery; the attestation is an explicit extra.
    let attestationOk = true;
    if (verifyAttestationOpt !== undefined) {
      const doc = await fetchSustainability(origin, { allowInsecure, legacyCompat: false, verifySignature: true });
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
    followUpstream: opts.upstream === true,
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
          "note: the declaration lacks the mandatory target member (a pre-06 form); target was derived by the " +
            "legacy-compatibility pre-pass and the declaration is not conformant (use --strict to reject it)",
        );
      }
      if (result.disregarded) console.error(`disregarded (draft tolerance rules): ${result.disregarded.join(", ")}`);
      if (result.notAsRequested) {
        for (const m of result.notAsRequested) console.error(`not as requested: ${m}`);
      }
      if (result.redirectedAcrossOrigins) {
        const r = result.redirectedAcrossOrigins;
        console.error(
          `cross-origin redirect: ${r.queried} redirected to ${r.final}, so this declaration is a claim by ${r.final}` +
            (r.attributable
              ? `; its target names ${r.queried}, so it may also be recorded against the origin queried`
              : `; its target does not name ${r.queried}, so it MUST NOT be recorded as a declaration of ${r.queried}`),
        );
      }
      if (result.warnings) for (const w of result.warnings) console.error(`warning: ${w}`);
      if (result.signatures) {
        const many = result.signatures.length > 1;
        result.signatures.forEach((s, i) => console.error(describeSignature(s, many ? i : undefined)));
      }
      if (result.upstream) {
        for (const c of flattenUpstream(result.upstream)) console.error(describeUpstream(c));
        console.error(
          "upstream: the comparison above is evidence about consistency between two self-asserted claims, never proof of either.",
        );
        console.error(
          "upstream: each entry is compared on its own — no relation is defined over several of them together — and an " +
            "under-reported verdict is something to investigate, not a failure to conform (whether the subject's declared " +
            "scope covers a given upstream cannot be expressed in this format).",
        );
      } else if (opts.upstream === true) {
        console.error("upstream: none (the declaration names no upstream providers)");
      }
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
    case "wrong-media-type":
      console.error(
        `Not a declaration: the response was served as "${result.mediaType ?? "(no Content-Type)"}" — ` +
          "the draft accepts only application/sustainability-data+json (or the generic application/json).",
      );
      return 1;
    case "too-many-objects":
      console.error(`Response carried ${result.count} declaration objects, above this consumer's limit of ${result.max}`);
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
    case "refused-uri":
      // Nothing was sent: this consumer declined to dereference the URI. The
      // detail says which address the host resolved to, or that the URI carried
      // credentials — an operator reading a CI log needs that, not just "failed".
      console.error(`Refused to dereference (${result.reason}): ${result.detail}`);
      if (result.reason === "blocked-address") {
        console.error(
          "note: pass --allow-http to reach a local development origin, or set allowPrivateAddresses on the " +
            "library call to reach a private address over HTTPS deliberately.",
        );
      }
      return 1;
    case "insecure-transport":
      // With an http:// origin already refused above, this can only be an
      // https origin redirecting to plain HTTP — a server-side conformance
      // failure, not a usage error, so it exits 1 like the other fetch faults.
      console.error(`Insecure transport: ${result.detail}`);
      return 1;
  }
}
