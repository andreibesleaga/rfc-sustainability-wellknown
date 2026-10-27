#!/usr/bin/env node
/**
 * Check a declaration that claims SFC (any 8.1 extension name but the 1.x `ledger-evidence`) at both depths of SFC profile 2.0 (the spec,
 * https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md,
 * sections 9.3 and 9.4): the shallow check over the declaration alone (S1 to S7, C-SFC-2 disclosure
 * form, C-SFC-5), then the deep check over the ledger read its `ledger-access-uri` serves (D1 to D8,
 * C-SFC-1 to C-SFC-4, C-SFC-6, C-SFC-7). A declaration that carries the 1.x `ledger-evidence`
 * and not `ledger-evidence-2` is read by the frozen 1.x checks, as before.
 *
 *   curl -s https://sustainability.up.railway.app/sfc-ledger-demo-2.example/input -o read.json
 *   node scripts/sfc-ledger-check.mjs https://sustainability.up.railway.app/sfc-ledger-demo-2.example/.well-known/sustainability-data \
 *     --excerpt read.json --parameters ../sfc-compliance/examples/sfc-parameters.example.json \
 *     --registrar-key 11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo --network ledger.example --at 2026-05-02T00:10:00Z
 *
 * That runs every check this script makes on a demo; it is not a full SFC 2 verifier (see "Not established" below).
 * With `--at` alone (no parameters, no registrar key) the rows that need them are NOT-EVALUABLE, and the run is not a pass. `--excerpt` is required for sfc-network-2.example and
 * sfc-operator-2.example: their `ledger-access-uri` is the reserved name https://ledger.example/sfc/read.
 *
 *   node scripts/sfc-ledger-check.mjs ./declaration.json --excerpt ./read.json --parameters ./sfc-parameters.json --registrar-key <x> --network <host>
 *   node scripts/sfc-ledger-check.mjs <url-or-file> --key ./public.jwk.json
 *
 * Options
 *   --at <instant>          T, the check instant (spec 3.2), an RFC 3339 instant. With it the run is reproducible: no age limit
 *                           on the read. Without it T is this machine's clock and a read older than
 *                           24 hours is NOT-EVALUABLE ("stale read", spec 5.7). The report prints T and its source.
 *   --excerpt <file>        The ledger read (excerpt format 2) from a file instead of `ledger-access-uri`.
 *   --parameters <file>     The methodology parameters (spec 7.6), a JSON file you obtained out of band: it
 *                           pins the methodology document (registrar keys, retirement registries, platform).
 *   --registrar-key <x>     The registrar's public key `x` (43 characters), pinned out of band for the network
 *                           named by --network (spec 5.1, D2). Without a pin the Registry is "claimed, not authenticated".
 *   --network <host>        The network the registrar key is pinned for; required with --registrar-key. The key is
 *                           bound to this host, not to the network the read claims: a read of another network gets no key.
 *   --key <file>            The public JWK `signed` must verify under (default: the RFC 8032 test key the
 *                           gateway's demonstrations use, which proves nothing about who signed).
 *   --scope2-method <m>     1.x only: the Scope 2 method a methodology document states for events that carry none.
 *   --allow-http            Also fetch plain http (a local instance).
 *
 * The served declaration and the read are checked as text (I-JSON, spec section 10: duplicate member names, lone
 * surrogates and number literals are seen). Fetches are HTTPS only, follow no redirect and stop reading at 2 MB.
 * Section 10 requires a verifier to refuse addresses that are not globally reachable and to say which rule it
 * applies: the host of each request (of the declaration URL, and of the `ledger-access-uri`, which comes from the
 * checked declaration) is resolved in the lookup of the connection itself, and the socket connects only to an
 * address that passed the check (the consumer library's test, an approximation of the IANA Globally Reachable list:
 * loopback, private, link-local and other non-unicast addresses are refused; `--allow-http` also admits loopback).
 * A name that resolves differently a moment later cannot change the answer after the check. The connected address
 * is neither pinned nor reported. Row S1 reports the URL and the media type the declaration was actually served as.
 * A later correction of the ledger (an event or a void act committed after the declaration's `updated` and before
 * the read) is INFO "superseded since publication", never FAIL (spec 5.6, D7); the report counts them.
 *
 * Not established (printed after the closing sentence as the D9 record, spec 9.4 step 9): whether the registrar key
 * and the methodology document were pinned, that the Registry records (D8) were not checked, the address rule, that
 * the connected address is not reported, and that figures, the operator set and the readings are not established.
 *
 * Run `npm run build` first: the checks live in dist/. Exit 0 when no row FAILs, 1 when a row FAILs, 2 when a stage
 * stopped (an ERROR row: the run is incomplete, so 0 would read as clean; the reference checker in sfc-compliance
 * exits 2 for the same case) and on a usage error. PASS means a check a reader can make came out right; nothing here
 * is called verified except a signature, and a report with a NOT-EVALUABLE row among the criteria is not a pass (spec 9.1).
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { hasLeapSecond, isDateTime, secureGet, systemAddressLookup } from "sustainability-wellknown-consumer";

const MAX_BYTES = 2 * 1024 * 1024;
const USAGE =
  "usage: node scripts/sfc-ledger-check.mjs <declaration url or file> [--at <instant>] [--excerpt <file>] [--parameters <file>] " +
  "[--registrar-key <x> --network <host>] [--key <public jwk file>] [--scope2-method location-based|market-based] [--allow-http]";
const VALUE_FLAGS = ["--at", "--excerpt", "--parameters", "--registrar-key", "--network", "--key", "--scope2-method"];
/** The rows 9.1 names: a FAIL or NOT-EVALUABLE among them stops any summary from reading as a pass. */
const CRITERIA = ["C-SFC-1", "C-SFC-2", "C-SFC-4", "C-SFC-5", "C-SFC-6", "C-SFC-7"];

