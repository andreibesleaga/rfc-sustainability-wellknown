/** S6 coherence (9.3) and the tolerance rule (3.3 rule 4): do the published figures hang together? */
import { fromNumber, add, ZERO, isZero } from "./decimal.mjs";
import { fromDec, qAdd, qSub, qMul, qDiv, qCmp, qAbs, q, qText } from "./decimal.mjs";
import { isObject, isHost, isHttpsUri, isHex64, isInt, isNum } from "./forms.mjs";
import { row, PASS, FAIL, NE, DECLARED, INFO, list } from "./rows.mjs";
import { extOf, samePeriodTarget } from "./declaration.mjs";
import { shiftOf, ENERGY_SHIFT, CARBON_SHIFT } from "./derive.mjs";

export const METRICS = ["energy-consumption", "carbon-footprint", "scope-1", "scope-2", "scope-3", "carbon-intensity-gCO2e-per-kWh", "renewable-energy", "sci-score", "estimated-annual-emissions-kgCO2e"];
const PROFILE_VERSION = /^2\.[0-9]+$/;
const NET_ZERO = ["achieved", "partial", "not-achieved"];
const isStr = (v) => typeof v === "string";
const digitsAfterPoint = (x) => { const t = JSON.stringify(x); const i = t.indexOf("."); return i < 0 ? 0 : t.length - i - 1; };

// ---- tolerance rule -----------------------------------------------------------------------

const pow10q = (e) => (e >= 0 ? q(10n ** BigInt(e)) : q(1n, 10n ** BigInt(-e)));
/** Half a unit in the k-th decimal place. */
const half = (k) => q(1n, 2n * 10n ** BigInt(k));
const val = (x) => fromDec(fromNumber(x));
/** A figure written in a unit with shift `from`, expressed in the unit with shift `to`. */
const conv = (x, from, to) => qMul(val(x), pow10q(from - to));
/** A term of a tolerance comparison: figure, its k, its unit shift. */
const term = (x, k, shift) => ({ x, k, shift });

/** |P - sum Ti| <= 1/2 10^-k(P) + sum 1/2 10^-k(Ti), everything in the unit of P (shift `sp`). */
export function tolerancePass(P, kP, sp, terms) {
  let sum = q(0n), tolerance = half(kP);
  for (const t of terms) {
    sum = qAdd(sum, conv(t.x, t.shift, sp));
    tolerance = qAdd(tolerance, qMul(half(t.k), pow10q(t.shift - sp)));
  }
  const diff = qAbs(qSub(val(P), sum));
  return { ok: qCmp(diff, tolerance) <= 0, diff, tol: tolerance };
}

// ---- extension values (S6 a) --------------------------------------------------------------

/** The S6 a tokens of the extension values: `tokens` FAIL the row; `notes` are INFO (8.4 mixed levels on an object without ledger evidence). */
function extensionTokens(obj, level, hasEvidence, energyOmitted) {
  const t = [], notes = [];
  const hw = extOf(obj, "hardware-lifecycle");
  if (hw) {
    for (const k of ["general-purpose-hardware", "single-use-asic-required"]) if (typeof hw[k] !== "boolean") t.push(`hardware-lifecycle.${k}`);
  }
  const cn = extOf(obj, "carbon-neutrality");
  if (cn && !NET_ZERO.includes(cn["net-zero-status"])) t.push("carbon-neutrality.net-zero-status");
  const tp = extOf(obj, "network-topology");
  if (tp) {
    if (mixedLevels(tp)) (hasEvidence ? t : notes).push("network-topology.mixed-levels");
    t.push(...topologyTokens(tp, level, hasEvidence, energyOmitted));
  }
  return { tokens: t, notes };
}

const NETWORK_MEMBERS = ["consensus-mechanism", "validated-node-count", "node-count-validation-method", "per-transaction-energy-Wh", "nakamoto-coefficient", "geographic-regions"];
const OPERATOR_MEMBERS = ["member-of-network", "network-declaration"];
/** A `network-topology` value that carries members of both levels (8.4). */
const mixedLevels = (tp) => NETWORK_MEMBERS.some((k) => k in tp) && OPERATOR_MEMBERS.some((k) => k in tp);

