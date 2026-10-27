/**
 * The deep check (9.4): D1 to D9 and C-SFC-7, with the window checks of D5.
 * Input: a declaration with `ledger-evidence-2` and a ledger read (5.7). A
 * later correction is reported as INFO "superseded since publication" (D7),
 * never FAIL. Spec:
 * https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 */
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../sfc-ledger-profile";
import * as ed from "./ed25519";
import { activeIn, intervalsOrdered, keysValidAt, pubOf, type Entry, type NormKey } from "./registry";
import { entryShape, METHODS } from "./shape";
import {
  decOf, eKey, methodologyPinned, monthOfEvent, registrarKeys, replay, sigInfo, verifyUnder, voidInfos,
  type Ctx, type LedgerEv, type PinnedKey, type RegistrarKey, type ReplayState,
} from "./ledger";
import { s3 } from "./signed";
import { CARBON_SHIFT, derive, ENERGY_SHIFT, headAndCountTokens, locationFigures, scope2Basis, shiftOf, type Derivation, type PeriodBounds } from "./derive";
import { c6FollowsLedger, csfc4, CAP_KWH, windowFacts, windowRows, type TimeInfo, type WindowFacts } from "./window";
import { extOf, labelOf, levelOf, samePeriodTarget, usablePeriod } from "./decl";
import { CheckLimit } from "./deadline";
import { scanLimits, stopsDeepCheck, type LimitHit } from "./limits";
import {
  add, addMonths, asciiLower, atOrBefore, before, canonicalize, cmp, cmpInstant, toUnit, divRound, dueOf, eq, FAIL, fromNumber, hashOf, INFO, instantKey, isInstant, isObject, isZero, list,
  monthsBetween, mulInt, NE, PASS, roundHalfEven, row, sameHost, shift, textHash, ZERO, type Dec, type Json, type Row,
} from "./primitives";

/**
 * Run one stage of the deep check. A stage that throws becomes one ERROR row with fixed words (the exception text
 * is never echoed: it may carry hostile input) and the rows of the other stages stay, so a hostile read cannot turn
 * a FAIL found by another stage into a bare error. The time limit is not swallowed here: `safely` in check.ts turns
 * it into a NOT-EVALUABLE row naming the limit.
 */
export function stageRows(stage: string, fn: () => Row[]): Row[] {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CheckLimit) throw e;
    return [row("ERROR", NE, `${stage} stopped`)];
  }
}

const typeShort = (t: string): string => (t === PROFILE.eventTypes.energy ? "Energy" : "Carbon");
const evScope = (ev: LedgerEv): string => `${ev.event?.subject} ${typeShort(ev.event?.type)} ${ev.commit}`;
const chainKeyOf = (ev: LedgerEv): string => `${ev.event?.subject}|${ev.event?.type}`;

const D3_TOKENS = ["L1", "L2", "L3", "L5", "encoding", "weak"];
const D5_TOKENS = ["L4", "L6", "L7", "L8", "L8b", "L9", "L10", "L11", "L11b", "L12"];

/** Everything one deep run reads besides the context. */
interface Run {
  ctx: Ctx;
  ti: TimeInfo;
  decl: Json | null;
  siblings: Json[] | undefined;
  hits: LimitHit[];
  limitNames: string;
}

/** Run the deep check for one declaration object, or for the read alone when `decl` is null. Returns rows. */
export function deepCheck(ctx: Ctx, ti: TimeInfo, decl: Json | null, siblings?: Json[]): Row[] {
  const hits = scanLimits(ctx.ex, ctx.limits, ctx.sc.excerptMaxLiteral, ctx.params);
  const run: Run = { ctx, ti, decl, siblings, hits, limitNames: list(hits.map((h) => h.limit)) };
  const label = decl ? labelOf(decl) : "read";
  const updated: string | null = decl?.updated ?? null;
  const d1 = d1Row(run, updated);
  const rows: Row[] = [row("D1", d1[0], d1[1], label)];
  const stop = ctx.ex["excerpt-version"] !== PROFILE.excerptVersion || stopsDeepCheck(hits) || (decl && (!isInstant(updated) || before(ctx.readAt, updated as string) || ti.stale));
  if (stop) {
    if (decl) rows.push(row("C-SFC-7", NE, d1[1], label));
    return rows;
  }
  rows.push(...stageRows("deep check", () => bodyRows(run, updated, label)));
  return rows;
}

/** The excerpt version as D1 names it: a number as it is, a short string quoted, anything else by kind. */
function versionText(v: unknown): string {
  if (v === undefined) return "absent";
  if (typeof v === "number") return String(v);
  return typeof v === "string" && v.length <= 16 ? JSON.stringify(v) : `of type ${Array.isArray(v) ? "array" : typeof v}`;
}

function d1Row(run: Run, updated: string | null): [string, string | undefined] {
  const { ctx, ti, decl, hits, limitNames } = run;
  if (ctx.ex["excerpt-version"] !== PROFILE.excerptVersion) return [NE, `excerpt version ${versionText(ctx.ex["excerpt-version"])}`];
  if (hits.length) return [NE, `limit: ${limitNames}`];
  if (decl && !isInstant(updated)) return [NE, "updated is not an instant"];
  if (decl && before(ctx.readAt, updated as string)) return [NE, "read-at before updated"];
  if (decl && ti.stale) return [NE, "stale read"];
  return [PASS, undefined];
}

/** Rows D2 to D8 and C-SFC-7 once D1 allows the read to be used; each stage runs on its own (`stageRows`), so one that stops leaves the others' rows in place. */
function bodyRows(run: Run, updated: string | null, label: string): Row[] {
  const { ctx, ti, decl, siblings, hits } = run;
  const e2 = decl ? extOf(decl, "ledger-evidence-2") : undefined;
  const level = decl ? levelOf(decl) : null;
  const cutoff = updated ?? ti.anchor;
  const st = replay(ctx, cutoff);
  const period: PeriodBounds | null = usablePeriod(decl);
  const profileNotRead = !!e2 && !(PROFILE.versionPattern.test(String(e2["profile-version"])) && PROFILE.versionPattern.test(String(ctx.ex["profile-version"])));
  const rows: Row[] = [];
  const stage = (name: string, fn: () => Row[]): void => {
    rows.push(...stageRows(name, fn));
  };
  stage("D2", () => [ledgerOrder(ctx), ...d2(ctx, period ? decl : null, level, e2, label)]);
  if (decl) stage("D2 signed", () => registrySignedRows(ctx, decl, level, siblings, rows, label));
  stage("D3", () => d3(ctx, st, cutoff, hits));
  stage("D4", () => d4(ctx, cutoff, decl, level, label));
  stage("D5", () => d5(ctx, st, cutoff, hits));
  stage("window checks", () => windowAndPeriodRows(run, period, label));
  if (decl) stage("D7", () => d7(ctx, ti, decl, period, label));
  rows.push(row("D8", NE, "not performed", label));
  if (decl && period && e2 && !profileNotRead) stage("D6", () => noEmissionsInfo(ctx, decl, period, level as string, label));
  if (decl) stage("C-SFC-7", () => [c7(run, level as string, e2, period, rows, profileNotRead, label)]);
  return markUnauthenticated(rows, ctx, ti);
}

