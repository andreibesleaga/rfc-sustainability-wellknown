/** v07 to v12: silent months, fork, signatures, retirements, flag. */
import { World, retirement, REGISTRY } from "../build/world.mjs";
import { KEY2, b64u } from "../build/keys.mjs";
import { unb64u } from "../../lib/canonical.mjs";
import { monthBound, addMonths, addDays, addSeconds } from "../../lib/time.mjs";
import { primaryObject, locationObject, signDeclaration } from "../build/declare.mjs";
import { T0, PARAMS, PINS, SERIALS, scenario, baseNetwork, ctxOf } from "./base.mjs";
import { yearSpec, pubPins } from "./c01-basic.mjs";

const sign = (o) => signDeclaration(o);

export function v07() {
  const year = yearSpec();
  // a silent CarbonAttested month: the primary omits what the silent type feeds; a location object next to it is not applicable
  const carbonSilent = baseNetwork({ skip: (j, i, t) => j === 2 && i === 6 && t === "CarbonAttested" });
  const cs = ctxOf(carbonSilent.w);
  const csPrimary = primaryObject(cs, year).obj;
  const full = baseNetwork();
  const fullCtx = ctxOf(full.w);
  const fullPrimary = primaryObject(fullCtx, year).obj;
  const strayLocation = locationObject(fullPrimary, fullCtx, year);
  const forced = primaryObject(fullCtx, year).obj; // complete members, offered for the silent ledger: C-SFC-7 and S6 must refuse
  // a month with no active operator (all operators start in February); entry flags are all true
  const noOp = baseNetwork({ from: "2025-02-01T00:00:00Z", skip: (j, i) => i === 0 });
  const noOpCtx = ctxOf(noOp.w);
  const noOpPrimary = primaryObject(noOpCtx, year).obj;
  const noOpClaimsCoverage = JSON.parse(JSON.stringify(noOpPrimary));
  noOpClaimsCoverage.extensions["https://andreibesleaga.com/sfc/extensions/ledger-evidence-2"]["network-offset-coverage"] = true;
  noOpClaimsCoverage.extensions["https://andreibesleaga.com/sfc/extensions/carbon-neutrality"]["net-zero-status"] = "achieved";
  // an energy-silent month only: energy members and the intensity are omitted, carbon stays, the location object follows
  const energySilent = baseNetwork({ skip: (j, i, t) => j === 1 && i === 3 && t === "EnergyAttested" });
  const esCtx = ctxOf(energySilent.w);
  const esPrimary = primaryObject(esCtx, year).obj;
  const esLocation = locationObject(esPrimary, esCtx, year);
  // an operator declaration with every month silent: needs disclosure-uri or verifiable-attestation-uri
  const w = baseNetwork({ count: 14 });
  const opCtx = ctxOf(w.w);
  const opSpec = { period: { start: "2026-03-01T00:00:00Z", end: "2026-04-01T00:00:00Z" }, cutoff: "2026-04-15T00:00:00Z", level: "operator", operator: "did:web:op-a.example", updated: "2026-04-15T00:00:00Z", target: "node.op-a.example", extras: { "measurement-method": "hardware-metered" } };
  const opWith = primaryObject(opCtx, { ...opSpec, hardware: false }).obj;
  const opWithout = primaryObject(opCtx, { ...opSpec, hardware: false, disclosure: false }).obj;
  const d1 = { ...opWith }; // keeps disclosure-uri
  return { id: "v07-silent", scenarios: [
    scenario("carbon-silent-month-with-stray-location-object", carbonSilent.w, { declarations: [sign(csPrimary), sign(strayLocation)], pins: pubPins, select: ["PAIR", "VERDICT", "C-SFC-5", "S6", "C-SFC-7", "D4.declared", "C-SFC-2"], derive: [year] }),
    scenario("silent-ledger-complete-object-offered", carbonSilent.w, { declarations: [sign(forced)], pins: pubPins, select: ["VERDICT", "C-SFC-7"] }),
    scenario("month-with-no-operator", noOp.w, { declarations: [sign(noOpClaimsCoverage)], pins: pubPins, select: ["VERDICT", "S6.e", "S6.f", "C-SFC-5", "C-SFC-7"] }),
    scenario("month-with-no-operator-honest", noOp.w, { declarations: [sign(noOpPrimary)], pins: pubPins, select: ["VERDICT", "C-SFC-5", "C-SFC-7"], derive: [year] }),
    scenario("energy-silent-month", energySilent.w, { declarations: [sign(esPrimary), sign(esLocation)], pins: pubPins, select: ["PAIR", "VERDICT", "C-SFC-5", "S6", "C-SFC-7"], derive: [year] }),
    scenario("operator-all-months-silent-with-disclosure-uri", w.w, { declarations: [sign(d1)], pins: pubPins, select: ["VERDICT", "C-SFC-5", "S6", "C-SFC-7", "D2"], derive: [opSpec] }),
    scenario("operator-all-months-silent-without-disclosure-uri", w.w, { declarations: [sign(opWithout)], pins: pubPins, select: ["VERDICT", "C-SFC-5", "C-SFC-7"] }),
    scenario("location-object-without-primary", full.w, { declarations: [sign(strayLocation)], pins: pubPins, select: ["PAIR", "S2", "S3", "C-SFC-5"] }),
  ] };
}

