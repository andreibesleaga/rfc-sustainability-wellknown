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
import { isCalendarPeriod } from "./period";
import { hasReportableContent, round } from "./util";
import {
  CarbonUnit,
  EnergyUnit,
  Extensions,
  extensionNameError,
  NormalizeOptions,
  RawMetrics,
  SustainabilityMetrics,
  TARGET_TYPES,
  TargetType,
  UpstreamEntry,
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

/** Re-exported for compatibility; the definition lives with the period rules. */
export { PERIOD_RE } from "./period";

/**
 * Draft §Payload Format: the URI-valued members (`methodology-uri`,
 * `verifiable-attestation-uri`, `disclosure-uri` and `upstream[].declaration`)
 * "MUST be absolute URIs {{RFC3986}} with the 'https' scheme". A publisher is
 * fail-loud: a wrong URI is a configuration error, never a published
 * non-conformance.
 */
export function assertHttpsUri(member: string, value: string): void {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  if (!url || url.protocol !== "https:") {
    throw new Error(`normalize: ${member} must be an absolute https URI (got "${value}")`);
  }
}


/**
 * Draft §Extensions: `extensions` is an object whose member names are absolute
 * URIs (RFC 3986, Section 4.3: ASCII, no whitespace, no fragment) and whose
 * values are objects. The two forms the draft names are an "https" URI with a
 * host — documentation for a human, never dereferenced — and `urn:uuid:` plus a
 * lowercase UUID, the Nil and Max UUIDs excluded. Any other key, or a value that
 * is not a JSON object, is a configuration error.
 */
export function assertExtensions(extensions: Extensions): void {
  for (const [key, value] of Object.entries(extensions)) {
    const why = extensionNameError(key);
    if (why !== undefined) {
      throw new Error(`normalize: extensions key "${key}" ${why}`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`normalize: extensions["${key}"] must be a JSON object`);
    }
  }
}

/**
 * Draft §Upstream Declarations: each entry carries `declaration`, the absolute
 * "https" URI of another publisher's declaration, and an OPTIONAL `role` token.
 * An empty array conveys nothing and the schema requires at least one entry.
 */
export function assertUpstream(upstream: UpstreamEntry[]): void {
  if (!Array.isArray(upstream) || upstream.length === 0) {
    throw new Error("normalize: upstream must be a non-empty array; omit the member instead");
  }
  upstream.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error(`normalize: upstream[${i}] must be an object with a declaration member`);
    }
    if (typeof entry.declaration !== "string" || entry.declaration === "") {
      throw new Error(`normalize: upstream[${i}].declaration is required`);
    }
    assertHttpsUri(`upstream[${i}].declaration`, entry.declaration);
    if (entry.role !== undefined && typeof entry.role !== "string") {
      throw new Error(`normalize: upstream[${i}].role must be a string token`);
    }
  });
}

function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Turn one {@link RawMetrics} into a conformant {@link SustainabilityMetrics}.
 * Throws if mandatory inputs are missing or the period is malformed.
 */
