/**
 * Unit conversion, matching publisher/src/normalize.ts's conversion tables
 * exactly (test/units.test.ts asserts parity between the two copies).
 */
import { CarbonUnit, EnergyUnit } from "./types";
export declare function convertEnergy(value: number, from: EnergyUnit, to: EnergyUnit): number;
export declare function convertCarbon(value: number, from: CarbonUnit, to: CarbonUnit): number;
