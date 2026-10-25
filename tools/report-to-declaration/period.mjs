/**
 * The period of a declaration, from the calendar label a report states.
 *
 * A period is two RFC 3339 date-times, `start` included and `end` excluded,
 * both at midnight in one stated offset (`Z` or a fixed ±hh:mm). A label of
 * YYYY, YYYY-MM or YYYY-MM-DD is the whole calendar year, month or day; a pair
 * of inclusive dates YYYY-MM-DD/YYYY-MM-DD, as a fiscal year is written, ends
 * at the first instant of the day after the last date.
 *
 * Only fixed offsets are read: a report states dates, not instants, and an
 * offset that changes inside the period (daylight-saving time) is outside this
 * tool. test/period.test.mjs holds these builders to the consumer's.
 */

export class PeriodError extends RangeError {}

const OFFSET = /^(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const pad = (n, width = 2) => String(n).padStart(width, "0");

/** The offset as the draft writes it: `Z` for UTC, never `+00:00`. */
export function normalizeOffset(offset = "Z") {
  if (!OFFSET.test(offset)) throw new PeriodError(`"${offset}" is not Z or a fixed offset such as +02:00 or -05:30`);
  return /^[+-]00:00$/.test(offset) ? "Z" : offset;
}

// Midnight UTC of a calendar date, or an error when the date does not exist.
function day(year, month, date) {
  const t = new Date(0);
  t.setUTCFullYear(year, month - 1, date);
  if (year < 1 || t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== date) {
    throw new PeriodError(`${pad(year, 4)}-${pad(month)}-${pad(date)} is not a real calendar date`);
  }
  return t;
}

function plus(t, { years = 0, months = 0, days = 0 }) {
  const n = new Date(t);
  n.setUTCFullYear(n.getUTCFullYear() + years, n.getUTCMonth() + months, n.getUTCDate() + days);
  return n;
}

function bound(t, offset) {
  if (t.getUTCFullYear() > 9999) throw new PeriodError("the period ends after year 9999");
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T00:00:00${offset}`;
}

function fullDate(text) {
  const [, y, m, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return day(Number(y), Number(m), Number(d));
}

/**
 * The `{start, end}` of a label, in `offset`. Throws a PeriodError when the
 * label is not one of the four forms, names no real date, or ends before it starts.
 */
export function periodFromLabel(label, offset = "Z") {
  const zone = normalizeOffset(offset);
  const text = String(label);
  let start;
  let end;
  let m;
  if ((m = /^(\d{4})$/.exec(text))) {
    start = day(Number(m[1]), 1, 1);
    end = plus(start, { years: 1 });
  } else if ((m = /^(\d{4})-(\d{2})$/.exec(text))) {
    start = day(Number(m[1]), Number(m[2]), 1);
    end = plus(start, { months: 1 });
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    start = fullDate(text);
    end = plus(start, { days: 1 });
  } else if ((m = /^(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})$/.exec(text))) {
    start = fullDate(m[1]);
    const last = fullDate(m[2]);
    if (last < start) throw new PeriodError("the last date of the range is before the first");
    end = plus(last, { days: 1 });
  } else {
    throw new PeriodError("not YYYY, YYYY-MM, YYYY-MM-DD or YYYY-MM-DD/YYYY-MM-DD (inclusive dates)");
  }
  return { start: bound(start, zone), end: bound(end, zone) };
}

/** The calendar years a label names, as four-digit strings: where a quote must show one of them. */
export const labelYears = (label) => [...new Set(String(label).split("/").map((part) => part.slice(0, 4)))];

/** Whether the period has ended at `now`, as instants. */
export const hasEnded = (period, now) => Date.parse(period.end) <= now.getTime();

/** Whether the label names a whole calendar year (YYYY alone). */
export const isYearLabel = (label) => /^\d{4}$/.test(String(label));
