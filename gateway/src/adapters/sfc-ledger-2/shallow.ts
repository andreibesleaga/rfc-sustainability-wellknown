/**
 * The shallow check (9.3) on a document that is already in hand: S2 to S6,
 * S4 selection with C-SFC-2 disclosure form, C-SFC-5 and the URI rules of
 * section 10. Spec:
 * https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 */
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../sfc-ledger-profile";
import { CARBON_SHIFT, ENERGY_SHIFT, shiftOf } from "./derive";
import { extOf, labelOf, samePeriodTarget } from "./decl";
import type { Ctx } from "./ledger";
import { CAP_KWH } from "./window";
import {
  add, addCalendarMonths, atOrBefore, before, cmp, DECLARED, isCalendarYear, epochOf, FAIL, figureOk, fromNumber, fromUnit, INFO, isHex64, isHost, isHttpsUri, isInstant, isInt, isMonthBound, isNum,
  isObject, isZero, list, NE, PASS, rat, ratAbs, ratAdd, ratCmp, ratDiv, ratFromDec, ratMul, ratSub, ratText, row, sameTarget, toText, ZERO, type Json, type Rat, type Row,
} from "./primitives";

export const METRICS = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3", "carbon-intensity-gCO2e-per-kWh", "renewable-energy", "sci-score", "estimated-annual-emissions-kgCO2e"];

const digitsAfterPoint = (x: number): number => {
  const t = JSON.stringify(x);
  const i = t.indexOf(".");
  return i < 0 ? 0 : t.length - i - 1;
};

// ---- extension values (S6 a) --------------------------------------------------------------

const isStr = (v: unknown): boolean => typeof v === "string";
const NETWORK_TOPOLOGY_MEMBERS = ["consensus-mechanism", "validated-node-count", "node-count-validation-method", "per-transaction-energy-Wh", "nakamoto-coefficient", "geographic-regions"];
const OPERATOR_TOPOLOGY_MEMBERS = ["member-of-network", "network-declaration"];
/** A `network-topology` value that carries members of both levels (8.4). */
const mixedLevels = (tp: Json): boolean => NETWORK_TOPOLOGY_MEMBERS.some((k) => k in tp) && OPERATOR_TOPOLOGY_MEMBERS.some((k) => k in tp);

function topologyTokens(tp: Json, level: string, hasEvidence: boolean, energyOmitted: boolean): string[] {
  const t: string[] = [];
  if (level === "network") {
    if (!isStr(tp["consensus-mechanism"])) t.push("network-topology.consensus-mechanism");
    if (!energyOmitted) {
      if (!isInt(tp["validated-node-count"])) t.push("network-topology.validated-node-count");
      if (!isStr(tp["node-count-validation-method"])) t.push("network-topology.node-count-validation-method");
    }
  } else if (hasEvidence && !isHost(tp["member-of-network"])) t.push("network-topology.member-of-network");
  return t;
}

/** The S6 a tokens of the extension values: `tokens` FAIL the row; `notes` are INFO (8.4 mixed levels on an object without ledger evidence). */
function extTokens(obj: Json, level: string, hasEvidence: boolean, energyOmitted: boolean): { tokens: string[]; notes: string[] } {
  const t: string[] = [];
  const notes: string[] = [];
  const hw = extOf(obj, "hardware-lifecycle");
  if (hw) {
    if (typeof hw["general-purpose-hardware"] !== "boolean") t.push("hardware-lifecycle.general-purpose-hardware");
    if (typeof hw["single-use-asic-required"] !== "boolean") t.push("hardware-lifecycle.single-use-asic-required");
  }
  const cn = extOf(obj, "carbon-neutrality");
  if (cn && !PROFILE.netZeroStatuses.includes(cn["net-zero-status"])) t.push("carbon-neutrality.net-zero-status");
  const tp = extOf(obj, "network-topology");
  if (tp) {
    if (mixedLevels(tp)) (hasEvidence ? t : notes).push("network-topology.mixed-levels");
    t.push(...topologyTokens(tp, level, hasEvidence, energyOmitted));
  }
  return { tokens: t, notes };
}

