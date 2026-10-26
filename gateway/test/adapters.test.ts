/**
 * The two worked adapter examples: a document produced by a publisher adapter,
 * not written by hand. These prove the arithmetic and the determinism.
 */
import { describe, expect, it } from "vitest";
import {
  KEPLER_FIXTURE_2025,
  keplerReplayAdapter,
} from "../src/adapters/kepler-replay";
import { monthPeriod, yearPeriod, type Period } from "sustainability-wellknown-publisher";
import { selfReportAdapter } from "../src/adapters/self-report";
import { subjectFromAdapter } from "../src/registry";

describe("self-report adapter (computedAdapter)", () => {
  const make = (period: Period) =>
    selfReportAdapter({
      target: "test-gateway",
      provider: "Test operator",
      methodologyUri: "https://example.com/methodology",
      disclosureUri: "https://example.com/disclosures",
      period,
      // 3 W entered for every month the pinned periods touch.
      wattsByMonth: Object.fromEntries([...Array(15).keys()].map((i) => [`${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`, 3])),
      gridIntensity: 373,
      liveSince: "2020-01-01T00:00:00Z",
      clock: () => new Date("2026-03-10T00:00:00Z"),
    });
  /** The self report is one object for a request that names no parameter. */
  const single = { representation: "single" } as const;

  it("derives energy from power x hours and carbon from energy x intensity", async () => {
    const s = await subjectFromAdapter({
      domain: "self.invalid",
      adapter: make(yearPeriod(2025)),
      target: "test-gateway",
      targetType: "service",
      ...single,
    });
    const d = s.document;
    // 3 W x 8760 h = 26,280 Wh (watt-hours, so a small day keeps its digits)
    expect(d["energy-consumption"]).toBe(26280);
    expect(d["energy-unit"]).toBe("Wh");
    // 26.28 kWh x 373 gCO2e/kWh = 9802.44 gCO2e
    expect(d["carbon-footprint"]).toBeCloseTo(9802.44, 2);
    expect(d["carbon-unit"]).toBe("gCO2e");
    expect(d["carbon-intensity-gCO2e-per-kWh"]).toBe(373);
    expect(d["carbon-accounting"]).toBe("location-based");
    expect(d["measurement-method"]).toBe("third-party-modeled");
    expect(d["target-type"]).toBe("service");
    expect(d.updated).toBe("2026-01-01T00:00:00Z");
    expect(d.period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
  });

  it("omits, rather than zeroes, the metrics the operator does not have", async () => {
    const s = await subjectFromAdapter({
      domain: "self.invalid",
      adapter: make(monthPeriod(2025, 6)),
      target: "test-gateway",
      targetType: "service",
      ...single,
    });
    for (const m of [
      "scope-1",
      "scope-2",
      "scope-3",
      "renewable-energy",
      "estimated-annual-emissions-kgCO2e",
      "sci-score",
    ]) {
      expect(s.document[m], m).toBeUndefined();
    }
  });

  it("is byte-stable for a pinned period", async () => {
    const a = await subjectFromAdapter({
      domain: "self.invalid",
      adapter: make(yearPeriod(2025)),
      target: "test-gateway",
      ...single,
    });
    const b = await subjectFromAdapter({
      domain: "self.invalid",
      adapter: make(yearPeriod(2025)),
      target: "test-gateway",
      ...single,
    });
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
    expect(a.lastModified).toBe(b.lastModified);
  });
});

describe("kepler-prometheus adapter in replay mode", () => {
  it("sums the recorded joule counters and converts them", async () => {
    const s = await subjectFromAdapter({
      domain: "kepler-demo.example",
      adapter: keplerReplayAdapter({
        target: "kepler-demo.example",
        methodologyUri: "https://example.com/methodology",
        gridIntensity: 373,
      }),
      target: "kepler-demo.example",
      targetType: "service",
    });
    const d = s.document;
    // 2 x 3.942e9 J = 7.884e9 J = 2190 kWh
    expect(d["energy-consumption"]).toBe(2190);
    expect(d["energy-unit"]).toBe("kWh");
    expect(d["carbon-footprint"]).toBeCloseTo(2190 * 373, 2);
    // Kepler models power from hardware counters; it is not a meter (publisher 0.7.2).
    expect(d["measurement-method"]).toBe("hardware-estimated");
    expect(d.period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" });
    expect(s.synthetic).toBe(true);
    expect(d.provider).toContain("SYNTHETIC");
  });

  it("refuses to publish a fabricated zero when the fixture holds no series", async () => {
    const empty = { status: "success", data: { resultType: "vector", result: [] } };
    await expect(
      subjectFromAdapter({
        domain: "kepler-demo.example",
        adapter: keplerReplayAdapter({
          target: "kepler-demo.example",
          methodologyUri: "https://example.com/methodology",
          gridIntensity: 373,
          fixture: empty,
        }),
        target: "kepler-demo.example",
      }),
    ).rejects.toThrow(/no series|fabricated/);
  });

  it("ships a fixture shaped like a real Prometheus query response", () => {
    expect(KEPLER_FIXTURE_2025.status).toBe("success");
    expect(KEPLER_FIXTURE_2025.data.result).toHaveLength(2);
    for (const r of KEPLER_FIXTURE_2025.data.result) {
      expect(r.metric.__name__).toBe("kepler_node_platform_joules_total");
      expect(Number(r.value[1])).toBeGreaterThan(0);
    }
  });
});