const DEC = monthBound(2025, 12), JAN = monthBound(2026, 1), FEB = monthBound(2026, 2);
const SEL = ["D3", "D4", "D5"];
const at = (m, d = 1) => addDays(addMonths(m, 1), d);
const SERIAL_REG = SERIALS;

function smallWorld(names = ["a", "b", "c"], from = "2025-11-01T00:00:00Z") {
  const w = new World({ readAt: T0 });
  const ops = names.map((n) => w.operator(n, { from }));
  return { w, ops };
}

export function v08() {
  const { w, ops } = smallWorld(["a", "b", "c", "d", "e"]);
  const [a, b, c, d, e] = ops;
  // a: the third event repeats the second's prev (shared non-null prev)
  const a1 = w.energy(a, DEC, { kWh: 20000 });
  w.energy(a, JAN, { kWh: 20100 });
  w.energy(a, FEB, { kWh: 20200 }, { prev: a1 });
  // b: a second chain start (prev null again)
  w.energy(b, DEC, { kWh: 18000 });
  w.energy(b, JAN, { kWh: 18100 }, { prev: null });
  // c: first events of different chains share prev null: no fork
  w.energy(c, DEC, { kWh: 17000 });
  w.carbon(c, DEC, { s2: 300, s3: 200, retirements: [retirement("RET-C-1", 1000, { at: at(DEC) })] });
  // d, e: takeovers. Old ledger chains (events of another network).
  const old = new World({ network: "old-ledger.example", readAt: T0 });
  const od = old.operator("d", { from: "2025-01-01T00:00:00Z", did: d });
  const oe = old.operator("e", { from: "2025-01-01T00:00:00Z", did: e });
  const nov = monthBound(2025, 11), oct = monthBound(2025, 10);
  old.energy(d, oct, { kWh: 100 }); const dTip = old.energy(d, nov, { kWh: 110 });
  old.energy(e, oct, { kWh: 100 }); const eTip = old.energy(e, nov, { kWh: 110 }); old.energy(e, DEC, { kWh: 120 });
  const oldChain = (op) => old.events.filter((x) => x.event.subject === op).map((x) => x.event);
  w.energy(d, DEC, { kWh: 19000 }, { prev: dTip });
  w.energy(e, DEC, { kWh: 19000 }, { prev: eTip });
  const params = { ...PARAMS, takeovers: [{ operator: d, type: "EnergyAttested", ledger: "old-ledger.example", tip: dTip }, { operator: e, type: "EnergyAttested", ledger: "old-ledger.example", tip: eTip }] };
  const old2 = [{ operator: d, type: "EnergyAttested", chain: oldChain(d) }, { operator: e, type: "EnergyAttested", chain: oldChain(e) }];
  return { id: "v08-fork", scenarios: [
    scenario("forks-and-shared-null-starts", w, { parameters: params, oldLedgers: old2, select: SEL }),
    scenario("takeover-methodology-not-pinned", w, { parameters: params, pins: { ...PINS, methodology: false }, select: ["D4", "D5"] }),
    scenario("takeover-old-ledger-unreachable", w, { parameters: params, select: ["D4.chain"] }),
  ] };
}

