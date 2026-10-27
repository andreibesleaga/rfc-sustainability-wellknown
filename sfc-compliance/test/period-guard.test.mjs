/** The deep check never walks a period of another length than one month or one calendar year (8.1). Deterministic: no clock, no network. */
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/time.mjs", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, monthsBetween: vi.fn(original.monthsBetween) };
});

const { monthsBetween } = await import("../lib/time.mjs");
const { runChecks } = await import("../lib/check.mjs");
const { usablePeriod } = await import("../lib/declaration.mjs");
const { vectorFiles, inputOf } = await import("./helpers.mjs");

describe("usablePeriod", () => {
  const period = (start, end) => ({ period: { start, end } });
  it("accepts one month and one calendar year, nothing else", () => {
    expect(usablePeriod(period("2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"))).not.toBeNull();
    expect(usablePeriod(period("2025-01-01T00:00:00Z", "2026-01-01T00:00:00Z"))).not.toBeNull();
    expect(usablePeriod(period("2025-03-01T00:00:00Z", "2026-03-01T00:00:00Z"))).not.toBeNull();
    for (const [a, b] of [["2025-01-01T00:00:00Z", "2025-03-01T00:00:00Z"], ["2025-01-01T00:00:00Z", "2026-02-01T00:00:00Z"], ["0001-01-01T00:00:00Z", "9999-01-01T00:00:00Z"], ["2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z"], ["2026-01-02T00:00:00Z", "2026-02-01T00:00:00Z"]]) {
      expect(usablePeriod(period(a, b))).toBeNull();
    }
    expect(usablePeriod({})).toBeNull();
  });
});

describe("a declared period of 9 998 years", () => {
  it("is NOT-EVALUABLE with the reason named, and monthsBetween is never asked about it", async () => {
    const file = vectorFiles().find((f) => f.name === "v22-period-offset");
    const scenario = file.inputs.scenarios.find((s) => s.name === "period-of-9999-years-with-ledger-evidence");
    monthsBetween.mockClear();
    const report = await runChecks(inputOf(scenario, file));
    const ne = report.rows.filter((r) => ["C-SFC-4", "C-SFC-7"].includes(r.id));
    expect(ne.map((r) => [r.id, r.result, r.detail])).toEqual([
      ["C-SFC-4", "NOT-EVALUABLE", "period not one month or one calendar year"],
      ["C-SFC-7", "NOT-EVALUABLE", "period not one month or one calendar year"],
    ]);
    expect(monthsBetween.mock.calls.some(([start]) => start === "0001-01-01T00:00:00Z")).toBe(false);
  });
});