const operatorEntryOk = (o: Json): boolean =>
  isObject(o) &&
  typeof o.operator === "string" &&
  isHost(o.origin) &&
  (o["energy-head"] === null || isHex64(o["energy-head"])) &&
  (o["carbon-head"] === null || isHex64(o["carbon-head"])) &&
  isInt(o["energy-events"]) &&
  isInt(o["carbon-events"]) &&
  ["kwh", "scope1-kgco2e", "scope3-kgco2e", "offsets-kgco2e"].every((k) => isNum(o[k], 0)) &&
  typeof o["scope2-kgco2e"] === "number" &&
  typeof o["offset-coverage-every-period"] === "boolean";

function evidenceTokens(ev: Json, level: string): string[] {
  const t: string[] = [];
  if (!PROFILE.versionPattern.test(String(ev["profile-version"]))) t.push("ledger-evidence-2.profile-version");
  if (!isHttpsUri(ev["ledger-access-uri"])) t.push("ledger-evidence-2.ledger-access-uri");
  if (!Array.isArray(ev.operators) || ev.operators.length < 1) t.push("ledger-evidence-2.operators");
  else ev.operators.forEach((o: Json, i: number) => {
    if (!operatorEntryOk(o)) t.push(`ledger-evidence-2.operators[${i}]`);
  });
  if (level === "network" && typeof ev["network-offset-coverage"] !== "boolean") t.push("ledger-evidence-2.network-offset-coverage");
  return t;
}

const carbonGroupOmitted = (obj: Json): boolean => ["scope-2", "scope-3", "carbon-footprint"].every((k) => obj[k] === undefined);

/** Members 7.4 requires of a network declaration (not counting what 7.5 omits). */
export function missing74(obj: Json, ev: Json | undefined): { m: string[]; energyOmitted: boolean; carbonOmitted: boolean } {
  const energyOmitted = obj["energy-consumption"] === undefined;
  const carbonOmitted = carbonGroupOmitted(obj);
  const m: string[] = [];
  // an object without ledger-evidence-2 (the disclosure form) is not held to the ledger-derived members
  if (ev === undefined) return { m, energyOmitted, carbonOmitted };
  const tn = extOf(obj, "carbon-neutrality") ?? {};
  const operators: Json[] = ev?.operators ?? [];
  if (obj["measurement-method"] === undefined) m.push("measurement-method");
  if (!energyOmitted && obj["energy-unit"] === undefined) m.push("energy-unit");
  if (!carbonOmitted) {
    for (const k of ["scope-2", "scope-3", "carbon-footprint", "carbon-unit", "carbon-accounting"]) if (obj[k] === undefined) m.push(k);
    if (tn["offsets-retired-tCO2e"] === undefined) m.push("offsets-retired-tCO2e");
    const s1 = operators.some((o) => isObject(o) && typeof o["scope1-kgco2e"] === "number" && o["scope1-kgco2e"] > 0);
    if (s1 && obj["scope-1"] === undefined) m.push("scope-1");
  }
  if (!energyOmitted && !carbonOmitted && obj["carbon-intensity-gCO2e-per-kWh"] === undefined && !operators.every((o) => isObject(o) && o.kwh === 0)) m.push("carbon-intensity-gCO2e-per-kWh");
  if (extOf(obj, "carbon-neutrality") === undefined) m.push("carbon-neutrality");
  if (extOf(obj, "network-topology") === undefined) m.push("network-topology");
  if (extOf(obj, "ledger-evidence-2") === undefined) m.push("ledger-evidence-2");
  return { m, energyOmitted, carbonOmitted };
}

// ---- tolerance rule (3.3 rule 4) ----------------------------------------------------------

const pow10q = (e: number): Rat => (e >= 0 ? rat(10n ** BigInt(e)) : rat(1n, 10n ** BigInt(-e)));
/** Half a unit in the k-th decimal place. */
const half = (k: number): Rat => rat(1n, 2n * 10n ** BigInt(k));
const val = (x: number): Rat => ratFromDec(fromNumber(x));
/** A figure x written in a unit with shift `from`, expressed in the unit with shift `to`. */
const conv = (x: number, from: number, to: number): Rat => ratMul(val(x), pow10q(from - to));

