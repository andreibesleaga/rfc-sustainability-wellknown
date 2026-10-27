/**
 * RFC 3339 instants, UTC months, the grace period and the evaluation window of
 * SFC profile 2.0 (3.2, 3.5, 9.2). Spec:
 * https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 *
 * The gateway does no calendar arithmetic of its own (test/no-date-arithmetic.test.ts).
 * Every date here is therefore produced by the publisher library's period
 * functions (`monthPeriod`, `dayPeriod`, `periodFromFullDates`,
 * `isWholeCalendarPeriod`) and compared with `compareDateTimes`; the only
 * arithmetic left is integer arithmetic on a (year, month) pair, because the
 * library has no month offset, and each result is still built by `monthPeriod`.
 * Instants are converted to the milliseconds of the hours module
 * (`../self-report`) where a difference is needed.
 */
import {
  dayPeriod,
  hasLeapSecond,
  isDateTime,
  isFullDate as isFullDateForm,
  isWholeCalendarPeriod,
  monthPeriod,
  periodFromFullDates,
  toUtcQueryValue,
  type Period,
} from "sustainability-wellknown-publisher";
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../sfc-ledger-profile";
import { dateTimeOf, epochMs } from "../self-report";

const DAY_MS = 86_400_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * A bounded cache for a pure function of strings. A check meets the same few hundred instants,
 * month bounds and day names thousands of times (every rule asks "is this month active", "is this
 * instant before that one"), and the library's date functions are exact rather than fast.
 */
function memoised<A extends unknown[], R>(fn: (...args: A) => R, limit = 8192): (...args: A) => R {
  const cache = new Map<string, R>();
  return (...args: A): R => {
    const key = args.join("\u0000");
    if (cache.has(key)) return cache.get(key) as R;
    const value = fn(...args);
    if (cache.size >= limit) cache.clear();
    cache.set(key, value);
    return value;
  };
}

/**
 * RFC 3339 allows any number of fraction digits; the library reads nine. `libraryForm` cuts a longer
 * fraction to nine digits, the same moment to the nanosecond, so validity, the UTC spelling and the whole
 * milliseconds are unchanged. `fractionOf` keeps every digit with trailing zeros removed, so equal moments
 * give equal text and plain string order is numeric order (".5" < ".51", "" < ".5"): the exact comparison
 * of the reference verifier (sfc-compliance/lib/time.mjs).
 */
const LONG_FRACTION = /\.(\d{9})\d+/;
const FRACTION = /\.(\d+)(?=(?:Z|[+-]\d\d:\d\d)$)/;
const libraryForm = (t: string): string => t.replace(LONG_FRACTION, ".$1");
const fractionOf = (t: string): string => (FRACTION.exec(t)?.[1] ?? "").replace(/0+$/, "");

/** An RFC 3339 `date-time` with upper-case `T` and `Z`, numeric offsets and fractions allowed, second 60 not allowed (3.2 "instant"). */
const isInstantText = memoised((t: string): boolean => isDateTime(libraryForm(t)) && !hasLeapSecond(libraryForm(t)));
export const isInstant = (t: unknown): t is string => typeof t === "string" && isInstantText(t);

/** The first instant of a UTC month: `YYYY-MM-01T00:00:00Z`, no fraction, `Z` only (3.5 `month-bound`). */
export const isMonthBound = (t: unknown): t is string => typeof t === "string" && t.length === 20 && t.endsWith("-01T00:00:00Z") && isInstant(t);

/** A full date that names a day of the calendar (3.5 `full-date`). */
const isFullDateText = memoised((t: string): boolean => {
  if (!isFullDateForm(t)) return false;
  try {
    dayPeriod(t);
    return true;
  } catch {
    return false;
  }
});
export const isFullDate = (t: unknown): t is string => typeof t === "string" && isFullDateText(t);

const millisecondsOf = memoised((t: string): number => epochMs(libraryForm(t)));

/**
 * -1, 0 or 1: instants compare as the moments they denote, offsets and fractions included. Both must
 * be instants. Whole milliseconds decide (the library truncates a longer fraction, which keeps the
 * order); two instants in one millisecond compare by their fraction digits, every digit counted.
 */
export function cmpInstant(a: string, b: string): number {
  const x = millisecondsOf(a);
  const y = millisecondsOf(b);
  if (x !== y) return x < y ? -1 : 1;
  const f = fractionOf(a);
  const g = fractionOf(b);
  return f < g ? -1 : f > g ? 1 : 0;
}
export const before = (a: string, b: string): boolean => cmpInstant(a, b) < 0;
export const atOrBefore = (a: string, b: string): boolean => cmpInstant(a, b) <= 0;

/** A key under which two spellings of one moment are equal (a UTC spelling with trailing fractional zeros removed, every other digit kept). */
export function instantKey(t: string): string {
  if (!isInstant(t)) return `bad:${t}`;
  const utc = toUtcQueryValue(libraryForm(t));
  const dot = utc.indexOf(".");
  const base = dot < 0 ? utc.slice(0, -1) : utc.slice(0, dot);
  const frac = fractionOf(t);
  return frac ? `${base}.${frac}Z` : `${base}Z`;
}

/** Milliseconds of an instant (for differences against the checker's clock and the skew). */
export const epochOf = (t: string): number => millisecondsOf(t);

// ---- months (UTC) ---------------------------------------------------------------------------

const yearOf = (bound: string): number => Number(bound.slice(0, 4));
const monthNumberOf = (bound: string): number => Number(bound.slice(5, 7));

/** The month bound `k` months from the month that starts at `bound` (negative k goes back). */
export const addMonths = memoised((bound: string, k: number): string => {
  const index = yearOf(bound) * 12 + (monthNumberOf(bound) - 1) + k;
  return monthPeriod(Math.floor(index / 12), (index % 12) + 1).start;
});

/** The month (its start bound) that contains an instant, in UTC. */
export const monthOf = memoised((t: string): string => {
  const utc = dateTimeOf(millisecondsOf(t));
  return monthPeriod(Number(utc.slice(0, 4)), Number(utc.slice(5, 7))).start;
});

/** The period of a month, as the library builds it. */
export const periodOfMonth = (bound: string): Period => monthPeriod(yearOf(bound), monthNumberOf(bound));

/** Month starts from `start` (inclusive) to `end` (exclusive). */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let m = start; before(m, end); m = addMonths(m, 1)) out.push(m);
  return out;
}

