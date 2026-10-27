/** v13 and v14: later corrections; tolerance, rounding and digit limits. */
import { World, retirement } from "../build/world.mjs";
import { monthBound, addMonths, addDays } from "../../lib/time.mjs";
import { primaryObject, locationObject, signDeclaration } from "../build/declare.mjs";
import { T0, scenario, baseNetwork, monthIndex, ctxOf } from "./base.mjs";
import { yearSpec, pubPins } from "./c01-basic.mjs";

export function v13() {
  const { w, ops, H } = baseNetwork({ count: 15 });
  const june = monthIndex(5), sep = monthIndex(8);
  const year = yearSpec();
  // the declaration is built from the ledger as committed at `updated`
  const ctx = ctxOf(w);
  const { obj: primary } = primaryObject(ctx, year);
  const location = locationObject(primary, ctx, year);
  // corrections committed after `updated` and before `read-at`
  w.carbon(ops[0], june, { s2: 900, s3: 215, loc: 347.5, retirements: [retirement("RET-A-202506", 1000, { at: addDays(addMonths(june, 1), 1) })] }, { supersedes: H.get("0|CarbonAttested|5"), commit: "2026-04-10T09:00:00Z" });
  w.energy(ops[1], sep, { kWh: 400000, nodes: 4 }, { supersedes: H.get("1|EnergyAttested|8"), commit: "2026-04-10T10:00:00Z" });
  w.void(H.get("2|CarbonAttested|2"), "2026-04-12T09:00:00Z");
  return { id: "v13-late-correction", scenarios: [
    scenario("corrections-after-updated", w, { declarations: [signDeclaration(primary), signDeclaration(location)], pins: pubPins, select: ["D7", "C-SFC-7", "D4.declared", "D2.void", "C-SFC-4", "C-SFC-2"] }),
  ] };
}

import { ENTRY, stub, sign } from "./stubs.mjs";
import { EXT } from "../../lib/declaration.mjs";

/** Add or replace members of the named extensions of a stub object. */
const withExt = (o, patch) => {
  for (const [name, members] of Object.entries(patch)) o.extensions[`${EXT}${name}`] = { ...o.extensions[`${EXT}${name}`], ...members };
  return o;
};

