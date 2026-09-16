/**
 * Reporting periods and the Extended service's selection rule — the draft's
 * §Extended Query Parameters, as pure functions over a sorted trend:
 *
 *  - `period` names a calendar year, month or day (UTC); an entry belongs to
 *    it when its own `reporting-period` lies inside it. When the parameter is
 *    absent the period is that of the Basic response — and, where the Basic
 *    response is an array, that of its LAST object (draft step 2);
 *  - `granularity` denotes a PRECISION: `monthly` denotes month precision and
 *    `daily` denotes day precision. Year is coarser than month, which is
 *    coarser than day. The parameter is ignored when the precision it denotes
 *    is not finer than the period's (draft step 3);
 *  - an array is returned ONLY when a granularity is in effect (draft: "A
 *    server MUST NOT return an array unless G is in effect"), and it holds
 *    exactly the held entries WHOSE PRECISION IS G inside P; one that IS in
 *    effect but matches no held entry is no data (404);
 *  - otherwise one object: the entry for the period itself, or — when only
 *    finer entries exist — their aggregate, formed by {@link aggregatePeriod}
 *    exactly as draft step 5 lists it, else no data (404). The contributing
 *    entries are "the held entries of ONE PRECISION that lie within P" — the
 *    COARSEST precision held inside it — which "MUST NOT overlap" and "MUST
 *    cover P, or, where P has not yet completed, the completed portion of it
 *    that step 6 provides for"; {@link contributingEntries} chooses them, and a
 *    set that cannot meet those conditions has no aggregate the server can
 *    honestly serve, so it is answered as no data;
 *  - a publisher that does not support the parameters ignores them and
 *    returns the Basic response: the most recently completed period.
 */
import { convertCarbon, convertEnergy } from "./normalize";
import {
  CarbonUnit,
  Capabilities,
  EnergyUnit,
  METRIC_MEMBERS,
  ServiceQuery,
  SustainabilityDocument,
  SustainabilityMetrics,
} from "./types";
import { round } from "./util";

/**
 * Draft period shape: `YYYY`, `YYYY-MM`, or `YYYY-MM-DD` — the ABNF's
 * `period-value` rule (renamed from `period` in -07, which now names the whole
 * `period=` parameter). Month is bounded to 01-12 and day to 01-31 by the
 * pattern; {@link isCalendarPeriod} also checks the day exists in that month.
 * Exported as the single source of truth; adapters import this rather than
 * duplicating the pattern.
 */
export const PERIOD_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/;