interface Term {
  x: number;
  k: number;
  shift: number;
  tol: boolean;
}
const term = (x: number, k: number, sh: number, tol = true): Term => ({ x, k, shift: sh, tol });

/** |P - sum Ti| <= 1/2 10^-k(P) + sum 1/2 10^-k(Ti), everything in the unit of P (shift sp). */
export function tolerancePass(P: number, kP: number, sp: number, terms: Term[]): { ok: boolean; diff: Rat; tol: Rat } {
  let sum = rat(0n);
  let tol = half(kP);
  for (const t of terms) {
    sum = ratAdd(sum, conv(t.x, t.shift, sp));
    if (t.tol) tol = ratAdd(tol, ratMul(half(t.k), pow10q(t.shift - sp)));
  }
  const diff = ratAbs(ratSub(val(P), sum));
  return { ok: ratCmp(diff, tol) <= 0, diff, tol };
}

// ---- S6: coherence ------------------------------------------------------------------------

/** The k of a figure: 6 on a ledger-backed object (3.3 rule 4), else the digits after the point. */
const kOfFor = (hasEv: boolean) => (x: number): number => (hasEv ? PROFILE.publishedPlaces : digitsAfterPoint(x));

function aggregateRow(obj: Json, entries: Json[], label: string): Row {
  const es = shiftOf(ENERGY_SHIFT, obj["energy-unit"]);
  const cs = shiftOf(CARBON_SHIFT, obj["carbon-unit"]);
  const kOf = kOfFor(true);
  const bad: string[] = [];
  const energyGroupOmitted = obj["energy-consumption"] === undefined;
  const carbonOmitted = carbonGroupOmitted(obj);
  const mk = (member: string, P: number | undefined, name: string, base: number, sp: number | undefined): void => {
    const sumPositive = entries.some((o) => typeof o[name] === "number" && o[name] > 0);
    const groupOmitted = member === "energy-consumption" ? energyGroupOmitted : carbonOmitted;
    if (P === undefined) {
      if (sumPositive && !groupOmitted) bad.push(`${member} absent`);
      return;
    }
    if (sp === undefined) {
      bad.push(`${member} unit`);
      return;
    }
    if (!tolerancePass(P, kOf(P), sp, entries.map((o) => term(o[name], PROFILE.publishedPlaces, base))).ok) bad.push(member);
  };
  mk("energy-consumption", obj["energy-consumption"], "kwh", 0, es);
  mk("scope-1", obj["scope-1"], "scope1-kgco2e", 0, cs);
  mk("scope-2", obj["scope-2"], "scope2-kgco2e", 0, cs);
  mk("scope-3", obj["scope-3"], "scope3-kgco2e", 0, cs);
  const off = extOf(obj, "carbon-neutrality")?.["offsets-retired-tCO2e"];
  if (off !== undefined && !tolerancePass(off, kOf(off), 3, entries.map((o) => term(o["offsets-kgco2e"], PROFILE.publishedPlaces, 0))).ok) bad.push("offsets-retired-tCO2e");
  return row("S6.b", bad.length ? FAIL : PASS, list(bad), label);
}

function footprintRow(obj: Json, hasEv: boolean, label: string): Row {
  const cs = shiftOf(CARBON_SHIFT, obj["carbon-unit"]);
  const kOf = kOfFor(hasEv);
  if (obj["scope-2"] === undefined || obj["scope-3"] === undefined) return row("S6.c", NE, `${obj["scope-2"] === undefined ? "scope-2" : "scope-3"} absent`, label);
  if (cs === undefined) return row("S6.c", NE, "carbon-unit absent", label);
  const ts = ["scope-1", "scope-2", "scope-3"].filter((k) => obj[k] !== undefined).map((k) => term(obj[k], kOf(obj[k]), cs));
  const r = tolerancePass(obj["carbon-footprint"], kOf(obj["carbon-footprint"]), cs, ts);
  return row("S6.c", r.ok ? PASS : hasEv ? FAIL : INFO, r.ok ? undefined : `${hasEv ? "" : "not derivable: "}difference ${ratText(r.diff)} > tolerance ${ratText(r.tol)}`, label);
}