/** C-SFC-4 over the declaration's period, and the window rows C-SFC-1, 2, 3, 6. */
function windowAndPeriodRows(run: Run, period: PeriodBounds | null, label: string): Row[] {
  const { ctx, ti, decl, siblings, hits, limitNames } = run;
  const consensus = extOf(decl ?? {}, "network-topology")?.["consensus-mechanism"] ?? (siblings ? findConsensus(siblings) : undefined);
  const w = windowRows(ctx, ti, consensus, !decl);
  const rows: Row[] = [];
  if (decl) {
    const block = hits.length ? `limit: ${limitNames}` : null;
    const scope = period ? `period ${period.start.slice(0, 7)}..${addMonths(period.end, -1).slice(0, 7)}` : null;
    rows.push(...(period ? csfc4(ctx, monthsBetween(period.start, period.end), decl.updated, scope as string, block) : [row("C-SFC-4", NE, "period not one month or one calendar year", label)]));
  }
  rows.push(...(hits.length ? limitWindow(w.rows, limitNames) : w.rows));
  return rows;
}

/** D6: a net-zero status of `achieved` with nothing to cover is noted. */
function noEmissionsInfo(ctx: Ctx, decl: Json, period: PeriodBounds, level: string, label: string): Row[] {
  const d = deriveFor(ctx, decl.updated, period, decl, level);
  return d.status === "achieved" && !d.incompleteCarbon && isZero(d.footprint) && isZero(d.Off) ? [row("D6.info", INFO, "no emissions to cover", label)] : [];
}

const UNAUTHENTICATED = "consistent but not authenticated";

/**
 * 9.4 D2: with no registrar key pinned the Registry is the source's word, so no row computed from it may read as
 * a PASS. When a D2.entry row is NOT-EVALUABLE, a PASS of C-SFC-1, 2 and 4 becomes NOT-EVALUABLE (these are gate
 * rows, so the overall result follows), and so does a PASS of C-SFC-6 when its test 2 takes the result of C-SFC-2.
 * FAIL and NOT-EVALUABLE rows stay as they are. This runs last, after C-SFC-7 read the rows without it.
 */
function markUnauthenticated(rows: Row[], ctx: Ctx, ti: TimeInfo): Row[] {
  if (!rows.some((r) => r.id === "D2.entry" && r.result === NE)) return rows;
  const fromRegistry = new Set(["C-SFC-1", "C-SFC-2", "C-SFC-4"]);
  if (c6FollowsLedger(ctx, windowFacts(ctx, ti))) fromRegistry.add("C-SFC-6");
  return rows.map((r) => (r.result === PASS && fromRegistry.has(r.id) ? { ...r, result: NE, detail: UNAUTHENTICATED } : r));
}

const findConsensus = (sibs: Json[]): unknown => sibs.map((o) => extOf(o, "network-topology")?.["consensus-mechanism"]).find((x) => typeof x === "string");
const limitWindow = (rows: Row[], names: string): Row[] => rows.map((r) => (["C-SFC-1", "C-SFC-2", "C-SFC-4"].includes(r.id) ? { ...r, result: NE, detail: `limit: ${names}` } : r));

// ---- D2: operator set and Registry ---------------------------------------------------------

function operatorSetRows(ctx: Ctx, decl: Json, level: string | null, e2: Json, label: string, pinned: boolean): Row[] {
  const period = decl.period;
  const months = monthsBetween(period.start, period.end);
  const entries: Json[] = Array.isArray(e2.operators) ? e2.operators : [];
  if (level === "network") {
    const active = ctx.registry.filter((en) => months.some((m) => activeIn(en, m)));
    const a = list(active.map((en) => en.operator));
    const b = list(entries.map((x) => x?.operator));
    const origins = entries.every((x) => asciiLower(ctx.byOperator.get(x?.operator)?.origin) === asciiLower(x?.origin));
    return [
      row("D2.operator-set", a === b && origins ? PASS : FAIL, a === b ? (origins ? undefined : "origin differs") : "operator set differs", label),
      row("D2.network", sameHost(ctx.network, decl.target) ? PASS : FAIL, undefined, label),
    ];
  }
  const member = extOf(decl, "network-topology")?.["member-of-network"];
  const en = ctx.byOperator.get(entries[0]?.operator);
  const okSet = entries.length === 1 && en && sameHost(en.origin, decl.target) && months.some((m) => activeIn(en, m));
  const rows = [row("D2.operator-set", okSet ? PASS : FAIL, undefined, label)];
  if (typeof member !== "string") rows.push(row("D2.network", NE, "member-of-network missing", label));
  else if (!sameHost(ctx.network, member)) rows.push(row("D2.network", FAIL, undefined, label));
  else rows.push(row("D2.network", pinned ? PASS : NE, pinned ? undefined : "claimed, not authenticated", label));
  return rows;
}

function uniquenessRow(ctx: Ctx, label: string): Row {
  const dup: string[] = [];
  const seenOp = new Set<string>();
  const seenOr = new Set<string>();
  for (const en of ctx.registry) {
    if (typeof en.operator !== "string" || typeof en.origin !== "string") continue; // not an entry: the shape check reports it
    if (seenOp.has(en.operator)) dup.push(`operator ${en.operator}`);
    if (seenOr.has(asciiLower(en.origin))) dup.push(`origin ${en.origin}`);
    seenOp.add(en.operator);
    seenOr.add(asciiLower(en.origin));
  }
  const unordered = ctx.registry.filter((en) => typeof en.operator === "string" && !intervalsOrdered(en));
  if (!dup.length && !unordered.length) return row("D2.unique", PASS, undefined, label);
  const failU = dup.length || unordered.some((en) => en.form === "2x");
  return row("D2.unique", failU ? FAIL : INFO, list([...dup, ...unordered.map((en) => `active ${en.operator}`)]), label);
}