/** True for a well-formed `period-value` whose day, if any, exists (no "2026-02-30"). */
export function isCalendarPeriod(period: string): boolean {
  if (!PERIOD_RE.test(period)) return false;
  if (period.length < 10) return true;
  const [y, m, d] = period.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * The precision of a period, as the draft names it: year, month or day, "year
 * being the coarsest". Ordered so that a LARGER number is FINER, which is the
 * only comparison the procedure needs (`isFiner`).
 */
export const PRECISION = { year: 1, month: 2, day: 3 } as const;
export type Precision = (typeof PRECISION)[keyof typeof PRECISION];

/** The precision a `period-value` has: year, month or day. */
export function periodPrecision(period: string): Precision {
  return period.length === 4 ? PRECISION.year : period.length === 7 ? PRECISION.month : PRECISION.day;
}

/**
 * Draft §Extended Query Parameters: "the granularity `monthly` denotes month
 * precision and `daily` denotes day precision". One vocabulary, one mapping —
 * the parameter is never compared against a period directly, only the
 * precision it denotes is.
 */
const GRANULARITY_PRECISION: Record<"monthly" | "daily", Precision> = {
  monthly: PRECISION.month,
  daily: PRECISION.day,
};
export function granularityPrecision(granularity: "monthly" | "daily"): Precision {
  return GRANULARITY_PRECISION[granularity];
}

/** True when precision `a` is finer than precision `b` (year < month < day). */
export function isFiner(a: Precision, b: Precision): boolean {
  return a > b;
}

/** True when `entryPeriod` lies inside `period` (same or finer precision). */
export function isWithin(entryPeriod: string, period: string): boolean {
  return entryPeriod === period || entryPeriod.startsWith(`${period}-`);
}

/** Two digits, the zero-padded form every `period-value` component takes. */
const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * The instant a period ENDS, exclusive, as epoch milliseconds in UTC: the first
 * instant that is no longer inside it. A `period-value` "names a whole calendar
 * year, month or day in UTC unless the methodology document states otherwise"
 * (draft §Extended Query Parameters), so `2026` ends at 2027-01-01T00:00:00Z,
 * `2026-02` at 2026-03-01T00:00:00Z and `2026-02-28` at 2026-03-01T00:00:00Z.
 */
export function periodEndMs(period: string): number {
  const [year, month, day] = period.split("-").map(Number);
  if (period.length === 4) return Date.UTC(year + 1, 0, 1);
  if (period.length === 7) return Date.UTC(year, month, 1);
  return Date.UTC(year, month - 1, day + 1);
}

/**
 * True when a period has COMPLETED as of `now`: every instant of it has passed.
 * A period ending exactly at `now` has completed — its last instant is behind
 * us — which makes `2026-02` complete at 2026-03-01T00:00:00Z and not before.
 */
export function isCompleted(period: string, now: Date): boolean {
  return periodEndMs(period) <= now.getTime();
}

/**
 * THE COMPLETED PORTION of `period`, as the sub-periods of it at `precision`
 * that have themselves completed by `now`, in ascending order. This is the set
 * draft step 5 requires the contributing entries of an aggregate to cover:
 * "they MUST cover P, or, where P has not yet completed, the completed portion
 * of it that step 6 provides for".
 *
 * ONE rule serves both halves of that sentence, because a period that has
 * completed has no sub-period that has not: for a finished year at month
 * precision the list is all twelve months, and for a year still running it is
 * the months that have ended — January to August on 2026-09-16, September being
 * still in progress. So the caller asks only "is every period in this list
 * held?", and both the finished-period case and the step 6 case fall out of it.
 *
 * THE CLOCK is the only input beyond the period itself, and it is a parameter
 * rather than a call to `Date.now()` inside: every caller down to {@link
 * selectPeriod} takes it, `Publisher` reads it from `PublisherOptions.now`, and
 * a test therefore pins it instead of depending on the wall clock. A deployment
 * whose figures for a month land some days into the next one can pass a clock
 * that lags by that much, which states its own reporting calendar explicitly
 * rather than leaving the aggregate to appear and disappear with the date.
 *
 * The list is empty when `precision` is not finer than the period's (nothing
 * inside it is a sub-period of that precision) and when nothing inside the
 * period has completed yet.
 */
export function completedSubPeriods(period: string, precision: Precision, now: Date): string[] {
  const outer = periodPrecision(period);
  if (!isFiner(precision, outer)) return [];
  const year = Number(period.slice(0, 4));
  const months =
    outer === PRECISION.year
      ? Array.from({ length: 12 }, (_, i) => i + 1)
      : [Number(period.slice(5, 7))];
  const subPeriods: string[] = [];
  for (const month of months) {
    const monthPeriod = `${year}-${pad2(month)}`;
    if (precision === PRECISION.month) {
      subPeriods.push(monthPeriod);
      continue;
    }
    // Day 0 of the NEXT month is the last day of this one, leap years included.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= lastDay; day += 1) subPeriods.push(`${monthPeriod}-${pad2(day)}`);
  }
  return subPeriods.filter((p) => isCompleted(p, now));
}

/**
 * The Basic response this publisher serves for a trend: the entry for the most
 * recently completed period. Exported so the period rule of draft step 2 is
 * expressed once and can be read off the same value a Basic request returns.
 */
export function basicResponse(entries: SustainabilityMetrics[]): SustainabilityDocument | undefined {
  return entries.length > 0 ? entries[entries.length - 1] : undefined;
}

/**
 * Draft §Extended Query Parameters, step 2: with `period` absent, P is "the
 * `reporting-period` of the Basic response, and, where the Basic response is an
 * array, the `reporting-period` of its last object".
 */
export function basicResponsePeriod(doc: SustainabilityDocument): string | undefined {
  if (Array.isArray(doc)) {
    const last = doc[doc.length - 1];
    return last?.["reporting-period"];
  }
  return doc["reporting-period"];
}

/** The energy and carbon members that sum, with the unit member each one is expressed in. */
const SUMMABLE: ReadonlyArray<{ member: "energy-consumption" | "carbon-footprint" | "scope-1" | "scope-2" | "scope-3"; unit: "energy-unit" | "carbon-unit" }> = [
  { member: "energy-consumption", unit: "energy-unit" },
  { member: "carbon-footprint", unit: "carbon-unit" },
  { member: "scope-1", unit: "carbon-unit" },
  { member: "scope-2", unit: "carbon-unit" },
  { member: "scope-3", unit: "carbon-unit" },
];

/**
 * Draft step 5: "`provider`, `measurement-method`, `methodology-uri`, `target`
 * and `target-type` are those of the contributing entries, which MUST agree."
 */
export const MUST_AGREE_MEMBERS = [
  "provider",
  "measurement-method",
  "methodology-uri",
  "target",
  "target-type",
] as const;

/**
 * Members the draft's list neither sums nor names as carried over. They are not
 * metric members, so "every other metric member is omitted" does not reach
 * them; carrying one contributor's value alone would, however, describe
 * the aggregate with that contributor's context. Draft step 5: "An optional
 * member that is not a metric is carried only where every contributing entry
 * carries it with the same value, and omitted otherwise" — so a member absent
 * from any one entry is omitted, exactly as a member whose values differ is.
 */
const AGREE_OR_OMIT_MEMBERS = [
  "carbon-accounting",
  "disclosure-uri",
  "verifiable-attestation-uri",
  "upstream",
  "extensions",
] as const;

/**
 * A data set the server cannot honestly aggregate, in any of the three ways
 * draft step 5 names: the contributing entries disagree on a member that MUST
 * agree, they overlap, or they do not cover the period. All three have the same
 * outcome — "responds as it does when it has no data", the ordinary `404` — and
 * all three are the same kind of event for the OPERATOR: a defect in the
 * published data set rather than a fault of the request or a broken server. So
 * they share a base class, which {@link handleRequest} catches in one place: the
 * requester gets the no-data response, and `onError` fires with the error that
 * says which condition failed and on which periods.
 */
export class UnservableAggregateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnservableAggregateError";
  }
}