/** S6 d, quotient form: |q - P| <= 1/2 10^-k(P) + (1000 (S + dS) / (E - dE) - q). */
function intensityRow(obj: Json, entries: Json[], hasEv: boolean, label: string): Row {
  const es = shiftOf(ENERGY_SHIFT, obj["energy-unit"]);
  const cs = shiftOf(CARBON_SHIFT, obj["carbon-unit"]);
  if (es === undefined || cs === undefined) return row("S6.d", NE, "unit unknown", label); // the caller tests this first: the row is never printed
  const P = obj["carbon-intensity-gCO2e-per-kWh"];
  const kOf = kOfFor(hasEv);
  const S = conv(obj["scope-2"], cs, 0);
  const E = conv(obj["energy-consumption"], es, 0);
  const dS = ratMul(half(kOf(obj["scope-2"])), pow10q(cs));
  const dE = ratMul(half(kOf(obj["energy-consumption"])), pow10q(es));
  if (E.n === 0n) {
    if (hasEv && entries.every((o) => o.kwh === 0)) return row("S6.d", P === undefined ? PASS : FAIL, P === undefined ? undefined : "present with zero energy", label);
    return row("S6.d", NE, "published energy is 0", label);
  }
  const denom = ratSub(E, dE);
  if (denom.n <= 0n) return row("S6.d", NE, "energy below its half unit", label);
  const Qv = ratDiv(ratMul(S, rat(1000n)), E);
  const slack = ratSub(ratDiv(ratMul(ratAdd(S, dS), rat(1000n)), denom), Qv);
  const tol = ratAdd(half(kOf(P)), slack);
  const ok = ratCmp(ratAbs(ratSub(Qv, val(P))), tol) <= 0;
  return row("S6.d", ok ? PASS : hasEv ? FAIL : INFO, ok ? undefined : `${hasEv ? "" : "not derivable: "}difference exceeds tolerance`, label);
}

/** 8.3 without a ledger: derived from `offsets-retired-tCO2e` and the gross footprint; reported as INFO. */
function statusNoLedgerRow(obj: Json, nz: string, cs: number | undefined, label: string): Row {
  const off = extOf(obj, "carbon-neutrality")?.["offsets-retired-tCO2e"];
  const fp = obj["carbon-footprint"];
  if (fp === undefined || cs === undefined) return row("S6.f", INFO, "not derivable: no carbon-footprint", label);
  const offKg = off === undefined ? rat(0n) : ratMul(val(off), rat(1000n));
  const fpKg = conv(fp, cs, 0);
  const expect = ratCmp(offKg, fpKg) >= 0 ? "achieved" : offKg.n === 0n ? "not-achieved" : "partial";
  const zero = fpKg.n === 0n && offKg.n === 0n;
  return row("S6.f", INFO, `${expect === nz ? "consistent" : `expected ${expect}`}${zero && expect === "achieved" ? "; no emissions to cover" : ""}`, label);
}

function statusLedgerRow(level: string, ev: Json, entries: Json[], nz: string, label: string): Row {
  if (!entries.length) return row("S6.f", INFO, "not derivable", label);
  const F = level === "network" ? ev["network-offset-coverage"] : entries[0]["offset-coverage-every-period"];
  const off = entries.reduce((a, o) => add(a, fromNumber(o["offsets-kgco2e"] ?? 0)), ZERO);
  const expect = F === true ? "achieved" : isZero(off) ? "not-achieved" : "partial";
  return row("S6.f", expect === nz ? PASS : FAIL, expect === nz ? undefined : `expected ${expect}`, label);
}

function coverageFlagRow(level: string, ev: Json | undefined, entries: Json[], label: string): Row | null {
  if (level === "network") {
    if (!ev || !entries.length) return null;
    const conj = entries.every((o) => o["offset-coverage-every-period"] === true);
    return row("S6.e", ev["network-offset-coverage"] === conj || (ev["network-offset-coverage"] === false && !conj) ? PASS : FAIL, ev["network-offset-coverage"] === conj ? undefined : "network-offset-coverage differs from the conjunction", label);
  }
  if (!ev) return null;
  return row("S6.e", "network-offset-coverage" in ev ? FAIL : PASS, "network-offset-coverage" in ev ? "present at operator level" : undefined, label);
}

