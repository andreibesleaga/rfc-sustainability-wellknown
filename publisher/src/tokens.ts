/**
 * The closed token sets of the draft, as readonly arrays with type guards, and
 * the reading of the older spellings that the draft replaced.
 *
 * Each array is in the order of the draft's CDDL (Formal Definition), which is
 * also the order of the JSON Type Definition enums; the tests hold the three in
 * step. Comparison is exact (`===` on the decoded string, draft §Body): a case
 * variant is not a member.
 *
 * Shared module: it imports nothing and is copied byte for byte into the
 * consumer.
 */

export const CAPABILITIES = ["basic", "extended"] as const;
export type Capabilities = (typeof CAPABILITIES)[number];

/** From the most to the least direct (draft §Mandatory Members). */
export const MEASUREMENT_METHODS = [
  "hardware-metered",
  "hardware-estimated",
  "cloud-billing",
  "third-party-modeled",
] as const;
export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number];

/** The token for a figure that no other token describes, and for a combination of unknowns. */
export const RESIDUAL_METHOD: MeasurementMethod = "third-party-modeled";

export const ENERGY_UNITS = ["Wh", "kWh", "MWh", "GWh"] as const;
export type EnergyUnit = (typeof ENERGY_UNITS)[number];

export const CARBON_UNITS = ["gCO2e", "kgCO2e", "tCO2e"] as const;
export type CarbonUnit = (typeof CARBON_UNITS)[number];

/** Grams of CO2e in one of each unit. */
export const CARBON_TO_G: Readonly<Record<CarbonUnit, number>> = {
  gCO2e: 1,
  kgCO2e: 1_000,
  tCO2e: 1_000_000,
};

export const CARBON_ACCOUNTING = ["location-based", "market-based"] as const;
export type CarbonAccounting = (typeof CARBON_ACCOUNTING)[number];

export const TARGET_TYPES = [
  "origin",
  "path",
  "organization",
  "facility",
  "service",
  "product",
  "device",
  "tenant",
  "data-source",
] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const FUNCTIONAL_UNITS = [
  "per-request",
  "per-transaction",
  "per-page-view",
  "per-session",
  "per-user",
  "per-job",
  "per-token",
  "per-inference",
  "per-gigabyte",
  "per-gigabyte-hour",
  "per-vcpu-hour",
  "per-device",
] as const;
export type FunctionalUnit = (typeof FUNCTIONAL_UNITS)[number];

export const UPSTREAM_ROLES = ["hosting", "colocation", "cloud", "cdn", "network", "electricity"] as const;
export type UpstreamRole = (typeof UPSTREAM_ROLES)[number];

