import { describe, expect, it, vi } from "vitest";
import { processExtensions, ExtensionHandler } from "../src/extensions";
import { yearPeriod } from "../src/period";
import { SustainabilityMetrics } from "../src/types";

const WATER = "https://example.org/ns/water-and-waste";
const OTHER = "urn:uuid:6f1c1c1a-9d5e-4d4e-8c5e-0d3a3a0b6a11";

const object = (extensions?: SustainabilityMetrics["extensions"]): SustainabilityMetrics => ({
  updated: "2026-01-05T09:00:00Z",
  capabilities: "basic",
  provider: "Extension Test Co",
  "measurement-method": "metered" as never,
  "methodology-uri": "https://example.com/methodology",
  period: yearPeriod(2025),
  target: "example.com",
  "energy-consumption": 1,
  ...(extensions ? { extensions } : {}),
});

describe("processExtensions()", () => {
  it("gives a handler the value of its own name, and the object that carries it", async () => {
    const water = vi.fn();
    const doc = object({ [WATER]: { litres: 12 }, [OTHER]: { x: 1 } });
    const outcomes = await processExtensions(doc, new Map<string, ExtensionHandler>([[WATER, water]]));
    expect(water).toHaveBeenCalledTimes(1);
    expect(water).toHaveBeenCalledWith({ litres: 12 }, doc);
    expect(outcomes).toEqual([{ name: WATER, ok: true }]);
  });

  it("a name with no handler is ignored; a handler registered for another name never sees this value", async () => {
    const water = vi.fn();
    expect(await processExtensions(object({ [OTHER]: { x: 1 } }), new Map([[WATER, water]]))).toEqual([]);
    expect(water).not.toHaveBeenCalled();
  });

  it("names are compared as strings: a name differing only in case is another name", async () => {
    const water = vi.fn();
    await processExtensions(object({ [WATER.toUpperCase()]: {} }), new Map([[WATER, water]]));
    expect(water).not.toHaveBeenCalled();
  });

  it("a handler that throws is reported and the next handler still runs", async () => {
    const after = vi.fn();
    const outcomes = await processExtensions(
      object({ [WATER]: {}, [OTHER]: {} }),
      new Map<string, ExtensionHandler>([
        [WATER, () => { throw new Error("boom"); }],
        [OTHER, after],
      ]),
    );
    expect(outcomes).toEqual([{ name: WATER, ok: false, error: "boom" }, { name: OTHER, ok: true }]);
    expect(after).toHaveBeenCalled();
  });

  it("walks every object of an array, and an object without extensions has nothing to process", async () => {
    const water = vi.fn();
    await processExtensions([object(), object({ [WATER]: { a: 1 } }), object({ [WATER]: { a: 2 } })], new Map([[WATER, water]]));
    expect(water.mock.calls.map((c) => c[0])).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("an empty registry processes nothing", async () => {
    expect(await processExtensions(object({ [WATER]: {} }), new Map())).toEqual([]);
  });
});
