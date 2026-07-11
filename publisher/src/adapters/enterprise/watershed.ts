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
import { PERIOD_RE } from "../../normalize";
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
  /**
   * Unit the upstream values are declared in (default kgCO2e, matching the
   * fixture field names like totalEmissionsKgCo2e). NOTE: setting this
   * REINTERPRETS the raw values under the new unit — it does not convert
   * them; only use it when your Watershed export genuinely reports in a
   * different unit despite the field naming.
   */
  carbonUnit?: CarbonUnit;
  measurementMethod?: string;
  fixture?: WatershedFootprint;
  /** Declared service level; "basic" unless the deployment honors Extended query parameters. */
  capabilities?: "basic" | "extended";
}

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
    capabilities: config.capabilities ?? "basic",
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

      // Track whether any carbon figure was actually present. If neither the
      // aggregate nor any scope field is supplied, the sum silently collapses
      // to 0 and would be published as a real carbon-footprint of 0 — mirror
      // the emissionsFound guard in ms-sustainability.ts and fail loudly.
      const carbonFound =
        fp.totalEmissionsKgCo2e !== undefined ||
        fp.scope1Kg !== undefined ||
        fp.scope2Kg !== undefined ||
        fp.scope3Kg !== undefined;
      if (!carbonFound) {
        throw new Error(
          "watershedAdapter: footprint carries no carbon data (totalEmissionsKgCo2e/scope1Kg/scope2Kg/scope3Kg all missing) — refusing to publish a fabricated 0",
        );
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
        capabilities: config.capabilities ?? "basic",
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
