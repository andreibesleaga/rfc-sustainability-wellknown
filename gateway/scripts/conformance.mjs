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
 * `--allow-http` (anywhere in argv) permits a non-HTTPS origin — consumer
 * 0.6.0 refuses `http:` by default (`{ status: "insecure-transport" }`) — and
 * is what CI needs to reach a local `http://127.0.0.1:...` instance.
 *
 * Exit code 0 if every MUST-level check passes for every subject, 1 otherwise.
 * A `warn` (e.g. a subject still on the pre-06 media type) is reported but
 * never sets a non-zero exit code.
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

const prefixed = (domain) => (input, init) => {
  const u = new URL(typeof input === "string" ? input : input.toString());
  if (u.pathname === WELL_KNOWN) u.pathname = `/${domain}${WELL_KNOWN}`;
  return fetch(u, init);
};

let failures = 0;
let warnings = 0;

const report = async (label, fetchImpl) => {
  const r = await runConformanceChecks(base, fetchImpl, options);
  console.log(`\n${label}`);
  for (const c of r.checks) {
    // `level` arrives with consumer >= 0.5.0; older releases report every check
    // flatly, so an unlabelled check is treated as a MUST (the prior behaviour).
    const level = c.level ?? "MUST";
    // `outcome` arrives with consumer >= 0.6.0 (adds the third "warn" state,
    // e.g. a subject still on the pre-06 media type — reported, never a
    // failure). Older releases carry no `outcome`; derive an equivalent from
    // `pass`/`level` so the script still works against them, matching the
    // existing defensive pattern for `level` above.
    const outcome = c.outcome ?? (c.pass ? "pass" : level === "MUST" ? "fail" : "warn");
    const label = outcome === "pass" ? "PASS" : outcome === "warn" ? "WARN" : level === "MUST" ? "FAIL" : "WARN";
    console.log(`  ${label}  [${level}] ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
    if (outcome === "warn") {
      warnings++;
    } else if (outcome === "fail") {
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
