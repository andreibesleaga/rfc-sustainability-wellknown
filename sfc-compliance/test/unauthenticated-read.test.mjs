/**
 * 9.4 D2: a read with no pinned registrar key never gives an overall PASS, however consistent it is.
 * Uses the vector scenarios; fixed clock, no network.
 */
import { describe, expect, it } from "vitest";
import { runChecks } from "../lib/check.mjs";
import { exitCodeOf } from "../lib/report.mjs";
import { vectorFiles, inputOf } from "./helpers.mjs";

const file = vectorFiles().find((f) => f.name === "v05-sums-year");
const input = (name) => inputOf(file.inputs.scenarios.find((s) => s.name === name), file);

describe("a read without a pinned registrar key", () => {
  it("is NOT-EVALUABLE overall, with exit status 0 (nothing FAILs)", async () => {
    const report = await runChecks(input("year-2025-no-registrar-key-pinned"));
    expect(report.verdict).toBe("NOT-EVALUABLE");
    expect(exitCodeOf(report.rows)).toBe(0);
  });

  it("marks C-SFC-1, 2, 4 and 6 of the Registry as consistent but not authenticated, not PASS", async () => {
    const report = await runChecks(input("year-2025-no-registrar-key-pinned"));
    const ledgerRows = report.rows.filter((r) => ["C-SFC-1", "C-SFC-4", "C-SFC-6"].includes(r.id) || (r.id === "C-SFC-2" && String(r.scope).startsWith("ledger")));
    expect(ledgerRows.length).toBeGreaterThanOrEqual(4);
    for (const r of ledgerRows) expect({ id: r.id, result: r.result, detail: r.detail }).toEqual({ id: r.id, result: "NOT-EVALUABLE", detail: "consistent but not authenticated" });
  });

  it("the same read with the registrar key pinned is a PASS", async () => {
    const report = await runChecks(input("year-2025"));
    expect(report.verdict).toBe("PASS");
  });
});
