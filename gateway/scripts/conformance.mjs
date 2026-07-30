#!/usr/bin/env node
/**
 * Run the repository's own conformance battery against a LIVE gateway
 * deployment — the gateway's own report at the root, then every subject listed
 * in /index.json.
 *
 *   node scripts/conformance.mjs https://your-gateway.example.org
 *
 * The battery (`sustainability-wellknown-consumer`) always requests
 * `/.well-known/sustainability-data` at the origin root. This gateway serves
 * subjects under a path prefix, so each subject run injects a `fetch` that
 * rewrites that one path. Every other check is unmodified.
 *
 * Exit code 0 if every check passes for every subject, 1 otherwise.
 */
import { runConformanceChecks } from "sustainability-wellknown-consumer";

const WELL_KNOWN = "/.well-known/sustainability-data";

const origin = process.argv[2];
if (!origin) {
  console.error("usage: node scripts/conformance.mjs <origin>");
  process.exit(2);
}
const base = origin.replace(/\/+$/, "");

const prefixed = (domain) => (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.toString());
  if (u.pathname === WELL_KNOWN) u.pathname = `/${domain}${WELL_KNOWN}`;
  return fetch(u, init);
};

let failures = 0;
let warnings = 0;

const report = async (label, fetchImpl) => {
  const r = await runConformanceChecks(base, fetchImpl);
  console.log(`\n${label}`);
  for (const c of r.checks) {
    // `level` arrives with consumer >= 0.5.0; older releases report every check
    // flatly, so an unlabelled check is treated as a MUST (the prior behaviour).
    const level = c.level ?? "MUST";
    const label = c.pass ? "PASS" : level === "MUST" ? "FAIL" : "WARN";
    console.log(`  ${label}  [${level}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    if (!c.pass) {
      if (level === "MUST") failures++;
      else warnings++;
    }
  }
};

await report(`ROOT (the gateway's own report)  ${base}${WELL_KNOWN}`, globalThis.fetch);

const idxRes = await fetch(`${base}/index.json`);
if (!idxRes.ok) {
  console.error(`\nCould not read ${base}/index.json (HTTP ${idxRes.status})`);
  process.exit(1);
}
const idx = await idxRes.json();
// Curated subjects, adapter demonstrations, and wire-format examples are all
// full Basic subjects — the battery covers every routed document. Older
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
