/** v19 to v23: the evaluation window, selection, derivation order, calendar-year offsets, wrong network. */
import { World, retirement } from "../build/world.mjs";
import { EXT } from "../../lib/declaration.mjs";
import { monthBound, addMonths, addDays } from "../../lib/time.mjs";
import { primaryObject, signDeclaration } from "../build/declare.mjs";
import { T0, PARAMS, scenario, baseNetwork, ctxOf } from "./base.mjs";
import { yearSpec, pubPins } from "./c01-basic.mjs";
import { stub, sign } from "./stubs.mjs";

const WIN = ["D1", "C-SFC-1", "C-SFC-2", "C-SFC-3", "C-SFC-4", "C-SFC-6"];

export function v19() {
  const empty = new World({ readAt: T0 });
  // a young network: every operator becomes active in January 2026
  const young = baseNetwork({ from: "2026-01-01T00:00:00Z", skip: (j, i) => i < 12 });
  // explicit T after read-at, with a partial sum over CAP
  const big = baseNetwork({ count: 14, tweak: (f) => ({ ...f, kWh: 200000 }), readAt: "2026-03-20T00:00:00Z" });
  // a fully covered window with one energy month silent
  const silent = baseNetwork({ skip: (j, i, t) => j === 1 && i === 8 && t === "EnergyAttested" });
  const plain = baseNetwork();
  const pubOf = (period, figure, unit) => ({ ...PARAMS, platform: { "hot-path": "Example public chain", access: "public", mechanism: "proof-of-stake", assessment: { publisher: "Example Assessor", uri: "https://assessor.example/report", period, figure, unit, method: "synthetic" } } });
  const exact = { start: "2023-11-02T00:10:00Z", end: "2024-11-02T00:10:00Z" }, late = { start: "2023-11-02T00:09:59Z", end: "2024-11-02T00:09:59Z" };
  return { id: "v19-window", scenarios: [
    scenario("empty-registry", empty, { select: WIN }),
    scenario("young-network", young.w, { select: WIN }),
    scenario("explicit-T-after-read-at", big.w, { select: WIN }),
    scenario("stale-read", plain.w, { T: null, now: "2026-06-10T00:00:00Z", select: WIN }),
    scenario("read-after-the-clock-plus-skew", plain.w, { T: null, now: "2026-05-01T00:00:00Z", select: WIN }),
    scenario("read-within-age", plain.w, { T: null, now: "2026-05-02T01:00:00Z", select: WIN }),
    scenario("permissioned-covered-window-silent-energy", silent.w, { select: ["C-SFC-2", "C-SFC-6"] }),
    scenario("public-assessment-ended-exactly-18-months-before-T", plain.w, { parameters: pubOf(exact, 0.4, "GWh"), select: ["C-SFC-6"] }),
    scenario("public-assessment-ended-one-second-earlier", plain.w, { parameters: pubOf(late, 0.4, "GWh"), select: ["C-SFC-6"] }),
  ] };
}

const net = (target, top, extra = {}) => sign(stub(target, { entries: [], evidence: false, top: { "energy-unit": "MWh", ...top }, ...extra }));
const year = (y, off = "Z") => ({ start: `${y}-01-01T00:00:00${off}`, end: `${y + 1}-01-01T00:00:00${off}` });

