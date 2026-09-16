/** Bidi isolation of document-derived text in human-readable output (draft §Internationalization). */
import { describe, expect, it } from "vitest";
import { FSI, isolate, PDI } from "../src/text";
import { validateDocument } from "../src/validate";
import { toNdjson } from "../src/transform";
import { SustainabilityMetrics } from "../src/types";

const RTL = "مثال"; // an Arabic provider name (no spaces, so it is also a valid host label below)

const base: SustainabilityMetrics = {
  updated: "2026-03-01T00:00:00Z",
  capabilities: "basic",
  provider: RTL,
  "measurement-method": "hardware-metered",
  "methodology-uri": "https://example.com/m",
  "reporting-period": "2026-02",
  target: "example.com",
  "energy-consumption": 1,
};

describe("isolate", () => {
  it("wraps text in FIRST STRONG ISOLATE … POP DIRECTIONAL ISOLATE", () => {
    expect(isolate(RTL)).toBe(`${FSI}${RTL}${PDI}`);
    expect(FSI).toBe("⁨");
    expect(PDI).toBe("⁩");
  });

  it("validation messages isolate the document value they quote", () => {
    const r = validateDocument({ ...base, "disclosure-uri": `http://${RTL}.example/` });
    expect(r.valid).toBe(true);
    expect(r.warnings[0]).toContain(`("${FSI}http://${RTL}.example/${PDI}")`);
    const arr = validateDocument([
      { ...base, "reporting-period": "2026-02" },
      { ...base, "reporting-period": "2026-01" },
    ]);
    expect(arr.valid).toBe(false);
    expect(arr.errors.join("\n")).toContain(`("${FSI}2026-01${PDI}" after "${FSI}2026-02${PDI}")`);
  });

  it("machine outputs carry the data unchanged", () => {
    const out = toNdjson(base);
    expect(out).toContain(RTL);
    expect(out).not.toContain(FSI);
  });
});