/** An RFC 3339 instant as spec 3.2 defines it (second 60 not allowed), by the consumer library's reading. */
const isInstant = (v) => isDateTime(v) && !hasLeapSecond(v);

/** Parse argv; undefined on a usage error. A flag without its value never falls back to a default. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  let allowHttp = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow-http") allowHttp = true;
    else if (VALUE_FLAGS.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) return undefined;
      flags[a] = v;
      i++;
    } else if (a.startsWith("--")) return undefined;
    else positional.push(a);
  }
  if (positional.length !== 1 || !flagValuesOk(flags)) return undefined;
  return { source: positional[0], flags, allowHttp };
}

/** The value rules of the flags: `--at` is an instant, `--scope2-method` one of two words, `--registrar-key` needs `--network`. */
function flagValuesOk(flags) {
  const scope2 = flags["--scope2-method"];
  if (scope2 !== undefined && scope2 !== "location-based" && scope2 !== "market-based") return false;
  if (flags["--at"] !== undefined && !isInstant(flags["--at"])) return false;
  return flags["--registrar-key"] === undefined || flags["--network"] !== undefined;
}

/** A row's text with every control character escaped, so a checked document cannot draw rows of its own. */
const safe = (s) => String(s).replace(/\p{Cc}/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** One report row: its word, id, scope and detail. */
const rowLine = (row) => `  ${row.status.padEnd(14)} ${row.id.padEnd(22)} ${row.scope ? `[${safe(row.scope)}] ` : ""}${safe(row.detail)}`;

/** The address rule this script applies (spec section 10), as printed in the D9 record. */
export const ADDRESS_RULE =
  "the host is resolved in the lookup of the connection itself and the socket connects only to an address that passed the check " +
  "(the consumer library's test, an approximation of the IANA Globally Reachable list: loopback, private, link-local and other " +
  "non-unicast addresses are refused); the connected address is not reported";

/** The whole body of a response, or an error once it passes `MAX_BYTES`. */
async function readCapped(res, url) {
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new Error(`${url}: larger than ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * GET one JSON document as `{ body, text, contentType }`: https only (or http with --allow-http), no redirect followed,
 * the size bound enforced while reading. The address rule is applied by the consumer library's `secureGet`: the
 * resolver of the connection is the check, so the socket connects only to an address it approved. A stand-in
 * `fetchImpl` (tests) opens no connection, so the rule reaches only a literal address host there.
 */
export async function fetchJson(url, allowHttp, fetchImpl = undefined, lookup = systemAddressLookup) {
  const u = new URL(url);
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) {
    throw new Error(`${url}: only https is fetched (use --allow-http for a local http instance)`);
  }
  const result = await secureGet(u, {
    timeoutMs: 15_000, lookup, ...(fetchImpl ? { fetchImpl } : {}), allowInsecure: allowHttp,
    headers: { accept: "application/sustainability-data+json, application/json" }, refuseHop: () => "redirects are not followed",
  });
  if (!result.ok) throw new Error(`${url}: refused, ${result.refusal.reason}${result.refusal.detail ? `: ${result.refusal.detail}` : ""}`);
  const r = result.res;
  if (r.status >= 300 && r.status < 400) throw new Error(`${url}: answered a redirect (HTTP ${r.status}); redirects are not followed`);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const declared = Number(r.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error(`${url}: larger than ${MAX_BYTES} bytes`);
  const text = await readCapped(r, url);
  return { body: JSON.parse(text), text, contentType: r.headers.get("content-type") };
}

const defaultIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  readJson: (path) => JSON.parse(readFileSync(path, "utf8")),
  readText: (path) => readFileSync(path, "utf8"),
  fetchJson,
  /** The checker's clock: the one place this script reads a wall clock, and it prints what it read. */
  clock: () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
};

/** A checked document from a file: its text (when the io can give it) and the object it holds. */
function readDocument(io, path) {
  if (typeof io.readText !== "function") return { body: io.readJson(path) };
  const text = io.readText(path);
  return { body: JSON.parse(text), text };
}

/** The declaration from a URL or a file: `{ body, text?, contentType? }`. */
const readDeclaration = async (io, source, allowHttp) => (/^https?:\/\//.test(source) ? io.fetchJson(source, allowHttp) : readDocument(io, source));

/** The deep check's options from the flags: T or the clock, the pins (the registrar key bound to --network) and the parameters (profile 2.0). */
function deepOptions(flags, parameters, clockNow) {
  const options = flags["--at"] !== undefined ? { T: flags["--at"] } : { now: clockNow };
  const pins = {};
  if (parameters) pins.methodology = true;
  if (flags["--registrar-key"]) {
    pins.registrar = { [flags["--network"]]: [flags["--registrar-key"]] };
    pins.networkHost = flags["--network"];
  }
  return { ...options, ...(parameters ? { parameters } : {}), ...(Object.keys(pins).length ? { pins } : {}) };
}

const allRows = (reports) => reports.flatMap((r) => r.rows);
const failed = (rows) => rows.some((r) => r.status === "FAIL");
/** A stage that did not complete (an ERROR row): the run is incomplete, never a pass (spec 9.5). */
const stopped = (rows) => rows.some((r) => r.id === "ERROR");

/** The line that counts rows by word (spec 9.1), and the INFO line for later corrections (D7). */
function summaryLines(reports) {
  const rows = allRows(reports);
  const counts = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const later = rows.filter((r) => r.id === "D7" && r.detail === "superseded since publication").length;
  return [
    `rows: ${Object.entries(counts).map(([w, n]) => `${w} ${n}`).join(", ")}`,
    ...(later > 0 ? [`INFO later corrections since the declaration's updated (spec D7): ${later}; they do not make the declaration wrong`] : []),
  ];
}

/** The closing sentence: never a pass while a row FAILs, a stage stopped, or a criterion row is NOT-EVALUABLE (spec 9.1, 9.5). */
function closing(reports, profile2) {
  const rows = allRows(reports);
  if (failed(rows)) return "At least one row failed.";
  if (stopped(rows)) return "A stage did not complete (ERROR row); this is not a pass: NOT-EVALUABLE. Nothing here is established as true.";
  const open = profile2 ? rows.filter((r) => CRITERIA.includes(r.id) && r.status === "NOT-EVALUABLE") : [];
  if (open.length > 0) return `No row failed, and this is not a pass: ${[...new Set(open.map((r) => r.id))].join(", ")} NOT-EVALUABLE. Nothing here is established as true.`;
  return "No row failed. This shows what the rows say and nothing more: no figure here is established as true.";
}

/** Exit status from the rows (spec 9.5 and the reference checker): 1 on a FAIL, 2 when a stage stopped and nothing FAILs, else 0. */
const exitCodeOf = (reports) => (failed(allRows(reports)) ? 1 : stopped(allRows(reports)) ? 2 : 0);

const asciiLower = (s) => String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Whether a registrar key the deep check could use was pinned (the D9 record): with a read, the key bound to
 * --network applies only when the read claims that network; a pinned methodology document that lists a key counts too.
 */
function registrarKeyPinned(flags, parameters, excerpt) {
  const listed = parameters !== undefined && (parameters["registrar-keys"] ?? []).length > 0;
  const claimed = excerpt === undefined || !excerpt || typeof excerpt !== "object" ? undefined : excerpt.network;
  const bound = flags["--registrar-key"] !== undefined && (claimed === undefined || asciiLower(claimed) === asciiLower(flags["--network"]));
  return bound || listed;
}

/** The D9 record (spec 9.4 step 9): what was pinned (and for which network), what did not run, the address rule, and what is not established. */
function recordLines(flags, profile2, parameters, excerpt) {
  const yesNo = (flag) => (flag ? "yes" : "no");
  const host = flags["--network"];
  return [
    "",
    `registrar key pinned${host ? ` for ${host}` : ""}: ${yesNo(registrarKeyPinned(flags, parameters, excerpt))}; methodology document pinned: ${yesNo(parameters !== undefined)}; Registry records (D8) ${profile2 ? "not checked" : "not part of this check"}`,
    `address rule: ${ADDRESS_RULE}`,
    "Figures are the publisher's claims; the operator set is the Registry's; completeness against the real network and the readings are not established.",
  ];
}

/** The read for the deep check: from the --excerpt file, else fetched from `ledger-access-uri`, else none. Returns `{ body, text? }` or undefined. */
async function readLedger(flags, io, uri, allowHttp) {
  if (flags["--excerpt"]) return readDocument(io, flags["--excerpt"]);
  return uri !== undefined ? io.fetchJson(uri, allowHttp) : undefined;
}

/** A synthetic D1 row for a read that could not be obtained; the 1.x checks say REFUSED, 2.0 says NOT-EVALUABLE. */
const noAccess = (profile2, why) => ({ rows: [{ id: "D1", status: profile2 ? "NOT-EVALUABLE" : "REFUSED", detail: `no ledger access: ${why}` }] });

/** The deep check over the read, by profile; the 2.0 checks take the texts, so the read is parsed as I-JSON. */
function deepReport(lib, declaration, read, profile2, texts, flags, parameters, clockNow) {
  if (!profile2) return lib.deepCheck(declaration, read.body, flags["--scope2-method"] ? { scope2MethodDefault: flags["--scope2-method"] } : {});
  const text = { ...(texts.declaration !== undefined ? { declarationText: texts.declaration } : {}), ...(read.text !== undefined ? { excerptText: read.text } : {}) };
  return lib.deepCheck(declaration, read.body, { ...deepOptions(flags, parameters, clockNow), ...text });
}

/**
 * Run the checks. `lib` is `{ deepCheck, isReadUnderSfc2, ledgerAccessUriOf, shallowCheck, testKey }` from the built
 * gateway (dist/), passed in so a test can run it on the sources. Returns the exit code.
 */
export async function runCheck(argv, lib, io = defaultIo) {
  const args = parseArgs(argv);
  if (!args) {
    io.err(USAGE);
    return 2;
  }
  const { source, flags, allowHttp } = args;
  let fetched;
  try {
    fetched = await readDeclaration(io, source, allowHttp);
  } catch (err) {
    io.err(`cannot read the declaration: ${safe(err instanceof Error ? err.message : String(err))}`);
    return 1;
  }
  const declaration = fetched.body;
  const key = flags["--key"] ? io.readJson(flags["--key"]) : lib.testKey;
  const parameters = flags["--parameters"] ? io.readJson(flags["--parameters"]) : undefined;
  const profile2 = lib.isReadUnderSfc2(declaration);
  const clockNow = flags["--at"] === undefined ? io.clock() : undefined;
  io.out(`profile ${profile2 ? "2.0 (spec sections 9.3, 9.4)" : "1.x (frozen)"}; T ${flags["--at"] ?? clockNow} (${flags["--at"] !== undefined ? "--at" : "this machine's clock"})`);

  io.out(`shallow check (declaration only; key ${flags["--key"] ? "from --key" : "= the public RFC 8032 test key"})`);
  const shallow = await lib.shallowCheck(declaration, {
    trustedKeys: [key],
    ...(profile2 ? { T: flags["--at"] ?? clockNow } : {}),
    ...(profile2 && fetched.text !== undefined ? { declarationText: fetched.text } : {}),
    ...(fetched.contentType !== undefined ? { fetched: { url: source, contentType: fetched.contentType, httpAllowed: allowHttp } } : {}),
  });
  for (const row of shallow.rows) io.out(rowLine(row));

  let deep;
  let read;
  const uri = lib.ledgerAccessUriOf(declaration);
  try {
    read = await readLedger(flags, io, uri, allowHttp);
    io.out(`deep check (read ${flags["--excerpt"] ? "from file" : uri !== undefined ? "from " + safe(uri) : "unavailable"})`);
    deep = read === undefined ? noAccess(profile2, "the declaration names no ledger-access-uri") : deepReport(lib, declaration, read, profile2, { declaration: fetched.text }, flags, parameters, clockNow);
  } catch (err) {
    deep = noAccess(profile2, err instanceof Error ? err.message : String(err));
  }
  for (const row of deep.rows) io.out(rowLine(row));

  if (profile2) for (const line of summaryLines([shallow, deep])) io.out(line);
  io.out(`\n${closing([shallow, deep], profile2)}`);
  for (const line of recordLines(flags, profile2, parameters, read?.body)) io.out(line);
  return exitCodeOf([shallow, deep]);
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { deepCheck, isReadUnderSfc2, ledgerAccessUriOf, shallowCheck } = await import("../dist/adapters/sfc-ledger-bridge.js");
  const { SFC_LEDGER_TEST_PUBLIC_JWK } = await import("../dist/adapters/sfc-ledger-fixture.js");
  process.exit(await runCheck(process.argv.slice(2), { deepCheck, isReadUnderSfc2, ledgerAccessUriOf, shallowCheck, testKey: SFC_LEDGER_TEST_PUBLIC_JWK }));
}
