/**
 * Date-times and periods of the draft (§Mandatory Members, §Query Parameters).
 *
 * A date-time is an RFC 3339 `date-time` written with `T` and `Z` in upper case.
 * A period is the half-open range from `start`, included, to `end`, excluded;
 * `start` is before `end` as instants, whatever offsets the two bounds carry.
 * Whether a period is a whole calendar day, month or year is decided from the
 * calendar fields of each bound in its own offset, never from the length of the
 * span: a month that crosses a change of daylight-saving time is still a month.
 *
 * Every calendar and instant computation of the package goes through this
 * module, over `temporal-polyfill`. Nothing exported here exposes a Temporal
 * type. Shared module: it depends on that library and on a type of `tokens.ts`
 * only, reads no clock, and is copied byte for byte into the consumer.
 */
import { Temporal } from "temporal-polyfill";
import type { Granularity } from "./tokens";

// The `date-time` rule of the draft's CDDL: `dt-head .cat dt-tail`.
const HEAD = "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}";
const TAIL = "(\\.[0-9]+)?(Z|(\\+|-)[0-9]{2}:[0-9]{2})";

/** The form of an `updated`, `period.start` or `period.end` value; whether it names a real moment is `dateTimeError`'s question. */
export const DATE_TIME_RE = new RegExp(`^${HEAD}${TAIL}$`);

/** The `utc-date-time` of the query ABNF: the same form with the offset fixed to `Z`. */
export const UTC_DATE_TIME_RE = new RegExp(`^${HEAD}(\\.[0-9]+)?Z$`);

export type PeriodErrorCode =
  | "date-time-form"
  | "date-time-value"
  | "period-shape"
  | "period-order"
  | "calendar-label"
  | "zone";

export class PeriodError extends RangeError {
  constructor(
    readonly code: PeriodErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PeriodError";
  }
}

/** One declaration's `period`: `start` included, `end` excluded. */
export interface Period {
  start: string;
  end: string;
}

/** A period object, or a calendar label as `periodFromReportingPeriod` reads it. */
export type PeriodInput = Period | string;

// The bound as the moment it names, in the offset it is written in. Second 60 is
// read as 59, as Temporal reads it; `hasLeapSecond` lets a caller note that.
function zoned(value: unknown): Temporal.ZonedDateTime {
  if (typeof value !== "string" || !DATE_TIME_RE.test(value)) {
    throw new PeriodError("date-time-form", `not an RFC 3339 date-time with upper-case T and Z: ${JSON.stringify(value)}`);
  }
  const zone = value.endsWith("Z") ? "UTC" : value.slice(-6);
  // RFC 3339 time-numoffset: time-hour 00-23 and time-minute 00-59 (the CDDL pattern is looser).
  if (zone !== "UTC" && !/^[+-]([01][0-9]|2[0-3]):[0-5][0-9]$/.test(zone)) {
    throw new PeriodError("date-time-value", `not a real date and time: ${JSON.stringify(value)} (the offset ${zone} is not time-numoffset)`);
  }
  try {
    return Temporal.ZonedDateTime.from(`${value}[${zone}]`, { offset: "reject", overflow: "reject" });
  } catch (e) {
    throw new PeriodError("date-time-value", `not a real date and time: ${JSON.stringify(value)} (${(e as Error).message})`);
  }
}

const instant = (value: unknown): Temporal.Instant => zoned(value).toInstant();

/** Why `value` is not a date-time of the draft, or `undefined` when it is one. */
export function dateTimeError(value: unknown): string | undefined {
  try {
    zoned(value);
    return undefined;
  } catch (e) {
    if (e instanceof PeriodError) return e.message;
    throw e;
  }
}

/** Whether `value` is a date-time of the draft: the form, and a real date, time and offset. */
export const isDateTime = (value: unknown): value is string => dateTimeError(value) === undefined;

/** Whether a date-time names the leap second 23:59:60, which is read as 23:59:59. */
export const hasLeapSecond = (value: string): boolean => value.slice(17, 19) === "60";

/**
 * Whether `value` is a `utc-date-time` a server honors for `start` or `end`. A
 * leap second does not count: it would be read as another value.
 */
export const isUtcDateTime = (value: unknown): value is string =>
  isDateTime(value) && UTC_DATE_TIME_RE.test(value) && !hasLeapSecond(value);

/** Compare two date-times as instants, whatever their offsets: negative, zero or positive. */
export const compareDateTimes = (a: string, b: string): number => Temporal.Instant.compare(instant(a), instant(b));

