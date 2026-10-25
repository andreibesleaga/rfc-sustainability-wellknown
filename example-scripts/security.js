/**
 * The three safeguards of the draft's Security and Privacy Considerations, as a
 * zero-dependency kit (the same behavior as the publisher's `secureReports`):
 *
 *  1. DoS protection      - refuse a held set above 366 objects; an answer is never truncated.
 *  2. Traffic analysis    - keep to periods of a calendar day or longer: by default an
 *                           object whose bounds are not the first instant of a calendar
 *                           day in their own offset is dropped with a warning.
 *  3. Anti-fingerprinting - OFF BY DEFAULT. With `applyNoise` and `noiseDisclosed`, one
 *                           factor within 0.99 to 1.01 multiplies the perturbed members.
 *
 * A publisher that applies noise MUST state so, and bound its size, in its
 * methodology document; `noiseDisclosed: true` is the operator's confirmation
 * that it did. Nothing here can check it.
 *
 * A date-time is an RFC 3339 `date-time` with upper-case `T` and `Z`. A period is
 * the half-open range from `period.start` to `period.end`; arrays are ordered by
 * the instant of `start`, then of `end`, then by `target`.
 */

/**
 * @typedef {Object} Period
 * @property {string} start
 * @property {string} end
 */

/**
 * @typedef {Object} SustainabilityObject
 * @property {Period} period
 * @property {string} target
 * @property {number} [energy-consumption]
 * @property {number} [carbon-footprint]
 */

/**
 * @typedef {Object} SecurityOptions
 * @property {number} [maxObjects]       default 366
 * @property {"drop"|"warn"|"off"} [dayFloor]  default "drop"
 * @property {boolean} [applyNoise]      default false
 * @property {boolean} [noiseDisclosed]  needed for applyNoise
 * @property {(message: string) => void} [onWarning]
 */

// The members the one factor applies to: the additive quantities and those derived
// from them, so that no unperturbed member discloses a perturbed one. Ratios and
// percentages stay as they are.
const NOISE_MEMBERS = [
  "energy-consumption",
  "carbon-footprint",
  "scope-1",
  "scope-2",
  "scope-3",
  "estimated-annual-emissions-kgCO2e",
  "sci-score",
];

const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * Read an RFC 3339 date-time without Date.parse: the instant (whole seconds and
 * nine digits of fraction) and whether it is midnight in the offset it is written
 * in. Second 60 is read as 59. Throws a RangeError for anything else.
 * @param {unknown} value
 */
function parseDateTime(value) {
  const m = typeof value === "string" ? DATE_TIME.exec(value) : null;
  if (!m) throw new RangeError(`not an RFC 3339 date-time with upper-case T and Z: ${JSON.stringify(value)}`);
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, Math.min(second, 59));
  const real =
    date.getUTCMonth() === month - 1 && date.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 60;
  const offsetHour = Number(m[9] ?? 0);
  const offsetMinute = Number(m[10] ?? 0);
  if (!real || offsetHour > 23 || offsetMinute > 59) {
    throw new RangeError(`not a real date and time: ${JSON.stringify(value)}`);
  }
  const sign = m[8] === "-" ? -1 : 1;
  const fraction = (m[7] ?? "").padEnd(9, "0").slice(0, 9);
  return {
    seconds: date.getTime() / 1000 - sign * (offsetHour * 60 + offsetMinute) * 60,
    fraction,
    date: { year, month, day }, // the calendar date in the offset the value is written in
    midnight: hour === 0 && minute === 0 && second === 0 && /^0*$/.test(fraction),
  };
}

const compareInstants = (a, b) => a.seconds - b.seconds || (a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0);

/** The instant in UTC with `Z`, a fraction only when it is not zero. */
function utcForm({ seconds, fraction }) {
  const whole = new Date(seconds * 1000).toISOString().slice(0, 19);
  const digits = fraction.replace(/0+$/, "");
  return `${whole}${digits ? "." + digits : ""}Z`;
}

/**
 * A key for the period that is the same however its bounds are spelled: `Z`,
 * `+00:00` and `.000Z` agree.
 * @param {Period} period
 */