/** S6 i on the paired object: energy equal, footprint = primary scope-1 + own scope-2 + primary scope-3, own intensity. */
function pairedRow(primary: Json, paired: Json, hasEv: boolean, label: string): Row {
  const bad: string[] = [];
  const es = shiftOf(ENERGY_SHIFT, primary["energy-unit"]);
  const pes = shiftOf(ENERGY_SHIFT, paired["energy-unit"]);
  const c1 = shiftOf(CARBON_SHIFT, primary["carbon-unit"]);
  const pc = shiftOf(CARBON_SHIFT, paired["carbon-unit"]);
  const kOf = kOfFor(hasEv);
  const energyComparable = paired["energy-consumption"] !== undefined && primary["energy-consumption"] !== undefined && pes !== undefined && es !== undefined;
  if (energyComparable && ratCmp(conv(paired["energy-consumption"], pes, 0), conv(primary["energy-consumption"], es, 0)) !== 0) bad.push("energy-consumption");
  if (paired["carbon-footprint"] !== undefined && paired["scope-2"] !== undefined && primary["scope-3"] !== undefined && pc !== undefined && c1 !== undefined) {
    const ts = [term(paired["scope-2"], kOf(paired["scope-2"]), pc), term(primary["scope-3"], kOf(primary["scope-3"]), c1)];
    if (primary["scope-1"] !== undefined) ts.push(term(primary["scope-1"], kOf(primary["scope-1"]), c1));
    if (!tolerancePass(paired["carbon-footprint"], kOf(paired["carbon-footprint"]), pc, ts).ok) bad.push("carbon-footprint");
  }
  const intensityTestable = paired["carbon-intensity-gCO2e-per-kWh"] !== undefined && paired["scope-2"] !== undefined && paired["energy-consumption"] !== undefined && pes !== undefined && pc !== undefined;
  if (intensityTestable && intensityRow(paired, [], hasEv, label).result === FAIL) bad.push("carbon-intensity-gCO2e-per-kWh");
  return row("S6.i", bad.length ? FAIL : PASS, list(bad), label);
}

/** S6.b, the footprint row and the intensity row: figures derivable from the ledger evidence. */
function derivedRows(obj: Json, entries: Json[], hasEv: boolean, label: string): Row[] {
  const es = shiftOf(ENERGY_SHIFT, obj["energy-unit"]);
  const cs = shiftOf(CARBON_SHIFT, obj["carbon-unit"]);
  const rows: Row[] = [hasEv ? aggregateRow(obj, entries, label) : row("S6.b", INFO, "not derivable: no ledger-evidence-2", label)];
  if (obj["carbon-footprint"] !== undefined) rows.push(footprintRow(obj, hasEv, label));
  const intensityInputs = ["carbon-intensity-gCO2e-per-kWh", "scope-2", "energy-consumption"].every((k) => obj[k] !== undefined);
  if (intensityInputs && es !== undefined && cs !== undefined) rows.push(intensityRow(obj, entries, hasEv, label));
  return rows;
}

/** S6.g, one DECLARED row per figure the publisher states without ledger evidence for it. */
function declaredRows(obj: Json, nz: unknown, label: string): Row[] {
  const declared: [string, boolean][] = [
    ["hardware-lifecycle", extOf(obj, "hardware-lifecycle") !== undefined],
    ["net-zero-status", nz !== undefined],
    ["validated-node-count", isInt(extOf(obj, "network-topology")?.["validated-node-count"])],
    ["renewable-energy", obj["renewable-energy"] !== undefined],
  ];
  return declared.filter(([, present]) => present).map(([name]) => row("S6.g", DECLARED, name, label));
}

/** S6 a: the result row, then one INFO row per note and per mistyped optional member (read as absent, 8.1). */
function rowsA(obj: Json, level: string, ev: Json | undefined, label: string, mistyped: string[]): Row[] {
  const hasEv = ev !== undefined;
  const { m, energyOmitted } = level === "network" ? missing74(obj, ev) : { m: [] as string[], energyOmitted: obj["energy-consumption"] === undefined };
  const ext = extTokens(obj, level, hasEv, energyOmitted);
  const tokens = [...ext.tokens, ...(hasEv ? evidenceTokens(ev, level) : []), ...m.map((x) => `missing:${x}`)];
  const infos = [...ext.notes, ...mistyped.map((name) => `member ${name} has the wrong type`)];
  return [row("S6.a", tokens.length ? FAIL : PASS, list(tokens), label), ...infos.map((text) => row("S6.a.info", INFO, text, label))];
}

