/**
 * Normalization engine: convert loosely-typed {@link RawMetrics} from any adapter
 * into a strict, draft-conformant {@link SustainabilityMetrics} object.
 *
 * Responsibilities:
 *  - Unit handling (joules→kWh; energy/carbon unit selection).
 *  - Deriving carbon from energy×grid-intensity when carbon is not supplied.
 *  - Filling mandatory fields and defaults.
 *  - Refusing what the draft does not allow: a token outside its set, a period
 *    that is not two date-times with `start` before `end`, a member the draft
 *    does not define. A publisher never emits an older form; an older document
 *    is converted with `sustainability-publisher upgrade` first.
 */
import { dateTimeError, Period, PeriodError, toPeriod } from "./period";
import {
  CARBON_TO_G,
  CarbonUnit,
  EnergyUnit,
  isFunctionalUnit,
  isMeasurementMethod,
  isTargetType,
  isUpstreamRole,
  FUNCTIONAL_UNITS,
  MEASUREMENT_METHODS,
  RESIDUAL_METHOD,
  TARGET_TYPES,
  UPSTREAM_ROLES,
} from "./tokens";
import { Extensions, extensionNameError, isUriReference, NormalizeOptions, RawMetrics, SustainabilityMetrics, UpstreamEntry } from "./types";
import { aLabelOf, hasReportableContent, nowDateTime, round } from "./util";

const UPGRADE = "for a document of an earlier revision run sustainability-publisher upgrade";

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
 * Draft §URI-Valued Members: `methodology-uri`, `verifiable-attestation-uri`,
 * `disclosure-uri` and `upstream[].declaration` are URI references (RFC 3986,
 * Section 4.1), relative or absolute, and are written as given. A publisher is
 * fail-loud: a value that is not a URI reference is a configuration error,
 * never a published non-conformance.
 */
export function assertUriReference(member: string, value: string): void {
  if (typeof value !== "string" || !isUriReference(value)) {
    throw new Error(`normalize: ${member} must be a URI reference (got ${JSON.stringify(value)})`);
  }
}

/**
 * Draft §Extensions: `extensions` is an object whose member names are URIs and
 * whose values are objects. Any other name, or a value that is not a JSON
 * object, is a configuration error.
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
 * Draft §Upstream Declarations: each entry carries `declaration`, a URI
 * reference to another publisher's declaration, and an OPTIONAL `role`, one of
 * six tokens. An empty array conveys nothing and the schema requires at least
 * one entry.
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
    assertUriReference(`upstream[${i}].declaration`, entry.declaration);
    if (entry.role !== undefined && !isUpstreamRole(entry.role)) {
      throw new Error(
        `normalize: upstream[${i}].role must be one of ${UPSTREAM_ROLES.join(", ")} (got ${JSON.stringify(entry.role)}); ` +
          `omit it for any other kind of provider (draft, Upstream Declarations); ${UPGRADE}`,
      );
    }
  });
}

/**
 * Draft §Mandatory Members: for `target-type` "origin" the `target` is a host
 * name, and an internationalized host is written in A-label form (RFC 5890,
 * Section 2.3.2.1); a path begins with "/".
 */
function assertTargetForm(target: string, targetType: string | undefined): void {
  const alabel = targetType === "origin" ? aLabelOf(target) : undefined;
  if (alabel !== undefined) {
    throw new Error(
      `normalize: target "${target}" is a host in U-label form; an internationalized host is written ` +
        `in A-label form (draft, Mandatory Members)${alabel ? `: use "${alabel}"` : ""}`,
    );
  }
  if (targetType === "path" && !target.startsWith("/")) {
    throw new Error(`normalize: target "${target}" has target-type path, so it begins with "/" (draft, Mandatory Members)`);
  }
}

const NUMERIC_INPUTS = [
  "energyJoules",
  "carbonIntensity",
  "scope1",
  "scope2",
  "scope3",
  "sciScore",
  "estimatedAnnualEmissionsKg",
  "renewableEnergy",
] as const;

/**
 * Turn one {@link RawMetrics} into a conformant {@link SustainabilityMetrics}.
 * Throws if mandatory inputs are missing, a token is outside its set, or the
 * period is malformed.
 */
