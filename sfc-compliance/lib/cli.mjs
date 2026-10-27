/**
 * The command line: parse arguments, assemble the input from files and fetches, run the checks, print.
 * `main` takes its streams and clock as arguments, so a test runs it without a terminal or the real time.
 */
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { runChecks } from "./check.mjs";
import { exitCodeOf, formatJson, formatText } from "./report.mjs";
import { fetchDeclaration, fetchDocument, parametersFromText, parseText, readFileBytes, readFileText, readJwkFile, readRegistrarKeyFile, sha256OfBytes } from "./input.mjs";
import { isInstant } from "./time.mjs";
import { withLimits } from "./limits.mjs";
import { extOf, objectsOf, levelOf } from "./declaration.mjs";
import { debugEnabled } from "./debug.mjs";

export const USAGE = `usage: sfc-check <declaration file | origin> [options]

  --excerpt <file>           ledger read (excerpt format 2) for the deep check
  --fetch-ledger             fetch the read from the declaration's ledger-access-uri (https only)
  --parameters <file>        methodology parameters: JSON, or Markdown with a "## SFC parameters" block
  --parameters-sha256 <hex>  pin the methodology document: its hash, obtained out of band
  --trusted-key <jwk file>   public key pinned for the "signed" of network and operator declarations (repeatable)
  --publisher-key <jwk file> public key pinned for network declarations only; with it, --trusted-key no longer
                             applies to them (repeatable)
  --operator-key <jwk file>  public key pinned for operator declarations only; with it, --trusted-key no longer
                             applies to them (repeatable)
  --registrar-key <jwk file> registrar Ed25519 public key pinned for the network (repeatable)
  --network <host>           the network the registrar key is pinned for: needed when the source is a file or an
                             operator declaration (a network declaration by URL pins for its host)
  --at <instant>             explicit check instant T (RFC 3339)
  --now <instant>            fixed clock; default is the current time
  --json                     print the report as JSON, with the overall verdict
  --help                     print this text

exit status: 0 when no row FAILs, 1 when a check FAILs, 2 when a stage stopped (an ERROR row) and nothing FAILs,
             or on a usage error or an unexpected error; set SFC_DEBUG=1 to print the cause of a stopped stage`;

const OPTIONS = {
  excerpt: { type: "string" }, "fetch-ledger": { type: "boolean" }, parameters: { type: "string" }, "parameters-sha256": { type: "string" },
  "trusted-key": { type: "string", multiple: true }, "publisher-key": { type: "string", multiple: true }, "operator-key": { type: "string", multiple: true }, "registrar-key": { type: "string", multiple: true }, network: { type: "string" },
  at: { type: "string" }, now: { type: "string" }, json: { type: "boolean" }, help: { type: "boolean" },
};

class UsageError extends Error {}

function parse(argv) {
  let parsed;
  try { parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true }); } catch (e) { throw new UsageError(e.message); }
  const { values, positionals } = parsed;
  if (values.help) return { help: true };
  if (positionals.length !== 1) throw new UsageError("give exactly one declaration file or origin");
  for (const name of ["at", "now"]) if (values[name] !== undefined && !isInstant(values[name])) throw new UsageError(`--${name} is not an RFC 3339 instant: ${values[name]}`);
  if (values["parameters-sha256"] !== undefined && !/^[0-9a-f]{64}$/.test(values["parameters-sha256"])) throw new UsageError("--parameters-sha256 is 64 lower-case hexadecimal characters");
  if (values["parameters-sha256"] !== undefined && values.parameters === undefined) throw new UsageError("--parameters-sha256 needs --parameters");
  return { values, source: positionals[0] };
}

/** Run a step that reads a file; a failure is a usage error naming the file. */
function reading(what, fn) {
  try { return fn(); } catch (e) { throw new UsageError(`${what}: ${e.message}`); }
}

/** A source that is plainly a file path, not an origin: a mistyped one is an error, not a network fetch. */
const looksLikeFile = (source) => !/^https?:\/\//.test(source) && (/\.(json|jsonld|txt)$/.test(source) || /^\.{1,2}\//.test(source) || source.startsWith("/"));

const hostOf = (origin) => { try { return new URL(/^[A-Za-z][A-Za-z0-9+.-]*:/.test(origin) ? origin : `https://${origin}`).hostname; } catch { return undefined; } };
const clockInstant = (clock) => clock().toISOString().replace(/\.\d+Z$/, "Z");

/** The methodology parameters from one read of the file; a pin is checked against those same bytes, before parsing. */
function parametersAndPin(path, expectedSha256) {
  const bytes = reading(path, () => readFileBytes(path));
  const pinned = expectedSha256 !== undefined;
  if (pinned && sha256OfBytes(bytes) !== expectedSha256) throw new UsageError("--parameters-sha256 does not match the file: the methodology document is not the pinned one");
  return { parameters: reading(path, () => parametersFromText(bytes.toString("utf8"))), pinned };
}

