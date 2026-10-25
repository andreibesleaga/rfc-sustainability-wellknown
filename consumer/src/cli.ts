/** M2M CLI: fetch (and optionally conformance-check) a /.well-known/sustainability-data origin. */
import { readBodyCapped, secureGet } from "./transport";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fetchSustainability } from "./fetch";
import { toCsvRows, toNdjson, total, TotalPreconditionError } from "./transform";
import { runConformanceChecks } from "./conformance";
import { verifyAttestation, AttestationResult } from "./attestation";
import { fetchDisclosure } from "./disclosure";
import { dateTimeError } from "./period";
import { GRANULARITIES } from "./tokens";
import { PublicJwk } from "./jws";
import type { SignaturePolicy } from "./signature";
import { isolate } from "./text";
import { SignatureResult, SustainabilityDocument, SustainabilityMetrics, UpstreamComparison } from "./types";

const USAGE =
  "Usage: sustainability-fetch <origin> [--target=] [--start=] [--end=] [--granularity=yearly|monthly|daily]\n" +
  "                            [--format=json|csv|ndjson] [--total] [--strict] [--etag=] [--allow-http] [--allow-private]\n" +
  "                            [--verify] [--require-signed] [--trusted-key=<file>] [--trust-anchor=<file>] [--pin=<file>]\n" +
  "                            [--upstream] [--disclosure] [--verify-attestation[=<issuer JWK url or file>]]\n" +
  "                            [--max-bytes=] [--max-objects=] [--max-retrievals=] [--timeout=<seconds>]\n" +
  "\n" +
  "  <origin>      Origin to fetch from, e.g. https://example.org — the\n" +
  "                /.well-known/sustainability-data path is appended for you.\n" +
  "                A base URL with a path prefix (a multi-subject gateway, e.g.\n" +
  "                https://gateway.example/cloudflare.com) resolves the well-known\n" +
  "                path under that prefix, and a full declaration URL is used as-is.\n" +
  "                A bare hostname is promoted to https://.\n" +
  "                Options may appear before or after the origin.\n" +
  "  --start=, --end=\n" +
  "                Ask for the objects whose period overlaps the range. Each is an\n" +
  "                RFC 3339 date-time; any offset is accepted and sent in UTC with\n" +
  "                Z, e.g. --start=2025-01-01T00:00:00Z --end=2026-01-01T00:00:00Z\n" +
  "                (end excluded). An origin may ignore them: every object is\n" +
  "                reported with the period it names, never the one asked for.\n" +
  "  --target=     Ask for the objects of one target (a host, or a path prefix\n" +
  "                that begins with /).\n" +
  "  --granularity=\n" +
  "                Ask for the objects that are whole calendar years, months or days.\n" +
  "  --format=     json (default), csv or ndjson. Every csv row and ndjson line\n" +
  "                carries the URL the declaration was retrieved from, the origin\n" +
  "                that claims it and the signature outcome.\n" +
  "  --total       Print the sum of the figures instead of the declaration. Only\n" +
  "                objects of one target whose periods do not overlap and that\n" +
  "                share one carbon-accounting value (or none) are added; else the\n" +
  "                reason is printed and the exit code is 1.\n" +
  "  --allow-http  Permit a plain-HTTP origin. The draft requires that a\n" +
  "                declaration be published and retrieved over HTTPS, so an\n" +
  "                http:// origin is refused without this flag; use it only\n" +
  "                against a local server or in CI. It also permits loopback\n" +
  "                addresses, and nothing else.\n" +
  "  --allow-private  Permit a private, link-local or other non-public address\n" +
  "                (an origin on your own network). Separate from --allow-http.\n" +
  "  --strict      Run the conformance battery against the origin instead (alias\n" +
  "                --conformance); exit 1 when a MUST-level check fails.\n" +
  "  --verify      Verify the OPTIONAL `signed` member of each declaration object\n" +
  "                (a JWS over the object itself). Reports verified / unsigned /\n" +
  "                unverified (<reason>); the declaration's own outcome is\n" +
  "                unchanged either way, as the draft requires.\n" +
  "  --require-signed\n" +
  "                Fail unless every object carries a signed member that verifies;\n" +
  "                the failure names each object that does not (counting from 1).\n" +
  "  --trusted-key=<file>\n" +
  "                A public JWK (or JWK Set) you obtained independently of the\n" +
  "                declaration. A signature that verifies under it is out-of-band\n" +
  "                trusted and its payload members are the ones reported. A key\n" +
  "                the declaration names by URL (jku, x5u) is never fetched.\n" +
  "  --trust-anchor=<file>\n" +
  "                A certificate authority (PEM) for an x5c chain in the header;\n" +
  "                the end-entity certificate must name the host of the origin.\n" +
  "  --pin=<file>  A JSON store of keys by origin. The key of the first verified\n" +
  "                signature is recorded; a later declaration signed with another\n" +
  "                key is reported as pin-mismatch and is not accepted.\n" +
  "  --upstream    Retrieve the declarations named by `upstream` (alias\n" +
  "                --follow-upstream; depth 3 at most, no URI twice, retrievals\n" +
  "                bounded by --max-retrievals) and compare their figures for the\n" +
  "                same period. A subject cannot report less than a tenant-scoped\n" +
  "                upstream states it delivered; one that does is reported as an\n" +
  "                inconsistency of two claims, to investigate, never a failure.\n" +
  "                Only energy-consumption and carbon-footprint are compared, and\n" +
  "                carbon-footprint only where both objects declare the same\n" +
  "                carbon-accounting value or neither declares one.\n" +
  "  --disclosure  Retrieve disclosure-uri, resolved against the URL the declaration\n" +
  "                came from, and report its media type and size. Nothing is\n" +
  "                concluded from it. Without a disclosure-uri no request is made.\n" +
  "  --verify-attestation[=<source>]\n" +
  "                Dereference the declaration's verifiable-attestation-uri\n" +
  "                (explicitly — never automatic) and verify it as a W3C Verifiable\n" +
  "                Credential secured as vc+jwt, then compare the copy of the\n" +
  "                declaration it carries with the object served. <source>, or\n" +
  "                --trusted-issuer=<source>, pins the issuer's public JWK (an https\n" +
  "                URL or a local file); without it the key in the credential's own\n" +
  "                header is used, the result is self-asserted and the object is not\n" +
  "                reported as attested.\n" +
  "  --max-bytes=, --max-objects=\n" +
  "                Limit the decoded bytes (default 10000000) and the objects\n" +
  "                (default 500) accepted.\n" +
  "  --max-retrievals=\n" +
  "                Limit the declarations retrieved by one --upstream walk (default 20).\n" +
  "  --timeout=    Seconds to wait for one request (default 30).\n" +
  "\n" +
  "Exit codes: 0 done; 1 the origin or the declaration failed a check or could not be\n" +
  "read; 2 a usage error.\n" +
  "\n" +
  "Examples:\n" +
  "  sustainability-fetch https://example.org\n" +
  "  sustainability-fetch https://example.org --strict\n" +
  "  sustainability-fetch http://127.0.0.1:8080 --strict --allow-http\n" +
  "  sustainability-fetch https://example.org --start=2025-01-01T00:00:00Z --end=2026-01-01T00:00:00Z --granularity=monthly --total\n" +
  "  sustainability-fetch https://example.org --verify --upstream --verify-attestation\n" +
  "  npx -p sustainability-wellknown-consumer sustainability-fetch https://example.org --strict";

