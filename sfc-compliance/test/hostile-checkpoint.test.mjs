/**
 * A hostile read must not turn a FAIL into a bare error or an exit status of 0: a checkpoint whose members have the
 * wrong types is a FAIL of its own, the other checks keep their rows, and a stage that does stop gives a fixed ERROR
 * row (no exception text) and a non-zero exit status. Fixed clock, no network.
 */
import { describe, expect, it } from "vitest";
import { runChecks } from "../lib/check.mjs";
import { exitCodeOf, overallVerdict } from "../lib/report.mjs";
import { stageRows } from "../lib/deep.mjs";
import { World, signObject, makeCheckpoint } from "../vectors/build/world.mjs";
import { T0, PARAMS, PINS } from "../vectors/cases/base.mjs";

const MARKER = "attacker-chosen-text";
const FROM = "2025-11-01T00:00:00Z";
const DEC = "2025-12-01T00:00:00Z";

/** A read with a pinned registrar key, one event altered after signing (D3 FAIL) and a registrar-signed checkpoint edited by `edit`. */
function readWith(edit) {
  const w = new World({ readAt: T0 });
  const [a, b] = ["a", "b"].map((n) => w.operator(n, { from: FROM }));
  const altered = w.energy(a, DEC, { kWh: 1000 });
  w.energy(b, DEC, { kWh: 1100 });
  w.tamper(altered, (e) => { e.payload.kWhConsumed = 99999; });
  return w.excerpt({ checkpoint: (ex) => { const { sig, ...rest } = makeCheckpoint(ex); return signObject(edit(rest), undefined); } });
}
const run = (excerpt) => runChecks({ excerpt, parameters: PARAMS, pins: PINS, T: T0 });
const resultsOf = (report, id) => report.rows.filter((r) => r.id === id).map((r) => r.result);

describe("a checkpoint with members of the wrong type", () => {
  const MUTATIONS = [
    ["chains is a number", (cp) => ({ ...cp, chains: 5 })],
    ["chains is an empty object", (cp) => ({ ...cp, chains: {} })],
    ["chains is true", (cp) => ({ ...cp, chains: true })],
    ["chains holds null", (cp) => ({ ...cp, chains: [null] })],
    ["a chain has no count", (cp) => ({ ...cp, chains: [{ operator: "x", type: "EnergyAttested", tip: null }] })],
    ["read-at is null", (cp) => ({ ...cp, "read-at": null })],
    ["a digest is a number", (cp) => ({ ...cp, "registry-digest": 7 })],
  ];

  it("keeps the baseline FAIL: the altered event, with the checkpoint intact", async () => {
    const report = await run(readWith((cp) => cp));
    expect(resultsOf(report, "D3.event")).toContain("FAIL");
    expect(resultsOf(report, "D4.checkpoint")).toEqual(["PASS"]);
    expect(exitCodeOf(report.rows)).toBe(1);
  });

  for (const [name, edit] of MUTATIONS) {
    it(`${name}: D4.checkpoint FAILs, the D3 FAIL survives, no ERROR row, exit status 1`, async () => {
      const report = await run(readWith(edit));
      expect(resultsOf(report, "D4.checkpoint")).toEqual(["FAIL"]);
      expect(resultsOf(report, "D3.event")).toContain("FAIL");
      expect(resultsOf(report, "ERROR")).toEqual([]);
      expect(report.verdict).toBe("FAIL");
      expect(exitCodeOf(report.rows)).toBe(1);
    });
  }

  it("registry null is a malformed read, not a walked one", async () => {
    const excerpt = { ...readWith((cp) => cp), registry: null };
    const report = await run(excerpt);
    expect(resultsOf(report, "ERROR")).toEqual([]);
    expect(report.verdict).not.toBe("PASS");
  });
});

describe("a stage that throws", () => {
  it("becomes a fixed ERROR row that names the stage and not the exception text", () => {
    const rows = stageRows("D4", () => { throw new TypeError(`${MARKER} is not iterable`); });
    expect(rows).toEqual([{ id: "ERROR", result: "NOT-EVALUABLE", detail: "D4 stopped" }]);
  });

  it("does not hide the rows of the stages that finished", async () => {
    const report = await run(readWith((cp) => cp));
    expect(report.rows.filter((r) => r.result === "FAIL").length).toBeGreaterThan(0);
  });

  it("gives exit status 1 for a FAIL, else 2 for an ERROR row, else 0 (NOT-EVALUABLE alone leaves 0)", () => {
    const error = { id: "ERROR", result: "NOT-EVALUABLE" };
    expect(exitCodeOf([error, { id: "D3", result: "FAIL" }])).toBe(1);
    expect(exitCodeOf([error, { id: "D3", result: "PASS" }])).toBe(2);
    expect(exitCodeOf([{ id: "D1", result: "NOT-EVALUABLE" }])).toBe(0);
    expect(overallVerdict([error])).toBe("NOT-EVALUABLE");
  });
});

describe("the ERROR rows of a stopped run", () => {
  const throwing = (afterCalls) => { let n = 0; return () => { if (++n > afterCalls) throw new Error(MARKER); return 0; }; };
  const runWithClock = (clock) => runChecks({ excerpt: readWith((cp) => cp), parameters: PARAMS, pins: PINS, T: T0, clock });
  const textOf = (report) => JSON.stringify(report.rows);

  it("read context stopped: a fixed text without the injected content", async () => {
    const report = await runWithClock(throwing(0));
    expect(report.rows.filter((r) => r.id === "ERROR")).toEqual([{ id: "ERROR", result: "NOT-EVALUABLE", detail: "read context stopped" }]);
    expect(textOf(report)).not.toContain(MARKER);
  });

  it("a stage stopped: a fixed text, the other stages keep their rows, and C-SFC-7 does not pass", async () => {
    const report = await runWithClock(throwing(1));
    const errors = report.rows.filter((r) => r.id === "ERROR");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((r) => /^[A-Za-z0-9 -]+ stopped$/.test(r.detail))).toBe(true);
    expect(textOf(report)).not.toContain(MARKER);
    expect(exitCodeOf(report.rows)).not.toBe(0);
  });

  it("prints the cause to standard error only when SFC_DEBUG is set", async () => {
    const written = [];
    const original = process.stderr.write;
    process.stderr.write = (chunk) => { written.push(String(chunk)); return true; };
    try {
      await runWithClock(throwing(0));
      process.env.SFC_DEBUG = "1";
      await runWithClock(throwing(0));
    } finally { process.stderr.write = original; delete process.env.SFC_DEBUG; }
    expect(written).toEqual([`sfc-check debug: read context: ${MARKER}\n`]);
  });
});
