/**
 * Salesforce Net Zero Cloud adapter.
 *
 * Reads emissions/energy from Net Zero Cloud Standard Objects via the REST query
 * API (SOQL). Net Zero Cloud reports emissions in metric tonnes (mtCO2e) and
 * energy on the AnnualEmssnInventory / EmissionsForecastFact objects.
 *
 * Live mode: pass instanceUrl + accessToken (OAuth bearer). Replay mode: pass a
 * recorded SOQL query response as `fixture`.
 *
 * Docs: https://developer.salesforce.com/docs/atlas.en-us.netzero_cloud_dev_guide.meta/
 */
import { CarbonUnit, EnergyUnit, RawMetrics, SourceAdapter } from "../../types";
import { fetchJson } from "../../util";

export interface SoqlResponse {
  totalSize: number;
  done: boolean;
  records: Array<Record<string, any>>;
}

export interface SalesforceFieldMap {
  scope1: string;
  scope2: string;
  scope3: string;
  carbon: string;
  energy: string;
  period: string;
}

const DEFAULT_FIELD_MAP: SalesforceFieldMap = {
  scope1: "TotalScope1Emissions",
  scope2: "TotalScope2MktEmissions",
  scope3: "TotalScope3Emissions",
  carbon: "TotalEmissions",
  energy: "ActualEnergyConsumption",
  period: "Year",
};

export interface SalesforceNzcConfig {
  provider: string;
  methodologyUri: string;
  instanceUrl?: string;
  accessToken?: string;
  /** SOQL to run; default selects core fields from AnnualEmssnInventory. */
  soql?: string;
  apiVersion?: string; // default v59.0
  /** Net Zero Cloud energy is typically reported in MWh. */
  energyUnit?: EnergyUnit;
  /** Net Zero Cloud carbon is in metric tonnes. */
  carbonUnit?: CarbonUnit;
  fieldMap?: Partial<SalesforceFieldMap>;
  measurementMethod?: string;
  fixture?: SoqlResponse;
  /** Declared service level; "basic" unless the deployment honors Extended query parameters. */
  capabilities?: "basic" | "extended";
}

function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function salesforceNzcAdapter(config: SalesforceNzcConfig): SourceAdapter {
  const fm = { ...DEFAULT_FIELD_MAP, ...config.fieldMap };
  const energyUnit = config.energyUnit ?? "MWh";
  const carbonUnit = config.carbonUnit ?? "mtCO2e";
  const soql =
    config.soql ??
    `SELECT ${fm.period}, ${fm.scope1}, ${fm.scope2}, ${fm.scope3}, ${fm.carbon}, ${fm.energy} FROM AnnualEmssnInventory ORDER BY ${fm.period} DESC LIMIT 1`;

  return {
    name: "salesforce-nzc",
    capabilities: config.capabilities ?? "basic",
    async fetch(): Promise<RawMetrics | RawMetrics[]> {
      let resp: SoqlResponse;
      if (config.fixture) {
        resp = config.fixture;
      } else {
        if (!config.instanceUrl || !config.accessToken) {
          throw new Error("salesforceNzcAdapter: instanceUrl+accessToken or fixture required");
        }
        const api = config.apiVersion ?? "v59.0";
        const url = `${config.instanceUrl.replace(/\/$/, "")}/services/data/${api}/query?q=${encodeURIComponent(soql)}`;
        resp = (await fetchJson(url, {
          headers: { Authorization: `Bearer ${config.accessToken}` },
        })) as SoqlResponse;
      }

      const mapRecord = (rec: Record<string, any>): RawMetrics => {
        const scope1 = num(rec[fm.scope1]);
        const scope2 = num(rec[fm.scope2]);
        const scope3 = num(rec[fm.scope3]);
        const carbonField = num(rec[fm.carbon]);
        // If neither the aggregate carbon field nor any scope field is present,
        // the sum silently collapses to 0 and would be published as a real
        // carbon-footprint of 0. Fail loudly instead (mirrors the
        // emissionsFound guard in ms-sustainability.ts).
        if (
          carbonField === undefined &&
          scope1 === undefined &&
          scope2 === undefined &&
          scope3 === undefined
        ) {
          throw new Error(
            `salesforceNzcAdapter: record carries no carbon data (fields "${fm.carbon}", "${fm.scope1}", "${fm.scope2}", "${fm.scope3}" all missing/empty) — refusing to publish a fabricated 0`,
          );
        }
        const carbonTotal =
          carbonField ?? (scope1 ?? 0) + (scope2 ?? 0) + (scope3 ?? 0);
        const energy = num(rec[fm.energy]);
        if (energy === undefined) {
          throw new Error(
            `salesforceNzcAdapter: energy field "${fm.energy}" missing/empty in record`,
          );
        }
        const yr = String(rec[fm.period] ?? "");
        if (!/^\d{4}$/.test(yr)) {
          // Never mislabel data with a guessed period: a missing/malformed
          // inventory year is an upstream data problem, not the current year.
          throw new Error(
            `salesforceNzcAdapter: period field "${fm.period}" missing or not a year (got "${yr}")`,
          );
        }
        return {
          provider: config.provider,
          measurementMethod: config.measurementMethod ?? "third-party-modeled",
          methodologyUri: config.methodologyUri,
          reportingPeriod: yr,
          energy: { value: energy, unit: energyUnit },
          carbon: { value: carbonTotal, unit: carbonUnit },
          carbonAccounting: "market-based",
          scope1,
          scope2,
          scope3,
          capabilities: config.capabilities ?? "basic",
        };
      };

      const records = resp.records ?? [];
      if (records.length === 0) return [];
      return records.length === 1 ? mapRecord(records[0]) : records.map(mapRecord);
    },
  };
}