export function v09() {
  const { w, ops } = smallWorld(["a", "b"]);
  const [a, b] = ops;
  w.energy(a, DEC, { kWh: 20000 });
  w.energy(a, JAN, { kWh: 20100 }, { key: KEY2 });                      // signed by a key the Registry does not hold
  const h = w.energy(a, FEB, { kWh: 20200 });
  w.tamper(h, (e) => { e.payload.kWhConsumed = 99999; });               // altered after signing
  w.energy(b, DEC, { kWh: 18000 });
  const b2 = w.energy(b, JAN, { kWh: 18100 }, { sigTransform: (s) => ({ ...s, alg: "ES256" }) }); // another sig.alg
  const x = w.events.find((e) => e.hash === b2); x.hash = "f".repeat(64); // the ledger's hash field does not match the event
  return { id: "v09-bad-signature", scenarios: [scenario("failing-signatures", w, { select: ["D3"], effectiveAt: T0 })] };
}

const L = 2n ** 252n + 27742317777372353535851937790883648493n;
export function v16() {
  const { w, ops } = smallWorld(["a"]);
  const [a] = ops;
  w.energy(a, DEC, { kWh: 20000 });
  w.energy(a, JAN, { kWh: 20100 }, { sigTransform: (s) => { // non-zero trailing bits: same bytes, not the canonical encoding
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const last = alphabet.indexOf(s.value[85]);
    return { ...s, value: s.value.slice(0, 85) + alphabet[last + 1] };
  } });
  w.energy(a, FEB, { kWh: 20200 }, { sigTransform: (s) => { // S + L: the equation still holds, S is not below the group order
    const bytes = unb64u(s.value);
    let S = 0n; for (let i = 63; i >= 32; i--) S = (S << 8n) | BigInt(bytes[i]);
    S += L;
    const out = Buffer.from(bytes);
    for (let i = 32; i < 64; i++) { out[i] = Number(S & 0xffn); S >>= 8n; }
    return { ...s, value: b64u(out) };
  } });
  w.energy(a, monthBound(2026, 3), { kWh: 20300 });
  return { id: "v16-noncanonical-signature", scenarios: [scenario("encoding", w, { select: ["D3"] })] };
}

/** Two operators cite one retirement with moments that differ only in the fraction: L9 compares moments, fractions included. */
function fractionalMoments(retiredAt) {
  const { w, ops } = smallWorld(["a", "b"]);
  const body = (at) => ({ s2: 300, s3: 200, retirements: [retirement("RET-F", 1000, { tonnes: 10, at })] });
  w.carbon(ops[0], DEC, body(retiredAt[0]), { commit: addSeconds(addMonths(DEC, 1), 86400) });
  w.carbon(ops[1], DEC, body(retiredAt[1]), { commit: addSeconds(addMonths(DEC, 1), 2 * 86400) });
  return w;
}

