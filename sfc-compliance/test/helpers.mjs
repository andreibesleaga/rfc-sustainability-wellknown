/** Shared by the checker tests: the vector scenarios, the input a scenario stands for, and the rows it selects. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const readJson = (...parts) => JSON.parse(readFileSync(join(root, ...parts), "utf8"));

/** Every vector file as { name, inputs, expected }, the worked case last. */
export function vectorFiles() {
  const names = readdirSync(join(root, "vectors", "inputs")).map((f) => f.replace(".json", "")).sort();
  const files = names.map((name) => ({ name, inputs: readJson("vectors", "inputs", `${name}.json`), expected: readJson("vectors", "expected", `${name}.json`) }));
  files.push({ name: "worked", inputs: readJson("vectors", "worked", "input.json"), expected: readJson("vectors", "worked", "expected.json") });
  return files;
}

/** The input of the checker a check scenario stands for: its members, the shared excerpt resolved, the recorded consumer verdict dropped. */
export function inputOf(scenario, file) {
  const { name, select, derive, effectiveAt, consumer, excerptRef, ...input } = scenario;
  if (excerptRef) input.excerpt = file.inputs.excerpts[excerptRef];
  return input;
}

/** The rows a scenario asks for: those whose id is, or starts with, a selected id. */
export function selectRows(rows, select) {
  return select ? rows.filter((r) => select.some((s) => r.id === s || r.id.startsWith(`${s}.`))) : rows;
}
