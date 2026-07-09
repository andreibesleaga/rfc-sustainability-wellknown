/**
 * Microsoft Cloud for Sustainability adapter.
 *
 * Reads Azure/M365 emissions from the Sustainability OData v4 REST API, following
 * cursor-based pagination (`@odata.nextLink` carrying `$skiptoken`). Aggregates
 * the returned records into a single period total.
 *
 * Endpoints: /m365/tenantemissions, /enrollments/{enrollmentId}/emissions
 * Docs: https://learn.microsoft.com/en-us/rest/api/industry/sustainability/
 *
 * Live mode: baseUrl + accessToken. Replay mode: one or more recorded OData pages
 * as `fixturePages` (the adapter walks them as if following nextLink).
 */
import { CarbonUnit, RawMetrics, SourceAdapter } from "../../types";
import { fetchJson } from "../../util";

export interface ODataPage {
  value: Array<Record<string, any>>;
  "@odata.nextLink"?: string;
}

export interface MsSustainabilityConfig {
  provider: string;
  methodologyUri: string;
  reportingPeriod: string;
  baseUrl?: string;
  accessToken?: string;
  /** e.g. "m365/tenantemissions" or "enrollments/{id}/emissions". */
  endpoint?: string;
  /** Field holding the emissions value on each record. */
  emissionsField?: string;
  /** Optional energy field; if absent, energy must be provided via energyKwh. */
  energyField?: string;
  /** Fallback energy if records have no energy field. */
  energyKwh?: number;
  /** Microsoft reports carbon in metric tonnes by default. */
  carbonUnit?: CarbonUnit;
  measurementMethod?: string;
  /** Replay mode: recorded OData pages, walked in order. */
  fixturePages?: ODataPage[];
}

// Both call sites invoke num() only for a field that is present (!== undefined),
// so a present-but-non-numeric value (e.g. "N/A", null) is genuine bad upstream
// data. Coercing it silently to 0 would publish a fabricated measurement — the
// same silent-zero footgun the watershed/salesforce adapters guard against — so
// fail loud instead.
function num(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`msSustainabilityAdapter: expected a numeric value, got ${JSON.stringify(v)}`);
  }
  return n;
}

export function msSustainabilityAdapter(config: MsSustainabilityConfig): SourceAdapter {
  const emissionsField = config.emissionsField ?? "totalEmissions";
  const carbonUnit = config.carbonUnit ?? "mtCO2e";

  return {
    name: "ms-sustainability",
    capabilities: "extended",
    async fetch(): Promise<RawMetrics> {
      const pages: ODataPage[] = [];

      if (config.fixturePages) {
        pages.push(...config.fixturePages);
      } else {
        if (!config.baseUrl || !config.accessToken) {
          throw new Error("msSustainabilityAdapter: baseUrl+accessToken or fixturePages required");
        }
        const endpoint = config.endpoint ?? "m365/tenantemissions";
        const base = config.baseUrl.replace(/\/$/, "");
        const baseOrigin = new URL(base).origin;
        let next: string | undefined = `${base}/${endpoint}`;
        let guard = 0;
        while (next) {
          if (guard >= 1000) {
            throw new Error(
              "msSustainabilityAdapter: pagination exceeded 1000 pages — refusing to truncate silently",
            );
          }
          // The Bearer token must never follow a cross-origin nextLink.
          if (new URL(next, base).origin !== baseOrigin) {
            throw new Error(
              `msSustainabilityAdapter: @odata.nextLink points off-origin (${next}) — aborting`,
            );
          }
          const page: ODataPage = (await fetchJson(next, {
            headers: { Authorization: `Bearer ${config.accessToken}` },
          })) as ODataPage;
          pages.push(page);
          next = page["@odata.nextLink"]; // cursor with $skiptoken
          guard += 1;
        }
      }

      let carbon = 0;
      let energy = 0;
      let energyFound = false;
      let emissionsFound = false;
      for (const page of pages) {
        for (const rec of page.value ?? []) {
          if (rec[emissionsField] !== undefined) {
            carbon += num(rec[emissionsField]);
            emissionsFound = true;
          }
          if (config.energyField && rec[config.energyField] !== undefined) {
            energy += num(rec[config.energyField]);
            energyFound = true;
          }
        }
      }
      if (!emissionsFound) {
        // A wrong field name must not publish 0 as a real footprint.
        throw new Error(
          `msSustainabilityAdapter: no record carried emissions field "${emissionsField}"`,
        );
      }

      const energyKwh = energyFound ? energy : config.energyKwh;
      if (energyKwh === undefined) {
        throw new Error(
          "msSustainabilityAdapter: no energy in records; set energyField or energyKwh",
        );
      }

      return {
        provider: config.provider,
        measurementMethod: config.measurementMethod ?? "cloud-billing",
        methodologyUri: config.methodologyUri,
        reportingPeriod: config.reportingPeriod,
        energy: { value: energyKwh, unit: "kWh" },
        carbon: { value: carbon, unit: carbonUnit },
        scope3: carbon, // tenant/cloud usage emissions are Scope 3 to the customer
        capabilities: "extended",
      };
    },
  };
}