/** Registrar keys pinned for `host`: --network, or the host of a URL source that served a network declaration. */
function registrarPins(files, host) {
  if (host === undefined) throw new UsageError("--registrar-key needs the network it is pinned for: give --network <host> (needed for a file source and for an operator declaration)");
  return { networkHost: host, registrar: { [host]: files.map((f) => reading(f, () => readRegistrarKeyFile(f))) } };
}

const jwksOf = (files) => files.map((f) => reading(f, () => readJwkFile(f)));

/**
 * The keys pinned for `signed` (7.2 rule 2). --trusted-key pins a key for both levels; --publisher-key and
 * --operator-key each override it for their own level, so a key pinned for one level never verifies the other.
 */
function signingKeyPins(values) {
  const shared = jwksOf(values["trusted-key"] ?? []);
  const publisherKeys = values["publisher-key"] ? jwksOf(values["publisher-key"]) : shared;
  const operatorKeys = values["operator-key"] ? jwksOf(values["operator-key"]) : shared;
  return { ...(publisherKeys.length ? { publisherKeys } : {}), ...(operatorKeys.length ? { operatorKeys } : {}) };
}

/**
 * The host a registrar key is pinned for by default: the host of a URL source whose document holds a network
 * declaration. An operator declaration names its network itself (`member-of-network`), and a pin bound to a
 * host the subject chose would let one network's key authenticate another's read, so it gets no default.
 */
function defaultPinHost(network, declarationText) {
  if (network === undefined || declarationText === undefined) return undefined;
  const parsed = parseText(declarationText);
  const objs = parsed.value ? objectsOf(parsed.value) : [];
  return objs.some((o) => levelOf(o) === "network") ? network : undefined;
}

/** Keys, parameters and pins from the options; `network` is the host a registrar key is pinned for by default. */
function pinsAndParameters(values, network) {
  const pins = {};
  Object.assign(pins, signingKeyPins(values));
  let parameters;
  if (values.parameters) {
    const read = parametersAndPin(values.parameters, values["parameters-sha256"]);
    ({ parameters } = read);
    if (read.pinned) pins.methodology = true;
  }
  const registrarFiles = values["registrar-key"] ?? [];
  if (registrarFiles.length) Object.assign(pins, registrarPins(registrarFiles, values.network ?? network));
  return { pins, parameters };
}

/** The read named by the declaration's own `ledger-access-uri`, fetched under section 10. */
async function fetchLedgerRead(declarationText, fetchOptions) {
  const parsed = parseText(declarationText);
  const objs = parsed.value ? objectsOf(parsed.value) : [];
  const uri = objs.map((o) => extOf(o, "ledger-evidence-2")?.["ledger-access-uri"]).find((u) => typeof u === "string");
  if (!uri) return { excerptFetchError: "no ledger-access-uri in the declaration" };
  const got = await fetchDocument(uri, { maxBytes: withLimits().readBytes, timeoutMs: 30000, ...fetchOptions });
  return got.ok ? { excerptText: got.text } : { excerptFetchError: `${got.refused ? "refused: " : ""}${got.cause}` };
}

/** Assemble the input of `runChecks` from the arguments. */
async function assemble({ values, source }, clock, fetchOptions) {
  const input = { limits: withLimits() };
  if (!existsSync(source) && looksLikeFile(source)) throw new UsageError(`file not found: ${source}`);
  if (existsSync(source)) input.declarationText = reading(source, () => readFileText(source));
  else {
    const fetched = await fetchDeclaration(source, fetchOptions);
    input.preRows = fetched.rows;
    input.network = hostOf(source);
    input.retrievalUri = fetched.url ?? null;
    if (fetched.text !== undefined) input.declarationText = fetched.text;
  }
  if (values.excerpt) input.excerptText = reading(values.excerpt, () => readFileText(values.excerpt));
  else if (values["fetch-ledger"] && input.declarationText !== undefined) Object.assign(input, await fetchLedgerRead(input.declarationText, fetchOptions));
  Object.assign(input, pinsAndParameters(values, defaultPinHost(input.network, input.declarationText)));
  if (values.at) input.T = values.at;
  input.now = values.now ?? clockInstant(clock);
  return input;
}

/** A usage error prints the usage; any other error prints its message only (no stack, no local paths). Both exit 2, never the 1 of a FAIL row. */
function reportFailure(e, io) {
  if (e instanceof UsageError) io.err(`sfc-check: ${e.message}\n\n${USAGE}\n`);
  else io.err(`sfc-check: the run stopped on an unexpected error${debugEnabled() ? `: ${e?.message ?? e}` : " (set SFC_DEBUG=1 for the cause)"}\n`);
  return 2;
}

/**
 * Run the command line. `io` has `out(text)` and `err(text)`; `clock` returns a Date; `fetchOptions` reaches the
 * fetch helpers (a test passes `fetchImpl`). Returns the exit status.
 */
export async function main(argv, io, { clock = () => new Date(), fetchOptions = {} } = {}) {
  try {
    const args = parse(argv);
    if (args.help) { io.out(`${USAGE}\n`); return 0; }
    const report = await runChecks(await assemble(args, clock, fetchOptions));
    io.out(args.values.json ? formatJson(report) : formatText(report));
    return exitCodeOf(report.rows);
  } catch (e) {
    return reportFailure(e, io);
  }
}