function topologyTokens(tp, level, hasEvidence, energyOmitted) {
  const t = [];
  if (level === "operator") {
    if (hasEvidence && !isHost(tp["member-of-network"])) t.push("network-topology.member-of-network");
    return t;
  }
  if (!isStr(tp["consensus-mechanism"])) t.push("network-topology.consensus-mechanism");
  if (!energyOmitted) {
    if (!isInt(tp["validated-node-count"])) t.push("network-topology.validated-node-count");
    if (!isStr(tp["node-count-validation-method"])) t.push("network-topology.node-count-validation-method");
  }
  return t;
}

function operatorEntryOk(o) {
  return isObject(o) && typeof o.operator === "string" && isHost(o.origin)
    && (o["energy-head"] === null || isHex64(o["energy-head"])) && (o["carbon-head"] === null || isHex64(o["carbon-head"]))
    && isInt(o["energy-events"]) && isInt(o["carbon-events"])
    && ["kwh", "scope1-kgco2e", "scope3-kgco2e", "offsets-kgco2e"].every((k) => isNum(o[k], 0))
    && typeof o["scope2-kgco2e"] === "number" && typeof o["offset-coverage-every-period"] === "boolean";
}

function evidenceTokens(ev, level) {
  const t = [];
  if (!PROFILE_VERSION.test(String(ev["profile-version"]))) t.push("ledger-evidence-2.profile-version");
  if (!isHttpsUri(ev["ledger-access-uri"])) t.push("ledger-evidence-2.ledger-access-uri");
  if (!Array.isArray(ev.operators) || ev.operators.length < 1) t.push("ledger-evidence-2.operators");
  else ev.operators.forEach((o, i) => { if (!operatorEntryOk(o)) t.push(`ledger-evidence-2.operators[${i}]`); });
  if (level === "network" && typeof ev["network-offset-coverage"] !== "boolean") t.push("ledger-evidence-2.network-offset-coverage");
  return t;
}

const CARBON_GROUP = ["scope-2", "scope-3", "carbon-footprint"];

/** Members 7.4 requires of a network declaration (not counting what 7.5 omits), and which groups are omitted. */
export function missing74(obj, ev) {
  const energyOmitted = obj["energy-consumption"] === undefined;
  const carbonOmitted = CARBON_GROUP.every((k) => obj[k] === undefined);
  const m = [];
  if (ev === undefined) return { m, energyOmitted, carbonOmitted }; // the disclosure form is not held to the ledger-derived members
  const operators = Array.isArray(ev.operators) ? ev.operators.filter(isObject) : [];
  if (obj["measurement-method"] === undefined) m.push("measurement-method");
  if (!energyOmitted && obj["energy-unit"] === undefined) m.push("energy-unit");
  if (!carbonOmitted) m.push(...missingCarbon(obj, operators));
  const allZeroEnergy = operators.every((o) => o.kwh === 0);
  if (!energyOmitted && !carbonOmitted && obj["carbon-intensity-gCO2e-per-kWh"] === undefined && !allZeroEnergy) m.push("carbon-intensity-gCO2e-per-kWh");
  for (const name of ["carbon-neutrality", "network-topology", "ledger-evidence-2"]) if (extOf(obj, name) === undefined) m.push(name);
  return { m, energyOmitted, carbonOmitted };
}
function missingCarbon(obj, operators) {
  const m = [];
  for (const k of [...CARBON_GROUP, "carbon-unit", "carbon-accounting"]) if (obj[k] === undefined) m.push(k);
  if ((extOf(obj, "carbon-neutrality") ?? {})["offsets-retired-tCO2e"] === undefined) m.push("offsets-retired-tCO2e");
  const hasScope1 = operators.some((o) => typeof o["scope1-kgco2e"] === "number" && o["scope1-kgco2e"] > 0);
  if (hasScope1 && obj["scope-1"] === undefined) m.push("scope-1");
  return m;
}

// ---- the rows -----------------------------------------------------------------------------