/** One line describing a signature outcome, for stderr. */
export function describeSignature(sig: SignatureResult, index?: number): string {
  const at = index === undefined ? "" : `[${index}] `;
  switch (sig.status) {
    case "verified": {
      // What a verified signature says is fixed by the draft: the holder of the
      // key signed these members, which shows integrity (and, for a held key,
      // continuity of authorship) and nothing about accuracy or about who the
      // holder is. provider is never matched against the key.
      const alg = sig.deprecatedAlg ? "EdDSA (deprecated identifier, same algorithm as Ed25519)" : sig.alg;
      const members =
        sig.precedence === "payload"
          ? "the signed members are the ones reported"
          : "the key is trusted no further than the declaration carrying it, so the members served by the origin are the ones reported";
      const continuity = sig.keyTrust === "pinned" || sig.keyTrust === "out-of-band" ? " (continuity of authorship)" : "";
      return (
        `signature: ${at}integrity verified ${alg}${sig.kid ? ` kid=${isolate(sig.kid)}` : ""}: the holder of the key with thumbprint ${sig.thumbprint} ` +
        `signed the other members of this object only, not the array around it, the HTTP header fields or the retrieval URI; ` +
        `key trust: ${sig.keyTrust}${continuity}; ${members}; accuracy unknown` +
        (sig.modifiedAfterSigning ? `; the served members DIFFER from the signed payload (${(sig.modifiedMembers ?? []).join(", ")})` : "") +
        (sig.replaySuspected ? `; replay-suspected: updated ${sig.replaySuspected.updated} is earlier than the ${sig.replaySuspected.heldUpdated} already held` : "")
      );
    }
    case "unsigned":
      return `signature: ${at}unsigned (the publisher did not sign; not evidence of anything)`;
    case "unverified":
      return `signature: ${at}unverified (${sig.reason}${sig.detail ? `: ${sig.detail}` : ""}); the object is unverified, not false`;
  }
}

