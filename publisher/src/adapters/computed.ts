/**
 * Computed adapter — derive carbon from energy × grid carbon intensity.
 *
 * The canonical "I have an energy number and a grid factor" path. Zero external
 * credentials; the normalizer does the energy→carbon math.
 */
import {
  CarbonAccounting,
  EnergyUnit,
  RawMetrics,
  SourceAdapter,
} from "../types";
import { lastFullMonth } from "../util";

export interface ComputedAdapterConfig {
  provider: string;
  methodologyUri: string;
  measurementMethod?: string;
  /** Defaults to the most recent full calendar month (draft Basic default). */
  reportingPeriod?: string;
  /** Energy as value+unit, or raw joules. */
  energy?: { value: number; unit: EnergyUnit };
  energyJoules?: number;
  /** gCO2e per kWh. Carbon is computed from energy and this factor. */
  gridIntensity: number;
  carbonAccounting?: CarbonAccounting;
  renewableEnergy?: number;
  functionalUnit?: string;
  sciScore?: number;
  capabilities?: "basic" | "extended";
}

export function computedAdapter(config: ComputedAdapterConfig): SourceAdapter {
  return {
    name: "computed",
    capabilities: config.capabilities ?? "basic",
    async fetch(): Promise<RawMetrics> {
      const raw: RawMetrics = {
        provider: config.provider,
        measurementMethod: config.measurementMethod ?? "hardware-estimated",
        methodologyUri: config.methodologyUri,
        reportingPeriod: config.reportingPeriod ?? lastFullMonth(),
        carbonIntensity: config.gridIntensity,
        capabilities: config.capabilities ?? "basic",
      };
      if (config.energy) raw.energy = config.energy;
      if (config.energyJoules !== undefined) raw.energyJoules = config.energyJoules;
      if (config.carbonAccounting) raw.carbonAccounting = config.carbonAccounting;
      if (config.renewableEnergy !== undefined) raw.renewableEnergy = config.renewableEnergy;
      if (config.functionalUnit) raw.functionalUnit = config.functionalUnit;
      if (config.sciScore !== undefined) raw.sciScore = config.sciScore;
      return raw;
    },
  };
}