/** What every S6 step reads about one object. */
function viewOf(obj, level, label) {
  const ev = extOf(obj, "ledger-evidence-2");
  const hasEv = ev !== undefined;
  return {
    obj, level, label, ev, hasEv,
    // an entry whose members are mistyped is reported by S6 a and takes no part in the sums
    entries: hasEv && Array.isArray(ev.operators) ? ev.operators.filter(operatorEntryOk) : [],
    es: shiftOf(ENERGY_SHIFT, obj["energy-unit"]), cs: shiftOf(CARBON_SHIFT, obj["carbon-unit"]),
    // k of a figure: 6 for a ledger-backed object, else the digits after the point it is written with
    kOf: (x) => (hasEv ? 6 : digitsAfterPoint(x)),
  };
}

/** S6 a: the result row, then one INFO row per note and per mistyped optional member (read as absent, 8.1). */
function rowsA(v, mistyped) {
  const energyOmitted = v.obj["energy-consumption"] === undefined;
  const missing = v.level === "network" ? missing74(v.obj, v.ev).m.map((x) => `missing:${x}`) : [];
  const ext = extensionTokens(v.obj, v.level, v.hasEv, energyOmitted);
  const tokens = [...ext.tokens, ...(v.hasEv ? evidenceTokens(v.ev, v.level) : []), ...missing];
  const infos = [...ext.notes, ...mistyped.map((name) => `member ${name} has the wrong type`)];
  return [row("S6.a", tokens.length ? FAIL : PASS, list(tokens), v.label), ...infos.map((text) => row("S6.a.info", INFO, text, v.label))];
}

/** S6 b: the published aggregates against the sum of the `operators` entries. */
function rowB(v) {
  const { obj, entries } = v;
  if (!v.hasEv) return row("S6.b", INFO, "not derivable: no ledger-evidence-2", v.label);
  const carbonGroupOmitted = CARBON_GROUP.every((k) => obj[k] === undefined);
  const bad = [];
  const check = (member, P, name, sp, groupOmitted) => {
    const sumPositive = entries.some((o) => typeof o[name] === "number" && o[name] > 0);
    if (P === undefined) { if (sumPositive && !groupOmitted) bad.push(`${member} absent`); return; }
    if (sp === undefined) { bad.push(`${member} unit`); return; }
    if (!tolerancePass(P, v.kOf(P), sp, entries.map((o) => term(o[name], 6, 0))).ok) bad.push(member);
  };
  // an absent `energy-consumption` is the omitted energy group of 7.5, which S6 a judges, so its group flag is always true
  check("energy-consumption", obj["energy-consumption"], "kwh", v.es, true);
  check("scope-1", obj["scope-1"], "scope1-kgco2e", v.cs, carbonGroupOmitted);
  check("scope-2", obj["scope-2"], "scope2-kgco2e", v.cs, carbonGroupOmitted);
  check("scope-3", obj["scope-3"], "scope3-kgco2e", v.cs, carbonGroupOmitted);
  const off = extOf(obj, "carbon-neutrality")?.["offsets-retired-tCO2e"];
  if (off !== undefined && !tolerancePass(off, v.kOf(off), 3, entries.map((o) => term(o["offsets-kgco2e"], 6, 0))).ok) bad.push("offsets-retired-tCO2e");
  return row("S6.b", bad.length ? FAIL : PASS, list(bad), v.label);
}

/** S6 c: a present `carbon-footprint` equals scope-1 + scope-2 + scope-3. */
function rowC(v) {
  const { obj } = v;
  if (obj["carbon-footprint"] === undefined) return null;
  if (obj["scope-2"] === undefined || obj["scope-3"] === undefined) return row("S6.c", NE, `${obj["scope-2"] === undefined ? "scope-2" : "scope-3"} absent`, v.label);
  if (v.cs === undefined) return row("S6.c", NE, "carbon-unit absent", v.label);
  const terms = ["scope-1", "scope-2", "scope-3"].filter((k) => obj[k] !== undefined).map((k) => term(obj[k], v.kOf(obj[k]), v.cs));
  const r = tolerancePass(obj["carbon-footprint"], v.kOf(obj["carbon-footprint"]), v.cs, terms);
  if (r.ok) return row("S6.c", PASS, undefined, v.label);
  const prefix = v.hasEv ? "" : "not derivable: ";
  return row("S6.c", v.hasEv ? FAIL : INFO, `${prefix}difference ${qText(r.diff)} > tolerance ${qText(r.tol)}`, v.label);
}

