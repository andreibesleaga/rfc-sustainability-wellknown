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
  // Historical ("1.0"/"1.1") member names, re-ingested via the draft's
  // field-driven compatibility rules rather than passed through as vendor
  // extensions (Versioning and Extensibility).
  "target-path",
  "carbon-intensity-gCO2-per-kWh",
  "estimated-annual-emissions-kgCO2",
]);

/**
 * Re-ingest value policy (one rule per class, applied consistently):
 *  - A NON-NUMBER in a present numeric member is a corrupt file — fail loud
 *    (never silently drop a typo'd metric).
 *  - A NEGATIVE value in a non-negative member is the historical "not
 *    reported" sentinel and is dropped (draft §Versioning compatibility rule).
 *  - An OUT-OF-RANGE value (renewable-energy > 100) is likewise treated as
 *    not reported and dropped (draft §Value Constraints, client leniency).
 *  - scope-1/2/3 MAY legitimately be negative and are numeric-checked only.
 */
function numOrThrow(v: unknown, member: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`fromWire: ${member} is not a finite number (${JSON.stringify(v)})`);
  }
  return v;
}
const isReported = (v: unknown, member: string): boolean => {
  const n = numOrThrow(v, member);
  if (n < 0) return false; // historical sentinel -> not reported
  if (member === "renewable-energy" && n > 100) return false; // out of range
  return true;
};

export function fromWire(m: SustainabilityMetrics): RawMetrics {
  const raw: RawMetrics = {
    provider: m.provider,
    measurementMethod: m["measurement-method"],
    methodologyUri: m["methodology-uri"],
    reportingPeriod: m["reporting-period"],
    capabilities: m.capabilities,
    updated: m.updated,
  };
  const legacy = m as Record<string, unknown>;
  // Energy/carbon are optional since -03: only re-ingest members actually
  // present (a `{ value: undefined }` would poison normalize with NaN). When
  // the value is present without its unit, the draft's defaults apply. A
  // negative value in a non-negative member is the historical sentinel and
  // reads as "not reported" (dropped), per the draft's compatibility rules.
  if (m["energy-consumption"] !== undefined && isReported(m["energy-consumption"], "energy-consumption")) {
    raw.energy = {
      value: Number(m["energy-consumption"]),
      unit: (m["energy-unit"] ?? "kWh") as EnergyUnit,
    };
  }
  if (m["carbon-footprint"] !== undefined && isReported(m["carbon-footprint"], "carbon-footprint")) {
    raw.carbon = {
      value: Number(m["carbon-footprint"]),
      unit: (m["carbon-unit"] ?? "gCO2e") as CarbonUnit,
    };
  } else if (m["carbon-unit"] !== undefined) {
    // A declared carbon-unit without a (reported) carbon-footprint still
    // parameterizes the scope values (draft §Optional Response Fields) —
    // carry it so normalize doesn't reinterpret the scopes as gCO2e.
    raw.carbonUnitHint = m["carbon-unit"] as CarbonUnit;
  }
  // Historical documents conveyed the reporting subject via the optional
  // `target-path` member; map it to `target` (compatibility rule: absence of
  // target-path meant origin-wide — the caller's opts.target covers that).
  if (m.target !== undefined) raw.target = String(m.target);
  else if (legacy["target-path"] !== undefined) raw.target = String(legacy["target-path"]);
  if (m["carbon-accounting"] !== undefined) raw.carbonAccounting = m["carbon-accounting"] as any;
  // Scopes MAY be negative (removals/net accounting) — numeric-check only.
  if (m["scope-1"] !== undefined) raw.scope1 = numOrThrow(m["scope-1"], "scope-1");
  if (m["scope-2"] !== undefined) raw.scope2 = numOrThrow(m["scope-2"], "scope-2");
  if (m["scope-3"] !== undefined) raw.scope3 = numOrThrow(m["scope-3"], "scope-3");
  // A legacy document may carry sci-score without functional-unit (the
  // coupling rule postdates the 1.x era): drop the sci-score on re-ingest
  // rather than letting normalize fail the whole document.
  if (
    m["sci-score"] !== undefined &&
    isReported(m["sci-score"], "sci-score") &&
    m["functional-unit"] !== undefined
  ) {
    raw.sciScore = Number(m["sci-score"]);
  }
  if (m["functional-unit"] !== undefined) raw.functionalUnit = String(m["functional-unit"]);
  const intensity = m["carbon-intensity-gCO2e-per-kWh"] ?? legacy["carbon-intensity-gCO2-per-kWh"];
  if (intensity !== undefined && isReported(intensity, "carbon-intensity-gCO2e-per-kWh")) {
    raw.carbonIntensity = Number(intensity);
  }
  if (m["renewable-energy"] !== undefined && isReported(m["renewable-energy"], "renewable-energy")) {
    raw.renewableEnergy = Number(m["renewable-energy"]);
  }
  const annual = m["estimated-annual-emissions-kgCO2e"] ?? legacy["estimated-annual-emissions-kgCO2"];
  if (annual !== undefined && isReported(annual, "estimated-annual-emissions-kgCO2e")) {
    raw.estimatedAnnualEmissionsKg = Number(annual);
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
