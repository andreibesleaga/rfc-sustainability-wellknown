/** Void acts (5.4) and the replay of the read in ledger order (5.6): the effective attestations. */
import { isObject } from "./forms.mjs";
import { atOrBefore, before, cmpInstant, isInstant } from "./time.mjs";
import { monthOfEvent } from "./ledger.mjs";
import { registrarKeys, verifyUnder } from "./parameters.mjs";
import { newIndex } from "./tonne-index.mjs";
import { staticRules, stateRules, eKey, chainKey, instantKey, fileCitations, unfileCitations } from "./rules.mjs";

// ---- void acts ----------------------------------------------------------------------------

const VOID_MEMBERS = ["commit", "target", "sig"];

function commitCounts(ctx) {
  const counts = new Map();
  for (const item of [...ctx.events, ...ctx.voids]) counts.set(instantKey(item.commit), (counts.get(instantKey(item.commit)) ?? 0) + 1);
  return counts;
}

/**
 * The static judgement of each void act (D2): { ok, target, status } or { ok: false, reason, fail?, unpinned? }.
 * A void is verified under the pinned or methodology keys only, never under the read's own registrar copy; a
 * void under a former key stands, with an INFO (`status` "former"), because void acts are permanent records.
 */
export function voidInfos(ctx) {
  const keys = registrarKeys(ctx);
  const counts = commitCounts(ctx);
  const byHash = eventsByComputedHash(ctx);
  return ctx.voids.map((v) => { ctx.checkDeadline(); return judgeVoid(ctx, v, keys, counts, byHash); });
}

/** Each event by its computed hash (the first one for a hash that repeats), built once per read. */
function eventsByComputedHash(ctx) {
  if (!ctx.cache.has("byComputedHash")) {
    const byHash = new Map();
    for (const e of ctx.events) if (e.computed !== null && !byHash.has(e.computed)) byHash.set(e.computed, e);
    ctx.cache.set("byComputedHash", byHash);
  }
  return ctx.cache.get("byComputedHash");
}

function judgeVoid(ctx, v, usable, counts, byHash) {
  const closed = isObject(v) && Object.keys(v).length === VOID_MEMBERS.length && VOID_MEMBERS.every((k) => k in v);
  if (!closed) return { ok: false, fail: true, reason: "extra member" };
  if (!isInstant(v.commit)) return { ok: false, reason: "commit" };
  if (!usable.length) return { ok: false, unpinned: true, reason: "registrar key not pinned" };
  const verified = verifyUnder(usable, v, ctx.checkDeadline);
  if (!verified.ok) return { ok: false, reason: "signature" };
  const target = byHash.get(v.target);
  if (!target || target.event?.type !== "CarbonAttested" || !before(target.commit, v.commit)) return { ok: false, reason: "target" };
  if (counts.get(instantKey(v.commit)) !== 1) return { ok: false, reason: "commit" };
  return { ok: true, target, status: verified.status };
}

// ---- replay -------------------------------------------------------------------------------

const cachedVoidInfos = (ctx) => {
  if (!ctx.cache.has("voidInfos")) ctx.cache.set("voidInfos", voidInfos(ctx));
  return ctx.cache.get("voidInfos");
};

const isJudgeable = (e) => isObject(e) && (e.type === "EnergyAttested" || e.type === "CarbonAttested") && typeof e.subject === "string";

/** A void act deletes the entry of its target when that is E's entry for the target's subject, type and month. */
function applyVoid(st, info) {
  const target = info.target;
  const month = monthOfEvent(target);
  const key = month === null ? null : eKey(target.event.subject, target.event.type, month);
  const hit = key !== null && st.E.get(key)?.hash === target.computed;
  if (hit) { st.E.delete(key); unfileCitations(st, key); }
  st.voidApplied.push({ target: target.computed, deleted: hit });
}

function judgeEvent(ctx, st, ev) {
  const fixed = staticRules(ctx, ev);
  const judged = isJudgeable(ev.event);
  const state = judged ? stateRules(ctx, st, ev, fixed.month) : { reasons: [], ne: [] };
  const reasons = [...fixed.reasons, ...state.reasons];
  const verdict = { reasons, ne: [...fixed.ne, ...state.ne], skipped: reasons.length > 0 || !judged, month: fixed.month, shape: fixed.shape, span: fixed.span };
  return { verdict, judged };
}

/** Per chain and month, the 2.0 events seen (for L12) and the hashes of the events seen (for L6 of 1.x events). */
function countMonthEvent(st, ev, chain, month) {
  const key = `${chain}|${month}`;
  if (ev.kind === "2x") st.monthCounts.set(key, (st.monthCounts.get(key) ?? 0) + 1);
  st.monthHashes.add(`${key}|${ev.computed}`);
}

function record(ctx, st, ev, verdict) {
  const e = ev.event;
  const chain = chainKey(e.subject, e.type);
  if (!st.chains.has(chain)) st.chains.set(chain, []);
  st.chains.get(chain).push({ hash: ev.computed, kind: ev.kind, month: verdict.month, i: ev.i });
  if (verdict.month !== null) countMonthEvent(st, ev, chain, verdict.month);
  if (ev.kind === "2x") st.twoXBySubject.add(e.subject);
  if (verdict.skipped || verdict.month === null) return;
  const key = eKey(e.subject, e.type, verdict.month);
  unfileCitations(st, key);
  st.E.set(key, { hash: ev.computed, ev, month: verdict.month });
  fileCitations(ctx, st, key, ev);
}

/**
 * Replay the read in ledger order up to `cutoff` (5.6). Returns the state: `E` (effective attestation per
 * subject, type and month), `chains` (every event in chain order, skipped ones included), `verdicts` per
 * event index, and the void acts applied. Never re-sorts the ledger.
 */
export function replay(ctx, cutoff) {
  const id = `replay${cutoff}`;
  if (ctx.cache.has(id)) return ctx.cache.get(id);
  const infos = cachedVoidInfos(ctx);
  const voids = ctx.voids.map((v, k) => ({ v, info: infos[k] })).filter((x) => x.info.ok && atOrBefore(x.v.commit, cutoff))
    .sort((a, b) => cmpInstant(a.v.commit, b.v.commit));
  const st = { E: new Map(), chains: new Map(), monthCounts: new Map(), monthHashes: new Set(), twoXBySubject: new Set(), verdicts: new Map(), voidApplied: [], L9: newIndex() };
  let next = 0;
  for (const ev of ctx.events) {
    ctx.checkDeadline();
    if (!isInstant(ev.commit) || !atOrBefore(ev.commit, cutoff)) continue;
    while (next < voids.length && before(voids[next].v.commit, ev.commit)) applyVoid(st, voids[next++].info);
    const { verdict, judged } = judgeEvent(ctx, st, ev);
    st.verdicts.set(ev.i, verdict);
    if (judged) record(ctx, st, ev, verdict);
  }
  while (next < voids.length) applyVoid(st, voids[next++].info);
  ctx.cache.set(id, st);
  return st;
}

/** The effective attestations at a cut-off as a sorted list of { operator, type, month, hash }. */
export function effectiveList(ctx, cutoff) {
  return [...replay(ctx, cutoff).E.entries()].map(([k, v]) => {
    const [operator, type, month] = k.split("|");
    return { operator, type, month, hash: v.hash };
  }).sort((a, b) => (`${a.operator}${a.type}${a.month}` < `${b.operator}${b.type}${b.month}` ? -1 : 1));
}
