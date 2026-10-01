/**
 * Adapter for DIST, the Green Web Foundation's Digital Impacts Schema and
 * Taxonomy (v0.0.1): from an organization's `dist.json` to one
 * sustainability-data declaration.
 *
 * A DIST file lists carbon impacts by category for one reporting period and
 * states no total. The adapter adds the entries up, under rules that are
 * deliberately strict, because a mechanical sum of a hand-maintained file is
 * exactly where a wrong figure would come from:
 *
 *  - the period must be one whole calendar year (the only period this
 *    registry's Basic documents carry), otherwise the adapter refuses;
 *  - every entry with a value must be in kgCO2e, otherwise it refuses;
 *  - an entry repeated with the same categories, value and unit is counted
 *    ONCE, and the number of such repeats is reported;
 *  - an entry whose value is null ("not estimated") adds nothing, and the
 *    number of such entries is reported.
 *
 * GHG Protocol scopes, an accounting basis and energy are not part of DIST and
 * are never derived.
 */
import type { RawMetrics, SourceAdapter } from "sustainability-wellknown-publisher";

export interface DistCarbonEntry {
  categories?: string[];
  value?: number | null;
  unit?: string;
}

export interface DistDocument {
  organization?: { name?: string };
  report?: {
    reporting_period?: { from?: string; to?: string };
    verification?: string;
    impacts?: { carbon?: DistCarbonEntry[] };
  };
}

export interface DistSummary {
  organization: string;
  year: string;
  kgCO2e: number;
  entries: number;
  duplicates: number;
  withoutValue: number;
}

/** Sum a DIST document under the rules in the module comment. Throws rather than guess. */
export function summarizeDist(doc: DistDocument): DistSummary {
  const organization = doc?.organization?.name;
  if (typeof organization !== "string" || organization.length === 0) throw new Error("dist: organization.name is missing");
  const from = doc.report?.reporting_period?.from;
  const to = doc.report?.reporting_period?.to;
  const m = typeof from === "string" ? /^(\d{4})-01-01$/.exec(from) : null;
  if (!m || to !== `${m[1]}-12-31`) {
    throw new Error(`dist: the reporting period (${from} to ${to}) is not one whole calendar year`);
  }
  const carbon = doc.report?.impacts?.carbon;
  if (!Array.isArray(carbon) || carbon.length === 0) throw new Error("dist: report.impacts.carbon is missing or empty");
  const seen = new Set<string>();
  let kg = 0, duplicates = 0, withoutValue = 0;
  for (const e of carbon) {
    if (e.value === null || e.value === undefined) { withoutValue++; continue; }
    if (typeof e.value !== "number" || !Number.isFinite(e.value) || e.value < 0) throw new Error("dist: a carbon entry has a value that is not a non-negative number");
    if (e.unit !== "kgCO2e") throw new Error(`dist: a carbon entry is in "${e.unit}", not kgCO2e`);
    const key = JSON.stringify([[...(e.categories ?? [])].sort(), e.value, e.unit]);
    if (seen.has(key)) { duplicates++; continue; }
    seen.add(key);
    kg += e.value;
  }
  return { organization, year: m[1], kgCO2e: kg, entries: carbon.length, duplicates, withoutValue };
}

export interface DistAdapterConfig {
  /** The DIST document, already parsed. */
  document: DistDocument;
  /** Where it was read from; becomes `methodology-uri`. */
  sourceUrl: string;
  /** Text placed before the generated account of what was summed. */
  providerPrefix: string;
  updated?: string;
}

export function distAdapter(config: DistAdapterConfig): SourceAdapter {
  return {
    name: "dist",
    capabilities: "basic",
    async fetch(): Promise<RawMetrics> {
      const s = summarizeDist(config.document);
      const raw: RawMetrics = {
        provider:
          config.providerPrefix +
          ` Summed here: ${s.entries} carbon entries of the file` +
          (s.duplicates ? `, ${s.duplicates} repeated entr${s.duplicates === 1 ? "y" : "ies"} counted once` : "") +
          (s.withoutValue ? `, ${s.withoutValue} without a value adding nothing` : "") +
          ". The file states no total; GHG Protocol scopes, an accounting basis and energy are not part of DIST and are not derived.",
        measurementMethod: "hardware-estimated",
        methodologyUri: config.sourceUrl,
        reportingPeriod: s.year,
        carbon: { value: s.kgCO2e, unit: "kgCO2e" },
        target: `${s.organization} (digital estate, DIST relay)`,
        targetType: "organization",
        capabilities: "basic",
      };
      if (config.updated !== undefined) raw.updated = config.updated;
      return raw;
    },
  };
}

