/** RFC 3339 instants, month arithmetic and the grace period. All in UTC. */
const RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/** Epoch milliseconds of a UTC date and time. Unlike Date.UTC, years 0 to 99 stay years 0 to 99. */
function utcMs(year, month, day, h = 0, mi = 0, s = 0) {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(h, mi, s, 0);
  return d.getTime();
}

/**
 * Parse an instant to { sec: BigInt, frac: string } or null when invalid (second 60 is invalid).
 * `frac` keeps every digit of the fraction and drops trailing zeros, so equal moments give equal text and
 * plain string order is numeric order (".5" < ".51", "" < ".5").
 */
export function parseInstant(text) {
  if (typeof text !== "string") return null;
  const m = RE.exec(text);
  if (!m) return null;
  const [Y, Mo, D, h, mi, s] = m.slice(1, 7).map(Number);
  if (Mo < 1 || Mo > 12 || D < 1 || h > 23 || mi > 59 || s > 59) return null;
  const ms = utcMs(Y, Mo, D, h, mi, s);
  if (new Date(ms).getUTCDate() !== D) return null;
  let off = 0;
  if (m[8] !== "Z") {
    const [oh, om] = m[8].slice(1).split(":").map(Number);
    if (oh > 23 || om > 59) return null;
    off = (m[8][0] === "-" ? -1 : 1) * (oh * 60 + om) * 60;
  }
  return { sec: BigInt(ms / 1000 - off), frac: (m[7] ?? "").replace(/0+$/, "") };
}

export function cmpInstant(a, b) {
  const x = parseInstant(a), y = parseInstant(b);
  if (x.sec !== y.sec) return x.sec < y.sec ? -1 : 1;
  return x.frac < y.frac ? -1 : x.frac > y.frac ? 1 : 0;
}
export const before = (a, b) => cmpInstant(a, b) < 0;
export const atOrBefore = (a, b) => cmpInstant(a, b) <= 0;

export const isInstant = (t) => parseInstant(t) !== null;
/** `YYYY-MM-01T00:00:00Z`, no fraction, Z only. */
export const isMonthBound = (t) => typeof t === "string" && /^\d{4}-\d{2}-01T00:00:00Z$/.test(t) && isInstant(t);
export const isFullDate = (t) => typeof t === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t) && parseInstant(`${t}T00:00:00Z`) !== null;

const pad = (n, w = 2) => String(n).padStart(w, "0");
/** Format epoch seconds (Number) as `YYYY-MM-DDTHH:MM:SSZ`. */
export function fmt(sec) {
  const d = new Date(sec * 1000);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}
export const epoch = (t) => Number(parseInstant(t).sec);
export const addSeconds = (t, k) => fmt(epoch(t) + k);
export const addDays = (t, k) => addSeconds(t, k * 86400);

/** Month bound for a year and month (1..12; values outside roll over). */
export function monthBound(year, month) {
  const d = new Date(utcMs(year, month, 1));
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-01T00:00:00Z`;
}
export function addMonths(bound, k) {
  const [y, m] = bound.split("-").map(Number);
  return monthBound(y, m + k);
}
/** The month (bound) that contains a month-bound-or-later instant, in UTC. */
export function monthOf(t) {
  const d = new Date(epoch(t) * 1000);
  return monthBound(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
export const GRACE_DAYS = 5;
/** Due instant of the month that starts at `start`: next month's bound plus G. */
export const dueOf = (start) => addDays(addMonths(start, 1), GRACE_DAYS);
/** Month starts from `start` (inclusive) to `end` (exclusive). */
export function monthsBetween(start, end) {
  const out = [];
  for (let m = start; before(m, end); m = addMonths(m, 1)) out.push(m);
  return out;
}
/** Calendar-month arithmetic with clamping to the last day, UTC, time and fraction kept (compare the result as a moment, with cmpInstant). */
export function addCalendarMonths(t, k) {
  const { sec, frac } = parseInstant(t);
  const d = new Date(Number(sec) * 1000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + k, day = d.getUTCDate();
  const last = new Date(utcMs(y, m + 2, 0)).getUTCDate();
  const r = new Date(utcMs(y, m + 1, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const text = fmt(r.getTime() / 1000);
  return frac ? `${text.slice(0, -1)}.${frac}Z` : text;
}
/** The window for a check anchored at T: the 12 months that ended at least G before T. */
export function windowOf(T) {
  let last = monthOf(T);
  while (before(T, dueOf(last))) last = addMonths(last, -1);
  // `last` is the latest month due at or before T
  return monthsBetween(addMonths(last, -11), addMonths(last, 1));
}