/** The instant in UTC with `Z`, and a fraction only when it is not zero: the form of a query value and of a key. */
export const toUtcQueryValue = (value: string): string => instant(value).toString();

function checkPeriod(value: unknown): PeriodError | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return new PeriodError("period-shape", "a period is an object with the members start and end");
  }
  const { start, end } = value as Record<string, unknown>;
  for (const [name, bound] of [["start", start], ["end", end]] as const) {
    try {
      zoned(bound);
    } catch (e) {
      if (e instanceof PeriodError) return new PeriodError(e.code, `period.${name}: ${e.message}`);
      throw e;
    }
  }
  if (compareDateTimes(start as string, end as string) >= 0) {
    return new PeriodError("period-order", `period.start must be before period.end (got ${start} and ${end})`);
  }
  return undefined;
}

/** Why `value` is not a period, or `undefined` when it is one: two date-times, `start` before `end`. */
export const periodError = (value: unknown): string | undefined => checkPeriod(value)?.message;

/** The period of `value`, with its two bounds as written; throws a `PeriodError` when it is not one. */
export function parsePeriod(value: unknown): Period {
  const error = checkPeriod(value);
  if (error) throw error;
  const { start, end } = value as Period;
  return { start, end };
}

/** The range of a query: an absent bound is unbounded. */
export interface Range {
  start?: string;
  end?: string;
}

/**
 * Whether `period` overlaps the half-open range `range`: it starts before the
 * range ends and ends after the range starts, as instants. Two periods that
 * meet, one's end being the other's start, do not overlap.
 */
export function overlapsRange(period: Period, range: Range): boolean {
  return (
    (range.end === undefined || compareDateTimes(period.start, range.end) < 0) &&
    (range.start === undefined || compareDateTimes(period.end, range.start) > 0)
  );
}

/** Whether two periods overlap; see {@link overlapsRange}. */
export const periodsOverlap = (a: Period, b: Period): boolean => overlapsRange(a, b);

/** Order by the instant of `start`, then by the instant of `end`. */
export const comparePeriodStart = (a: Period, b: Period): number =>
  compareDateTimes(a.start, b.start) || compareDateTimes(a.end, b.end);

/** A key for the period that is the same however its bounds are spelled: `Z`, `+00:00` and `.000Z` agree. */
export const canonicalKey = (period: Period): string => `${toUtcQueryValue(period.start)}/${toUtcQueryValue(period.end)}`;

const isMidnight = (z: Temporal.ZonedDateTime): boolean =>
  z.hour === 0 && z.minute === 0 && z.second === 0 && z.millisecond === 0 && z.microsecond === 0 && z.nanosecond === 0;

/** Whether both bounds are the first instant of a calendar day in their own offset (draft §Mandatory Members, a SHOULD). */
export function isOnDayBoundaries(period: Period): boolean {
  return isMidnight(zoned(period.start)) && isMidnight(zoned(period.end));
}

/**
 * Whether `period` is a whole calendar year, month or day: `start` is the first
 * instant of one and `end` the first instant of the next, each read in its own
 * offset. Several whole months are not a whole month.
 */
export function isWholeCalendarPeriod(period: Period, unit: Granularity): boolean {
  const start = zoned(period.start);
  const end = zoned(period.end);
  if (!isMidnight(start) || !isMidnight(end)) return false;
  const first = start.toPlainDate();
  const next = end.toPlainDate();
  switch (unit) {
    case "daily":
      return first.add({ days: 1 }).equals(next);
    case "monthly":
      return first.day === 1 && first.add({ months: 1 }).equals(next);
    case "yearly":
      return first.month === 1 && first.day === 1 && first.add({ years: 1 }).equals(next);
  }
}

/** The calendar unit `period` is whole in, or `undefined` when it is a whole day, month or year in none. */
export function wholeCalendarUnit(period: Period): Granularity | undefined {
  return (["daily", "monthly", "yearly"] as const).find((unit) => isWholeCalendarPeriod(period, unit));
}

// A bound at the first instant of `date` in `zone` ("Z", a fixed offset, or an IANA zone), written in the offset in force then.
function bound(date: Temporal.PlainDate, zone: string): string {
  let start: Temporal.ZonedDateTime;
  try {
    start = date.toZonedDateTime(zone === "Z" ? "UTC" : zone);
  } catch (e) {
    throw new PeriodError("zone", `not a time zone, a fixed offset or "Z": ${JSON.stringify(zone)} (${(e as Error).message})`);
  }
  const offset = start.offset === "+00:00" ? "Z" : start.offset;
  return `${start.toPlainDateTime().toString({ smallestUnit: "second" })}${offset}`;
}

