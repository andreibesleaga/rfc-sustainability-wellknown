/**
 * CSV adapter — the bridge from every reporting tool that can export a table.
 *
 * ESG platforms (Workiva, Watershed, Persefoni, Microsoft Sustainability Manager,
 * Salesforce Net Zero Cloud, SAP, Sweep, Greenly, Normative, Plan A …) have no
 * free API a publisher may republish from, but all of them export CSV. One
 * row per reporting period, with these columns (header names are matched
 * case-insensitively, spaces and underscores ignored; unknown columns are
 * ignored; a missing optional column is "not reported"):
 *
 *   period            YYYY | YYYY-MM | YYYY-MM-DD        (required)
 *   energy            number                             (optional)
 *   energy_unit       Wh | kWh | MWh | GWh               (default kWh)
 *   carbon            number                             (optional)
 *   carbon_unit       gCO2e | kgCO2e | mtCO2e            (default kgCO2e)
 *   scope_1 scope_2 scope_3   numbers in carbon_unit     (optional)
 *   carbon_accounting location-based | market-based      (optional)
 *   renewable_percent 0..100                             (optional)
 *   provider, measurement_method, methodology_uri, target, target_type,
 *   disclosure_uri, updated                              (optional per row; the
 *                                                        adapter's config supplies defaults)
 *
 * Nothing is converted, estimated or apportioned: a cell is the figure. Each row is
 * checked before it is used, and a row that fails a check is skipped and reported
 * through `onSkip` with the column and the value, never published and never allowed
 * to take the whole endpoint down: a period that is not YYYY / YYYY-MM / YYYY-MM-DD;
 * a numeric cell that is not a number in the export's locale (`decimalComma`); a
 * negative energy or carbon total (scopes may be negative, for removals); a
 * renewable share outside 0..100; a unit, accounting basis or target type the draft
 * does not define; a methodology or disclosure link that is not https; an `updated`
 * that is not an RFC 3339 date-time; no measurement method (it is a claim, never
 * defaulted); and neither a figure nor a disclosure link.
 */
import { readFileSync } from "node:fs";
import { CarbonAccounting, CarbonUnit, EnergyUnit, RawMetrics, ServiceQuery, SourceAdapter, TARGET_TYPES, TargetType } from "../types";
import { UPDATED_RE } from "../validate";
import { PERIOD_RE } from "../normalize";
import { NotFoundError } from "../publisher";

export interface CsvAdapterConfig {
  /** CSV text, or a path to a file when `file` is used instead. */
  text?: string;
  file?: string;
  /** Defaults for rows that do not carry the column. */
  provider: string;
  methodologyUri: string;
  /** How the figures were obtained, unless a measurement_method column says so per row. Never defaulted: it is a claim. */
  measurementMethod?: string;
  target?: string;
  targetType?: TargetType;
  disclosureUri?: string;
  /** Column separator; `,` by default, `;` for exports from spreadsheets in many locales. */
  separator?: "," | ";" | "\t";
  /** Decimal comma in numbers (`1.234,5`). Default false. */
  decimalComma?: boolean;
  capabilities?: "basic" | "extended";
  /** Called for every row left out, with the reason. */
  onSkip?: (line: number, reason: string) => void;
}

const ENERGY_UNITS: EnergyUnit[] = ["Wh", "kWh", "MWh", "GWh"];
const CARBON_UNITS: CarbonUnit[] = ["gCO2e", "kgCO2e", "mtCO2e"];
const ACCOUNTING: CarbonAccounting[] = ["location-based", "market-based"];

