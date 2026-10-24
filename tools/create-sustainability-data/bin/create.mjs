#!/usr/bin/env node
/**
 * create-sustainability-data: a few questions, one conformant file, the host's configuration.
 *
 *   npx create-sustainability-data                 # interactive
 *   npx create-sustainability-data --target "Acme Retail plc" --target-type organization \
 *       --provider "Acme Retail plc (sustainability@acme.example)" --methodology-uri /esg/methodology \
 *       --period 2025 --carbon-footprint 610 --carbon-unit tCO2e --disclosure-uri https://acme.example/esg \
 *       --host netlify --out ./site --key ./private.jwk
 *
 * Writes <out>/.well-known/sustainability-data plus the host's file (_headers, vercel.json, a server
 * snippet) and prints the command that checks the result. Nothing is estimated: a figure you do not
 * have is left out, and a file with no figure needs a link to evidence. The file is validated as the
 * strict reader validates it before anything is written, and is signed only when you give an Ed25519 key.
 */
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr, argv, exit } from "node:process";
import { checkedDocument, declarationFrom } from "../src/declaration.mjs";
import { AGGREGATE_ADVICE, PRIVACY_WARNINGS, FUNCTIONAL_UNIT_MEANINGS, METHOD_MEANINGS, TARGET_TYPE_MEANINGS, menu } from "../src/descriptions.mjs";
import { HOSTS, filesFor } from "../src/hosts.mjs";
import { interview } from "../src/interview.mjs";
import { parseArgs } from "../src/options.mjs";
import { loadEd25519Key, signed } from "../src/sign.mjs";
import { methodologyStub } from "../src/stub.mjs";

export { HOSTS, declarationFrom, filesFor, parseArgs, checkedDocument };

const USAGE = `usage: create-sustainability-data [options]
  --target TEXT --target-type TYPE --provider TEXT --methodology-uri URI_REFERENCE
  --period 2025 | 2025-03 | 2025-03-14 [--offset Z|+02:00]   a whole calendar year, month or day (default: last year)
  --period-start DATE-TIME --period-end DATE-TIME           explicit bounds, start included, end excluded
  --first-day YYYY-MM-DD --last-day YYYY-MM-DD              inclusive days, e.g. a year ending 31 March
  --energy-consumption N --energy-unit Wh|kWh|MWh|GWh       (or --energy-kwh N)
  --carbon-footprint N --carbon-unit gCO2e|kgCO2e|tCO2e     (or --carbon-kgco2e N)
  --carbon-accounting location-based|market-based --scope-1 N --scope-2 N --scope-3 N
  --renewable-energy PERCENT --sci-score N --functional-unit UNIT
  --disclosure-uri URI_REFERENCE --verifiable-attestation-uri URI_REFERENCE
  --measurement-method TOKEN --upstream [ROLE:]URI_REFERENCE --extension 'NAME={"member": 1}'
  --key PRIVATE.jwk       sign with an Ed25519 key (sustainability-publisher keygen)
  --methodology-stub [--noise PERCENT]   also write methodology.md to fill in
  --host ${HOSTS.join("|")} --out DIR --updated DATE-TIME --yes

target-type:
${menu(TARGET_TYPE_MEANINGS)}
measurement-method, from the most to the least direct:
${menu(METHOD_MEANINGS)}
functional-unit:
${menu(FUNCTIONAL_UNIT_MEANINGS)}
upstream roles: hosting, colocation, cloud, cdn, network, electricity
`;

function noiseBound(a) {
  if (a.noise === undefined) return undefined;
  const n = Number(a.noise);
  if (!Number.isFinite(n) || n <= 0 || n > 1) throw new Error("noise is a percentage above 0 and at most 1 (the draft's bound)");
  return n;
}

/**
 * Everything the run will write and say, or an Error before any of it. `now` is the clock and
 * `loadKey` reads the signing key; both are passed in so that a test controls them.
 */
export async function build(a, { now = new Date(), loadKey = loadEd25519Key } = {}) {
  const noise = noiseBound(a);
  const { doc, notes } = declarationFrom(a, now);
  const warnings = checkedDocument(doc);
  const advice = [...PRIVACY_WARNINGS];
  if (["per-user", "per-device"].includes(doc["functional-unit"])) advice.push(`consider whether to ${AGGREGATE_ADVICE}`);
  if (a["methodology-uri"] && /^http:/i.test(a["methodology-uri"])) warnings.push("methodology-uri uses http; https is expected");
  let out = doc;
  if (a.key) out = await signed(doc, await loadKey(a.key));
  else notes.push("the file is unsigned; add --key <private.jwk> (an Ed25519 key from sustainability-publisher keygen) to sign it");
  const files = filesFor(a.host, out);
  if (a["methodology-stub"]) files["methodology.md"] = methodologyStub(doc, { noise });
  return { doc: out, files, notes, warnings, advice };
}

async function main() {
  const a = parseArgs(argv.slice(2));
  if (a.help) { console.log(USAGE); return; }
  if (stdin.isTTY && !a.yes && (!a.target || !a.provider || !a["methodology-uri"])) {
    const rl = createInterface({ input: stdin, output: stdout });
    const ask = async (q, d) => {
      const v = (await rl.question(d ? `${q} [${d}]: ` : `${q}: `)).trim();
      return v === "" ? d : v;
    };
    await interview(ask, a, (t) => console.log(t));
    rl.close();
  }
  const result = await build(a);
  for (const w of result.advice) stderr.write(`warning: ${w}\n`);
  for (const w of result.warnings) stderr.write(`warning: ${w}\n`);
  for (const n of result.notes) stderr.write(`note: ${n}\n`);
  for (const [rel, text] of Object.entries(result.files)) {
    const p = join(a.out, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
    console.log(`wrote ${p}`);
  }
  const host = result.doc["target-type"] === "origin" ? result.doc.target : "your-host.example";
  console.log(`\nDeploy, then check:\n  npx -y -p sustainability-wellknown-consumer sustainability-fetch https://${host} --strict`);
}

/** True when this file is the program being run, also through an npm bin symlink or on Windows. */
function isMainModule() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((e) => {
    console.error(`error: ${e.message}`);
    exit(1);
  });
}