export function v14() {
  const figureTexts = ["999999999.999999", "1000000000.000001", "1000000000000000", "999999999999999", "0", "0.1234567", "1e-7", "12.5", "-1"];
  const rounding = [{ value: "1.2345675", places: 6 }, { value: "1.2345665", places: 6 }, { value: "2.5", places: 0 }, { value: "3.5", places: 0 }, { value: "-1.2345675", places: 6 }, { value: "0.0000005", places: 6 }, { value: "0.0000015", places: 6 }];
  // events at the digit limit
  const wd = new World({ readAt: T0 });
  const names = ["a", "b", "c", "d", "e"];
  const dops = names.map((n) => wd.operator(n, { from: "2025-11-01T00:00:00Z" }));
  const JAN = monthBound(2026, 1);
  [999999999.999999, 1000000000.000001, 1000000000000000, 999999999999999, 0.1234567].forEach((kWh, j) => wd.energy(dops[j], JAN, { kWh }));
  // the half-even tie: 1234.5675 kWh is 1.2345675 MWh, 1234.5665 kWh is 1.2345665 MWh
  const wt = new World({ readAt: T0 });
  const [ta, tb] = ["a", "b"].map((n) => wt.operator(n, { from: "2025-11-01T00:00:00Z" }));
  const ret = (n) => [retirement(`RET-T${n}`, 1000, { at: addDays(addMonths(JAN, 1), 1) })];
  wt.energy(ta, JAN, { kWh: 1234.5675 }); wt.carbon(ta, JAN, { s2: 300, s3: 200, retirements: ret(1) });
  wt.energy(tb, JAN, { kWh: 1234.5665 }); wt.carbon(tb, JAN, { s2: 300, s3: 200, retirements: ret(2) });
  const tctx = ctxOf(wt);
  const upd = "2026-02-10T09:00:00Z";
  const opSpec = (op, name) => ({ period: { start: JAN, end: addMonths(JAN, 1) }, cutoff: upd, level: "operator", operator: op, updated: upd, target: `node.op-${name}.example`, energyUnit: "MWh", carbonUnit: "kgCO2e" });
  const opObj = (op, name, energy) => { const { obj } = primaryObject(tctx, { ...opSpec(op, name), hardware: false }); obj["energy-consumption"] = energy; return sign(obj); };
  const e3 = [ENTRY("a", { kwh: 1 }), ENTRY("b", { kwh: 1 }), ENTRY("c", { kwh: 1 })];
  const common = { "scope-2": 0, "scope-3": 0, "carbon-footprint": 0, "carbon-intensity-gCO2e-per-kWh": 0 };
  const sixty = [ENTRY("a", { "scope2-kgco2e": 400 }), ENTRY("b", { "scope2-kgco2e": 200 })];
  // a complete network object: every 7.4 member present, so S6 a and C-SFC-5 report only what the scenario adds
  const complete = (target, extra = {}, ext = {}) => withExt(withExt(stub(target, { entries: [ENTRY("a")], top: { ...common, "energy-consumption": 0, ...extra } }), { "carbon-neutrality": { "offsets-retired-tCO2e": 0 } }), ext);
  const plain = (target, ext) => withExt(stub(target, { entries: [], evidence: false, top: { ...common, "energy-consumption": 0 } }), ext);
  return { id: "v14-tolerance", scenarios: [
    { name: "figure-limits", fn: "figure", texts: figureTexts },
    { name: "round-half-even", fn: "round", cases: rounding },
    scenario("events-at-the-digit-limit", wd, { select: ["D5"] }),
    scenario("half-even-published-correctly", wt, { declarations: [opObj(ta, "a", 1.234568), opObj(tb, "b", 1.234566)], pins: pubPins, select: ["S6.b", "C-SFC-7"] }),
    scenario("half-even-published-in-the-wrong-direction", wt, { declarations: [opObj(ta, "a", 1.234567), opObj(tb, "b", 1.234567)], pins: pubPins, select: ["S6.b", "C-SFC-7"] }),
    { name: "three-operator-sum-edge", T: T0, pins: pubPins, select: ["S6.b"], declarations: [
      sign(stub("edge-pass.example", { entries: e3, top: { "energy-consumption": 3.0000015, ...common } })),
      sign(stub("edge-fail.example", { entries: e3, top: { "energy-consumption": 3.000003, ...common } })),
      sign(stub("exact.example", { entries: e3, top: { "energy-consumption": 3, ...common } })),
    ] },
    { name: "coarse-rounding", T: T0, pins: pubPins, select: ["S6.b"], declarations: [
      sign(stub("coarse-fail.example", { entries: sixty, top: { "energy-consumption": 0, "scope-2": 1, "scope-3": 0, "carbon-footprint": 1, "carbon-intensity-gCO2e-per-kWh": 0 }, status: "not-achieved" })),
      sign(stub("fine-pass.example", { entries: sixty, top: { "energy-consumption": 0, "scope-2": 0.6, "scope-3": 0, "carbon-footprint": 0.6, "carbon-intensity-gCO2e-per-kWh": 0 }, status: "not-achieved" })),
    ] },
    { name: "footprint-with-and-without-ledger", T: T0, pins: pubPins, select: ["S6.c"], declarations: [
      sign(stub("no-ledger.example", { entries: [], evidence: false, top: { "energy-consumption": 1, "scope-2": 4.5, "scope-3": 5.5, "carbon-footprint": 10.4 } })),
      sign(stub("with-ledger.example", { entries: [ENTRY("a", { kwh: 1000, "scope2-kgco2e": 4500, "scope3-kgco2e": 5500 })], top: { "energy-consumption": 1000, "scope-2": 4.5, "scope-3": 5.5, "carbon-footprint": 10.4, "carbon-intensity-gCO2e-per-kWh": 4500 } })),
      sign(stub("no-ledger-ok.example", { entries: [], evidence: false, top: { "energy-consumption": 1, "scope-2": 4.5, "scope-3": 5.5, "carbon-footprint": 10 } })),
    ] },
    { name: "intensity-quotient", T: T0, pins: pubPins, select: ["S6.d"], declarations: [
      sign(stub("quotient-pass.example", { entries: [ENTRY("a", { kwh: 3000, "scope2-kgco2e": 100000 })], top: { "energy-consumption": 3, "energy-unit": "MWh", "scope-2": 100, "scope-3": 0, "carbon-footprint": 100, "carbon-intensity-gCO2e-per-kWh": 33333.333333 } })),
      sign(stub("quotient-fail.example", { entries: [ENTRY("a", { kwh: 3000, "scope2-kgco2e": 100000 })], top: { "energy-consumption": 3, "energy-unit": "MWh", "scope-2": 100, "scope-3": 0, "carbon-footprint": 100, "carbon-intensity-gCO2e-per-kWh": 33333.34 } })),
      sign(stub("tiny-energy-inside.example", { entries: [ENTRY("a", { kwh: 0.002, "scope2-kgco2e": 0.001 })], top: { "energy-consumption": 0.000002, "energy-unit": "MWh", "scope-2": 0.000001, "scope-3": 0, "carbon-footprint": 0.000001, "carbon-intensity-gCO2e-per-kWh": 800 } })),
      sign(stub("tiny-energy-outside.example", { entries: [ENTRY("a", { kwh: 0.002, "scope2-kgco2e": 0.001 })], top: { "energy-consumption": 0.000002, "energy-unit": "MWh", "scope-2": 0.000001, "scope-3": 0, "carbon-footprint": 0.000001, "carbon-intensity-gCO2e-per-kWh": 1500 } })),
    ] },
    // 3.3 rule 2 holds for published values: 16 digits in all, or more than 6 after the point, cannot be published
    { name: "published-figure-over-the-limit", T: T0, pins: pubPins, select: ["C-SFC-5"], declarations: [
      sign(complete("over-limit.example", { "energy-consumption": 123456789012345.123456, "scope-3": 1000000000.000001, "carbon-footprint": 1000000000 })),
    ] },
    // a wrong-typed optional extension member is read as absent and reported as INFO (8.1), with or without a ledger
    { name: "wrong-typed-optional-members", T: T0, pins: pubPins, select: ["S6.a"], declarations: [
      sign(plain("mistyped-plain.example", { "carbon-neutrality": { "offsets-retired-tCO2e": "12" }, "hardware-lifecycle": { "expected-service-life-years": "5" } })),
      sign(complete("mistyped-ledger.example", {}, { "network-topology": { "nakamoto-coefficient": 1.5 }, "carbon-neutrality": { "offset-registry-uri": 7 } })),
    ] },
    // a network-topology value with members of both levels (8.4): FAIL with ledger-evidence-2, INFO without
    { name: "mixed-topology-levels-with-and-without-ledger-evidence", T: T0, pins: pubPins, select: ["S6.a"], declarations: [
      sign(complete("mixed-ledger.example", {}, { "network-topology": { "member-of-network": "ledger.example" } })),
      sign(plain("mixed-plain.example", { "network-topology": { "member-of-network": "ledger.example" } })),
    ] },
  ] };
}
