/**
 * The gateway's report about ITSELF (`target-type: "service"`).
 *
 * This is a worked example of requirement "produce the document from a
 * publisher adapter rather than by hand": it composes the published
 * `computedAdapter` (energy x grid carbon intensity -> carbon) and adds the
 * members that adapter does not carry.
 *
 * The figures are an ENGINEERING ESTIMATE, not a measurement: the container's
 * average power draw is modelled, not metered. Every assumption, and the source
 * of the grid intensity factor, is stated in `gateway/METHODOLOGY.md`, which is
 * what `methodology-uri` points at. `measurement-method` is therefore
 * `third-party-modeled` and not `hardware-metered`.
 */
import {
  computedAdapter,
  type RawMetrics,
  type SourceAdapter,
} from "sustainability-wellknown-publisher";

export interface SelfReportConfig {
  target: string;
  provider: string;
  methodologyUri: string;
  disclosureUri: string;
  /** "YYYY" or "YYYY-MM". Defaults to the most recently completed month. */
  period?: string;
  /** Modelled average power draw of the running container, watts. */
  watts: number;
  /** Grid carbon intensity, gCO2e/kWh (cited in METHODOLOGY.md). */
  gridIntensity: number;
  /** Clock, injectable so the default period is deterministic in tests. */
  now?: Date;
}

/** Days in a calendar month (UTC). */
function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** Whole hours in a `YYYY` or `YYYY-MM` calendar period (UTC). */
export function periodHours(period: string): number {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(period);
  if (!m) {
    throw new Error(`self-report: period must be "YYYY" or "YYYY-MM" (got "${period}")`);
  }
  const year = Number(m[1]);
  if (m[2] === undefined) {
    const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
    return days * 24;
  }
  return daysInMonth(year, Number(m[2])) * 24;
}

/** The instant a calendar period closed, used as the document's `updated`. */
export function periodClose(period: string): string {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(period);
  if (!m) throw new Error(`self-report: bad period "${period}"`);
  const year = Number(m[1]);
  const end =
    m[2] === undefined ? Date.UTC(year + 1, 0, 1) : Date.UTC(year, Number(m[2]), 1);
  return new Date(end).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Most recently completed full calendar month, "YYYY-MM". */
export function lastCompletedMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function selfReportAdapter(config: SelfReportConfig): SourceAdapter {
  const period = config.period ?? lastCompletedMonth(config.now ?? new Date());
  const kwh = (config.watts * periodHours(period)) / 1000;

  const inner = computedAdapter({
    provider: config.provider,
    methodologyUri: config.methodologyUri,
    measurementMethod: "third-party-modeled",
    reportingPeriod: period,
    energy: { value: Number(kwh.toFixed(4)), unit: "kWh" },
    gridIntensity: config.gridIntensity,
    carbonAccounting: "location-based",
    capabilities: "basic",
  });

  return {
    name: "gateway-self-report",
    capabilities: "basic",
    async fetch(query): Promise<RawMetrics> {
      const raw = (await inner.fetch(query)) as RawMetrics;
      return {
        ...raw,
        updated: periodClose(period),
        target: config.target,
        targetType: "service",
        disclosureUri: config.disclosureUri,
      };
    },
  };
}