/** RFC 4180 fields: quotes, doubled quotes, separators inside quotes, CRLF. */
export function parseCsv(text: string, separator = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === separator) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIASES: Record<string, string> = {
  period: "period", reportingperiod: "period", year: "period", month: "period",
  energy: "energy", energyconsumption: "energy", energykwh: "energy", electricity: "energy",
  energyunit: "energyUnit", unit: "energyUnit",
  carbon: "carbon", carbonfootprint: "carbon", emissions: "carbon", totalemissions: "carbon", co2e: "carbon", tco2e: "carbon",
  carbonunit: "carbonUnit", emissionsunit: "carbonUnit",
  scope1: "scope1", scope2: "scope2", scope3: "scope3",
  carbonaccounting: "carbonAccounting", accounting: "carbonAccounting", basis: "carbonAccounting",
  renewablepercent: "renewable", renewable: "renewable", renewableenergy: "renewable",
  provider: "provider", measurementmethod: "measurementMethod", method: "measurementMethod",
  methodologyuri: "methodologyUri", methodology: "methodologyUri",
  target: "target", targettype: "targetType", disclosureuri: "disclosureUri", disclosure: "disclosureUri",
  updated: "updated",
};

type Cell = { kind: "empty" } | { kind: "number"; value: number } | { kind: "invalid"; text: string };

/**
 * A numeric cell read in the export's locale, strictly: `1234.5` or `1,234.5` without `decimalComma`,
 * `1234,5` or `1.234,5` with it. Anything else is invalid rather than guessed, so a decimal comma read in
 * the wrong locale is reported instead of becoming a figure ten or a thousand times too large.
 */
function readNumber(cell: string | undefined, decimalComma: boolean): Cell {
  const s = (cell ?? "").trim();
  if (s === "") return { kind: "empty" };
  const plain = decimalComma ? /^-?\d+(,\d+)?$/ : /^-?\d+(\.\d+)?$/;
  const grouped = decimalComma ? /^-?\d{1,3}(\.\d{3})+(,\d+)?$/ : /^-?\d{1,3}(,\d{3})+(\.\d+)?$/;
  if (!plain.test(s) && !grouped.test(s)) return { kind: "invalid", text: s };
  const n = Number(decimalComma ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, ""));
  return Number.isFinite(n) ? { kind: "number", value: n } : { kind: "invalid", text: s };
}