/** One line per upstream comparison, for stderr. */
export function describeUpstream(c: UpstreamComparison): string {
  const indent = "  ".repeat(c.depth - 1);
  const figures =
    c.subject || c.upstreamFigures
      ? ` [subject ${formatFigures(c.subject)} vs upstream ${formatFigures(c.upstreamFigures)}]`
      : "";
  // A retrieved upstream is read with the compatibility reading, like any
  // other declaration; say so where they were applied rather than comparing on
  // a quietly altered reading.
  const disregarded =
    c.upstreamDisregarded && c.upstreamDisregarded.length > 0
      ? ` [disregarded in the upstream declaration (the -10 compatibility reading): ${c.upstreamDisregarded.map(isolate).join(", ")}]`
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
  const coverage =
    a.coverage.status === "covers"
      ? "; it covers the target and period of the object"
      : a.coverage.status === "does-not-cover"
        ? `; it does NOT cover the object (${a.coverage.detail})`
        : a.coverage.status === "not-stated"
          ? "; it states no target and period, so it covers nothing in particular"
          : "";
  const verdict = a.attested
    ? "attested by an issuer key you trust"
    : "not reported as attested (that needs a retrieved credential, an issuer key you trust and a credential that covers the target and period)";
  return `attestation: valid — issuer ${isolate(a.issuer)}, ${a.alg}, valid ${window}, ${key}${binding}${coverage}${a.mediaTypeOk ? "" : `; served as "${a.mediaType ?? ""}", not application/vc+jwt`}; ${verdict}`;
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

/**
 * Check the attestation each object links, once per credential. `base` is the
 * retrieval URI of the declaration, which a relative reference resolves against.
 */
async function runAttestationCheck(
  document: SustainabilityDocument,
  source: string | true,
  transport: { allowInsecure: boolean; allowPrivateAddresses?: boolean },
  base: string,
): Promise<AttestationResult[]> {
  const withUri = (Array.isArray(document) ? document : [document]).filter((o) => o?.["verifiable-attestation-uri"]);
  if (withUri.length === 0) {
    console.error("attestation: none (the declaration carries no verifiable-attestation-uri)");
    return [];
  }
  const trustedIssuerKeys = typeof source === "string" ? await loadIssuerKeys(source) : undefined;
  const results: AttestationResult[] = [];
  const done = new Set<string>();
  for (const object of withUri) {
    const uri = object["verifiable-attestation-uri"] as string;
    // The credential binds to the declaration by carrying a copy of it: the
    // object compared is the one this consumer reports.
    let key: string;
    try {
      key = `${new URL(uri, base)}|${object.target}|${object.period.start}|${object.period.end}`;
    } catch {
      key = uri;
    }
    if (done.has(key)) continue;
    done.add(key);
    const result = await verifyAttestation(uri, { base, trustedIssuerKeys, ...transport, declaration: object });
    console.error(describeAttestation(result));
    results.push(result);
  }
  return results;
}

/** Print what each disclosure link led to; a link that cannot be retrieved changes nothing else. */
async function runDisclosureCheck(document: SustainabilityDocument, base: string, timeoutMs: number | undefined): Promise<void> {
  const uris = new Set<string>();
  for (const object of Array.isArray(document) ? document : [document]) {
    const uri = object?.["disclosure-uri"];
    if (typeof uri === "string") uris.add(uri);
  }
  if (uris.size === 0) {
    console.error("disclosure: none (the declaration carries no disclosure-uri; no request was made)");
    return;
  }
  for (const uri of uris) {
    try {
      const got = await fetchDisclosure(uri, undefined, { base, timeoutMs });
      console.error(`disclosure: ${isolate(got.url)} — ${got.mediaType ?? "no Content-Type"}, ${got.bytes.length} bytes; nothing is concluded from it`);
    } catch (err) {
      console.error(`disclosure: ${isolate(uri)} — could not be retrieved (${err instanceof Error ? err.message : String(err)}); the declaration is unaffected`);
    }
  }
}

/** Flags that take a value, and flags that stand alone. `verify-attestation` alone takes an optional value. */
const VALUE_FLAGS = [
  "target", "start", "end", "granularity", "format", "etag", "trusted-key", "trust-anchor", "pin",
  "max-bytes", "max-objects", "max-retrievals", "timeout", "trusted-issuer",
] as const;
const SWITCH_FLAGS = [
  "strict", "conformance", "allow-http", "allow-private", "verify", "require-signed", "upstream", "follow-upstream", "disclosure", "total", "help",
] as const;
const FORMATS = ["json", "csv", "ndjson"];

/**
 * Options may appear in any position, so `--strict <origin>` works as well as
 * `<origin> --strict`. A leading bare `sustainability-fetch` is dropped: `npx
 * <pkg> sustainability-fetch ...` passes the bin name through as an argument,
 * and reading it as the origin produced a bare "Invalid URL" crash. A flag the
 * CLI does not know, or one given the wrong kind of value, is a usage error:
 * a mistyped `--stict` must not quietly run the check that was not asked for.
 */
function parseArgs(argv: string[]) {
  const opts: Record<string, string | boolean> = {};
  const positional: string[] = [];
  const problems: string[] = [];
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (arg === "-h") opts.help = true;
    else if (!m) positional.push(arg);
    else if (m[1] === "period") {
      problems.push("--period is gone since draft -10: use --start=<date-time> and --end=<date-time>");
    } else if ((VALUE_FLAGS as readonly string[]).includes(m[1])) {
      if (m[2] === undefined || m[2] === "") problems.push(`--${m[1]} needs a value: --${m[1]}=<value>`);
      else opts[m[1]] = m[2];
    } else if ((SWITCH_FLAGS as readonly string[]).includes(m[1])) {
      if (m[2] !== undefined) problems.push(`--${m[1]} takes no value`);
      else opts[m[1]] = true;
    } else if (m[1] === "verify-attestation") opts[m[1]] = m[2] === undefined || m[2] === "" ? true : m[2];
    else problems.push(`unknown option --${m[1]}`);
  }
  if (positional[0] === "sustainability-fetch") positional.shift();
  return { origin: positional[0], opts, problems };
}