/**
 * Raised when the contributing entries of an aggregate do not cover the period.
 *
 * Draft step 5: the contributing entries "MUST cover P, or, where P has not yet
 * completed, the completed portion of it that step 6 provides for: a server
 * holding figures for only part of a finished period cannot present their sum as
 * a figure for the whole of it". {@link completedSubPeriods} lists what must be
 * held; `missing` names what is not, so the operator can see the gap.
 */
export class AggregateCoverageError extends UnservableAggregateError {
  constructor(
    public readonly period: string,
    public readonly missing: string[],
  ) {
    super(
      `aggregate for "${period}": the contributing entries do not cover it — ` +
        `${missing.length} of its completed sub-period(s) are not held ` +
        `(${missing.slice(0, 6).join(", ")}${missing.length > 6 ? ", …" : ""}); the draft requires the ` +
        "contributing entries of an aggregate to cover P, or, where P has not yet completed, the " +
        "completed portion of it, since figures for part of a period cannot be served as a figure " +
        "for the whole of it",
    );
    this.name = "AggregateCoverageError";
  }
}

/**
 * Raised when the contributing entries of an aggregate overlap, which after the
 * one-precision rule can only mean the same period held twice (draft step 5,
 * "they MUST NOT overlap"; §Payload Format, a trend "MUST NOT overlap"). Summing
 * such a set would count that period twice, so there is no aggregate to serve.
 */
export class AggregateOverlapError extends UnservableAggregateError {
  constructor(
    public readonly period: string,
    public readonly duplicated: string[],
  ) {
    super(
      `aggregate for "${period}": the contributing entries overlap — ` +
        `${duplicated.join(", ")} held more than once; the draft requires the contributing entries ` +
        "of an aggregate not to overlap, since summing them would count that period twice",
    );
    this.name = "AggregateOverlapError";
  }
}

