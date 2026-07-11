/**
 * carbon.txt API adapter (Green Web Foundation hosted validator API).
 *
 * Populates the well-known fields from a remote carbon.txt accessed via the GWF
 * hosted API: POST {apiUrl}/validate/{domain|url|file} with an `X-Api-Key` header.
 * The API returns *parsed disclosures* (links to evidence) and upstream services,
 * NOT energy/carbon numbers. So this adapter maps the disclosure data it can
 * (`disclosure-uri`, `methodology-uri`, `verifiable-attestation-uri`, provider)
 * and **composes** the mandatory metrics from one of:
 *   - explicit `energy` + (`carbon` or `gridIntensity`) in config, or
 *   - a `compute` (CO2.js) sub-config (bytes → carbon), or
 *   - emissions extracted by the API into `document_data` (best-effort).
 * If none resolve, it throws — since -03 a document MAY omit energy/carbon,
 * but this adapter exists to publish numbers, so it deliberately fails loudly
 * rather than emit a metrics-free document from a metrics-oriented config.
 *
 * Replay mode (`fixture`) makes it fully offline/deterministic for tests.
 *
 * Docs: https://developers.thegreenwebfoundation.org/api/carbon-txt/overview
 */
import { CarbonTxtDisclosure } from "../carbontxt";
import { CarbonUnit, EnergyUnit, RawMetrics, SourceAdapter } from "../types";
import { fetchJson, lastFullMonth } from "../util";
import { Co2jsConfig, co2jsAdapter } from "./co2js";

export interface CarbonTxtApiResponse {
  success: boolean;
  url?: string;
  data?: {
    version?: string;
    last_updated?: string;
    upstream?: { services?: Array<Record<string, unknown>> };
    org?: { disclosures?: CarbonTxtDisclosure[] };
  };
  document_data?: Record<string, unknown>;
  delegation_method?: string;
  errors?: Array<{ type?: string; msg?: string; loc?: unknown; [k: string]: unknown }>;
  logs?: string[];
  [k: string]: unknown;
}

export interface CarbonTxtApiConfig {
  provider: string;
  /** Methodology link; if omitted, derived from disclosures or the carbon.txt URL. */
  methodologyUri?: string;
  reportingPeriod?: string;

  /** Lookup target — exactly one of domain / url / text. */
  domain?: string;
  url?: string;
  text?: string;

  apiKey?: string; // X-Api-Key, or GWF_API_KEY env
  apiUrl?: string; // default https://carbon-txt-api.greenweb.org/api
  /** Replay mode: a recorded API response. */
  fixture?: CarbonTxtApiResponse;

  // --- metric composition (carbon.txt itself carries no metrics) ---
  energy?: { value: number; unit: EnergyUnit };
  carbon?: { value: number; unit: CarbonUnit };
  gridIntensity?: number;
  /** Optional CO2.js sub-computation (bytes → carbon) to supply the metrics. */
  compute?: Omit<Co2jsConfig, "provider" | "methodologyUri" | "reportingPeriod" | "disclosureUri">;

  measurementMethod?: string;
  capabilities?: "basic" | "extended";
}

const DOC_TYPE_METHODOLOGY = ["sustainability-page", "web-page", "csrd-report", "annual-report"];
const DOC_TYPE_ATTESTATION = ["certificate", "csrd-report", "annual-report"];

function pickDisclosure(
  disclosures: CarbonTxtDisclosure[],
  preferred: string[],
): CarbonTxtDisclosure | undefined {
  for (const t of preferred) {
    const hit = disclosures.find((d) => d.doc_type === t && d.url);
    if (hit) return hit;
  }
  return disclosures.find((d) => !!d.url);
}

/** Best-effort: pull energy/carbon out of the API's extracted `document_data`. */
export function extractMetricsFromDocumentData(
  dd: Record<string, unknown> | undefined,
): { energy?: { value: number; unit: EnergyUnit }; carbon?: { value: number; unit: CarbonUnit } } {
  if (!dd) return {};
  const out: { energy?: { value: number; unit: EnergyUnit }; carbon?: { value: number; unit: CarbonUnit } } = {};
  const energyKwh = Number((dd as any).energy_kwh ?? (dd as any).energyKwh);
  if (Number.isFinite(energyKwh)) out.energy = { value: energyKwh, unit: "kWh" };
  const carbonG = Number((dd as any).carbon_gco2e ?? (dd as any).carbonGco2e);
  if (Number.isFinite(carbonG)) out.carbon = { value: carbonG, unit: "gCO2e" };
  return out;
}

