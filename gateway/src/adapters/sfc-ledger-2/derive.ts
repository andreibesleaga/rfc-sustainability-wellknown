/**
 * Sums over effective attestations and the figures a declaration publishes
 * (7.4 mapping, 7.5 silent months, 8.5 `ledger-evidence-2`). One derivation
 * serves both directions: the bridge writes the figures from it, and the deep
 * check recomputes the same figures to compare with a served declaration.
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 */
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../sfc-ledger-profile";
import { activeIn, type Entry } from "./registry";
import { decOf, eKey, replay, type Ctx, type LedgerEv } from "./ledger";
import { METHODS } from "./shape";
import { add, atOrBefore, toUnit, divRound, isZero, monthsBetween, mulInt, publish6, shift, ZERO, type Dec, type Json } from "./primitives";

export interface PeriodBounds {
  start: string;
  end: string;
}

export interface OperatorFigures {
  operator: string;
  origin: string;
  kwh: Dec;
  s1: Dec;
  s2: Dec;
  s3: Dec;
  off: Dec;
  coverage: boolean;
  has1x: boolean;
  has1xEnergy: boolean;
  /** The hashes of the 1.x CarbonAttested events counted for this operator (C-SFC-7 names them). */
  events1x: string[];
  energyHead: string | null;
  carbonHead: string | null;
  energyEvents: number;
  carbonEvents: number;
}

export interface SilentMonth {
  operator: string;
  month: string;
  basis1x?: string;
}

export interface Derivation {
  period: PeriodBounds;
  months: string[];
  ops: OperatorFigures[];
  silentEnergy: SilentMonth[];
  silentCarbon: SilentMonth[];
  noOperator: string[];
  incompleteEnergy: boolean;
  incompleteCarbon: boolean;
  E: Dec;
  S1: Dec;
  S2: Dec;
  S3: Dec;
  Off: Dec;
  hasS1: boolean;
  nodes: number;
  networkCoverage: boolean;
  status: string;
  leastDirect: string | null;
  footprint: Dec;
  S2loc: Dec;
  locationAvailable: boolean;
  has1x: boolean;
  /** `<operator>: <hash>` of each counted 1.x CarbonAttested event, in operator order. */
  events1x: string[];
}

const payload = (ev: LedgerEv): Json => ev.event.payload;
const optional = (ev: LedgerEv, k: string): Dec => (payload(ev)[k] === undefined ? ZERO : decOf(payload(ev)[k]));

/** Basis of a Scope 2 figure: a 2.0 event is market-based; a 1.x event by `scope2Method`, else the parameter, else unknown (12.1 rule 1). */
export function scope2Basis(ctx: Ctx, ev: LedgerEv): string | null {
  if (ev.kind === "2x") return "market-based";
  return payload(ev).scope2Method ?? ctx.params["scope2-basis-1x"] ?? null;
}

/** The `measurementMethod` of an energy event; a missing or out-of-set value counts as `third-party-modeled` (12.1 rule 1). */
export function methodOf(ev: LedgerEv): string {
  const m = payload(ev).measurementMethod;
  return METHODS.includes(m) ? m : "third-party-modeled";
}

interface Accumulator {
  methods: string[];
  nodesByMonth: Map<string, number>;
  silentEnergy: SilentMonth[];
  silentCarbon: SilentMonth[];
  hasS1: boolean;
  S2loc: Dec;
  locationAvailable: boolean;
}

/** Add one operator-month's energy attestation to its operator's sums (or mark it silent). */
function addEnergyMonth(o: OperatorFigures, acc: Accumulator, en: Entry, m: string, eE: { ev: LedgerEv } | undefined): void {
  if (!eE) {
    acc.silentEnergy.push({ operator: en.operator, month: m });
    return;
  }
  o.kwh = add(o.kwh, decOf(payload(eE.ev).kWhConsumed));
  acc.nodesByMonth.set(m, (acc.nodesByMonth.get(m) ?? 0) + payload(eE.ev).nodeCount);
  acc.methods.push(methodOf(eE.ev));
  if (eE.ev.kind === "1x") o.has1xEnergy = true;
}

