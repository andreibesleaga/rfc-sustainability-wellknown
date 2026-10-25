/** The illustrative multi-origin script: its grouping keeps each origin's claims apart. */
import { describe, expect, it } from "vitest";
import { groupClaims } from "../examples/crawl-many-origins";
import { monthPeriod } from "../src/period";
import { SustainabilityMetrics } from "../src/types";

const claim = (target: string, month: number, targetType?: string): SustainabilityMetrics => ({
  updated: "2026-03-01T00:00:00Z",
  capabilities: "basic",
  provider: "Acme (a@acme.example)",
  "measurement-method": "hardware-metered",
  "methodology-uri": "https://acme.example/m",
  period: monthPeriod(2026, month),
  target,
  ...(targetType ? { "target-type": targetType as SustainabilityMetrics["target-type"] } : {}),
  "energy-consumption": 1,
  "energy-unit": "kWh",
});

describe("groupClaims", () => {
  it("keeps two origins' claims about the same target apart", () => {
    const groups = groupClaims([
      { origin: "https://a.example", object: claim("Acme", 1) },
      { origin: "https://b.example", object: claim("Acme", 2) },
      { origin: "https://a.example", object: claim("Acme", 3) },
    ]);
    expect(groups.map((g) => [g.origin, g.objects.length])).toEqual([
      ["https://a.example", 2],
      ["https://b.example", 1],
    ]);
  });

  it("treats host-name targets that differ only in case as one target", () => {
    const groups = groupClaims([
      { origin: "https://a.example", object: claim("Shop.Example", 1, "origin") },
      { origin: "https://a.example", object: claim("shop.example", 2, "origin") },
    ]);
    expect(groups).toHaveLength(1);
  });
});
