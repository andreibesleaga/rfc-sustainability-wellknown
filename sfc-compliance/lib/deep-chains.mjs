/** D3 events, D4 chains and checkpoint, D5 effective attestations (9.4 steps 3 to 5). */
import { canonicalize, hashOf, textHash } from "./canonical.mjs";
import { isObject, sameHost } from "./forms.mjs";
import { sigInfo } from "./ledger.mjs";
import { replay } from "./replay.mjs";
import { chainKey, instantKey } from "./rules.mjs";
import { deriveFor, headAndCountTokens } from "./derive.mjs";
import { registrarKeys, verifyUnder, methodologyPinned, takeoverOf } from "./parameters.mjs";
import { entry1xAuthenticated } from "./deep-registry.mjs";
import { notes1x } from "./profile1x.mjs";
import { atOrBefore, before, cmpInstant, dueOf, isInstant } from "./time.mjs";
import { row, PASS, FAIL, NE, INFO, list } from "./rows.mjs";
import { extOf, usablePeriod } from "./declaration.mjs";

const typeShort = (t) => (t === "EnergyAttested" ? "Energy" : "Carbon");
export const evScope = (ev) => `${ev.event?.subject} ${typeShort(ev.event?.type)} ${ev.commit}`;
const chainScope = (op, type) => `${op} ${typeShort(type)}`;

const D3_TOKENS = ["L1", "L2", "L3", "L5", "encoding", "weak"];
const D5_TOKENS = ["L4", "L6", "L7", "L8", "L8b", "L9", "L10", "L11", "L11b", "L12"];

/** The events of each (operator, type) chain committed at or before `cutoff`, in ledger order. */
function chainsOf(ctx, cutoff) {
  const chains = new Map();
  for (const ev of ctx.events) {
    if (!isInstant(ev.commit) || !atOrBefore(ev.commit, cutoff) || !isObject(ev.event) || typeof ev.event.subject !== "string") continue;
    const key = chainKey(ev.event.subject, ev.event.type);
    if (!chains.has(key)) chains.set(key, []);
    chains.get(key).push(ev);
  }
  return chains;
}

/** The limit names hit by each event, by event index. */
function limitsByEvent(hits) {
  const byEvent = new Map();
  for (const h of hits) if (h.event !== null) byEvent.set(h.event, [...(byEvent.get(h.event) ?? []), h.limit]);
  return byEvent;
}

// ---- ledger order and D3 ------------------------------------------------------------------

/** Row `D3.order`: commit instants strictly increase, no hash repeats, void commits are distinct. */
export function ledgerOrderRow(ctx) {
  const bad = [];
  for (let i = 1; i < ctx.events.length; i++) {
    ctx.checkDeadline();
    const a = ctx.events[i - 1], b = ctx.events[i];
    if (isInstant(a.commit) && isInstant(b.commit) && cmpInstant(a.commit, b.commit) >= 0) bad.push("commit instants do not strictly increase");
  }
  const hashes = ctx.events.map((e) => e.hash);
  if (new Set(hashes).size !== hashes.length) bad.push("hash repeats");
  const commits = new Set(ctx.events.map((e) => instantKey(e.commit)));
  const voidCommits = new Set();
  for (const v of ctx.voids) {
    if (commits.has(instantKey(v.commit)) || voidCommits.has(instantKey(v.commit))) bad.push("void commit not distinct");
    voidCommits.add(instantKey(v.commit));
  }
  return row("D3.order", bad.length ? FAIL : PASS, bad.length ? `ledger order: ${list(bad)}` : undefined, "ledger");
}