function entry1x(ctx: Ctx, en: Entry, scope: string): Row[] {
  const ok = entryAuthenticated(ctx, en);
  return [row("D2.entry", ok ? PASS : NE, ok ? "1.x entry authenticated by digest" : "unsigned Registry entry not authenticated", scope)];
}

function entryAuthenticated(ctx: Ctx, en: Entry): boolean {
  const digest = textHash(canonicalize(en.raw));
  const listed = methodologyPinned(ctx) && (ctx.params["registry-1x-digests"] ?? []).some((x: Json) => x.operator === en.operator && x.sha256 === digest);
  return listed || (ctx.pins.entries1x ?? []).includes(digest);
}

/** The fault of a key (an invalid or weak point), or null; worked out once per key text for the whole read. */
function keyFaultOf(ctx: Ctx, k: NormKey): string | null {
  const id = `keyFault|${k.x}`;
  if (!ctx.cache.has(id)) {
    const pub = pubOf(k);
    const pt = pub ? ed.decodePoint(pub) : null;
    ctx.cache.set(id, !pt ? "key encoding" : ed.isSmallOrder(pt) ? "weak key" : null);
  }
  return ctx.cache.get(id) as string | null;
}

/** Faults of a 2.0 entry that do not depend on the registrar's signature; the clock is tested per key. */
function entryFaults(ctx: Ctx, en: Entry, twoX: Map<string, string[]>): string[] {
  const tokens: string[] = [];
  if (entryShape(en.raw).length) tokens.push("shape");
  if (!sameHost(en.network, ctx.network)) tokens.push("network");
  for (const k of en.keys) {
    ctx.checkDeadline();
    const fault = keyFaultOf(ctx, k);
    if (fault) tokens.push(fault);
  }
  if (en.profile2From && (twoX.get(en.operator) ?? []).some((m) => before(m, en.profile2From as string))) tokens.push("profile2From");
  if (!isObject(en.raw.sig)) tokens.push("sig absent");
  return tokens;
}

function entry2x(ctx: Ctx, en: Entry, keys: RegistrarKey[], pinned: boolean, twoX: Map<string, string[]>, scope: string): Row[] {
  const raw = en.raw;
  const tokens = entryFaults(ctx, en, twoX);
  if (!pinned) return [row("D2.entry", NE, "registrar key not pinned", scope)];
  const v = isObject(raw.sig) ? verifyUnder(keys, raw, ctx.checkDeadline) : ({ ok: false, reason: "absent" } as const);
  if (isObject(raw.sig) && !v.ok) tokens.push(v.reason === "encoding" ? "sig encoding" : "sig");
  const out = [row("D2.entry", tokens.length ? FAIL : PASS, list(tokens), scope)];
  if (v.ok && v.status === "former") out.push(row("D2.entry.info", INFO, "signed under a former key", scope));
  return out;
}

/** 2.0-form event months per operator, for the `profile2From` check. */
function twoXMonths(ctx: Ctx): Map<string, string[]> {
  const twoX = new Map<string, string[]>();
  for (const ev of ctx.events) {
    const m = ev.kind === "2x" ? monthOfEvent(ev) : null;
    if (m) twoX.set(ev.event.subject, [...(twoX.get(ev.event.subject) ?? []), m]);
  }
  return twoX;
}

/** The attested months of each subject, built once per read (d2 runs once per declaration object); the clock is tested once per event, as in the replay. */
function attestedMonths(ctx: Ctx): Map<string, Set<string>> {
  if (!ctx.cache.has("attestedMonths")) {
    const table = new Map<string, Set<string>>();
    for (const e of ctx.events) {
      ctx.checkDeadline();
      const subject = e.event?.subject;
      const month = monthOfEvent(e);
      if (typeof subject !== "string" || month === null) continue;
      if (!table.has(subject)) table.set(subject, new Set());
      (table.get(subject) as Set<string>).add(month);
    }
    ctx.cache.set("attestedMonths", table);
  }
  return ctx.cache.get("attestedMonths") as Map<string, Set<string>>;
}

/** An entry whose `to` lies before a month with an attested event. */
function intervalClosedRows(ctx: Ctx): Row[] {
  const rows: Row[] = [];
  const months = attestedMonths(ctx);
  for (const en of ctx.registry) {
    ctx.checkDeadline();
    const attested = months.get(en.operator) ?? new Set<string>();
    const over = [...attested].filter((m) => !activeIn(en, m) && en.intervals.some((iv) => iv.to !== null && atOrBefore(iv.to, m))).sort();
    if (over.length) rows.push(row("D2.interval", FAIL, `interval closed over attested months: ${over.map((m) => m.slice(0, 7)).join(", ")}`, en.operator));
  }
  return rows;
}

function inactiveMonthRows(ctx: Ctx): Row[] {
  const st = replay(ctx, ctx.readAt);
  const rows: Row[] = [];
  for (const ev of ctx.events) {
    const v = st.verdicts.get(ev.i);
    const entry = ctx.byOperator.get(ev.event?.subject);
    if (v && v.reasons.includes("L1") && v.month && entry && !activeIn(entry, v.month) && ev.event.subject === ev.event.actor && (ev.kind === "1x" || sameHost(ev.event.network, ctx.network))) {
      rows.push(row("D2.inactive-month", INFO, `${ev.event.subject} ${v.month.slice(0, 7)}`, `${typeShort(ev.event.type)} @${ev.commit}`));
    }
  }
  return rows;
}

function voidRows(ctx: Ctx): Row[] {
  const infos = voidInfos(ctx);
  return ctx.voids.flatMap((v, k) => {
    const i = infos[k];
    const scope = `void @${v?.commit ?? "-"}`;
    if (i.ok) return [row("D2.void", PASS, undefined, scope), ...(i.status === "former" ? [row("D2.void.info", INFO, "void signed under a former key", scope)] : [])];
    if (i.unpinned) return [row("D2.void", NE, i.reason, scope)];
    return [row("D2.void", i.fail ? FAIL : INFO, i.fail ? i.reason : `void ignored: ${i.reason}`, scope)];
  });
}

function rollbackRows(ctx: Ctx): Row[] {
  const rows: Row[] = [];
  for (const en of ctx.registry) {
    const prior = ctx.sc.prior?.versions?.[en.operator];
    if (prior !== undefined && en.version !== null) rows.push(row("D2.rollback", en.version < prior ? FAIL : PASS, en.version < prior ? "rollback" : undefined, en.operator));
  }
  return rows;
}

