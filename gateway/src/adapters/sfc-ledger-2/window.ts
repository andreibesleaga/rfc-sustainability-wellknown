/**
 * Window checks: C-SFC-1, C-SFC-2 (ledger form), C-SFC-3, C-SFC-4 and C-SFC-6
 * (3.2 window and cut-off, 4.4 platform rule, 9.2). Spec:
 * https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 */
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../sfc-ledger-profile";
import { activeIn, type Entry } from "./registry";
import { coverageHolds, decOf, eKey, replay, type Ctx, type ReplayState } from "./ledger";
import { ENERGY_SHIFT, shiftOf } from "./derive";
import {
  add, addCalendarMonths, asciiLower, before, cmp, cmpInstant, dec, dueOf, epochOf, fromNumber, fromUnit, isFullDate, isInstant, isObject, list, NE, DECLARED, FAIL, INFO, NOT_DECLARED, PASS, row, windowOf, worst, ZERO,
  type Dec, type Json, type Row,
} from "./primitives";

export const CAP_KWH: Dec = dec(PROFILE.capKwh);
export const WINDOW_LABEL = (w: string[]): string => `${w[0].slice(0, 7)}..${w[w.length - 1].slice(0, 7)}`;

/** The times of a run (3.2 "check instant T"): the explicit T, the checker's clock, and the anchor of window and cut-off. */
export interface TimeInfo {
  explicit: string | null;
  clock: string | null;
  T: string;
  anchor: string;
  stale: boolean;
  readOlderThanT: boolean;
  tSource: string;
}

export function timeInfo(ctx: Ctx): TimeInfo {
  const explicit = ctx.sc.T ?? null;
  const clock = ctx.sc.now ?? null;
  const T = explicit ?? clock ?? ctx.readAt;
  const anchor = explicit ?? ctx.readAt;
  let stale = false;
  if (!explicit && clock) {
    stale = epochOf(clock) - epochOf(ctx.readAt) > ctx.limits.maxReadAgeSeconds * 1000 || epochOf(ctx.readAt) > epochOf(clock) + ctx.limits.skewSeconds * 1000;
  }
  return { explicit, clock, T, anchor, stale, readOlderThanT: explicit !== null && before(ctx.readAt, explicit), tSource: explicit ? "explicit" : clock ? "checker clock" : "read-at" };
}

export interface OpMonth {
  en: Entry;
  m: string;
}
export interface WindowFacts {
  w: string[];
  st: ReplayState;
  opMonths: OpMonth[];
  uncovered: string[];
}

/** Active operator-months of a set of months, and the months with no active operator. */
export function operatorMonths(ctx: Ctx, months: string[]): { opMonths: OpMonth[]; uncovered: string[] } {
  const opMonths: OpMonth[] = [];
  const uncovered: string[] = [];
  for (const m of months) {
    const act = ctx.registry.filter((en) => activeIn(en, m));
    if (!act.length) uncovered.push(m);
    for (const en of act) opMonths.push({ en, m });
  }
  return { opMonths, uncovered };
}

export function windowFacts(ctx: Ctx, ti: TimeInfo): WindowFacts {
  const w = windowOf(ti.anchor);
  return { w, st: replay(ctx, ti.anchor), ...operatorMonths(ctx, w) };
}

/** The reason a window check cannot run, or null (9.2). */
export function blocked(ti: TimeInfo, f: WindowFacts): string | null {
  if (ti.stale) return "stale read";
  if (ti.readOlderThanT) return "read older than T";
  if (!f.opMonths.length) return "no operator active in the window";
  return null;
}

const effective = (f: WindowFacts, en: Entry, type: string, m: string) => f.st.E.get(eKey(en.operator, type, m));