/** S6 d, quotient form: |q - P| <= 1/2 10^-k(P) + (1000 (S + dS) / (E - dE) - q). */
function intensityRow(v, entries, label = v.label) {
  const { obj } = v;
  const P = obj["carbon-intensity-gCO2e-per-kWh"];
  const S = conv(obj["scope-2"], v.cs, 0), E = conv(obj["energy-consumption"], v.es, 0);
  const dS = qMul(half(v.kOf(obj["scope-2"])), pow10q(v.cs)), dE = qMul(half(v.kOf(obj["energy-consumption"])), pow10q(v.es));
  if (E.n === 0n) {
    if (v.hasEv && entries.every((o) => o.kwh === 0)) return row("S6.d", P === undefined ? PASS : FAIL, P === undefined ? undefined : "present with zero energy", label);
    return row("S6.d", NE, "published energy is 0", label);
  }
  const denominator = qSub(E, dE);
  if (denominator.n <= 0n) return row("S6.d", NE, "energy below its half unit", label);
  const quotient = qDiv(qMul(S, q(1000n)), E);
  const slack = qSub(qDiv(qMul(qAdd(S, dS), q(1000n)), denominator), quotient);
  const ok = qCmp(qAbs(qSub(quotient, val(P))), qAdd(half(v.kOf(P)), slack)) <= 0;
  if (ok) return row("S6.d", PASS, undefined, label);
  return row("S6.d", v.hasEv ? FAIL : INFO, `${v.hasEv ? "" : "not derivable: "}difference exceeds tolerance`, label);
}
const intensityApplies = (v) => v.obj["carbon-intensity-gCO2e-per-kWh"] !== undefined && v.obj["scope-2"] !== undefined
  && v.obj["energy-consumption"] !== undefined && v.es !== undefined && v.cs !== undefined;
const rowD = (v) => (intensityApplies(v) ? intensityRow(v, v.entries) : null);

/** S6 e: `network-offset-coverage` is the conjunction of the entries' flags; absent at operator level. */
function rowE(v) {
  if (v.level === "network") {
    if (!v.hasEv || !v.entries.length) return null;
    const conjunction = v.entries.every((o) => o["offset-coverage-every-period"] === true);
    const ok = v.ev["network-offset-coverage"] === conjunction;
    return row("S6.e", ok ? PASS : FAIL, ok ? undefined : "network-offset-coverage differs from the conjunction", v.label);
  }
  if (!v.hasEv) return null;
  const present = "network-offset-coverage" in v.ev;
  return row("S6.e", present ? FAIL : PASS, present ? "present at operator level" : undefined, v.label);
}

/** S6 f with a ledger: `net-zero-status` is consistent with 7.4. */
function ledgerStatusRow(v, status) {
  if (!v.entries.length) return row("S6.f", INFO, "not derivable", v.label);
  const flag = v.level === "network" ? v.ev["network-offset-coverage"] : v.entries[0]["offset-coverage-every-period"];
  const offsets = v.entries.reduce((a, o) => add(a, fromNumber(o["offsets-kgco2e"] ?? 0)), ZERO);
  const expected = flag === true ? "achieved" : isZero(offsets) ? "not-achieved" : "partial";
  return row("S6.f", expected === status ? PASS : FAIL, expected === status ? undefined : `expected ${expected}`, v.label);
}

/** 8.3 without a ledger: derived from `offsets-retired-tCO2e` and the gross footprint; reported as INFO. */
function plainStatusRow(v, status) {
  const { obj } = v;
  const off = extOf(obj, "carbon-neutrality")?.["offsets-retired-tCO2e"];
  const footprint = obj["carbon-footprint"];
  if (footprint === undefined || v.cs === undefined) return row("S6.f", INFO, "not derivable: no carbon-footprint", v.label);
  const offsetsKg = off === undefined ? q(0n) : qMul(val(off), q(1000n));
  const footprintKg = conv(footprint, v.cs, 0);
  const covered = qCmp(offsetsKg, footprintKg) >= 0;
  const expected = covered ? "achieved" : offsetsKg.n === 0n ? "not-achieved" : "partial";
  const zero = footprintKg.n === 0n && offsetsKg.n === 0n;
  const detail = `${expected === status ? "consistent" : `expected ${expected}`}${zero && expected === "achieved" ? "; no emissions to cover" : ""}`;
  return row("S6.f", INFO, detail, v.label);
}
const rowF = (v) => {
  const status = extOf(v.obj, "carbon-neutrality")?.["net-zero-status"];
  if (status === undefined) return null;
  return v.hasEv ? ledgerStatusRow(v, status) : plainStatusRow(v, status);
};

