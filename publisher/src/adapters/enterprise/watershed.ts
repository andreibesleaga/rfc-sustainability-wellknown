/**
 * Watershed adapter.
 *
 * Pulls a calculated footprint from the Watershed API and maps it to the draft
 * model. Watershed's CEDA-backed footprints expose Scope 1/2/3 breakdowns; values
 * here are taken as kg unless configured otherwise.
 *
 * Live mode: apiUrl + apiKey. Replay mode: a recorded footprint object as `fixture`.
 * Docs: https://watershed.com/ (API & developer guides)
 */
import { CarbonUnit, RawMetrics, SourceAdapter } from "../../types";
import { fetchJson } from "../../util";

export interface WatershedFootprint {
  reportingPeriod?: string;
  totalEmissionsKgCo2e?: number;
  scope1Kg?: number;
  scope2Kg?: number;
  scope3Kg?: number;
  energyKwh?: number;
  renewablePercent?: number;
  carbonAccounting?: "location-based" | "market-based";
  [key: string]: unknown;
}

export interface WatershedConfig {
  provider: string;
  methodologyUri: string;
  reportingPeriod?: string;
  apiUrl?: string;
  apiKey?: string;
  /** Path to the footprint resource on the API. */
  footprintPath?: string;
  carbonUnit?: CarbonUnit;
  measurementMethod?: string;
  fixture?: WatershedFootprint;
}

const PERIOD_RE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/**
 * Watershed periods can be arbitrary labels (e.g. "2026-Q1") that do not fit
 * the draft's YYYY[-MM[-DD]] shapes; require an explicit config override
 * rather than publishing a malformed period.
 */
function resolvePeriod(configured?: string, upstream?: string): string {
  const candidate = configured ?? upstream ?? "";
  if (!PERIOD_RE.test(candidate)) {
    throw new Error(
      `watershedAdapter: upstream reportingPeriod "${upstream ?? ""}" is not YYYY, YYYY-MM, ` +
        `or YYYY-MM-DD — set config.reportingPeriod explicitly`,
    );
  }
  return candidate;
}

export function watershedAdapter(config: WatershedConfig): SourceAdapter {
  const carbonUnit = config.carbonUnit ?? "kgCO2e";

  return {
    name: "watershed",
    capabilities: "extended",
    async fetch(): Promise<RawMetrics> {
      let fp: WatershedFootprint;
      if (config.fixture) {
        fp = config.fixture;
      } else {
        if (!config.apiUrl || !config.apiKey) {
          throw new Error("watershedAdapter: apiUrl+apiKey or fixture required");
        }
        const path = config.footprintPath ?? "/api/v1/footprint";
        const url = `${config.apiUrl.replace(/\/$/, "")}${path}`;
        fp = (await fetchJson(url, {
          headers: { Authorization: `Bearer ${config.apiKey}` },
        })) as WatershedFootprint;
      }

      const total =
        fp.totalEmissionsKgCo2e ??
        (fp.scope1Kg ?? 0) + (fp.scope2Kg ?? 0) + (fp.scope3Kg ?? 0);
      if (fp.energyKwh === undefined) {
        throw new Error("watershedAdapter: footprint missing energyKwh");
      }

      const raw: RawMetrics = {
        provider: config.provider,
        measurementMethod: config.measurementMethod ?? "third-party-modeled",
        methodologyUri: config.methodologyUri,
        reportingPeriod: resolvePeriod(config.reportingPeriod, fp.reportingPeriod),
        energy: { value: fp.energyKwh, unit: "kWh" },
        carbon: { value: total, unit: carbonUnit },
        capabilities: "extended",
      };
      if (fp.scope1Kg !== undefined) raw.scope1 = fp.scope1Kg;
      if (fp.scope2Kg !== undefined) raw.scope2 = fp.scope2Kg;
      if (fp.scope3Kg !== undefined) raw.scope3 = fp.scope3Kg;
      if (fp.renewablePercent !== undefined) raw.renewableEnergy = fp.renewablePercent;
      if (fp.carbonAccounting) raw.carbonAccounting = fp.carbonAccounting;
      return raw;
    },
  };
}
