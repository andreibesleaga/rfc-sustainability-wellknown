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
 */
import { dec, add, sub, cmp, mulInt, ZERO } from "./decimal.mjs";
import { serialRange } from "./parameters.mjs";

export const newIndex = () => ({ byKey: new Map(), ranges: new Map(), byOwner: new Map() });

/** One key per (registry, reference) pair; JSON keeps a registry or reference that contains "|" from colliding with another pair. */
const refKey = (c) => JSON.stringify([c.registry, c.reference]);
/** Two citations of one reference agree when tonnes retired and the retirement instant are equal. */
const comboOf = (c, instantKey) => `${c.tonnesRetired}|${instantKey(c.retiredAt)}`;

/** A citation with the values the index reads, computed once. `decOf` reads kg exactly. */
export function prepare(cite, { decOf, instantKey, ranged }) {
  const range = ranged(cite.registry) ? serialRange(cite.reference) : null;
  return {
    registry: cite.registry, reference: cite.reference, key: refKey(cite), tonnes: cite.tonnesRetired,
    combo: comboOf(cite, instantKey), kg: decOf(cite.kg), range: range && range[0] <= range[1] ? range : null,
  };
}

// ---- running totals per reference ----------------------------------------------------------

const bump = (map, key, by) => map.set(key, (map.get(key) ?? 0) + by);

function changeKey(index, c, sign) {
  let g = index.byKey.get(c.key);
  if (!g) { g = { total: ZERO, combos: new Map(), refs: 0 }; index.byKey.set(c.key, g); }
  g.total = sign > 0 ? add(g.total, c.kg) : sub(g.total, c.kg);
  bump(g.combos, c.combo, sign);
  if (g.combos.get(c.combo) === 0) g.combos.delete(c.combo);
  g.refs += sign;
  if (g.refs === 0) index.byKey.delete(c.key);
}

// ---- sorted ranges per registry ------------------------------------------------------------

/** First position whose first serial is greater than `first` (binary search). */
function upperBound(list, first) {
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].range[0] <= first) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function changeRange(index, c, sign) {
  if (!c.range) return;
  const list = index.ranges.get(c.registry) ?? [];
  index.ranges.set(c.registry, list);
  const slot = slotOf(list, c);
  if (sign > 0) {
    if (slot >= 0) list[slot].count += 1;
    else list.splice(upperBound(list, c.range[0]), 0, { key: c.key, range: c.range, count: 1 });
  } else if (slot >= 0 && --list[slot].count === 0) list.splice(slot, 1);
}

/** Position of the slot of this reference: slots with the same first serial are adjacent, so search only them. */
function slotOf(list, c) {
  let i = upperBound(list, c.range[0]) - 1;
  while (i >= 0 && list[i].range[0] === c.range[0]) {
    if (list[i].key === c.key) return i;
    i--;
  }
  return -1;
}

// ---- adding and removing an owner's citations ----------------------------------------------

/** File the citations of the event that owns `owner`. */
export function indexAdd(index, owner, prepared) {
  if (!prepared.length) return;
  index.byOwner.set(owner, prepared);
  for (const c of prepared) { changeKey(index, c, 1); changeRange(index, c, 1); }
}

/** Remove what `owner` filed, if anything. */
export function indexRemove(index, owner) {
  const prepared = index.byOwner.get(owner);
  if (!prepared) return;
  index.byOwner.delete(owner);
  for (const c of prepared) { changeKey(index, c, -1); changeRange(index, c, -1); }
}

// ---- the L9 question -----------------------------------------------------------------------

/** Totals and combos per reference key over a list of prepared citations. */
function groupByKey(list) {
  const groups = new Map();
  for (const c of list) {
    const g = groups.get(c.key) ?? { total: ZERO, combos: new Map() };
    g.total = add(g.total, c.kg);
    bump(g.combos, c.combo, 1);
    groups.set(c.key, g);
  }
  return groups;
}

/** Does any citation of the effective set (this event's own entry replaced by `mine`) disagree with `x` on tonnes or instant? */
function comboDiffers(x, filed, own, theirs) {
  const others = [...(filed?.combos ?? [])].some(([combo, n]) => combo !== x.combo && n - (own?.combos.get(combo) ?? 0) > 0);
  return others || [...(theirs?.combos.keys() ?? [])].some((combo) => combo !== x.combo);
}

/** The kg of one tonne's reference over the effective set, this event in place of the entry it supersedes, against the tonnes retired. */
function overdrawn(x, filed, own, theirs) {
  const total = add(sub(filed?.total ?? ZERO, own?.total ?? ZERO), theirs?.total ?? ZERO);
  return cmp(total, mulInt(dec(x.tonnes), 1000)) > 0;
}

/** Walk the ranges that touch `x.range`; a range of another reference that is not the owner's own entry counts. */
function touchesFiled(index, x, ownKeys) {
  const list = index.ranges.get(x.registry) ?? [];
  for (let i = upperBound(list, x.range[1]) - 1; i >= 0 && list[i].range[1] >= x.range[0]; i--) {
    if (list[i].key !== x.key && (list[i].count > (ownKeys.get(list[i].key) ?? 0))) return true;
  }
  return false;
}

/** Do two ranges of different references in `mine` overlap? Sorted by first serial, one sweep keeping the furthest-reaching range per registry. */
function mineOverlap(mine) {
  const ranges = mine.filter((c) => c.range).sort((a, b) => (a.range[0] < b.range[0] ? -1 : a.range[0] > b.range[0] ? 1 : 0));
  const reachOf = new Map();
  for (const c of ranges) {
    const prev = reachOf.get(c.registry);
    if (prev && prev.range[1] >= c.range[0] && prev.reference !== c.reference) return true;
    if (!prev || prev.range[1] < c.range[1]) reachOf.set(c.registry, c);
  }
  return false;
}

/**
 * L9 for the citations `mine` (prepared) of the event that owns `owner`: true when a tonne would be used
 * twice or more than once over the effective set with this event in place of its own earlier entry.
 */
export function tonneReused(index, owner, mine) {
  if (!mine.length) return false;
  const own = groupByKey(index.byOwner.get(owner) ?? []);
  const theirs = groupByKey(mine);
  const ownRanges = new Map();
  for (const c of index.byOwner.get(owner) ?? []) if (c.range) bump(ownRanges, c.key, 1);
  if (mineOverlap(mine)) return true;
  return mine.some((x) => {
    const filed = index.byKey.get(x.key);
    if (overdrawn(x, filed, own.get(x.key), theirs.get(x.key))) return true;
    if (comboDiffers(x, filed, own.get(x.key), theirs.get(x.key))) return true;
    return Boolean(x.range) && touchesFiled(index, x, ownRanges);
  });
}
