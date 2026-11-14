/**
 * The output folder. Append-only:
 *   results.jsonl   one record per request, an origin's lines written together
 *   done.txt        one host per line, written AFTER its records: the truth for resume
 *   documents/      the bodies of documents classed valid, invalid or parseable
 *   manifest.json   the run's parameters and list fingerprint
 * A crash between the two appends leaves records of an unfinished origin; they
 * are ignored on reading and the origin is crawled again.
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The finished origins; reads only, so a dry run leaves no folder behind. */
export async function readDone(dir) {
  const file = join(dir, "done.txt");
  return new Set(existsSync(file) ? (await readFile(file, "utf8")).split("\n").filter(Boolean) : []);
}

const lines = (items) => items.map((i) => JSON.stringify(i) + "\n").join("");

export async function openStore(dir) {
  await mkdir(join(dir, "documents"), { recursive: true });
  const resultsFile = join(dir, "results.jsonl");
  const doneFile = join(dir, "done.txt");
  return {
    dir,
    async commit(host, records) {
      await appendFile(resultsFile, lines(records));
      await appendFile(doneFile, host + "\n");
    },
    async saveDocument(host, probeId, bytes) {
      const name = `${host.replace(/[^a-z0-9.-]/g, "_")}__${probeId}.body`;
      await writeFile(join(dir, "documents", name), bytes);
      return `documents/${name}`;
    },
    async writeManifest(manifest) {
      await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    },
  };
}

/** Records of finished origins only, the last record per origin and probe, in file order. */
export async function readResults(dir) {
  const done = await readDone(dir);
  const text = await readFile(join(dir, "results.jsonl"), "utf8");
  const latest = new Map();
  for (const line of text.split("\n")) {
    const record = parseLine(line);
    if (record && done.has(record.origin)) latest.set(`${record.origin}\t${record.probe}`, record);
  }
  return [...latest.values()];
}

function parseLine(line) {
  try {
    return line ? JSON.parse(line) : null;
  } catch {
    return null; // a torn last line
  }
}
