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
 *
 * Service level: EXTENDED. The model is closed-form (watts x hours), so any
 * period the gateway has been live for can be reported, and a year or a month
 * can be sliced into months or days (draft §Optional Extended Query
 * Parameters). Only the hours inside `[liveSince, now)` count: a period wholly
 * before go-live has no data (the draft's no-data rule, 404), a period in
 * progress reports the completed portion to date. The `target` parameter is
 * ignored: the gateway is one process with no path prefixes to scope to, and
 * METHODOLOGY.md publishes that (empty) prefix set. The PARAMETERLESS document
 * is the most recently completed month, exactly as before — it is the
 * representation the detached signature covers.
 */
import {
  computedAdapter,
  NotFoundError,
  type RawMetrics,
  type ServiceQuery,
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
  /** The instant the gateway went live (RFC 3339); hours before it never count. */
  liveSince: string;
  /** Optional third-party attestation of this model (`verifiable-attestation-uri`). */
  verifiableAttestationUri?: string;
  /** Running clock, injectable so periods in progress are deterministic in tests. */
  clock?: () => Date;
}

const HOUR_MS = 3_600_000;
const PERIOD_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** UTC bounds `[start, end)` in ms of a `YYYY`, `YYYY-MM` or `YYYY-MM-DD` period. */
export function periodBounds(period: string): { start: number; end: number } {
  const m = PERIOD_RE.exec(period);
  if (!m) throw new Error(`self-report: period must be "YYYY", "YYYY-MM" or "YYYY-MM-DD" (got "${period}")`);
  const year = Number(m[1]);
  if (m[2] === undefined) return { start: Date.UTC(year, 0, 1), end: Date.UTC(year + 1, 0, 1) };
  const month = Number(m[2]);
  if (m[3] === undefined) return { start: Date.UTC(year, month - 1, 1), end: Date.UTC(year, month, 1) };
  const day = Number(m[3]);
  return { start: Date.UTC(year, month - 1, day), end: Date.UTC(year, month - 1, day + 1) };
}

/** Whole hours in a calendar period (UTC), ignoring the live window. */
export function periodHours(period: string): number {
  const { start, end } = periodBounds(period);
  return (end - start) / HOUR_MS;
}

/** Hours of `period` inside `[liveSince, now)` — the hours the model counts. */
export function liveHours(period: string, liveSince: number, now: number): number {
  const { start, end } = periodBounds(period);
  return Math.max(0, Math.min(end, now) - Math.max(start, liveSince)) / HOUR_MS;
}

/** The instant a calendar period closed, used as `updated` for a complete period. */
export function periodClose(period: string): string {
  return new Date(periodBounds(period).end).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Most recently completed full calendar month, "YYYY-MM". */
export function lastCompletedMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

/**
 * The slices of `period` at `granularity` (draft: an array only when the
 * granularity is finer than the period; otherwise the single period).
 */
export function slices(period: string, granularity: string | undefined): string[] {
  const m = PERIOD_RE.exec(period);
  if (!m) throw new Error(`self-report: bad period "${period}"`);
  const year = Number(m[1]);
  const isYear = m[2] === undefined;
  const isMonth = m[2] !== undefined && m[3] === undefined;
  if (granularity === "monthly" && isYear) {
    return Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`);
  }
  if (granularity === "daily" && (isYear || isMonth)) {
    const { start, end } = periodBounds(period);
    const out: string[] = [];
    for (let t = start; t < end; t += 24 * HOUR_MS) {
      const d = new Date(t);
      out.push(`${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`);
    }
    return out;
  }
  return [period];
}

export function selfReportAdapter(config: SelfReportConfig): SourceAdapter {
  const clock = config.clock ?? (() => new Date());
  const liveSince = Date.parse(config.liveSince);
  if (Number.isNaN(liveSince)) throw new Error(`self-report: liveSince is not a date-time ("${config.liveSince}")`);

  /** One report for one slice, via the published computed adapter. */
  const report = async (slice: string, now: number): Promise<RawMetrics | undefined> => {
    const hours = liveHours(slice, liveSince, now);
    if (hours <= 0) return undefined;
    const complete = periodBounds(slice).end <= now;
    const inner = computedAdapter({
      provider: config.provider,
      methodologyUri: config.methodologyUri,
      measurementMethod: "third-party-modeled",
      reportingPeriod: slice,
      energy: { value: Number(((config.watts * hours) / 1000).toFixed(4)), unit: "kWh" },
      gridIntensity: config.gridIntensity,
      carbonAccounting: "location-based",
      capabilities: "extended",
    });
    const raw = (await inner.fetch({})) as RawMetrics;
    return {
      ...raw,
      // A complete period is stamped with its close; a period in progress with
      // the current hour, so its ETag is stable within the hour.
      updated: complete
        ? periodClose(slice)
        : new Date(Math.floor(now / HOUR_MS) * HOUR_MS).toISOString().replace(/\.\d{3}Z$/, "Z"),
      target: config.target,
      targetType: "service",
      disclosureUri: config.disclosureUri,
      ...(config.verifiableAttestationUri ? { verifiableAttestationUri: config.verifiableAttestationUri } : {}),
    };
  };

  return {
    name: "gateway-self-report",
    capabilities: "extended",
    async fetch(query: ServiceQuery): Promise<RawMetrics | RawMetrics[]> {
      const now = clock().getTime();
      // `query.target` is deliberately ignored (see the module comment).
      const period = query.period ?? config.period ?? lastCompletedMonth(new Date(now));
      const parts = slices(period, query.granularity);
      const reports: RawMetrics[] = [];
      for (const slice of parts) {
        const r = await report(slice, now);
        if (r) reports.push(r);
      }
      if (reports.length === 0) throw new NotFoundError();
      return parts.length === 1 ? reports[0] : reports;
    },
  };
}