export function normalize(raw: RawMetrics, opts: NormalizeOptions = {}): SustainabilityMetrics {
  if (!raw.provider) throw new Error("normalize: provider is required");
  if (!raw.measurementMethod) throw new Error("normalize: measurementMethod is required");
  if (!isMeasurementMethod(raw.measurementMethod)) {
    throw new Error(
      `normalize: measurement-method must be one of ${MEASUREMENT_METHODS.join(", ")} ` +
        `(got ${JSON.stringify(raw.measurementMethod)}); a figure none of the others describes is ` +
        `${RESIDUAL_METHOD} (draft, Mandatory Members); ${UPGRADE}`,
    );
  }
  if (!raw.methodologyUri) throw new Error("normalize: methodologyUri is required");
  assertUriReference("methodologyUri", raw.methodologyUri);
  if (raw.verifiableAttestationUri !== undefined) assertUriReference("verifiableAttestationUri", raw.verifiableAttestationUri);
  if (raw.disclosureUri !== undefined) assertUriReference("disclosureUri", raw.disclosureUri);
  if (raw.extensions !== undefined) assertExtensions(raw.extensions);
  if (raw.upstream !== undefined) assertUpstream(raw.upstream);
  for (const name of NUMERIC_INPUTS) {
    const v = raw[name];
    if (v !== undefined && !Number.isFinite(v)) throw new Error(`normalize: ${name} must be a finite number (got ${String(v)})`);
  }
  let period: Period;
  try {
    period = toPeriod(raw.period);
  } catch (e) {
    if (!(e instanceof PeriodError)) throw e;
    throw new Error(
      `normalize: period must be two RFC 3339 date-times with start before end, or a calendar label ` +
        `(YYYY, YYYY-MM or YYYY-MM-DD): ${e.message}; ${UPGRADE}`,
    );
  }
  const updated = raw.updated ?? (opts.clock ?? nowDateTime)();
  const updatedError = dateTimeError(updated);
  if (updatedError !== undefined) throw new Error(`normalize: updated ${updatedError}`);

  // --- Target (mandatory, draft §Mandatory Members) ---
  const target = raw.target ?? opts.target;
  if (target === undefined || target === "") {
    throw new Error(
      "normalize: `target` (what the object is about) is mandatory. Configure it via " +
        "NormalizeOptions.target — for an origin-wide report the origin's host " +
        '(e.g. "example.com") is recommended — or have the adapter set raw.target.',
    );
  }
  const targetType = raw.targetType ?? opts.targetType;
  assertTargetForm(target, targetType);

  // --- Energy (optional: absent input ⇒ member omitted, not an error) ---
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
        "omit the metric instead (draft, Optional Members)",
    );
  }

  // --- Carbon (optional: absent input ⇒ member omitted, not an error).
  // carbonIntensity alone cannot yield a carbon figure without energy: in that
  // case carbon-footprint/carbon-unit are simply omitted (the intensity itself
  // is still published below) rather than throwing. ---
  // Check the intensity before deriving carbon from it, so a negative
  // intensity is reported as such (not as a derived negative footprint).
  if (typeof raw.carbonIntensity === "number" && raw.carbonIntensity < 0) {
    throw new Error(
      `normalize: carbon-intensity-gCO2e-per-kWh must not be negative (got ${raw.carbonIntensity}); ` +
        "omit the metric instead (draft, Optional Members)",
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
        "omit the metric instead (draft, Optional Members)",
    );
  }

  const out: SustainabilityMetrics = {
    updated,
    capabilities: raw.capabilities ?? "basic",
    // `provider` is text in any script (draft §Mandatory Members). This library
    // emits it in Normalization Form C so that one name has one spelling across
    // its documents; `target` is opaque, compared as a string, and never
    // normalized.
    provider: raw.provider.normalize("NFC"),
    "measurement-method": raw.measurementMethod,
    "methodology-uri": raw.methodologyUri,
    period,
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
  // Scope values are expressed in carbon-unit (draft §Optional Members): they
  // arrive in the source carbon unit and must follow the same conversion as
  // carbon-footprint when an output unit is forced. Scopes MAY be negative
  // (removals/offsets under net accounting), so no range check.
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
  if (raw.functionalUnit !== undefined && !isFunctionalUnit(raw.functionalUnit)) {
    throw new Error(
      `normalize: functional-unit must be one of ${FUNCTIONAL_UNITS.join(", ")} (got ${JSON.stringify(raw.functionalUnit)}); ` +
        `a score in another unit goes in extensions under a name whose definition states the unit (draft, Optional Members); ${UPGRADE}`,
    );
  }
  if (raw.sciScore !== undefined) {
    if (raw.sciScore < 0) {
      throw new Error(
        `normalize: sci-score must not be negative (got ${raw.sciScore}); ` +
          "omit the metric instead (draft, Optional Members)",
      );
    }
    out["sci-score"] = round(raw.sciScore);
  }
  if (raw.functionalUnit !== undefined) out["functional-unit"] = raw.functionalUnit;
  if (raw.carbonIntensity !== undefined) {
    out["carbon-intensity-gCO2e-per-kWh"] = round(raw.carbonIntensity);
  }
  if (raw.estimatedAnnualEmissionsKg !== undefined) {
    if (raw.estimatedAnnualEmissionsKg < 0) {
      throw new Error(
        `normalize: estimated-annual-emissions-kgCO2e must not be negative (got ${raw.estimatedAnnualEmissionsKg}); ` +
          "omit the metric instead (draft, Optional Members)",
      );
    }
    out["estimated-annual-emissions-kgCO2e"] = round(raw.estimatedAnnualEmissionsKg);
  }
  if (raw.renewableEnergy !== undefined) {
    // Draft §Optional Members: renewable-energy is between 0 and 100
    // inclusive. There is no in-band "not reported" value — an unreported
    // metric is simply omitted — so any out-of-range value is an error, never
    // a marker.
    if (raw.renewableEnergy < 0 || raw.renewableEnergy > 100) {
      throw new Error(
        `normalize: renewable-energy must be a percentage between 0 and 100 (got ${raw.renewableEnergy}); ` +
          "omit the metric if it is not reported (draft, Optional Members)",
      );
    }
    out["renewable-energy"] = round(raw.renewableEnergy);
  }
  if (raw.verifiableAttestationUri !== undefined) {
    out["verifiable-attestation-uri"] = raw.verifiableAttestationUri;
  }
  if (raw.disclosureUri !== undefined) out["disclosure-uri"] = raw.disclosureUri;

  // target-type (draft §Optional Members): classifies what `target` names. The
  // publisher is fail-loud on its own output; a client that meets a value it
  // does not recognize disregards it, and `fromWire` applies that when
  // re-ingesting a foreign document.
  if (targetType !== undefined) {
    if (!isTargetType(targetType)) {
      throw new Error(
        `normalize: target-type must be one of ${TARGET_TYPES.join(", ")} (got "${targetType}"); ` +
          `omit the member instead (draft, Optional Members); ${UPGRADE}`,
      );
    }
    out["target-type"] = targetType;
  }

  // Draft §Upstream Declarations / §Extensions, emitted after target-type and
  // before the signature.
  if (raw.upstream !== undefined) {
    out.upstream = raw.upstream.map((e) => ({
      declaration: e.declaration,
      ...(e.role !== undefined ? { role: e.role } : {}),
    }));
  }
  if (raw.extensions !== undefined) out.extensions = raw.extensions;

  // Draft §Body: "A publisher MUST NOT add a top-level member this document does
  // not define; other data goes in extensions." Anything an adapter hands over
  // outside that set is a configuration error, not a pass-through.
  if (raw.extra !== undefined) {
    const names = Object.keys(raw.extra);
    if (names.length > 0) {
      throw new Error(
        `normalize: unknown top-level member(s) ${names.map((n) => `"${n}"`).join(", ")}; ` +
          "the declaration object admits no member the draft does not define (draft, Body) — carry " +
          'publisher-defined data under extensions["<URI>"] instead',
      );
    }
  }

  // Draft §Optional Members: "A declaration object MUST carry at least one
  // numeric metric member or at least one of disclosure-uri and
  // verifiable-attestation-uri."
  if (!hasReportableContent(out)) {
    throw new Error(
      "normalize: a declaration must carry at least one numeric metric member, or " +
        "disclosure-uri or verifiable-attestation-uri (draft, Optional Members); " +
        "this object carries none",
    );
  }

  return out;
}