/** S6 coherence on an object that claims SFC; `mistyped` names its wrong-typed optional extension members (computed from the served object). */
export function s6(obj: Json, level: string, siblings: Json[] | undefined, label: string, mistyped: string[] = []): Row[] {
  const ev = extOf(obj, "ledger-evidence-2");
  const hasEv = ev !== undefined;
  if (hasEv && !PROFILE.versionPattern.test(String(ev["profile-version"]))) return [row("S6", INFO, `profile ${ev["profile-version"]} not read`, label)];
  const rows: Row[] = rowsA(obj, level, ev, label, mistyped);
  // an entry whose members are mistyped is reported by S6 a and takes no part in the sums
  const entries: Json[] = hasEv && Array.isArray(ev.operators) ? ev.operators.filter(operatorEntryOk) : [];
  rows.push(...derivedRows(obj, entries, hasEv, label));
  const flag = coverageFlagRow(level, ev, entries, label);
  if (flag) rows.push(flag);
  const nz = extOf(obj, "carbon-neutrality")?.["net-zero-status"];
  if (nz !== undefined) rows.push(hasEv ? statusLedgerRow(level, ev, entries, nz, label) : statusNoLedgerRow(obj, nz, shiftOf(CARBON_SHIFT, obj["carbon-unit"]), label));
  rows.push(...declaredRows(obj, nz, label));
  if (extOf(obj, "ledger-evidence") !== undefined) rows.push(row("S6.h", INFO, "superseded name present", label));
  const paired = (siblings ?? []).find((o) => o !== obj && samePeriodTarget(o, obj) && o["carbon-accounting"] === "location-based");
  if (paired && obj["carbon-accounting"] === "market-based") rows.push(pairedRow(obj, paired, hasEv, label));
  return rows;
}

// ---- S4 selection, C-SFC-2 disclosure form (9.2, 9.3) -------------------------------------

// (calendar years are judged by `isCalendarYear` in calendar.ts)

export interface AnnualSelection {
  rows: Row[];
  primary: Json | null;
  selected?: { start: string; end: string; os: Json[] };
}

