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
export function fromWire(m: SustainabilityMetrics): RawMetrics {
  const raw: RawMetrics = {
    provider: m.provider,
    measurementMethod: m["measurement-method"],
    methodologyUri: m["methodology-uri"],
    reportingPeriod: m["reporting-period"],
    energy: { value: m["energy-consumption"], unit: m["energy-unit"] as EnergyUnit },
    carbon: { value: m["carbon-footprint"], unit: m["carbon-unit"] as CarbonUnit },
    capabilities: m.capabilities,
    updated: m.updated,
  };
  if (m["target-path"] !== undefined) raw.targetPath = String(m["target-path"]);
  if (m["carbon-accounting"] !== undefined) raw.carbonAccounting = m["carbon-accounting"] as any;
  if (m["scope-1"] !== undefined) raw.scope1 = Number(m["scope-1"]);
  if (m["scope-2"] !== undefined) raw.scope2 = Number(m["scope-2"]);
  if (m["scope-3"] !== undefined) raw.scope3 = Number(m["scope-3"]);
  if (m["sci-score"] !== undefined) raw.sciScore = Number(m["sci-score"]);
  if (m["functional-unit"] !== undefined) raw.functionalUnit = String(m["functional-unit"]);
  if (m["renewable-energy"] !== undefined) raw.renewableEnergy = Number(m["renewable-energy"]);
  if (m["estimated-annual-emissions-kgCO2"] !== undefined) {
    raw.estimatedAnnualEmissionsKg = Number(m["estimated-annual-emissions-kgCO2"]);
  }
  if (m["verifiable-attestation-uri"] !== undefined) {
    raw.verifiableAttestationUri = String(m["verifiable-attestation-uri"]);
  }
  if (m["disclosure-uri"] !== undefined) raw.disclosureUri = String(m["disclosure-uri"]);
  return raw;
}

/** Most recently completed full calendar month, "YYYY-MM" (draft Basic default). */
export function lastFullMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
