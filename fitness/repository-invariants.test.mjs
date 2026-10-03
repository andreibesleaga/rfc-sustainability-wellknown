/**
 * Architecture fitness functions over the repository itself: rules that no
 * single package's tests can see because they span packages, documents and
 * the draft. Each one states the rule it keeps.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const consumer = require(resolve(ROOT, "consumer", "dist", "index.js"));

const SKIP_DIRS = new Set(["node_modules", ".git", "temp", "dist", "coverage", "out", "__pycache__", ".pytest_cache"]);
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const TEXT = /\.(md|ts|mts|mjs|js|cjs|json|yml|yaml|txt|html|py|php|sh|conf|feature|cddl|toml)$/;
const publicTextFiles = () => [...walk(ROOT)].filter((p) => TEXT.test(p));
const rel = (p) => relative(ROOT, p);

test("no public file points at the private temp/ folder", () => {
  const offenders = [];
  for (const p of publicTextFiles()) {
    if (/^\.gitignore$/.test(rel(p))) continue;
    const text = readFileSync(p, "utf8");
    if (/(^|[\s"'`(/])temp\/(?!\S*\.(tmp|log))/m.test(text) && !/scratch|mkdtemp|tmpdir|\/tmp\//.test(text)) {
      // Allow prose that says "the temp/ folder is ignored" only in CONTRIBUTING/README of the root.
      if (/^(README|CONTRIBUTING|bdd\/README|fitness\/README)\.md$/.test(rel(p)) && /ignored|private|not published/.test(text)) continue;
      offenders.push(rel(p));
    }
  }
  assert.deepEqual(offenders, [], `temp/ referenced in: ${offenders.join(", ")}`);
});

test("the author's e-mail address appears only in the posted drafts", () => {
  const offenders = [];
  for (const p of publicTextFiles()) {
    if (rel(p).startsWith("internet-drafts/")) continue;
    const text = readFileSync(p, "utf8");
    if (/andrei\.besleaga@ieee\.org|besleaga[\w.]*@gmail\.com/i.test(text)) offenders.push(rel(p));
  }
  assert.deepEqual(offenders, []);
});

test('no public text says "chapter <n>"', () => {
  const offenders = [];
  for (const p of publicTextFiles()) {
    if (/\.(ts|mjs|js|cjs|json|yml|yaml|py|php|sh|conf|cddl)$/.test(p)) continue;
    if (/\bchapter \d+\b/i.test(readFileSync(p, "utf8"))) offenders.push(rel(p));
  }
  assert.deepEqual(offenders, []);
});

test("every package declares Node 22.12 or newer", () => {
  for (const pkg of ["publisher", "consumer", "gateway", "sfc-compliance", "bdd", "fitness", "tools/report-to-declaration"]) {
    const p = join(ROOT, pkg, "package.json");
    const j = JSON.parse(readFileSync(p, "utf8"));
    const node = j.engines?.node ?? "";
    assert.match(node, />=\s*(2[2-9]|[3-9]\d)/, `${pkg}: engines.node = ${JSON.stringify(node)}`);
  }
});

test("the consumer never imports the publisher, and the gateway reaches both only by package name", () => {
  for (const p of walk(join(ROOT, "consumer", "src"))) {
    if (!/\.ts$/.test(p)) continue;
    assert.doesNotMatch(readFileSync(p, "utf8"), /from\s+["'][^"']*publisher/, rel(p));
  }
  for (const p of walk(join(ROOT, "gateway", "src"))) {
    if (!/\.ts$/.test(p)) continue;
    const text = readFileSync(p, "utf8");
    assert.doesNotMatch(text, /from\s+["']\.\.\/\.\.\/(publisher|consumer)/, `${rel(p)} imports a sibling source tree`);
  }
});

test("every example response and every served data file validates with the shipped consumer", () => {
  const dirs = [join(ROOT, "example-responses"), join(ROOT, "gateway", "data")];
  let n = 0;
  for (const dir of dirs) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || name.startsWith("_")) continue;
      const doc = JSON.parse(readFileSync(join(dir, name), "utf8"));
      // A data file may wrap the declaration with gateway metadata; validate the declaration part.
      const candidate = doc && typeof doc === "object" && !Array.isArray(doc) && doc.document ? doc.document : doc;
      const r = consumer.validateDocument(candidate);
      assert.equal(r.valid, true, `${rel(join(dir, name))}: ${JSON.stringify(r.errors)}`);
      n += 1;
    }
  }
  assert.ok(n >= 40, `only ${n} documents validated`);
});

test("the root README names the publisher version in package.json", () => {
  const version = JSON.parse(readFileSync(join(ROOT, "publisher", "package.json"), "utf8")).version;
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes(`\`${version}\``), `README does not mention publisher ${version}`);
});

test("the two npm packages stay small", () => {
  for (const pkg of ["publisher", "consumer"]) {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: join(ROOT, pkg), encoding: "utf8" });
    const [info] = JSON.parse(out);
    assert.ok(info.size < 1_000_000, `${pkg} tarball is ${info.size} bytes`);
    assert.ok(!info.files.some((f) => /private|\.pem$|\.env/.test(f.path)), `${pkg} would ship a secret-looking file`);
  }
});

test("unit tests inject their clocks: no bare Date.now() or new Date() in test files", () => {
  const offenders = [];
  for (const pkg of ["publisher", "consumer", "gateway"]) {
    for (const p of walk(join(ROOT, pkg, "test"))) {
      if (!/\.ts$/.test(p)) continue;
      const lines = readFileSync(p, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (/\bDate\.now\(\)|new Date\(\)/.test(line) && !/\/\/.*(fixed|injected|clock|allowed)/i.test(line)) offenders.push(`${rel(p)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, [], `wall-clock reads in tests:\n${offenders.join("\n")}`);
});
