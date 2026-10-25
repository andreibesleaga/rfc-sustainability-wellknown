/**
 * Computed adapter — derive carbon from energy × grid carbon intensity.
 *
 * The canonical "I have an energy number and a grid factor" path. Zero external
 * credentials; the normalizer does the energy→carbon math.
 */
import { PeriodInput } from "../period";
import { CarbonAccounting, EnergyUnit, FunctionalUnit, MeasurementMethod } from "../tokens";
import { Extensions, RawMetrics, SourceAdapter } from "../types";
import { lastFullMonthPeriod } from "../util";

export interface ComputedAdapterConfig {
  provider: string;
  methodologyUri: string;
  measurementMethod?: MeasurementMethod;
  /**
   * The period the figures cover: a `{ start, end }` object, or "YYYY", "YYYY-MM" or "YYYY-MM-DD" for
   * the whole calendar unit in UTC. Defaults to the most recent full calendar month.
   */
  period?: PeriodInput;
  /** Energy as value+unit, or raw joules. */
  energy?: { value: number; unit: EnergyUnit };
  energyJoules?: number;
  /** gCO2e per kWh. Carbon is computed from energy and this factor. */
  gridIntensity: number;
  carbonAccounting?: CarbonAccounting;
  renewableEnergy?: number;
  /** One of the twelve functional units of the draft; `sciScore` is the score for that one unit. */
  functionalUnit?: FunctionalUnit;
  sciScore?: number;
  /**
   * A score in a unit the draft does not list goes here, under a URI name whose definition states the
   * unit (draft, Optional Members); leave `sciScore` and `functionalUnit` out then.
   */
  extensions?: Extensions;
  capabilities?: "basic" | "extended";
}

export function computedAdapter(config: ComputedAdapterConfig): SourceAdapter {
  // Default "basic": since -03, `capabilities` describes Extended
  // query-parameter support only (member presence is orthogonal — a "basic"
  // document MAY carry optional members). This adapter ignores the query
  // parameters, so "basic" is the honest default; set config.capabilities to
  // "extended" only when the deployment in front of it honors the parameters.
  return {
    name: "computed",
    capabilities: config.capabilities ?? "basic",
    async fetch(): Promise<RawMetrics> {
      const raw: RawMetrics = {
        provider: config.provider,
        measurementMethod: config.measurementMethod ?? "hardware-estimated",
        methodologyUri: config.methodologyUri,
        period: config.period ?? lastFullMonthPeriod(),
        carbonIntensity: config.gridIntensity,
        capabilities: config.capabilities ?? "basic",
      };
      if (config.energy) raw.energy = config.energy;
      if (config.energyJoules !== undefined) raw.energyJoules = config.energyJoules;
      if (config.carbonAccounting) raw.carbonAccounting = config.carbonAccounting;
      if (config.renewableEnergy !== undefined) raw.renewableEnergy = config.renewableEnergy;
      if (config.functionalUnit) raw.functionalUnit = config.functionalUnit;
      if (config.sciScore !== undefined) raw.sciScore = config.sciScore;
      if (config.extensions) raw.extensions = config.extensions;
      return raw;
    },
  };
}
