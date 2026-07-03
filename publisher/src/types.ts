/**
 * Canonical types for the `/.well-known/sustainability` data model.
 *
 * These mirror draft-besleaga-sustainability-wellknown (the current revision). Field names use
 * the wire (kebab-case) spelling so a `SustainabilityMetrics` object serializes
 * directly to a conformant payload.
 */

export type Capabilities = "basic" | "extended";
export type EnergyUnit = "Wh" | "kWh" | "MWh" | "GWh";
export type CarbonUnit = "gCO2e" | "kgCO2e" | "mtCO2e";
export type CarbonAccounting = "location-based" | "market-based";

/** A single conformant sustainability metrics object (draft §"Payload Format"). */
export interface SustainabilityMetrics {
  // Mandatory
  version: string;
  updated: string;
  capabilities: Capabilities;
  provider: string;
  "measurement-method": string;
  "methodology-uri": string;
  "reporting-period": string;
  "energy-consumption": number;
  "energy-unit": EnergyUnit;
  "carbon-footprint": number;
  "carbon-unit": CarbonUnit;

  // Optional
  "target-path"?: string;
  "carbon-accounting"?: CarbonAccounting;
  "scope-1"?: number;
  "scope-2"?: number;
  "scope-3"?: number;
  "sci-score"?: number;
  "functional-unit"?: string;
  "carbon-intensity-gCO2-per-kWh"?: number;
  "estimated-annual-emissions-kgCO2"?: number;
  "renewable-energy"?: number;
  "verifiable-attestation-uri"?: string;
  "disclosure-uri"?: string;

  // Forward-compatible: unknown/vendor-namespaced fields are tolerated.
  [key: string]: unknown;
}

/** Either a single object or an array (trend), per the draft root schema. */
export type SustainabilityDocument = SustainabilityMetrics | SustainabilityMetrics[];

/**
 * Loosely-typed metrics emitted by a {@link SourceAdapter}. The normalizer turns
 * this into a strict {@link SustainabilityMetrics}. Adapters supply whatever they
 * have; the normalizer fills units, computes carbon from energy×intensity when
 * carbon is absent, and applies defaults.
 */
export interface RawMetrics {
  provider: string;
  measurementMethod: string;
  methodologyUri: string;
  /** RFC 3339 period: "YYYY", "YYYY-MM", or "YYYY-MM-DD". */
  reportingPeriod: string;

  /** Supply energy as a value+unit, or as raw joules (converted to kWh). */
  energy?: { value: number; unit: EnergyUnit };
  energyJoules?: number;

  /** Supply carbon directly, or omit and provide carbonIntensity to compute it. */
  carbon?: { value: number; unit: CarbonUnit };
  /** gCO2e per kWh; used to derive carbon when `carbon` is absent. */
  carbonIntensity?: number;

  capabilities?: Capabilities;
  updated?: string;
  /**
   * Echoed as `target-path`. Adapters that scope a response to a requested
   * `query.target` MUST set this (draft: absence means the metrics are
   * origin-wide).
   */
  targetPath?: string;
  carbonAccounting?: CarbonAccounting;
  scope1?: number;
  scope2?: number;
  scope3?: number;
  sciScore?: number;
  functionalUnit?: string;
  estimatedAnnualEmissionsKg?: number;
  renewableEnergy?: number;
  verifiableAttestationUri?: string;
  /** URI of a disclosure index (e.g. a Green Web Foundation carbon.txt file). */
  disclosureUri?: string;

  /** Vendor extensions, copied through verbatim. */
  extra?: Record<string, unknown>;
}

/** Query parameters for the Extended service level (draft §"Optional, Extended, Query Parameters"). */
export interface ServiceQuery {
  target?: string;
  period?: string;
  granularity?: "daily" | "monthly" | "yearly" | string;
}

/** A pluggable metric source. */
export interface SourceAdapter {
  /** Stable identifier, e.g. "static-file", "kepler-prometheus". */
  readonly name: string;
  /** Whether this adapter honours query parameters (sets `capabilities`). */
  readonly capabilities: Capabilities;
  /** Return one object, or an array for a trend/granularity request. */
  fetch(query: ServiceQuery): Promise<RawMetrics | RawMetrics[]>;
}

export interface NormalizeOptions {
  /** Schema version string emitted in payloads. Default "1.1". */
  version?: string;
  /** Force a target energy unit; default keeps the adapter's unit (kWh for joules). */
  energyUnit?: EnergyUnit;
  /** Force a target carbon unit; default keeps the adapter's unit (gCO2e when computed). */
  carbonUnit?: CarbonUnit;
}
