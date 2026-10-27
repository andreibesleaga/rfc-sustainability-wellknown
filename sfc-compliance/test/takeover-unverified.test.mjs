/**
 * A chain that starts with a non-null `prev` hides its earlier events. Without a pinned methodology document
 * nothing vouches for the takeover, so D4.chain and every D5 are NOT-EVALUABLE, with a verified checkpoint too.
 * Fixed clock, no network.
 */
import { describe, expect, it } from "vitest";
import { runChecks } from "../lib/check.mjs";
import { World, makeCheckpoint } from "../vectors/build/world.mjs";
import { T0, PARAMS, REGISTRAR_X } from "../vectors/cases/base.mjs";

const DEC = "2025-12-01T00:00:00Z";
const ARBITRARY_PREV = "ab".repeat(32);

function read() {
  const w = new World({ readAt: T0 });
  const [a, b] = ["a", "b"].map((n) => w.operator(n, { from: "2025-11-01T00:00:00Z" }));
  w.energy(a, DEC, { kWh: 1000 }, { prev: ARBITRARY_PREV });
  w.energy(b, DEC, { kWh: 1100 });
  return w.excerpt({ checkpoint: (ex) => makeCheckpoint(ex) });
}
const pins = { registrar: { "ledger.example": [REGISTRAR_X] } };   // a registrar key, but no methodology document
const rowsOf = (report, id) => report.rows.filter((r) => r.id === id);

describe("a takeover link with the methodology document not pinned", () => {
  it("is NOT-EVALUABLE for the chain, and L9 is NOT-EVALUABLE for every chain, even with a verified checkpoint", async () => {
    const report = await runChecks({ excerpt: read(), parameters: PARAMS, pins, T: T0 });
    expect(rowsOf(report, "D4.checkpoint")).toEqual([expect.objectContaining({ result: "PASS" })]);
    expect(rowsOf(report, "D4.chain").map((r) => [r.scope, r.result])).toEqual([["did:web:op-a.example Energy", "NOT-EVALUABLE"], ["did:web:op-b.example Energy", "PASS"]]);
    const d5 = rowsOf(report, "D5");
    expect(d5.map((r) => r.result)).toEqual(["NOT-EVALUABLE", "NOT-EVALUABLE"]);
    for (const r of d5) expect(r.detail).toContain("takeover not verified: did:web:op-a.example Energy");
  });

  it("with the document pinned and the link not listed, the chain FAILs instead", async () => {
    const report = await runChecks({ excerpt: read(), parameters: PARAMS, pins: { ...pins, methodology: true }, T: T0 });
    expect(rowsOf(report, "D4.chain")[0]).toMatchObject({ result: "FAIL", detail: "takeover link not listed" });
  });
});
