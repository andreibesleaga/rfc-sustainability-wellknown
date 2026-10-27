/** Window checks: C-SFC-1, C-SFC-2 (ledger form), C-SFC-3, C-SFC-4, C-SFC-6 (3.2, 4.4, 9.2). */
import { dec, add, cmp, mulInt, ZERO, shift, fromNumber } from "./decimal.mjs";
import { eKey, decOf, coverageHolds } from "./rules.mjs";
import { replay } from "./replay.mjs";
import { activeIn } from "./registry.mjs";
import { addCalendarMonths, before, cmpInstant, dueOf, isInstant, windowOf, epoch } from "./time.mjs";
import { row, PASS, FAIL, NE, DECLARED, NOT_DECLARED, INFO, worst, list } from "./rows.mjs";
import { HARDWARE, REUSE } from "./shapes.mjs";
import { isFullDate, isObject, asciiLower } from "./forms.mjs";

export const CAP_KWH = dec(1000000);
const WINDOW_LABEL = (w) => `${w[0].slice(0, 7)}..${w[w.length - 1].slice(0, 7)}`;

/** Whether `readAt` is older than MAX_READ_AGE or later than the clock plus the skew. An excerpt of another version may carry no usable read-at: then neither (D1 stops on its version). */
function readAgeAgainst(readAt, clock, maxReadAgeSeconds, skewSeconds) {
  if (clock === null || !isInstant(readAt)) return { tooOld: false, inFuture: false };
  return { tooOld: epoch(clock) - epoch(readAt) > maxReadAgeSeconds, inFuture: epoch(readAt) > epoch(clock) + skewSeconds };
}

/**
 * Times (3.2, 5.7): the explicit T, the checker's clock, and the anchor of window and cut-off. With the
 * clock as T the read is stale when older than MAX_READ_AGE or later than the clock plus the skew; with an
 * explicit T there is no age limit, and a T later than `read-at` makes the checks that need a fresh read
 * NOT-EVALUABLE ("read older than T").
 */
export function timeInfo(ctx) {
  const explicit = ctx.input.T ?? null;
  const clock = ctx.input.now ?? null;
  const T = explicit ?? clock ?? ctx.readAt;
  const anchor = explicit ?? ctx.readAt;
  const { maxReadAgeSeconds, skewSeconds } = ctx.limits;
  const { tooOld, inFuture } = readAgeAgainst(ctx.readAt, clock, maxReadAgeSeconds, skewSeconds);
  const stale = !explicit && (tooOld || inFuture);
  const readOlderThanT = isInstant(ctx.readAt) && explicit !== null && before(ctx.readAt, explicit);
  return { explicit, clock, T, anchor, stale, readOlderThanT, tSource: explicit ? "explicit" : clock ? "checker clock" : "read-at" };
}

/** The operator-months of a set of months (an operator active in a month), and the months with no active operator. */
function operatorMonths(ctx, months) {
  const opMonths = [], uncovered = [];
  for (const m of months) {
    const active = ctx.registry.filter((en) => activeIn(en, m));
    if (!active.length) uncovered.push(m);
    for (const en of active) opMonths.push({ en, m });
  }
  return { opMonths, uncovered };
}

/** The window of a check, its replay at the anchor, and its operator-months. */
function windowFacts(ctx, ti) {
  const w = windowOf(ti.anchor);
  return { w, st: replay(ctx, ti.anchor), ...operatorMonths(ctx, w) };
}

/** The reason a window check cannot run, or null. */
function blocked(ctx, ti, f) {
  if (ti.stale) return "stale read";
  if (ti.readOlderThanT) return "read older than T";
  if (!f.opMonths.length) return "no operator active in the window";
  return null;
}

const effective = (f, en, type, m) => f.st.E.get(eKey(en.operator, type, m));

