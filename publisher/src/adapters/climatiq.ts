/**
 * Climatiq adapter.
 *
 * Calls the Climatiq `/data/v1/estimate` endpoint to turn an activity + region +
 * energy into a carbon estimate (kgCO2e), then maps it to the draft model.
 * Live mode needs CLIMATIQ_API_KEY; replay mode uses a recorded `fixture`.
 *
 * Docs: https://www.climatiq.io/docs/api-reference/estimate
 */
import { EnergyUnit, RawMetrics, SourceAdapter } from "../types";
import { fetchJson, lastFullMonth } from "../util";

export interface ClimatiqEstimateResponse {
  co2e: number;
  co2e_unit: string; // typically "kg"
  emission_factor?: { activity_id?: string; id?: string; source?: string };
  [key: string]: unknown;
}

export interface ClimatiqConfig {
  provider: string;
  methodologyUri: string;
  reportingPeriod?: string;
  apiKey?: string;
  apiUrl?: string; // default https://api.climatiq.io
  /** Climatiq activity id, e.g. "electricity-supply_grid-source_residual_mix". */
  activityId: string;
  region?: string;
  /** Energy to estimate against. */
  energy: { value: number; unit: EnergyUnit };
  measurementMethod?: string;
  capabilities?: "basic" | "extended";
  /** Replay mode: a recorded estimate response. */
  fixture?: ClimatiqEstimateResponse;
}

const ENERGY_UNIT_PARAM: Record<EnergyUnit, string> = {
  Wh: "Wh",
  kWh: "kWh",
  MWh: "MWh",
  GWh: "GWh",
};

export function climatiqAdapter(config: ClimatiqConfig): SourceAdapter {
  return {
    name: "climatiq",
    capabilities: config.capabilities ?? "extended",
    async fetch(): Promise<RawMetrics> {
      let resp: ClimatiqEstimateResponse;
      if (config.fixture) {
        resp = config.fixture;
      } else {
        const apiKey = config.apiKey ?? process.env.CLIMATIQ_API_KEY;
        if (!apiKey) throw new Error("climatiqAdapter: apiKey/CLIMATIQ_API_KEY or fixture required");
        const base = (config.apiUrl ?? "https://api.climatiq.io").replace(/\/$/, "");
        resp = (await fetchJson(`${base}/data/v1/estimate`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            emission_factor: {
              activity_id: config.activityId,
              ...(config.region ? { region: config.region } : {}),
            },
            parameters: {
              energy: config.energy.value,
              energy_unit: ENERGY_UNIT_PARAM[config.energy.unit],
            },
          }),
        })) as ClimatiqEstimateResponse;
      }

      // Climatiq returns co2e in kg by default; normalize to gCO2e for the model.
      const unit = (resp.co2e_unit ?? "kg").toLowerCase();
      const grams = unit.startsWith("kg")
        ? resp.co2e * 1000
        : unit.startsWith("t")
          ? resp.co2e * 1_000_000
          : resp.co2e; // assume grams otherwise

      // Note: the emission_factor id is intentionally not copied into the payload.
      // The bundled JTD/CDDL schemas are strict (no additional members), so the
      // gateway emits only spec-defined fields; provenance lives behind
      // `methodology-uri`. (Vendor extensions are possible only if the deploying
      // schema is relaxed to allow additional properties.)
      return {
        provider: config.provider,
        measurementMethod: config.measurementMethod ?? "third-party-modeled",
        methodologyUri: config.methodologyUri,
        reportingPeriod: config.reportingPeriod ?? lastFullMonth(),
        energy: config.energy,
        carbon: { value: grams, unit: "gCO2e" },
        capabilities: config.capabilities ?? "extended",
      };
    },
  };
}