export function csfc1(ti: TimeInfo, f: WindowFacts): Row {
  const scope = WINDOW_LABEL(f.w);
  const b = blocked(ti, f);
  if (b) return row("C-SFC-1", NE, b, scope);
  const silent = f.opMonths.filter(({ en, m }) => !effective(f, en, PROFILE.eventTypes.energy, m)).map(({ en, m }) => `${en.operator} ${m.slice(0, 7)}`);
  if (silent.length) return row("C-SFC-1", FAIL, `silent: ${list(silent)}`, scope);
  return row("C-SFC-1", PASS, f.uncovered.length ? "INFO window not fully covered" : undefined, scope);
}

/** A counted effective event whose algorithm the verifier cannot judge (a 1.x event, L5 not evaluable). */
const hasUnjudgedAlg = (f: WindowFacts): boolean =>
  f.opMonths.some(({ en, m }) =>
    [PROFILE.eventTypes.energy, PROFILE.eventTypes.carbon].some((t) => {
      const e = f.st.E.get(eKey(en.operator, t, m));
      return !!e && !!f.st.verdicts.get(e.ev.i)?.ne.includes("L5:alg");
    }),
  );

export function csfc2Ledger(ti: TimeInfo, f: WindowFacts): Row {
  const scope = WINDOW_LABEL(f.w);
  const b = blocked(ti, f);
  if (b) return row("C-SFC-2", NE, b, `ledger ${scope}`);
  let sum = ZERO;
  const silent: string[] = [];
  for (const { en, m } of f.opMonths) {
    const e = effective(f, en, PROFILE.eventTypes.energy, m);
    if (e) sum = add(sum, decOf(e.ev.event.payload.kWhConsumed));
    else silent.push(`${en.operator} ${m.slice(0, 7)}`);
  }
  if (cmp(sum, CAP_KWH) >= 0) return row("C-SFC-2", FAIL, "sum at or above CAP", `ledger ${scope}`);
  if (silent.length || f.uncovered.length) return row("C-SFC-2", NE, silent.length ? `silent: ${list(silent)}` : "window not fully covered", `ledger ${scope}`);
  if (hasUnjudgedAlg(f)) return row("C-SFC-2", NE, "L5 not evaluable for a counted event", `ledger ${scope}`);
  return row("C-SFC-2", PASS, undefined, `ledger ${scope}`);
}

/** C-SFC-4 over a set of months at a cut-off; the verdict row comes first, then INFO rows. */
export function csfc4(ctx: Ctx, months: string[], cutoff: string, scope: string, blockReason: string | null): Row[] {
  const st = replay(ctx, cutoff);
  const { opMonths, uncovered } = operatorMonths(ctx, months);
  if (blockReason) return [row("C-SFC-4", NE, blockReason, scope)];
  if (!opMonths.length) return [row("C-SFC-4", NE, "no operator active in the window", scope)];
  const bad: string[] = [];
  const infos: string[] = [];
  let ne = false;
  for (const { en, m } of opMonths) {
    const e = st.E.get(eKey(en.operator, PROFILE.eventTypes.carbon, m));
    const label = `${en.operator} ${m.slice(0, 7)}`;
    if (!e) {
      bad.push(`silent ${label}`);
      continue;
    }
    const p = e.ev.event.payload;
    if (p.netZero !== true || !coverageHolds(p) || p.netZero !== coverageHolds(p)) bad.push(`not covered ${label}`);
    if (e.ev.kind === "1x") infos.push(`retirement rules L8b to L10 not applied: ${e.hash}`);
    else if (before(dueOf(m), e.ev.commit)) infos.push(`late-filed: ${e.hash} committed ${e.ev.commit}`);
    if (st.verdicts.get(e.ev.i)?.ne.includes("L5:alg")) ne = true;
  }
  const out: Row[] = [];
  if (bad.length) out.push(row("C-SFC-4", FAIL, list(bad), scope));
  else if (ne) out.push(row("C-SFC-4", NE, "L5 not evaluable for a counted event", scope));
  else out.push(row("C-SFC-4", PASS, uncovered.length ? "INFO window not fully covered" : undefined, scope));
  for (const t of [...new Set(infos)].sort()) out.push(row("C-SFC-4.info", INFO, t, scope));
  return out;
}

