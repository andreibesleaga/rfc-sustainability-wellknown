/**
 * The gateway's report about ITSELF (`target-type: "service"`).
 *
 * This is a worked example of producing the document from a publisher adapter
 * rather than by hand: it composes the published `computedAdapter` (energy x
 * grid carbon intensity -> carbon) and adds the members that adapter does not
 * carry.
 *
 * The figures are an ENGINEERING ESTIMATE, not a measurement: the container's
 * average power draw is modelled, not metered. Every assumption, and the source
 * of the grid intensity factor, is stated in `gateway/METHODOLOGY.md`, which is
 * what `methodology-uri` points at. `measurement-method` is therefore
 * `third-party-modeled` and not `hardware-metered`.
 *
 * Service level: EXTENDED. The model is closed-form (watts x hours), so the
 * adapter can state the objects it HOLDS and leave the selection to the
 * publisher (draft §Query Parameters: a server returns the objects it holds
 * that satisfy the parameters, and computes no aggregate). Only the hours
 * inside `[liveSince, now)` count, with `now` the start of the current UTC day.
 *
 * The held set:
 *
 *  - every whole day of the most recent {@link HELD_DAYS} days of the live window;
 *  - every whole calendar month and every whole calendar year of the live window;
 *  - the go-live month, from the day the gateway went live to the end of that
 *    month, when it is not a whole month, and the month in progress, from its
 *    first day to `now`, each only when it holds at least one whole day. Their
 *    periods are exactly the hours the figures count; being partial, they are
 *    not selected by `granularity=monthly`.
 *
 * It is bounded by construction: at most {@link HELD_MAX} objects at any clock,
 * so a selection is never cut (the oldest whole months go first, those a whole
 * year already covers before any other).
 *
 * The `target` parameter selects by exact match against the report's own
 * `target`; any other value selects nothing. A request that names no parameter
 * is answered with one object, the most recently completed month (the publisher
 * option `representation: "single"`). When the deployment holds a key, every
 * object it serves carries its own embedded `signed` member.
 */
import {
  computedAdapter,
  lastFullMonthPeriod,
  NotFoundError,
  toUtcQueryValue,
  type Period,
  type RawMetrics,
  type ServiceQuery,
  type SourceAdapter,
} from "sustainability-wellknown-publisher";

export interface SelfReportConfig {
  target: string;
  provider: string;
  methodologyUri: string;
  disclosureUri: string;
  /** A pinned period for the request that names no parameter. Defaults to the most recently completed month. */
  period?: Period;
  /** Modelled average power draw of the running container, watts. */
  watts: number;
  /**
   * Average power per calendar month ("YYYY-MM" -> watts) that the operator
   * entered from the platform's own metrics (data/_self-measured.json). A
   * month listed here uses its own figure; every other month uses `watts`.
   */
  wattsByMonth?: Record<string, number>;
  /** When each entered month ("YYYY-MM") was entered (RFC 3339); the objects that cover it are not older. */
  enteredAtByMonth?: Record<string, string>;
  /** The instant the model's figures were last restated (RFC 3339); an earlier period is not older. */
  modelChangedAt?: string;
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
const DAY_MS = 24 * HOUR_MS;

/** Whole days held, counted back from the start of the current day. */
export const HELD_DAYS = 120;
/** The most objects the self report ever holds, so that no selection is cut. */
export const HELD_MAX = 200;

/**
 * Four significant figures. A fixed number of decimals would distort the small
 * figures this model produces: a measured month of 0.0149 W gives 0.3576 Wh a
 * day, and the days of a month must still add up to the month.
 */
export function significant(x: number, digits = 4): number {
  return x === 0 ? 0 : Number(x.toPrecision(digits));
}

/** The instant of an RFC 3339 date-time, in ms. */
export const epochMs = (dateTime: string): number => Date.parse(toUtcQueryValue(dateTime));

/** An instant, in ms, as an RFC 3339 date-time with `T` and `Z` in upper case and no fraction. */
export const dateTimeOf = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The first instant of the UTC day that contains `ms`. */
export const startOfDay = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/** The `YYYY-MM` label of the UTC month that contains a date-time: the key of the operator-entered power table. */
export const monthKey = (dateTime: string): string => dateTimeOf(epochMs(dateTime)).slice(0, 7);

/** Hours in a period. */
export function periodHours(period: Period): number {
  return (epochMs(period.end) - epochMs(period.start)) / HOUR_MS;
}

/** Hours of `period` inside `[liveSince, now)`: the hours the model counts. */
export function liveHours(period: Period, liveSince: number, now: number): number {
  return overlapHours({ start: epochMs(period.start), end: epochMs(period.end) }, liveSince, now);
}

/** A period in ms, for the arithmetic below: a bound is computed once and never parsed again. */
interface Span {
  start: number;
  end: number;
}

const overlapHours = (span: Span, liveSince: number, now: number): number =>
  Math.max(0, Math.min(span.end, now) - Math.max(span.start, liveSince)) / HOUR_MS;

const periodOf = (span: Span): Period => ({ start: dateTimeOf(span.start), end: dateTimeOf(span.end) });

/** The first instant of the UTC month `months` after the one that contains `ms`. */
function monthStart(ms: number, months = 0): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
}

