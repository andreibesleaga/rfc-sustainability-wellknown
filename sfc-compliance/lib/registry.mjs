/** Registry entries as the checks read them: 2.0 form and 1.x form, normalised to month-bound semantics (5.1, 12.1 rule 6). */
import { addMonths, before, cmpInstant, isInstant } from "./time.mjs";
import { isObject } from "./forms.mjs";
import { is1xEntry, normalise1xEntry } from "./profile1x.mjs";
import { unb64u } from "./canonical.mjs";

/** Normalise an entry: `intervals` have an exclusive `to` instant, `keys` use `{ x, from, to }`. */
export function normEntry(raw) {
  const oneX = is1xEntry(raw);
  const active = (Array.isArray(raw.active) ? raw.active : []).filter(isObject);
  const keys = (Array.isArray(raw.keys) ? raw.keys : []).filter(isObject);
  const read = oneX
    ? normalise1xEntry(raw)
    : {
      intervals: active.map((a) => ({ from: a.from, to: a.to })),
      keys: keys.map((k) => ({ x: k.jwk?.x, from: k.validFromCommit, to: k.validToCommit })),
    };
  // an interval or key whose instants do not parse is left out of the reading; the shape check reports it on the entry
  const instantOrNull = (t) => t === null || isInstant(t);
  read.intervals = read.intervals.filter((iv) => isInstant(iv.from) && instantOrNull(iv.to));
  read.keys = read.keys.filter((k) => isInstant(k.from) && instantOrNull(k.to));
  return {
    raw, form: oneX ? "1x" : "2x", operator: raw.operator, origin: raw.origin, network: raw.network ?? null,
    version: raw.version ?? null, profile2From: raw.profile2From ?? null, nodeProfile: raw.nodeProfile ?? null, ...read,
  };
}

/** Active in the month starting at `start`: `from` before the month's end, `to` null or after its start. */
export function activeIn(entry, start) {
  const end = addMonths(start, 1);
  return entry.intervals.some((iv) => before(iv.from, end) && (iv.to === null || before(start, iv.to)));
}

/** First active month of an entry (its month start), or null. */
export function firstActiveMonth(entry) {
  const froms = entry.intervals.map((iv) => iv.from).sort(cmpInstant);
  return froms.length ? `${froms[0].slice(0, 7)}-01T00:00:00Z` : null;
}

/** Keys valid for an event committed at `commit`: validFromCommit <= commit < validToCommit (null unbounded). */
export const keysValidAt = (entry, commit) => entry.keys.filter((k) => cmpInstant(k.from, commit) <= 0 && (k.to === null || cmpInstant(commit, k.to) < 0));
export const pubOf = (k) => (typeof k.x === "string" ? unb64u(k.x) : null);

/** Intervals sorted and not overlapping, each `to` after `from`. */
export function intervalsOrdered(entry) {
  let prevTo;
  for (const iv of entry.intervals) {
    if (iv.to !== null && !before(iv.from, iv.to)) return false;
    if (prevTo !== undefined && (prevTo === null || before(iv.from, prevTo))) return false;
    prevTo = iv.to;
  }
  return true;
}
