/** Properties of the compatibility reading and of validation over arbitrary JSON: neither throws, the reading settles in one pass. */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CompatReport, readDocument } from "../src/sentinel";
import { verifyEmbeddedSignature } from "../src/signature";
import { isBlockedAddress } from "../src/transport";
import { validateDocument } from "../src/validate";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

// Objects shaped like declarations of any revision, with values of any type in the members the reading touches.
const anything = fc.jsonValue();
const text = fc.oneof(fc.string(), fc.constantFrom("2025", "2025-02", "2025-02-30", "2026-13", "Hardware-Metered", "mtCO2e", "per-thousand-requests", "per-visit", "transit", "datacenter", "hardware-metered", "tCO2e", "per-job"));
const declaration = fc.record(
  {
    updated: text,
    capabilities: text,
    provider: text,
    "measurement-method": fc.oneof(text, anything),
    "methodology-uri": text,
    period: fc.oneof(
      fc.record({ start: text, end: text }),
      fc.record({ start: fc.constantFrom("2025-01-01", "2025-01-01T00:00:00Z"), end: fc.constantFrom("2025-12-31", "2026-01-01T00:00:00Z") }),
      anything,
    ),
    "reporting-period": fc.oneof(text, anything),
    target: text,
    "functional-unit": fc.oneof(text, anything),
    "sci-score": fc.oneof(fc.double(), anything),
    "carbon-unit": fc.oneof(text, anything),
    "target-type": fc.oneof(text, anything),
    upstream: fc.oneof(fc.array(fc.record({ declaration: text }, { requiredKeys: ["declaration"] })), anything),
    extensions: anything,
  },
  { requiredKeys: [] },
);
const body = fc.oneof(declaration, fc.array(declaration, { maxLength: 4 }), anything);

describe("over arbitrary JSON", () => {
  it("the compatibility reading never throws and reads a second time what the first left, nothing", () => {
    fc.assert(
      fc.property(body, (doc) => {
        const subject = clone(doc);
        const first: CompatReport = { converted: [], disregarded: [] };
        readDocument(subject, first);
        const again: CompatReport = { converted: [], disregarded: [] };
        const settled = clone(subject);
        readDocument(settled, again);
        expect(again).toEqual({ converted: [], disregarded: [] });
        expect(settled).toEqual(subject);
      }),
      { numRuns: 400, seed: 20261024 },
    );
  });

  it("validation never throws, and a valid verdict has no errors", () => {
    fc.assert(
      fc.property(body, (doc) => {
        const result = validateDocument(doc);
        expect(result.valid).toBe(result.errors.length === 0);
      }),
      { numRuns: 400, seed: 20261024 },
    );
  });
});

describe("over arbitrary signed members and addresses", () => {
  it("verifying a signed member never throws, and anything but a string is unsigned", async () => {
    await fc.assert(
      fc.asyncProperty(declaration, fc.oneof(fc.string(), anything), async (object, signed) => {
        const { result } = await verifyEmbeddedSignature({ ...(object as Record<string, unknown>), signed });
        expect(["unsigned", "unverified"]).toContain(result.status);
        if (typeof signed !== "string") expect(result.status).toBe("unsigned");
      }),
      { numRuns: 300, seed: 20261024 },
    );
  });

  it("an IPv4 address is judged alike bare, mapped into IPv6 and inside a NAT64 address", () => {
    const octets = fc.tuple(...Array.from({ length: 4 }, () => fc.integer({ min: 0, max: 255 })));
    fc.assert(
      fc.property(octets, ([a, b, c, d]) => {
        const v4 = `${a}.${b}.${c}.${d}`;
        const hex = (x: number, y: number) => ((x << 8) | y).toString(16);
        const verdict = isBlockedAddress(v4);
        expect(isBlockedAddress(`::ffff:${v4}`)).toBe(verdict);
        expect(isBlockedAddress(`64:ff9b::${hex(a, b)}:${hex(c, d)}`)).toBe(verdict);
        // 6to4 and Teredo carry the address inside but are never connected to.
        expect(isBlockedAddress(`2002:${hex(a, b)}:${hex(c, d)}::1`)).toBe(true);
      }),
      { numRuns: 500, seed: 20261024 },
    );
  });
});