export function v20() {
  const sel = ["S4", "C-SFC-2"];
  const mk = (name, objs) => ({ name, T: T0, network: "net.example", pins: pubPins, declarations: objs.map(sign), select: sel });
  const o = (y, extra = {}) => stub("net.example", { entries: [], evidence: false, top: { period: year(y), "energy-consumption": 500 + y - 2000, "scope-2": 1, "scope-3": 1, "carbon-footprint": 2, ...extra } });
  // a host `target` is compared after ASCII lower-casing (3.5, Appendix D): S4 selection and 7.3 pairing both find it
  const upper = (extra = {}) => ({ ...o(2025, extra), target: "Net.Example" });
  return { id: "v20-selection", scenarios: [
    mk("years-2024-and-2025", [o(2024), o(2025)]),
    mk("a-year-ending-after-T", [o(2025), o(2026)]),
    mk("two-2025-objects-none-market-based", [o(2025, { "carbon-accounting": "location-based" }), o(2025, { "carbon-accounting": "location-based", "scope-2": 2, "carbon-footprint": 3 })]),
    mk("a-sub-annual-period-is-excluded", [o(2025), { ...o(2025), period: { start: "2025-01-01T00:00:00Z", end: "2025-07-01T00:00:00Z" } }]),
    mk("upper-case-target-matches-host", [upper()]),
    { ...mk("mixed-case-target-pairs-the-location-object", [upper(), o(2025, { "carbon-accounting": "location-based", "scope-2": 2, "carbon-footprint": 3 })]), select: [...sel, "PAIR", "S6.i"] },
    { ...mk("target-differs-from-retrieval-host", [o(2025)]), retrievalUri: "https://other.example/.well-known/sustainability-data" },
  ] };
}

export function v21() {
  const JAN = monthBound(2026, 1), FEB = monthBound(2026, 2);
  const mk = (build) => { const w = new World({ readAt: T0 }); const a = w.operator("a", { from: "2025-11-01T00:00:00Z" }); build(w, a); return w; };
  const spec = (cutoff = "2026-04-15T00:00:00Z") => ({ period: { start: JAN, end: addMonths(FEB, 1) }, cutoff, level: "network", energyUnit: "kWh", carbonUnit: "kgCO2e", consensus: "proof-of-authority" });
  const zero = mk((w, a) => { for (const m of [JAN, FEB]) { w.energy(a, m, { kWh: 100 }); w.carbon(a, m, { s2: 0, s3: 0, retirements: [] }); } });
  const partial = mk((w, a) => { w.energy(a, JAN, { kWh: 100 }); w.carbon(a, JAN, { s2: 100, s3: 100, retirements: [retirement("RET-21-1", 1000, { at: addDays(addMonths(JAN, 1), 1) })] }); w.energy(a, FEB, { kWh: 100 }); });
  const none = mk((w, a) => { w.energy(a, JAN, { kWh: 100 }); w.carbon(a, JAN, { s2: 100, s3: 100, retirements: [] }); w.energy(a, FEB, { kWh: 100 }); });
  const zeroOp = zero;
  const zctx = ctxOf(zero);
  const opSpec = { ...spec(), level: "operator", operator: "did:web:op-a.example", updated: "2026-04-15T00:00:00Z", target: "node.op-a.example", period: { start: JAN, end: FEB }, hardware: false };
  const zeroDecl = signDeclaration(primaryObject(zctx, opSpec).obj);
  const ng = (target, top) => sign(stub(target, { entries: [], evidence: false, top: { "energy-consumption": 1, "scope-2": 0, "scope-3": 0, ...top }, status: top.status ?? "achieved" }));
  const noLedger = [
    ng("zero-explicit.example", { "carbon-footprint": 0, "carbon-unit": "tCO2e" }),
    ng("zero-footprint-offsets-absent.example", { "carbon-footprint": 0 }),
    ng("covered.example", { "scope-2": 3, "scope-3": 2, "carbon-footprint": 5 }),
    ng("partly-covered.example", { "scope-2": 3, "scope-3": 2, "carbon-footprint": 5 }),
    ng("not-covered.example", { "scope-2": 3, "scope-3": 2, "carbon-footprint": 5 }),
    ng("no-footprint.example", {}),
    ng("mislabelled.example", { "scope-2": 3, "scope-3": 2, "carbon-footprint": 5 }),
  ];
  const withOffsets = (o, v, status) => { const x = JSON.parse(JSON.stringify(o)); delete x.signed; const k = `${EXT}carbon-neutrality`; x.extensions[k]["net-zero-status"] = status; if (v !== undefined) x.extensions[k]["offsets-retired-tCO2e"] = v; return sign(x); };
  const nl = noLedger.map((o) => { const { signed, ...r } = o; return r; });
  const decls = [
    withOffsets(nl[0], 0, "achieved"), withOffsets(nl[1], undefined, "achieved"), withOffsets(nl[2], 5, "achieved"),
    withOffsets(nl[3], 3, "partial"), withOffsets(nl[4], undefined, "not-achieved"), (() => { const x = { ...nl[5] }; delete x["carbon-footprint"]; delete x["scope-2"]; delete x["scope-3"]; return withOffsets(x, 1, "partial"); })(),
    withOffsets(nl[6], 5, "partial"),
  ];
  return { id: "v21-net-zero-order", scenarios: [
    scenario("all-zero-emissions-and-offsets", zero, { declarations: [zeroDecl], pins: pubPins, select: ["C-SFC-7", "D6", "S6.f"], derive: [spec(), opSpec] }),
    scenario("silent-carbon-month-with-offsets", partial, { select: ["D1"], derive: [spec()] }),
    scenario("silent-carbon-month-without-offsets", none, { select: ["D1"], derive: [spec()] }),
    { name: "no-ledger-derivation", T: T0, pins: pubPins, select: ["S6.f"], declarations: decls },
  ] };
}

