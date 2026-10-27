/** v15, v18, v24: profile 1.x events and Registry entries read by a 2.0 verifier. */
import { World, retirement } from "../build/world.mjs";
import { KEY1, jwkOf } from "../build/keys.mjs";
import { hashOf } from "../../lib/canonical.mjs";
import { monthBound, addMonths, addDays, addSeconds, isInstant } from "../../lib/time.mjs";
import { EXT } from "../../lib/declaration.mjs";
import { signDeclaration, primaryObject } from "../build/declare.mjs";
import { T0, PARAMS, scenario, ctxOf } from "./base.mjs";
import { pubPins } from "./c01-basic.mjs";

export const DEC = monthBound(2025, 12), JAN = monthBound(2026, 1), FEB = monthBound(2026, 2), MAR = monthBound(2026, 3);
const dateOf = (m) => m.slice(0, 10);
const lastDay = (m) => addDays(addMonths(m, 1), -1).slice(0, 10);
const t = (m, h) => addSeconds(addMonths(m, 1), 2 * 86400 + h * 3600);

/** A 1.x event; `o.omit` names payload members to leave out (a 1.2 figure member that is absent). */
export function ev1x(w, op, type, from, to, fields, commit, { omit = [], ...o } = {}) {
  const payload = type === "EnergyAttested"
    ? { nodeCount: 3, kWhConsumed: 1000, measurementMethod: "hardware-metered", evidenceCid: "bafy-example-energy", ...fields }
    : { scope2KgCO2e: 300, scope3KgCO2e: 200, gridIntensityRef: "Electricity Maps zone XX, 2025", offsetsKgCO2e: 1000, netZero: true, evidenceCid: "bafy-example-carbon", ...fields };
  for (const k of omit) delete payload[k];
  const day = `${to}T00:00:00Z`;
  const ts = o.ts ?? (isInstant(day) ? addSeconds(addDays(day, 1), 3600) : "2026-04-01T00:00:00Z");
  return w.emit1x(op, type, from, to, payload, { commit, ts, ...o });
}
const month1x = (w, op, type, m, fields, hour = 1, o) => ev1x(w, op, type, dateOf(m), lastDay(m), fields, t(m, hour), o);