/** The row of one event under D3: FAIL tokens, NOT-EVALUABLE causes, or null. */
function d3EventRow(ctx, st, ev, op, limitsOfEvent) {
  ctx.checkDeadline();
  const verdict = st.verdicts.get(ev.i);
  const tokens = [], causes = [];
  const lim = limitsOfEvent.get(ev.i) ?? [];
  if (lim.length) causes.push(`limit: ${lim.join(", ")}`);
  if (ev.hash !== ev.computed) tokens.push("hash");
  for (const t of D3_TOKENS) if (verdict.reasons.includes(t)) tokens.push(t === "weak" ? "weak key" : t);
  if (verdict.ne.includes("L5:alg")) causes.push(`L5 alg ${sigInfo(ctx, ev).algName}`);
  const entry = ctx.byOperator.get(op);
  if (entry && entry.form === "1x" && !entry1xAuthenticated(ctx, entry) && !tokens.includes("L5")) causes.push("L5 entry not authenticated");
  if (tokens.length) return row("D3.event", FAIL, list(tokens), evScope(ev));
  return causes.length ? row("D3.event", NE, list(causes), evScope(ev)) : null;
}

const worstOf = (rows) => (rows.some((r) => r.result === FAIL) ? FAIL : rows.some((r) => r.result === NE) ? NE : PASS);

export function d3(ctx, st, cutoff, hits) {
  const rows = [];
  const limitsOfEvent = limitsByEvent(hits);
  for (const [key, evs] of chainsOf(ctx, cutoff)) {
    const [op, type] = key.split("|");
    const evRows = evs.map((ev) => d3EventRow(ctx, st, ev, op, limitsOfEvent)).filter(Boolean);
    rows.push(row("D3", worstOf(evRows), `${evs.length} events`, chainScope(op, type)), ...evRows);
  }
  return rows;
}

// ---- D4 -----------------------------------------------------------------------------------

/** Forks: a shared non-null `prev`, or more than one chain start (null, or a takeover link). */
function forkTokens(evs) {
  const prevs = new Map();
  for (const ev of evs) if (ev.event.prev !== null) prevs.set(ev.event.prev, (prevs.get(ev.event.prev) ?? 0) + 1);
  const starts = evs.filter((ev, i) => i === 0 || ev.event.prev === null);
  const tokens = [];
  if ([...prevs.values()].some((n) => n > 1)) tokens.push("fork: shared prev");
  if (starts.length > 1) tokens.push("fork: more than one chain start");
  return tokens;
}

/** Takeover (4.4 rule 5): the first event links to the listed tip, and the old ledger ends at it. */
function takeoverFindings(ctx, evs, op, type) {
  const tokens = [], infos = [];
  let unreachable = false, unverified = false;
  const take = takeoverOf(ctx, op, type);
  if (evs[0] && evs[0].event.prev !== null) {
    if (!methodologyPinned(ctx)) { infos.push("takeover not verified (methodology document not pinned)"); unverified = true; }
    else if (!take || take.tip !== evs[0].event.prev) tokens.push("takeover link not listed");
  }
  if (take && methodologyPinned(ctx)) {
    const old = (ctx.input.oldLedgers ?? []).find((x) => x.operator === op && x.type === type);
    if (!old) unreachable = true;
    else if (!oldLedgerEndsAt(old.chain, take.tip)) tokens.push("cross-ledger fork");
  }
  return { tokens, infos, unreachable, unverified };
}
function oldLedgerEndsAt(chain, tip) {
  const hashes = chain.map((e) => hashOf(e));
  const linked = chain.every((e, i) => e.prev === (i === 0 ? null : hashes[i - 1]));
  return linked && hashes[hashes.length - 1] === tip;
}

const CHECKPOINT_MEMBERS = ["network", "read-at", "chains", "registry-digest", "ledger-digest", "voids-digest", "sig"];
const DIGEST_MEMBERS = ["registry-digest", "ledger-digest", "voids-digest"];

const isChainCount = (c) => isObject(c) && typeof c.operator === "string" && typeof c.type === "string"
  && Number.isInteger(c.count) && c.count >= 0 && (c.tip === null || typeof c.tip === "string");

/**
 * Does the checkpoint hold the member types the checks read? Every later step reads `read-at`, `chains` and the
 * digests without a further test, so this is the one place that makes that safe.
 */
export function checkpointShapeOk(cp) {
  const chainsOk = cp.chains === undefined || (Array.isArray(cp.chains) && cp.chains.every(isChainCount));
  const digestsOk = DIGEST_MEMBERS.every((m) => cp[m] === undefined || typeof cp[m] === "string");
  return isInstant(cp["read-at"]) && chainsOk && digestsOk;
}

