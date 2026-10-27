/** v29 to v33: rejected signatures, duplicate members, Registry binding, parameters, ledger order, registrar objects. */
import { World, retirement, signObject, makeCheckpoint } from "../build/world.mjs";
import { KEY1, KEY2, b64u } from "../build/keys.mjs";
import { canonicalize, hashOf } from "../../lib/canonical.mjs";
import { forgeSmallOrderR } from "../build/signing.mjs";
import { signWithSeed } from "../build/signing.mjs";
import { EXT } from "../../lib/declaration.mjs";
import { monthBound, addMonths, addDays } from "../../lib/time.mjs";
import { primaryObject } from "../build/declare.mjs";
import { T0, PARAMS, EXAMPLE_PARAMS, PINS, scenario, ctxOf, REGISTRAR_X } from "./base.mjs";
import { pubPins } from "./c01-basic.mjs";
import { stub, sign } from "./stubs.mjs";

const DEC = monthBound(2025, 12), JAN = monthBound(2026, 1), FEB = monthBound(2026, 2), MAR = monthBound(2026, 3);
const at = (m, d = 1) => addDays(addMonths(m, 1), d);
const body = (ref, m, kg = 1000) => ({ s2: 300, s3: 200, retirements: [retirement(ref, kg, { at: at(m) })] });
const small = (names, from = "2025-11-01T00:00:00Z") => { const w = new World({ readAt: T0 }); const ops = names.map((n) => w.operator(n, { from })); return { w, ops }; };

// ---- v29 ---------------------------------------------------------------------------------------

const HDR = { alg: "Ed25519", cty: "sustainability-data+json" };
const jwsWith = (obj, { header = HDR, headerBytes, key = KEY1, payload, sigBytes } = {}) => {
  const { signed, ...rest } = obj;
  const h = b64u(headerBytes ?? Buffer.from(canonicalize(header))), p = b64u(Buffer.from(payload ?? canonicalize(rest)));
  const sig = sigBytes ?? signWithSeed(key.seed, Buffer.from(`${h}.${p}`, "ascii"));
  return `${h}.${p}.${b64u(sig)}`;
};
const claimsObj = (target) => stub(target, { entries: [], evidence: false, top: { "energy-consumption": 1, "scope-2": 1, "scope-3": 1, "carbon-footprint": 2 } });
const plainObj = (target) => {
  const o = claimsObj(target);
  delete o.extensions;
  return o;
};