function d2(ctx: Ctx, decl: Json | null, level: string | null, e2: Json | undefined, label: string): Row[] {
  const keys = registrarKeys(ctx);
  const pinned = keys.length > 0;
  const rows: Row[] = [];
  if (decl && e2) rows.push(...operatorSetRows(ctx, decl, level, e2, label, pinned));
  rows.push(uniquenessRow(ctx, label));
  const twoX = twoXMonths(ctx);
  ctx.registry.forEach((en, i) => {
    ctx.checkDeadline();
    const scope = typeof en.operator === "string" ? en.operator : `registry[${i}]`;
    rows.push(...(en.form === "1x" ? entry1x(ctx, en, scope) : entry2x(ctx, en, keys, pinned, twoX, scope)));
  });
  const copy = ctx.ex.registrar?.jwk?.x;
  if (copy !== undefined) rows.push(!pinned ? row("D2.registrar-copy", NE, "only source of the registrar key", label) : row("D2.registrar-copy", keys.some((k) => k.x === copy) ? PASS : FAIL, undefined, label));
  rows.push(...intervalClosedRows(ctx), ...inactiveMonthRows(ctx), ...voidRows(ctx), ...rollbackRows(ctx));
  return rows;
}

// ---- D2.signed: the operator's `signed` under its Registry keys (7.2 rule 2) ----------------

/** The check instant: the explicit T, the checker's clock, else the instant of the read. */
const checkInstant = (ctx: Ctx): string => ctx.sc.T ?? ctx.sc.now ?? ctx.readAt;

/** Is the operator's 2.0-form Registry entry authenticated, per the D2.entry rows already made? */
const entryRowPassed = (rows: Row[], operator: string): boolean => rows.some((r) => r.id === "D2.entry" && r.result === PASS && r.scope === operator);

/** The operator's Registry keys valid at T, as Ed25519 keys for the S3 key step. */
function registryKeys(ctx: Ctx, entry: Entry): PinnedKey[] {
  return keysValidAt(entry, checkInstant(ctx))
    .filter((k) => typeof k.x === "string")
    .map((k) => ({ kty: "OKP", crv: "Ed25519", x: k.x as string }));
}

/**
 * One PASS row when the served `signed` verifies under a Registry key valid at T; no row otherwise (S3 says the
 * rest). Registry keys count only after D2 authenticated the entry under a pinned registrar key. The key is the
 * one whose validity window holds the check instant T, not `updated`, which the publisher wrote. The 7.2 rule 2
 * comparison reads the object as served (`ctx.served`), not the reading with mistyped members absent.
 */
function registrySignedRows(ctx: Ctx, decl: Json, level: string | null, siblings: Json[] | undefined, d2Rows: Row[], label: string): Row[] {
  if (level !== "operator") return [];
  const operators = extOf(decl, "ledger-evidence-2")?.operators;
  const operator: unknown = Array.isArray(operators) ? operators[0]?.operator : undefined;
  const entry = typeof operator === "string" ? ctx.byOperator.get(operator) : undefined;
  const index = siblings?.indexOf(decl) ?? -1;
  const served = index >= 0 ? ctx.served?.[index] : undefined;
  if (!entry || entry.form !== "2x" || !served || typeof served.signed !== "string" || !entryRowPassed(d2Rows, operator as string)) return [];
  const [result] = s3(served, "operator", true, { operatorKeys: registryKeys(ctx, entry) }, ctx.objectIssues?.[index] ?? null);
  return result.result === PASS ? [row("D2.signed", PASS, "verified under a Registry key valid at T", label)] : [];
}

// ---- D3: events ----------------------------------------------------------------------------

/** Events committed at or before the cut-off, per (operator, type) chain, in ledger order. */
function chainsOf(ctx: Ctx, cutoff: string): Map<string, LedgerEv[]> {
  const m = new Map<string, LedgerEv[]>();
  for (const ev of ctx.events) {
    if (!isInstant(ev.commit) || !atOrBefore(ev.commit, cutoff) || !isObject(ev.event) || typeof ev.event.subject !== "string") continue;
    m.set(chainKeyOf(ev), [...(m.get(chainKeyOf(ev)) ?? []), ev]);
  }
  return m;
}
const hitFor = (hits: LimitHit[], ev: LedgerEv): string[] => hits.filter((h) => h.event === ev.i).map((h) => h.limit);

function d3EventRow(ctx: Ctx, st: ReplayState, ev: LedgerEv, hits: LimitHit[]): Row | null {
  ctx.checkDeadline();
  const v = st.verdicts.get(ev.i) as NonNullable<ReturnType<ReplayState["verdicts"]["get"]>>;
  const sig = sigInfo(ctx, ev);
  const tokens: string[] = [];
  const nes: string[] = [];
  const lim = hitFor(hits, ev);
  if (lim.length) nes.push(`limit: ${lim.join(", ")}`);
  if (ev.hash !== ev.computed) tokens.push("hash");
  for (const t of D3_TOKENS) if (v.reasons.includes(t)) tokens.push(t === "weak" ? "weak key" : t);
  if (v.ne.includes("L5:alg")) nes.push(`L5 alg ${sig.algName}`);
  const entry = ctx.byOperator.get(ev.event.subject);
  if (entry && entry.form === "1x" && !entryAuthenticated(ctx, entry) && !tokens.includes("L5")) nes.push("L5 entry not authenticated");
  if (tokens.length) return row("D3.event", FAIL, list(tokens), evScope(ev));
  if (nes.length) return row("D3.event", NE, list(nes), evScope(ev));
  return null;
}

function d3(ctx: Ctx, st: ReplayState, cutoff: string, hits: LimitHit[]): Row[] {
  const rows: Row[] = [];
  for (const [k, evs] of chainsOf(ctx, cutoff)) {
    const [op, type] = k.split("|");
    const evRows = evs.map((ev) => d3EventRow(ctx, st, ev, hits)).filter((r): r is Row => r !== null);
    const result = evRows.some((r) => r.result === FAIL) ? FAIL : evRows.length ? NE : PASS;
    rows.push(row("D3", result, `${evs.length} events`, `${op} ${typeShort(type)}`), ...evRows);
  }
  return rows;
}

function ledgerOrder(ctx: Ctx): Row {
  const bad: string[] = [];
  for (let i = 1; i < ctx.events.length; i++) {
    ctx.checkDeadline();
    const a = ctx.events[i - 1];
    const b = ctx.events[i];
    if (isInstant(a.commit) && isInstant(b.commit) && cmpInstant(a.commit, b.commit) >= 0) bad.push("commit instants do not strictly increase");
  }
  const hashes = ctx.events.map((e) => e.hash);
  if (new Set(hashes).size !== hashes.length) bad.push("hash repeats");
  const commits = new Set(ctx.events.map((e) => instantKey(e.commit)));
  const vc = new Set<string>();
  for (const v of ctx.voids) {
    if (commits.has(instantKey(v.commit)) || vc.has(instantKey(v.commit))) bad.push("void commit not distinct");
    vc.add(instantKey(v.commit));
  }
  return row("D3.order", bad.length ? FAIL : PASS, bad.length ? `ledger order: ${list(bad)}` : undefined, "ledger");
}