// ---- days -----------------------------------------------------------------------------------

/** The start of the day after a full date, as a full date. */
const nextDate = (date: string): string => dayPeriod(date).end.slice(0, 10);

/** The first instant of the day after a full date (12.1: the end of a 1.x period that names its last day). */
export const dayAfter = memoised((date: string): string => dayPeriod(date).end);

/** Whether two full dates are the first and last day of one UTC calendar month. */
export const isWholeMonthDates = memoised((from: string, to: string): boolean => {
  try {
    return isWholeCalendarPeriod(periodFromFullDates({ start: from, end: to }), "monthly");
  } catch {
    return false;
  }
});

/** The span of a full-date pair as instants (`from` 00:00Z to 00:00Z after `to`), or null when the pair is not in order (12.1 rule 1). */
export function spanOfDates(from: string, to: string): [string, string] | null {
  if (to < from) return null;
  return [dayPeriod(from).start, dayPeriod(to).end];
}

// ---- grace period, window, calendar months with clamping --------------------------------------

/** The due instant of the month that starts at `start`: next month's bound plus G, 5 days of 24 hours (3.2). */
export const dueOf = memoised((start: string): string => {
  let date = addMonths(start, 1).slice(0, 10);
  for (let i = 0; i < PROFILE.graceDays; i++) date = nextDate(date);
  return `${date}T00:00:00Z`;
});

/** The evaluation window for a check anchored at T: the 12 months that ended at least G before T (3.2). */
export function windowOf(T: string): string[] {
  let last = monthOf(T);
  while (before(T, dueOf(last))) last = addMonths(last, -1);
  return monthsBetween(addMonths(last, -11), addMonths(last, 1));
}

/**
 * `k` calendar months after an instant: same day, clamped to the month's last day, UTC, time of day and
 * fraction kept (9.2 C-SFC-6). Compare the result as a moment, with `cmpInstant`, never as text.
 */
export function addCalendarMonths(t: string, k: number): string {
  const utc = dateTimeOf(millisecondsOf(t));
  const target = periodOfMonth(addMonths(monthPeriod(Number(utc.slice(0, 4)), Number(utc.slice(5, 7))).start, k));
  const lastDay = Math.round((epochMs(target.end) - epochMs(target.start)) / DAY_MS);
  const day = Math.min(Number(utc.slice(8, 10)), lastDay);
  const base = `${target.start.slice(0, 8)}${pad2(day)}${utc.slice(10)}`;
  const frac = fractionOf(t);
  return frac ? `${base.slice(0, -1)}.${frac}Z` : base;
}

/** A whole calendar year in one offset (3.2 "calendar year"): both bounds on 1 January 00:00 with no fraction; with ledger evidence the offset must be `Z`. */
export function isCalendarYear(period: { start: string; end: string }, ledgerBacked = false): boolean {
  if (!isInstant(period.start) || !isInstant(period.end) || period.start.includes(".") || period.end.includes(".")) return false;
  if (!isWholeCalendarPeriod(period, "yearly")) return false;
  const zone = (s: string): string => (s.endsWith("Z") ? "Z" : s.slice(-6));
  return zone(period.start) === zone(period.end) && (!ledgerBacked || zone(period.start) === "Z");
}

/** A period of one whole UTC calendar month. */
export const isUtcMonthPeriod = (p: { start: string; end: string }): boolean => isMonthBound(p.start) && isMonthBound(p.end) && p.end === addMonths(p.start, 1);