/** C2 hardware declaration complete (5.1 `nodeProfile`, C-SFC-3). */
export function nodeProfileComplete(n: Json): boolean {
  return (
    isObject(n) &&
    PROFILE.hardwareClasses.includes(n.hardwareClass) &&
    n.asicForbidden === true &&
    isFullDate(n.purchasedAt) &&
    isFullDate(n.expectedRetireAt) &&
    n.purchasedAt <= n.expectedRetireAt &&
    PROFILE.reusePolicies.includes(n.reusePolicy)
  );
}

export function csfc3(ctx: Ctx, f: WindowFacts): Row {
  const scope = WINDOW_LABEL(f.w);
  if (!ctx.registry.length) return row("C-SFC-3", NE, "no Registry", scope);
  const ens = ctx.registry.filter((en) => f.w.some((m) => activeIn(en, m)));
  if (!ens.length) return row("C-SFC-3", NE, "no operator active in the window", scope);
  const bad = ens.filter((en) => !nodeProfileComplete(en.nodeProfile)).map((en) => en.operator);
  return bad.length ? row("C-SFC-3", NOT_DECLARED, list(bad), scope) : row("C-SFC-3", DECLARED, undefined, scope);
}

// ---- C-SFC-6 (4.4, 7.6) --------------------------------------------------------------------

/** The closed list of `platform.mechanism` (7.6), the one list of the port: the vectors test compares it with the reference. */
export const MECHANISMS: readonly string[] = PROFILE.mechanisms;

/** The 7.6 comparison of a mechanism: ASCII lower-casing, trimming, each run of spaces, underscores and hyphens as one hyphen; `pow` is proof-of-work. */
export function normaliseMechanism(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = asciiLower(s).replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "").replace(/[ _-]+/g, "-");
  return t === "pow" ? "proof-of-work" : t;
}

/** N x P x O x 8 784 h / 1 000, exact (4.4 rule 3). */
export function nodeBound(n: number, p: number, o: number): Dec {
  const x = [n, p, o].map((v) => fromNumber(v));
  let acc = x[0];
  for (const y of x.slice(1)) acc = { n: acc.n * y.n, s: acc.s + y.s };
  return { n: acc.n * 8784n, s: acc.s + 3 };
}

interface CaseResult {
  result: string;
  detail?: string;
}

function publicCase(ti: TimeInfo, a: Json): CaseResult {
  if (!isObject(a)) return { result: NE, detail: "assessment missing" };
  const bad: string[] = [];
  const p = a.period;
  const okP = isObject(p) && typeof p.start === "string" && typeof p.end === "string" && /Z$/.test(p.start) && /Z$/.test(p.end) && isInstant(p.start) && isInstant(p.end);
  if (!okP) bad.push("period");
  if (typeof a.figure !== "number" || !Number.isFinite(a.figure) || a.figure < 0) bad.push("figure");
  // own names of the unit table only: a unit named `constructor` is an unknown unit, not a function
  const sh = shiftOf(ENERGY_SHIFT, a.unit);
  if (sh === undefined) bad.push("unit");
  if (bad.length || sh === undefined) return { result: NE, detail: `missing or malformed: ${bad.join(", ")}` };
  // instants compare as the moments they denote (3.2), fractions included
  if (cmpInstant(addCalendarMonths(p.start, 12), p.end) !== 0) return { result: FAIL, detail: "period is not 12 calendar months" };
  if (before(addCalendarMonths(p.end, 18), ti.T)) return { result: FAIL, detail: "assessment ended more than 18 months before T" };
  const kwh = fromUnit(fromNumber(a.figure), sh);
  return cmp(kwh, CAP_KWH) < 0 ? { result: PASS } : { result: FAIL, detail: "figure at or above CAP" };
}