// ---- D4: chains, takeover, checkpoint, declared heads --------------------------------------

/** Forks: a shared non-null `prev`, or more than one chain start (null, or a takeover link). */
function forkTokens(evs: LedgerEv[]): string[] {
  const tokens: string[] = [];
  const prevs = new Map<string, number>();
  for (const ev of evs) if (ev.event.prev !== null) prevs.set(ev.event.prev, (prevs.get(ev.event.prev) ?? 0) + 1);
  // the first event starts the chain (with null, or with a takeover link); a later event with prev null is another start
  const starts = evs.filter((ev, i) => i === 0 || ev.event.prev === null);
  if ([...prevs.values()].some((n) => n > 1)) tokens.push("fork: shared prev");
  if (starts.length > 1) tokens.push("fork: more than one chain start");
  return tokens;
}

interface TakeoverFindings {
  tokens: string[];
  infos: string[];
  /** The methodology document lists a takeover but the old ledger was not read. */
  unreachable: boolean;
  /** The first event links to an earlier ledger and no pinned methodology document vouches for it. */
  unverified: boolean;
}

/** Takeover (4.4 rule 5): the first event links to the listed tip, and the old ledger ends at it. */
function takeoverFindings(ctx: Ctx, evs: LedgerEv[], op: string, type: string): TakeoverFindings {
  const found: TakeoverFindings = { tokens: [], infos: [], unreachable: false, unverified: false };
  const take = (ctx.params.takeovers ?? []).find((x: Json) => x.operator === op && x.type === type);
  const first0 = evs[0];
  if (first0 && first0.event.prev !== null) {
    if (!methodologyPinned(ctx)) {
      found.infos.push("takeover not verified (methodology document not pinned)");
      found.unverified = true;
    } else if (!take || take.tip !== first0.event.prev) found.tokens.push("takeover link not listed");
  }
  if (take && methodologyPinned(ctx)) found.unreachable = crossLedger(ctx, op, type, take.tip, found.tokens);
  return found;
}

function chainRow(ctx: Ctx, op: string, type: string, evs: LedgerEv[]): Row[] {
  const take = takeoverFindings(ctx, evs, op, type);
  const tokens = [...forkTokens(evs), ...take.tokens];
  const notEvaluable = take.unreachable || take.unverified;
  const result = tokens.length ? FAIL : notEvaluable ? NE : PASS;
  const causes = [...tokens, ...(take.unreachable ? ["old ledger unreachable"] : []), ...(take.unverified ? ["takeover not verified"] : [])];
  const scope = `${op} ${typeShort(type)}`;
  if (take.unverified) (ctx.unverifiedTakeovers ??= []).push(scope);
  return [row("D4.chain", result, list(causes), scope), ...take.infos.map((i) => row("D4.info", INFO, i, scope))];
}

/** Follow the old ledger's chain back to `prev` null; its read must end at the listed tip (4.4 rule 5). True when it is unreachable. */
function crossLedger(ctx: Ctx, op: string, type: string, tip: string, tokens: string[]): boolean {
  const old = (ctx.sc.oldLedgers ?? []).find((x) => x.operator === op && x.type === type);
  if (!old) return true;
  const hs = old.chain.map((e) => hashOf(e));
  const linked = old.chain.every((e, i) => e.prev === (i === 0 ? null : hs[i - 1]));
  if (!linked || hs[hs.length - 1] !== tip) tokens.push("cross-ledger fork");
  return false;
}

const CHECKPOINT_MEMBERS = ["network", "read-at", "chains", "registry-digest", "ledger-digest", "voids-digest", "sig"];
const DIGEST_MEMBERS = ["registry-digest", "ledger-digest", "voids-digest"];

const isChainCount = (c: Json): boolean => isObject(c) && typeof c.operator === "string" && typeof c.type === "string" && Number.isInteger(c.count) && c.count >= 0 && (c.tip === null || typeof c.tip === "string");

/**
 * Does the checkpoint hold the member types the checks read? Every later step reads `read-at`, `chains` and the
 * digests without a further test, so this is the one place that makes that safe. (The stricter `checkpointShape`
 * of shape.ts serves the bridge reader; a checkpoint that fails it but holds these types is still walked here.)
 */
export function checkpointShapeOk(cp: Json): boolean {
  const chainsOk = cp.chains === undefined || (Array.isArray(cp.chains) && cp.chains.every(isChainCount));
  const digestsOk = DIGEST_MEMBERS.every((m) => cp[m] === undefined || typeof cp[m] === "string");
  return isInstant(cp["read-at"]) && chainsOk && digestsOk;
}

function checkpointChainTokens(ctx: Ctx, cp: Json, tokens: string[]): string[] {
  const st = replay(ctx, ctx.readAt);
  const missing: string[] = [];
  for (const c of cp.chains ?? []) {
    const chain = st.chains.get(`${c.operator}|${c.type}`) ?? [];
    if (chain.length === 0 && c.count > 0) {
      missing.push(`${c.operator} ${typeShort(c.type)}`);
      continue;
    }
    const tip = chain.length ? chain[chain.length - 1].hash : null;
    if (tip !== c.tip || chain.length !== c.count) tokens.push(`chain ${c.operator} ${typeShort(c.type)}`);
  }
  return missing;
}

function checkpointRows(ctx: Ctx): Row[] {
  const cp = ctx.checkpoint;
  if (!cp) return [row("D4.checkpoint", INFO, "absent: ledger read not authenticated: commit instants and completeness are the source's claim", "checkpoint")];
  if (!isObject(cp) || Object.keys(cp).some((k) => !CHECKPOINT_MEMBERS.includes(k))) return [row("D4.checkpoint", FAIL, "mismatch: extra member", "checkpoint")];
  if (!checkpointShapeOk(cp)) return [row("D4.checkpoint", FAIL, "mismatch: shape", "checkpoint")];
  const current = registrarKeys(ctx).filter((k) => k.status === "current");
  if (!current.length) return [row("D4.checkpoint", NE, "registrar key not pinned", "checkpoint")];
  const tokens: string[] = [];
  if (!verifyUnder(current, cp, ctx.checkDeadline).ok) tokens.push("signature");
  if (!sameHost(cp.network, ctx.network) || cmpInstant(cp["read-at"], ctx.readAt) !== 0) tokens.push("network or read-at");
  const missing = checkpointChainTokens(ctx, cp, tokens);
  tokens.push(...digestTokens(ctx, cp));
  const rows = [row("D4.checkpoint", tokens.length ? FAIL : PASS, tokens.length ? `mismatch: ${list(tokens)}` : "verified", "checkpoint")];
  ctx.missingChains = [...new Set(missing)].sort();
  for (const m of ctx.missingChains) rows.push(row("D4.info", INFO, `chain of ${m} not in read`, "checkpoint"));
  if (!tokens.length) rows.push(...unauthenticatedInfoRows(ctx, cp));
  return rows;
}