/** Add one operator-month's carbon attestation (market-based sums, location figure, silence rules of 12.1). */
function addCarbonMonth(ctx: Ctx, o: OperatorFigures, acc: Accumulator, en: Entry, m: string, eC: { ev: LedgerEv } | undefined): void {
  if (!eC) {
    acc.silentCarbon.push({ operator: en.operator, month: m });
    o.coverage = false;
    acc.locationAvailable = false;
    return;
  }
  const basis = scope2Basis(ctx, eC.ev);
  if (eC.ev.kind === "1x") {
    o.has1x = true;
    o.events1x.push(eC.ev.computed as string);
  }
  const q = payload(eC.ev);
  if (basis === "location-based" || basis === null) {
    acc.silentCarbon.push({ operator: en.operator, month: m, basis1x: basis ?? "unknown" });
    o.coverage = false;
    if (basis === "location-based") acc.S2loc = add(acc.S2loc, decOf(q.scope2KgCO2e));
    else acc.locationAvailable = false;
    return;
  }
  if (q.scope1KgCO2e !== undefined) acc.hasS1 = true;
  o.s1 = add(o.s1, optional(eC.ev, "scope1KgCO2e"));
  o.s2 = add(o.s2, decOf(q.scope2KgCO2e));
  o.s3 = add(o.s3, decOf(q.scope3KgCO2e));
  o.off = add(o.off, decOf(q.offsetsKgCO2e));
  if (q.netZero !== true) o.coverage = false;
  if (eC.ev.kind === "2x" && q.scope2LocationKgCO2e !== undefined) acc.S2loc = add(acc.S2loc, decOf(q.scope2LocationKgCO2e));
  else acc.locationAvailable = false;
}

/** Head and in-period count per chain (3.2 `head`, 8.5): skipped events count. */
function chainFigures(ctx: Ctx, o: OperatorFigures, period: PeriodBounds, cutoff: string): void {
  const st = replay(ctx, cutoff);
  const spanEndOk = (it: { i: number }): boolean => {
    const v = st.verdicts.get(it.i);
    return !!v?.span && atOrBefore(v.span[1], period.end);
  };
  const inPeriod = (it: { i: number }): boolean => {
    const v = st.verdicts.get(it.i);
    return !!v?.span && atOrBefore(period.start, v.span[0]) && atOrBefore(v.span[1], period.end);
  };
  const energy = st.chains.get(`${o.operator}|${PROFILE.eventTypes.energy}`) ?? [];
  const carbon = st.chains.get(`${o.operator}|${PROFILE.eventTypes.carbon}`) ?? [];
  o.energyHead = [...energy].reverse().find(spanEndOk)?.hash ?? null;
  o.carbonHead = [...carbon].reverse().find(spanEndOk)?.hash ?? null;
  o.energyEvents = energy.filter(inPeriod).length;
  o.carbonEvents = carbon.filter(inPeriod).length;
}

/** Derive the exact figures for `period` at `cutoff` over the entries the context holds. */
export function derive(ctx: Ctx, cutoff: string, period: PeriodBounds): Derivation {
  const st = replay(ctx, cutoff);
  const months = monthsBetween(period.start, period.end);
  const counted = ctx.registry.filter((en) => months.some((m) => activeIn(en, m))).sort((a, b) => (a.operator < b.operator ? -1 : 1));
  const noOperator = months.filter((m) => !counted.some((en) => activeIn(en, m)));
  const acc: Accumulator = {
    methods: [], nodesByMonth: new Map(months.map((m) => [m, 0])), silentEnergy: [], silentCarbon: [], hasS1: false, S2loc: ZERO, locationAvailable: true,
  };
  const ops: OperatorFigures[] = [];
  for (const en of counted) {
    const o: OperatorFigures = {
      operator: en.operator, origin: en.origin, kwh: ZERO, s1: ZERO, s2: ZERO, s3: ZERO, off: ZERO, coverage: true, has1x: false, has1xEnergy: false, events1x: [],
      energyHead: null, carbonHead: null, energyEvents: 0, carbonEvents: 0,
    };
    for (const m of months.filter((x) => activeIn(en, x))) {
      addEnergyMonth(o, acc, en, m, st.E.get(eKey(en.operator, PROFILE.eventTypes.energy, m)));
      addCarbonMonth(ctx, o, acc, en, m, st.E.get(eKey(en.operator, PROFILE.eventTypes.carbon, m)));
    }
    chainFigures(ctx, o, period, cutoff);
    ops.push(o);
  }
  return summarise(period, months, ops, noOperator, acc);
}