/** Every operator month of the window is attested, so the permissioned case takes the result of C-SFC-2. */
const ledgerCovers = (f: WindowFacts): boolean => f.uncovered.length === 0 && f.opMonths.length > 0;

/** C-SFC-6 test 2 takes the result of C-SFC-2: the permissioned case with every operator month attested (9.4 D2 reads this). */
export const c6FollowsLedger = (ctx: Ctx, f: WindowFacts): boolean => ctx.params.platform?.access === "permissioned" && ledgerCovers(f);

function permissionedCase(f: WindowFacts, platform: Json, c2row: Row): CaseResult {
  if (ledgerCovers(f)) return { result: c2row.result, detail: `C-SFC-2 ${c2row.result}` };
  const { n, o } = platform;
  const p = platform["p-watts"];
  const missing = ([["n", n], ["p-watts", p], ["o", o]] as [string, Json][]).filter(([, v]) => typeof v !== "number" || !Number.isFinite(v) || v <= 0).map(([k]) => k);
  if (typeof o === "number" && o < 1) missing.push("o");
  if (missing.length) return { result: NE, detail: `missing or malformed: ${list(missing)}` };
  return cmp(nodeBound(n, p, o), CAP_KWH) < 0 ? { result: PASS } : { result: FAIL, detail: "node bound at or above CAP" };
}

function platformCase(ti: TimeInfo, f: WindowFacts, platform: Json, c2row: Row): CaseResult {
  if (!isObject(platform) || (platform.access !== "public" && platform.access !== "permissioned")) return { result: NE, detail: "no statement names the case" };
  return platform.access === "public" ? publicCase(ti, platform.assessment) : permissionedCase(f, platform, c2row);
}

/** C-SFC-6: the worst of the not-proof-of-work test and the one case that applies (4.4). */
export function csfc6(ctx: Ctx, ti: TimeInfo, f: WindowFacts, consensusMechanism: unknown, c2row: Row): Row[] {
  const platform = ctx.params.platform;
  const scope = "platform";
  const mech = normaliseMechanism(platform?.mechanism);
  const cons = normaliseMechanism(consensusMechanism);
  const infos: string[] = [];
  let t1: string;
  if (mech === "proof-of-work" || cons === "proof-of-work") t1 = FAIL;
  else if (mech === null || !MECHANISMS.includes(mech)) t1 = NE;
  else {
    t1 = PASS;
    if (cons !== null && cons !== mech && !MECHANISMS.includes(cons)) infos.push("consensus-mechanism text differs");
  }
  const t1Detail = t1 === NE ? "mechanism not named or outside the list" : t1 === FAIL ? "proof-of-work" : undefined;
  const t2 = platformCase(ti, f, platform, c2row);
  const result = worst(t1, t2.result);
  const detail = [t1 !== PASS ? `test 1: ${t1Detail}` : null, t2.result !== PASS ? `test 2: ${t2.detail}` : null].filter(Boolean).join("; ");
  return [row("C-SFC-6", result, detail || undefined, scope), ...infos.map((i) => row("C-SFC-6.info", INFO, i, scope))];
}

/** All window rows in report order; C-SFC-4 over the window only when `withC4` (no declaration). */
export function windowRows(ctx: Ctx, ti: TimeInfo, consensus: unknown, withC4: boolean): { rows: Row[]; f: WindowFacts; c1: Row; c2: Row } {
  const f = windowFacts(ctx, ti);
  const c1 = csfc1(ti, f);
  const c2 = csfc2Ledger(ti, f);
  const rows = [c1, c2, csfc3(ctx, f)];
  if (withC4) rows.push(...csfc4(ctx, f.w, ti.anchor, WINDOW_LABEL(f.w), blocked(ti, f)));
  rows.push(...csfc6(ctx, ti, f, consensus, c2));
  return { rows, f, c1, c2 };
}