export function v29() {
  const variants = [
    ["cty-absent", { header: { alg: "Ed25519" } }],
    ["alg-none", { header: { alg: "none", cty: HDR.cty }, sigBytes: Buffer.alloc(0) }],
    ["crit-malformed", { header: { ...HDR, crit: [] } }],
    ["signature-under-another-key", { key: KEY2 }],
    ["payload-differs", { payloadChange: true }],
    // RFC 7515 section 4: header parameter names are unique; a reader that keeps the first copy would read `none`
    ["alg-repeated", { headerBytes: Buffer.from('{"alg":"none","alg":"Ed25519","cty":"sustainability-data+json"}') }],
    ["crit-repeated", { headerBytes: Buffer.from('{"alg":"Ed25519","cty":"sustainability-data+json","crit":["x-example"],"crit":[]}') }],
    // a payload nested far deeper than any engine's stack: a limit of section 10, never a syntax error
    ["payload-nested-20000-deep", { payload: `${"[".repeat(20000)}${"]".repeat(20000)}` }],
  ];
  const docs = [];
  for (const [name, opt] of variants) for (const [kind, make] of [["claims", claimsObj], ["plain", plainObj]]) {
    const o = make(`${kind}-${name}.example`);
    const payload = opt.payloadChange ? canonicalize({ ...o, "energy-consumption": 2 }) : opt.payload;
    docs.push({ ...o, signed: jwsWith(o, { ...opt, payload }) });
  }
  // bytes that are not valid UTF-8 (RFC 7515 requires UTF-8), and a byte-order mark, which is not I-JSON text
  const withByte = (byte) => Buffer.concat([Buffer.from('{"x":"'), Buffer.from([byte]), Buffer.from('"}')]);
  const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
  for (const [kind, make] of [["claims", claimsObj], ["plain", plainObj]]) {
    const bad = (name, options) => { const o = make(`${kind}-${name}.example`); docs.push({ ...o, signed: jwsWith(o, options(o)) }); };
    bad("invalid-utf8-in-the-header", () => ({ headerBytes: withByte(0xff) }));
    bad("invalid-utf8-in-the-payload", () => ({ payload: withByte(0xff) }));
    bad("byte-order-mark-before-the-payload", (o) => ({ payload: Buffer.concat([BOM, Buffer.from(canonicalize(o))]) }));
  }
  const unknownCrit = claimsObj("claims-crit-unknown.example");
  docs.push({ ...unknownCrit, signed: jwsWith(unknownCrit, { header: { ...HDR, crit: ["x-example"], "x-example": 1 } }) });
  const good = claimsObj("claims-verified.example");
  docs.push({ ...good, signed: jwsWith(good) });
  // an operator declaration that claims SFC and is signed with ES256
  const op = { ...claimsObj("node.op-a.example"), "target-type": "origin" };
  op.extensions[`${EXT}network-topology`] = { "member-of-network": "ledger.example" };
  op.extensions[`${EXT}hardware-lifecycle`] = { "general-purpose-hardware": true, "single-use-asic-required": false };
  docs.push({ ...op, signed: jwsWith(op, { header: { alg: "ES256", cty: HDR.cty }, sigBytes: Buffer.alloc(64, 7) }) });
  const opPlain = { ...plainObj("node.op-b.example"), "target-type": "origin" };
  docs.push({ ...opPlain, signed: jwsWith(opPlain, { header: { alg: "ES256", cty: HDR.cty }, sigBytes: Buffer.alloc(64, 7) }) });
  const sel = ["S3"];
  return { id: "v29-signed-rejected", scenarios: [
    { name: "pinned-key", T: T0, pins: pubPins, declarations: docs, select: sel },
    { name: "no-pinned-key", T: T0, declarations: docs, select: sel },
  ] };
}

export function v29b() {
  const base = claimsObj("dup.example");
  const plain = plainObj("dup-plain.example");
  const json = (o) => JSON.stringify(o);
  const withDupTarget = (o) => json(o).replace(`"target":"${o.target}"`, `"target":"first.example","target":"${o.target}"`);
  const mk = (name, text, opts = {}) => ({ name, T: T0, declarationText: text, pins: opts.pin === false ? {} : pubPins, select: ["S3", "C-SFC-5"] });
  const claims = (o) => ({ ...o, signed: jwsWith(o) });
  const cl = claims(base), pl = claims(plain);
  // a duplicate in the decoded payload
  const payloadDup = (o) => canonicalize(o).replace(`"target":"${o.target}"`, `"target":"first.example","target":"${o.target}"`);
  const clP = { ...base, signed: jwsWith(base, { payload: payloadDup(base) }) };
  const plP = { ...plain, signed: jwsWith(plain, { payload: payloadDup(plain) }) };
  // a lone surrogate in a string of the served text (the signature covers the parsed value, which keeps the lone surrogate)
  const loneBase = { ...base, provider: `${base.provider} \ud800` };
  const lone = { ...loneBase, signed: jwsWith(loneBase) };
  const lonePlain = { ...plain, provider: `${plain.provider} \ud800` };
  const lonePl = { ...lonePlain, signed: jwsWith(lonePlain) };
  const loneText = (o) => json(o).replace("\\ud800", "\\ud800");
  // a duplicate `extensions` member whose first copy alone carries ledger-evidence-2: the body claims SFC
  const evBase = { ...stub("dup-ext.example", { entries: [], evidence: false, top: { "energy-consumption": 1 } }) };
  const evValue = { "profile-version": "2.0", "ledger-access-uri": "https://dup-ext.example/read", operators: [], "network-offset-coverage": true };
  const evText = (() => {
    const o = { ...evBase, signed: jwsWith(evBase) };
    const t = json(o);
    const i = t.indexOf('"extensions":');
    return `${t.slice(0, i)}"extensions":{"${EXT}ledger-evidence-2":${json(evValue)}},${t.slice(i)}`;
  })();
  // a duplicate is charged to the served object that holds it, not to the whole body (7.2 rule 2 speaks of the served object)
  const twoObjects = (first, second) => `[${first},${second}]`;
  const bodyIs = (name, text) => ({ name, T: T0, declarationText: text, pins: pubPins, select: ["S2"] });
  return { id: "v29b-duplicate-members", scenarios: [
    mk("duplicate-target-claims-sfc-pinned", withDupTarget(cl)), mk("duplicate-target-claims-sfc-unpinned", withDupTarget(cl), { pin: false }),
    mk("duplicate-in-the-second-object-only", twoObjects(json(cl), withDupTarget(pl))),
    mk("duplicate-in-the-first-object-only", twoObjects(withDupTarget(cl), json(pl))),
    // a served body that is valid JSON but not a declaration object or an array of them (9.1)
    bodyIs("body-is-a-string", '"hello"'), bodyIs("body-is-a-number", "5"), bodyIs("body-is-null", "null"), bodyIs("body-is-true", "true"),
    bodyIs("body-is-an-array-of-numbers", "[1,2]"), bodyIs("body-is-an-array-with-one-object", `[1,${json(cl)}]`), bodyIs("body-is-an-empty-array", "[]"),
    mk("duplicate-target-plain-pinned", withDupTarget(pl)), mk("duplicate-target-plain-unpinned", withDupTarget(pl), { pin: false }),
    mk("duplicate-in-the-decoded-payload-claims-sfc", json(clP)), mk("duplicate-in-the-decoded-payload-plain", json(plP)),
    mk("lone-surrogate-claims-sfc", loneText(lone)), mk("lone-surrogate-plain", loneText(lonePl)),
    mk("duplicate-extensions-member-carrying-ledger-evidence-2", evText),
  ] };
}