function summarise(period: PeriodBounds, months: string[], ops: OperatorFigures[], noOperator: string[], acc: Accumulator): Derivation {
  const sum = (k: "kwh" | "s1" | "s2" | "s3" | "off"): Dec => ops.reduce((a, o) => add(a, o[k]), ZERO);
  const incompleteEnergy = acc.silentEnergy.length > 0 || noOperator.length > 0;
  const incompleteCarbon = acc.silentCarbon.length > 0 || noOperator.length > 0;
  const E = sum("kwh");
  const S1 = sum("s1");
  const S2 = sum("s2");
  const S3 = sum("s3");
  const Off = sum("off");
  const networkCoverage = ops.length > 0 && ops.every((o) => o.coverage) && noOperator.length === 0;
  const order = PROFILE.measurementMethods;
  return {
    period, months, ops, silentEnergy: acc.silentEnergy, silentCarbon: acc.silentCarbon, noOperator, incompleteEnergy, incompleteCarbon,
    E, S1, S2, S3, Off, hasS1: acc.hasS1, nodes: Math.max(0, ...acc.nodesByMonth.values()), networkCoverage,
    // 7.4: first match achieved, not-achieved when no offsets, else partial
    status: networkCoverage ? "achieved" : isZero(Off) ? "not-achieved" : "partial",
    leastDirect: acc.methods.length ? order[Math.max(...acc.methods.map((x) => order.indexOf(x)))] : null,
    footprint: add(add(S1, S2), S3),
    S2loc: acc.S2loc, locationAvailable: acc.locationAvailable && !incompleteCarbon,
    has1x: ops.some((o) => o.has1x),
    events1x: ops.flatMap((o) => o.events1x.map((h) => `${o.operator}: ${h}`)),
  };
}

const HEAD_MEMBERS: [string, "energyHead" | "carbonHead" | "energyEvents" | "carbonEvents"][] = [
  ["energy-head", "energyHead"], ["carbon-head", "carbonHead"], ["energy-events", "energyEvents"], ["carbon-events", "carbonEvents"],
];

/** The declared heads and event counts (8.5) that differ from the derivation, as `<operator>:<member>` tokens (D4.declared and C-SFC-7 read these). */
export function headAndCountTokens(declaredOperators: Json[], d: Derivation): string[] {
  const bad: string[] = [];
  for (const o of d.ops) {
    const x = declaredOperators.find((y) => y?.operator === o.operator);
    if (!x) continue;
    for (const [member, key] of HEAD_MEMBERS) if (x[member] !== o[key]) bad.push(`${o.operator}:${member}`);
  }
  return bad;
}

// ---- publication (7.4, 8.5) ----------------------------------------------------------------

export const ENERGY_SHIFT: Record<string, number> = { Wh: -3, kWh: 0, MWh: 3, GWh: 6 };
export const CARBON_SHIFT: Record<string, number> = { gCO2e: -3, kgCO2e: 0, tCO2e: 3 };

/** The shift of a unit name from a unit table, or undefined: own names only, so `constructor` or `__proto__` read as unknown. */
export const shiftOf = (table: Record<string, number>, unit: unknown): number | undefined => (typeof unit === "string" && Object.hasOwn(table, unit) ? table[unit] : undefined);

/** The shift of a unit the caller has already checked (the bridge refuses an unknown unit at construction). */
function knownShift(table: Record<string, number>, unit: string): number {
  const shift = shiftOf(table, unit);
  if (shift === undefined) throw new RangeError(`unknown unit ${unit}`);
  return shift;
}

