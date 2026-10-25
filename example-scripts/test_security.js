#!/usr/bin/env node
/**
 * Tests for security.js (plain Node `assert`, zero dependencies).
 * Run: node test_security.js
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  secureSustainabilityReport,
  fuzzFactorFor,
  canonicalKey,
  isOnDayBoundaries,
  honoredQuery,
  answerQuery,
} = require("./security.js");

const ROOT = path.join(__dirname, "..");
const SERVED = path.join(ROOT, "example-responses");
// A dataset of queries.json is the served file of that name; `basic` is example-response.json.
function servedObjects(dataset) {
  const name = dataset.replace(".example", "");
  const candidates = ["example-response.json", `example-response-${name}.json`, `example-response_${name}.json`];
  const file = name === "basic" ? candidates[0] : candidates.slice(1).find((c) => fs.existsSync(path.join(SERVED, c)));
  const body = JSON.parse(fs.readFileSync(path.join(SERVED, file), "utf8"));
  return Array.isArray(body) ? body : [body];
}

const day = (date, next, target = "example.com", extra = {}) => ({
  period: { start: `${date}T00:00:00Z`, end: `${next}T00:00:00Z` },
  target,
  "energy-consumption": 100,
  "carbon-footprint": 300,
  ...extra,
});
const starts = (objects) => objects.map((o) => o.period.start);
const NOISY = { applyNoise: true, noiseDisclosed: true };

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

test("sorts by the instant of period.start, whatever the offsets", () => {
  const plusFive = { ...day("2026-03-01", "2026-03-02"), period: { start: "2026-03-01T00:00:00+05:00", end: "2026-03-02T00:00:00+05:00" } };
  const out = secureSustainabilityReport([day("2026-03-01", "2026-03-02"), plusFive, day("2026-02-01", "2026-02-02")]);
  assert.deepStrictEqual(starts(out), ["2026-02-01T00:00:00Z", "2026-03-01T00:00:00+05:00", "2026-03-01T00:00:00Z"]);
});

test("ties on start go by end, then by target", () => {
  const out = secureSustainabilityReport([
    day("2026-01-01", "2026-02-01", "/b"),
    day("2026-01-01", "2026-01-02", "/z"),
    day("2026-01-01", "2026-02-01", "/a"),
  ]);
  assert.deepStrictEqual(out.map((o) => `${o.target}|${o.period.end}`), [
    "/z|2026-01-02T00:00:00Z",
    "/a|2026-02-01T00:00:00Z",
    "/b|2026-02-01T00:00:00Z",
  ]);
});

test("day floor drops by default, with a warning", () => {
  const warnings = [];
  const sixHours = { ...day("2026-01-01", "2026-01-02"), period: { start: "2026-01-01T00:00:00Z", end: "2026-01-01T06:00:00Z" } };
  const out = secureSustainabilityReport([sixHours, day("2026-01-02", "2026-01-03")], { onWarning: (m) => warnings.push(m) });
  assert.deepStrictEqual(starts(out), ["2026-01-02T00:00:00Z"]);
  assert.strictEqual(warnings.length, 1);
});

test("day floor warn keeps and off keeps silently", () => {
  const sixHours = { ...day("2026-01-01", "2026-01-02"), period: { start: "2026-01-01T00:00:00Z", end: "2026-01-01T06:00:00Z" } };
  const warnings = [];
  assert.strictEqual(secureSustainabilityReport([sixHours], { dayFloor: "warn", onWarning: (m) => warnings.push(m) }).length, 1);
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(secureSustainabilityReport([sixHours], { dayFloor: "off", onWarning: (m) => warnings.push(m) }).length, 1);
  assert.strictEqual(warnings.length, 1);
});

test("a 23-hour day of a daylight-saving change is a calendar day", () => {
  assert.ok(isOnDayBoundaries({ start: "2026-03-29T00:00:00+01:00", end: "2026-03-30T00:00:00+02:00" }));
  assert.ok(!isOnDayBoundaries({ start: "2026-03-29T01:00:00+01:00", end: "2026-03-30T01:00:00+02:00" }));
});

test("refuses more than 366 held objects, counted after the day floor", () => {
  const sixHours = { ...day("2030-01-01", "2030-01-02"), period: { start: "2030-01-01T00:00:00Z", end: "2030-01-01T06:00:00Z" } };
  const data = Array.from({ length: 400 }, (_, i) => {
    const start = new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10);
    return day(start, end);
  });
  assert.throws(() => secureSustainabilityReport([sixHours, ...data]), /maxObjects/);
  assert.strictEqual(secureSustainabilityReport([sixHours, ...data.slice(0, 366)]).length, 366);
});

test("values are exact unless noise is turned on", () => {
  const out = secureSustainabilityReport([day("2026-01-01", "2026-01-02")]);
  assert.strictEqual(out[0]["energy-consumption"], 100);
});

test("noise needs the operator's confirmation that it is disclosed", () => {
  assert.throws(() => secureSustainabilityReport([], { applyNoise: true }), /noiseDisclosed/);
});

test("one factor within 1% moves every perturbed member, ratios and percentages stay", () => {
  const object = day("2026-01-01", "2026-02-01", "example.com", {
    "scope-1": -50,
    "scope-2": 250,
    "scope-3": 100,
    "estimated-annual-emissions-kgCO2e": 3650,
    "sci-score": 2,
    "carbon-intensity-gCO2e-per-kWh": 270,
    "renewable-energy": 100,
  });
  const [out] = secureSustainabilityReport([object], NOISY);
  const fuzz = fuzzFactorFor(canonicalKey(object.period));
  assert.ok(fuzz >= 0.99 && fuzz <= 1.01);
  for (const member of ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3", "estimated-annual-emissions-kgCO2e", "sci-score"]) {
    assert.strictEqual(out[member], Number((object[member] * fuzz).toPrecision(6)), member);
  }
  assert.ok(out["scope-1"] < 0);
  assert.strictEqual(out["carbon-intensity-gCO2e-per-kWh"], 270);
  assert.strictEqual(out["renewable-energy"], 100);
});

test("the factor depends on the instants of the period, not on its spelling", () => {
  const key = "2026-01-01T00:00:00Z/2026-02-01T00:00:00Z";
  assert.strictEqual(canonicalKey({ start: "2026-01-01T00:00:00Z", end: "2026-02-01T00:00:00Z" }), key);
  assert.strictEqual(canonicalKey({ start: "2026-01-01T00:00:00.000Z", end: "2026-02-01T00:00:00Z" }), key);
  assert.strictEqual(canonicalKey({ start: "2026-01-01T01:00:00+01:00", end: "2026-02-01T01:00:00+01:00" }), key);
  assert.strictEqual(fuzzFactorFor(key), 1.00418); // the same value in the Python and PHP kits
});

test("a bound that is not a date-time of the draft is an error", () => {
  for (const bad of ["2026-01-01", "2026-01-01t00:00:00z", "2026-02-30T00:00:00Z", "2026-01-01T24:00:00Z"]) {
    assert.throws(() => canonicalKey({ start: bad, end: "2026-02-01T00:00:00Z" }), RangeError, bad);
  }
});

test("query values that do not match the draft are ignored, never an error", () => {
  assert.deepStrictEqual(honoredQuery("start=2025-03-01&end=2025-04-01t00:00:00z&granularity=Monthly&target="), {});
  assert.deepStrictEqual(honoredQuery("start=2025-03-01T00:00:00%2B01:00&end=2025-02-30T00:00:00Z"), {});
  assert.deepStrictEqual(honoredQuery("start=2016-12-31T23:59:60Z"), {}); // second 60 would be read as 59
  assert.deepStrictEqual(honoredQuery("granularity=monthly&granularity=daily&period=2025"), {}); // repeated, and the name of the previous revision
  assert.deepStrictEqual(honoredQuery("start=2025-03-01T00%3A00%3A00Z&target=%E0%A4%A"), { start: "2025-03-01T00:00:00Z" });
});

test("every row of queries.json selects what the oracle says, in its order", () => {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, "schemas-validators", "examples", "queries.json"), "utf8"));
  assert.strictEqual(rows.length, 75);
  for (const row of rows) {
    const got = answerQuery(servedObjects(row.dataset), row.query).map((o) => `${o.target}|${o.period.start}`);
    assert.deepStrictEqual(got, row.expect, `${row.id} ${row.query}`);
  }
});

test("empty input", () => {
  assert.deepStrictEqual(secureSustainabilityReport([]), []);
});

console.log(`\n${passed} passed`);
if (process.exitCode) process.exit(1);