/** Chains of the checkpoint against the walk to `read-at`; returns mismatch tokens and chains missing from the read. */
function checkpointChains(ctx, cp) {
  const st = replay(ctx, ctx.readAt);
  const tokens = [], missing = [];
  for (const c of cp.chains ?? []) {
    const chain = st.chains.get(chainKey(c.operator, c.type)) ?? [];
    if (chain.length === 0 && c.count > 0) { missing.push(chainScope(c.operator, c.type)); continue; }
    const tip = chain.length ? chain[chain.length - 1].hash : null;
    if (tip !== c.tip || chain.length !== c.count) tokens.push(`chain ${c.operator} ${typeShort(c.type)}`);
  }
  return { tokens, missing };
}

function digestTokens(ctx, cp) {
  const tokens = [];
  const sorted = [...(ctx.ex.registry ?? [])].sort((a, b) => (a.operator < b.operator ? -1 : 1));
  if (cp["registry-digest"] !== undefined && cp["registry-digest"] !== textHash(canonicalize(sorted))) tokens.push("registry-digest");
  if (cp["ledger-digest"] !== undefined && cp["ledger-digest"] !== textHash(canonicalize(ctx.ex.ledger ?? []))) tokens.push("ledger-digest");
  if (cp["voids-digest"] !== undefined && cp["voids-digest"] !== textHash(canonicalize(ctx.ex.voids ?? []))) tokens.push("voids-digest");
  return tokens;
}

function checkpointRows(ctx) {
  const cp = ctx.checkpoint;
  const scope = "checkpoint";
  if (!cp) return [row("D4.checkpoint", INFO, "absent: ledger read not authenticated: commit instants and completeness are the source's claim", scope)];
  if (!isObject(cp) || Object.keys(cp).some((k) => !CHECKPOINT_MEMBERS.includes(k))) return [row("D4.checkpoint", FAIL, "mismatch: extra member", scope)];
  if (!checkpointShapeOk(cp)) return [row("D4.checkpoint", FAIL, "mismatch: shape", scope)];
  const current = registrarKeys(ctx).filter((k) => k.status === "current");
  if (!current.length) return [row("D4.checkpoint", NE, "registrar key not pinned", scope)];
  const tokens = [];
  if (!verifyUnder(current, cp, ctx.checkDeadline).ok) tokens.push("signature");
  if (!sameHost(cp.network, ctx.network) || cmpInstant(cp["read-at"], ctx.readAt) !== 0) tokens.push("network or read-at");
  const chains = checkpointChains(ctx, cp);
  tokens.push(...chains.tokens, ...digestTokens(ctx, cp));
  ctx.missingChains = [...new Set(chains.missing)].sort();
  const rows = [row("D4.checkpoint", tokens.length ? FAIL : PASS, tokens.length ? `mismatch: ${list(tokens)}` : "verified", scope)];
  for (const m of ctx.missingChains) rows.push(row("D4.info", INFO, `chain of ${m} not in read`, scope));
  if (!tokens.length) rows.push(...unauthenticatedRows(ctx, cp, scope));
  return rows;
}

/** What a verified checkpoint does not cover: commit instants without `ledger-digest`, void acts without `voids-digest` (in that order, 9.4 D4). */
function unauthenticatedRows(ctx, cp, scope) {
  const rows = [];
  if (cp["ledger-digest"] === undefined) rows.push(row("D4.info", INFO, "commit instants not authenticated: no ledger-digest", scope));
  if (cp["voids-digest"] === undefined && (ctx.ex.voids ?? []).length) rows.push(row("D4.info", INFO, "void acts not authenticated", scope));
  return rows;
}

/** The declared heads and event counts against the recomputed ones. */
function declaredHeadsRow(ctx, cutoff, decl, level, label) {
  const period = usablePeriod(decl);
  if (!period) return [];
  const d = deriveFor(ctx, cutoff, period, decl, level);
  const operators = extOf(decl, "ledger-evidence-2").operators;
  const bad = headAndCountTokens(Array.isArray(operators) ? operators : [], d);
  return [row("D4.declared", bad.length ? FAIL : PASS, list(bad), label)];
}