/** S4: choose the annual network object (9.3 step 4). */
export function selectAnnual(objs: Json[], target: string, T: string): AnnualSelection {
  const rows: Row[] = [];
  const cand = objs.filter((o) => sameTarget(o.target, target) && o["target-type"] === "service" && typeof extOf(o, "network-topology")?.["member-of-network"] !== "string");
  if (!cand.length) return { rows: [row("S4", NE, `no network declaration for ${target}`)], primary: null };
  const groups = new Map<string, Json[]>();
  for (const o of cand) {
    const k = `${o.period?.start}|${o.period?.end}`;
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const years: { start: string; end: string; os: Json[] }[] = [];
  for (const [k, os] of groups) {
    const [start, end] = k.split("|");
    if (!isCalendarYear({ start, end }, os.some((o) => extOf(o, "ledger-evidence-2") !== undefined))) rows.push(row("S4.info", INFO, `period ${start} to ${end} excluded: not a whole calendar year`));
    else years.push({ start, end, os });
  }
  const ended = years.filter((y) => atOrBefore(y.end, T)).sort((a, b) => (before(a.end, b.end) ? -1 : 1));
  for (const y of years.filter((y2) => !atOrBefore(y2.end, T))) rows.push(row("S4.info", INFO, `period not yet ended at T: ${y.start} to ${y.end}`));
  if (!ended.length) {
    rows.push(row("S4", NE, "no annual network object ended at or before T"));
    return { rows, primary: null };
  }
  const sel = ended[ended.length - 1];
  for (const y of ended.slice(0, -1)) rows.push(row("S4.info", INFO, `other year: ${y.start} to ${y.end}`));
  rows.push(row("S4.info", INFO, `latest year selected: ${sel.start} to ${sel.end}${before(addCalendarMonths(sel.end, 18), T) ? "; ended more than 18 months before T" : ""}`));
  const primary = sel.os.find((o) => o["carbon-accounting"] === "market-based") ?? sel.os.find((o) => extOf(o, "ledger-evidence-2") !== undefined) ?? null;
  rows.push(primary ? row("S4", PASS, `${sel.start} to ${sel.end}`) : row("S4", NE, "no market-based object and none with ledger-evidence-2"));
  return { rows, primary, selected: sel };
}

/** The energy of an object in kWh; the callers have checked that its unit is known. */
const toKwh = (o: Json) => fromUnit(fromNumber(o["energy-consumption"]), shiftOf(ENERGY_SHIFT, o["energy-unit"]) ?? 0);

/** C-SFC-2 disclosure form on the selected object. */
export function csfc2Disclosure(sel: { os: Json[] }, primary: Json | null, incomplete: boolean): Row {
  const label = "disclosure";
  if (!primary) return row("C-SFC-2", NE, "no primary object", label);
  if (incomplete) return row("C-SFC-2", NE, "incomplete object", label);
  if (primary["energy-consumption"] === undefined || shiftOf(ENERGY_SHIFT, primary["energy-unit"]) === undefined) return row("C-SFC-2", NE, "figure or unit missing", label);
  const disagree = sel.os.some((o) => o["energy-consumption"] !== undefined && shiftOf(ENERGY_SHIFT, o["energy-unit"]) !== undefined && cmp(toKwh(o), toKwh(primary)) !== 0);
  if (disagree) return row("C-SFC-2", NE, "annual objects of one target and period disagree", label);
  const kwh = toKwh(primary);
  const near = Math.abs(Number(toText(kwh)) - PROFILE.capKwh) <= PROFILE.capKwh * 0.01;
  return row("C-SFC-2", cmp(kwh, CAP_KWH) < 0 ? PASS : FAIL, near ? "INFO within 1% of CAP: the methodology document must say no perturbation was applied" : undefined, label);
}

// ---- C-SFC-5 (7.2, 7.3, 7.4, 9.2) ---------------------------------------------------------

/** 3.3 rule 2 on a published value: at most 15 digits in all, at most 6 after the point; a sign is allowed (a 1.x Scope figure may be negative, 12.1). */
const figurePublishable = (x: number): boolean => figureOk(Math.abs(x));

function levelTokens(obj: Json, level: string, ev: Json | undefined): string[] {
  const t: string[] = [];
  if (level === "network") {
    for (const x of missing74(obj, ev).m) t.push(`missing:${x}`);
    if (obj["target-type"] !== "service") t.push("target-type");
    if (obj["disclosure-uri"] === undefined) t.push("disclosure-uri");
    return t;
  }
  const numeric = METRICS.some((k) => obj[k] !== undefined);
  if (!numeric && obj["disclosure-uri"] === undefined && obj["verifiable-attestation-uri"] === undefined) t.push("no evidence member");
  if (obj["target-type"] === "origin" && ev && typeof extOf(obj, "network-topology")?.["member-of-network"] !== "string") t.push("member-of-network");
  return t;
}

function pairedMemberTokens(obj: Json, paired: Json): string[] {
  // what the primary omits for a silent energy month the paired object omits too (7.5 rule 4)
  const need = ["target-type", "carbon-unit", "scope-2", "carbon-footprint", "signed", "updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target"];
  if (obj["energy-consumption"] !== undefined) need.push("energy-consumption", "energy-unit");
  if (obj["disclosure-uri"] !== undefined) need.push("disclosure-uri");
  return need.filter((k) => paired[k] === undefined).map((k) => `paired:${k}`);
}

/** C-SFC-5 on one object that claims SFC. `s2valid` is the consumer library's verdict; `s3rows` are searched for rejection. */
export function csfc5(obj: Json, level: string, siblings: Json[] | undefined, T: string, skew: number, s2valid: boolean, s3rows: Row[]): Row {
  const ev = extOf(obj, "ledger-evidence-2");
  const t: string[] = [];
  if (!s2valid) t.push("S2");
  t.push(...levelTokens(obj, level, ev));
  if (obj["energy-consumption"] !== undefined && obj["energy-unit"] === undefined) t.push("energy-unit");
  if (["carbon-footprint", "scope-1", "scope-2", "scope-3"].some((k) => obj[k] !== undefined) && obj["carbon-unit"] === undefined) t.push("carbon-unit");
  if (ev) {
    if (typeof obj.signed !== "string") t.push("signed absent");
    else if (s3rows.some((r) => r.id === "S3" && r.result === FAIL)) t.push("signed");
    if (!(isMonthBound(obj.period?.start) && isMonthBound(obj.period?.end))) t.push("period not month-bound");
    if (!PROFILE.versionPattern.test(String(ev["profile-version"]))) t.push("profile-version");
    for (const k of ["energy-consumption", "scope-1", "scope-2", "scope-3", "carbon-footprint", "carbon-intensity-gCO2e-per-kWh"]) if (typeof obj[k] === "number" && !figurePublishable(obj[k])) t.push(`figure:${k}`);
  }
  if (isInstant(obj.updated) && epochOf(obj.updated) > epochOf(T) + skew * 1000) t.push("updated after T");
  const paired = obj["carbon-accounting"] === "market-based" ? (siblings ?? []).find((o) => o !== obj && samePeriodTarget(o, obj) && o["carbon-accounting"] === "location-based") : undefined;
  if (paired) t.push(...pairedMemberTokens(obj, paired));
  return row("C-SFC-5", t.length ? FAIL : PASS, list(t), labelOf(obj));
}

// ---- URIs taken from untrusted data (section 10) ------------------------------------------

const hasScheme = (u: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(u);
const userinfo = (u: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*@/.test(u);

/** Check one URI-valued member; `base` is the retrieval URI or null. Rows only for problems. */
function checkUri(member: string, value: unknown, scope: string, base: string | null, rows: Row[], reference = true): void {
  if (typeof value !== "string") return;
  if (!hasScheme(value)) {
    if (!reference) rows.push(row("URI", NE, `not an absolute URI: ${member}`, scope));
    else if (!base) rows.push(row("URI", NE, `relative reference, no base: ${member}`, scope));
    else rows.push(row("URI", INFO, `${member} resolved to ${new URL(value, base).href}`, scope));
    return;
  }
  if (userinfo(value)) rows.push(row("URI", NE, `userinfo in URI: ${member}`, scope));
}

export function declarationUriRows(objs: Json[], base: string | null): Row[] {
  const rows: Row[] = [];
  for (const o of objs) {
    const scope = labelOf(o);
    for (const m of ["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"]) checkUri(m, o[m], scope, base, rows);
    checkUri("ledger-access-uri", extOf(o, "ledger-evidence-2")?.["ledger-access-uri"], scope, base, rows, false);
    checkUri("offset-registry-uri", extOf(o, "carbon-neutrality")?.["offset-registry-uri"], scope, base, rows, false);
    checkUri("network-declaration", extOf(o, "network-topology")?.["network-declaration"], scope, base, rows, false);
    checkUri("reuse-and-recycling-policy-uri", extOf(o, "hardware-lifecycle")?.["reuse-and-recycling-policy-uri"], scope, base, rows, false);
  }
  return rows;
}

/** `evidence` of a 2.0 event must be absolute; a retirement `registry` must carry no userinfo. */
export function eventUriRows(ctx: Ctx): Row[] {
  const rows: Row[] = [];
  for (const ev of ctx.events) {
    if (ev.kind !== "2x" || !isObject(ev.event?.payload)) continue;
    const scope = `${ev.event.subject} ${ev.event.type === PROFILE.eventTypes.energy ? "Energy" : "Carbon"} ${ev.commit}`;
    const p = ev.event.payload;
    if (typeof p.evidence === "string" && !hasScheme(p.evidence)) rows.push(row("URI", NE, "not an absolute URI: evidence", scope));
    else checkUri("evidence", p.evidence, scope, null, rows, false);
    for (const r of Array.isArray(p.retirements) ? p.retirements : []) checkUri("registry", r?.registry, scope, null, rows, false);
  }
  return rows;
}
