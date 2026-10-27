/** Sums over effective attestations (7.4, 7.5, 8.5): the figures a declaration must agree with. */
import { add, ZERO, isZero, roundHalfEven, divRound, shift, mulInt, toText } from "./decimal.mjs";
import { eKey, decOf } from "./rules.mjs";
import { replay } from "./replay.mjs";
import { activeIn } from "./registry.mjs";
import { monthsBetween, atOrBefore } from "./time.mjs";
import { METHODS } from "./shapes.mjs";
import { scope2Basis1x, methodOf } from "./profile1x.mjs";
import { extOf } from "./declaration.mjs";

export const ENERGY_SHIFT = { Wh: -3, kWh: 0, MWh: 3, GWh: 6 };
export const CARBON_SHIFT = { gCO2e: -3, kgCO2e: 0, tCO2e: 3 };
/** The power-of-ten shift of `unit` in a unit table, or undefined for anything that is not an own key (a unit named "constructor" or "__proto__" is an unknown unit). */
export const shiftOf = (table, unit) => (typeof unit === "string" && Object.hasOwn(table, unit) ? table[unit] : undefined);
/** A value in a unit with power-of-ten shift `k` (value / 10^-k of the base unit), as a base-unit Dec. */
export const convert = (x, k) => (k >= 0 ? shift(x, k) : mulInt(x, 10 ** -k));
/** Round half to even to 6 decimals (3.3 rule 3). */
export const round6 = (x) => roundHalfEven(x, 6);

const payload = (ev) => ev.event.payload;
const optional = (ev, key) => (payload(ev)[key] === undefined ? ZERO : decOf(payload(ev)[key]));

/** Basis of a Scope 2 figure: 2.0 events are market-based. */
export const scope2Basis = (ctx, ev) => (ev.kind === "2x" ? "market-based" : scope2Basis1x(ctx.params, payload(ev)));

/** The running totals of one counted operator; `events1x` collects the hashes of its 1.x CarbonAttested events counted (D6 names them). */
function operatorTotals(en) {
  return { operator: en.operator, origin: en.origin, kwh: ZERO, s1: ZERO, s2: ZERO, s3: ZERO, off: ZERO, coverage: true, has1x: false, events1x: [] };
}

/** Add one active operator-month to the running totals of `acc`. */
function addMonth(ctx, st, acc, en, month, o) {
  const energy = st.E.get(eKey(en.operator, "EnergyAttested", month));
  const carbon = st.E.get(eKey(en.operator, "CarbonAttested", month));
  if (!energy) acc.silentEnergy.push({ operator: en.operator, month });
  else {
    o.kwh = add(o.kwh, decOf(payload(energy.ev).kWhConsumed));
    acc.nodesByMonth.set(month, acc.nodesByMonth.get(month) + payload(energy.ev).nodeCount);
    acc.methods.push(methodOf(payload(energy.ev)));
  }
  if (!carbon) {
    acc.silentCarbon.push({ operator: en.operator, month });
    o.coverage = false;
    acc.locationAvailable = false;
    return;
  }
  addCarbonMonth(ctx, acc, en, month, o, carbon.ev);
}

function addCarbonMonth(ctx, acc, en, month, o, ev) {
  const q = payload(ev);
  const basis = scope2Basis(ctx, ev);
  if (ev.kind === "1x") { o.has1x = true; o.events1x.push(ev.computed); }
  if (basis === "location-based" || basis === null) {
    acc.silentCarbon.push({ operator: en.operator, month, basis1x: basis ?? "unknown" });
    o.coverage = false;
    if (basis === "location-based") acc.S2loc = add(acc.S2loc, decOf(q.scope2KgCO2e));
    else acc.locationAvailable = false;
    return;
  }
  if (q.scope1KgCO2e !== undefined) acc.hasS1 = true;
  o.s1 = add(o.s1, optional(ev, "scope1KgCO2e"));
  o.s2 = add(o.s2, decOf(q.scope2KgCO2e));
  o.s3 = add(o.s3, decOf(q.scope3KgCO2e));
  o.off = add(o.off, decOf(q.offsetsKgCO2e));
  if (q.netZero !== true) o.coverage = false;
  if (ev.kind === "2x" && q.scope2LocationKgCO2e !== undefined) acc.S2loc = add(acc.S2loc, decOf(q.scope2LocationKgCO2e));
  else acc.locationAvailable = false;
}