/** The first instant of the UTC year `years` after the one that contains `ms`. */
function yearStart(ms: number, years = 0): number {
  return Date.UTC(new Date(ms).getUTCFullYear() + years, 0, 1);
}

/**
 * The objects the self report holds at `now` (ms, a day start) for a gateway
 * that went live at `liveSince` (ms); see the module comment. Ascending by
 * the instants of `start` and then `end`. UTC has no change of clock, so a
 * day is 24 hours and the bounds of a month and a year are `Date.UTC` of its
 * first day.
 */
function heldSpans(liveSince: number, now: number): Span[] {
  const first = startOfDay(liveSince);
  if (first >= now) return [];

  const days: Span[] = [];
  for (let t = Math.max(first, now - HELD_DAYS * DAY_MS); t < now; t += DAY_MS) days.push({ start: t, end: t + DAY_MS });

  // Whole months and years of the live window.
  const months: Span[] = [];
  const years: Span[] = [];
  for (let t = yearStart(first); t < now; t = yearStart(t, 1)) {
    const year = { start: t, end: yearStart(t, 1) };
    if (year.start >= first && year.end <= now) years.push(year);
  }
  for (let t = monthStart(first); t < now; t = monthStart(t, 1)) {
    const month = { start: t, end: monthStart(t, 1) };
    if (month.start >= first && month.end <= now) months.push(month);
  }

  // The go-live month and the month in progress, when not whole.
  const edges: Span[] = [];
  const goLiveEnd = monthStart(first, 1);
  if (first > monthStart(first) && goLiveEnd <= now) edges.push({ start: first, end: goLiveEnd });
  const inProgress = Math.max(monthStart(now), first);
  // A month in progress that is only one day old is that day, which is held already.
  if (now > monthStart(now) && now - inProgress > DAY_MS) edges.push({ start: inProgress, end: now });

  // Over the bound, drop the oldest months a held year covers, then the oldest other months, then the oldest years.
  const covered = (m: Span) => years.some((y) => y.start <= m.start && m.end <= y.end);
  const droppable = [...months.filter(covered), ...months.filter((m) => !covered(m)), ...years];
  const excess = Math.max(0, days.length + edges.length + months.length + years.length - HELD_MAX);
  const dropped = new Set(droppable.slice(0, excess));

  return [...days, ...months.filter((p) => !dropped.has(p)), ...years.filter((p) => !dropped.has(p)), ...edges].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  );
}

/** {@link heldSpans} as periods. */
export const heldPeriods = (liveSince: number, now: number): Period[] => heldSpans(liveSince, now).map(periodOf);

