/** Format transformations for a validated Sustainability Metadata Document. */
import { CarbonUnit, EnergyUnit, SustainabilityDocument, SustainabilityMetrics } from "./types";
import { isNotReported, NUMERIC_KEYS } from "./sentinel";
import { convertCarbon, convertEnergy } from "./units";

function asArray(doc: SustainabilityDocument): SustainabilityMetrics[] {
  return Array.isArray(doc) ? doc : [doc];
}

const CSV_COLUMNS = [
  "provider",
  "reporting-period",
  "target",
  "energy-consumption",
  "energy-unit",
  "carbon-footprint",
  "carbon-unit",
] as const;

/** One CSV row per object (header row first), quoting values with commas. */
export function toCsvRows(doc: SustainabilityDocument): string[] {
  const q = (v: unknown) => {
    const s = v === undefined ? "" : String(v);
    // RFC 4180: quote any value containing a comma, a double quote, or a
    // line break (a raw newline would split the row; a raw quote mis-parses).
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [CSV_COLUMNS.join(",")];
  for (const m of asArray(doc)) {
    rows.push(CSV_COLUMNS.map((c) => q(m[c])).join(","));
  }
  return rows;
}

/** Newline-delimited JSON, one object per line. */
export function toNdjson(doc: SustainabilityDocument): string {
  return asArray(doc)
    .map((m) => JSON.stringify(m))
    .join("\n");
}

export interface FlatRecord {
  provider: string;
  "reporting-period": string;
  /** The mandatory reporting subject — always present on a valid 2.0 document. */
  target: string;
  metric: string;
  value: number;
  unit: string;
}

/** The non-negative members, as a plain string list for membership checks. */
const NON_NEGATIVE: readonly string[] = NUMERIC_KEYS;

/**
 * One row per numeric metric (incl. scopes), for time-series ingestion.
 *
 * Negative values are skipped only for the NON-NEGATIVE members (sentinel.ts's
 * legacy-compatibility rule: they read as "not reported"); a negative scope
 * value is real data (net accounting) and flows through. Absent unit members
 * fall back to the draft's defaults (kWh / gCO2e).
 */
export function flatten(doc: SustainabilityDocument): FlatRecord[] {
  const rows: FlatRecord[] = [];
  // [metric, unit-member ?? "", default/literal unit label]
  const numeric: Array<[string, string, string]> = [
    ["energy-consumption", "energy-unit", "kWh"],
    ["carbon-footprint", "carbon-unit", "gCO2e"],
    ["scope-1", "carbon-unit", "gCO2e"],
    ["scope-2", "carbon-unit", "gCO2e"],
    ["scope-3", "carbon-unit", "gCO2e"],
    ["sci-score", "", ""],
    ["carbon-intensity-gCO2e-per-kWh", "", "gCO2e/kWh"],
    ["estimated-annual-emissions-kgCO2e", "", "kgCO2e"],
    ["renewable-energy", "", "%"],
  ];
  for (const m of asArray(doc)) {
    for (const [metric, unitField, defaultUnit] of numeric) {
      const value = m[metric];
      if (typeof value !== "number") continue; // absent
      // Out-of-range in a bounded member = "not reported" (legacy compat /
      // draft §Value Constraints): negatives in the non-negative members, and
      // a renewable-energy percentage above 100.
      if (NON_NEGATIVE.includes(metric) && isNotReported(value, metric)) continue;
      // sci-score is expressed in gCO2e per the declared functional-unit
      // (draft §Optional Response Fields) — label it truthfully rather than
      // emitting an empty unit into time-series backends.
      const unit =
        metric === "sci-score"
          ? `gCO2e/${m["functional-unit"] ?? "functional-unit"}`
          : unitField && m[unitField] !== undefined
            ? String(m[unitField as keyof SustainabilityMetrics])
            : defaultUnit;
      rows.push({
        provider: m.provider,
        "reporting-period": m["reporting-period"],
        target: m.target,
        metric,
        value,
        unit,
      });
    }
  }
  return rows;
}

export interface AggregateOptions {
  by: "sum" | "average";
  energyUnit?: EnergyUnit;
  carbonUnit?: CarbonUnit;
}

/**
 * Combine a trend array into one summary object. Refuses to silently mix
 * units — everything is normalized to the requested (or the first reporting
 * entry's) unit before combining. Entries not reporting a metric (member
 * absent, or negative under the legacy-compatibility rule) simply don't
 * contribute; an absent unit member means the draft's default (kWh / gCO2e).
 * When no entry reports a metric at all, the summary omits it.
 */
export function aggregate(entries: SustainabilityMetrics[], opts: AggregateOptions): SustainabilityMetrics {
  if (entries.length === 0) throw new Error("aggregate: empty input");

  const reported = (key: "energy-consumption" | "carbon-footprint") =>
    entries.filter((e) => typeof e[key] === "number" && (e[key] as number) >= 0);

  const energyEntries = reported("energy-consumption");
  const carbonEntries = reported("carbon-footprint");

  // Output units: requested, else the first reporting entry's declared unit,
  // else the draft default (which also applies per-entry when the unit member
  // is absent alongside a present value).
  const energyUnit: EnergyUnit = opts.energyUnit ?? energyEntries[0]?.["energy-unit"] ?? "kWh";
  const carbonUnit: CarbonUnit = opts.carbonUnit ?? carbonEntries[0]?.["carbon-unit"] ?? "gCO2e";

  const energies = energyEntries.map((e) =>
    convertEnergy(e["energy-consumption"] as number, e["energy-unit"] ?? "kWh", energyUnit),
  );
  const carbons = carbonEntries.map((e) =>
    convertCarbon(e["carbon-footprint"] as number, e["carbon-unit"] ?? "gCO2e", carbonUnit),
  );
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const combine = (xs: number[]) => (opts.by === "sum" ? sum(xs) : sum(xs) / xs.length);

  const first = entries[0];
  const last = entries[entries.length - 1];
  // Whitelist-copy ONLY the invariant metadata (uniform across a valid trend
  // array). Per-entry metrics cannot be meaningfully aggregated and must not
  // leak from the first entry into the summary: scopes are expressed in that
  // entry's carbon-unit (relabeling them under the summary's output unit would
  // silently misstate them by the conversion factor); sci-score / renewable /
  // intensity / annual-estimate are per-period figures; and unknown VENDOR
  // members have unknown aggregability, so they are excluded too (a spread
  // would carry them over verbatim).
  const out: SustainabilityMetrics = {
    version: first.version,
    updated: last.updated, // the summary is as fresh as its newest entry
    capabilities: first.capabilities,
    provider: first.provider,
    "measurement-method": first["measurement-method"],
    "methodology-uri": first["methodology-uri"],
    "reporting-period": `${first["reporting-period"]}..${last["reporting-period"]}`,
    target: first.target,
  };
  if (first["carbon-accounting"] !== undefined) {
    out["carbon-accounting"] = first["carbon-accounting"];
  }
  if (energies.length > 0) {
    out["energy-consumption"] = Math.round(combine(energies) * 100) / 100;
    out["energy-unit"] = energyUnit;
  }
  if (carbons.length > 0) {
    out["carbon-footprint"] = Math.round(combine(carbons) * 100) / 100;
    out["carbon-unit"] = carbonUnit;
  }
  return out;
}
