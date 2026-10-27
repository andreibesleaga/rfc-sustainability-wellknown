/**
 * Hostile-input limits of the checker: the single-use index of L9 against a plain reference, a step budget for
 * 8 000 events, the per-check deadline under a fake clock, number literals, names that are also names on
 * Object.prototype, terminal escaping, and years below 100. Deterministic: seeded, no wall clock, no network.
 */
import { describe, expect, it, vi } from "vitest";
import { dec, fromNumber, add, cmp, mulInt, ZERO } from "../lib/decimal.mjs";
import { newIndex, prepare, indexAdd, indexRemove, tonneReused } from "../lib/tonne-index.mjs";
import { instantKey } from "../lib/rules.mjs";
import { serialRange, registrarKeys } from "../lib/parameters.mjs";
import { readIJson } from "../lib/ijson.mjs";
import { parseText } from "../lib/input.mjs";
import { withLimits } from "../lib/limits.mjs";
import { shiftOf, ENERGY_SHIFT, CARBON_SHIFT } from "../lib/derive.mjs";
import { escapeText } from "../lib/report.mjs";
import { parseInstant, fmt, epoch, monthBound, addMonths, monthsBetween, cmpInstant } from "../lib/time.mjs";
import { runChecks } from "../lib/check.mjs";
import { vectorFiles, inputOf } from "./helpers.mjs";

// ---- L9 -------------------------------------------------------------------------------------

const REGISTRIES = { plain: "https://plain.example", serials: "https://serials.example" };
const reader = { decOf: fromNumber, instantKey, ranged: (registry) => registry === REGISTRIES.serials };

/** The rule as first written: every citation of the effective set scanned for every citation asked about. */
function reusedByScan(all, x) {
  const same = all.filter((y) => y.registry === x.registry && y.reference === x.reference);
  if (same.some((y) => y.tonnesRetired !== x.tonnesRetired || instantKey(y.retiredAt) !== instantKey(x.retiredAt))) return true;
  if (cmp(same.reduce((a, y) => add(a, fromNumber(y.kg)), ZERO), mulInt(dec(x.tonnesRetired), 1000)) > 0) return true;
  if (x.registry !== REGISTRIES.serials) return false;
  const rx = serialRange(x.reference);
  return all.some((y) => {
    if (y.registry !== x.registry || y.reference === x.reference) return false;
    const ry = serialRange(y.reference);
    return rx[0] <= ry[1] && ry[0] <= rx[1];
  });
}

