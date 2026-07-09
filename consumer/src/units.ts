/**
 * Unit conversion, matching publisher/src/normalize.ts's conversion tables
 * exactly (test/units.test.ts asserts parity between the two copies).
 */
import { CarbonUnit, EnergyUnit } from "./types";

const ENERGY_TO_WH: Record<EnergyUnit, number> = {
  Wh: 1,
  kWh: 1_000,
  MWh: 1_000_000,
  GWh: 1_000_000_000,
};

const CARBON_TO_G: Record<CarbonUnit, number> = {
  gCO2e: 1,
  kgCO2e: 1_000,
  mtCO2e: 1_000_000,
};

export function convertEnergy(value: number, from: EnergyUnit, to: EnergyUnit): number {
  return (value * ENERGY_TO_WH[from]) / ENERGY_TO_WH[to];
}

export function convertCarbon(value: number, from: CarbonUnit, to: CarbonUnit): number {
  return (value * CARBON_TO_G[from]) / CARBON_TO_G[to];
}