function canonicalKey(period) {
  return `${utcForm(parseDateTime(period.start))}/${utcForm(parseDateTime(period.end))}`;
}

/**
 * Whether both bounds are the first instant of a calendar day in their own
 * offset. The 23-hour and 25-hour days of a daylight-saving change qualify.
 * @param {Period} period
 */
function isOnDayBoundaries(period) {
  return parseDateTime(period.start).midnight && parseDateTime(period.end).midnight;
}

const codePoints = (text) => Array.from(text, (c) => c.codePointAt(0));

function compareCodePoints(a, b) {
  const left = codePoints(a);
  const right = codePoints(b);
  for (let i = 0; i < left.length && i < right.length; i++) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

/**
 * The order of an array: by the instant of `period.start`, then of `period.end`,
 * then by `target` in code point order.
 * @param {SustainabilityObject} a
 * @param {SustainabilityObject} b
 */
function compareObjects(a, b) {
  return (
    compareInstants(parseDateTime(a.period.start), parseDateTime(b.period.start)) ||
    compareInstants(parseDateTime(a.period.end), parseDateTime(b.period.end)) ||
    compareCodePoints(a.target, b.target)
  );
}

/**
 * Deterministic factor from 0.99 to 1.01 (djb2 hash) of a period's canonical key.
 * Noise is applied once, when the object is generated, so the same period always
 * gives the same published values.
 * @param {string} key
 * @returns {number}
 */
function fuzzFactorFor(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return 0.99 + ((h % 1000) / 1000) * 0.02;
}

function withNoise(object) {
  const fuzz = fuzzFactorFor(canonicalKey(object.period));
  const secured = { ...object };
  for (const member of NOISE_MEMBERS) {
    // Multiplication keeps the sign (scopes MAY be negative under net accounting).
    if (typeof secured[member] === "number") secured[member] = Number((secured[member] * fuzz).toPrecision(6));
  }
  return secured;
}

/**
 * Whether the period is a whole calendar day, month or year ("daily", "monthly",
 * "yearly"): each bound is midnight in its own offset, the end is the next day,
 * month or year of the start. Several whole months are not a whole month.
 * @param {Period} period
 * @param {"yearly"|"monthly"|"daily"} unit
 */
function isWholeCalendarPeriod(period, unit) {
  const start = parseDateTime(period.start);
  const end = parseDateTime(period.end);
  if (!start.midnight || !end.midnight) return false;
  const first = start.date;
  const next = end.date;
  if (unit === "yearly") return first.month === 1 && first.day === 1 && next.month === 1 && next.day === 1 && next.year === first.year + 1;
  if (unit === "monthly") return first.day === 1 && next.day === 1 && (next.year - first.year) * 12 + next.month - first.month === 1;
  const days = (Date.UTC(next.year, next.month - 1, next.day) - Date.UTC(first.year, first.month - 1, first.day)) / 86_400_000;
  return days === 1;
}

const UTC_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const GRANULARITIES = ["yearly", "monthly", "daily"];

// Whether a value is a utc-date-time that names a real moment; second 60 would be read as 59, so it does not count.
function isUtcDateTime(value) {
  if (!UTC_DATE_TIME.test(value) || value.slice(17, 19) === "60") return false;
  try {
    parseDateTime(value);
    return true;
  } catch {
    return false;
  }
}

const VALID_VALUE = {
  target: (value) => value !== "",
  start: isUtcDateTime,
  end: isUtcDateTime,
  granularity: (value) => GRANULARITIES.includes(value),
};

/**
 * The parameters of a query string that a server honors. Names and values are
 * percent-decoded ("+" as a space) and compared case-sensitively. A value that
 * does not match the draft's rule, and a name that appears more than once, are
 * ignored: never an error, never read as another value.
 * @param {string} rawQuery the query component, without the "?"
 * @returns {{target?: string, start?: string, end?: string, granularity?: string}}
 */
function honoredQuery(rawQuery) {
  const seen = {};
  for (const part of rawQuery.split("&")) {
    const at = part.indexOf("=");
    const pair = at < 0 ? [part, ""] : [part.slice(0, at), part.slice(at + 1)];
    try {
      const [name, value] = pair.map((text) => decodeURIComponent(text.replace(/\+/g, " ")));
      if (name in VALID_VALUE) (seen[name] ??= []).push(value);
    } catch {
      // a malformed percent-escape: the pair names nothing
    }
  }
  const honored = {};
  for (const [name, values] of Object.entries(seen)) {
    if (values.length === 1 && VALID_VALUE[name](values[0])) honored[name] = values[0];
  }
  return honored;
}

// A host name compares without regard to ASCII case (RFC 3986, Section 3.2.2); no other folding.
const HOST_NAME = /^[^\s/]+\.[^\s/]+$/;
const ORIGIN_HOST = /^[^\s/]+$/;
const lowerAscii = (text) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

function targetEquals(object, value) {
  if (object.target === value) return true;
  const host = object["target-type"] === "origin" ? ORIGIN_HOST : HOST_NAME;
  return host.test(object.target) && host.test(value) && lowerAscii(object.target) === lowerAscii(value);
}

/**
 * The objects that satisfy every honored parameter, in ascending order; an empty
 * array when none does. Nothing is summed or merged: objects come back as held.
 *  - start and end: the period overlaps the range, which includes start and excludes end.
 *  - target: equals the value.
 *  - granularity: the period is a whole calendar year, month or day.
 * @param {SustainabilityObject[]} held
 * @param {{target?: string, start?: string, end?: string, granularity?: string}} query
 */
function selectObjects(held, query) {
  const start = query.start && parseDateTime(query.start);
  const end = query.end && parseDateTime(query.end);
  return held
    .filter(
      (object) =>
        (!end || compareInstants(parseDateTime(object.period.start), end) < 0) &&
        (!start || compareInstants(parseDateTime(object.period.end), start) > 0) &&
        (query.target === undefined || targetEquals(object, query.target)) &&
        (query.granularity === undefined || isWholeCalendarPeriod(object.period, query.granularity)),
    )
    .sort(compareObjects);
}

/**
 * The objects to serve for a request. A server whose objects are all `basic`
 * supports no parameter: it ignores them all and answers with what it holds, as
 * it holds it (a static file). Otherwise it honors the
 * parameters that match the draft; with none, the answer is every object held.
 * @param {SustainabilityObject[]} held
 * @param {string} rawQuery the query component, without the "?"
 */
function answerQuery(held, rawQuery) {
  if (held.some((object) => object.capabilities === "extended")) return selectObjects(held, honoredQuery(rawQuery));
  return [...held];
}

/**
 * Apply the safeguards to a list of objects; returns a new array in ascending
 * order of period, of at most `maxObjects` objects (a larger held set is refused).
 * @param {SustainabilityObject[]} reports
 * @param {SecurityOptions} [options]
 * @returns {SustainabilityObject[]}
 */
function secureSustainabilityReport(reports, options = {}) {
  const { maxObjects = 366, dayFloor = "drop", applyNoise = false, noiseDisclosed = false } = options;
  const warn = options.onWarning ?? (() => {});
  if (applyNoise && !noiseDisclosed) {
    throw new Error("applyNoise needs noiseDisclosed: true, your confirmation that the methodology document states the noise and bounds it");
  }

  // Filter before capping, so dropped objects do not use up slots of the cap.
  let secured = reports;
  if (dayFloor !== "off") {
    secured = reports.filter((object) => {
      if (isOnDayBoundaries(object.period)) return true;
      warn(`period ${object.period.start} to ${object.period.end} of ${JSON.stringify(object.target)} is not on day boundaries`);
      return dayFloor === "warn";
    });
  }

  secured = [...secured].sort(compareObjects);
  if (secured.length > maxObjects) {
    throw new Error(`${secured.length} objects held, more than maxObjects (${maxObjects}); raise maxObjects or hold fewer objects (an answer is never truncated)`);
  }
  return applyNoise ? secured.map(withNoise) : secured;
}

module.exports = {
  secureSustainabilityReport,
  fuzzFactorFor,
  canonicalKey,
  isOnDayBoundaries,
  compareObjects,
  parseDateTime,
  compareInstants,
  isWholeCalendarPeriod,
  honoredQuery,
  selectObjects,
  answerQuery,
};