/** Heads and event counts of one operator's two chains for `period` (3.2 head, 8.5 counts). */
function headsAndCounts(st, en, period, o) {
  const span = (item) => st.verdicts.get(item.i).span;
  const endsInside = (item) => { const s = span(item); return s && atOrBefore(s[1], period.end); };
  const inside = (item) => { const s = span(item); return s && atOrBefore(period.start, s[0]) && atOrBefore(s[1], period.end); };
  for (const [type, headKey, countKey] of [["EnergyAttested", "energyHead", "energyEvents"], ["CarbonAttested", "carbonHead", "carbonEvents"]]) {
    const chain = st.chains.get(`${en.operator}|${type}`) ?? [];
    const head = [...chain].reverse().find(endsInside);
    o[headKey] = head ? head.hash : null;
    o[countKey] = chain.filter(inside).length;
  }
}

/** Derive the exact figures for `period` at `cutoff` over the counted operators of the read. */
export function derive(ctx, cutoff, period) {
  const st = replay(ctx, cutoff);
  const months = monthsBetween(period.start, period.end);
  const counted = ctx.registry.filter((en) => months.some((m) => activeIn(en, m))).sort((a, b) => (a.operator < b.operator ? -1 : 1));
  const acc = {
    silentEnergy: [], silentCarbon: [], methods: [], hasS1: false, S2loc: ZERO, locationAvailable: true,
    nodesByMonth: new Map(months.map((m) => [m, 0])),
  };
  const noOperator = months.filter((m) => !counted.some((en) => activeIn(en, m)));
  const ops = counted.map((en) => {
    const o = operatorTotals(en);
    for (const m of months) if (activeIn(en, m)) addMonth(ctx, st, acc, en, m, o);
    headsAndCounts(st, en, period, o);
    return o;
  });
  return summarise(period, months, ops, acc, noOperator);
}

function summarise(period, months, ops, acc, noOperator) {
  const sum = (k) => ops.reduce((a, o) => add(a, o[k]), ZERO);
  const incompleteEnergy = acc.silentEnergy.length > 0 || noOperator.length > 0;
  const incompleteCarbon = acc.silentCarbon.length > 0 || noOperator.length > 0;
  const E = sum("kwh"), S1 = sum("s1"), S2 = sum("s2"), S3 = sum("s3"), Off = sum("off");
  const networkCoverage = ops.length > 0 && ops.every((o) => o.coverage) && noOperator.length === 0;
  const leastDirect = acc.methods.length ? METHODS[Math.max(...acc.methods.map((x) => METHODS.indexOf(x)))] : null;
  return {
    period, months, ops, silentEnergy: acc.silentEnergy, silentCarbon: acc.silentCarbon, noOperator, incompleteEnergy, incompleteCarbon,
    E, S1, S2, S3, Off, hasS1: acc.hasS1, nodes: Math.max(0, ...acc.nodesByMonth.values()), networkCoverage,
    status: networkCoverage ? "achieved" : isZero(Off) ? "not-achieved" : "partial", leastDirect,
    footprint: add(add(S1, S2), S3), S2loc: acc.S2loc, locationAvailable: acc.locationAvailable && !incompleteCarbon,
    has1x: ops.some((o) => o.has1x), events1x: ops.flatMap((o) => o.events1x.map((h) => `${o.operator}: ${h}`)),
  };
}

const HEAD_MEMBERS = [["energy-head", "energyHead"], ["carbon-head", "carbonHead"], ["energy-events", "energyEvents"], ["carbon-events", "carbonEvents"]];

/** The declared heads and event counts (8.5) that differ from the derivation, as `<operator>:<member>` tokens (D4.declared and C-SFC-7 read these). */
export function headAndCountTokens(declaredOperators, d) {
  const bad = [];
  for (const o of d.ops) {
    const x = declaredOperators.find((y) => y?.operator === o.operator);
    if (!x) continue;
    for (const [member, key] of HEAD_MEMBERS) if (x[member] !== o[key]) bad.push(`${o.operator}:${member}`);
  }
  return bad;
}

/** The derivation a declaration is compared with: an operator declaration counts only its own operator. */
export function deriveFor(ctx, cutoff, period, decl, level) {
  if (level !== "operator") return derive(ctx, cutoff, period);
  const operator = decl && extOf(decl, "ledger-evidence-2")?.operators?.[0]?.operator;
  return derive({ ...ctx, registry: ctx.registry.filter((en) => en.operator === operator) }, cutoff, period);
}

/** Location-based figures for the paired object (7.3), or null when 7.3 forbids it. Published numbers. */
export function locationFigures(d, { carbonUnit = "tCO2e" } = {}) {
  if (!d.locationAvailable) return null;
  const toUnit = (x) => Number(toText(round6(convert(x, shiftOf(CARBON_SHIFT, carbonUnit)))));
  const out = { "scope-2": toUnit(d.S2loc), "carbon-footprint": toUnit(add(add(d.S1, d.S2loc), d.S3)) };
  if (!d.incompleteEnergy && !isZero(d.E)) out["carbon-intensity-gCO2e-per-kWh"] = Number(toText(round6(divRound(mulInt(d.S2loc, 1000), d.E, 6))));
  return out;
}