export function v22() {
  const off = "+02:00";
  const mk = (name, energy, target) => ({ name, T: T0, network: target, pins: pubPins, select: ["S4", "C-SFC-2", "C-SFC-5"], declarations: [sign(stub(target, { entries: [], evidence: false, top: { period: year(2025, off), "energy-consumption": energy, "energy-unit": "MWh", "scope-2": 1, "scope-3": 1, "carbon-footprint": 2 } }))] });
  const base = baseNetwork({ count: 15 });
  const ctx = ctxOf(base.w);
  const { obj } = primaryObject(ctx, yearSpec());
  const shifted = { ...obj, period: year(2025, off) };
  return { id: "v22-period-offset", scenarios: [
    mk("offset-year-below-cap", 900, "below.example"),
    mk("offset-year-above-cap", 1100, "above.example"),
    scenario("offset-year-with-ledger-evidence", base.w, { declarations: [sign(shifted)], pins: pubPins, select: ["S4", "C-SFC-2", "C-SFC-5", "C-SFC-7"] }),
    // month-bound periods that are neither one month nor one calendar year are not walked: NOT-EVALUABLE, whatever their length
    ...[["period-of-9999-years", "0001-01-01T00:00:00Z", "9999-01-01T00:00:00Z"], ["period-of-two-years", "2024-01-01T00:00:00Z", "2026-01-01T00:00:00Z"], ["period-of-thirteen-months", "2025-01-01T00:00:00Z", "2026-02-01T00:00:00Z"]]
      .map(([name, start, end]) => scenario(`${name}-with-ledger-evidence`, base.w, { declarations: [sign({ ...obj, period: { start, end } })], pins: pubPins, select: ["C-SFC-4", "C-SFC-7", "D2", "D7", "VERDICT"] })),
  ] };
}

export function v23() {
  const w = new World({ readAt: T0 });
  const a = w.operator("a", { from: "2025-11-01T00:00:00Z" });
  const b = w.operator("b", { from: "2025-11-01T00:00:00Z" });
  const JAN = monthBound(2026, 1), FEB = monthBound(2026, 2);
  w.energy(a, JAN, { kWh: 1000 });
  w.energy(b, JAN, { kWh: 1000 }, { network: "other-ledger.example" });    // replayed from another network: L1
  w.energy(a, FEB, { kWh: 1000 }, { actor: b });                            // subject and actor differ: L1
  return { id: "v23-wrong-network", scenarios: [scenario("replayed-event", w, { select: ["D3", "D5"], effectiveAt: T0 })] };
}
