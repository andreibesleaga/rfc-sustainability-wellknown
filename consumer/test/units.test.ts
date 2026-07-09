import { describe, expect, it } from "vitest";
import { convertEnergy, convertCarbon } from "../src/units";
import type { CarbonUnit, EnergyUnit } from "../src/types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require("path");
const publisherDist = path.resolve(__dirname, "../../publisher/dist/normalize.js");
const hasPublisherDist = require("fs").existsSync(publisherDist);

describe("convertEnergy", () => {
  it("identity conversions are a no-op", () => {
    const units: EnergyUnit[] = ["Wh", "kWh", "MWh", "GWh"];
    for (const u of units) {
      expect(convertEnergy(42, u, u)).toBe(42);
    }
  });

  it("converts across all unit pairs (Wh <-> kWh <-> MWh <-> GWh)", () => {
    expect(convertEnergy(1, "kWh", "Wh")).toBe(1000);
    expect(convertEnergy(1000, "Wh", "kWh")).toBe(1);
    expect(convertEnergy(1, "MWh", "kWh")).toBe(1000);
    expect(convertEnergy(1000, "kWh", "MWh")).toBe(1);
    expect(convertEnergy(1, "GWh", "MWh")).toBe(1000);
    expect(convertEnergy(1000, "MWh", "GWh")).toBe(1);
    expect(convertEnergy(1, "GWh", "Wh")).toBe(1_000_000_000);
    expect(convertEnergy(1_000_000_000, "Wh", "GWh")).toBe(1);
  });

  it("round-trips through an intermediate unit", () => {
    const original = 12345.6789;
    const roundTripped = convertEnergy(convertEnergy(original, "kWh", "MWh"), "MWh", "kWh");
    expect(roundTripped).toBeCloseTo(original, 6);
  });

  it("zero converts to zero in any unit", () => {
    expect(convertEnergy(0, "Wh", "GWh")).toBe(0);
  });
});

describe("convertCarbon", () => {
  it("identity conversions are a no-op", () => {
    const units: CarbonUnit[] = ["gCO2e", "kgCO2e", "mtCO2e"];
    for (const u of units) {
      expect(convertCarbon(7, u, u)).toBe(7);
    }
  });

  it("converts across all unit pairs (gCO2e <-> kgCO2e <-> mtCO2e)", () => {
    expect(convertCarbon(1, "kgCO2e", "gCO2e")).toBe(1000);
    expect(convertCarbon(1000, "gCO2e", "kgCO2e")).toBe(1);
    expect(convertCarbon(1, "mtCO2e", "kgCO2e")).toBe(1000);
    expect(convertCarbon(1000, "kgCO2e", "mtCO2e")).toBe(1);
    // 1 mtCO2e = 1,000,000 gCO2e
    expect(convertCarbon(1, "mtCO2e", "gCO2e")).toBe(1_000_000);
    expect(convertCarbon(1_000_000, "gCO2e", "mtCO2e")).toBe(1);
  });

  it("round-trips through an intermediate unit", () => {
    const original = 987.654321;
    const roundTripped = convertCarbon(convertCarbon(original, "gCO2e", "mtCO2e"), "mtCO2e", "gCO2e");
    expect(roundTripped).toBeCloseTo(original, 6);
  });

  it("zero converts to zero in any unit", () => {
    expect(convertCarbon(0, "mtCO2e", "gCO2e")).toBe(0);
  });
});

describe("parity with publisher/src/normalize.ts conversion tables", () => {
  // publisher/src/normalize.ts defines (verified by reading the source directly):
  //   ENERGY_TO_WH = { Wh: 1, kWh: 1_000, MWh: 1_000_000, GWh: 1_000_000_000 }
  //   CARBON_TO_G  = { gCO2e: 1, kgCO2e: 1_000, mtCO2e: 1_000_000 }
  // consumer/src/units.ts declares (in its own doc comment) that it is meant
  // to match those tables exactly. Assert the observable behavior agrees.
  const energyFactorsToWh: Record<EnergyUnit, number> = {
    Wh: 1,
    kWh: 1_000,
    MWh: 1_000_000,
    GWh: 1_000_000_000,
  };
  const carbonFactorsToG: Record<CarbonUnit, number> = {
    gCO2e: 1,
    kgCO2e: 1_000,
    mtCO2e: 1_000_000,
  };

  it("consumer's convertEnergy matches the known Wh-based factors", () => {
    for (const from of Object.keys(energyFactorsToWh) as EnergyUnit[]) {
      for (const to of Object.keys(energyFactorsToWh) as EnergyUnit[]) {
        const expected = (5 * energyFactorsToWh[from]) / energyFactorsToWh[to];
        expect(convertEnergy(5, from, to)).toBeCloseTo(expected, 9);
      }
    }
  });

  it("consumer's convertCarbon matches the known gram-based factors", () => {
    for (const from of Object.keys(carbonFactorsToG) as CarbonUnit[]) {
      for (const to of Object.keys(carbonFactorsToG) as CarbonUnit[]) {
        const expected = (3 * carbonFactorsToG[from]) / carbonFactorsToG[to];
        expect(convertCarbon(3, from, to)).toBeCloseTo(expected, 9);
      }
    }
  });

  it.runIf(hasPublisherDist)(
    "produces byte-identical results to publisher/dist/normalize.js's compiled convertEnergy/convertCarbon",
    () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const publisherNormalize = require(publisherDist);
      const energyUnits: EnergyUnit[] = ["Wh", "kWh", "MWh", "GWh"];
      const carbonUnits: CarbonUnit[] = ["gCO2e", "kgCO2e", "mtCO2e"];
      const sampleValues = [0, 1, 3.14159, 1000, 0.001, 123456.789];

      for (const from of energyUnits) {
        for (const to of energyUnits) {
          for (const v of sampleValues) {
            expect(convertEnergy(v, from, to)).toBe(publisherNormalize.convertEnergy(v, from, to));
          }
        }
      }
      for (const from of carbonUnits) {
        for (const to of carbonUnits) {
          for (const v of sampleValues) {
            expect(convertCarbon(v, from, to)).toBe(publisherNormalize.convertCarbon(v, from, to));
          }
        }
      }
    },
  );

  if (!hasPublisherDist) {
    it("publisher/dist/normalize.js is not built - skipping compiled-output parity, hardcoded factors above stand in", () => {
      expect(hasPublisherDist).toBe(false);
    });
  }
});
