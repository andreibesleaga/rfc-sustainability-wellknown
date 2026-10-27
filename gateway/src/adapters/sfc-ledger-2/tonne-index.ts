/**
 * The single-use index of rule L9 (5.5): the citations of the effective 2.0 CarbonAttested events, kept so that
 * one check of an event costs time in its own citations, not in all citations of the read.
 *
 * Every citation is filed under its registry and reference with running totals (kg and the distinct tonnes/retirement
 * instant pairs). For registries whose methodology names `range-first-last`, the serial ranges are also kept in
 * one list per registry, sorted by first serial. Effective citations of different references never overlap in
 * such a registry (L9 refuses the event that would overlap), so a check walks only the ranges that touch the
 * range asked about.
 *
 * The index changes only where the effective set changes: `indexAdd` when an event becomes effective,
 * `indexRemove` when it is superseded or voided. Each entry is tagged with its owner, the key of the
 * subject, type and month, so a check can leave out the entry of the event it supersedes.
 *
 * A port of `sfc-compliance/lib/tonne-index.mjs`; the vectors keep the two in step.
 */
import { add, cmp, dec, mulInt, sub, ZERO, type Dec, type Json } from "./primitives";

export type SerialRange = [bigint, bigint];

/** A citation with the values the index reads, computed once. */
export interface Prepared {
  registry: string;
  reference: string;
  /** One key per (registry, reference) pair. */
  key: string;
  tonnes: number;
  /** Tonnes retired and the retirement instant: two citations of one reference agree when this is equal. */
  combo: string;
  kg: Dec;
  range: SerialRange | null;
}

interface Group {
  total: Dec;
  combos: Map<string, number>;
  refs: number;
}

interface RangeSlot {
  key: string;
  range: SerialRange;
  count: number;
}

export interface TonneIndex {
  byKey: Map<string, Group>;
  ranges: Map<string, RangeSlot[]>;
  byOwner: Map<string, Prepared[]>;
}

/** What the index needs from the read: exact kg, a normalised instant key, and whether a registry names `range-first-last`. */
export interface IndexReader {
  decOf: (kg: number) => Dec;
  instantKey: (t: string) => string;
  ranged: (registry: string) => boolean;
  serialRange: (reference: string) => SerialRange | null;
}

export const newIndex = (): TonneIndex => ({ byKey: new Map(), ranges: new Map(), byOwner: new Map() });

/** JSON keeps a registry or reference that contains "|" from colliding with another pair. */
const refKey = (c: Json): string => JSON.stringify([c.registry, c.reference]);

export function prepare(cite: Json, reader: IndexReader): Prepared {
  const range = reader.ranged(cite.registry) ? reader.serialRange(cite.reference) : null;
  return {
    registry: cite.registry,
    reference: cite.reference,
    key: refKey(cite),
    tonnes: cite.tonnesRetired,
    combo: `${cite.tonnesRetired}|${reader.instantKey(cite.retiredAt)}`,
    kg: reader.decOf(cite.kg),
    range: range && range[0] <= range[1] ? range : null,
  };
}

// ---- running totals per reference ----------------------------------------------------------

const bump = <K>(map: Map<K, number>, key: K, by: number): void => {
  map.set(key, (map.get(key) ?? 0) + by);
};

function changeKey(index: TonneIndex, c: Prepared, sign: 1 | -1): void {
  let g = index.byKey.get(c.key);
  if (!g) {
    g = { total: ZERO, combos: new Map(), refs: 0 };
    index.byKey.set(c.key, g);
  }
  g.total = sign > 0 ? add(g.total, c.kg) : sub(g.total, c.kg);
  bump(g.combos, c.combo, sign);
  if (g.combos.get(c.combo) === 0) g.combos.delete(c.combo);
  g.refs += sign;
  if (g.refs === 0) index.byKey.delete(c.key);
}

// ---- sorted ranges per registry ------------------------------------------------------------

/** First position whose first serial is greater than `first` (binary search). */
function upperBound(list: RangeSlot[], first: bigint): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].range[0] <= first) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Position of the slot of this reference: slots with the same first serial are adjacent, so search only them. */
function slotOf(list: RangeSlot[], c: Prepared & { range: SerialRange }): number {
  let i = upperBound(list, c.range[0]) - 1;
  while (i >= 0 && list[i].range[0] === c.range[0]) {
    if (list[i].key === c.key) return i;
    i--;
  }
  return -1;
}

function changeRange(index: TonneIndex, c: Prepared, sign: 1 | -1): void {
  if (!c.range) return;
  const filed = { ...c, range: c.range };
  const list = index.ranges.get(c.registry) ?? [];
  index.ranges.set(c.registry, list);
  const slot = slotOf(list, filed);
  if (sign > 0) {
    if (slot >= 0) list[slot].count += 1;
    else list.splice(upperBound(list, c.range[0]), 0, { key: c.key, range: c.range, count: 1 });
  } else if (slot >= 0 && --list[slot].count === 0) list.splice(slot, 1);
}

// ---- adding and removing an owner's citations ----------------------------------------------

