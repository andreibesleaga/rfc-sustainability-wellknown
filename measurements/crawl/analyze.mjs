#!/usr/bin/env node
/**
 * node analyze.mjs --in CRAWL_DIR [--interop-csv FILE] [--out DIR]
 * Reads results.jsonl, done.txt and manifest.json; writes summary.json and tables.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { parseCsv, renderTables, summarize } from "./src/analysis.mjs";
import { readResults } from "./src/store.mjs";

async function main() {
  const { values } = parseArgs({ options: { in: { type: "string" }, out: { type: "string" }, "interop-csv": { type: "string" } } });
  if (!values.in) throw new Error("usage: node analyze.mjs --in CRAWL_DIR [--interop-csv FILE] [--out DIR]");
  const outDir = values.out ?? values.in;
  const manifestFile = join(values.in, "manifest.json");
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, "utf8")) : null;
  const interop = values["interop-csv"] ? parseCsv(readFileSync(values["interop-csv"], "utf8")) : null;
  const summary = summarize(await readResults(values.in), manifest);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(join(outDir, "tables.md"), renderTables(summary, interop));
  console.log(`wrote ${join(outDir, "summary.json")} and ${join(outDir, "tables.md")}`);
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  process.exit(2);
});
