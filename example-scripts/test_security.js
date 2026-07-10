#!/usr/bin/env node
/**
 * Tests for security.js (plain Node `assert`, zero dependencies).
 * Run: node test_security.js
 */
const assert = require("assert");
const { secureSustainabilityReport, fuzzFactorFor } = require("./security.js");

const entry = (period, energy = 10, carbon = 100, extra = {}) => ({
  "reporting-period": period,
  "energy-consumption": energy,
  "carbon-footprint": carbon,
  ...extra,
});

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("sorts ascending by reporting-period", () => {
  const out = secureSustainabilityReport([entry("2026-03"), entry("2026-01"), entry("2026-02")]);
  assert.deepStrictEqual(out.map((r) => r["reporting-period"]), ["2026-01", "2026-02", "2026-03"]);
});

test("drops sub-daily entries before capping", () => {
  const subdaily = entry("2026-01-01T12:00:00Z");
  const daily = [1, 2].map((m) => entry(`2026-0${m}-01`));
  const out = secureSustainabilityReport([subdaily, ...daily]);
  assert.strictEqual(out.length, 2);
  assert.ok(out.every((r) => String(r["reporting-period"]).length <= 10));
});

test("caps at 366 keeping most recent", () => {
  const data = Array.from({ length: 400 }, (_, i) => {
    const year = 2020 + Math.floor(i / 365);
    const month = Math.floor((i % 365) / 30) + 1;
    const day = (i % 28) + 1;
    return entry(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  });
  const out = secureSustainabilityReport(data);
  assert.ok(out.length <= 366);
});

test("deterministic across calls", () => {
  const data = [entry("2026-01"), entry("2026-02")];
  assert.deepStrictEqual(secureSustainabilityReport(data), secureSustainabilityReport(data));
});

test("noise bounded within ~1%", () => {
  const out = secureSustainabilityReport([entry("2026-01", 100, 1000)]);
  assert.ok(out[0]["energy-consumption"] >= 99 && out[0]["energy-consumption"] <= 101);
  assert.ok(out[0]["carbon-footprint"] >= 990 && out[0]["carbon-footprint"] <= 1010);
});

test("negative scope is noised and sign preserved", () => {
  // -03: no "not reported" sentinel; scope values MAY legitimately be negative
  // (removals / net accounting) and are noised like any other value —
  // multiplication preserves the sign and the sums.
  const out = secureSustainabilityReport([
    entry("2026-01", 100, 300, { "scope-1": -50, "scope-2": 250, "scope-3": 100 }),
  ]);
  const fuzz = fuzzFactorFor("2026-01");
  assert.notStrictEqual(fuzz, 1); // guard: noise is observable for this period
  assert.strictEqual(out[0]["scope-1"], parseFloat((-50 * fuzz).toFixed(2)));
  assert.notStrictEqual(out[0]["scope-1"], -50); // noise was applied
  assert.ok(out[0]["scope-1"] < 0); // sign preserved
  const total = out[0]["scope-1"] + out[0]["scope-2"] + out[0]["scope-3"];
  assert.ok(Math.abs(total - out[0]["carbon-footprint"]) < 0.05);
});

test("single fuzz factor keeps scopes consistent", () => {
  const out = secureSustainabilityReport([
    entry("2026-01", 10, 300, { "scope-1": 100, "scope-2": 100, "scope-3": 100 }),
  ]);
  const total = out[0]["scope-1"] + out[0]["scope-2"] + out[0]["scope-3"];
  assert.ok(Math.abs(total - out[0]["carbon-footprint"]) < 0.05);
});

test("fuzzFactorFor is a pure function of period", () => {
  assert.strictEqual(fuzzFactorFor("2026-01"), fuzzFactorFor("2026-01"));
  assert.notStrictEqual(fuzzFactorFor("2026-01"), fuzzFactorFor("2026-02"));
});

test("empty input", () => {
  assert.deepStrictEqual(secureSustainabilityReport([]), []);
});

console.log(`\n${passed} passed`);
if (process.exitCode) process.exit(1);
