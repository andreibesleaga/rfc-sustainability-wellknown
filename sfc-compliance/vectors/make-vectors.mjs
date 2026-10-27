#!/usr/bin/env node
/**
 * Generates every input and expected output of the SFC 2 test vectors from fixed values.
 * Deterministic: a fixed clock (T = 2026-05-02T00:10:00Z), the RFC 8032 section 7.1 test 1 key,
 * no network, no randomness. Run: node vectors/make-vectors.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { reportOf } from "./scenario-report.mjs";
import { FUNCS } from "./functions.mjs";
import * as c01 from "./cases/c01-basic.mjs";
import * as c02 from "./cases/c02-rules.mjs";
import * as c03 from "./cases/c03-figures.mjs";
import * as c04 from "./cases/c04-profile1x.mjs";
import * as c05 from "./cases/c05-window.mjs";
import * as c06 from "./cases/c06-replay.mjs";
import * as c07 from "./cases/c07-objects.mjs";
import * as c08 from "./cases/c08-limits.mjs";
import * as c09 from "./cases/c09-worked.mjs";
import { EXAMPLE_PARAMS } from "./cases/base.mjs";
import { objectsOf } from "../lib/declaration.mjs";

const source = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// `--out <dir>` writes the vectors to <dir>/vectors and the examples to <dir>/examples (a test compares two runs); the default is this tree
const outIndex = process.argv.indexOf("--out");
const outRoot = outIndex > 0 ? resolve(process.argv[outIndex + 1]) : null;
const here = outRoot ? join(outRoot, "vectors") : source;
const examplesDir = outRoot ? join(outRoot, "examples") : join(source, "..", "examples");

const CASES = [c01.v01, c01.v02, c01.v03, c01.v04, c01.v05, c01.v06, c02.v07, c02.v08, c02.v09, c02.v10, c02.v11, c02.v12, c02.v16, c03.v13, c03.v14, c04.v15, c04.v18, c04.v24, c05.v19, c05.v20, c05.v21, c05.v22, c05.v23, c06.v25, c06.v26, c06.v27, c06.v28, c07.v29, c07.v29b, c07.v30, c07.v31, c07.v32, c07.v33, c08.v17];
const WORKED = c09.worked;

/** Pretty JSON, with the long arrays of objects (events, entries) one element per line. */
const ONE_PER_LINE = ["ledger", "registry", "chain", "operators", "values", "cases", "events", "voids", "declarations"];
function pretty(v, ind = "", key = "") {
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (v.every((x) => x !== null && typeof x === "object") && ONE_PER_LINE.includes(key)) return `[\n${v.map((x) => `${ind}  ${JSON.stringify(x)}`).join(",\n")}\n${ind}]`;
    const flat = JSON.stringify(v);
    if (v.every((x) => x === null || typeof x !== "object") && flat.length < 100) return flat;
    return `[\n${v.map((x) => `${ind}  ${pretty(x, `${ind}  `)}`).join(",\n")}\n${ind}]`;
  }
  if (v !== null && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);   // as JSON.stringify: undefined is absent
    if (!keys.length) return "{}";
    return `{\n${keys.map((k) => `${ind}  ${JSON.stringify(k)}: ${pretty(v[k], `${ind}  `, k)}`).join(",\n")}\n${ind}}`;
  }
  return JSON.stringify(v);
}
const write = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${pretty(value)}\n`); };

/** Replace repeated excerpts by references into a shared table, so an input file stays small. */
function shareExcerpts(inputs) {
  const table = {}, byText = new Map();
  for (const sc of inputs.scenarios) {
    if (!sc.excerpt) continue;
    const text = JSON.stringify(sc.excerpt);
    if (!byText.has(text)) { const ref = `x${byText.size + 1}`; byText.set(text, ref); table[ref] = sc.excerpt; }
    sc.excerptRef = byText.get(text);
    delete sc.excerpt;
  }
  if (Object.keys(table).length) inputs.excerpts = table;
  return inputs;
}

/** The published consumer library's verdict on each declaration object (the objects of the body, as the checker reads them), recorded as an input. */
async function consumerVerdict(sc) {
  const body = sc.declarations ?? (sc.declarationText ? JSON.parse(sc.declarationText) : undefined);
  if (body === undefined) return undefined;
  const lib = await import("sustainability-wellknown-consumer");
  const version = JSON.parse(readFileSync(require.resolve("sustainability-wellknown-consumer/package.json"), "utf8")).version;
  const valid = objectsOf(body).map((o) => lib.validateDocument(o, { legacyCompat: false }).valid);
  return { library: "sustainability-wellknown-consumer", version, valid };
}

async function build(make, dir) {
  const c = make();
  const inputs = { id: c.id, scenarios: [] }, expected = { id: c.id, scenarios: {} };
  for (const sc of c.scenarios) {
    if (sc.fn) {
      inputs.scenarios.push(sc);
      expected.scenarios[sc.name] = { result: FUNCS[sc.fn](sc) };
      continue;
    }
    const consumer = await consumerVerdict(sc);
    const full = consumer ? { ...sc, consumer } : sc;
    inputs.scenarios.push({ ...full });
    expected.scenarios[sc.name] = await reportOf(full);
  }
  return { c, inputs: shareExcerpts(inputs), expected };
}

const BEGIN = "<!-- sfc-parameters:begin -->", END = "<!-- sfc-parameters:end -->";

/** The examples are built from the same objects as the vectors, so every figure in them recomputes. */
function writeExamples() {
  const ex = examplesDir;
  const docs = c01.exampleDocuments();
  write(join(ex, "sfc-network.example.json"), docs.network);
  write(join(ex, "sfc-operator.example.json"), docs.operator);
  write(join(ex, "sfc-parameters.example.json"), EXAMPLE_PARAMS);
  const path = join(ex, "METHODOLOGY.md");
  if (outRoot) { mkdirSync(ex, { recursive: true }); writeFileSync(path, readFileSync(join(source, "..", "examples", "METHODOLOGY.md"), "utf8")); }
  const text = readFileSync(path, "utf8");
  const a = text.indexOf(BEGIN), b = text.indexOf(END);
  if (a < 0 || b < 0) throw new Error("METHODOLOGY.md lacks the parameter markers");
  const block = `${BEGIN}\n\n\`\`\`json\n${JSON.stringify(EXAMPLE_PARAMS, null, 2)}\n\`\`\`\n\n${END}`;
  writeFileSync(path, text.slice(0, a) + block + text.slice(b + END.length));
}

async function main() {
  for (const d of ["inputs", "expected", "worked"]) rmSync(join(here, d), { recursive: true, force: true });
  const w = await build(WORKED);
  write(join(here, "worked", "input.json"), w.inputs);
  write(join(here, "worked", "expected.json"), w.expected);
  console.log("worked: 1 scenario(s)");
  for (const make of CASES) {
    const { c, inputs, expected } = await build(make);
    write(join(here, "inputs", `${c.id}.json`), inputs);
    write(join(here, "expected", `${c.id}.json`), expected);
    console.log(`${c.id}: ${c.scenarios.length} scenario(s)`);
  }
  writeExamples();
}
main().catch((e) => { console.error(e); process.exit(1); });
