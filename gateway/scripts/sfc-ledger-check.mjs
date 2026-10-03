#!/usr/bin/env node
/**
 * Check a declaration that carries the `ledger-evidence` extension at both
 * depths of the SFC ledger bridge (EXPERIMENTAL; SFC ledger profile 1.2): the
 * shallow check over the declaration alone, then the deep check over the
 * excerpt its `ledger-access-uri` serves.
 *
 *   node scripts/sfc-ledger-check.mjs https://sustainability.up.railway.app/sfc-ledger-demo.example/.well-known/sustainability-data
 *   node scripts/sfc-ledger-check.mjs ./declaration.json --excerpt ./input.json
 *   node scripts/sfc-ledger-check.mjs <url-or-file> --key ./public.jwk.json --scope2-method location-based
 *
 * `--key` pins the public JWK the signature must verify under (default: the
 * RFC 8032 test key the gateway's demonstration uses, which proves nothing
 * about who signed). `--excerpt` reads the excerpt from a file instead of
 * fetching `ledger-access-uri`. `--scope2-method` is the Scope 2 method a
 * methodology document states for events that carry none (ledger profile
 * v1.1 events). Fetches are HTTPS only, follow no redirect, and stop reading
 * at 2 MB; `--allow-http` also permits plain http (a local instance). Row S1
 * reports the URL and the media type the declaration was actually served as.
 *
 * Run `npm run build` first: the checks live in dist/. Exit 0 when no row
 * FAILs, 1 otherwise, 2 on a usage error. PASS means a check a reader can
 * make came out right; nothing here is called verified except a signature.
 */
import { readFileSync } from "node:fs";
import { deepCheck, ledgerAccessUriOf, shallowCheck } from "../dist/adapters/sfc-ledger-bridge.js";
import { SFC_LEDGER_TEST_PUBLIC_JWK } from "../dist/adapters/sfc-ledger-fixture.js";

const MAX_BYTES = 2 * 1024 * 1024;
const USAGE =
  "usage: node scripts/sfc-ledger-check.mjs <declaration url or file> [--excerpt <file>] [--key <public jwk file>] " +
  "[--scope2-method location-based|market-based] [--allow-http]";
const VALUE_FLAGS = ["--excerpt", "--key", "--scope2-method"];

function usage() {
  console.error(USAGE);
  process.exit(2);
}

const args = process.argv.slice(2);
const flags = {};
const positional = [];
let allowHttp = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--allow-http") allowHttp = true;
  else if (VALUE_FLAGS.includes(a)) {
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) usage(); // a flag without its value never falls back to a default
    flags[a] = v;
    i++;
  } else if (a.startsWith("--")) usage();
  else positional.push(a);
}
if (positional.length !== 1) usage();
const source = positional[0];
const scope2 = flags["--scope2-method"];
if (scope2 !== undefined && scope2 !== "location-based" && scope2 !== "market-based") usage();

/** GET one JSON document: https only (or http with --allow-http), no redirect followed, the size bound enforced while reading. */
async function fetchJson(url) {
  const u = new URL(url);
  if (u.protocol !== "https:" && !(allowHttp && u.protocol === "http:")) {
    throw new Error(`${url}: only https is fetched (use --allow-http for a local http instance)`);
  }
  const r = await fetch(url, {
    headers: { accept: "application/sustainability-data+json, application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (r.status >= 300 && r.status < 400) throw new Error(`${url}: answered a redirect (HTTP ${r.status}); redirects are not followed`);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  const declared = Number(r.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error(`${url}: larger than ${MAX_BYTES} bytes`);
  const reader = r.body.getReader();
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
  return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")), contentType: r.headers.get("content-type") };
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** A row's text with every control character escaped, so a checked document cannot draw rows of its own. */
const safe = (s) => String(s).replace(/\p{Cc}/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const print = (report) => {
  for (const row of report.rows) console.log(`  ${row.status.padEnd(8)} ${row.id.padEnd(26)} ${safe(row.detail)}`);
};

let fetched;
let declaration;
try {
  fetched = /^https?:\/\//.test(source) ? await fetchJson(source) : undefined;
  declaration = fetched ? fetched.body : readJson(source);
} catch (err) {
  console.error(`cannot read the declaration: ${safe(err instanceof Error ? err.message : String(err))}`);
  process.exit(1);
}
const key = flags["--key"] ? readJson(flags["--key"]) : SFC_LEDGER_TEST_PUBLIC_JWK;

console.log(`shallow check (declaration only; key ${flags["--key"] ? "from --key" : "= the public RFC 8032 test key"})`);
const shallow = await shallowCheck(declaration, {
  trustedKeys: [key],
  ...(fetched ? { fetched: { url: source, contentType: fetched.contentType, httpAllowed: allowHttp } } : {}),
});
print(shallow);

let deep;
const uri = ledgerAccessUriOf(declaration);
try {
  const excerpt = flags["--excerpt"] ? readJson(flags["--excerpt"]) : uri !== undefined ? (await fetchJson(uri)).body : undefined;
  console.log(`deep check (excerpt ${flags["--excerpt"] ? "from file" : uri !== undefined ? "from " + safe(uri) : "unavailable"})`);
  deep =
    excerpt === undefined
      ? { ok: true, rows: [{ id: "D1 ledger-access", status: "REFUSED", detail: "no ledger access: the declaration names no ledger-access-uri" }] }
      : deepCheck(declaration, excerpt, scope2 ? { scope2MethodDefault: scope2 } : {});
} catch (err) {
  deep = { ok: true, rows: [{ id: "D1 ledger-access", status: "REFUSED", detail: `no ledger access: ${err instanceof Error ? err.message : String(err)}` }] };
}
print(deep);

const ok = shallow.ok && deep.ok;
console.log(ok ? "\nNo row failed. This shows what the rows say and nothing more: no figure here is established as true." : "\nAt least one row failed.");
process.exit(ok ? 0 : 1);