async function callApi(config: CarbonTxtApiConfig): Promise<CarbonTxtApiResponse> {
  if (config.fixture) return config.fixture;
  const apiKey = config.apiKey ?? process.env.GWF_API_KEY;
  if (!apiKey) throw new Error("carbonTxtApiAdapter: apiKey/GWF_API_KEY or fixture required");
  const base = (config.apiUrl ?? "https://carbon-txt-api.greenweb.org/api").replace(/\/$/, "");

  let path: string;
  let body: Record<string, string>;
  if (config.domain) {
    path = "/validate/domain";
    body = { domain: config.domain };
  } else if (config.url) {
    path = "/validate/url";
    body = { url: config.url };
  } else if (config.text) {
    path = "/validate/file";
    body = { text_contents: config.text };
  } else {
    throw new Error("carbonTxtApiAdapter: one of domain / url / text is required");
  }

  return (await fetchJson(`${base}${path}`, {
    method: "POST",
    headers: { "X-Api-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as CarbonTxtApiResponse;
}

export function carbonTxtApiAdapter(config: CarbonTxtApiConfig): SourceAdapter {
  return {
    name: "carbontxt-api",
    capabilities: config.capabilities ?? "basic",
    async fetch(): Promise<RawMetrics> {
      const resp = await callApi(config);

      if (!resp.success) {
        const msg = (resp.errors ?? []).map((e) => e.msg ?? e.type ?? "error").join("; ");
        throw new Error(`carbonTxtApiAdapter: carbon.txt validation failed: ${msg || "unknown error"}`);
      }

      const disclosures = resp.data?.org?.disclosures ?? [];
      const disclosureUri =
        resp.url ?? config.url ?? (config.domain ? `https://${config.domain}/carbon.txt` : undefined);

      const methodologyUri =
        config.methodologyUri ??
        pickDisclosure(disclosures, DOC_TYPE_METHODOLOGY)?.url ??
        disclosureUri;
      if (!methodologyUri) {
        throw new Error("carbonTxtApiAdapter: could not determine methodology-uri (no disclosures)");
      }
      const attestation = pickDisclosure(disclosures, DOC_TYPE_ATTESTATION)?.url;

      // --- compose the mandatory metrics ---
      let base: RawMetrics;
      const extracted = extractMetricsFromDocumentData(resp.document_data);

      if (config.energy && (config.carbon || typeof config.gridIntensity === "number")) {
        base = {
          provider: config.provider,
          measurementMethod: config.measurementMethod ?? "third-party-modeled",
          methodologyUri,
          reportingPeriod: config.reportingPeriod ?? lastFullMonth(),
          energy: config.energy,
          ...(config.carbon ? { carbon: config.carbon } : {}),
          ...(typeof config.gridIntensity === "number" ? { carbonIntensity: config.gridIntensity } : {}),
          capabilities: config.capabilities ?? "basic",
        };
      } else if (extracted.energy && extracted.carbon) {
        base = {
          provider: config.provider,
          measurementMethod: config.measurementMethod ?? "third-party-modeled",
          methodologyUri,
          reportingPeriod: config.reportingPeriod ?? lastFullMonth(),
          energy: extracted.energy,
          carbon: extracted.carbon,
          capabilities: config.capabilities ?? "basic",
        };
      } else if (config.compute) {
        base = (await co2jsAdapter({
          ...config.compute,
          provider: config.provider,
          methodologyUri,
          reportingPeriod: config.reportingPeriod,
        }).fetch({})) as RawMetrics;
      } else {
        throw new Error(
          "carbonTxtApiAdapter: carbon.txt provides disclosures, not metrics — supply " +
            "energy + (carbon or gridIntensity), or a `compute` CO2.js config.",
        );
      }

      base.disclosureUri = disclosureUri;
      if (attestation && base.verifiableAttestationUri === undefined) {
        base.verifiableAttestationUri = attestation;
      }
      return base;
    },
  };
}
