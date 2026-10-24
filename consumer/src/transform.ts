/** Format transformations and totals for a validated Sustainability Declaration. */
import { comparePeriodStart, compareDateTimes, Period, periodsOverlap } from "./period";
import { isNotReported, NUMERIC_KEYS } from "./sentinel";
import { CarbonAccounting, CarbonUnit, EnergyUnit, isCarbonUnit, isEnergyUnit, TargetType } from "./tokens";
import { SignatureResult, SustainabilityDocument, SustainabilityMetrics } from "./types";
import { convertCarbon, convertEnergy } from "./units";
import { targetsEqual } from "./target";

function asArray(doc: SustainabilityDocument): SustainabilityMetrics[] {
  return Array.isArray(doc) ? doc : [doc];
}

/**
 * Where an export came from. A row without its source is a figure without the
 * retrieval URI that relative references in it resolve against, and without
 * the origin that claims it.
 */
export interface ExportSource {
  /** The URL of the final response (`FetchResult.url`). */
  url: string;
  /** The outcome of the signature check for each object, in document order, when it was made. */
  signatures?: SignatureResult[];
}

/** The origin that served the final response: every figure is that origin's claim. */
const claimedBy = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
};

/** `unsigned`, `verified` or `unverified`; empty when no check was made. */
const signatureStatus = (source: ExportSource, index: number): string => source.signatures?.[index]?.status ?? "";

const CSV_COLUMNS = [
  "source-url",
  "claimed-by",
  "signature",
  "provider",
  "target",
  "target-type",
  "carbon-accounting",
  "period-start",
  "period-end",
  "energy-consumption",
  "energy-unit",
  "carbon-footprint",
  "carbon-unit",
] as const;

/** One CSV row per object (header row first), quoting values with commas. */
export function toCsvRows(doc: SustainabilityDocument, source: ExportSource): string[] {
  const q = (v: unknown) => {
    const s = v === undefined ? "" : String(v);
    // RFC 4180: quote any value containing a comma, a double quote, or a
    // line break (a raw newline would split the row; a raw quote mis-parses).
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [CSV_COLUMNS.join(",")];
  asArray(doc).forEach((m, i) => {
    const cells: Record<(typeof CSV_COLUMNS)[number], unknown> = {
      "source-url": source.url,
      "claimed-by": claimedBy(source.url),
      signature: signatureStatus(source, i),
      provider: m.provider,
      target: m.target,
      "target-type": m["target-type"],
      "carbon-accounting": m["carbon-accounting"],
      "period-start": m.period.start,
      "period-end": m.period.end,
      "energy-consumption": m["energy-consumption"],
      "energy-unit": m["energy-unit"],
      "carbon-footprint": m["carbon-footprint"],
      "carbon-unit": m["carbon-unit"],
    };
    rows.push(CSV_COLUMNS.map((c) => q(cells[c])).join(","));
  });
  return rows;
}

/**
 * Newline-delimited JSON, one line per object. Each line wraps the object
 * unchanged in the claim it is: who made it and where it was retrieved from.
 */
export function toNdjson(doc: SustainabilityDocument, source: ExportSource): string {
  return asArray(doc)
    .map((m, i) =>
      JSON.stringify({
        "source-url": source.url,
        "claimed-by": claimedBy(source.url),
        ...(source.signatures?.[i] ? { signature: signatureStatus(source, i) } : {}),
        declaration: m,
      }),
    )
    .join("\n");
}

export interface FlatRecord {
  /** The URL of the final response and the origin that claims the figure. */
  "source-url": string;
  "claimed-by": string;
  provider: string;
  /** The mandatory subject of the object. */
  target: string;
  /** The optional classification hint for `target`; omitted when absent. */
  "target-type"?: string;
  /** Omitted when the object states no accounting method. */
  "carbon-accounting"?: string;
  /** The two bounds of the object, as it states them. */
  period: Period;
  metric: string;
  value: number;
  unit: string;
}

/** The non-negative members, as a plain string list for membership checks. */
const NON_NEGATIVE: readonly string[] = NUMERIC_KEYS;

/**
 * One row per numeric metric (incl. scopes), for time-series ingestion.
 *
 * A value that cannot be a figure of a non-negative member (negative, not
 * finite) is skipped; a negative scope value is real data (net accounting) and
 * flows through. Absent unit members fall back to the draft's defaults
 * (kWh / gCO2e).
 */
export function flatten(doc: SustainabilityDocument, source: ExportSource): FlatRecord[] {
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
      if (NON_NEGATIVE.includes(metric) && isNotReported(value, metric)) continue;
      // sci-score is expressed in gCO2e per the declared functional-unit:
      // label it truthfully rather than emitting an empty unit.
      const unit =
        metric === "sci-score"
          ? `gCO2e/${m["functional-unit"] ?? "functional-unit"}`
          : unitField && m[unitField] !== undefined
            ? String(m[unitField as keyof SustainabilityMetrics])
            : defaultUnit;
      rows.push({
        "source-url": source.url,
        "claimed-by": claimedBy(source.url),
        provider: m.provider,
        target: m.target,
        ...(typeof m["target-type"] === "string" ? { "target-type": m["target-type"] } : {}),
        ...(typeof m["carbon-accounting"] === "string" ? { "carbon-accounting": m["carbon-accounting"] } : {}),
        period: m.period,
        metric,
        value,
        unit,
      });
    }
  }
  return rows;
}