/** File the citations of the event that owns `owner`. */
export function indexAdd(index: TonneIndex, owner: string, prepared: Prepared[]): void {
  if (!prepared.length) return;
  index.byOwner.set(owner, prepared);
  for (const c of prepared) {
    changeKey(index, c, 1);
    changeRange(index, c, 1);
  }
}

/** Remove what `owner` filed, if anything. */
export function indexRemove(index: TonneIndex, owner: string): void {
  const prepared = index.byOwner.get(owner);
  if (!prepared) return;
  index.byOwner.delete(owner);
  for (const c of prepared) {
    changeKey(index, c, -1);
    changeRange(index, c, -1);
  }
}

// ---- the L9 question -----------------------------------------------------------------------

interface Totals {
  total: Dec;
  combos: Map<string, number>;
}

/** Totals and combos per reference key over a list of prepared citations. */
function groupByKey(list: Prepared[]): Map<string, Totals> {
  const groups = new Map<string, Totals>();
  for (const c of list) {
    const g = groups.get(c.key) ?? { total: ZERO, combos: new Map<string, number>() };
    g.total = add(g.total, c.kg);
    bump(g.combos, c.combo, 1);
    groups.set(c.key, g);
  }
  return groups;
}

/** Does any citation of the effective set (this event's own entry replaced by `mine`) disagree with `x` on tonnes or instant? */
function comboDiffers(x: Prepared, filed: Group | undefined, own: Totals | undefined, theirs: Totals | undefined): boolean {
  const others = [...(filed?.combos ?? [])].some(([combo, n]) => combo !== x.combo && n - (own?.combos.get(combo) ?? 0) > 0);
  return others || [...(theirs?.combos.keys() ?? [])].some((combo) => combo !== x.combo);
}

/** The kg of one tonne's reference over the effective set, this event in place of the entry it supersedes, against the tonnes retired. */
function overdrawn(x: Prepared, filed: Group | undefined, own: Totals | undefined, theirs: Totals | undefined): boolean {
  const total = add(sub(filed?.total ?? ZERO, own?.total ?? ZERO), theirs?.total ?? ZERO);
  return cmp(total, mulInt(dec(x.tonnes), 1000)) > 0;
}

/** Walk the ranges that touch `x.range`; a range of another reference that is not the owner's own entry counts. */
function touchesFiled(index: TonneIndex, x: Prepared & { range: SerialRange }, ownKeys: Map<string, number>): boolean {
  const list = index.ranges.get(x.registry) ?? [];
  for (let i = upperBound(list, x.range[1]) - 1; i >= 0 && list[i].range[1] >= x.range[0]; i--) {
    if (list[i].key !== x.key && list[i].count > (ownKeys.get(list[i].key) ?? 0)) return true;
  }
  return false;
}

/** Do two ranges of different references in `mine` overlap? One sweep over the ranges sorted by first serial, keeping the furthest-reaching range per registry. */
function mineOverlap(mine: Prepared[]): boolean {
  const ranges = mine.filter((c) => c.range).sort((a, b) => ((a.range as SerialRange)[0] < (b.range as SerialRange)[0] ? -1 : (a.range as SerialRange)[0] > (b.range as SerialRange)[0] ? 1 : 0));
  const reachOf = new Map<string, Prepared>();
  for (const c of ranges) {
    const prev = reachOf.get(c.registry);
    if (prev && (prev.range as SerialRange)[1] >= (c.range as SerialRange)[0] && prev.reference !== c.reference) return true;
    if (!prev || (prev.range as SerialRange)[1] < (c.range as SerialRange)[1]) reachOf.set(c.registry, c);
  }
  return false;
}

/** How many of the owner's own citations sit in each reference's range slot. */
function ownRangeCounts(index: TonneIndex, owner: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of index.byOwner.get(owner) ?? []) if (c.range) bump(counts, c.key, 1);
  return counts;
}

/** One citation of `mine` against the filed index, leaving out the owner's own entry. */
function citationReused(index: TonneIndex, x: Prepared, own: Totals | undefined, theirs: Totals | undefined, ownRanges: Map<string, number>): boolean {
  const filed = index.byKey.get(x.key);
  if (overdrawn(x, filed, own, theirs) || comboDiffers(x, filed, own, theirs)) return true;
  return x.range !== null && touchesFiled(index, x as Prepared & { range: SerialRange }, ownRanges);
}

/**
 * L9 for the citations `mine` (prepared) of the event that owns `owner`: true when a tonne would be used
 * twice or more than once over the effective set with this event in place of its own earlier entry.
 */
export function tonneReused(index: TonneIndex, owner: string, mine: Prepared[]): boolean {
  if (!mine.length || mineOverlap(mine)) return mine.length > 0;
  const own = groupByKey(index.byOwner.get(owner) ?? []);
  const theirs = groupByKey(mine);
  const ownRanges = ownRangeCounts(index, owner);
  return mine.some((x) => citationReused(index, x, own.get(x.key), theirs.get(x.key), ownRanges));
}
