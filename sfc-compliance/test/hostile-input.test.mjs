/**
 * Hostile reads and documents: an excerpt of another version or of a broken shape, the limits that stop the deep
 * check, the nesting cap and the clock tests in the loops. Deterministic: fixed clocks, no network.
 */
import { describe, expect, it } from "vitest";
import { runChecks } from "../lib/check.mjs";
import { parseText, prepareInput } from "../lib/input.mjs";
import { readIJson } from "../lib/ijson.mjs";
import { MAX_JSON_DEPTH, scanLimits, stopsDeepCheck, withLimits } from "../lib/limits.mjs";
import { buildContext } from "../lib/ledger.mjs";
import { d2 } from "../lib/deep-registry.mjs";
import { vectorFiles, inputOf, readJson } from "./helpers.mjs";
import { World } from "../vectors/build/world.mjs";
import { KEY1, KEY2, jwkOf } from "../vectors/build/keys.mjs";
import { PARAMS, PINS } from "../vectors/cases/base.mjs";

const NOW = "2026-05-01T01:00:00Z";
const READ_AT = "2026-05-01T00:00:00Z";
const nested = (n) => `${"[".repeat(n)}${"]".repeat(n)}`;
const d1Rows = (report) => report.rows.filter((r) => r.id === "D1");
const errorRows = (report) => report.rows.filter((r) => r.id === "ERROR");

describe("an excerpt of a version other than 2 is never walked", () => {
  const WELL_FORMED = { network: "ledger.example", "read-at": READ_AT };
  const hostile = [
    ["registry is a number", { registry: 5 }],
    ["ledger is a number", { ledger: 7 }],
    ["registry holds null", { registry: [null] }],
    ["ledger holds null", { ledger: [null] }],
    ["read-at and network have the wrong types", { "read-at": 5, network: 7 }],
    ["voids is a string", { voids: "x" }],
    ["checkpoint is a number", { checkpoint: 3 }],
  ];

  for (const version of [1, 3]) {
    for (const [name, members] of hostile) {
      it(`version ${version}, ${name}: no throw, D1 says "excerpt version ${version}"`, async () => {
        const report = await runChecks({ excerpt: { "excerpt-version": version, ...WELL_FORMED, ...members }, now: NOW });
        expect(errorRows(report)).toEqual([]);
        expect(d1Rows(report)).toEqual([expect.objectContaining({ result: "NOT-EVALUABLE", detail: `excerpt version ${version}` })]);
      });
    }
  }

  it("keeps only the version and the well-formed network and read-at", () => {
    const { excerpt } = prepareInput({ excerpt: { "excerpt-version": 3, network: "a.example", "read-at": "yesterday", registry: 5, ledger: [null] } });
    expect(excerpt).toEqual({ "excerpt-version": 3, network: "a.example", registry: [], voids: [], ledger: [] });
  });

  it("a missing or odd version is named without printing the value", async () => {
    for (const [version, text] of [[undefined, "absent"], [{ a: 1 }, "of type object"], ["x".repeat(50), "of type string"]]) {
      const report = await runChecks({ excerpt: { "excerpt-version": version, ...WELL_FORMED }, now: NOW });
      expect(d1Rows(report)[0].detail).toBe(`excerpt version ${text}`);
    }
  });

  it("a version 2 excerpt of a broken shape is a malformed read, not a crash", async () => {
    for (const [, members] of hostile) {
      const prepared = prepareInput({ excerpt: { "excerpt-version": 2, ...WELL_FORMED, ...members } });
      expect(prepared.excerpt).toBeUndefined();
      expect(prepared.excerptError).toEqual({ malformed: expect.any(String) });
    }
  });

  it("a version 2 excerpt without `registry` or `ledger` (5.8 requires both) is a malformed read: D1 says so and no stage stops", async () => {
    const checkpoint = { network: "ledger.example", "read-at": READ_AT, chains: [], "ledger-digest": "0".repeat(64), sig: { alg: "Ed25519", value: "A".repeat(86) } };
    const cases = [
      ["registry absent", { ledger: [] }, "registry is not an array of objects"],
      ["ledger absent with a ledger-digest", { registry: [], checkpoint }, "ledger is not an array of entries"],
    ];
    const declarations = [readJson("examples", "sfc-network.example.json")[0]]; // D1 is reported per object with ledger evidence
    for (const [name, members, problem] of cases) {
      const report = await runChecks({ declarations, excerpt: { "excerpt-version": 2, ...WELL_FORMED, ...members }, now: NOW });
      expect({ name, errors: errorRows(report) }).toEqual({ name, errors: [] });
      expect(d1Rows(report)).toEqual([expect.objectContaining({ result: "NOT-EVALUABLE", detail: `read is not a well-formed excerpt: ${problem}` })]);
    }
  });
});