/** A positive integer flag value, or the problem with it. */
function positiveInteger(opts: Record<string, string | boolean>, name: string, problems: string[]): number | undefined {
  const raw = opts[name];
  if (typeof raw !== "string") return undefined;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    problems.push(`--${name} must be a positive whole number, not "${raw}"`);
    return undefined;
  }
  return Number(raw);
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


/** The keys of a JWK or JWK Set file, public members only. */
function readKeyFile(file: string): PublicJwk[] {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const keys: unknown[] = Array.isArray(parsed?.keys) ? parsed.keys : [parsed];
  return keys.filter((k): k is PublicJwk => typeof k === "object" && k !== null && !("d" in (k as object)));
}

/**
 * The keys and anchors the caller supplies for the signature, all from local
 * files the caller chose: nothing is taken from the declaration or fetched
 * from a URL it names.
 */
function loadSignaturePolicy(opts: Record<string, string | boolean>, origin: string): SignaturePolicy | undefined {
  const policy: SignaturePolicy = {};
  if (typeof opts["trusted-key"] === "string") policy.trustedKeys = readKeyFile(opts["trusted-key"]);
  if (typeof opts["trust-anchor"] === "string") policy.trustAnchors = [readFileSync(opts["trust-anchor"], "utf8")];
  if (typeof opts.pin === "string" && existsSync(opts.pin)) {
    const held = (JSON.parse(readFileSync(opts.pin, "utf8")) as Record<string, PublicJwk>)[new URL(origin).origin];
    if (held) policy.pinnedKeys = [held];
  }
  return Object.keys(policy).length > 0 ? policy : undefined;
}