export function normalize(raw: RawMetrics, opts: NormalizeOptions = {}): SustainabilityMetrics {
  if (!raw.provider) throw new Error("normalize: provider is required");
  if (!raw.measurementMethod) throw new Error("normalize: measurementMethod is required");
  if (!raw.methodologyUri) throw new Error("normalize: methodologyUri is required");
  assertHttpsUri("methodologyUri", raw.methodologyUri);
  if (raw.verifiableAttestationUri !== undefined) assertHttpsUri("verifiableAttestationUri", raw.verifiableAttestationUri);
  if (raw.disclosureUri !== undefined) assertHttpsUri("disclosureUri", raw.disclosureUri);
  if (raw.extensions !== undefined) assertExtensions(raw.extensions);
  if (raw.upstream !== undefined) assertUpstream(raw.upstream);
  if (!raw.reportingPeriod || !isCalendarPeriod(raw.reportingPeriod)) {
    throw new Error(
      `normalize: reportingPeriod must be YYYY, YYYY-MM, or YYYY-MM-DD (got "${raw.reportingPeriod}")`,
    );
  }

  // --- Target (mandatory reporting subject, draft §Mandatory Members) ---
  const target = raw.target ?? opts.target;
  if (target === undefined || target === "") {
    throw new Error(
      "normalize: `target` (the reporting subject) is mandatory. Configure it via " +
        "NormalizeOptions.target — for an origin-wide report the origin's host " +
        '(e.g. "example.com") is recommended — or have the adapter set raw.target.',
    );
  }

  // --- Energy (optional since -03: absent input ⇒ member omitted, not an error) ---
  let energyValue: number | undefined;
  let energyUnit: EnergyUnit | undefined;
  if (raw.energy) {
    energyUnit = opts.energyUnit ?? raw.energy.unit;
    energyValue = convertEnergy(raw.energy.value, raw.energy.unit, energyUnit);
  } else if (typeof raw.energyJoules === "number") {
    const kwh = joulesToKwh(raw.energyJoules);
    energyUnit = opts.energyUnit ?? "kWh";
    energyValue = convertEnergy(kwh, "kWh", energyUnit);
  }
  if (energyValue !== undefined && energyValue < 0) {
    throw new Error(
      `normalize: energy-consumption must not be negative (got ${energyValue}); ` +
        "omit the metric instead (draft, Value Constraints and Omitted Metrics)",
    );
  }

  // --- Carbon (optional since -03: absent input ⇒ member omitted, not an error).
  // carbonIntensity alone cannot yield a carbon figure without energy: in that
  // case carbon-footprint/carbon-unit are simply omitted (the intensity itself
  // is still published below) rather than throwing. ---
  // Check the intensity before deriving carbon from it, so a negative
  // intensity is reported as such (not as a derived negative footprint).
  if (typeof raw.carbonIntensity === "number" && raw.carbonIntensity < 0) {
    throw new Error(
      `normalize: carbon-intensity-gCO2e-per-kWh must not be negative (got ${raw.carbonIntensity}); ` +
        "omit the metric instead (draft, Value Constraints and Omitted Metrics)",
    );
  }
  let carbonValue: number | undefined;
  let carbonUnit: CarbonUnit | undefined;
  if (raw.carbon) {
    carbonUnit = opts.carbonUnit ?? raw.carbon.unit;
    carbonValue = convertCarbon(raw.carbon.value, raw.carbon.unit, carbonUnit);
  } else if (typeof raw.carbonIntensity === "number" && energyValue !== undefined) {
    const energyKwh = convertEnergy(energyValue, energyUnit as EnergyUnit, "kWh");
    const grams = carbonFromEnergy(energyKwh, raw.carbonIntensity);
    carbonUnit = opts.carbonUnit ?? "gCO2e";
    carbonValue = convertCarbon(grams, "gCO2e", carbonUnit);
  }
  if (carbonValue !== undefined && carbonValue < 0) {
    throw new Error(
      `normalize: carbon-footprint must not be negative (got ${carbonValue}); ` +
        "omit the metric instead (draft, Value Constraints and Omitted Metrics)",
    );
  }

  const out: SustainabilityMetrics = {
    updated: raw.updated ?? nowIso(),
    capabilities: raw.capabilities ?? "basic",
    provider: raw.provider,
    "measurement-method": raw.measurementMethod,
    "methodology-uri": raw.methodologyUri,
    "reporting-period": raw.reportingPeriod,
    target,
  };

  // Publishers SHOULD state units explicitly (draft §Optional Members),
  // so the unit members are always emitted alongside their value — but only
  // then: an energy-unit without energy-consumption "has no effect and SHOULD
  // be omitted".
  if (energyValue !== undefined) {
    out["energy-consumption"] = round(energyValue);
    out["energy-unit"] = energyUnit as EnergyUnit;
  }
  if (carbonValue !== undefined) {
    out["carbon-footprint"] = round(carbonValue);
    out["carbon-unit"] = carbonUnit as CarbonUnit;
  }

  // Optional fields (only set when present)
  if (raw.carbonAccounting !== undefined) out["carbon-accounting"] = raw.carbonAccounting;
  // Scope values are expressed in carbon-unit (draft §Optional Response
  // Fields): they arrive in the source carbon unit and must follow the same
  // conversion as carbon-footprint when an output unit is forced. Scopes MAY
  // be negative (removals/offsets under net accounting), so no range check.
  const hasScopes =
    raw.scope1 !== undefined || raw.scope2 !== undefined || raw.scope3 !== undefined;
  const scopeSourceUnit: CarbonUnit = raw.carbon?.unit ?? raw.carbonUnitHint ?? "gCO2e";
  if (hasScopes && carbonUnit === undefined) {
    // Scopes are parameterized by carbon-unit even when carbon-footprint is
    // absent; publishers SHOULD state the unit explicitly, so emit it here.
    carbonUnit = opts.carbonUnit ?? scopeSourceUnit;
    out["carbon-unit"] = carbonUnit;
  }
  const toScope = (v: number) => round(convertCarbon(v, scopeSourceUnit, carbonUnit as CarbonUnit));
  if (raw.scope1 !== undefined) out["scope-1"] = toScope(raw.scope1);
  if (raw.scope2 !== undefined) out["scope-2"] = toScope(raw.scope2);
  if (raw.scope3 !== undefined) out["scope-3"] = toScope(raw.scope3);
  // Draft §Optional Members: "If sci-score is present, functional-unit
  // MUST also be present." The JTD gate cannot express this dependency, so it
  // is enforced here (fail loudly rather than publish a MUST-violating doc).
  if (raw.sciScore !== undefined && raw.functionalUnit === undefined) {
    throw new Error("normalize: sci-score requires functional-unit (draft, Optional Members)");
  }
  if (raw.sciScore !== undefined) {
    if (raw.sciScore < 0) {
      throw new Error(
        `normalize: sci-score must not be negative (got ${raw.sciScore}); ` +
          "omit the metric instead (draft, Value Constraints and Omitted Metrics)",
      );
    }
    out["sci-score"] = round(raw.sciScore);
  }
  if (raw.functionalUnit !== undefined) out["functional-unit"] = raw.functionalUnit;
  if (raw.carbonIntensity !== undefined) {
    if (raw.carbonIntensity < 0) {
      throw new Error(
        `normalize: carbon-intensity-gCO2e-per-kWh must not be negative (got ${raw.carbonIntensity}); ` +
          "omit the metric instead (draft, Value Constraints and Omitted Metrics)",
      );
    }
    out["carbon-intensity-gCO2e-per-kWh"] = round(raw.carbonIntensity);
  }
  if (raw.estimatedAnnualEmissionsKg !== undefined) {
    if (raw.estimatedAnnualEmissionsKg < 0) {
      throw new Error(
        `normalize: estimated-annual-emissions-kgCO2e must not be negative (got ${raw.estimatedAnnualEmissionsKg}); ` +
          "omit the metric instead (draft, Value Constraints and Omitted Metrics)",
      );
    }
    out["estimated-annual-emissions-kgCO2e"] = round(raw.estimatedAnnualEmissionsKg);
  }
  if (raw.renewableEnergy !== undefined) {
    // Draft §Optional Members: renewable-energy MUST be between 0 and
    // 100 inclusive. Since -03 there is no negative "not reported" sentinel —
    // an unreported metric is simply omitted — so any out-of-range value is an
    // error, never a marker.
    if (raw.renewableEnergy < 0 || raw.renewableEnergy > 100) {
      throw new Error(
        `normalize: renewable-energy must be a percentage between 0 and 100 (got ${raw.renewableEnergy}); ` +
          "omit the metric if it is not reported (draft, Value Constraints and Omitted Metrics)",
      );
    }
    out["renewable-energy"] = round(raw.renewableEnergy);
  }
  if (raw.verifiableAttestationUri !== undefined) {
    out["verifiable-attestation-uri"] = raw.verifiableAttestationUri;
  }
  if (raw.disclosureUri !== undefined) out["disclosure-uri"] = raw.disclosureUri;

  // target-type (draft -04, §Optional Members): a hint classifying
  // the reporting subject named by `target`. The publisher is fail-loud on its
  // own output — the draft's unrecognized-value tolerance is a CLIENT rule
  // (fromWire applies it when re-ingesting foreign documents); emitting an
  // out-of-enum value here would ship a schema-invalid document.
  const targetType = raw.targetType ?? opts.targetType;
  if (targetType !== undefined) {
    if (!TARGET_TYPES.includes(targetType as TargetType)) {
      throw new Error(
        `normalize: target-type must be one of ${TARGET_TYPES.join(", ")} (got "${targetType}"); ` +
          "omit the member instead (draft, Optional Members)",
      );
    }
    out["target-type"] = targetType;
  }

  // Draft §Upstream Declarations / §Extensions, emitted in schema order after
  // target-type and before the signature.
  if (raw.upstream !== undefined) {
    out.upstream = raw.upstream.map((e) => ({
      declaration: e.declaration,
      ...(e.role !== undefined ? { role: e.role } : {}),
    }));
  }
  if (raw.extensions !== undefined) out.extensions = raw.extensions;

  // Draft §Payload Format: "A declaration object contains the seven mandatory
  // members, any of the optional members, and nothing else." The base object is
  // closed in -07, so anything an adapter hands over outside that set is a
  // configuration error, not a pass-through.
  if (raw.extra !== undefined) {
    const names = Object.keys(raw.extra);
    if (names.length > 0) {
      throw new Error(
        `normalize: unknown top-level member(s) ${names.map((n) => `"${n}"`).join(", ")}; ` +
          "the declaration object is closed (draft, Payload Format) — carry publisher-defined " +
          'data under extensions["<absolute-URI>"] instead',
      );
    }
  }

  // Draft §Value Constraints and Omitted Metrics: "A declaration object MUST
  // carry at least one numeric metric member or at least one of disclosure-uri
  // and verifiable-attestation-uri; an object with none is not conformant."
  if (!hasReportableContent(out)) {
    throw new Error(
      "normalize: a declaration must carry at least one numeric metric member, or " +
        "disclosure-uri or verifiable-attestation-uri (draft, Value Constraints and " +
        "Omitted Metrics); this object carries none",
    );
  }

  return out;
}