// ---- v30 ---------------------------------------------------------------------------------------

export function v30() {
  const w = new World({ readAt: T0 });
  const a = w.operator("a", { from: "2025-11-01T00:00:00Z" });
  const c = w.operator("c", { from: "2025-11-01T00:00:00Z" });
  w.operator("b", { from: "2025-11-01T00:00:00Z", origin: "node.op-a.example" });                         // the origin of a
  w.operator("a2", { from: "2025-11-01T00:00:00Z", did: a });                                              // the operator DID of a
  w.operator("d", { active: [{ from: "2025-12-01T00:00:00Z", to: "2026-02-01T00:00:00Z" }, { from: "2025-11-01T00:00:00Z", to: "2025-12-01T00:00:00Z" }] }); // unsorted
  w.operator("e", { active: [{ from: "2025-11-01T00:00:00Z", to: "2026-03-01T00:00:00Z" }, { from: "2026-01-01T00:00:00Z", to: null }] });             // overlapping
  const f = w.entry1x("f", { active: [{ from: "2025-12-01", to: null }, { from: "2025-11-01", to: "2025-11-30" }] });                                 // unsorted 1.x entry: INFO
  for (const op of [a, c]) { w.energy(op, JAN, { kWh: 1000 }); w.carbon(op, JAN, body(`RET-30-${op.slice(-9, -8).toUpperCase()}`, JAN)); }
  const ctx = ctxOf(w);
  const upd = "2026-02-10T09:00:00Z";
  const spec = { period: { start: JAN, end: FEB }, cutoff: upd, level: "network", energyUnit: "MWh", carbonUnit: "tCO2e", consensus: "proof-of-authority", updated: upd, target: "ledger.example", hardware: false };
  const { obj } = primaryObject(ctx, spec);
  const wrong = JSON.parse(JSON.stringify(obj));
  const ev = wrong.extensions[`${EXT}ledger-evidence-2`];
  ev.operators.find((x) => x.operator === c).origin = "somewhere-else.example";
  return { id: "v30-registry-binding", scenarios: [
    scenario("shared-operator-and-origin-and-unordered-intervals", w, { declarations: [sign(wrong)], pins: pubPins, parameters: { ...PARAMS, "registry-1x-digests": [{ operator: f, sha256: hashOf(w.entries.find((e) => e.operator === f)) }] }, select: ["D2.unique", "D2.operator-set", "C-SFC-7"] }),
  ] };
}

