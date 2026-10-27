/** v01 to v06: canonical bytes, hash and signature, effective selection, sums, two objects. */
import { World, retirement } from "../build/world.mjs";
import { KEY1, jwkOf } from "../build/keys.mjs";
import { monthBound, addMonths, addDays } from "../../lib/time.mjs";
import { primaryObject, locationObject, signDeclaration } from "../build/declare.mjs";
import { T0, UPDATED, PINS, scenario, baseNetwork, monthIndex, NETWORK_HOST, ctxOf } from "./base.mjs";

const YEAR = { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };
export const yearSpec = (extra = {}) => ({ period: YEAR, cutoff: UPDATED, level: "network", energyUnit: "MWh", carbonUnit: "tCO2e", consensus: "proof-of-authority", updated: UPDATED, target: NETWORK_HOST, renewable: 82, ...extra });
export const pubPins = { ...PINS, publisherKeys: [jwkOf(KEY1)], operatorKeys: [jwkOf(KEY1)] };

export function v01() {
  const values = [
    { peach: "This sorting order", "péché": "is wrong according to French", "pêche": "but canonicalization MUST", sin: "Imagine in addition to the above" },
    { "": "private use", "😀": "emoji sorts before U+E000 in UTF-16 code unit order", "é": "e acute", "e": "e" },
    { b: [1, 2, { z: null, a: true }], a: "Zürich ☃ \"quoted\" back\\slash\n\u0001\u001f", c: false },
    { numbers: [12.5, 100, 0.000001, 123456789.123456, 0.1, 1e21, 333333333.33333329, -0, 4.5e-7, 1e-7, 5, 0] },
    [],
    {},
  ];
  return { id: "v01-canonical", scenarios: [{ name: "rfc8785-shapes", fn: "canonical", values }] };
}

export function v02() {
  const { w, ops } = baseNetwork({ count: 1 });
  const event = w.events[0].event;
  const rfc = [
    { pub: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", msg: "", sig: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b" },
    { pub: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", msg: "72", sig: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00" },
    { pub: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", msg: "00", sig: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b" },
  ];
  return { id: "v02-hash", scenarios: [
    { name: "event", fn: "eventHash", event, pub: KEY1.pub },
    { name: "rfc8032-section-7.1", fn: "ed25519", cases: rfc },
  ] };
}

export function v03() {
  const w = new World({ readAt: T0 });
  const a = w.operator("a", { from: "2025-11-01T00:00:00Z" });
  const b = w.operator("b", { from: "2025-11-01T00:00:00Z" });
  const jan = monthBound(2026, 1), feb = monthBound(2026, 2), dec = monthBound(2025, 12);
  const ret = (n, m) => retirement(`RET-${n}`, 1000, { at: addDays(addMonths(m, 1), 1) });
  w.energy(a, dec, { kWh: 20000 });
  const e1 = w.energy(a, jan, { kWh: 21000 });
  const e2 = w.energy(a, jan, { kWh: 21500.5 }, { supersedes: e1, commit: "2026-02-04T09:00:00Z" });         // a correction
  w.energy(a, feb, { kWh: 19000 }, { prev: "0".repeat(64), commit: "2026-03-03T09:00:00Z" });                  // L4: wrong prev, skipped, stays in the chain
  w.energy(a, feb, { kWh: 19250 }, { commit: "2026-03-03T10:00:00Z" });                                         // chains to the skipped event's hash; L6 holds, effective
  const c1 = w.carbon(a, jan, { s2: 300, s3: 200, retirements: [ret("A1", jan)] });
  w.carbon(a, jan, { s2: 310, s3: 200, retirements: [ret("A1", jan)] }, { commit: "2026-02-05T09:00:00Z" });   // L6: no supersedes while c1 is effective, skipped
  w.energy(b, jan, { kWh: 18000 });
  return { id: "v03-effective", scenarios: [scenario("correction-and-skips", w, { select: ["D3", "D4.chain", "D5"], effectiveAt: T0 })] };
}

const D = (period, level = "network", extra = {}) => ({ period, cutoff: UPDATED, level, energyUnit: "MWh", carbonUnit: "tCO2e", consensus: "proof-of-authority", ...extra });

export function v04() {
  const { w } = baseNetwork({ count: 15 });
  const period = { start: "2025-01-01T00:00:00Z", end: "2025-02-01T00:00:00Z" };
  return { id: "v04-sums-month", scenarios: [scenario("january-2025", w, { select: ["D4.chain"], derive: [D(period, "network", { energyUnit: "kWh", carbonUnit: "kgCO2e" }), D(period, "network", {})], effectiveAt: UPDATED })] };
}

