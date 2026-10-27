/** v17: one case per limit of section 10, URIs from untrusted data, an unread profile-version. */
import { World, retirement, makeCheckpoint } from "../build/world.mjs";
import { EXT } from "../../lib/declaration.mjs";
import { monthBound, addMonths, addDays } from "../../lib/time.mjs";
import { primaryObject, signDeclaration } from "../build/declare.mjs";
import { T0, PARAMS, PINS, scenario, ctxOf, REGISTRAR_X } from "./base.mjs";
import { pubPins } from "./c01-basic.mjs";
import { stub, sign } from "./stubs.mjs";

const DEC = monthBound(2025, 12), JAN = monthBound(2026, 1), FEB = monthBound(2026, 2), MAR = monthBound(2026, 3);
const at = (m, d = 1) => addDays(addMonths(m, 1), d);
const body = (ref, m, kg = 1000) => ({ s2: 300, s3: 200, retirements: [retirement(ref, kg, { at: at(m) })] });
const base = (names = ["a", "b"]) => { const w = new World({ readAt: T0 }); const ops = names.map((n) => w.operator(n, { from: "2025-11-01T00:00:00Z" })); return { w, ops }; };
const SEL = ["D1", "D3", "C-SFC-1", "C-SFC-2", "C-SFC-4"];
const upd = "2026-02-10T09:00:00Z";
const opSpec = (op, name) => ({ period: { start: JAN, end: FEB }, cutoff: upd, level: "operator", operator: op, updated: upd, target: `node.op-${name}.example`, energyUnit: "MWh", carbonUnit: "kgCO2e", hardware: false });

/** A world with a clean operator a and operator b whose January event carries `extra` in its payload. */
function withNote(extra, names = ["a", "b"]) {
  const { w, ops } = base(names);
  w.energy(ops[0], JAN, { kWh: 1000 }); w.carbon(ops[0], JAN, body("RET-17-A", JAN));
  w.energy(ops[1], JAN, { kWh: 1000 }, { mutate: (p) => Object.assign(p, extra) }); w.carbon(ops[1], JAN, body("RET-17-B", JAN));
  return { w, ops };
}
const nest = (n) => { let v = 1; for (let i = 0; i < n; i++) v = [v]; return v; };