export function selfReportAdapter(config: SelfReportConfig): SourceAdapter {
  const clock = config.clock ?? (() => new Date());
  const liveSince = epochMs(config.liveSince);
  if (Number.isNaN(liveSince)) throw new Error(`self-report: liveSince is not a date-time ("${config.liveSince}")`);

  const byMonth = config.wattsByMonth ?? {};
  const measuredMonths = Object.keys(byMonth).sort();
  // One provider text for every period and granularity, so that the objects of
  // a trend agree and a year names the same publisher and method as its months.
  const providerText =
    measuredMonths.length === 0
      ? config.provider
      : `${config.provider}. Average power for ${measuredMonths.join(", ")} was entered by the operator from ` +
        `the hosting platform's own metrics; every other month uses the ${config.watts} W assumption ` +
        `(see methodology-uri)`;
  const wattsFor = (month: string): number => byMonth[month] ?? config.watts;

  /** Watt-hours of a span: each month's hours inside the live window and the span, at that month's power. */
  const wattHours = (span: Span, now: number): number => {
    let sum = 0;
    for (let t = monthStart(span.start); t < span.end; t = monthStart(t, 1)) {
      const inside = { start: Math.max(t, span.start), end: Math.min(monthStart(t, 1), span.end) };
      sum += overlapHours(inside, liveSince, now) * wattsFor(dateTimeOf(t).slice(0, 7));
    }
    return sum;
  };

  const enteredAt = Object.entries(config.enteredAtByMonth ?? {}).map(([month, at]) => ({ month, at: epochMs(at) }));
  const restated = config.modelChangedAt === undefined ? 0 : epochMs(config.modelChangedAt);

  /**
   * `updated` of a period: its close, or the later instant its figures were
   * restated or entered, never after `now`. A period in progress states `now`.
   */
  const updatedOf = (span: Span, now: number): string => {
    if (span.end > now) return dateTimeOf(now);
    const first = monthKey(dateTimeOf(span.start));
    const last = monthKey(dateTimeOf(span.end - 1));
    const entered = enteredAt.filter((e) => e.month >= first && e.month <= last).map((e) => e.at);
    return dateTimeOf(Math.min(now, Math.max(span.end, restated, ...entered)));
  };

  /** One report for one period, via the published computed adapter. */
  const report = async (span: Span, now: number): Promise<RawMetrics | undefined> => {
    if (overlapHours(span, liveSince, now) <= 0) return undefined;
    const period = periodOf(span);
    const inner = computedAdapter({
      provider: providerText,
      methodologyUri: config.methodologyUri,
      measurementMethod: "third-party-modeled",
      period,
      // Watt-hours, not kWh: a measured day at a fraction of a watt is 0.3576 Wh,
      // which reads more plainly than 0.0003576 kWh; four significant figures either way.
      energy: { value: significant(wattHours(span, now)), unit: "Wh" },
      gridIntensity: config.gridIntensity,
      carbonAccounting: "location-based",
      capabilities: "extended",
    });
    const raw = (await inner.fetch({})) as RawMetrics;
    return {
      ...raw,
      updated: updatedOf(span, now),
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
      // Evaluated at the start of the current UTC day: the figure of a period in
      // progress changes once a day, together with `updated`, so the
      // representation, its ETag and its Last-Modified move in step.
      const now = startOfDay(clock().getTime());
      const asked = query.target !== undefined || query.start !== undefined || query.end !== undefined || query.granularity !== undefined;

      if (!asked) {
        // No parameter: the one current object.
        const span = config.period ? { start: epochMs(config.period.start), end: epochMs(config.period.end) } : currentSpan(liveSince, now);
        const one = span && (await report(span, now));
        if (!one) throw new NotFoundError();
        return one;
      }

      // The objects held that the query could select; the publisher applies the whole rule again.
      if (query.target !== undefined && query.target !== config.target) return [];
      const from = query.start === undefined ? -Infinity : epochMs(query.start);
      const to = query.end === undefined ? Infinity : epochMs(query.end);
      const reports: RawMetrics[] = [];
      for (const span of heldSpans(liveSince, now)) {
        if (!(span.start < to && span.end > from)) continue;
        const r = await report(span, now);
        if (r) reports.push(r);
      }
      return reports;
    },
  };
}

/**
 * The period of the request that names no parameter: the most recently
 * completed month once the gateway has been live for one; the go-live month so
 * far when that month began before go-live; else the newest object held.
 */
function currentSpan(liveSince: number, now: number): Span | undefined {
  const first = startOfDay(liveSince);
  const month = lastFullMonthPeriod(new Date(now));
  const span = { start: epochMs(month.start), end: epochMs(month.end) };
  if (span.start >= first) return span;
  // The month began before go-live: its object states the hours from the day the gateway went live.
  if (span.end > first) return { start: first, end: span.end };
  // Live for less than a month: the newest object held.
  const held = heldSpans(liveSince, now);
  return held.length > 0 ? held[held.length - 1] : undefined;
}