// ---- v31 ---------------------------------------------------------------------------------------

export function v31() {
  const { w, ops } = small(["a"]);
  w.energy(ops[0], JAN, { kWh: 1000 }); w.carbon(ops[0], JAN, body("RET-31-A", JAN));
  const noRegistries = { ...PARAMS }; delete noRegistries["retirement-registries"];
  const plat = (mechanism, extra = {}) => ({ ...PARAMS, platform: { "hot-path": "Example chain", access: "permissioned", mechanism, n: 30, "p-watts": 500, o: 1.5, ...extra } });
  const pub = (period, figure, unit) => ({ ...PARAMS, platform: { "hot-path": "Example public chain", access: "public", mechanism: "proof-of-stake", assessment: { publisher: "Example Assessor", uri: "https://assessor.example/report", period, figure, unit, method: "synthetic" } } });
  const months = (n) => ({ start: "2025-06-01T00:00:00Z", end: `${addMonths("2025-06-01T00:00:00Z", n).slice(0, 10)}T00:00:00Z` });
  const sel = ["C-SFC-6"];
  // a network declaration whose `consensus-mechanism` text is compared with the platform statement (C-SFC-6 test 1)
  const upd = "2026-02-10T09:00:00Z";
  const withConsensus = (consensus) => sign(primaryObject(ctxOf(w), { period: { start: JAN, end: FEB }, cutoff: upd, level: "network", energyUnit: "MWh", carbonUnit: "tCO2e", consensus, updated: upd, target: "ledger.example", hardware: false }).obj);
  const cft = plat("crash-fault-tolerant");
  return { id: "v31-parameters", scenarios: [
    scenario("every-item", w, { parameters: EXAMPLE_PARAMS, select: ["D5", "C-SFC-6"] }),
    scenario("retirement-registries-missing", w, { parameters: noRegistries, select: ["D5"] }),
    { name: "mechanism-spellings", fn: "mechanism", values: ["proof-of-work", "Proof of Work", "pow", " PoW ", "proof_of_work", "Proof-Of-Stake", "proof-of-stak", "BFT", "dag", "Hybrid", "proof of authority", "", "crash-fault-tolerant", "Crash Fault Tolerant", "crash_fault_tolerant"] },
    scenario("mechanism-crash-fault-tolerant", w, { parameters: cft, select: sel }),
    scenario("consensus-mechanism-text-in-the-list", w, { parameters: cft, declarations: [withConsensus("crash-fault-tolerant")], pins: pubPins, select: sel }),
    scenario("consensus-mechanism-text-outside-the-list", w, { parameters: cft, declarations: [withConsensus("Raft (crash-fault-tolerant)")], pins: pubPins, select: sel }),
    scenario("assessment-with-fraction-bounds", w, { parameters: pub({ start: "2025-06-01T00:00:00.000Z", end: "2026-06-01T00:00:00.000Z" }, 0.5, "GWh"), select: sel }),
    scenario("assessment-bounds-differ-by-a-fraction", w, { parameters: pub({ start: "2025-06-01T00:00:00.5Z", end: "2026-06-01T00:00:00Z" }, 0.5, "GWh"), select: sel }),
    scenario("mechanism-Proof-of-Work", w, { parameters: plat("Proof of Work"), select: sel }),
    scenario("mechanism-pow", w, { parameters: plat("pow"), select: sel }),
    scenario("mechanism-misspelt", w, { parameters: plat("proof-of-stak"), select: sel }),
    scenario("assessment-of-11-months", w, { parameters: pub(months(11), 0.5, "GWh"), select: sel }),
    scenario("assessment-of-12-months", w, { parameters: pub(months(12), 0.5, "GWh"), select: sel }),
    scenario("assessment-in-MWh-below-cap", w, { parameters: pub(months(12), 900, "MWh"), select: sel }),
    scenario("assessment-in-MWh-at-cap", w, { parameters: pub(months(12), 1000, "MWh"), select: sel }),
    scenario("permissioned-without-o", w, { parameters: plat("proof-of-authority", { o: undefined }), select: sel }),
    scenario("permissioned-node-bound-at-cap", w, { parameters: plat("proof-of-authority", { n: 1000, "p-watts": 1000, o: 1 }), select: sel }),
  ] };
}