/** C-SFC-1: every active operator-month of the window has an effective `EnergyAttested`. */
export function csfc1(ctx, ti, f) {
  const scope = WINDOW_LABEL(f.w);
  const b = blocked(ctx, ti, f);
  if (b) return row("C-SFC-1", NE, b, scope);
  const silent = f.opMonths.filter(({ en, m }) => !effective(f, en, "EnergyAttested", m)).map(({ en, m }) => `${en.operator} ${m.slice(0, 7)}`);
  if (silent.length) return row("C-SFC-1", FAIL, `silent: ${list(silent)}`, scope);
  return row("C-SFC-1", PASS, f.uncovered.length ? "INFO window not fully covered" : undefined, scope);
}

/** C-SFC-2, ledger form: the energy of the window is below CAP (order of 9.2: FAIL, then NOT-EVALUABLE, then PASS). */
export function csfc2Ledger(ctx, ti, f) {
  const scope = WINDOW_LABEL(f.w);
  const b = blocked(ctx, ti, f);
  if (b) return row("C-SFC-2", NE, b, `ledger ${scope}`);
  let sum = ZERO;
  const silent = [];
  for (const { en, m } of f.opMonths) {
    const e = effective(f, en, "EnergyAttested", m);
    if (e) sum = add(sum, decOf(e.ev.event.payload.kWhConsumed)); else silent.push(`${en.operator} ${m.slice(0, 7)}`);
  }
  const unread = hasUnjudgedAlgorithm(f, f.opMonths);
  if (cmp(sum, CAP_KWH) >= 0) return row("C-SFC-2", FAIL, "sum at or above CAP", `ledger ${scope}`);
  if (silent.length || f.uncovered.length) {
    return row("C-SFC-2", NE, silent.length ? `silent: ${list(silent)}` : "window not fully covered", `ledger ${scope}`);
  }
  if (unread) return row("C-SFC-2", NE, "L5 not evaluable for a counted event", `ledger ${scope}`);
  return row("C-SFC-2", PASS, undefined, `ledger ${scope}`);
}
/** A counted effective event whose algorithm the verifier cannot judge (1.x, L5 not evaluable). */
function hasUnjudgedAlgorithm(f, opMonths) {
  return opMonths.some(({ en, m }) => ["EnergyAttested", "CarbonAttested"].some((t) => {
    const e = f.st.E.get(eKey(en.operator, t, m));
    return e && f.st.verdicts.get(e.ev.i).ne.includes("L5:alg");
  }));
}

/** C-SFC-4 over a set of months at a cut-off: the verdict row first, then one INFO row per late-filed or 1.x attestation. */
export function csfc4(ctx, months, cutoff, scope, blockReason) {
  const st = replay(ctx, cutoff);
  const { opMonths, uncovered } = operatorMonths(ctx, months);
  if (blockReason) return [row("C-SFC-4", NE, blockReason, scope)];
  if (!opMonths.length) return [row("C-SFC-4", NE, "no operator active in the window", scope)];
  const bad = [], infos = [];
  let ne = false;
  for (const { en, m } of opMonths) {
    const e = st.E.get(eKey(en.operator, "CarbonAttested", m));
    const label = `${en.operator} ${m.slice(0, 7)}`;
    if (!e) { bad.push(`silent ${label}`); continue; }
    const p = e.ev.event.payload;
    if (p.netZero !== true || !coverageHolds(p)) bad.push(`not covered ${label}`);
    if (e.ev.kind === "1x") infos.push(`retirement rules L8b to L10 not applied: ${e.hash}`);
    else if (before(dueOf(m), e.ev.commit)) infos.push(`late-filed: ${e.hash} committed ${e.ev.commit}`);
    if (st.verdicts.get(e.ev.i).ne.includes("L5:alg")) ne = true;
  }
  const out = [];
  if (bad.length) out.push(row("C-SFC-4", FAIL, list(bad), scope));
  else if (ne) out.push(row("C-SFC-4", NE, "L5 not evaluable for a counted event", scope));
  else out.push(row("C-SFC-4", PASS, uncovered.length ? "INFO window not fully covered" : undefined, scope));
  for (const t of [...new Set(infos)].sort()) out.push(row("C-SFC-4.info", INFO, t, scope));
  return out;
}