/** The values of the `granularity` query parameter (draft §Query Parameters). */
export const GRANULARITIES = ["yearly", "monthly", "daily"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

function guard<T extends string>(set: readonly T[]): (value: unknown) => value is T {
  return (value): value is T => typeof value === "string" && set.includes(value as T);
}

export const isCapabilities = guard(CAPABILITIES);
export const isMeasurementMethod = guard(MEASUREMENT_METHODS);
export const isEnergyUnit = guard(ENERGY_UNITS);
export const isCarbonUnit = guard(CARBON_UNITS);
export const isCarbonAccounting = guard(CARBON_ACCOUNTING);
export const isTargetType = guard(TARGET_TYPES);
export const isFunctionalUnit = guard(FUNCTIONAL_UNITS);
export const isUpstreamRole = guard(UPSTREAM_ROLES);
export const isGranularity = guard(GRANULARITIES);

/**
 * The token for figures that combine methods: the least direct of them (draft
 * §Mandatory Members). A combination with nothing in it, or with a value that is
 * not a token, takes the residual token.
 */
export function leastDirect(methods: Iterable<string>): MeasurementMethod {
  let least = -1;
  for (const method of methods) {
    const rank = MEASUREMENT_METHODS.indexOf(method as MeasurementMethod);
    if (rank === -1) return RESIDUAL_METHOD;
    least = Math.max(least, rank);
  }
  return least === -1 ? RESIDUAL_METHOD : MEASUREMENT_METHODS[least];
}

/** The `carbon-unit` the older revisions wrote for the metric tonne; the number is unchanged. */
export function legacyCarbonUnit(unit: string): CarbonUnit | undefined {
  return unit === "mtCO2e" ? "tCO2e" : undefined;
}

// A unit before the draft closed the set: an optional "per-", an optional scale
// ("thousand", "1000", "million"), an optional "api-", a noun and an optional
// plural "s", in any letter case. Only these nouns; no abbreviations ("gb",
// "k"), and no time compounds, since the time of a score is the `period`.
const LEGACY_UNIT =
  /^(?:per-)?(?:(thousand|1000|million)-)?(?:api-)?(request|call|query|transaction|user|device|gigabyte|page-?view|visit|job|run|token|inference)s?$/i;

const LEGACY_NOUN: Readonly<Record<string, FunctionalUnit>> = {
  request: "per-request",
  call: "per-request",
  query: "per-request",
  transaction: "per-transaction",
  user: "per-user",
  device: "per-device",
  gigabyte: "per-gigabyte",
  pageview: "per-page-view",
  "page-view": "per-page-view",
  visit: "per-page-view",
  job: "per-job",
  run: "per-job",
  token: "per-token",
  inference: "per-inference",
};

const LEGACY_SCALE: Readonly<Record<string, number>> = { thousand: 1_000, "1000": 1_000, million: 1_000_000 };

// Storage held over time: gigabytes or terabytes, per hour or per day, in hours of one gigabyte.
const LEGACY_STORAGE = /^per-(gigabyte|terabyte)-(hour|day)$/i;
const STORAGE_HOURS: Readonly<Record<string, number>> = {
  "gigabyte-hour": 1,
  "gigabyte-day": 24,
  "terabyte-hour": 1_000,
  "terabyte-day": 24_000,
};

/** A functional unit read as the draft defines it, with the number its score was divided by. */
export interface LegacyUnit {
  unit: FunctionalUnit;
  /** The score for one unit of `unit`; absent when no score was given. */
  score?: number;
  /** The divisor applied to the score: 1 when the unit only changed its spelling. */
  factor: number;
}

/**
 * Read a `functional-unit` of an earlier revision, and the `sci-score` stated
 * for it, as the unit the draft defines: "per-thousand-requests" with 12 is
 * "per-request" with 0.012, "per-terabyte-day" with 24000 is
 * "per-gigabyte-hour" with 1. A token of the draft reads as itself. Returns
 * `undefined` when no rule applies (a unit over a month, a lifecycle, an
 * abbreviation), and then neither the unit nor its score can be carried over.
 */
export function legacyFunctionalUnit(unit: string, score?: number): LegacyUnit | undefined {
  let target: FunctionalUnit;
  let factor: number;
  const storage = LEGACY_STORAGE.exec(unit);
  const named = storage ? undefined : LEGACY_UNIT.exec(unit);
  if (storage) {
    target = "per-gigabyte-hour";
    factor = STORAGE_HOURS[`${storage[1]}-${storage[2]}`.toLowerCase()];
  } else if (named) {
    target = LEGACY_NOUN[named[2].toLowerCase()];
    factor = named[1] === undefined ? 1 : LEGACY_SCALE[named[1].toLowerCase()];
  } else {
    return undefined;
  }
  return { unit: target, ...(score === undefined ? {} : { score: scale(score, factor) }), factor };
}

// The score divided by `factor`, to three significant figures at least and to as
// many as the original score had, so that a division by a power of ten stays exact.
function scale(score: number, factor: number): number {
  if (factor === 1) return score;
  const given = Math.abs(score).toExponential().split("e")[0].replace(".", "").length;
  return Number((score / factor).toPrecision(Math.min(Math.max(given, 3), 15)));
}
