/**
 * Registry entries as the checks read them (5.1, 12.1 rule 6): 2.0 form and 1.x
 * form, normalised to month-bound semantics. Spec:
 * https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 */
import { addMonths, before, cmpInstant, dayAfter, isFullDate, isInstant, isObject, unb64u, type Json } from "./primitives";
import { is1xEntry } from "./shape";

export interface Interval {
  from: string;
  /** Exclusive; null while active. */
  to: string | null;
}
export interface NormKey {
  x: string | undefined;
  from: string;
  to: string | null;
}
export interface Entry {
  raw: Json;
  form: "1x" | "2x";
  operator: string;
  origin: string;
  network: string | null;
  version: number | null;
  profile2From: string | null;
  nodeProfile: Json;
  intervals: Interval[];
  keys: NormKey[];
}

const instantOrNull = (t: unknown): boolean => t === null || isInstant(t);
const fullDateOrNull = (t: unknown): boolean => t === null || isFullDate(t);

/** The intervals of an entry as instants with an exclusive `to`; a 1.x `to` is an inclusive date (12.1 rule 6). */
function intervalsOf(active: Json[], oneX: boolean): Interval[] {
  if (!oneX) return active.map((a) => ({ from: a.from, to: a.to }));
  return active.filter((a) => isFullDate(a.from) && fullDateOrNull(a.to)).map((a) => ({ from: `${a.from}T00:00:00Z`, to: a.to === null ? null : dayAfter(a.to) }));
}

/** The keys of an entry with the 2.0 names. */
const keysOf = (keys: Json[], oneX: boolean): NormKey[] =>
  keys.map((k) => (oneX ? { x: k["public-jwk"]?.x, from: k["valid-from-commit"], to: k["valid-to-commit"] } : { x: k.jwk?.x, from: k.validFromCommit, to: k.validToCommit }));

/**
 * Normalise an entry. `intervals` use exclusive `to` instants; `keys` use the 2.0 names. An item that is not an
 * object, and an interval or key whose instants do not parse, is left out of the reading: the shape check
 * reports it on the entry (D2), and no later rule meets a value it cannot compare.
 */
export function normEntry(raw: Json): Entry {
  const oneX = is1xEntry(raw);
  const active: Json[] = (Array.isArray(raw.active) ? raw.active : []).filter(isObject);
  const keys: Json[] = (Array.isArray(raw.keys) ? raw.keys : []).filter(isObject);
  return {
    raw,
    form: oneX ? "1x" : "2x",
    operator: raw.operator,
    origin: raw.origin,
    network: raw.network ?? null,
    version: raw.version ?? null,
    profile2From: raw.profile2From ?? null,
    nodeProfile: raw.nodeProfile ?? null,
    intervals: intervalsOf(active, oneX).filter((iv) => isInstant(iv.from) && instantOrNull(iv.to)),
    keys: keysOf(keys, oneX).filter((k) => isInstant(k.from) && instantOrNull(k.to)),
  };
}

/** Active in the month starting at `start`: an interval from before the month's end, to null or after its start (3.2). */
export function activeIn(entry: Entry, start: string): boolean {
  const end = addMonths(start, 1);
  return entry.intervals.some((iv) => before(iv.from, end) && (iv.to === null || before(start, iv.to)));
}

const monthFloor = (t: string): string => `${t.slice(0, 7)}-01T00:00:00Z`;
/** First active month of an entry (month start), or null. */
export function firstActiveMonth(entry: Entry): string | null {
  const froms = entry.intervals.map((iv) => iv.from).sort(cmpInstant);
  return froms.length ? monthFloor(froms[0]) : null;
}

/** Keys valid for an event committed at `commit`: validFromCommit <= commit < validToCommit (null unbounded) (5.1). */
export const keysValidAt = (entry: Entry, commit: string): NormKey[] => entry.keys.filter((k) => cmpInstant(k.from, commit) <= 0 && (k.to === null || cmpInstant(commit, k.to) < 0));
export const pubOf = (k: NormKey): Buffer | null => (typeof k.x === "string" ? unb64u(k.x) : null);

/** Intervals sorted and not overlapping, each `to` after `from` (D2). */
export function intervalsOrdered(entry: Entry): boolean {
  let prevTo: string | null | undefined;
  for (const iv of entry.intervals) {
    if (iv.to !== null && !before(iv.from, iv.to)) return false;
    if (prevTo !== undefined) {
      if (prevTo === null) return false;
      if (before(iv.from, prevTo)) return false;
    }
    prevTo = iv.to;
  }
  return true;
}

/**
 * 12.1 rule 6: the 2.0-form `active` intervals of a 1.x entry (month bounds,
 * overlapping or meeting intervals merged) and its renamed keys. A registrar
 * writes this when it first re-signs a 1.x entry; the active months stay the
 * same, so it is a change of form, not an alteration of a past interval.
 */
export function convert1xEntry(entry: Json): { active: Interval[]; keys: Json[] } {
  const month = (date: string): string => `${date.slice(0, 7)}-01T00:00:00Z`;
  const raw: Interval[] = entry.active.map((a: Json) => ({ from: month(a.from), to: a.to === null ? null : addMonths(month(a.to), 1) }));
  raw.sort((x, y) => cmpInstant(x.from, y.from));
  const merged: Interval[] = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && (last.to === null || !before(last.to, iv.from))) {
      if (last.to !== null && (iv.to === null || before(last.to, iv.to))) last.to = iv.to;
    } else merged.push({ ...iv });
  }
  return {
    active: merged,
    keys: entry.keys.map((k: Json) => ({ jwk: k["public-jwk"], validFromCommit: k["valid-from-commit"], validToCommit: k["valid-to-commit"] })),
  };
}
