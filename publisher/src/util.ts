/** Shared helpers for adapters. */
import { readFileSync } from "node:fs";
import { CarbonUnit, EnergyUnit, RawMetrics, SustainabilityMetrics } from "./types";

/** Minimal JSON fetch over the global `fetch` (Node 18+/22). */
export async function fetchJson(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<any> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url} ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Read and parse a JSON file. */
export function readJson<T = any>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

/**
 * Convert an already wire-shaped {@link SustainabilityMetrics} object back into
 * {@link RawMetrics} so existing `/.well-known/sustainability` files (or example
 * payloads) can be re-ingested and re-validated by the gateway.
 */
/** Wire-format keys handled explicitly by {@link fromWire}. */
const WIRE_KEYS = new Set([
  "version",
  "updated",
  "capabilities",
  "provider",
  "measurement-method",
  "methodology-uri",
  "reporting-period",
  "target",
  "energy-consumption",
  "energy-unit",
  "carbon-footprint",
  "carbon-unit",
  "carbon-accounting",
  "scope-1",
  "scope-2",
  "scope-3",
  "sci-score",
  "functional-unit",
  "carbon-intensity-gCO2e-per-kWh",
  "estimated-annual-emissions-kgCO2e",
  "renewable-energy",
  "verifiable-attestation-uri",
  "disclosure-uri",
]);

export function fromWire(m: SustainabilityMetrics): RawMetrics {
  const raw: RawMetrics = {
    provider: m.provider,
    measurementMethod: m["measurement-method"],
    methodologyUri: m["methodology-uri"],
    reportingPeriod: m["reporting-period"],
    capabilities: m.capabilities,
    updated: m.updated,
  };
  // Energy/carbon are optional since -03: only re-ingest members actually
  // present (a `{ value: undefined }` would poison normalize with NaN). When
  // the value is present without its unit, the draft's defaults apply.
  if (m["energy-consumption"] !== undefined) {
    raw.energy = {
      value: Number(m["energy-consumption"]),
      unit: (m["energy-unit"] ?? "kWh") as EnergyUnit,
    };
  }
  if (m["carbon-footprint"] !== undefined) {
    raw.carbon = {
      value: Number(m["carbon-footprint"]),
      unit: (m["carbon-unit"] ?? "gCO2e") as CarbonUnit,
    };
  }
  if (m.target !== undefined) raw.target = String(m.target);
  if (m["carbon-accounting"] !== undefined) raw.carbonAccounting = m["carbon-accounting"] as any;
  if (m["scope-1"] !== undefined) raw.scope1 = Number(m["scope-1"]);
  if (m["scope-2"] !== undefined) raw.scope2 = Number(m["scope-2"]);
  if (m["scope-3"] !== undefined) raw.scope3 = Number(m["scope-3"]);
  if (m["sci-score"] !== undefined) raw.sciScore = Number(m["sci-score"]);
  if (m["functional-unit"] !== undefined) raw.functionalUnit = String(m["functional-unit"]);
  if (m["carbon-intensity-gCO2e-per-kWh"] !== undefined) {
    raw.carbonIntensity = Number(m["carbon-intensity-gCO2e-per-kWh"]);
  }
  if (m["renewable-energy"] !== undefined) raw.renewableEnergy = Number(m["renewable-energy"]);
  if (m["estimated-annual-emissions-kgCO2e"] !== undefined) {
    raw.estimatedAnnualEmissionsKg = Number(m["estimated-annual-emissions-kgCO2e"]);
  }
  if (m["verifiable-attestation-uri"] !== undefined) {
    raw.verifiableAttestationUri = String(m["verifiable-attestation-uri"]);
  }
  if (m["disclosure-uri"] !== undefined) raw.disclosureUri = String(m["disclosure-uri"]);

  // Vendor extensions / unknown members survive re-ingestion (clients MUST
  // ignore unknown fields; the gateway preserves them through normalize).
  for (const [k, v] of Object.entries(m)) {
    if (!WIRE_KEYS.has(k)) {
      (raw.extra ??= {})[k] = v;
    }
  }
  return raw;
}

/** Most recently completed full calendar month, "YYYY-MM" (draft Basic default). */
export function lastFullMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