/** The two objects of the year-2025 example and the one-operator, one-month example, signed with the test key. */
export function exampleDocuments() {
  const { w } = baseNetwork({ count: 15 });
  const ctx = ctxOf(w);
  const year = yearSpec();
  const { obj: primary } = primaryObject(ctx, year);
  const location = locationObject(primary, ctx, year);
  const upd = "2025-02-10T09:00:00Z";
  const opSpec = { period: { start: "2025-01-01T00:00:00Z", end: "2025-02-01T00:00:00Z" }, cutoff: upd, level: "operator", operator: "did:web:op-a.example", updated: upd, target: "node.op-a.example", energyUnit: "kWh", carbonUnit: "kgCO2e", renewable: 90 };
  const { obj: operator } = primaryObject(ctx, opSpec);
  return { w, network: [signDeclaration(primary), signDeclaration(location)], operator: signDeclaration(operator), year, opSpec };
}

export function v05() {
  const { w, network: objs, operator, year } = exampleDocuments();
  // an operator whose only events are for the previous year: head set, count 0 (the object is incomplete)
  const w2 = new World({ readAt: T0 });
  const a = w2.operator("a", { from: "2024-10-01T00:00:00Z" });
  const d = w2.operator("d", { from: "2024-10-01T00:00:00Z" });
  for (const [i, m] of [monthBound(2024, 10), monthBound(2024, 11), monthBound(2024, 12)].entries()) {
    w2.energy(d, m, { kWh: 5000 + i }); w2.carbon(d, m, { s2: 100, s3: 50, retirements: [retirement(`RET-D-${i}`, 1000, { at: addDays(addMonths(m, 1), 1) })] });
  }
  for (let i = 0; i < 12; i++) {
    const m = monthIndex(i);
    w2.energy(a, m, { kWh: 18000 + i }); w2.carbon(a, m, { s2: 300, s3: 200, retirements: [retirement(`RET-A-${i}`, 1000, { at: addDays(addMonths(m, 1), 1) })] });
  }
  return { id: "v05-sums-year", scenarios: [
    scenario("year-2025", w, { declarations: objs, pins: pubPins, select: ["S2", "S3", "S4", "C-SFC-2", "C-SFC-5", "S6", "VERDICT", "C-SFC-7", "D2", "D4.declared"], derive: [year], effectiveAt: UPDATED }),
    // no registrar key and no methodology document pinned: the Registry is the source's word, so no window row reads PASS
    scenario("year-2025-no-registrar-key-pinned", w, { declarations: objs, pins: { publisherKeys: pubPins.publisherKeys, operatorKeys: pubPins.operatorKeys }, select: ["D2.entry", "C-SFC-1", "C-SFC-2", "C-SFC-4", "C-SFC-6", "C-SFC-7"] }),
    scenario("operator-month", w, { declarations: [operator], pins: pubPins, select: ["S2", "S3", "C-SFC-5", "S6", "VERDICT", "C-SFC-7", "D2", "D4.declared"] }),
    scenario("previous-year-events-only", w2, { select: ["D4.chain"], derive: [D({ start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" })], effectiveAt: UPDATED }),
  ] };
}

export function v06() {
  const { w } = baseNetwork({ count: 15 });
  const ctx = ctxOf(w);
  const year = yearSpec();
  const { obj: primary } = primaryObject(ctx, year);
  const location = locationObject(primary, ctx, year);
  // the exact location Scope 2 is 12.51 tCO2e; 12.5 is wrong by 0.01 with k = 6
  const wrongOnly = { ...location, "scope-2": 12.5 };
  const wrongBoth = { ...location, "scope-2": 12.5, "carbon-footprint": +(location["carbon-footprint"] - 0.01).toFixed(6) };
  const mk = (loc) => [signDeclaration(primary), signDeclaration(loc)];
  return { id: "v06-two-objects", scenarios: [
    scenario("exact", w, { declarations: mk(location), pins: pubPins, select: ["S6.i", "C-SFC-5", "C-SFC-7"] }),
    scenario("scope-2-12.5-footprint-exact", w, { declarations: mk(wrongOnly), pins: pubPins, select: ["S6.i", "C-SFC-7"] }),
    scenario("scope-2-12.5-footprint-consistent", w, { declarations: mk(wrongBoth), pins: pubPins, select: ["S6.i", "C-SFC-7"] }),
  ] };
}
