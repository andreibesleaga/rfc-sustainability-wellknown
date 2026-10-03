#!/usr/bin/env node
/**
 * Every normative sentence of the draft must be exercised by at least one
 * scenario, and every scenario must cite sentences that still exist.
 *
 * requirements.json is regenerated from the draft by extract.mjs; this check
 * fails when the committed file no longer matches the draft (so an edited
 * sentence gets a new id and its scenarios must be re-pointed), when a
 * requirement has no scenario, or when a feature cites an unknown id.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extract, supplement } from "./extract.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// The revision this suite tracks is the one named in requirements.json (the posted draft); moving it is a
// deliberate act: npm run trace:extract -- <draft.md>, then re-point the tags check.mjs lists.
const committed = JSON.parse(readFileSync(join(here, "requirements.json"), "utf8"));
const draftPath = join(here, "..", "..", "internet-drafts", committed.source);
const draftText = readFileSync(draftPath, "utf8");
const supp = supplement(draftText);
const fresh = extract(draftText).concat(supp);
const missing = supp.filter((r) => !r.present);

const freshIds = new Set(fresh.map((r) => r.id));
const committedIds = new Set(committed.requirements.map((r) => r.id));
const drift = [...freshIds].filter((id) => !committedIds.has(id)).concat([...committedIds].filter((id) => !freshIds.has(id)));

const featuresDir = join(here, "..", "features");
const cited = new Map();
for (const file of readdirSync(featuresDir).filter((f) => f.endsWith(".feature"))) {
  const text = readFileSync(join(featuresDir, file), "utf8");
  for (const m of text.matchAll(/@(req-[0-9a-f]{8})/g)) {
    if (!cited.has(m[1])) cited.set(m[1], new Set());
    cited.get(m[1]).add(file);
  }
}

const uncovered = committed.requirements.filter((r) => !cited.has(r.id));
const unknown = [...cited.keys()].filter((id) => !committedIds.has(id));

let failed = false;
if (missing.length) {
  failed = true;
  console.error(`${missing.length} supplement sentence(s) no longer occur verbatim in the draft:`);
  for (const r of missing) console.error(`  ${r.id} ${r.text.slice(0, 110)}`);
}
if (drift.length) {
  failed = true;
  console.error(`requirements.json is out of date with the draft (${drift.length} id(s) differ); run: npm run trace:extract, then re-point the scenarios`);
  for (const id of drift) console.error(`  ${committedIds.has(id) ? "gone" : "new "} ${id}`);
}
if (unknown.length) {
  failed = true;
  console.error(`features cite ${unknown.length} unknown requirement id(s):`);
  for (const id of unknown) console.error(`  ${id} in ${[...cited.get(id)].join(", ")}`);
}
if (uncovered.length) {
  failed = true;
  console.error(`${uncovered.length} normative sentence(s) have no scenario:`);
  for (const r of uncovered) console.error(`  ${r.id} [${r.section}] ${r.text.slice(0, 110)}`);
}
const covered = committed.requirements.length - uncovered.length;
console.log(`traceability: ${covered}/${committed.requirements.length} normative sentences of ${committed.source} cited by scenarios in ${new Set([...cited.values()].flatMap((s) => [...s])).size} feature file(s)`);
process.exit(failed ? 1 : 0);