export function v17() {
  // a number literal of 35 characters, written into the text of the excerpt
  const LONG = "12345678901234567890123456789012345";
  const lit = withNote({ "x-number": Number(LONG) });
  const litText = JSON.stringify(lit.w.excerpt()).replace(JSON.stringify(Number(LONG)), LONG);
  const bigString = withNote({ "x-note": "a".repeat(4097) });
  const deep = withNote({ "x-deep": nest(33) });
  const longArray = withNote({ "x-list": Array.from({ length: 101 }, (_, i) => i) });
  const many = base(["a"]); // 101 retirements in one event
  many.w.energy(many.ops[0], JAN, { kWh: 1000 });
  many.w.carbon(many.ops[0], JAN, { s2: 30, s3: 20, retirements: Array.from({ length: 101 }, (_, i) => retirement(`RET-17-R${String(i).padStart(3, "0")}`, 1, { at: at(JAN) })) });
  // L12: 21 events of one month in one chain, each correcting the one before
  const month21 = base(["a"]);
  let last;
  for (let k = 0; k < 21; k++) last = month21.w.energy(month21.ops[0], JAN, { kWh: 1000 + k }, k ? { supersedes: last } : {});
  // limits lowered in the scenario so that the input stays small
  const fat = withNote({ "x-note": "b".repeat(1500) });
  const chain = base(["a"]); for (const m of [DEC, JAN, FEB, MAR]) chain.w.energy(chain.ops[0], m, { kWh: 1000 });
  const three = base(["a", "b", "c"]); for (const op of three.ops) three.w.energy(op, JAN, { kWh: 1000 });
  const voids = base(["a"]); const ev = voids.w.carbon(voids.ops[0], DEC, body("RET-17-V", DEC)); voids.w.carbon(voids.ops[0], JAN, body("RET-17-W", JAN)); voids.w.void(ev, "2026-03-01T00:00:00Z"); voids.w.void(voids.w.events[1].hash, "2026-03-02T00:00:00Z");
  const cp = three.w.excerpt({ checkpoint: (ex) => makeCheckpoint(ex) });
  const lowered = (name, w, limits, extra = {}) => scenario(name, w, { limits, select: SEL, ...extra });
  // declarations
  const rel = (extra) => sign(stub("relative.example", { entries: [], evidence: false, top: { "energy-consumption": 1, "scope-2": 1, "scope-3": 1, "carbon-footprint": 2, ...extra } }));
  const uriWorld = base(["a"]); uriWorld.w.energy(uriWorld.ops[0], JAN, { kWh: 1000, evidence: "evidence/energy-1.json" });
  // profile-version and the unread major
  const pv = base(["a"]); pv.w.energy(pv.ops[0], JAN, { kWh: 1000 }); pv.w.carbon(pv.ops[0], JAN, body("RET-17-P", JAN));
  const ctx = ctxOf(pv.w);
  const { obj } = primaryObject(ctx, { ...opSpec(pv.ops[0], "a") });
  const v3 = JSON.parse(JSON.stringify(obj)); v3.extensions[`${EXT}ledger-evidence-2`]["profile-version"] = "3.0";
  // a limit hit after a FAIL already established: the declaration is built from the clean world, then a ledger hash is damaged
  const af = withNote({ "x-note": "c".repeat(4097) });
  const afCtx = ctxOf(af.w);
  const afObj = primaryObject(afCtx, { period: { start: JAN, end: FEB }, cutoff: upd, level: "network", energyUnit: "MWh", carbonUnit: "kgCO2e", consensus: "proof-of-authority", updated: upd, target: "ledger.example", hardware: false }).obj;
  const afEx = af.w.excerpt(); afEx.ledger[0] = { ...afEx.ledger[0], hash: "f".repeat(64) };
  // numbers: 500 digits (over the literal limit, not expanded) and 1e999 (no binary64 value), in the read and in a declaration
  const SENTINEL = 7777771, DIGITS500 = `1${"0".repeat(499)}`;
  const readText = (literal) => JSON.stringify(pv.w.excerpt({ extra: { "x-number": SENTINEL } })).replace(String(SENTINEL), literal);
  const declText = (literal) => JSON.stringify(signDeclaration(obj)).replace(/"energy-consumption":[0-9.e+-]+/, `"energy-consumption":${literal}`);
  const withNumber = (name, excerptText) => ({ name, T: T0, excerptText, parameters: PARAMS, pins: pubPins, declarations: [signDeclaration(obj)], select: ["D1", "C-SFC-7"] });
  const declNumber = (name, literal) => ({ name, T: T0, declarationText: declText(literal), pins: pubPins, select: ["S2"] });
  // names of units and hosts that are also names on Object.prototype are plain unknown names
  const unitObject = (members) => signDeclaration({ ...JSON.parse(JSON.stringify(obj)), ...members });
  const hostile = (name, members) => scenario(name, pv.w, { declarations: [unitObject(members)], pins: pubPins, select: ["S6", "C-SFC-5", "C-SFC-7"] });
  return { id: "v17-limits", scenarios: [
    { name: "number-literal-of-35-characters", T: T0, excerptText: litText, parameters: PARAMS, pins: PINS, select: SEL },
    scenario("string-of-4097-bytes", bigString.w, { select: SEL }),
    scenario("nesting-depth-35", deep.w, { select: SEL }),
    scenario("101-items-in-one-array", longArray.w, { select: SEL }),
    scenario("101-retirements-in-one-event", many.w, { select: SEL }),
    scenario("21-events-of-one-month-in-a-chain", month21.w, { select: ["D3", "D5"] }),
    lowered("event-over-1300-bytes", fat.w, { eventBytes: 1300 }),
    lowered("4-events-in-a-chain-of-at-most-3", chain.w, { eventsPerChain: 3 }),
    lowered("3-operators-in-a-read-of-at-most-2", three.w, { operators: 2 }),
    lowered("3-entries-in-a-Registry-of-at-most-2", three.w, { registryEntries: 2 }),
    lowered("2-void-acts-of-at-most-1", voids.w, { voids: 1 }),
    scenario("4-chains-in-a-checkpoint-of-at-most-2", three.w, { excerpt: cp, limits: { checkpointChains: 2 }, select: SEL }),
    lowered("read-over-3000-bytes", three.w, { readBytes: 3000 }),
    lowered("2-entries-in-a-parameters-array-of-at-most-1", three.w, { parameterArray: 1 }),
    { name: "3-objects-in-a-declaration-of-at-most-2", T: T0, limits: { declarationObjects: 2 }, pins: pubPins, select: ["S2"], declarations: [rel({}), sign(stub("relative2.example", { entries: [], evidence: false, top: { "energy-consumption": 1 } })), sign(stub("relative3.example", { entries: [], evidence: false, top: { "energy-consumption": 1 } }))] },
    { name: "relative-references-with-a-base", T: T0, retrievalUri: "https://relative.example/.well-known/sustainability-data", pins: pubPins, select: ["URI"], declarations: [rel({ "disclosure-uri": "/sustainability/disclosures.json", "methodology-uri": "methodology.md", "verifiable-attestation-uri": "../vc/example.jwt" })] },
    { name: "relative-references-without-a-base", T: T0, pins: pubPins, select: ["URI"], declarations: [rel({ "disclosure-uri": "/sustainability/disclosures.json", "methodology-uri": "methodology.md" })] },
    { name: "userinfo-in-a-uri", T: T0, pins: pubPins, select: ["URI"], declarations: [rel({ "disclosure-uri": "https://reader:secret@relative.example/disclosures.json" })] },
    scenario("event-evidence-that-is-not-absolute", uriWorld.w, { select: ["URI"] }),
    scenario("excerpt-profile-version-of-another-major", pv.w, { excerpt: pv.w.excerpt({ profileVersion: "3.0" }), declarations: [signDeclaration(obj)], pins: pubPins, select: ["D1", "C-SFC-7"] }),
    scenario("declaration-profile-version-not-read", pv.w, { declarations: [signDeclaration(v3)], pins: pubPins, select: ["S6", "C-SFC-5", "C-SFC-7"] }),
    withNumber("number-literal-of-500-digits-in-the-read", readText(DIGITS500)),
    withNumber("number-out-of-binary64-range-in-the-read", readText("1e999")),
    withNumber("read-nested-20000-deep", `${"[".repeat(20000)}${"]".repeat(20000)}`),
    { name: "declaration-nested-20000-deep", T: T0, declarationText: `${"[".repeat(20000)}${"]".repeat(20000)}`, pins: pubPins, select: ["S2"] },
    declNumber("number-literal-of-500-digits-in-a-declaration", DIGITS500),
    declNumber("number-out-of-binary64-range-in-a-declaration", "1e999"),
    hostile("energy-unit-named-constructor", { "energy-unit": "constructor" }),
    hostile("carbon-unit-named-toString", { "carbon-unit": "toString" }),
    hostile("units-named-__proto__-and-hasOwnProperty", { "energy-unit": "__proto__", "carbon-unit": "hasOwnProperty" }),
    scenario("read-network-named-constructor-with-a-pin-for-the-real-host", pv.w, { excerpt: pv.w.excerpt({ extra: { network: "constructor" } }), pins: { methodology: false, registrar: { "ledger.example": [REGISTRAR_X] } }, parameters: { ...PARAMS, "registrar-keys": [] }, select: ["D2.entry"] }),
    scenario("pin-named-for-the-network-of-the-read", pv.w, { pins: { methodology: false, networkHost: "ledger.example", registrar: { "ledger.example": [REGISTRAR_X] } }, parameters: PARAMS, select: ["D2.entry"] }),
    scenario("pin-named-for-another-network-than-the-read", pv.w, { pins: { methodology: false, networkHost: "other.example", registrar: { "other.example": [REGISTRAR_X] } }, parameters: PARAMS, select: ["D2.entry"] }),
    scenario("limit-hit-after-a-fail", af.w, { excerpt: afEx, declarations: [signDeclaration(afObj)], pins: pubPins, select: ["D1", "D3", "C-SFC-7"] }),
  ] };
}