/** A seeded generator (mulberry32), so the run is the same every time. */
function seeded(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomCitation(rand) {
  const pick = (n) => Math.floor(rand() * n);
  const serials = rand() < 0.5;
  const first = pick(40) + 1;
  const reference = serials ? (rand() < 0.3 ? String(first) : `${first}-${first + pick(6) + 1}`) : `REF-${pick(4)}`;
  return {
    registry: serials ? REGISTRIES.serials : REGISTRIES.plain, reference, kg: [250, 500, 1000, 1500][pick(4)],
    tonnesRetired: rand() < 0.9 ? 2 : 3, retiredAt: rand() < 0.9 ? "2026-02-01T00:00:00Z" : "2026-02-01T00:00:00.5Z",
  };
}

describe("L9 over the index", () => {
  it("gives the answer of the plain scan for 4 000 random events: replacing, voiding, own entry left out", () => {
    const rand = seeded(20261026);
    const index = newIndex();
    const effective = new Map();
    let refused = 0;
    for (let step = 0; step < 4000; step++) {
      const owner = `owner-${Math.floor(rand() * 8)}`;
      if (rand() < 0.1) { indexRemove(index, owner); effective.delete(owner); continue; }
      const mine = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => randomCitation(rand));
      const others = [...effective].filter(([k]) => k !== owner).flatMap(([, v]) => v);
      const all = [...others, ...mine];
      const expected = mine.some((x) => reusedByScan(all, x));
      expect(tonneReused(index, owner, mine.map((c) => prepare(c, reader)))).toBe(expected);
      if (expected) { refused++; continue; }
      indexRemove(index, owner);
      indexAdd(index, owner, mine.map((c) => prepare(c, reader)));
      effective.set(owner, mine);
    }
    expect(refused).toBeGreaterThan(200);
    expect(effective.size).toBeGreaterThan(2);
  });

  it("keeps two (registry, reference) pairs apart when joined they would read the same", () => {
    const index = newIndex();
    const cite = (registry, reference) => prepare({ registry, reference, kg: 600, tonnesRetired: 1, retiredAt: "2026-02-01T00:00:00Z" }, reader);
    indexAdd(index, "owner-a", [cite("https://x.example|r", "1")]);
    expect(tonneReused(index, "owner-b", [cite("https://x.example", "r|1")])).toBe(false);
    expect(tonneReused(index, "owner-b", [cite("https://x.example|r", "1")])).toBe(true);
  });

  it("answers 8 000 events in a bounded number of steps (no timing: decimal operations and range reads are counted)", () => {
    const counts = { decimal: 0, rangeReads: 0 };
    const count = { ...reader, decOf: (x) => { counts.decimal++; return fromNumber(x); } };
    const index = newIndex();
    const ranges = [];
    index.ranges.set(REGISTRIES.serials, new Proxy(ranges, { get: (t, k) => { if (typeof k === "string" && /^\d+$/.test(k)) counts.rangeReads++; return t[k]; } }));
    const one = (n, registry, reference) => [prepare({ registry, reference, kg: 1, tonnesRetired: 1000000, retiredAt: "2026-02-01T00:00:00Z" }, count)];
    for (let n = 0; n < 8000; n++) {
      // every event cites the same plain reference (one running total) and one range of its own (a sorted list of 8 000)
      const mine = [...one(n, REGISTRIES.plain, "HOT"), ...one(n, REGISTRIES.serials, `${n * 10 + 1}-${n * 10 + 5}`)];
      expect(tonneReused(index, `owner-${n}`, mine)).toBe(false);
      indexAdd(index, `owner-${n}`, mine);
    }
    expect(ranges).toHaveLength(8000);
    expect(counts.decimal).toBe(16000);                 // one read of kg per citation, nothing per pair of citations
    expect(counts.rangeReads).toBeLessThan(8000 * 60);  // a binary search and a short walk per event; a scan would read 32 000 000
  });
});

// ---- the deadline ---------------------------------------------------------------------------

describe("the per-check deadline (section 10: 600 s)", () => {
  const file = vectorFiles().find((f) => f.name === "v28-citation-void");
  const scenario = file.inputs.scenarios.find((s) => s.name === "void-acts");

  it("a clock that jumps past 600 s makes the stage NOT-EVALUABLE with the limit named, not an error", async () => {
    let t = 0;
    const clock = () => (t += 400000);                  // milliseconds: the second reading is 800 s after the first
    const report = await runChecks({ ...inputOf(scenario, file), clock });
    expect(report.rows).toContainEqual({ id: "D1", result: "NOT-EVALUABLE", detail: "limit: seconds per check" });
    expect(report.rows.some((r) => r.id === "ERROR")).toBe(false);
    expect(report.summary["NOT-EVALUABLE"]).toBeGreaterThan(0);
  });

  it("a clock that stands still never trips it", async () => {
    const report = await runChecks({ ...inputOf(scenario, file), clock: () => 0 });
    expect(report.rows.some((r) => r.detail === "limit: seconds per check")).toBe(false);
  });
});

// ---- numbers --------------------------------------------------------------------------------

