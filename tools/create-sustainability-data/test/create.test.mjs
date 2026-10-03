import assert from "node:assert/strict";
import { test } from "node:test";
import { declarationFrom, filesFor, isPeriod, parseArgs } from "../bin/create.mjs";

const answers = { target: "example.com", provider: "Example Ltd (https://example.com/contact)", "methodology-uri": "https://example.com/m", period: "2026-09", "energy-kwh": "12.5", "carbon-kgco2e": "3.06", "measurement-method": "third-party-modeled", "target-type": "origin", updated: "2026-10-01T00:00:00Z" };

test("seven answers make a conformant declaration", () => {
  const d = declarationFrom(answers);
  assert.equal(d.target, "example.com");
  assert.equal(d["energy-unit"], "kWh");
  assert.equal(d["carbon-footprint"], 3.06);
  assert.equal(d.updated, "2026-10-01T00:00:00Z");
  for (const k of ["updated", "capabilities", "provider", "measurement-method", "methodology-uri", "reporting-period", "target"]) assert.ok(k in d, k);
});

test("a file with no figure needs a disclosure link, and links must be https", () => {
  assert.throws(() => declarationFrom({ ...answers, "energy-kwh": "", "carbon-kgco2e": "" }), /figure or an evidence link/);
  assert.doesNotThrow(() => declarationFrom({ ...answers, "energy-kwh": "", "carbon-kgco2e": "", "disclosure-uri": "https://example.com/esg" }));
  assert.throws(() => declarationFrom({ ...answers, "methodology-uri": "http://example.com/m" }), /https/);
  assert.throws(() => declarationFrom({ ...answers, period: "2026-13" }), /period/);
  assert.throws(() => declarationFrom({ ...answers, "energy-kwh": "-1" }), /non-negative/);
  assert.throws(() => declarationFrom({ ...answers, period: "2026-02-30" }), /period/);
  assert.equal(isPeriod("2024-02-29"), true);
  assert.equal(isPeriod("2025-02-29"), false);
});

test("every host gets its configuration next to the file", () => {
  const d = declarationFrom(answers);
  assert.deepEqual(Object.keys(filesFor("netlify", d)), [".well-known/sustainability-data", "_headers"]);
  assert.deepEqual(Object.keys(filesFor("vercel", d)), [".well-known/sustainability-data", "vercel.json"]);
  assert.ok(filesFor("nginx", d)["sustainability-data.nginx.conf"].includes("application/sustainability-data+json"));
  assert.ok(filesFor("apache", d)[".htaccess"].includes("ForceType"));
  assert.ok(filesFor("caddy", d)["Caddyfile.snippet"].includes("file_server"));
  assert.deepEqual(Object.keys(filesFor("file", d)), [".well-known/sustainability-data"]);
  assert.throws(() => filesFor("ftp", d), /host must be/);
});

test("arguments parse as documented", () => {
  const a = parseArgs(["--target", "x.example", "--host", "netlify", "--yes"]);
  assert.equal(a.target, "x.example");
  assert.equal(a.host, "netlify");
  assert.equal(a.yes, true);
  assert.throws(() => parseArgs(["--target"]), /needs a value/);
  assert.throws(() => parseArgs(["--taget", "x"]), /unknown option --taget/);
  assert.throws(() => declarationFrom({ ...answers, updated: "yesterday" }), /updated must be a date/);
});

test("the bin runs when invoked through a symlink, as npx and node_modules/.bin do", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, symlinkSync, existsSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const bin = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "create.mjs");
  const dir = mkdtempSync(join(tmpdir(), "csd-"));
  const link = join(dir, "create-sustainability-data");
  symlinkSync(bin, link);
  assert.match(execFileSync(process.execPath, [link, "--help"], { encoding: "utf8" }), /^usage:/);
  const out = join(dir, "site");
  execFileSync(process.execPath, [link, "--target", "x.example", "--provider", "X (https://x.example/c)", "--methodology-uri", "https://x.example/m",
    "--period", "2026-09", "--energy-kwh", "1", "--host", "netlify", "--out", out, "--yes"], { encoding: "utf8" });
  assert.ok(existsSync(join(out, ".well-known", "sustainability-data")));
  assert.ok(readFileSync(join(out, "_headers"), "utf8").includes("application/sustainability-data+json"));
});