/** The members of a checkpoint that give a digest of the read, and whether each digest present matches. */
function digestTokens(ctx: Ctx, cp: Json): string[] {
  const sorted = [...(ctx.ex.registry ?? [])].sort((a: Json, b: Json) => (a.operator < b.operator ? -1 : 1));
  const digests: [string, unknown][] = [["registry-digest", sorted], ["ledger-digest", ctx.ex.ledger ?? []], ["voids-digest", ctx.ex.voids ?? []]];
  return digests.filter(([name, part]) => cp[name] !== undefined && cp[name] !== textHash(canonicalize(part))).map(([name]) => name);
}

/** What a verified checkpoint still leaves unauthenticated: commit instants without a ledger digest, void acts without a voids digest. */
function unauthenticatedInfoRows(ctx: Ctx, cp: Json): Row[] {
  const rows: Row[] = [];
  if (cp["ledger-digest"] === undefined) rows.push(row("D4.info", INFO, "commit instants not authenticated: no ledger-digest", "checkpoint"));
  if (cp["voids-digest"] === undefined && (ctx.ex.voids ?? []).length) rows.push(row("D4.info", INFO, "void acts not authenticated", "checkpoint"));
  return rows;
}

/** The declared heads and event counts against the recomputed ones. */
function declaredHeadsRow(ctx: Ctx, cutoff: string, decl: Json, level: string | null, label: string): Row[] {
  const period = usablePeriod(decl);
  if (!period) return [];
  const d = deriveFor(ctx, cutoff, period, decl, level as string);
  const operators = (extOf(decl, "ledger-evidence-2") as Json).operators;
  const bad = headAndCountTokens(Array.isArray(operators) ? operators : [], d);
  return [row("D4.declared", bad.length ? FAIL : PASS, list(bad), label)];
}

function d4(ctx: Ctx, cutoff: string, decl: Json | null, level: string | null, label: string): Row[] {
  const rows: Row[] = [];
  ctx.unverifiedTakeovers = [];
  for (const [k, evs] of chainsOf(ctx, cutoff)) {
    ctx.checkDeadline();
    const [op, type] = k.split("|");
    rows.push(...chainRow(ctx, op, type, evs));
  }
  for (const ev of ctx.events) {
    ctx.checkDeadline();
    if (isInstant(ev.commit) && before(ctx.readAt, ev.commit)) rows.push(row("D4.event", FAIL, "commit after read-at", evScope(ev)));
  }
  rows.push(...checkpointRows(ctx));
  if (decl && decl.updated && extOf(decl, "ledger-evidence-2")) rows.push(...declaredHeadsRow(ctx, cutoff, decl, level, label));
  return rows;
}

/** The derivation for a declaration: for an operator declaration, over its one operator only. */
export function deriveFor(ctx: Ctx, cutoff: string, period: PeriodBounds, decl: Json | null, level: string): Derivation {
  if (level === "operator") {
    const operator = decl && extOf(decl, "ledger-evidence-2")?.operators?.[0]?.operator;
    return derive({ ...ctx, registry: ctx.registry.filter((en) => en.operator === operator) }, cutoff, period);
  }
  return derive(ctx, cutoff, period);
}

// ---- D5: effective attestations, rule and retirements --------------------------------------

/**
 * What leaves the single-use rule L9 unchecked for every chain: a chain the checkpoint lists and the read omits,
 * and a chain whose first event links to an earlier ledger that no pinned methodology document vouches for.
 * L9 reads every operator's events, so either gap makes each chain's D5 NOT-EVALUABLE.
 */
function l9Gaps(ctx: Ctx): string[] {
  const missing = ctx.missingChains ?? [];
  const unverified = ctx.unverifiedTakeovers ?? [];
  return [...(missing.length ? [`chain of ${missing.join(", ")} not in read`] : []), ...(unverified.length ? [`takeover not verified: ${unverified.join(", ")}`] : [])];
}

function d5ChainRows(ctx: Ctx, st: ReplayState, op: string, type: string, evs: LedgerEv[], hits: LimitHit[]): Row[] {
  const evRows: Row[] = [];
  let result = PASS;
  for (const ev of evs) {
    ctx.checkDeadline();
    const v = st.verdicts.get(ev.i) as NonNullable<ReturnType<ReplayState["verdicts"]["get"]>>;
    const tokens = D5_TOKENS.filter((t) => v.reasons.includes(t));
    const nes = v.ne.filter((x) => x !== "L5:alg");
    if (tokens.length) {
      evRows.push(row("D5.event", FAIL, `${list(tokens)}; skipped`, evScope(ev)));
      result = FAIL;
    } else if (nes.length) {
      evRows.push(row("D5.event", NE, list(nes), evScope(ev)));
      if (result !== FAIL) result = NE;
    } else if (v.reasons.length) evRows.push(row("D5.event", INFO, "skipped (see D3)", evScope(ev)));
  }
  let detail = `${evs.length} events`;
  if (hits.length && result === PASS) {
    result = NE;
    detail = `limit: ${list(hits.map((h) => h.limit))}`;
  } else if (l9Gaps(ctx).length && result === PASS) {
    result = NE;
    detail = `L9 not evaluable: ${l9Gaps(ctx).join("; ")}`;
  }
  const rows = [row("D5", result, detail, `${op} ${typeShort(type)}`), ...evRows];
  for (const ev of evs) {
    if (ev.kind !== "1x") continue;
    ctx.checkDeadline();
    rows.push(...notes1x(ctx, st, ev, evs));
  }
  return rows;
}

function d5(ctx: Ctx, st: ReplayState, cutoff: string, hits: LimitHit[]): Row[] {
  const rows: Row[] = [];
  for (const [k, evs] of chainsOf(ctx, cutoff)) {
    const [op, type] = k.split("|");
    rows.push(...d5ChainRows(ctx, st, op, type, evs, hits));
  }
  rows.push(...lateFiled(st));
  return rows;
}