/**
 * Raised when the contributing entries of an aggregate disagree on a member the
 * draft says MUST agree. The publisher cannot form a conformant aggregate and
 * MUST NOT invent one from a single contributor: draft step 5, "where they do
 * not, the server MUST NOT serve an aggregate, since it could only misdescribe
 * what the figures are about, and responds as it does when it has no data".
 *
 * The CLIENT therefore sees the no-data response — for this resource `404`,
 * byte for byte what a period with no entries inside it gets ({@link
 * handleRequest} maps it there). The OPERATOR still hears about it: the
 * `onError` hook is called with this error, whose message names the member and
 * the values that disagreed, because a disagreement is a defect in the
 * published data set rather than something to lose silently.
 */
export class AggregateDisagreementError extends UnservableAggregateError {
  constructor(
    public readonly member: string,
    public readonly values: unknown[],
  ) {
    super(
      `aggregate for a coarser period: the contributing entries disagree on "${member}" ` +
        `(${values.map((v) => JSON.stringify(v)).join(", ")}); the draft requires the contributing ` +
        "entries of an aggregate to agree on provider, measurement-method, methodology-uri, " +
        "target and target-type",
    );
    this.name = "AggregateDisagreementError";
  }
}

/** The unit a member is expressed in, with the draft's default when absent. */
function unitOf(entry: SustainabilityMetrics, unit: "energy-unit" | "carbon-unit"): string {
  return (entry[unit] as string | undefined) ?? (unit === "energy-unit" ? "kWh" : "gCO2e");
}

/** Structural equality over JSON values (member order in objects is significant). */
const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * THE CONTRIBUTING ENTRIES of an aggregate for `period`, as draft step 5
 * defines them: "the held entries of one precision that lie within P: where the
 * server holds more than one precision inside P, it takes the coarsest… They
 * MUST NOT overlap… and they MUST cover P, or, where P has not yet completed,
 * the completed portion of it that step 6 provides for."
 *
 * Returns `undefined` when nothing finer lies inside the period at all — the
 * plain no-data outcome (404) — and THROWS an {@link UnservableAggregateError}
 * when what is held cannot be aggregated honestly (an overlap, or a gap in the
 * coverage): the same 404 for the requester, with the operator told why, since
 * "a server whose held data cannot meet these conditions has no aggregate it can
 * honestly serve and responds as it does when it has no data".
 *
 * Four rules, applied here rather than at the call site so that every caller
 * of the exported {@link aggregatePeriod} gets them:
 *
 *  - WITHIN P AND FINER. Only an entry lying inside P contributes, and only one
 *    whose precision is finer than P's: an entry for P itself is the answer to
 *    the request, not a contribution to an aggregate of it ({@link
 *    selectPeriod} returns it directly).
 *  - ONE PRECISION, THE COARSEST. Where a publisher holds more than one
 *    precision inside P — the twelve months of a year and a few days inside one
 *    of those months, to take the draft's own example — the two sets MUST NOT be
 *    summed together, because each of those days is already counted inside its
 *    month. The draft NAMES which set is taken: "where the server holds more
 *    than one precision inside P, it takes the coarsest, so that two servers
 *    holding the same data return the same figures". So this takes the COARSEST
 *    precision held inside P (months, in that example) and drops every entry of
 *    any other precision — not a choice this package makes but the rule it
 *    implements. The rule is deterministic, depends only on the set of periods
 *    held, and is the one that reports the period most completely: a publisher's
 *    coarser series normally spans the whole of P, while its finer entries cover
 *    a part of it. It is also stable — publishing a day inside a month that is
 *    already held never changes the year's aggregate — and it reads the
 *    publisher's own coarser figures, which are its own reconciliation of the
 *    finer ones, rather than re-deriving them.
 *  - NO OVERLAP. Two entries of the same precision name either the same period
 *    or disjoint periods, so once one precision is chosen the only way left to
 *    overlap is to hold one period twice. A trend "MUST NOT overlap"
 *    (§Payload Format), so such a set is a defect in the published data: it has
 *    no aggregate ({@link AggregateOverlapError}), and the requester gets the
 *    no-data response rather than a figure counting that period twice.
 *  - COVERAGE. The entries must TILE P — "they MUST cover P, or, where P has not
 *    yet completed, the completed portion of it that step 6 provides for: a
 *    server holding figures for only part of a finished period cannot present
 *    their sum as a figure for the whole of it". Having several entries is not
 *    coverage: every sub-period of P at the chosen precision that has completed
 *    by `now` must be held ({@link completedSubPeriods}), so a year missing its
 *    June, and a year holding only January to March once the year is over, both
 *    fail, while a year still running whose completed months are all held passes
 *    and is served as the completed portion to date (step 6). A gap is
 *    {@link AggregateCoverageError} — the no-data response for the requester and
 *    a report for the operator, exactly as an overlap is. An entry for the
 *    sub-period still in progress is not required and, where the publisher holds
 *    one, still contributes: what its entries cover is the publisher's own
 *    statement, which step 6 leaves to it.
 *
 * The chosen entries are returned in ASCENDING ORDER of `reporting-period`,
 * whatever order the caller held them in, so "the last contributing entry in
 * ascending order of `reporting-period`" (the aggregate's unit, below) is
 * literally the last of them.
 */