/** C-SFC-3: every operator active in the window declares complete node hardware; reported DECLARED, never "C2 passed". */
export function csfc3(ctx, ti, f) {
  const scope = WINDOW_LABEL(f.w);
  if (!ctx.registry.length) return row("C-SFC-3", NE, "no Registry", scope);
  const ens = ctx.registry.filter((en) => f.w.some((m) => activeIn(en, m)));
  if (!ens.length) return row("C-SFC-3", NE, "no operator active in the window", scope);
  const bad = ens.filter((en) => !nodeProfileComplete(en.nodeProfile)).map((en) => en.operator);
  return bad.length ? row("C-SFC-3", NOT_DECLARED, list(bad), scope) : row("C-SFC-3", DECLARED, undefined, scope);
}
/** A complete `nodeProfile` (5.1): class in the list, `asicForbidden` true, both dates in order, `reusePolicy` in the list. */
export function nodeProfileComplete(n) {
  return isObject(n) && HARDWARE.includes(n.hardwareClass) && n.asicForbidden === true && isFullDate(n.purchasedAt)
    && isFullDate(n.expectedRetireAt) && n.purchasedAt <= n.expectedRetireAt && REUSE.includes(n.reusePolicy);
}

// ---- C-SFC-6 ------------------------------------------------------------------------------

/** The closed `mechanism` list of 7.6; the vector generator imports it, so the vectors and the checker cannot drift apart. */
export const MECHANISMS = ["proof-of-work", "proof-of-stake", "proof-of-authority", "dag", "hybrid", "bft", "crash-fault-tolerant"];
/** The `mechanism` comparison of 7.6: ASCII lower case, trimmed, each run of spaces, underscores and hyphens one hyphen, `pow` is `proof-of-work`. */
export function normaliseMechanism(s) {
  if (typeof s !== "string") return null;
  const t = asciiLower(s).replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "").replace(/[ _-]+/g, "-");
  return t === "pow" ? "proof-of-work" : t;
}
const UNIT_KWH = { Wh: -3, kWh: 0, MWh: 3, GWh: 6 };

/** Test 1 of C-SFC-6, not proof-of-work: { result, detail, info } from the platform statement and `consensus-mechanism`. */
function notProofOfWork(platform, consensusMechanism) {
  const mechanism = normaliseMechanism(platform?.mechanism);
  const consensus = normaliseMechanism(consensusMechanism);
  if (mechanism === "proof-of-work" || consensus === "proof-of-work") return { result: FAIL, detail: "proof-of-work" };
  if (!MECHANISMS.includes(mechanism)) return { result: NE, detail: "mechanism not named or outside the list" };
  const differs = consensus !== null && consensus !== mechanism && !MECHANISMS.includes(consensus);
  return { result: PASS, info: differs ? "consensus-mechanism text differs" : undefined };
}

/** C-SFC-6: the worst of test 1 and test 2 (the named case), FAIL then NOT-EVALUABLE then PASS. */
export function csfc6(ctx, ti, f, consensusMechanism, c2row) {
  const platform = ctx.params.platform;
  const scope = "platform";
  const t1 = notProofOfWork(platform, consensusMechanism);
  const t2 = platformCase(ctx, ti, f, platform, c2row);
  const detail = [t1.result !== PASS ? `test 1: ${t1.detail}` : null, t2.result !== PASS ? `test 2: ${t2.detail}` : null].filter(Boolean).join("; ");
  const rows = [row("C-SFC-6", worst(t1.result, t2.result), detail || undefined, scope)];
  if (t1.info) rows.push(row("C-SFC-6.info", INFO, t1.info, scope));
  return rows;
}

