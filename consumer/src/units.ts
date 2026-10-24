/**
 * Unit conversion, matching publisher/src/normalize.ts's conversion tables
 * exactly (test/units.test.ts asserts parity between the two copies). The
 * carbon table is the shared one of tokens.ts.
 */
import { CARBON_TO_G, CarbonUnit, EnergyUnit } from "./tokens";

const ENERGY_TO_WH: Record<EnergyUnit, number> = {
  Wh: 1,
  kWh: 1_000,
  MWh: 1_000_000,
  GWh: 1_000_000_000,
};

export function convertEnergy(value: number, from: EnergyUnit, to: EnergyUnit): number {
  return (value * ENERGY_TO_WH[from]) / ENERGY_TO_WH[to];
}

export function convertCarbon(value: number, from: CarbonUnit, to: CarbonUnit): number {
  return (value * CARBON_TO_G[from]) / CARBON_TO_G[to];
}