// ---- v32 ---------------------------------------------------------------------------------------

export function v32() {
  const mk = () => { const { w, ops } = small(["a"]); for (const m of [DEC, JAN, FEB]) { w.energy(ops[0], m, { kWh: 1000 }); w.carbon(ops[0], m, body(`RET-32-${m.slice(5, 7)}`, m)); } return { w, ops }; };
  const { w } = mk();
  const ex = w.excerpt();
  const reversed = { ...ex, ledger: [...ex.ledger].reverse() };
  const repeated = { ...ex, ledger: [ex.ledger[0], ex.ledger[1], ex.ledger[1], ex.ledger[2]] };
  const clash = (() => { const m = mk(); const first = m.w.events.find((e) => e.event.type === "CarbonAttested"); m.w.voids.push(signObject({ commit: m.w.events[3].commit, target: first.hash }, KEY1)); return m.w.excerpt(); })();
  const sel = ["D3.order", "D2.void", "D5"];
  const sc = (name, excerpt) => ({ name, T: T0, excerpt, parameters: PARAMS, pins: PINS, select: sel });
  return { id: "v32-ledger-order", scenarios: [
    sc("commit-instants-do-not-increase", reversed), sc("a-hash-repeats", repeated), sc("a-void-commit-equals-a-ledger-commit", clash),
  ] };
}

// ---- v33 ---------------------------------------------------------------------------------------

const IDENTITY_X = b64u(Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]));

export function v33() {
  const base = () => { const { w, ops } = small(["a", "b"]); for (const op of ops) w.energy(op, JAN, { kWh: 1000 }); return { w, ops }; };
  const { w, ops } = base();
  const ex = w.excerpt();
  const entry = ex.registry[0];
  const aVoid = signObject({ commit: "2026-03-01T00:00:00Z", target: "1".repeat(64) }, KEY1);
  const cpoint = makeCheckpoint(ex);
  const sel = ["D2.void", "D2.entry", "D4.checkpoint", "D3"];
  // small-order key as the public key A: a signature of R = identity and S = 0 satisfies the cofactorless equation for any message
  const s = new World({ readAt: T0 });
  const so = s.operator("s", { from: "2025-11-01T00:00:00Z", keys: [{ jwk: { kty: "OKP", crv: "Ed25519", x: IDENTITY_X }, validFromCommit: "2024-01-01T00:00:00Z", validToCommit: null }] });
  s.energy(so, JAN, { kWh: 1000 }, { rawSig: () => Buffer.concat([Buffer.from([1]), Buffer.alloc(31), Buffer.alloc(32)]) });
  // small-order R: R = identity, S = k a mod L under the operator's own key
  const t = new World({ readAt: T0 });
  const to = t.operator("t", { from: "2025-11-01T00:00:00Z" });
  t.energy(to, JAN, { kWh: 1000 }, { rawSig: (msg) => forgeSmallOrderR(KEY1.seed, Buffer.from(KEY1.pub, "hex"), msg) });
  return { id: "v33-registrar-objects", scenarios: [
    scenario("registry-entry-in-voids", w, { excerpt: { ...ex, voids: [entry] }, select: sel }),
    scenario("registry-entry-as-checkpoint", w, { excerpt: { ...ex, checkpoint: entry }, select: sel }),
    scenario("void-act-and-checkpoint-in-registry", w, { excerpt: { ...ex, registry: [...ex.registry, aVoid, cpoint] }, select: ["D2.entry", "D2.unique"] }),
    scenario("small-order-public-key", s, { select: ["D2.entry", "D3"] }),
    scenario("small-order-R", t, { select: ["D3"] }),
    scenario("registrar-key-pinned-for-another-host", w, { pins: { methodology: false, registrar: { "other-ledger.example": [REGISTRAR_X] } }, parameters: { ...PARAMS, "registrar-keys": [] }, select: ["D2.entry"] }),
  ] };
}