export interface TotalOptions {
  /** The unit of the energy total; default the unit of the first object reporting energy. */
  energyUnit?: EnergyUnit;
  /** The unit of the carbon total and the scopes; default the unit of the first object reporting any of them. */
  carbonUnit?: CarbonUnit;
}

/**
 * What {@link total} returns: a CLIENT-SIDE SUMMARY, **not a declaration**. It
 * carries none of the mandatory members (`updated`, `provider`, `methodology-uri`
 * and the rest), so `validateDocument()` refuses it, and nothing signed it.
 * Read it, print it, put it in a spreadsheet; do not publish it. A publisher
 * wanting a figure for a longer period serves one object for that period.
 */
export interface TotalSummary {
  target: string;
  /** Only when every object carries the same value. */
  "target-type"?: TargetType;
  /** From the earliest `start` to the latest `end` of the objects added. */
  period: Period;
  /** `contiguous` when each period ends where the next starts, `gaps` when any does not: the total covers the periods added, not the span. */
  coverage: "contiguous" | "gaps";
  "carbon-accounting"?: CarbonAccounting;
  "energy-consumption"?: number;
  "energy-unit"?: EnergyUnit;
  "carbon-footprint"?: number;
  "carbon-unit"?: CarbonUnit;
  "scope-1"?: number;
  "scope-2"?: number;
  "scope-3"?: number;
  /** How many objects were added. */
  objects: number;
  /** Members that some of the objects do not report, so the figure covers fewer periods than `objects`. */
  incomplete?: string[];
  /** Members left out because an object states a unit this consumer does not know. */
  notSummable?: string[];
}

export type TotalRefusal = "no-objects" | "mixed-targets" | "overlapping-periods" | "mixed-accounting";

/** Thrown when objects may not be added; `reason` is the precondition of draft Section 5.3 that fails. */
export class TotalPreconditionError extends Error {
  constructor(
    public readonly reason: TotalRefusal,
    detail: string,
  ) {
    super(detail);
    this.name = "TotalPreconditionError";
  }
}

const SUMMED = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3"] as const;
type Summed = (typeof SUMMED)[number];

const span = (p: Period) => `${p.start}/${p.end}`;

const latestEnd = (sorted: SustainabilityMetrics[]): string =>
  sorted.reduce((end, e) => (compareDateTimes(e.period.end, end) > 0 ? e.period.end : end), sorted[0].period.end);

/** Float noise from unit conversion is not data: 12 significant digits keep every figure the formats allow. */
const tidy = (x: number): number => Number(x.toPrecision(12));

/**
 * Add the figures of several objects (draft Section 5.3): across objects for
 * one `target` whose periods do not overlap and that declare the same
 * `carbon-accounting` value or none, after conversion to one unit. Two periods
 * that meet do not overlap. Anything else is refused with the reason, because a
 * year and its months are two views of the same figures, not additional ones.
 *
 * Only `energy-consumption`, `carbon-footprint` and the three scopes are added;
 * a scope keeps its sign. A member an object does not report adds nothing and
 * is listed in `incomplete`; one whose unit is unknown is not added at all.
 */