/** S6 g: members the ledger cannot establish are reported DECLARED, never PASS. */
function rowsG(v) {
  const { obj } = v;
  const declared = [
    ["hardware-lifecycle", extOf(obj, "hardware-lifecycle") !== undefined],
    ["net-zero-status", extOf(obj, "carbon-neutrality")?.["net-zero-status"] !== undefined],
    ["validated-node-count", isInt(extOf(obj, "network-topology")?.["validated-node-count"])],
    ["renewable-energy", obj["renewable-energy"] !== undefined],
  ];
  return declared.filter(([, present]) => present).map(([name]) => row("S6.g", DECLARED, name, v.label));
}

/** Paired energy differs from the primary's, when both can be compared. */
function pairedEnergyDiffers(v, paired, pes) {
  const primary = v.obj;
  const comparable = paired["energy-consumption"] !== undefined && primary["energy-consumption"] !== undefined && pes !== undefined && v.es !== undefined;
  return comparable && qCmp(conv(paired["energy-consumption"], pes, 0), conv(primary["energy-consumption"], v.es, 0)) !== 0;
}

/** Paired footprint is not the primary's scope-1 + own scope-2 + primary scope-3 under the tolerance rule. */
function pairedFootprintDiffers(v, paired, pcs) {
  const primary = v.obj;
  const comparable = paired["carbon-footprint"] !== undefined && paired["scope-2"] !== undefined && primary["scope-3"] !== undefined && pcs !== undefined && v.cs !== undefined;
  if (!comparable) return false;
  const terms = [term(paired["scope-2"], v.kOf(paired["scope-2"]), pcs), term(primary["scope-3"], v.kOf(primary["scope-3"]), v.cs)];
  if (primary["scope-1"] !== undefined) terms.push(term(primary["scope-1"], v.kOf(primary["scope-1"]), v.cs));
  return !tolerancePass(paired["carbon-footprint"], v.kOf(paired["carbon-footprint"]), pcs, terms).ok;
}

/** S6 i on the paired object: energy equal, footprint = primary scope-1 + own scope-2 + primary scope-3, own intensity. */
function rowI(v, paired) {
  const bad = [];
  const pes = shiftOf(ENERGY_SHIFT, paired["energy-unit"]), pcs = shiftOf(CARBON_SHIFT, paired["carbon-unit"]);
  const pairedView = { ...v, obj: paired, es: pes, cs: pcs };
  if (pairedEnergyDiffers(v, paired, pes)) bad.push("energy-consumption");
  if (pairedFootprintDiffers(v, paired, pcs)) bad.push("carbon-footprint");
  // the paired object has no `operators` entries of its own: zero published energy is judged without them
  if (intensityApplies(pairedView) && intensityRow(pairedView, []).result === FAIL) bad.push("carbon-intensity-gCO2e-per-kWh");
  return row("S6.i", bad.length ? FAIL : PASS, list(bad), v.label);
}

/** S6 on one object that has `ledger-evidence-2` or another SFC extension; `mistyped` names its wrong-typed optional extension members. */
export function s6(obj, level, siblings, label, mistyped = []) {
  const v = viewOf(obj, level, label);
  if (v.hasEv && !PROFILE_VERSION.test(String(v.ev["profile-version"]))) return [row("S6", INFO, `profile ${v.ev["profile-version"]} not read`, label)];
  const rows = [...rowsA(v, mistyped), rowB(v), rowC(v), rowD(v), rowE(v), rowF(v), ...rowsG(v)].filter(Boolean);
  if (extOf(obj, "ledger-evidence") !== undefined) rows.push(row("S6.h", INFO, "superseded name present", label));
  const paired = (siblings ?? []).find((o) => o !== obj && samePeriodTarget(o, obj) && o["carbon-accounting"] === "location-based");
  if (paired && obj["carbon-accounting"] === "market-based") rows.push(rowI(v, paired));
  return rows;
}