export function contributingEntries(
  entries: SustainabilityMetrics[],
  period: string,
  now: Date = new Date(),
): SustainabilityMetrics[] | undefined {
  const target = periodPrecision(period);
  const candidates = entries.filter(
    (e) =>
      isWithin(e["reporting-period"], period) &&
      isFiner(periodPrecision(e["reporting-period"]), target),
  );
  if (candidates.length === 0) return undefined;

  // The coarsest precision held inside P: the SMALLEST `PRECISION` value, since
  // a larger number is the finer one.
  const coarsest = candidates.reduce<Precision>((chosen, e) => {
    const p = periodPrecision(e["reporting-period"]);
    return p < chosen ? p : chosen;
  }, PRECISION.day);

  const contributing = candidates.filter((e) => periodPrecision(e["reporting-period"]) === coarsest);
  const held = new Set(contributing.map((e) => e["reporting-period"]));
  if (held.size !== contributing.length) {
    // One period held twice: the entries overlap, so there is no aggregate.
    const heldCount = new Map<string, number>();
    for (const e of contributing) {
      const p = e["reporting-period"];
      heldCount.set(p, (heldCount.get(p) ?? 0) + 1);
    }
    const duplicated = [...heldCount]
      .filter(([, count]) => count > 1)
      .map(([p]) => p)
      .sort();
    throw new AggregateOverlapError(period, duplicated);
  }

  // Draft step 5: the contributing entries MUST COVER P — or, where P has not
  // yet completed, its completed portion. Coverage is a TILING, not a count:
  // every sub-period of P at the chosen precision that has completed by `now`
  // has to be one of them, so a gap anywhere (in the middle, or a finished
  // period whose last months were never published) leaves the server with no
  // aggregate it can honestly serve.
  const missing = completedSubPeriods(period, coarsest, now).filter((p) => !held.has(p));
  if (missing.length > 0) throw new AggregateCoverageError(period, missing);

  // The period forms are zero-padded, so a lexicographic sort is chronological.
  return [...contributing].sort((a, b) => a["reporting-period"].localeCompare(b["reporting-period"]));
}

/**
 * THE LAST CONTRIBUTING ENTRY IN ASCENDING ORDER OF `reporting-period`, which
 * draft step 5 makes the source of the aggregate's own units: the sums are
 * "taken after converting the contributing entries to the unit the aggregate
 * declares in `energy-unit` and `carbon-unit`, which is the unit declared by
 * the last contributing entry in ascending order of `reporting-period`" (and,
 * where that entry declares neither, the draft's default for the member —
 * `kWh` and `gCO2e`; see {@link unitOf}).
 *
 * The dimension is the REPORTING PERIOD, never the `updated` timestamp: step 5
 * has a separate rule for `updated` ("the latest `updated` of the contributing
 * entries"), and an entry revised late does not thereby become the one whose
 * unit the aggregate declares. This picks the entry by period rather than by
 * position, so the rule holds for any caller of the exported {@link
 * aggregatePeriod} too, whatever order it passes: the period forms `YYYY`,
 * `YYYY-MM` and `YYYY-MM-DD` are zero-padded and sort lexicographically in
 * chronological order. The contributing entries are of one precision and do not
 * overlap ({@link contributingEntries}), so exactly one of them is last.
 */