export function total(entries: SustainabilityMetrics[], opts: TotalOptions = {}): TotalSummary {
  if (entries.length === 0) throw new TotalPreconditionError("no-objects", "nothing to add: no declaration objects");

  const sorted = [...entries].sort((a, b) => comparePeriodStart(a.period, b.period));
  const first = sorted[0];

  const other = sorted.find((e) => !targetsEqual(e.target, first.target, first["target-type"]));
  if (other) {
    throw new TotalPreconditionError(
      "mixed-targets",
      `objects for different targets are not added: "${first.target}" and "${other.target}"`,
    );
  }
  const accounting = first["carbon-accounting"];
  const differing = sorted.find((e) => e["carbon-accounting"] !== accounting);
  if (differing) {
    throw new TotalPreconditionError(
      "mixed-accounting",
      `objects with different carbon-accounting are not added: ${accounting ?? "none"} and ${differing["carbon-accounting"] ?? "none"}`,
    );
  }
  // Sorted by start, an overlap anywhere shows between neighbours.
  for (let i = 1; i < sorted.length; i++) {
    if (periodsOverlap(sorted[i - 1].period, sorted[i].period)) {
      throw new TotalPreconditionError(
        "overlapping-periods",
        `periods overlap: ${span(sorted[i - 1].period)} and ${span(sorted[i].period)}`,
      );
    }
  }

  const energyUnit: EnergyUnit =
    opts.energyUnit ?? sorted.find((e) => typeof e["energy-consumption"] === "number")?.["energy-unit"] ?? "kWh";
  const carbonUnit: CarbonUnit =
    opts.carbonUnit ??
    sorted.find((e) => SUMMED.slice(1).some((k) => typeof e[k] === "number"))?.["carbon-unit"] ??
    "gCO2e";

  const out: TotalSummary = {
    target: first.target,
    period: { start: first.period.start, end: latestEnd(sorted) },
    coverage: sorted.every((e, i) => i === 0 || compareDateTimes(sorted[i - 1].period.end, e.period.start) === 0) ? "contiguous" : "gaps",
    objects: sorted.length,
  };
  if (accounting !== undefined) out["carbon-accounting"] = accounting;
  if (first["target-type"] !== undefined && sorted.every((e) => e["target-type"] === first["target-type"])) {
    out["target-type"] = first["target-type"];
  }

  const incomplete: string[] = [];
  const notSummable: string[] = [];
  for (const key of SUMMED) {
    const energy = key === "energy-consumption";
    // A negative or non-finite energy or footprint is not a figure; a negative scope is.
    const scope = key.startsWith("scope-");
    const reporting = sorted.filter((e) => typeof e[key] === "number" && (scope || !isNotReported(e[key], key)));
    if (reporting.length === 0) continue;
    const parts = reporting.map((e): number => {
      const unit = energy ? (e["energy-unit"] ?? "kWh") : (e["carbon-unit"] ?? "gCO2e");
      if (energy ? !isEnergyUnit(unit) : !isCarbonUnit(unit)) return NaN;
      return energy
        ? convertEnergy(e[key] as number, unit as EnergyUnit, energyUnit)
        : convertCarbon(e[key] as number, unit as CarbonUnit, carbonUnit);
    });
    if (parts.some(Number.isNaN)) {
      notSummable.push(key);
      continue;
    }
    if (reporting.length < sorted.length) incomplete.push(key);
    (out as unknown as Record<Summed, number>)[key] = tidy(parts.reduce((a, b) => a + b, 0));
  }
  if (out["energy-consumption"] !== undefined) out["energy-unit"] = energyUnit;
  if (SUMMED.slice(1).some((k) => out[k] !== undefined)) out["carbon-unit"] = carbonUnit;
  if (incomplete.length > 0) out.incomplete = incomplete;
  if (notSummable.length > 0) out.notSummable = notSummable;
  return out;
}

/** @deprecated Use {@link total}; it adds under the rules of draft Section 5.3 and takes no `by`. Removed in 0.9.0. */
export const aggregate = total;