export function v15() {
  const w = new World({ readAt: T0 });
  const from = "2025-11-01";
  const a = w.operator("a", { from: "2025-11-01T00:00:00Z", extra: { profile2From: FEB } });
  const x1 = w.entry1x("x1", { active: [{ from, to: null }] }), x2 = w.entry1x("x2", { active: [{ from, to: null }] });
  const x3 = w.entry1x("x3", { active: [{ from, to: null }] }), x4 = w.entry1x("x4", { active: [{ from, to: null }] });
  const x5 = w.entry1x("x5", { active: [{ from, to: null }] });
  const x6 = w.entry1x("x6", { active: [{ from, to: null }] });
  // a: a valid mixed chain, 1.x events and then the 2.0 adoption event
  month1x(w, a, "EnergyAttested", DEC, { kWhConsumed: 2000 }, 1); month1x(w, a, "EnergyAttested", JAN, { kWhConsumed: 2100 }, 1);
  w.energy(a, FEB, { kWh: 2200 });
  month1x(w, a, "CarbonAttested", DEC, {}, 2); month1x(w, a, "CarbonAttested", JAN, {}, 2);
  w.carbon(a, FEB, { s2: 300, s3: 200, retirements: [retirement("RET-15-A", 1000, { at: addDays(addMonths(FEB, 1), 1) })] });
  // x1: Scope 2 basis. December on the location basis, January with no stated basis, February market-based
  for (const m of [DEC, JAN, FEB]) month1x(w, x1, "EnergyAttested", m, { kWhConsumed: 1500 }, 3);
  month1x(w, x1, "CarbonAttested", DEC, { scope2Method: "location-based" }, 4);
  month1x(w, x1, "CarbonAttested", JAN, {}, 4);
  month1x(w, x1, "CarbonAttested", FEB, { scope2Method: "market-based" }, 4);
  // x2: periods that are not one month
  ev1x(w, x2, "EnergyAttested", "2025-12-10", "2026-01-09", { kWhConsumed: 900 }, t(JAN, 5));
  ev1x(w, x2, "EnergyAttested", "2025-12-01", "2026-02-28", { kWhConsumed: 2700 }, t(FEB, 5));
  ev1x(w, x2, "EnergyAttested", "2026-01-31", "2026-01-01", { kWhConsumed: 10 }, t(FEB, 6));
  ev1x(w, x2, "EnergyAttested", "2026-02-30", "2026-02-31", { kWhConsumed: 10 }, t(MAR, 6));
  month1x(w, x2, "CarbonAttested", FEB, { scope2Method: "market-based" }, 7);
  // x3: a method outside the four values, a negative Scope 3, and an algorithm other than Ed25519
  month1x(w, x3, "EnergyAttested", DEC, { measurementMethod: "modelled-by-hand" }, 8);
  month1x(w, x3, "CarbonAttested", DEC, { scope2Method: "market-based", scope3KgCO2e: -5 }, 9);
  month1x(w, x3, "EnergyAttested", JAN, {}, 8, { sigTransform: (s) => ({ alg: "ES256", value: s.value }) });
  // x4: a duplicate 1.x month without and with `supersedes`
  const d1 = month1x(w, x4, "EnergyAttested", DEC, { kWhConsumed: 1100 }, 10);
  month1x(w, x4, "EnergyAttested", DEC, { kWhConsumed: 1200 }, 11);
  month1x(w, x4, "EnergyAttested", DEC, { kWhConsumed: 1300 }, 12, { supersedes: d1 });
  // x5: 22 events for one month, each superseding the one before
  let prevHash;
  for (let k = 0; k < 22; k++) prevHash = ev1x(w, x5, "EnergyAttested", dateOf(JAN), lastDay(JAN), { kWhConsumed: 3000 + k }, addSeconds(t(JAN, 1), k * 60), k ? { supersedes: prevHash } : {});
  // x6: a 1.2 figure member absent from each event (L8: the event is skipped, never read as 0)
  month1x(w, x6, "EnergyAttested", DEC, {}, 13, { omit: ["nodeCount"] }); month1x(w, x6, "EnergyAttested", JAN, {}, 13, { omit: ["kWhConsumed"] });
  month1x(w, x6, "CarbonAttested", DEC, { scope2Method: "market-based" }, 14, { omit: ["scope2KgCO2e"] }); month1x(w, x6, "CarbonAttested", JAN, { scope2Method: "market-based" }, 14, { omit: ["scope3KgCO2e"] });
  const digests = w.entries.filter((e) => e.network === undefined).map((e) => ({ operator: e.operator, sha256: hashOf(e) }));
  const params = { ...PARAMS, "registry-1x-digests": digests };
  const period = { start: DEC, end: MAR };
  const derive = [{ period, cutoff: T0, level: "network", energyUnit: "kWh", carbonUnit: "kgCO2e", consensus: "proof-of-authority" }];
  const common = { select: ["D2.entry", "D3", "D5", "C-SFC-1", "C-SFC-4"], effectiveAt: T0, derive };
  // two 1.x operators with clean chains, and an operator declaration for p's February: C-SFC-7 names p's counted 1.x event alone (D6), not q's and not p's January
  const w1x = new World({ readAt: T0 });
  const p = w1x.entry1x("p", { active: [{ from, to: null }] }), q = w1x.entry1x("q", { active: [{ from, to: null }] });
  for (const op of [p, q]) for (const m of [JAN, FEB]) { month1x(w1x, op, "EnergyAttested", m, {}, 1); month1x(w1x, op, "CarbonAttested", m, { scope2Method: "market-based" }, 2); }
  const params1x = { ...PARAMS, "registry-1x-digests": w1x.entries.map((e) => ({ operator: e.operator, sha256: hashOf(e) })) };
  const UPD = "2026-04-15T00:00:00Z";
  const pSpec = { period: { start: FEB, end: MAR }, cutoff: UPD, level: "operator", operator: p, updated: UPD, target: "node.op-p.example", energyUnit: "kWh", carbonUnit: "kgCO2e", hardware: false };
  const pDecl = signDeclaration(primaryObject(ctxOf(w1x, { parameters: params1x }), pSpec).obj);
  // a 17-digit 1.x figure is read as the text of its binary64 value
  const w17 = new World({ readAt: T0 });
  const y = w17.entry1x("y", { active: [{ from, to: null }] });
  month1x(w17, y, "EnergyAttested", DEC, { kWhConsumed: 12345678901234567 }, 1);
  month1x(w17, y, "CarbonAttested", DEC, { scope2Method: "market-based" }, 2);
  const d17 = [{ period: { start: DEC, end: JAN }, cutoff: T0, level: "network", energyUnit: "kWh", carbonUnit: "kgCO2e", consensus: "proof-of-authority" }];
  const params17 = { ...PARAMS, "registry-1x-digests": [{ operator: y, sha256: hashOf(w17.entries[0]) }] };
  // declarations
  const legacy = {
    updated: "2025-10-03T09:00:00Z", capabilities: "basic", provider: "SYNTHETIC EXAMPLE, not a real network. Role contact: sustainability@ledger.example.",
    "measurement-method": "hardware-metered", "methodology-uri": "https://ledger.example/sustainability/methodology.md",
    "reporting-period": "2025", target: "ledger.example", "target-type": "service", "energy-consumption": 700, "energy-unit": "MWh", mtCO2e: 12,
    extensions: { [`${EXT}ledger-evidence`]: { "profile-version": "1.2", "hash-algorithm": "sha-256", "event-encoding": "jcs", "period-start": "2025-01-01", "period-end": "2025-12-31", operators: [] } },
  };
  const wire10 = { ...legacy, period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" }, "disclosure-uri": "https://ledger.example/sustainability/disclosures.json" };
  delete wire10["reporting-period"]; delete wire10.mtCO2e;
  wire10["carbon-footprint"] = 0.012; wire10["carbon-unit"] = "tCO2e";
  return { id: "v15-profile-1x", scenarios: [
    scenario("without-scope2-basis-1x", w, { ...common, parameters: params }),
    scenario("scope2-basis-1x-market-based", w, { ...common, parameters: { ...params, "scope2-basis-1x": "market-based" }, select: ["D5.1x", "C-SFC-4"], derive }),
    scenario("seventeen-digit-figure", w17, { parameters: params17, select: ["D5"], derive: d17 }),
    scenario("excerpt-version-1", w, { excerpt: { ...w.excerpt(), "excerpt-version": 1 }, parameters: params, select: ["D1"] }),
    scenario("operator-declaration-over-a-1x-month", w1x, { parameters: params1x, declarations: [pDecl], pins: pubPins, select: ["C-SFC-7"] }),
    { name: "legacy-declarations", T: T0, pins: pubPins, declarations: [signDeclaration({ ...legacy, target: "pre10.example" }), signDeclaration({ ...wire10, target: "wire10.example" })], select: ["S2", "LEGACY", "VERDICT", "C-SFC-2", "S4"], network: "wire10.example" },
  ] };
}

export function v18() {
  const build = () => {
    const w = new World({ readAt: T0 });
    const p = w.entry1x("p", { active: [{ from: "2025-11-01", to: null }] });
    const q = w.operator("q", { from: "2025-11-01T00:00:00Z" });
    const r = w.operator("r", { from: "2025-11-01T00:00:00Z", extra: { network: "other-ledger.example" } });
    for (const [j, op] of [p, q, r].entries()) {
      w.energy(op, JAN, { kWh: 1000 + j });
      w.carbon(op, JAN, { s2: 300, s3: 200, retirements: [retirement(`RET-18-${j}`, 1000, { at: addDays(addMonths(JAN, 1), 1) })] });
    }
    return { w, p };
  };
  const { w, p } = build();
  const digests = [{ operator: p, sha256: hashOf(w.entries[0]) }];
  const entry1x = { operator: "did:web:op-s.example", origin: "node.op-s.example", active: [{ from: "2025-01-15", to: "2025-06-10" }, { from: "2025-06-20", to: "2025-06-30" }, { from: "2025-08-01", to: null }], keys: [{ "public-jwk": jwkOf(KEY1), "valid-from-commit": "2024-01-01T00:00:00Z", "valid-to-commit": null }] };
  const months = []; for (let i = 0; i < 14; i++) months.push(addMonths(monthBound(2024, 12), i));
  return { id: "v18-registry-1x", scenarios: [
    scenario("1x-entry-with-digest", w, { parameters: { ...PARAMS, "registry-1x-digests": digests }, select: ["D2.entry", "C-SFC-3", "D3"] }),
    scenario("1x-entry-without-digest", w, { select: ["D2.entry", "D3"] }),
    { name: "conversion-to-2.0-form", fn: "registry1xTo2x", entry: entry1x, months },
  ] };
}

export function v24() {
  const w = new World({ readAt: T0 });
  const a = w.entry1x("a", { active: [{ from: "2025-11-01", to: null }] });
  const b = w.operator("b", { from: "2025-11-01T00:00:00Z", extra: { profile2From: JAN } });
  const c = w.operator("c", { from: "2025-11-01T00:00:00Z", extra: { profile2From: FEB } });
  // a (1.x-form entry, no switch month): a 1.x-form event after a 2.0 event, in the Energy chain and in the Carbon chain (L11 alone)
  w.energy(a, DEC, { kWh: 1000 });
  month1x(w, a, "EnergyAttested", JAN, {}, 1);
  month1x(w, a, "CarbonAttested", JAN, { scope2Method: "market-based" }, 2);
  // b: a 1.x-form event for a month at or after profile2From (L11b); December is before it and is fine
  month1x(w, b, "EnergyAttested", DEC, {}, 3);
  month1x(w, b, "EnergyAttested", JAN, {}, 3);
  // c: a 2.0-form event for a month before profile2From (D2 FAIL on the entry)
  w.energy(c, JAN, { kWh: 1000 });
  const params = { ...PARAMS, "registry-1x-digests": [{ operator: a, sha256: hashOf(w.entries.find((e) => e.operator === a)) }] };
  return { id: "v24-1x-after-2x", scenarios: [scenario("order-of-forms", w, { parameters: params, select: ["D2.entry", "D5"] })] };
}
