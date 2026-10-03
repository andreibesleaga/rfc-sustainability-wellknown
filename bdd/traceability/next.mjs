#!/usr/bin/env node
/**
 * Report only: which normative sentences the newest draft in internet-drafts/ adds, removes or changes
 * compared with the revision this suite tracks (requirements.json). Exit status is always 0; the point is
 * that a normative edit in a draft being prepared is visible before that draft is posted.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extract, supplement } from "./extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const drafts = join(here, "..", "..", "internet-drafts");
const committed = JSON.parse(readFileSync(join(here, "requirements.json"), "utf8"));
const newest = readdirSync(drafts).filter((f) => /^draft-besleaga-sustainability-wellknown-\d\d\.md$/.test(f)).sort().pop();
if (newest === committed.source) {
  console.log(`trace:next: the tracked revision ${committed.source} is the newest draft; nothing to compare.`);
  process.exit(0);
}
const text = readFileSync(join(drafts, newest), "utf8");
const next = extract(text).concat(supplement(text).filter((r) => r.present).map(({ present, ...r }) => r));
const before = new Map(committed.requirements.map((r) => [r.id, r]));
const after = new Map(next.map((r) => [r.id, r]));
const gone = [...before.values()].filter((r) => !after.has(r.id));
const added = [...after.values()].filter((r) => !before.has(r.id));
console.log(`trace:next: ${committed.source} (tracked) -> ${newest}: ${gone.length} normative sentence(s) changed or removed, ${added.length} added or changed.`);
for (const r of gone) console.log(`  - ${r.id} [${r.section}] ${r.text.slice(0, 120)}`);
for (const r of added) console.log(`  + ${r.id} [${r.section}] ${r.text.slice(0, 120)}`);
if (gone.length || added.length) console.log("  When the newest draft is posted: node traceability/extract.mjs --write ../internet-drafts/" + newest + ", then re-point the tags.");