/** D5: each effective attestation committed after the due instant of its month rests on the operator's word for its retirement dates. */
function lateFiled(st: ReplayState): Row[] {
  const late = [...st.E.entries()].filter(([, v]) => before(dueOf(v.month), v.ev.commit)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return late.map(([, v]) => row("D5.late", INFO, "late-filed, retirement dates asserted only", evScope(v.ev)));
}

/** INFO rows for a 1.x event (12.1 rule 1): what is read differently, and why. */
function notes1x(ctx: Ctx, st: ReplayState, ev: LedgerEv, chainEvents: LedgerEv[]): Row[] {
  const v = st.verdicts.get(ev.i) as NonNullable<ReturnType<ReplayState["verdicts"]["get"]>>;
  const p = ev.event.payload ?? {};
  const out: Row[] = [];
  const note = (t: string): void => {
    out.push(row("D5.1x", INFO, t, evScope(ev)));
  };
  if (v.month === null) note("profile 1.x event, period not a month");
  if (ev.event.type === PROFILE.eventTypes.energy && !METHODS.includes(p.measurementMethod)) note(`measurementMethod ${p.measurementMethod === undefined ? "absent" : p.measurementMethod} counts as third-party-modeled`);
  if (ev.event.type === PROFILE.eventTypes.carbon) {
    const basis = scope2Basis(ctx, ev);
    if (basis === null) note("scope 2 basis undeterminable");
    else if (basis === "location-based") note("scope 2 on the location basis");
    for (const k of ["scope2KgCO2e", "scope3KgCO2e"]) if (typeof p[k] === "number" && p[k] < 0) note(`negative ${k} read as is`);
    note("retirement rules L8b to L10 not applied");
  }
  if (v.month !== null) {
    const sameMonth1x = chainEvents.filter((o) => o.kind === "1x" && st.verdicts.get(o.i)?.month === v.month);
    if (sameMonth1x.length > 20 && sameMonth1x[0] === ev) note(`more than 20 1.x events in month ${v.month.slice(0, 7)}`);
  }
  return out;
}

// ---- D7: later corrections -----------------------------------------------------------------

function c2At(ctx: Ctx, f: WindowFacts, cut: string): string {
  const st = replay(ctx, cut);
  let sum = ZERO;
  let silent = false;
  for (const { en, m } of f.opMonths) {
    const e = st.E.get(eKey(en.operator, PROFILE.eventTypes.energy, m));
    if (e) sum = add(sum, decOf(e.ev.event.payload.kWhConsumed));
    else silent = true;
  }
  if (!f.opMonths.length) return NE;
  if (cmp(sum, CAP_KWH) >= 0) return FAIL;
  return silent || f.uncovered.length ? NE : PASS;
}

function d7(ctx: Ctx, ti: TimeInfo, decl: Json, period: PeriodBounds | null, label: string): Row[] {
  if (!period) return [];
  const months = monthsBetween(period.start, period.end);
  const later = replay(ctx, ctx.readAt);
  const inPeriodMonth = (m: string | null): boolean => m !== null && months.includes(m);
  const rows: Row[] = [];
  for (const ev of ctx.events) {
    if (!isInstant(ev.commit) || !before(decl.updated, ev.commit) || !atOrBefore(ev.commit, ctx.readAt)) continue;
    const v = later.verdicts.get(ev.i);
    if (!v || v.skipped || v.month === null || !inPeriodMonth(v.month)) continue;
    rows.push(row("D7", INFO, "superseded since publication", evScope(ev))); // a correction, or an event that fills a silent month
  }
  const infos = voidInfos(ctx);
  ctx.voids.forEach((v, k) => {
    if (!infos[k].ok || !before(decl.updated, v.commit) || !atOrBefore(v.commit, ctx.readAt)) return;
    const t = infos[k].target as LedgerEv;
    if (inPeriodMonth(monthOfEvent(t)) && before(t.commit, decl.updated)) rows.push(row("D7", INFO, "superseded since publication", `void @${v.commit}`));
  });
  const c4u = csfc4(ctx, months, decl.updated, "period", null)[0].result;
  const c4r = csfc4(ctx, months, ctx.readAt, "period", null)[0].result;
  rows.push(row("D7.C-SFC-4", INFO, `as of updated: ${c4u}; as of read-at: ${c4r}`, label));
  const f = windowFacts(ctx, ti);
  rows.push(row("D7.C-SFC-2", INFO, `as of updated: ${c2At(ctx, f, decl.updated)}; as of read-at: ${c2At(ctx, f, ctx.readAt)}`, label));
  return rows;
}

// ---- C-SFC-7: bridge consistency -----------------------------------------------------------

const FAIL_PREFIXES = ["D2", "D3", "D4", "D5"];

/** Why C-SFC-7 cannot be evaluated before any figure is compared (9.3). */
function c7BlockedReasons(run: Run, level: string, period: PeriodBounds | null, rows: Row[], profileNotRead: boolean): string[] {
  const { ctx, decl, hits } = run;
  const l9ne = rows.some((r) => r.id === "D5.event" && r.result === NE && String(r.detail).includes("L8b")) || l9Gaps(ctx).length > 0;
  const unverified = ctx.unverifiedTakeovers ?? [];
  const reasons: [boolean, string][] = [
    [profileNotRead, "profile-version not read"],
    [!period, "period not one month or one calendar year"],
    [level === "operator" && typeof extOf(decl, "network-topology")?.["member-of-network"] !== "string", "member-of-network missing"],
    [hits.length > 0, `limit: ${list(hits.map((h) => h.limit))}`],
    [l9ne, "L9 not evaluable"],
    [unverified.length > 0, `takeover not verified: ${unverified.join(", ")}`],
    [rows.some((r) => r.id === "ERROR"), "a stage stopped"],
  ];
  return reasons.filter(([applies]) => applies).map(([, text]) => text);
}

function c7(run: Run, level: string, e2: Json | undefined, period: PeriodBounds | null, rows: Row[], profileNotRead: boolean, label: string): Row {
  const { ctx, decl, siblings } = run;
  if (!e2) return row("C-SFC-7", NE, "no ledger-evidence-2", label);
  const ne = c7BlockedReasons(run, level, period, rows, profileNotRead);
  const failed = rows.filter((r) => FAIL_PREFIXES.some((p) => r.id === p || r.id.startsWith(`${p}.`)) && r.result === FAIL);
  let tokens: string[] = [];
  if (period && !profileNotRead) {
    const d = deriveFor(ctx, decl?.updated, period, decl, level);
    tokens = compareDeclared(decl, e2, d, level, siblings);
    if (d.has1x) ne.push(`1.x-form event in counted months: ${list(d.events1x)}`);
  }
  const fails = [...failed.map((r) => `${r.id} ${r.scope ?? ""}`.trim()), ...tokens];
  if (fails.length) return row("C-SFC-7", FAIL, list(fails), label);
  if (ne.length) return row("C-SFC-7", NE, list(ne), label);
  const unauth = rows.some((r) => r.id === "D2.entry" && r.result === NE) || rows.some((r) => r.id === "D4.checkpoint" && r.result === NE);
  if (unauth) return row("C-SFC-7", NE, "consistent but not authenticated", label);
  return row("C-SFC-7", PASS, undefined, label);
}

const round6 = (exact: Dec): Dec => roundHalfEven(exact, PROFILE.publishedPlaces);
const eqPub = (declared: unknown, exact: Dec): boolean => typeof declared === "number" && Number.isFinite(declared) && eq(fromNumber(declared), round6(exact));

/** The per-operator members of `ledger-evidence-2` against the recomputation: the heads and counts (shared with D4.declared), then the figures. */
function operatorEntryTokens(e2: Json, d: Derivation): string[] {
  const entries: Json[] = Array.isArray(e2.operators) ? e2.operators : [];
  const bad = headAndCountTokens(entries, d);
  for (const o of d.ops) {
    const x = entries.find((y) => y?.operator === o.operator);
    if (!x) continue;
    const m = (name: string, ok: boolean): void => {
      if (!ok) bad.push(`${o.operator}:${name}`);
    };
    m("kwh", eqPub(x.kwh, o.kwh));
    m("scope1-kgco2e", eqPub(x["scope1-kgco2e"], o.s1));
    m("scope2-kgco2e", eqPub(x["scope2-kgco2e"], o.s2));
    m("scope3-kgco2e", eqPub(x["scope3-kgco2e"], o.s3));
    m("offsets-kgco2e", eqPub(x["offsets-kgco2e"], o.off));
    if (!d.has1x) m("offset-coverage-every-period", x["offset-coverage-every-period"] === o.coverage);
  }
  return bad;
}

/** The top-level figures 7.4 derives against the recomputation. */
function topLevelTokens(obj: Json, d: Derivation, level: string): string[] {
  const bad: string[] = [];
  const es = shiftOf(ENERGY_SHIFT, obj["energy-unit"]);
  const cs = shiftOf(CARBON_SHIFT, obj["carbon-unit"]);
  const tn = extOf(obj, "carbon-neutrality") ?? {};
  if (obj["energy-consumption"] !== undefined && (es === undefined || d.incompleteEnergy || !eqPub(obj["energy-consumption"], toUnit(d.E, es)))) bad.push("top:energy-consumption");
  const carbonMembers: [string, Dec][] = [["scope-1", d.S1], ["scope-2", d.S2], ["scope-3", d.S3], ["carbon-footprint", d.footprint]];
  for (const [name, exact] of carbonMembers) if (obj[name] !== undefined && (cs === undefined || d.incompleteCarbon || !eqPub(obj[name], toUnit(exact, cs)))) bad.push(`top:${name}`);
  if (tn["offsets-retired-tCO2e"] !== undefined && (d.incompleteCarbon || !eqPub(tn["offsets-retired-tCO2e"], shift(d.Off, 3)))) bad.push("top:offsets-retired-tCO2e");
  return [...bad, ...intensityToken(obj, d), ...statusAndCountTokens(obj, d, level)];
}

/** The carbon intensity member against 1000 x Scope 2 / energy (7.4). */
function intensityToken(obj: Json, d: Derivation): string[] {
  const ci = obj["carbon-intensity-gCO2e-per-kWh"];
  if (ci === undefined) return [];
  const incomplete = d.incompleteEnergy || d.incompleteCarbon || isZero(d.E);
  return incomplete || !eq(fromNumber(ci), divRound(mulInt(d.S2, 1000), d.E, 6)) ? ["top:carbon-intensity-gCO2e-per-kWh"] : [];
}

/** The net-zero status and the validated node count against the recomputation. */
function statusAndCountTokens(obj: Json, d: Derivation, level: string): string[] {
  const tn = extOf(obj, "carbon-neutrality") ?? {};
  const topo = extOf(obj, "network-topology") ?? {};
  const bad: string[] = [];
  if (tn["net-zero-status"] !== undefined && !d.has1x && tn["net-zero-status"] !== d.status) bad.push("top:net-zero-status");
  if (level === "network" && topo["validated-node-count"] !== undefined && (d.incompleteEnergy || topo["validated-node-count"] !== d.nodes)) bad.push("top:validated-node-count");
  return bad;
}

/** The paired location object (7.3) against the recomputation. */
function pairedTokens(obj: Json, d: Derivation, siblings: Json[] | undefined): string[] {
  const carbonOmitted = ["scope-2", "scope-3", "carbon-footprint"].every((k) => obj[k] === undefined);
  const paired = carbonOmitted ? undefined : (siblings ?? []).find((o) => o !== obj && samePeriodTarget(o, obj) && o["carbon-accounting"] === "location-based");
  if (!paired) return [];
  const bad: string[] = [];
  const loc = locationFigures(d, { carbonUnit: paired["carbon-unit"] });
  if (!loc) bad.push("paired:not publishable");
  else {
    for (const name of ["scope-2", "carbon-footprint", "carbon-intensity-gCO2e-per-kWh"]) {
      if (paired[name] !== undefined && (!(name in loc) || !eq(fromNumber(paired[name]), fromNumber(loc[name])))) bad.push(`paired:${name}`);
    }
  }
  const pes = shiftOf(ENERGY_SHIFT, paired["energy-unit"]);
  if (paired["energy-consumption"] !== undefined && (pes === undefined || d.incompleteEnergy || !eqPub(paired["energy-consumption"], toUnit(d.E, pes)))) bad.push("paired:energy-consumption");
  return bad;
}

/** Compare every figure a declaration publishes with the recomputed value (D6). Returns mismatch tokens. */
export function compareDeclared(obj: Json, e2: Json, d: Derivation, level: string, siblings?: Json[]): string[] {
  const bad = operatorEntryTokens(e2, d);
  if (level === "network") {
    if (!d.has1x && e2["network-offset-coverage"] !== d.networkCoverage) bad.push("network-offset-coverage");
  } else if ("network-offset-coverage" in e2) bad.push("network-offset-coverage present");
  return [...bad, ...topLevelTokens(obj, d, level), ...pairedTokens(obj, d, siblings)];
}