/* ------------------------------------------------------------------------- *
 * The demonstration: the Green Web Foundation's own published file
 * ------------------------------------------------------------------------- */

export const GWF_DIST_URL = "https://www.thegreenwebfoundation.org/.well-known/dist.json";
export const GWF_DIST_RETRIEVED = "2026-10-01";
const MAX_DIST_BYTES = 256 * 1024;

/**
 * The carbon entries of the Green Web Foundation's dist.json as retrieved on
 * 2026-10-01 (categories, values and units only; the file's notes are not
 * reproduced). Green Web Foundation website content is published under
 * CC BY 4.0 (https://www.thegreenwebfoundation.org/how-to-cite-our-work/).
 * The repeated employee-hardware entry is in the file as retrieved.
 */
export const GWF_DIST_FIXTURE: DistDocument = {
  organization: { name: "Green Web Foundation" },
  report: {
    reporting_period: { from: "2023-01-01", to: "2023-12-31" },
    verification: "self_reported",
    impacts: {
      carbon: [
        { categories: ["upstream:employee_hardware"], value: 186, unit: "kgCO2e" },
        { categories: ["upstream:employee_hardware"], value: 186, unit: "kgCO2e" },
        { categories: ["upstream:network_hardware"], value: 0, unit: "kgCO2e" },
        { categories: ["upstream:server_and_storage_hardware"], value: 0, unit: "kgCO2e" },
        { categories: ["operational:direct:employee_devices"], value: 116, unit: "kgCO2e" },
        { categories: ["operational:direct:networking"], value: 40, unit: "kgCO2e" },
        { categories: ["operational:direct:servers_and_storage"], value: 0, unit: "kgCO2e" },
        { categories: ["operational:direct:generators", "operational:indirect:cloud_services"], value: 0, unit: "kgCO2e" },
        { categories: ["operational:indirect:cloud_services"], value: 27, unit: "kgCO2e" },
        { categories: ["operational:indirect:saas"], value: null, unit: "kgCO2e" },
        { categories: ["operational:indirect:managed_services"], value: 0, unit: "kgCO2e" },
        { categories: ["downstream:end_user_devices"], value: 117, unit: "kgCO2e" },
        { categories: ["downstream:network_data_transfer"], value: 10, unit: "kgCO2e" },
      ],
    },
  },
};

const ATTRIBUTION =
  "Source: the Green Web Foundation (https://www.thegreenwebfoundation.org/), whose website content is " +
  "published under CC BY 4.0; the figures are its own, self-reported, and were extracted and reformatted. " +
  "Not published, reviewed or endorsed by the Green Web Foundation.";

/** Fetch and parse the live file; the caller's timeout bounds the call. */
export async function fetchGwfDist(fetchImpl: typeof fetch): Promise<DistDocument> {
  const res = await fetchImpl(GWF_DIST_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`dist: ${GWF_DIST_URL} returned HTTP ${res.status}`);
  const text = await res.text();
  if (text.length > MAX_DIST_BYTES) throw new Error("dist: the file is larger than expected");
  const doc = JSON.parse(text) as DistDocument;
  summarizeDist(doc); // refuse a file the rules cannot sum, so the fixture is served instead
  return doc;
}

export function distLiveAdapter(doc: DistDocument, updated: string): SourceAdapter {
  return distAdapter({
    document: doc,
    sourceUrl: GWF_DIST_URL,
    providerPrefix:
      "Demonstration by the gateway operator of an adapter for DIST (Digital Impacts Schema and Taxonomy, " +
      `v0.0.1), LIVE: the file at ${GWF_DIST_URL} is fetched daily and summed as it stands, without ` +
      "anyone reviewing a change to it. " + ATTRIBUTION,
    updated,
  });
}

export function distReplayAdapter(): SourceAdapter {
  return distAdapter({
    document: GWF_DIST_FIXTURE,
    sourceUrl: GWF_DIST_URL,
    providerPrefix:
      "Demonstration by the gateway operator of an adapter for DIST (Digital Impacts Schema and Taxonomy, " +
      `v0.0.1), in REPLAY mode: a recorded copy of the carbon entries of ${GWF_DIST_URL}, retrieved ` +
      `${GWF_DIST_RETRIEVED}. ` + ATTRIBUTION,
    updated: `${GWF_DIST_RETRIEVED}T00:00:00Z`,
  });
}