function lastEntryByPeriod(entries: SustainabilityMetrics[]): SustainabilityMetrics {
  return entries.reduce((latest, e) =>
    e["reporting-period"] >= latest["reporting-period"] ? e : latest,
  );
}

/**
 * One object for `period` from the finer entries inside it, exactly as draft
 * §Extended Query Parameters, step 5 lists it:
 *
 *  - the contributing entries are the held entries of ONE PRECISION that lie
 *    within P and do not overlap — {@link contributingEntries} chooses them,
 *    and an aggregate is formed from those alone;
 *  - `reporting-period` is P, and `capabilities` is `extended`;
 *  - `energy-consumption`, `carbon-footprint` and the scope members are sums
 *    taken after converting the contributing entries to the unit the aggregate
 *    itself declares in `energy-unit` and `carbon-unit`, which is the unit
 *    declared by the LAST contributing entry IN ASCENDING ORDER OF
 *    `reporting-period` (see {@link lastEntryByPeriod}) — not the entry with
 *    the latest `updated`, which is a separate rule of the same step;
 *  - each of those members is carried only where EVERY contributing entry
 *    reports it, and omitted otherwise, "since summing where some entries are
 *    silent would understate the period";
 *  - `updated` is the latest `updated` of the contributing entries;
 *  - `provider`, `measurement-method`, `methodology-uri`, `target` and
 *    `target-type` are those of the contributing entries, which MUST agree —
 *    a disagreement raises {@link AggregateDisagreementError}, which is the
 *    no-data outcome for the requester (404) and an `onError` report for the
 *    operator;
 *  - every other metric member is omitted (this library never recomputes one:
 *    a publisher that does so, and says so in its methodology document, adds it
 *    to the object itself).
 *
 * Returns `undefined` when there are no contributing entries to form it from,
 * and when the aggregate would carry no metric member at all: draft step 5,
 * "A server that cannot form an aggregate carrying at least one metric member
 * responds `404 Not Found`".
 */
