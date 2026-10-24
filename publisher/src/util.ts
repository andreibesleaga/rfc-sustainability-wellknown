/** Shared helpers for adapters. */
import { readFileSync } from "node:fs";
import { domainToASCII } from "node:url";
import { parseStrict } from "./json";
import { isFullDate, monthPeriod, parsePeriod, Period, periodFromFullDates, periodFromReportingPeriod, toUtcQueryValue } from "./period";
import { CarbonUnit, EnergyUnit, isTargetType } from "./tokens";
import {
  EVIDENCE_MEMBERS,
  Extensions,
  METRIC_MEMBERS,
  RawMetrics,
  SustainabilityMetrics,
  UpstreamEntry,
} from "./types";

/** Largest upstream JSON body an adapter will read (an emissions API answer is a few kilobytes). */
export const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;

/** Minimal JSON fetch over the global `fetch` (Node 22): bounded in time and size. */
export async function fetchJson(
  url: string,
  init?: RequestInit & { timeoutMs?: number; maxBytes?: number },
): Promise<any> {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? 15_000;
  const maxBytes = init?.maxBytes ?? MAX_UPSTREAM_BYTES;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url} ${text.slice(0, 200)}`);
    if (Buffer.byteLength(text) > maxBytes) throw new Error(`upstream body from ${url} exceeds ${maxBytes} bytes`);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Draft §Optional Members: "A declaration object MUST carry at least one
 * numeric metric member or at least one of disclosure-uri and
 * verifiable-attestation-uri." True when the object satisfies that rule.
 */
export function hasReportableContent(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const rec = obj as Record<string, unknown>;
  if (METRIC_MEMBERS.some((m) => typeof rec[m] === "number")) return true;
  return EVIDENCE_MEMBERS.some((m) => typeof rec[m] === "string" && rec[m] !== "");
}

/**
 * For a `target` that reads as a host name (no whitespace or slash, at least one
 * dot) and is written with non-ASCII characters, the A-label form the draft
 * requires for an internationalized host (§Mandatory Members; RFC 5890,
 * Section 2.3.2.1), or "" when the name has none. `undefined` when the target is
 * not host-shaped or is in A-label form already.
 */
export function aLabelOf(target: string): string | undefined {
  if (!/^[^\s/]+\.[^\s/]+$/.test(target) || !/[^\x00-\x7f]/.test(target)) return undefined;
  return domainToASCII(target);
}

/** Read and parse a JSON file as I-JSON: a duplicate member name, a number beyond binary64 or an unpaired surrogate is refused. */
export function readJson<T = any>(path: string): T {
  return parseStrict(readFileSync(path, "utf8")) as T;
}

/** The current time as an RFC 3339 date-time in whole seconds, UTC, with `T` and `Z` in upper case. */
export function nowDateTime(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); // clock
}

/**
 * The most recently completed calendar month before `now` (an instant, or an
 * RFC 3339 date-time), in UTC. The clock is the caller's: default the present.
 */
export function lastFullMonthPeriod(now: string | Date = new Date()): Period {
  const utc = toUtcQueryValue(typeof now === "string" ? now : now.toISOString());
  const year = Number(utc.slice(0, 4));
  const month = Number(utc.slice(5, 7));
  return month === 1 ? monthPeriod(year - 1, 12) : monthPeriod(year, month - 1);
}

export interface FromWireOptions {
  /**
   * Read the older forms of a document as the current ones. Default true: a
   * `reporting-period` label or a pair of `full-date` bounds becomes the period
   * it stands for, a negative or out-of-range figure is read as "not reported"
   * (the old convention), and an unrecognized `target-type` is dropped. With
   * `false`, the document is read as it stands, and `normalize` refuses what it
   * cannot publish.
   */
  legacyCompat?: boolean;
}

/**
 * The period of an object that carries one of the two earlier forms: the
 * `reporting-period` label of -08 (the whole year, month or day), or the pair of
 * inclusive `full-date` bounds of -09. Both conversions are exact. `undefined`
 * when the object carries neither; throws a `PeriodError` when it carries one
 * that names no date. A token of another revision is never converted here.
 */
export function olderPeriodOf(m: object): Period | undefined {
  const wire = m as Record<string, unknown>;
  const label = wire["reporting-period"];
  const period = wire["period"] as Record<string, unknown> | undefined;
  if (period === undefined && typeof label === "string") return periodFromReportingPeriod(label);
  if (isFullDate(period?.start) && isFullDate(period?.end)) return periodFromFullDates({ start: period.start, end: period.end });
  return undefined;
}

// The period of a wire object; with `legacyCompat`, an earlier form is read as well.
function periodOf(m: object, legacyCompat: boolean): Period {
  return (legacyCompat ? olderPeriodOf(m) : undefined) ?? parsePeriod((m as Record<string, unknown>)["period"]);
}

/**
 * Re-ingest value policy (one rule per class, applied consistently):
 *  - A NON-NUMBER in a present numeric member is a corrupt file — fail loud
 *    (never silently drop a typo'd metric).
 *  - With `legacyCompat`, a NEGATIVE value in a non-negative member is the
 *    historical "not reported" sentinel and is dropped, and so is an
 *    OUT-OF-RANGE value (renewable-energy > 100).
 *  - scope-1/2/3 MAY legitimately be negative and are numeric-checked only.
 */
function numOrThrow(v: unknown, member: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new Error(`fromWire: ${member} is not a finite number (${JSON.stringify(v)})`);
  }
  return v;
}

/**
 * Convert an already wire-shaped {@link SustainabilityMetrics} object back into
 * {@link RawMetrics} so existing `/.well-known/sustainability-data` files (or example
 * payloads) can be re-ingested and re-validated by the gateway.
 */
export function fromWire(m: SustainabilityMetrics, options: FromWireOptions = {}): RawMetrics {
  const legacyCompat = options.legacyCompat !== false;
  const isReported = (v: unknown, member: string): boolean => {
    const n = numOrThrow(v, member);
    if (!legacyCompat) return true;
    if (n < 0) return false; // historical sentinel -> not reported
    return !(member === "renewable-energy" && n > 100); // out of range
  };
  const raw: RawMetrics = {
    provider: m.provider,
    measurementMethod: m["measurement-method"],
    methodologyUri: m["methodology-uri"],
    period: periodOf(m, legacyCompat),
    capabilities: m.capabilities,
    updated: m.updated,
  };
  const legacy = m as unknown as Record<string, unknown>;
  // Energy/carbon are optional: only re-ingest members actually present (a
  // `{ value: undefined }` would poison normalize with NaN). When the value is
  // present without its unit, the draft's defaults apply.
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
    // parameterizes the scope values (draft §Optional Members) —
    // carry it so normalize doesn't reinterpret the scopes as gCO2e.
    raw.carbonUnitHint = m["carbon-unit"] as CarbonUnit;
  }
  // Historical documents conveyed the target via the optional `target-path`
  // member; map it to `target` (absence of target-path meant origin-wide — the
  // caller's opts.target covers that).
  if (m.target !== undefined) raw.target = String(m.target);
  else if (legacyCompat && legacy["target-path"] !== undefined) raw.target = String(legacy["target-path"]);
  if (m["carbon-accounting"] !== undefined) raw.carbonAccounting = m["carbon-accounting"];
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
    (m["functional-unit"] !== undefined || !legacyCompat)
  ) {
    raw.sciScore = Number(m["sci-score"]);
  }
  if (m["functional-unit"] !== undefined) raw.functionalUnit = m["functional-unit"];
  const intensity = m["carbon-intensity-gCO2e-per-kWh"] ?? (legacyCompat ? legacy["carbon-intensity-gCO2-per-kWh"] : undefined);
  if (intensity !== undefined && isReported(intensity, "carbon-intensity-gCO2e-per-kWh")) {
    raw.carbonIntensity = Number(intensity);
  }
  if (m["renewable-energy"] !== undefined && isReported(m["renewable-energy"], "renewable-energy")) {
    raw.renewableEnergy = Number(m["renewable-energy"]);
  }
  const annual = m["estimated-annual-emissions-kgCO2e"] ?? (legacyCompat ? legacy["estimated-annual-emissions-kgCO2"] : undefined);
  if (annual !== undefined && isReported(annual, "estimated-annual-emissions-kgCO2e")) {
    raw.estimatedAnnualEmissionsKg = Number(annual);
  }
  if (m["verifiable-attestation-uri"] !== undefined) {
    raw.verifiableAttestationUri = String(m["verifiable-attestation-uri"]);
  }
  if (m["disclosure-uri"] !== undefined) raw.disclosureUri = String(m["disclosure-uri"]);
  // A client that meets a target-type it does not recognize disregards the
  // member, so a document being re-ingested loses it rather than failing.
  if (m["target-type"] !== undefined && (isTargetType(m["target-type"]) || !legacyCompat)) {
    raw.targetType = m["target-type"];
  }

  // Carried through verbatim; normalize re-validates both.
  if (Array.isArray(legacy["upstream"])) raw.upstream = legacy["upstream"] as UpstreamEntry[];
  const extensions = legacy["extensions"];
  if (typeof extensions === "object" && extensions !== null && !Array.isArray(extensions)) {
    raw.extensions = extensions as Extensions;
  }
  // The `signed` member is not carried over: the signature covers the object it
  // was served in, and a re-emitted object is signed afresh by the publisher.
  // Every other top-level member is dropped as well: a consumer ignores a member
  // it does not recognize (draft §Body), and a publisher adds none.
  return raw;
}