// The range from the start of `first` to the start of `next`. A zone can skip a whole calendar day
// (Pacific/Apia skipped 2011-12-30), and then the two starts are the same instant.
function between(first: Temporal.PlainDate, next: Temporal.PlainDate, zone: string): Period {
  const period = { start: bound(first, zone), end: bound(next, zone) };
  if (compareDateTimes(period.start, period.end) >= 0) {
    throw new PeriodError("period-order", `the range from ${first} to ${next} has no length in ${JSON.stringify(zone)}: the zone has no such calendar day`);
  }
  return period;
}

function calendarDate(year: number, month: number, day: number, label: string): Temporal.PlainDate {
  try {
    if (!Number.isInteger(year) || year < 1 || year > 9999) throw new RangeError("the year is outside 1 to 9999");
    return Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" });
  } catch (e) {
    throw new PeriodError("calendar-label", `${label} does not name a calendar date (${(e as Error).message})`);
  }
}

/** The whole calendar year, with bounds at midnight in `zone` (default UTC, written `Z`). */
export function yearPeriod(year: number, zone = "Z"): Period {
  const first = calendarDate(year, 1, 1, `the year ${year}`);
  return between(first, first.add({ years: 1 }), zone);
}

/** The whole calendar month, `month` counted from 1. */
export function monthPeriod(year: number, month: number, zone = "Z"): Period {
  const first = calendarDate(year, month, 1, `the month ${year}-${month}`);
  return between(first, first.add({ months: 1 }), zone);
}

/** The whole calendar day, `date` written `YYYY-MM-DD`. */
export function dayPeriod(date: string, zone = "Z"): Period {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(date);
  if (!match) throw new PeriodError("calendar-label", `the day ${JSON.stringify(date)} is not YYYY-MM-DD`);
  const first = calendarDate(Number(match[1]), Number(match[2]), Number(match[3]), `the day ${date}`);
  return between(first, first.add({ days: 1 }), zone);
}

/** The calendar quarter, `quarter` counted from 1: three whole months. */
export function quarterPeriod(year: number, quarter: 1 | 2 | 3 | 4, zone = "Z"): Period {
  if (![1, 2, 3, 4].includes(quarter)) throw new PeriodError("calendar-label", `the quarter ${quarter} is not 1 to 4`);
  const first = calendarDate(year, quarter * 3 - 2, 1, `the quarter ${year}-Q${quarter}`);
  return between(first, first.add({ months: 3 }), zone);
}

/** Whether `value` is an RFC 3339 `full-date`, the form of a bound before the draft made them date-times. */
export const isFullDate = (value: unknown): value is string => typeof value === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value);

/**
 * The period of an earlier calendar label, `YYYY`, `YYYY-MM` or `YYYY-MM-DD`,
 * the value of the `reporting-period` member before it was replaced: the whole
 * year, month or day. A label that names no such date throws a `PeriodError`.
 */
export function periodFromReportingPeriod(label: string, zone = "Z"): Period {
  const match = /^([0-9]{4})(?:-([0-9]{2})(?:-([0-9]{2}))?)?$/.exec(label);
  if (!match) throw new PeriodError("calendar-label", `reporting-period ${JSON.stringify(label)} is not YYYY, YYYY-MM or YYYY-MM-DD`);
  const [, year, month, day] = match;
  if (month === undefined) return yearPeriod(Number(year), zone);
  if (day === undefined) return monthPeriod(Number(year), Number(month), zone);
  return dayPeriod(label, zone);
}

/**
 * The period of an earlier pair of inclusive `full-date`s, the form of the
 * previous revision: the range from the start of the first day to the start of
 * the day after the last.
 */
export function periodFromFullDates(dates: { start: string; end: string }, zone = "Z"): Period {
  if (!isFullDate(dates.start) || !isFullDate(dates.end)) {
    throw new PeriodError("calendar-label", `the period ${JSON.stringify(dates)} does not hold two full-dates`);
  }
  const date = (label: string) => dayPeriod(label, zone);
  return parsePeriod({ start: date(dates.start).start, end: date(dates.end).end });
}

/** The period of an object or of a calendar label; throws a `PeriodError` when the input names none. */
export function toPeriod(input: PeriodInput, zone = "Z"): Period {
  return typeof input === "string" ? periodFromReportingPeriod(input, zone) : parsePeriod(input);
}
