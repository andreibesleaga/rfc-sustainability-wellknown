/** Format transformations for a validated Sustainability Declaration. */
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
  "target-type", // optional (-04): empty cell when absent, like the other optional members
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
  /** The optional -04 classification hint for `target`; omitted when absent. */
  "target-type"?: string;
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
      // (draft §Optional Members) — label it truthfully rather than
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
        // Pass the classification hint through as a plain string when present.
        ...(typeof m["target-type"] === "string" ? { "target-type": m["target-type"] } : {}),
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
 * The `reporting-period` of a summary: `"<first>..<last>"`.
 *
 * It is deliberately NOT a draft `period-value`. The draft's §Mandatory Members
 * allows `YYYY`, `YYYY-MM` and `YYYY-MM-DD` and nothing else, and a range is
 * none of them — `validateDocument()` rejects an object carrying one, which is
 * the guarantee that a summary cannot be mistaken for, or republished as, a
 * declaration.
 */
export type PeriodRange = `${string}..${string}`;

/**
 * What {@link aggregate} returns: a CLIENT-SIDE SUMMARY of a trend, **not a
 * declaration**.
 *
 * This is a reading convenience — "what did these twelve months come to?" — and
 * it is not a conformant object under any circumstances:
 *
 *  - its `reporting-period` is a {@link PeriodRange} (`"2026-01..2026-12"`),
 *    which is not one of the three forms the draft defines, so
 *    `validateDocument()` refuses it;
 *  - it carries no `signed` member and cannot: a signature covers the object it
 *    was made for, and nothing signed this one;
 *  - the draft defines exactly one way to combine periods, the server-side
 *    aggregate of §Extended Query Parameters step 5, with rules this function
 *    does not apply (one precision, no overlap, coverage of P, the MUST-agree
 *    members). A publisher wanting a figure for a longer period asks its own
 *    origin for that period and serves what step 5 produces.
 *
 * So: read it, print it, put it in a spreadsheet. Do not publish it, do not sign
 * it, and do not feed it back into anything that expects a declaration.
 */
export type AggregateSummary = Omit<SustainabilityMetrics, "reporting-period" | "signed"> & {
  "reporting-period": PeriodRange;
  /** Never present: a summary is not signed, and is not a declaration to sign. */
  signed?: never;
};

/**
 * Combine a trend array into one {@link AggregateSummary} — a reading
 * convenience, **not a declaration**: see that type for why it can never be
 * published, signed or round-tripped as one.
 *
 * Refuses to silently mix units — everything is normalized to the requested (or
 * the first reporting entry's) unit before combining. Entries not reporting a
 * metric (member absent, or out of range under the tolerance rules) simply
 * don't contribute; an absent unit member means the draft's default
 * (kWh / gCO2e). When no entry reports a metric at all, the summary omits it.
 */
export function aggregate(entries: SustainabilityMetrics[], opts: AggregateOptions): AggregateSummary {
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
  const out: AggregateSummary = {
    updated: last.updated, // the summary is as fresh as its newest entry
    capabilities: first.capabilities,
    provider: first.provider,
    "measurement-method": first["measurement-method"],
    "methodology-uri": first["methodology-uri"],
    // A RANGE, not a `period-value`: this is what stops a summary being read,
    // or republished, as a declaration (see AggregateSummary).
    "reporting-period": `${first["reporting-period"]}..${last["reporting-period"]}`,
    target: first.target,
  };
  if (first["carbon-accounting"] !== undefined) {
    out["carbon-accounting"] = first["carbon-accounting"];
  }
  // target-type (-04) classifies the invariant `target`, so it carries over —
  // but only when UNIFORM across every entry (a valid trend array shares one
  // value when present; entries lacking it make the classification non-uniform,
  // so the summary then omits it rather than guess).
  if (first["target-type"] !== undefined && entries.every((e) => e["target-type"] === first["target-type"])) {
    out["target-type"] = first["target-type"];
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
