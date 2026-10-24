/**
 * Architecture fitness functions over the example corpus: the files in
 * schemas-validators/examples/ and in example-responses/ are the data every
 * validator, library and scenario runs on, so the corpus itself is held to
 * four rules. Everything here reads files; no clock, no network.
 *
 *  1. The manifest and the disk list the same files.
 *  2. Every value of every closed token set, and every member, occurs in a
 *     file whose manifest entry says it is valid.
 *  3. In the served set, `updated` is not before the end of any period.
 *  4. Every rule key the manifest carries is cited by a scenario, and a
 *     scenario cites no key that no example (or known test input) has.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = join(ROOT, "schemas-validators", "examples");
const SERVED = join(ROOT, "example-responses");
const FEATURES = join(ROOT, "bdd", "features");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const manifest = readJson(join(EXAMPLES, "manifest.json"));
const schema = readJson(join(ROOT, "schemas-validators", "response-schema.json"));

function* filesUnder(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* filesUnder(p);
    else yield p;
  }
}

/** A manifest path is relative to examples/ and may point into example-responses/. */
const fromManifest = (path) => normalize(join(EXAMPLES, path));
const objectsOf = (doc) => (Array.isArray(doc) ? doc : [doc]);

/** The files a manifest entry vouches for: the file itself and, for a legacy input, its golden output. */
function listedFiles() {
  const listed = new Set();
  for (const entry of manifest) {
    listed.add(fromManifest(entry.path));
    if (entry.golden) listed.add(fromManifest(entry.golden));
  }
  return listed;
}

/** The files of the two homes: every directory of the corpus except the manifest and the query table, and the served set. */
function filesOnDisk() {
  const own = new Set(["manifest.json", "queries.json"]);
  const corpus = [...filesUnder(EXAMPLES)].filter((p) => !own.has(relative(EXAMPLES, p)));
  return new Set([...corpus, ...filesUnder(SERVED)].map(normalize));
}

/** A file is valid when the manifest says every schema engine and the strict reading accept it. */
const isValidEntry = (e) => e.cddl === true && e.jtd === true && e.ajv === true && e.strict === "ok";

/** Every enumeration of the JTD schema: member name -> its values. The schema is held equal to the draft's CDDL by the schema tests. */
function closedSets(node = schema, name = "", found = new Map()) {
  if (Array.isArray(node.enum)) found.set(name, node.enum);
  for (const section of ["properties", "optionalProperties"]) {
    for (const [member, child] of Object.entries(node[section] ?? {})) closedSets(child, member, found);
  }
  if (node.elements) closedSets(node.elements, name, found);
  return found;
}

/** Every value that each member takes in the given objects, as strings, with upstream roles under `role`. */
function valuesSeen(objects) {
  const seen = new Map();
  const add = (member, value) => {
    if (!seen.has(member)) seen.set(member, new Set());
    seen.get(member).add(value);
  };
  for (const o of objects) {
    for (const [member, value] of Object.entries(o)) {
      add(member, typeof value === "string" ? value : "");
      if (member === "upstream" && Array.isArray(value)) value.forEach((u) => u.role && add("role", u.role));
    }
  }
  return seen;
}

test("the manifest and the two homes list the same files", () => {
  const listed = listedFiles();
  const onDisk = filesOnDisk();
  const unlisted = [...onDisk].filter((p) => !listed.has(p)).map((p) => relative(ROOT, p));
  const missing = [...listed].filter((p) => !onDisk.has(p)).map((p) => relative(ROOT, p));
  assert.deepEqual(unlisted, [], `on disk but not in the manifest:\n${unlisted.join("\n")}`);
  assert.deepEqual(missing, [], `in the manifest but not on disk:\n${missing.join("\n")}`);
  const ids = manifest.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "manifest ids are unique");
});

test("every served example is in the manifest as valid", () => {
  const entries = new Map(manifest.map((e) => [fromManifest(e.path), e]));
  const served = [...filesUnder(SERVED)].filter((p) => p.endsWith(".json")).map(normalize);
  assert.ok(served.length >= 40, `only ${served.length} served examples`);
  for (const p of served) {
    const entry = entries.get(p);
    assert.ok(entry && isValidEntry(entry), `${relative(ROOT, p)} is not recorded as valid`);
  }
});

test("every value of the closed token sets occurs in a valid file", () => {
  const validObjects = manifest
    .filter(isValidEntry)
    .flatMap((e) => objectsOf(readJson(fromManifest(e.path))));
  const seen = valuesSeen(validObjects);
  const sets = closedSets();
  assert.equal(sets.size, 8, `expected eight closed sets, the schema has ${[...sets.keys()].join(", ")}`);
  for (const [member, values] of sets) {
    const missing = values.filter((v) => !seen.get(member)?.has(v));
    assert.deepEqual(missing, [], `${member}: no valid file uses ${missing.join(", ")}`);
  }
});

test("every one of the 26 members occurs in a valid file", () => {
  const members = [...Object.keys(schema.properties), ...Object.keys(schema.optionalProperties)];
  assert.equal(members.length, 26);
  const validObjects = manifest.filter(isValidEntry).flatMap((e) => objectsOf(readJson(fromManifest(e.path))));
  const seen = valuesSeen(validObjects);
  const missing = members.filter((m) => !seen.has(m));
  assert.deepEqual(missing, [], `no valid file carries: ${missing.join(", ")}`);
});

test("in the served set `updated` is not before the end of any period", () => {
  const offenders = [];
  for (const p of filesUnder(SERVED)) {
    if (!p.endsWith(".json")) continue;
    for (const o of objectsOf(readJson(p))) {
      if (Date.parse(o.updated) < Date.parse(o.period.end)) offenders.push(`${relative(ROOT, p)}: updated ${o.updated}, period ends ${o.period.end}`);
    }
  }
  assert.deepEqual(offenders, []);
});

/** Rule keys whose examples are not files: the rows of queries.json, and inputs a test builds (oversize bodies, hostile addresses). */
const KEYS_WITHOUT_A_FILE = new Set(["qry-1", "qry-2", "qry-3", "qry-8", "lim-1"]);

test("every rule key of the manifest is cited by a scenario, and a scenario cites no unknown key", () => {
  const inManifest = new Set(manifest.flatMap((e) => e.rk));
  const cited = new Set();
  for (const name of readdirSync(FEATURES)) {
    if (!name.endsWith(".feature")) continue;
    for (const m of readFileSync(join(FEATURES, name), "utf8").matchAll(/@rk-([a-z]+-\d+)/g)) cited.add(m[1]);
  }
  assert.deepEqual([...cited].filter((k) => !inManifest.has(k) && !KEYS_WITHOUT_A_FILE.has(k)).sort(), [], "cited by a scenario, but no example has the key");
  assert.deepEqual([...inManifest].filter((k) => !cited.has(k)).sort(), [], "an example has the key, but no scenario cites it");
});