/** True when C-SFC-6 test 2 takes the result of C-SFC-2: a permissioned platform with every window month covered by an operator. */
export const c6FollowsLedger = (ctx, f) => ctx.params.platform?.access === "permissioned" && f.uncovered.length === 0 && f.opMonths.length > 0;

function platformCase(ctx, ti, f, platform, c2row) {
  if (!isObject(platform) || (platform.access !== "public" && platform.access !== "permissioned")) return { result: NE, detail: "no statement names the case" };
  if (platform.access === "public") return publicCase(ti, platform.assessment);
  if (c6FollowsLedger(ctx, f)) return { result: c2row.result, detail: `C-SFC-2 ${c2row.result}` };
  const { n, o } = platform, p = platform["p-watts"];
  const missing = [["n", n], ["p-watts", p], ["o", o]].filter(([, v]) => typeof v !== "number" || !Number.isFinite(v) || v <= 0).map(([k]) => k);
  if (o !== undefined && typeof o === "number" && o < 1) missing.push("o");
  if (missing.length) return { result: NE, detail: `missing or malformed: ${list(missing)}` };
  const kwh = nodeBound(n, p, o);
  return cmp(kwh, CAP_KWH) < 0 ? { result: PASS } : { result: FAIL, detail: "node bound at or above CAP" };
}
/** N x P x O x 8 784 h / 1 000, exact. */
export function nodeBound(n, p, o) {
  const x = [n, p, o].map((v) => fromNumber(v));
  let acc = x[0];
  for (const y of x.slice(1)) acc = { n: acc.n * y.n, s: acc.s + y.s };
  acc = { n: acc.n * 8784n, s: acc.s + 3 };
  return acc;
}
const isUtcInstant = (v) => typeof v === "string" && /Z$/.test(v) && isInstant(v);
const isNonNegativeNumber = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** The members of a public assessment that are missing or malformed, in report order. */
function badAssessmentMembers(a) {
  const p = a.period;
  const bad = [];
  if (!(isObject(p) && isUtcInstant(p.start) && isUtcInstant(p.end))) bad.push("period");
  if (!isNonNegativeNumber(a.figure)) bad.push("figure");
  if (!Object.hasOwn(UNIT_KWH, a.unit)) bad.push("unit");
  return bad;
}

function publicCase(ti, a) {
  if (!isObject(a)) return { result: NE, detail: "assessment missing" };
  const bad = badAssessmentMembers(a);
  if (bad.length) return { result: NE, detail: `missing or malformed: ${bad.join(", ")}` };
  const p = a.period;
  // instants compare as the moments they denote (3.2): a fraction or a trailing zero does not break the equality
  if (cmpInstant(addCalendarMonths(p.start, 12), p.end) !== 0) return { result: FAIL, detail: "period is not 12 calendar months" };
  if (before(addCalendarMonths(p.end, 18), ti.T)) return { result: FAIL, detail: "assessment ended more than 18 months before T" };
  const sh = UNIT_KWH[a.unit];
  const kwh = sh >= 0 ? mulInt(fromNumber(a.figure), 10 ** sh) : shift(fromNumber(a.figure), -sh);
  return cmp(kwh, CAP_KWH) < 0 ? { result: PASS } : { result: FAIL, detail: "figure at or above CAP" };
}

/** All window rows in report order; C-SFC-4 over the window only when `withC4` (no declaration). */
export function windowRows(ctx, ti, consensus, withC4) {
  const f = windowFacts(ctx, ti);
  const c1 = csfc1(ctx, ti, f), c2 = csfc2Ledger(ctx, ti, f);
  const b = blocked(ctx, ti, f);
  const rows = [c1, c2, csfc3(ctx, ti, f)];
  if (withC4) rows.push(...csfc4(ctx, f.w, ti.anchor, WINDOW_LABEL(f.w), b));
  rows.push(...csfc6(ctx, ti, f, consensus, c2));
  return { rows, f, c1, c2 };
}
export { windowFacts, blocked, WINDOW_LABEL };