const HTTPS_RE = /^https:\/\/[^\s/?#]+/;

/** The rows of a CSV as RawMetrics, in ascending period order; every row left out is reported through `onSkip`. */
export function rowsToMetrics(text: string, cfg: CsvAdapterConfig): RawMetrics[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""), cfg.separator ?? ",");
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => ALIASES[norm(h)] ?? norm(h));
  const col = (row: string[], name: string): string | undefined => {
    const i = header.indexOf(name);
    return i >= 0 ? row[i]?.trim() : undefined;
  };
  const out: RawMetrics[] = [];
  const dc = cfg.decimalComma ?? false;
  const localeHint = dc ? "decimalComma is set, so 1.234,5 style is expected" : "set decimalComma: true for 1.234,5 style exports";
  rows.slice(1).forEach((row, idx) => {
    const line = idx + 2;
    const skip = (reason: string) => cfg.onSkip?.(line, reason);
    const period = col(row, "period") ?? "";
    if (!PERIOD_RE.test(period)) return skip(`period ${JSON.stringify(period)} is not YYYY, YYYY-MM or YYYY-MM-DD`);

    const numbers: Record<string, number | undefined> = {};
    for (const c of ["energy", "carbon", "scope1", "scope2", "scope3", "renewable"]) {
      const cell = readNumber(col(row, c), dc);
      if (cell.kind === "invalid") return skip(`${c} ${JSON.stringify(cell.text)} is not a number (${localeHint})`);
      numbers[c] = cell.kind === "number" ? cell.value : undefined;
    }
    const { energy, carbon, renewable } = numbers;
    if ((energy !== undefined && energy < 0) || (carbon !== undefined && carbon < 0)) return skip("a negative energy or carbon total is not a value this format carries");
    if (renewable !== undefined && (renewable < 0 || renewable > 100)) return skip(`renewable_percent ${renewable} is outside 0 to 100`);

    const eu = col(row, "energyUnit") || "kWh";
    const cu = col(row, "carbonUnit") || "kgCO2e";
    if (!ENERGY_UNITS.includes(eu as EnergyUnit)) return skip(`energy unit ${JSON.stringify(eu)} is not Wh, kWh, MWh or GWh`);
    if (!CARBON_UNITS.includes(cu as CarbonUnit)) return skip(`carbon unit ${JSON.stringify(cu)} is not gCO2e, kgCO2e or mtCO2e`);

    const accounting = col(row, "carbonAccounting");
    if (accounting && !ACCOUNTING.includes(accounting as CarbonAccounting)) return skip(`carbon_accounting ${JSON.stringify(accounting)} is not location-based or market-based`);
    const targetType = col(row, "targetType") || cfg.targetType;
    if (targetType && !TARGET_TYPES.includes(targetType as TargetType)) return skip(`target type ${JSON.stringify(targetType)} is not one of ${TARGET_TYPES.join(", ")}`);
    const methodologyUri = col(row, "methodologyUri") || cfg.methodologyUri;
    if (!HTTPS_RE.test(methodologyUri)) return skip(`methodology_uri ${JSON.stringify(methodologyUri)} is not an absolute https URI`);
    const disclosureUri = col(row, "disclosureUri") || cfg.disclosureUri;
    if (disclosureUri && !HTTPS_RE.test(disclosureUri)) return skip(`disclosure_uri ${JSON.stringify(disclosureUri)} is not an absolute https URI`);
    const updated = col(row, "updated");
    if (updated && !UPDATED_RE.test(updated)) return skip(`updated ${JSON.stringify(updated)} is not an RFC 3339 date-time`);
    const measurementMethod = col(row, "measurementMethod") || cfg.measurementMethod;
    if (!measurementMethod) return skip("no measurement method: give the measurement_method column or the adapter's measurementMethod");
    if (energy === undefined && carbon === undefined && !disclosureUri) return skip("no figure and no disclosure link: not a declaration");

    const m: RawMetrics = {
      provider: col(row, "provider") || cfg.provider,
      measurementMethod,
      methodologyUri,
      reportingPeriod: period,
      capabilities: cfg.capabilities ?? "basic",
      ...(updated ? { updated } : {}),
      ...(col(row, "target") || cfg.target ? { target: col(row, "target") || cfg.target } : {}),
      ...(targetType ? { targetType: targetType as TargetType } : {}),
      ...(energy !== undefined ? { energy: { value: energy, unit: eu as EnergyUnit } } : {}),
      ...(carbon !== undefined ? { carbon: { value: carbon, unit: cu as CarbonUnit } } : { carbonUnitHint: cu as CarbonUnit }),
      ...(accounting ? { carbonAccounting: accounting as CarbonAccounting } : {}),
      ...(disclosureUri ? { disclosureUri } : {}),
      // Scopes may be negative where the accounting conveys removals (draft -07); they are not range-checked.
      ...(numbers.scope1 !== undefined ? { scope1: numbers.scope1 } : {}),
      ...(numbers.scope2 !== undefined ? { scope2: numbers.scope2 } : {}),
      ...(numbers.scope3 !== undefined ? { scope3: numbers.scope3 } : {}),
      ...(renewable !== undefined ? { renewableEnergy: renewable } : {}),
    };
    out.push(m);
  });
  out.sort((a, b) => (a.reportingPeriod < b.reportingPeriod ? -1 : a.reportingPeriod > b.reportingPeriod ? 1 : 0));
  return out;
}

/** Serve the rows of a CSV export; the newest period for a Basic request, the matching rows for an Extended one. */
export function csvAdapter(cfg: CsvAdapterConfig): SourceAdapter {
  const capabilities = cfg.capabilities ?? "basic";
  const load = () => rowsToMetrics(cfg.text ?? readFileSync(cfg.file as string, "utf8"), cfg);
  return {
    name: "csv",
    capabilities,
    async fetch(query: ServiceQuery): Promise<RawMetrics | RawMetrics[]> {
      const rows = load();
      if (rows.length === 0) throw new NotFoundError("csv: no usable row (see onSkip)");
      if (capabilities === "basic" || !query.period) return rows[rows.length - 1];
      const inside = rows.filter((r) => r.reportingPeriod.startsWith(query.period as string));
      if (inside.length === 0) throw new NotFoundError();
      return inside;
    },
  };
}