describe("the limits that stop the deep check", () => {
  const file = vectorFiles().find((f) => f.name === "v17-limits");
  const scenario = file.inputs.scenarios.find((s) => s.name === "number-literal-of-500-digits-in-the-read");

  it("names the limits on the size or count of the read, and no other", () => {
    for (const limit of ["bytes per read", "events per chain", "entries in voids", "entries in the Registry"]) expect(stopsDeepCheck([{ limit }])).toBe(true);
    for (const limit of ["bytes per event", "JSON nesting depth", "items in one array", "operators in a read"]) expect(stopsDeepCheck([{ limit }])).toBe(false);
  });

  it("the scan reads an array of 300 000 items without overflowing the argument stack", () => {
    const read = { "excerpt-version": 2, ledger: [], registry: [], voids: [], "x-list": new Array(300000).fill(0) };
    expect(scanLimits(read, withLimits(), null, {})).toContainEqual({ limit: "items in one array", event: null });
  });

  it("a read text over the byte limit is refused before it is parsed", async () => {
    const report = await runChecks({ ...inputOf(scenario, file), excerptText: "x".repeat(200), limits: { readBytes: 100 } });
    expect(prepareInput({ excerptText: "x".repeat(200), limits: { readBytes: 100 } }).excerptError).toEqual({ limit: "bytes per read" });
    expect(d1Rows(report)).toEqual([expect.objectContaining({ result: "NOT-EVALUABLE", detail: "limit: bytes per read" })]);
  });
});

describe("the nesting cap of the reader", () => {
  it("reads a document at the cap and stops one level below it, with the limit named", () => {
    expect(() => readIJson(nested(MAX_JSON_DEPTH))).not.toThrow();
    expect(() => readIJson(nested(MAX_JSON_DEPTH + 1))).toThrow(expect.objectContaining({ limit: "JSON nesting depth" }));
  });

  it("20 000 levels give the limit, the same on every engine, not a stack error", () => {
    expect(parseText(nested(20000))).toEqual({ limit: "JSON nesting depth" });
  });

  it("33 to 64 levels are read, so that the scan of section 10 names the limit", () => {
    expect(parseText(nested(33)).value).toBeDefined();
  });

  it("a declaration nested too deep is NOT-EVALUABLE under S2", async () => {
    const report = await runChecks({ declarationText: nested(20000) });
    expect(report.rows).toContainEqual({ id: "S2", result: "NOT-EVALUABLE", detail: "limit: JSON nesting depth" });
  });
});

describe("the clock is tested in the loops of the deep check", () => {
  const file = vectorFiles().find((f) => f.name === "v28-citation-void");
  const scenario = file.inputs.scenarios.find((s) => s.name === "void-acts");

  it("D2 reads the clock at least once per event and once per Registry entry, so its interval scan cannot outrun the limit", () => {
    const year = vectorFiles().find((f) => f.name === "v05-sums-year");
    const input = inputOf(year.inputs.scenarios.find((s) => s.name === "year-2025"), year);
    const ctx = buildContext({ ...input, limits: withLimits() });
    let readings = 0;
    ctx.checkDeadline = () => { readings++; };
    d2(ctx, null, null, undefined, "read");
    expect(ctx.events.length).toBeGreaterThan(30);
    expect(readings).toBeGreaterThanOrEqual(ctx.events.length + ctx.registry.length);
  });

  async function readingsFor(copies) {
    let readings = 0;
    const input = JSON.parse(JSON.stringify(inputOf(scenario, file)));
    input.excerpt.ledger = Array.from({ length: copies }, () => input.excerpt.ledger).flat();
    await runChecks({ ...input, clock: () => { readings++; return 0; } });
    return { readings, events: input.excerpt.ledger.length };
  }

  it("takes at least five readings for each further event", async () => {
    const small = await readingsFor(1);
    const big = await readingsFor(3);
    expect(big.readings - small.readings).toBeGreaterThanOrEqual(5 * (big.events - small.events));
  });
});

describe("a Registry entry with many keys is bounded by the time limit", () => {
  const FROM = "2025-11-01T00:00:00Z";
  const DEC = "2025-12-01T00:00:00Z";

  /** One operator whose entry lists `count` keys; the key that signed its event comes last, so every event tries all the others first. */
  function manyKeysRead(count) {
    const w = new World({ readAt: "2026-05-02T00:10:00Z" });
    const wrong = { jwk: jwkOf(KEY2), validFromCommit: "2024-01-01T00:00:00Z", validToCommit: null };
    const right = { jwk: jwkOf(KEY1), validFromCommit: "2024-01-01T00:00:00Z", validToCommit: null };
    const op = w.operator("a", { from: FROM, keys: [...Array.from({ length: count - 1 }, () => wrong), right] });
    w.energy(op, DEC, { kWh: 1000 });
    return w.excerpt();
  }
  const readingsFor = async (count) => {
    let readings = 0;
    await runChecks({ excerpt: manyKeysRead(count), parameters: PARAMS, pins: PINS, T: "2026-05-02T00:10:00Z", clock: () => { readings++; return 0; } });
    return readings;
  };

  it("reads the clock at least once per extra key, so one event cannot outrun the limit", async () => {
    const few = await readingsFor(5);
    const many = await readingsFor(105);
    expect(many - few).toBeGreaterThanOrEqual(2 * 100);
  });

  it("stops with the limit named once the time is used up, not after every key", async () => {
    let calls = 0;
    const report = await runChecks({ excerpt: manyKeysRead(400), parameters: PARAMS, pins: PINS, T: "2026-05-02T00:10:00Z", clock: () => 1000 * calls++, limits: { secondsPerCheck: 50 } });
    expect(calls).toBeLessThan(200);
    expect(report.rows.filter((r) => r.result === "NOT-EVALUABLE" && String(r.detail).includes("seconds per check")).length).toBeGreaterThan(0);
  });
});
