/** Bidi isolation of document-derived text in human-readable output (draft -10 §Security Considerations). */
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
  period: { start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" },
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
    expect(r.warnings[0].message).toContain(`(got ${FSI}"http://${RTL}.example/"${PDI})`);
    const named = validateDocument({ ...base, extensions: { [`urn:${RTL}`]: {} } });
    expect(named.valid).toBe(false);
    expect(named.errors.join("\n")).toContain(`/extensions/${FSI}urn:${RTL}${PDI} `);
  });

  it("machine outputs carry the data unchanged", () => {
    const out = toNdjson(base, { url: "https://example.com/.well-known/sustainability-data" });
    expect(out).toContain(RTL);
    expect(out).not.toContain(FSI);
  });
});