describe("number literals", () => {
  it("1e999 has no binary64 value: a syntax error that carries the literal length", () => {
    expect(() => readIJson('{"a":1e999}')).toThrow(/number out of I-JSON range/);
    try { readIJson('[1e999]'); } catch (e) { expect(e.literalLength).toBe(5); }
  });

  it("a literal over the literal limit is a limit, never a syntax error; under it, a syntax error", () => {
    const limits = withLimits();
    expect(parseText(`[1${"0".repeat(499)}]`, limits)).toEqual({ limit: "characters in a number literal" });
    expect(parseText("[1e999]", limits).error).toMatch(/out of I-JSON range/);
  });

  it("a long literal is read whole, not cut at 400 characters", () => {
    const literal = `0.${"0".repeat(500)}1`;
    const { value, issues } = readIJson(`[${literal}]`);
    expect(value).toEqual([Number(literal)]);
    expect(issues.maxLiteral).toBe(literal.length);
  });
});

// ---- names that are also names on Object.prototype ------------------------------------------

describe("untrusted names used as table keys", () => {
  it("a unit named like an Object.prototype member is an unknown unit", () => {
    for (const unit of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(shiftOf(ENERGY_SHIFT, unit)).toBeUndefined();
      expect(shiftOf(CARBON_SHIFT, unit)).toBeUndefined();
    }
    expect(shiftOf(ENERGY_SHIFT, "MWh")).toBe(3);
    expect(shiftOf(CARBON_SHIFT, "kgCO2e")).toBe(0);
    expect(shiftOf(ENERGY_SHIFT, undefined)).toBeUndefined();
  });

  it("a read of a network named constructor finds no registrar key pinned for another host", () => {
    const ctx = { network: "constructor", pins: { registrar: { "ledger.example": ["AAAA"] } }, params: {} };
    expect(registrarKeys(ctx)).toEqual([]);
    expect(registrarKeys({ ...ctx, network: "ledger.example" })).toEqual([{ x: "AAAA", status: "current" }]);
  });
});

// ---- terminal escaping, years below 100 -----------------------------------------------------

describe("terminal escaping", () => {
  // the characters are built from code points: no invisible character is written in this file
  const chars = (...codes) => codes.map((c) => String.fromCharCode(c)).join("");
  const escaped = (...codes) => codes.map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("");

  it("escapes bidi and invisible format characters in a target, provider or reference", () => {
    expect(escapeText(`evil${chars(0x202e)}gnp.txt`)).toBe(`evil${escaped(0x202e)}gnp.txt`);
    expect(escapeText(`a${chars(0x200b)}b`)).toBe(`a${escaped(0x200b)}b`);
    for (const code of [0x061c, 0x200b, 0x200f, 0x2028, 0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0xfeff, 0x0007, 0x009f]) {
      expect(escapeText(chars(code))).toBe(escaped(code));
    }
  });

  it("leaves ordinary text, accented letters and CJK alone; the edges of the ranges are exact", () => {
    expect(escapeText("plain text, ordinary caf" + chars(0xe9) + " and " + chars(0x65e5, 0x672c))).toBe("plain text, ordinary caf" + chars(0xe9) + " and " + chars(0x65e5, 0x672c));
    for (const code of [0x00a0, 0x2010, 0x205f, 0x206a, 0xfe0f, 0xfffd]) expect(escapeText(chars(code))).toBe(chars(code));
  });
});

describe("years below 100", () => {
  it("are read as those years, not as 1900 to 1999", () => {
    for (const t of ["0001-01-01T00:00:00Z", "0050-06-15T12:30:45Z", "0099-12-31T23:59:59Z", "0100-01-01T00:00:00Z"]) expect(fmt(epoch(t))).toBe(t);
    expect(cmpInstant("0099-12-31T23:59:59Z", "0100-01-01T00:00:00Z")).toBe(-1);
    expect(parseInstant("0050-02-29T00:00:00Z")).toBeNull();
    expect(monthBound(99, 12)).toBe("0099-12-01T00:00:00Z");
    expect(addMonths("0099-12-01T00:00:00Z", 1)).toBe("0100-01-01T00:00:00Z");
    expect(monthsBetween("0098-01-01T00:00:00Z", "0100-01-01T00:00:00Z")).toHaveLength(24);
  });
});