export function v10() {
  const mk = (order) => {
    const { w, ops } = smallWorld(["a", "b", "c"]);
    const [a, b, c] = ops;
    const t = (m, hour) => addSeconds(addMonths(m, 1), 3 * 86400 + hour * 3600);
    const MAR = monthBound(2026, 3);
    const body = (ret) => ({ s2: 300, s3: 200, retirements: [ret] });
    const range = (ref, tonnes, kg) => retirement(ref, kg, { tonnes, at: at(FEB), registry: SERIAL_REG });
    // operator a: one tonne cited twice (L9); the same serial range as b, which is allowed; a leading zero (L8b)
    w.carbon(a, DEC, body(retirement("RET-1", 1000, { at: at(DEC) })), { commit: t(DEC, 1) });
    w.carbon(a, JAN, body(retirement("RET-1", 1000, { at: at(DEC) })), { commit: t(JAN, 1) });
    w.carbon(a, FEB, body(range("1000-1999", 1000, 100)), { commit: t(FEB, 2) });
    w.carbon(a, MAR, body(range("0100-0199", 100, 900)), { commit: t(MAR, 1) });
    // operator b: a registry written with a trailing slash (L8b); RET-2 and a serial range
    w.carbon(b, DEC, body(retirement("RET-9", 1000, { at: at(DEC), registry: `${REGISTRY}/` })), { commit: t(DEC, 2) });
    w.carbon(b, JAN, body(retirement("RET-2", 600, { at: at(JAN) })), { commit: t(JAN, order === "b-first" ? 2 : 3) });
    w.carbon(b, FEB, body(range("1000-1999", 1000, 800)), { commit: t(FEB, 1) });
    // operator c: a reference not in upper case (L8b); RET-2 again (L9 for whoever commits second); an overlapping range (L9)
    w.carbon(c, DEC, body(retirement("ret-3", 1000, { at: at(DEC) })), { commit: t(DEC, 3) });
    w.carbon(c, JAN, body(retirement("RET-2", 600, { at: at(JAN) })), { commit: t(JAN, order === "b-first" ? 3 : 2) });
    w.carbon(c, FEB, body(range("1500-2500", 1001, 900)), { commit: t(FEB, 3) });
    return w;
  };
  return { id: "v10-duplicate-retirement", scenarios: [
    scenario("b-commits-first", mk("b-first"), { select: ["D3", "D5"], effectiveAt: T0 }),
    scenario("c-commits-first", mk("c-first"), { select: ["D5"] }),
    scenario("fraction-differs", fractionalMoments(["2025-12-02T00:00:00.5Z", "2025-12-02T00:00:00.25Z"]), { select: ["D5"], effectiveAt: T0 }),
    scenario("fraction-equal", fractionalMoments(["2025-12-02T00:00:00.5Z", "2025-12-02T00:00:00.50Z"]), { select: ["D5"], effectiveAt: T0 }),
    scenario("fraction-differs-at-tenth-digit", fractionalMoments(["2025-12-02T00:00:00.5000000001Z", "2025-12-02T00:00:00.5Z"]), { select: ["D5"], effectiveAt: T0 }),
  ] };
}

export function v11() {
  const { w, ops } = smallWorld(["a", "b", "c", "d"]);
  const [a, b, c, d] = ops;
  const due = addDays(addMonths(DEC, 1), 5);
  const f = (ret) => ({ s2: 300, s3: 200, retirements: [ret] });
  w.carbon(a, DEC, f(retirement("RET-L1", 1000, { at: addSeconds(due, 1) })));                                  // one second after the due instant: L10
  w.carbon(b, DEC, f(retirement("RET-L2", 1000, { at: addDays(addMonths(DEC, 1), 3) })), { commit: addDays(addMonths(DEC, 1), 1) }); // after the commit instant, before the due instant: L10
  w.carbon(c, DEC, f(retirement("RET-L3", 1000, { at: due })), { commit: addSeconds(due, 3600) });              // exactly at the due instant, committed after it: allowed
  w.carbon(d, DEC, f(retirement("RET-L4", 1000, { at: "2025-06-30T12:00:00Z" })));                              // long before the month: allowed, no lower bound
  return { id: "v11-late-retirement", scenarios: [scenario("retired-at", w, { select: ["D5"] })] };
}

export function v12() {
  const { w, ops } = smallWorld(["a"]);
  const [a] = ops;
  const ret = (n, m, kg) => [retirement(`RET-F${n}`, kg, { at: at(m) })];
  w.carbon(a, DEC, { s2: 300, s3: 200, retirements: ret(1, DEC, 1000), netZero: false });            // covered, flag says no: L7
  w.carbon(a, JAN, { s2: 600, s3: 500, retirements: ret(2, JAN, 1000), netZero: true });              // not covered, flag says yes: L7
  w.carbon(a, FEB, { s1: 100.5, s2: 600, s3: 299.5, retirements: ret(3, FEB, 1000) });                // exactly equal: covered, true is right
  w.carbon(a, monthBound(2026, 3), { s2: 600, s3: 400.000001, retirements: ret(4, monthBound(2026, 3), 1000) }); // one microgram over: false is right
  return { id: "v12-wrong-flag", scenarios: [scenario("flags", w, { select: ["D5"], effectiveAt: T0 })] };
}
