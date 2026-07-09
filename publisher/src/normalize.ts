/**
 * Normalization engine: convert loosely-typed {@link RawMetrics} from any adapter
 * into a strict, draft-conformant {@link SustainabilityMetrics} object.
 *
 * Responsibilities:
 *  - Unit handling (joules→kWh; energy/carbon unit selection).
 *  - Deriving carbon from energy×grid-intensity when carbon is not supplied.
 *  - Filling mandatory fields and defaults.
 *  - Validating the `reporting-period` shape.
 */
import {
  CarbonUnit,
  EnergyUnit,
  NormalizeOptions,
  RawMetrics,
  SustainabilityMetrics,
} from "./types";

/** Joules → kWh. 1 kWh = 3.6e6 J. */
export function joulesToKwh(joules: number): number {
  return joules / 3_600_000;
}

const ENERGY_TO_WH: Record<EnergyUnit, number> = {
  Wh: 1,
  kWh: 1_000,
  MWh: 1_000_000,
  GWh: 1_000_000_000,
};

const CARBON_TO_G: Record<CarbonUnit, number> = {
  gCO2e: 1,
  kgCO2e: 1_000,
  mtCO2e: 1_000_000, // metric tonne CO2e = 1e6 g
};

/**
 * Convert an energy value between any two supported units.
 * Throws (rather than silently producing NaN) if either unit is unrecognized —
 * a mistyped unit like "kwh" would otherwise index the lookup table as
 * `undefined`, yield NaN, and be serialized as `null` past the validation gate.
 */
export function convertEnergy(value: number, from: EnergyUnit, to: EnergyUnit): number {
  const fromWh = ENERGY_TO_WH[from];
  const toWh = ENERGY_TO_WH[to];
  if (fromWh === undefined || toWh === undefined) {
    throw new Error(
      `convertEnergy: unrecognized energy unit (from="${from}", to="${to}"); ` +
        `must be one of ${Object.keys(ENERGY_TO_WH).join(", ")}`,
    );
  }
  return (value * fromWh) / toWh;
}

/**
 * Convert a carbon value between any two supported units.
 * Throws if either unit is unrecognized (see {@link convertEnergy}).
 */
export function convertCarbon(value: number, from: CarbonUnit, to: CarbonUnit): number {
  const fromG = CARBON_TO_G[from];
  const toG = CARBON_TO_G[to];
  if (fromG === undefined || toG === undefined) {
    throw new Error(
      `convertCarbon: unrecognized carbon unit (from="${from}", to="${to}"); ` +
        `must be one of ${Object.keys(CARBON_TO_G).join(", ")}`,
    );
  }
  return (value * fromG) / toG;
}

/**
 * Compute carbon emissions from energy and grid carbon intensity.
 * @param energyKwh    energy in kWh
 * @param gco2PerKwh   grid carbon intensity in gCO2e/kWh
 * @returns grams of CO2e
 */
export function carbonFromEnergy(energyKwh: number, gco2PerKwh: number): number {
  return energyKwh * gco2PerKwh;
}

/**
 * Software Carbon Intensity (SCI), per the GSF specification (ISO/IEC 21031:2024):
 * SCI = ((E × I) + M) / R
 * @param energyKwh  operational energy (kWh)
 * @param gco2PerKwh grid intensity (gCO2e/kWh) — the "I" term
 * @param embodiedG  amortized embodied emissions over the window (gCO2e) — the "M" term
 * @param units      functional units "R" (e.g. requests)
 */
export function computeSci(
  energyKwh: number,
  gco2PerKwh: number,
  embodiedG: number,
  units: number,
): number {
  if (units <= 0) throw new RangeError("SCI functional units (R) must be > 0");
  return (energyKwh * gco2PerKwh + embodiedG) / units;
}

/**
 * Draft period shape: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. Month is bounded to
 * 01-12 and day to 01-31 so impossible dates like "2026-13-40" are rejected
 * (a plain `\d{2}` would accept them). Exported as the single source of truth;
 * adapters import this rather than duplicating the pattern.
 */
export const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** Round to a sensible precision to avoid float noise in payloads. */
function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Turn one {@link RawMetrics} into a conformant {@link SustainabilityMetrics}.
 * Throws if mandatory inputs are missing or the period is malformed.
 */