export function aggregatePeriod(
  entries: SustainabilityMetrics[],
  period: string,
  now: Date = new Date(),
): SustainabilityMetrics | undefined {
  // Draft step 5: the contributing entries are those of ONE precision lying
  // within P, which MUST NOT overlap. Everything below sums `contributing`, and
  // never the argument, so a caller handing over a month and a day inside it
  // does not get that day counted twice.
  const contributing = contributingEntries(entries, period, now);
  if (contributing === undefined) return undefined;
  const rec = (e: SustainabilityMetrics) => e as unknown as Record<string, unknown>;
  // The unit the aggregate declares is "the unit declared by the last
  // contributing entry in ascending order of `reporting-period`" (draft step 5).
  const last = lastEntryByPeriod(contributing);

  // "which MUST agree": a disagreement is a defect in the published data set,
  // never something to paper over by picking one entry's value. The requester
  // is answered as it is when there is no data (404); the operator is told.
  for (const member of MUST_AGREE_MEMBERS) {
    const values = contributing.map((e) => rec(e)[member]);
    if (values.some((v) => !sameValue(v, values[0]))) {
      throw new AggregateDisagreementError(member, [...new Set(values.map((v) => JSON.stringify(v)))].map((s) => JSON.parse(s ?? "null")));
    }
  }

  const out: Record<string, unknown> = {
    // Mandatory members, in the order the draft lists them. The five that MUST
    // agree are read off `last` only because the check above has already
    // established that every contributing entry carries the same value.
    updated: contributing.map((e) => e.updated).sort().pop() as string,
    capabilities: "extended",
    provider: last.provider,
    "measurement-method": last["measurement-method"],
    "methodology-uri": last["methodology-uri"],
    "reporting-period": period,
    target: last.target,
  };

  // Draft step 5: the aggregate declares the unit of the LAST contributing
  // entry in ascending order of `reporting-period`, and every contribution is
  // converted into it below.
  const declared = {
    "energy-unit": unitOf(last, "energy-unit"),
    "carbon-unit": unitOf(last, "carbon-unit"),
  } as const;

  for (const { member, unit } of SUMMABLE) {
    const reporting = contributing.filter((e) => typeof rec(e)[member] === "number");
    // Draft step 5: "carried only where every contributing entry reports it,
    // and omitted otherwise, since summing where some entries are silent would
    // understate the period".
    if (reporting.length !== contributing.length) continue;
    const target = declared[unit];
    const total = reporting.reduce((sum, e) => {
      const value = rec(e)[member] as number;
      const from = unitOf(e, unit);
      return (
        sum +
        (unit === "energy-unit"
          ? convertEnergy(value, from as EnergyUnit, target as EnergyUnit)
          : convertCarbon(value, from as CarbonUnit, target as CarbonUnit))
      );
    }, 0);
    out[member] = round(total);
    out[unit] = target;
  }
  // A unit member has no effect without a value it parameterizes.
  for (const unit of ["energy-unit", "carbon-unit"] as const) {
    if (!SUMMABLE.some((s) => s.unit === unit && out[s.member] !== undefined)) delete out[unit];
  }

  // `target-type` is carried when the entries agree — checked above, so the
  // last entry's value is every entry's value. Absent from all: omitted.
  if (last["target-type"] !== undefined) out["target-type"] = last["target-type"];

  // Draft step 5, for an optional member that is not a metric: "carried only
  // where EVERY contributing entry CARRIES IT WITH THE SAME VALUE, and omitted
  // otherwise". Carrying it is part of the test, not only agreeing where
  // present: `values[0] !== undefined` rejects a member the first entry does
  // not carry, and `sameValue` compares an absent value as null, so an entry
  // that omits it never matches one that carries it.
  for (const member of AGREE_OR_OMIT_MEMBERS) {
    const values = contributing.map((e) => rec(e)[member]);
    if (values[0] !== undefined && values.every((v) => sameValue(v, values[0]))) out[member] = values[0];
  }

  // `signed` is deliberately absent from every list above: a signature covers
  // the object it was made for, and an aggregate is a NEW object, signed (if at
  // all) by the publisher after it is built (draft §Signing, regeneration rule).

  // Draft step 5: an aggregate must carry at least one METRIC member — an
  // evidence link does not stand in for one here, so a publisher holding only,
  // say, `sci-score` for the finer periods has no aggregate to serve (404).
  if (!METRIC_MEMBERS.some((m) => typeof out[m] === "number")) return undefined;
  return out as unknown as SustainabilityMetrics;
}

/**
 * Select what a query returns from a trend sorted ascending by period.
 * `undefined` means no data for the request (the no-data rule, 404).
 */
export function selectPeriod(
  entries: SustainabilityMetrics[],
  query: ServiceQuery,
  capabilities: Capabilities,
  now: Date = new Date(),
): SustainabilityDocument | undefined {
  if (entries.length === 0) return undefined;
  const basic = basicResponse(entries) as SustainabilityDocument;
  if (capabilities !== "extended" || (query.period === undefined && query.granularity === undefined)) return basic;

  // Draft step 2: P is the named period, or the Basic response's — its LAST
  // object's, where the Basic response is an array.
  const period = query.period ?? basicResponsePeriod(basic);
  if (period === undefined) return undefined;
  const within = entries.filter((e) => isWithin(e["reporting-period"], period));
  if (within.length === 0) return undefined;

  // Draft step 3: G is the precision the value denotes; the parameter is
  // ignored when that precision is not finer than P's.
  // Step 5: with G in effect the response is the array of the held entries
  // WHOSE PRECISION IS G within P — and nothing else, so none means 404.
  const g = query.granularity !== undefined ? granularityPrecision(query.granularity) : undefined;
  if (g !== undefined && isFiner(g, periodPrecision(period))) {
    const sliced = within.filter((e) => periodPrecision(e["reporting-period"]) === g);
    return sliced.length > 0 ? sliced : undefined;
  }
  const exact = within.find((e) => e["reporting-period"] === period);
  if (exact) return exact;
  // Step 5: no entry for P itself, so the answer is the aggregate of the finer
  // entries inside it — of ONE precision, non-overlapping, which
  // `aggregatePeriod` selects from what it is given (`contributingEntries`).
  return aggregatePeriod(within, period, now);
}