/** The `ledger-evidence-2` value computed from a derivation (8.5). */
export function evidenceValue(d: Derivation, { level = "network", access = "https://ledger.example/sfc/read" }: { level?: string; access?: string } = {}): Json {
  const value: Json = {
    "profile-version": PROFILE.version,
    "ledger-access-uri": access,
    operators: d.ops.map((o) => ({
      operator: o.operator, origin: o.origin,
      "energy-head": o.energyHead, "carbon-head": o.carbonHead,
      "energy-events": o.energyEvents, "carbon-events": o.carbonEvents,
      kwh: publish6(o.kwh), "scope1-kgco2e": publish6(o.s1), "scope2-kgco2e": publish6(o.s2), "scope3-kgco2e": publish6(o.s3),
      "offsets-kgco2e": publish6(o.off), "offset-coverage-every-period": o.coverage,
    })),
  };
  if (level === "network") value["network-offset-coverage"] = d.networkCoverage;
  return value;
}

export interface TopLevelOptions {
  energyUnit?: string;
  carbonUnit?: string;
  consensus?: string;
  level?: string;
}

export interface TopLevel {
  top: Json;
  carbonNeutrality: Json;
  networkTopology: Json;
}

/** The top-level members 7.4 derives, omitting what 7.5 omits. Values are published numbers (3.3 rule 3). */
export function topLevel(d: Derivation, { energyUnit = "MWh", carbonUnit = "tCO2e", consensus = "proof-of-authority", level = "network" }: TopLevelOptions = {}): TopLevel {
  const ce = (x: Dec): number => publish6(toUnit(x, knownShift(ENERGY_SHIFT, energyUnit)));
  const cc = (x: Dec): number => publish6(toUnit(x, knownShift(CARBON_SHIFT, carbonUnit)));
  const top: Json = {};
  if (d.leastDirect) top["measurement-method"] = d.leastDirect;
  if (!d.incompleteEnergy) {
    top["energy-consumption"] = ce(d.E);
    top["energy-unit"] = energyUnit;
  }
  if (!d.incompleteCarbon) {
    if (d.hasS1) top["scope-1"] = cc(d.S1);
    top["scope-2"] = cc(d.S2);
    top["scope-3"] = cc(d.S3);
    top["carbon-footprint"] = cc(d.footprint);
    top["carbon-unit"] = carbonUnit;
    top["carbon-accounting"] = "market-based";
  }
  if (!d.incompleteEnergy && !d.incompleteCarbon && !isZero(d.E)) top["carbon-intensity-gCO2e-per-kWh"] = publish6(divRound(mulInt(d.S2, 1000), d.E, 6));
  const carbonNeutrality: Json = { "net-zero-status": d.status };
  if (!d.incompleteCarbon) carbonNeutrality["offsets-retired-tCO2e"] = publish6(shift(d.Off, 3));
  const networkTopology: Json = level === "network" ? { "consensus-mechanism": consensus } : {};
  if (level === "network" && !d.incompleteEnergy) {
    networkTopology["validated-node-count"] = d.nodes;
    networkTopology["node-count-validation-method"] = "maximum over the months of the period of the sum of the operators' monthly peak node counts";
  }
  return { top, carbonNeutrality, networkTopology };
}

/** Location-based figures for the paired object, or null when 7.3 forbids it. Intensity is on the object's own basis (7.4). */
export function locationFigures(d: Derivation, { carbonUnit = "tCO2e" }: { carbonUnit?: string } = {}): Json | null {
  const shift = shiftOf(CARBON_SHIFT, carbonUnit);
  if (!d.locationAvailable || shift === undefined) return null;
  const cc = (x: Dec): number => publish6(toUnit(x, shift));
  const out: Json = { "scope-2": cc(d.S2loc), "carbon-footprint": cc(add(add(d.S1, d.S2loc), d.S3)) };
  if (!d.incompleteEnergy && !isZero(d.E)) out["carbon-intensity-gCO2e-per-kWh"] = publish6(divRound(mulInt(d.S2loc, 1000), d.E, 6));
  return out;
}
