#!/usr/bin/env node
/**
 * Run the repository's own conformance battery against a LIVE gateway
 * deployment — the gateway's own report at the root, then every subject listed
 * in /index.json.
 *
 *   node scripts/conformance.mjs https://your-gateway.example.org
 *   node scripts/conformance.mjs http://127.0.0.1:8080 --allow-http
 *
 * The battery (`sustainability-wellknown-consumer`) always requests
 * `/.well-known/sustainability-data` at the origin root. This gateway serves
 * subjects under a path prefix, so each subject run injects a `fetch` that
 * rewrites that one path. Every other check is unmodified.
 *
 * `--allow-http` (anywhere in argv) permits a non-HTTPS origin — the consumer
 * refuses `http:` by default (`{ status: "insecure-transport" }`) — and is
 * what CI needs to reach a local `http://127.0.0.1:...` instance.
 *
 * A 429 from the gateway's per-client limit is waited out (Retry-After), not counted as a failure.
 *
 * Exit code 0 if every MUST-level check passes for every subject, 1 otherwise.
 * A `warn` (e.g. a subject still on the generic `application/json` media type)
 * is reported but never sets a non-zero exit code.
 */
import { runConformanceChecks } from "sustainability-wellknown-consumer";

const WELL_KNOWN = "/.well-known/sustainability-data";

const args = process.argv.slice(2);
const allowHttp = args.includes("--allow-http");
const origin = args.find((a) => a !== "--allow-http" && !a.startsWith("-"));
if (!origin) {
  console.error("usage: node scripts/conformance.mjs <origin> [--allow-http]");
  process.exit(2);
}
const base = origin.replace(/\/+$/, "");
const options = { allowInsecure: allowHttp };

// Only the well-known path is rewritten under the subject's prefix. Since -07
// that is the ONE resource the specification defines: the signature is a
// member of the declaration, so there is no companion path to re-point, and
// the battery's signature check reads the body it already fetched.
const prefixed = (domain) => (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.toString());
  if (u.pathname === WELL_KNOWN) u.pathname = `/${domain}${u.pathname}`;
  return patient(u, init);
};

// The battery makes a dozen requests per document and the gateway allows 600 a minute per client, so a run over
// every document would meet a 429 if it went at full speed. Requests are spaced to stay under that limit; a 429
// that still arrives is not a verdict on the document, so it is waited out (Retry-After) and the request repeated.
const GAP_MS = 130;
let nextSlot = 0;
const patient = async (input, init) => {
  for (let attempt = 0; ; attempt++) {
    const slot = Math.max(nextSlot, Date.now());
    nextSlot = slot + GAP_MS;
    if (slot > Date.now()) await new Promise((resolve) => setTimeout(resolve, slot - Date.now()));
    const res = await fetch(input, init);
    if (res.status !== 429 || attempt >= 2) return res;
    const wait = Math.min(Math.max(Number(res.headers.get("retry-after")) || 1, 1), 8);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
};

let failures = 0;
let warnings = 0;

const report = async (label, fetchImpl) => {
  const r = await runConformanceChecks(base, fetchImpl, options);
  console.log(`\n${label}`);
  for (const c of r.checks) {
    // `outcome` is pass | warn | fail; a failed MUST is a conformance failure,
    // everything else short of pass is an unmet recommendation.
    const label = c.outcome === "pass" ? "PASS" : c.outcome === "fail" && c.level === "MUST" ? "FAIL" : "WARN";
    console.log(`  ${label}  [${c.level}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    if (label === "FAIL") failures++;
    else if (label === "WARN") warnings++;
  }
};

await report(`ROOT (the gateway's own report)  ${base}${WELL_KNOWN}`, patient);

const idxRes = await fetch(`${base}/index.json`);
if (!idxRes.ok) {
  console.error(`\nCould not read ${base}/index.json (HTTP ${idxRes.status})`);
  process.exit(1);
}
const idx = await idxRes.json();
// Curated subjects, adapter demonstrations, and wire-format examples are all
// subjects of the registry, some of them Extended — the battery covers every routed document. Older
// deployments only carry `subjects`.
const routed = [
  ...idx.subjects.map((s) => ({ ...s, kind: "SUBJECT" })),
  ...(idx["adapter-demonstrations"]?.entries ?? []).map((s) => ({ ...s, kind: "DEMO" })),
  ...(idx["wire-format-examples"]?.entries ?? []).map((s) => ({ ...s, kind: "EXAMPLE" })),
];
for (const s of routed) {
  await report(`${s.kind} ${s.domain}  ${base}${s.path}`, prefixed(s.domain));
}

console.log(
  `\n${failures === 0 ? "ALL MUST-LEVEL CHECKS PASSED" : `${failures} MUST-LEVEL CHECK(S) FAILED`}` +
    `${warnings > 0 ? `, ${warnings} unmet recommendation(s)` : ""} — ` +
    `${routed.length} subject(s) + the gateway's own report`,
);
process.exit(failures === 0 ? 0 : 1);
