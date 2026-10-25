/**
 * The selection rule of the draft (§Query Parameters): which of the objects a
 * server holds satisfy the parameters it honors, and in what order they are
 * returned. A pure filter and sort: the objects come back member for member as
 * they are held, and nothing is summed, merged or split.
 *
 * Depends on `period.ts` and the types only.
 */
import { comparePeriodStart, isUtcDateTime, isWholeCalendarPeriod, overlapsRange } from "./period";
import { isGranularity } from "./tokens";
import { isHostShaped } from "./util";
import type { ServiceQuery, SustainabilityMetrics } from "./types";

/** The query parameters whose values are honored; every other name is ignored. */
export const QUERY_PARAMETERS = ["target", "start", "end", "granularity"] as const;

/**
 * The parameters of `query` whose values a server honors: a `start` or `end`
 * that is a `utc-date-time`, a `granularity` that is one of the three values, a
 * `target` that is a value at all. The rest is dropped and never read as
 * another value, so a request carrying only such values is the bare request.
 */
export function honoredQuery(query: ServiceQuery): ServiceQuery {
  const honored: ServiceQuery = {};
  if (typeof query.target === "string" && query.target !== "") honored.target = query.target;
  if (isUtcDateTime(query.start)) honored.start = query.start;
  if (isUtcDateTime(query.end)) honored.end = query.end;
  if (isGranularity(query.granularity)) honored.granularity = query.granularity;
  return honored;
}

/** Whether `query` names a parameter to honor. */
export const honorsAny = (query: ServiceQuery): boolean => QUERY_PARAMETERS.some((name) => query[name] !== undefined);

// A name that reads as a host: an origin always does, any other target when it has
// no whitespace or slash and at least one dot (the same reading as the A-label rule).

const lowerAscii = (text: string): string => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** An origin-wide `target` is a host with no whitespace or "/" (a dot is not required: "localhost"). */
const isOriginHost = (value: string): boolean => value.length > 0 && !/[\s/]/.test(value);

/**
 * Whether the `target` member of an object equals the value of a `target`
 * parameter (draft §Mandatory Members): the same sequence of Unicode characters
 * once JSON escapes are decoded, which is how both arrive here; a host name is
 * compared without regard to ASCII case (RFC 3986, Section 3.2.2). No prefix
 * matching, no other folding, no normalization.
 */
export function targetEquals(object: Pick<SustainabilityMetrics, "target" | "target-type">, value: string): boolean {
  if (object.target === value) return true;
  const host = object["target-type"] === "origin" ? isOriginHost : isHostShaped;
  return host(object.target) && host(value) && lowerAscii(object.target) === lowerAscii(value);
}

function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  for (let i = 0; i < left.length && i < right.length; i++) {
    const difference = (left[i].codePointAt(0) as number) - (right[i].codePointAt(0) as number);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

/**
 * The order of a returned array: by the instant of `period.start`, then of
 * `period.end`, then by `target` in code point order. Objects equal in all three
 * keep the order they are held in, since the sort is stable.
 */
export const compareDeclarations = (a: SustainabilityMetrics, b: SustainabilityMetrics): number =>
  comparePeriodStart(a.period, b.period) || compareCodePoints(a.target, b.target);

/** The objects in the order of {@link compareDeclarations}; a new array. */
export const sortDeclarations = (held: readonly SustainabilityMetrics[]): SustainabilityMetrics[] =>
  [...held].sort(compareDeclarations);

/**
 * The objects of `held` that satisfy every parameter of `query` (draft §Query
 * Parameters), in ascending order; an empty array when none does.
 *
 *  - `start` and `end`: the period overlaps the range, which includes `start` and
 *    excludes `end`; an absent bound is unbounded.
 *  - `target`: the target equals the value ({@link targetEquals}).
 *  - `granularity`: the period is a whole calendar year, month or day.
 *
 * `query` holds values that match the draft's ABNF; {@link honoredQuery} drops
 * the others.
 */
export function selectDeclarations(held: readonly SustainabilityMetrics[], query: ServiceQuery): SustainabilityMetrics[] {
  return sortDeclarations(
    held.filter(
      (object) =>
        overlapsRange(object.period, query) &&
        (query.target === undefined || targetEquals(object, query.target)) &&
        (query.granularity === undefined || isWholeCalendarPeriod(object.period, query.granularity)),
    ),
  );
}