export function d4(ctx, cutoff, decl, level, label) {
  const rows = [];
  ctx.unverifiedTakeovers = [];
  for (const [key, evs] of chainsOf(ctx, cutoff)) {
    ctx.checkDeadline();
    const [op, type] = key.split("|");
    const take = takeoverFindings(ctx, evs, op, type);
    const tokens = [...forkTokens(evs), ...take.tokens];
    const notEvaluable = take.unreachable || take.unverified;
    const result = tokens.length ? FAIL : notEvaluable ? NE : PASS;
    const causes = [...tokens, ...(take.unreachable ? ["old ledger unreachable"] : []), ...(take.unverified ? ["takeover not verified"] : [])];
    rows.push(row("D4.chain", result, list(causes), chainScope(op, type)));
    if (take.unverified) ctx.unverifiedTakeovers.push(chainScope(op, type));
    for (const info of take.infos) rows.push(row("D4.info", INFO, info, chainScope(op, type)));
  }
  for (const ev of ctx.events) {
    ctx.checkDeadline();
    if (isInstant(ev.commit) && before(ctx.readAt, ev.commit)) rows.push(row("D4.event", FAIL, "commit after read-at", evScope(ev)));
  }
  rows.push(...checkpointRows(ctx));
  if (decl && decl.updated && extOf(decl, "ledger-evidence-2")) rows.push(...declaredHeadsRow(ctx, cutoff, decl, level, label));
  return rows;
}

// ---- D5 -----------------------------------------------------------------------------------

/** Each effective attestation committed after the due instant of its month rests on the operator's word for its retirement dates. */
function lateFiledRows(st) {
  const late = [...st.E.entries()].filter(([, v]) => before(dueOf(v.month), v.ev.commit)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return late.map(([, v]) => row("D5.late", INFO, "late-filed, retirement dates asserted only", evScope(v.ev)));
}

function d5EventRow(ctx, st, ev) {
  ctx.checkDeadline();
  const verdict = st.verdicts.get(ev.i);
  const tokens = D5_TOKENS.filter((t) => verdict.reasons.includes(t));
  const causes = verdict.ne.filter((x) => x !== "L5:alg");
  if (tokens.length) return row("D5.event", FAIL, `${list(tokens)}; skipped`, evScope(ev));
  if (causes.length) return row("D5.event", NE, list(causes), evScope(ev));
  return verdict.reasons.length ? row("D5.event", INFO, "skipped (see D3)", evScope(ev)) : null;
}

/**
 * What leaves the single-use rule L9 unchecked for every chain: a chain the checkpoint lists and the read omits,
 * and a chain whose first event links to an earlier ledger that no pinned methodology document vouches for.
 * L9 reads every operator's events, so either gap makes each chain's D5 NOT-EVALUABLE.
 */
export function l9Gaps(ctx) {
  const missing = ctx.missingChains ?? [], unverified = ctx.unverifiedTakeovers ?? [];
  return [...(missing.length ? [`chain of ${missing.join(", ")} not in read`] : []), ...(unverified.length ? [`takeover not verified: ${unverified.join(", ")}`] : [])];
}

export function d5(ctx, st, cutoff, hits) {
  const rows = [];
  for (const [key, evs] of chainsOf(ctx, cutoff)) {
    const [op, type] = key.split("|");
    const evRows = evs.map((ev) => d5EventRow(ctx, st, ev)).filter(Boolean);
    let result = worstOf(evRows.filter((r) => r.result !== INFO));
    let detail = `${evs.length} events`;
    if (hits.length && result === PASS) { result = NE; detail = `limit: ${list(hits.map((h) => h.limit))}`; }
    else if (l9Gaps(ctx).length && result === PASS) { result = NE; detail = `L9 not evaluable: ${l9Gaps(ctx).join("; ")}`; }
    rows.push(row("D5", result, detail, chainScope(op, type)), ...evRows);
    for (const ev of evs.filter((e) => e.kind === "1x")) { ctx.checkDeadline(); rows.push(...notes1x(ctx, st, ev, evs, evScope)); }
  }
  rows.push(...lateFiledRows(st));
  return rows;
}