/** The first verified key of an origin becomes its pin, when none is held and the key came from the declaration. */
function recordPin(file: string, origin: string, signatures: SignatureResult[] | undefined): void {
  const first = signatures?.find((s) => s.status === "verified");
  if (first?.status !== "verified" || first.keyTrust !== "declaration-only") return;
  const store: Record<string, PublicJwk> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const key = new URL(origin).origin;
  if (store[key]) return;
  store[key] = first.publicJwk;
  writeFileSync(file, JSON.stringify(store, null, 2) + "\n");
  console.error(`pin: recorded the key with thumbprint ${first.thumbprint} for ${key} in ${file}`);
}

/** Runs the CLI for the given argv (excluding `node script.js`); returns the process exit code. */
export async function runCli(argv: string[]): Promise<number> {
  const { origin: rawOrigin, opts, problems } = parseArgs(argv);
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  // Everything that can be wrong with the command line is reported before any request.
  const maxBytes = positiveInteger(opts, "max-bytes", problems);
  const maxObjects = positiveInteger(opts, "max-objects", problems);
  const maxRetrievals = positiveInteger(opts, "max-retrievals", problems);
  const timeoutSeconds = positiveInteger(opts, "timeout", problems);
  for (const name of ["start", "end"] as const) {
    const error = typeof opts[name] === "string" ? dateTimeError(opts[name]) : undefined;
    if (error) problems.push(`--${name}: ${error}`);
  }
  if (typeof opts.granularity === "string" && !(GRANULARITIES as readonly string[]).includes(opts.granularity)) {
    problems.push(`--granularity must be one of ${GRANULARITIES.join(", ")}, not "${opts.granularity}"`);
  }
  if (typeof opts.format === "string" && !FORMATS.includes(opts.format)) {
    problems.push(`--format must be one of ${FORMATS.join(", ")}, not "${opts.format}"`);
  }
  if (problems.length > 0) {
    console.error(`${problems.join("\n")}\n\n${USAGE}`);
    return 2;
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

  // Draft MUST: a declaration is published and retrieved over HTTPS. A bare hostname was already promoted to https above;
  // an explicit http:// origin is a deliberate choice, so it gets a deliberate
  // flag rather than a silent downgrade.
  const allowInsecure = opts["allow-http"] === true;
  const allowPrivateAddresses = opts["allow-private"] === true ? true : undefined;
  if (!allowInsecure && new URL(origin).protocol === "http:") {
    console.error(
      `Refusing plain HTTP for ${origin}: the draft requires HTTPS — pass --allow-http for a local/CI origin.`,
    );
    return 2;
  }

  const verifyAttestationOpt = (opts["verify-attestation"] ?? opts["trusted-issuer"]) as string | true | undefined;
  const timeoutMs = timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;

  if (opts.strict || opts.conformance) {
    const report = await runConformanceChecks(origin, undefined, { allowInsecure, allowPrivateAddresses, timeoutMs, maxBytes });
    for (const c of report.checks) {
      // A failed SHOULD is reported as WARN: it is a recommendation the origin
      // did not follow, not a conformance failure, and only MUST failures set
      // a non-zero exit code. A check whose own outcome is "warn" (the generic
      // media type) renders the same way, at either level.
      const label =
        c.outcome === "pass" ? "PASS" : c.outcome === "warn" ? "WARN" : c.level === "MUST" ? "FAIL" : "WARN";
      console.log(`${label}  [${c.level}] ${c.name}${c.section ? ` (${c.section})` : ""}${c.detail ? ` — ${c.detail}` : ""}`);
    }
    if (report.capabilities) console.log(`capabilities: ${report.capabilities}`);
    if (report.allPassed && !report.allPassedIncludingRecommended) {
      console.log(
        "\nConformant: all MUST-level checks passed. WARN lines are unmet recommendations," +
          " HTTP practice the draft leaves to the publisher, or advisory findings (such as the generic media type).",
      );
    }
    // The signature is part of the battery; the attestation is an explicit extra.
    let attestationOk = true;
    if (verifyAttestationOpt !== undefined) {
      const doc = await fetchSustainability(origin, { allowInsecure, allowPrivateAddresses, legacyCompat: false, verifySignature: true, timeoutMs, maxBytes });
      if (doc.status === "ok") {
        const results = await runAttestationCheck(doc.document, verifyAttestationOpt, { allowInsecure, allowPrivateAddresses }, doc.url);
        attestationOk = results.every((a) => a.valid);
      }
    }
    return report.allPassed && attestationOk ? 0 : 1;
  }

  const signaturePolicy = loadSignaturePolicy(opts, origin);
  const result = await fetchSustainability(origin, {
    target: typeof opts.target === "string" ? opts.target : undefined,
    start: typeof opts.start === "string" ? opts.start : undefined,
    end: typeof opts.end === "string" ? opts.end : undefined,
    granularity: GRANULARITIES.find((g) => g === opts.granularity),
    ifNoneMatch: typeof opts.etag === "string" ? opts.etag : undefined,
    allowInsecure,
    allowPrivateAddresses,
    timeoutMs,
    maxBytes,
    maxObjects,
    verifySignature: opts.verify === true || typeof opts.pin === "string" || signaturePolicy !== undefined,
    requireSigned: opts["require-signed"] === true,
    signaturePolicy,
    followUpstream: opts.upstream === true || opts["follow-upstream"] === true,
    upstreamMaxRetrievals: maxRetrievals,
  });

  switch (result.status) {
    case "ok": {
      const format = typeof opts.format === "string" ? opts.format : "json";
      const objects = Array.isArray(result.document) ? result.document : [result.document];
      let exit = 0;
      if (opts.total === true) {
        try {
          console.log(JSON.stringify(total(objects), null, 2));
        } catch (err) {
          if (!(err instanceof TotalPreconditionError)) throw err;
          console.error(`total refused (${err.reason}): ${err.message}`);
          exit = 1;
        }
      } else {
        const source = { url: result.url, signatures: result.signatures };
        if (format === "csv") console.log(toCsvRows(result.document, source).join("\n"));
        else if (format === "ndjson") console.log(toNdjson(result.document, source));
        else console.log(JSON.stringify(result.document, null, 2));
      }
      if (result.etag) console.error(`ETag: ${result.etag}`);
      // Retrieval establishes what the origin published and nothing more.
      console.error(`claim: every figure above is a claim of ${new URL(result.url).origin} (retrieved from ${result.url}); retrieval does not check it`);
      if (objects.length === 0) console.error("empty array: the origin holds no declaration object for this request");
      if (result.converted) for (const c of result.converted) console.error(`compatibility: converted ${c}`);
      if (result.disregarded) console.error(`compatibility: disregarded ${result.disregarded.join(", ")}`);
      if (result.notAsRequested) {
        for (const m of result.notAsRequested) console.error(`not as requested: ${m}`);
      }
      if (result.redirectedAcrossOrigins) {
        const r = result.redirectedAcrossOrigins;
        console.error(
          `cross-origin redirect: ${r.queried} redirected to ${r.final}; every value is a claim of ${r.final} (draft, Self-Asserted Claims)`,
        );
      }
      if (result.warnings) for (const w of result.warnings) console.error(`warning: ${w}`);
      if (result.signatures) {
        const many = result.signatures.length > 1;
        result.signatures.forEach((s, i) => console.error(describeSignature(s, many ? i : undefined)));
        if (typeof opts.pin === "string") recordPin(opts.pin, origin, result.signatures);
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
      } else if (opts.upstream === true || opts["follow-upstream"] === true) {
        console.error("upstream: none (the declaration names no upstream providers)");
      }
      if (opts.disclosure === true) await runDisclosureCheck(result.document, result.url, timeoutMs);
      if (verifyAttestationOpt !== undefined) {
        await runAttestationCheck(result.document, verifyAttestationOpt, { allowInsecure, allowPrivateAddresses }, result.url);
      }
      return exit;
    }
    case "signature-required":
      for (const f of result.failures) {
        console.error(`object ${f.object} is ${f.status === "unsigned" ? "unsigned" : `unverified (${f.reason})`}; every object was required to be signed`);
      }
      return 1;
    case "not-modified":
      console.error("304 Not Modified");
      return 0;
    case "not-found":
      console.error("404 Not Found");
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
          "note: pass --allow-http to reach a loopback development origin, or --allow-private (allowPrivateAddresses " +
            "in the library) to reach a private address deliberately.",
        );
      }
      return 1;
    case "too-many-redirects":
      console.error(`Too many redirects: ${result.detail} (stopped at ${isolate(result.url)})`);
      return 1;
    case "insecure-transport":
      // With an http:// origin already refused above, this can only be an
      // https origin redirecting to plain HTTP — a server-side conformance
      // failure, not a usage error, so it exits 1 like the other fetch faults.
      console.error(`Insecure transport: ${result.detail}`);
      return 1;
  }
}
