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

/** `>=22.13` -> [22, 13]; undefined when the range is not a plain lower bound. */
function lowerBound(range) {
  const m = /^>=\s*(\d+)\.(\d+)/.exec(range ?? "");
  return m ? [Number(m[1]), Number(m[2])] : undefined;
}
const atLeast = (range, [major, minor]) => {
  const bound = lowerBound(range);
  return bound !== undefined && (bound[0] > major || (bound[0] === major && bound[1] >= minor));
};
const packageJson = (pkg) => JSON.parse(readFileSync(join(ROOT, pkg, "package.json"), "utf8"));

// The publisher and the consumer need Node 22.13 (require() of ES modules, unflagged); everything that loads them inherits it,
// the SFC checker and the two deployment kits that run the publisher included.
const NEEDS_22_13 = [
  "publisher",
  "consumer",
  "gateway",
  "bdd",
  "fitness",
  "sfc-compliance",
  "tools/create-sustainability-data",
  "tools/report-to-declaration",
  "deploy/one-click/railway",
  "deploy/home-assistant/sustainability-data",
];

test("every package that loads the publisher or the consumer declares Node 22.13 or newer", () => {
  for (const pkg of NEEDS_22_13) {
    const node = packageJson(pkg).engines?.node ?? "";
    assert.ok(atLeast(node, [22, 13]), `${pkg}: engines.node = ${JSON.stringify(node)}`);
  }
});

test("no public document states the extension-name rules that -10 removed", () => {
  const removed = /Nil and Max UUID|octet for octet/;
  const offenders = publicTextFiles()
    .filter((p) => p.endsWith(".md") && !/CHANGELOG/i.test(p) && !rel(p).startsWith("internet-drafts/"))
    .filter((p) => removed.test(readFileSync(p, "utf8")))
    .map(rel);
  assert.deepEqual(offenders, []);
});

test("the packages that use the libraries ask for the version in this repository", () => {
  const publisher = packageJson("publisher").version;
  const consumer = packageJson("consumer").version;
  for (const pkg of ["gateway", "tools/create-sustainability-data"]) {
    const deps = packageJson(pkg).dependencies ?? {};
    assert.equal(deps["sustainability-wellknown-publisher"], `^${publisher}`, `${pkg}: publisher dependency`);
    if (pkg === "gateway") assert.equal(deps["sustainability-wellknown-consumer"], `^${consumer}`, `${pkg}: consumer dependency`);
  }
  assert.equal(publisher, consumer, "the two libraries are released together");
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
  assert.ok(n >= 60, `only ${n} documents validated`);
});

test("every signed served example names Ed25519 or ES256, the media type in cty, and a minimal public jwk", () => {
  const dir = join(ROOT, "example-responses");
  let signed = 0;
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const doc = JSON.parse(readFileSync(join(dir, name), "utf8"));
    for (const object of Array.isArray(doc) ? doc : [doc]) {
      if (object.signed === undefined) continue;
      const header = JSON.parse(Buffer.from(object.signed.split(".")[0], "base64url").toString("utf8"));
      assert.ok(["Ed25519", "ES256"].includes(header.alg), `${name}: alg ${header.alg}`);
      assert.equal(header.cty, "sustainability-data+json", `${name}: cty`);
      const allowed = header.alg === "Ed25519" ? ["kty", "crv", "x"] : ["kty", "crv", "x", "y"];
      assert.deepEqual(Object.keys(header.jwk ?? {}).sort(), allowed.sort(), `${name}: the jwk carries only the public key`);
      signed += 1;
    }
  }
  assert.ok(signed >= 3, `only ${signed} signed objects found`);
});

const NAMED_IN_ROOT_README = [
  ["publisher", "the publisher"],
  ["consumer", "the consumer"],
  ["gateway", "the gateway"],
  ["tools/create-sustainability-data", "create-sustainability-data"],
  ["tools/report-to-declaration", "report-to-declaration"],
];

test("the root README names the version in each package.json", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  for (const [pkg, label] of NAMED_IN_ROOT_README) {
    const version = packageJson(pkg).version;
    assert.ok(readme.includes(`\`${version}\``), `README does not mention ${label} ${version}`);
  }
});

test("the root README states the number of served examples and the draft revision of the software", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const served = readdirSync(join(ROOT, "example-responses")).filter((f) => f.endsWith(".json")).length;
  assert.ok(new RegExp(`\\b${served} JSON response files`).test(readme), `README does not say "${served} JSON response files"`);
  assert.ok(/implements Internet-Draft version `-10`/.test(readme), "README does not say the software implements -10");
  assert.ok(!/implements Internet-Draft version `-0\d`/.test(readme), "README names an earlier draft as implemented");
});

test("the two npm packages stay small", () => {
  for (const pkg of ["publisher", "consumer"]) {
    const out = execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: join(ROOT, pkg), encoding: "utf8" });
    const [info] = JSON.parse(out);
    assert.ok(info.size < 1_000_000, `${pkg} tarball is ${info.size} bytes`);
    assert.ok(!info.files.some((f) => /private|\.pem$|\.env/.test(f.path)), `${pkg} would ship a secret-looking file`);
  }
});

const CLOCK_READ = /\bDate\.now\(\)|new Date\(\)/;
const CLOCK_DIRS = [
  ...["publisher", "consumer", "gateway"].map((pkg) => join(ROOT, pkg, "test")),
  ...["tools/create-sustainability-data", "tools/report-to-declaration"].map((pkg) => join(ROOT, pkg, "test")),
  join(ROOT, "bdd", "steps"),
  join(ROOT, "fitness"),
];

test("tests and steps inject their clocks: no bare Date.now() or new Date()", () => {
  const offenders = [];
  for (const dir of CLOCK_DIRS) {
    for (const p of walk(dir)) {
      if (!/\.(ts|mjs)$/.test(p) || p.endsWith("repository-invariants.test.mjs")) continue;
      readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\/?\*)/.test(line)) return; // a comment may mention the rule
        if (CLOCK_READ.test(line) && !/\/\/.*(fixed|injected|clock|allowed)/i.test(line)) offenders.push(`${rel(p)}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, [], `wall-clock reads in tests:\n${offenders.join("\n")}`);
});
