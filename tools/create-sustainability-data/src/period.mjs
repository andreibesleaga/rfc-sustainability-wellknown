/**
 * The period of a declaration from what the person gave: a calendar label (2025, 2025-03,
 * 2025-03-14) in an offset, two inclusive dates, or two date-times. All calendar arithmetic is the
 * publisher library's; this file only chooses which of its functions applies.
 */
import { PeriodError, parsePeriod, periodFromFullDates, periodFromReportingPeriod, yearPeriod } from "sustainability-wellknown-publisher";

const FORMS = [["period"], ["period-start", "period-end"], ["first-day", "last-day"]];

const given = (a, k) => a[k] !== undefined && String(a[k]).trim() !== "";

/**
 * The half-open period for the answers; `now` only decides the default, the last whole calendar year.
 * Throws an Error whose message names what is wrong.
 */
export function periodFrom(a, now) {
  const offset = given(a, "offset") ? String(a.offset).trim() : "Z";
  if (offset === "z") throw new Error('period: --offset "z" must be written in upper case, "Z" (the draft\'s date-time profile)');
  const used = FORMS.filter((names) => names.some((k) => given(a, k)));
  if (used.length > 1) {
    throw new Error("give the period in one form only: --period, or --period-start with --period-end, or --first-day with --last-day");
  }
  const [names] = used;
  if (names === undefined) return yearPeriod(now.getUTCFullYear() - 1, offset);
  const missing = names.filter((k) => !given(a, k));
  if (missing.length > 0) throw new Error(`${missing.join(", ")} is required with ${names.filter((k) => given(a, k)).join(", ")}`);
  const value = (k) => String(a[k]).trim();
  try {
    if (names[0] === "period") return periodFromReportingPeriod(value("period"), offset);
    if (names[0] === "first-day") return periodFromFullDates({ start: value("first-day"), end: value("last-day") }, offset);
    return parsePeriod({ start: value("period-start"), end: value("period-end") });
  } catch (e) {
    if (e instanceof PeriodError) throw new Error(`period: ${e.message}`);
    throw e;
  }
}