export function normalize(raw: RawMetrics, opts: NormalizeOptions = {}): SustainabilityMetrics {
  const version = opts.version ?? "1.1";

  if (!raw.provider) throw new Error("normalize: provider is required");
  if (!raw.measurementMethod) throw new Error("normalize: measurementMethod is required");
  if (!raw.methodologyUri) throw new Error("normalize: methodologyUri is required");
  if (!raw.reportingPeriod || !PERIOD_RE.test(raw.reportingPeriod)) {
    throw new Error(
      `normalize: reportingPeriod must be YYYY, YYYY-MM, or YYYY-MM-DD (got "${raw.reportingPeriod}")`,
    );
  }

  // --- Energy ---
  let energyValue: number;
  let energyUnit: EnergyUnit;
  if (raw.energy) {
    energyUnit = opts.energyUnit ?? raw.energy.unit;
    energyValue = convertEnergy(raw.energy.value, raw.energy.unit, energyUnit);
  } else if (typeof raw.energyJoules === "number") {
    const kwh = joulesToKwh(raw.energyJoules);
    energyUnit = opts.energyUnit ?? "kWh";
    energyValue = convertEnergy(kwh, "kWh", energyUnit);
  } else {
    throw new Error("normalize: provide either energy {value,unit} or energyJoules");
  }

  // --- Carbon ---
  let carbonValue: number;
  let carbonUnit: CarbonUnit;
  if (raw.carbon) {
    carbonUnit = opts.carbonUnit ?? raw.carbon.unit;
    carbonValue = convertCarbon(raw.carbon.value, raw.carbon.unit, carbonUnit);
  } else if (typeof raw.carbonIntensity === "number") {
    const energyKwh = convertEnergy(energyValue, energyUnit, "kWh");
    const grams = carbonFromEnergy(energyKwh, raw.carbonIntensity);
    carbonUnit = opts.carbonUnit ?? "gCO2e";
    carbonValue = convertCarbon(grams, "gCO2e", carbonUnit);
  } else {
    throw new Error(
      "normalize: provide either carbon {value,unit} or carbonIntensity (to compute from energy)",
    );
  }

  const out: SustainabilityMetrics = {
    version,
    updated: raw.updated ?? nowIso(),
    capabilities: raw.capabilities ?? "basic",
    provider: raw.provider,
    "measurement-method": raw.measurementMethod,
    "methodology-uri": raw.methodologyUri,
    "reporting-period": raw.reportingPeriod,
    "energy-consumption": round(energyValue),
    "energy-unit": energyUnit,
    "carbon-footprint": round(carbonValue),
    "carbon-unit": carbonUnit,
  };

  // Optional fields (only set when present)
  if (raw.targetPath !== undefined) out["target-path"] = raw.targetPath;
  if (raw.carbonAccounting !== undefined) out["carbon-accounting"] = raw.carbonAccounting;
  // Scope values are expressed in carbon-unit (draft §Optional Response
  // Fields): they arrive in the source carbon unit and must follow the same
  // conversion as carbon-footprint when an output unit is forced.
  const scopeSourceUnit: CarbonUnit = raw.carbon?.unit ?? "gCO2e";
  const toScope = (v: number) => round(convertCarbon(v, scopeSourceUnit, carbonUnit));
  if (raw.scope1 !== undefined) out["scope-1"] = toScope(raw.scope1);
  if (raw.scope2 !== undefined) out["scope-2"] = toScope(raw.scope2);
  if (raw.scope3 !== undefined) out["scope-3"] = toScope(raw.scope3);
  // Draft §Optional Response Fields: "If sci-score is present, functional-unit
  // MUST also be present." The JTD gate cannot express this dependency, so it
  // is enforced here (fail loudly rather than publish a MUST-violating doc).
  if (raw.sciScore !== undefined && raw.functionalUnit === undefined) {
    throw new Error("normalize: sci-score requires functional-unit (draft, Optional Response Fields)");
  }
  if (raw.sciScore !== undefined) out["sci-score"] = round(raw.sciScore);
  if (raw.functionalUnit !== undefined) out["functional-unit"] = raw.functionalUnit;
  if (raw.carbonIntensity !== undefined) {
    out["carbon-intensity-gCO2-per-kWh"] = round(raw.carbonIntensity);
  }
  if (raw.estimatedAnnualEmissionsKg !== undefined) {
    out["estimated-annual-emissions-kgCO2"] = round(raw.estimatedAnnualEmissionsKg);
  }
  if (raw.renewableEnergy !== undefined) {
    // Draft §Optional Response Fields: renewable-energy is a percentage (0-100).
    // Per the draft's sentinel rule (§Unreported Numeric Metrics), a negative
    // value in an optional numeric field means "not reported" — so a negative
    // is a legal sentinel (the consumer strips it), NOT an error. Only a value
    // above 100 is genuinely impossible, so fail loudly on that alone rather
    // than publish an out-of-range percentage.
    if (raw.renewableEnergy > 100) {
      throw new Error(
        `normalize: renewable-energy must be a percentage <= 100 (got ${raw.renewableEnergy})`,
      );
    }
    out["renewable-energy"] = round(raw.renewableEnergy);
  }
  if (raw.verifiableAttestationUri !== undefined) {
    out["verifiable-attestation-uri"] = raw.verifiableAttestationUri;
  }
  if (raw.disclosureUri !== undefined) out["disclosure-uri"] = raw.disclosureUri;

  // Vendor extensions, copied through (clients MUST ignore unknown fields).
  if (raw.extra) {
    for (const [k, v] of Object.entries(raw.extra)) {
      if (!(k in out)) out[k] = v;
    }
  }

  return out;
}
