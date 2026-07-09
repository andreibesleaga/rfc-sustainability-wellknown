/** Format transformations for a validated Sustainability Metadata Document. */
import { CarbonUnit, EnergyUnit, SustainabilityDocument, SustainabilityMetrics } from "./types";
import { convertCarbon, convertEnergy } from "./units";

function asArray(doc: SustainabilityDocument): SustainabilityMetrics[] {
  return Array.isArray(doc) ? doc : [doc];
}

const CSV_COLUMNS = [
  "provider",
  "reporting-period",
  "target-path",
  "energy-consumption",
  "energy-unit",
  "carbon-footprint",
  "carbon-unit",
] as const;

/** One CSV row per object (header row first), quoting values with commas. */
export function toCsvRows(doc: SustainabilityDocument): string[] {
  const q = (v: unknown) => {
    const s = v === undefined ? "" : String(v);
    return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
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
  "target-path"?: string;
  metric: string;
  value: number;
  unit: string;
}

/** One row per numeric metric (incl. scopes), for time-series ingestion. */
export function flatten(doc: SustainabilityDocument): FlatRecord[] {
  const rows: FlatRecord[] = [];
  const numeric: Array<[string, string]> = [
    ["energy-consumption", "energy-unit"],
    ["carbon-footprint", "carbon-unit"],
    ["scope-1", "carbon-unit"],
    ["scope-2", "carbon-unit"],
    ["scope-3", "carbon-unit"],
    ["sci-score", ""],
    ["carbon-intensity-gCO2-per-kWh", "gCO2e/kWh"],
    ["estimated-annual-emissions-kgCO2", "kgCO2"],
    ["renewable-energy", "%"],
  ];
  for (const m of asArray(doc)) {
    for (const [metric, unitField] of numeric) {
      const value = m[metric];
      if (typeof value !== "number" || value < 0) continue; // absent or "not reported"
      const unit = unitField && unitField in m ? String(m[unitField as keyof SustainabilityMetrics]) : unitField;
      rows.push({
        provider: m.provider,
        "reporting-period": m["reporting-period"],
        "target-path": m["target-path"],
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
 * units — everything is normalized to the requested (or the first entry's)
 * unit before combining.
 */
export function aggregate(entries: SustainabilityMetrics[], opts: AggregateOptions): SustainabilityMetrics {
  if (entries.length === 0) throw new Error("aggregate: empty input");
  const energyUnit = opts.energyUnit ?? entries[0]["energy-unit"];
  const carbonUnit = opts.carbonUnit ?? entries[0]["carbon-unit"];

  const energies = entries.map((e) =>
    e["energy-consumption"] < 0 ? 0 : convertEnergy(e["energy-consumption"], e["energy-unit"], energyUnit),
  );
  const carbons = entries.map((e) =>
    e["carbon-footprint"] < 0 ? 0 : convertCarbon(e["carbon-footprint"], e["carbon-unit"], carbonUnit),
  );
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const energy = opts.by === "sum" ? sum(energies) : sum(energies) / energies.length;
  const carbon = opts.by === "sum" ? sum(carbons) : sum(carbons) / carbons.length;

  const first = entries[0];
  const last = entries[entries.length - 1];
  return {
    ...first,
    "reporting-period": `${first["reporting-period"]}..${last["reporting-period"]}`,
    "energy-consumption": Math.round(energy * 100) / 100,
    "energy-unit": energyUnit,
    "carbon-footprint": Math.round(carbon * 100) / 100,
    "carbon-unit": carbonUnit,
  };
}
