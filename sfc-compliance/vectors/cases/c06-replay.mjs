/** v25 to v28: replay order, Registry changes, checkpoints, void acts. */
import { World, retirement, signObject, makeCheckpoint } from "../build/world.mjs";
import { KEY1, KEY2, jwkOf } from "../build/keys.mjs";
import { monthBound, addMonths, addDays } from "../../lib/time.mjs";
import { primaryObject, signDeclaration } from "../build/declare.mjs";
import { T0, PARAMS, PINS, scenario, ctxOf } from "./base.mjs";
import { pubPins } from "./c01-basic.mjs";

const DEC = monthBound(2025, 12), JAN = monthBound(2026, 1), FEB = monthBound(2026, 2), MAR = monthBound(2026, 3);
const at = (m, d = 1) => addDays(addMonths(m, 1), d);
const T = (iso) => iso;
const body = (ref, m, kg = 1000, extra = {}) => ({ s2: 300, s3: 200, retirements: [retirement(ref, kg, { at: at(m), ...extra })] });
const small = (names, from = "2025-11-01T00:00:00Z", opts = {}) => { const w = new World({ readAt: T0 }); const ops = names.map((n) => w.operator(n, { from, ...(opts[n] ?? {}) })); return { w, ops }; };

export function v25() {
  // citation A is corrected to A' after B (same retirement key) was committed
  const one = small(["a", "b"]);
  const [a, b] = one.ops;
  const A = one.w.carbon(a, DEC, body("RET-25-X", DEC), { commit: "2026-01-04T10:00:00Z" });
  one.w.carbon(b, DEC, body("RET-25-X", DEC), { commit: "2026-01-04T11:00:00Z" });
  one.w.carbon(a, DEC, body("RET-25-Y", DEC), { supersedes: A, commit: "2026-01-04T12:00:00Z" });
  // a retroactive closure of a key: the registry as read closes key 1 before an event it signed was committed
  const w2 = new World({ readAt: T0 });
  const k1 = { jwk: jwkOf(KEY1), validFromCommit: "2024-01-01T00:00:00Z", validToCommit: "2026-01-20T00:00:00Z" };
  const k2 = { jwk: jwkOf(KEY2), validFromCommit: "2026-01-20T00:00:00Z", validToCommit: null };
  const a2 = w2.operator("a", { from: "2025-11-01T00:00:00Z", keys: [k1, k2] });
  w2.energy(a2, DEC, { kWh: 1000 }, { commit: "2026-01-03T09:00:00Z", key: KEY1 });
  const j = w2.energy(a2, JAN, { kWh: 1100 }, { commit: "2026-02-03T09:00:00Z", key: KEY1 });                       // L5: key 1 was closed before this commit
  w2.energy(a2, JAN, { kWh: 1150 }, { supersedes: j, commit: "2026-02-10T09:00:00Z", key: KEY2 });                 // L6: nothing stands to supersede
  w2.energy(a2, FEB, { kWh: 1200 }, { commit: "2026-03-03T09:00:00Z", key: KEY2 });
  // a shortened `to` over attested months
  const w3 = new World({ readAt: T0 });
  const c3 = w3.operator("c", { active: [{ from: "2025-11-01T00:00:00Z", to: FEB }] });
  for (const m of [DEC, JAN, FEB, MAR]) w3.energy(c3, m, { kWh: 1000 });
  return { id: "v25-replay-order", scenarios: [
    scenario("correction-after-a-dependent-event", one.w, { select: ["D5"], effectiveAt: T0 }),
    scenario("retroactive-key-closure", w2, { select: ["D3", "D5"], effectiveAt: T0 }),
    scenario("shortened-to-over-attested-months", w3, { select: ["D2.interval", "D2.inactive-month", "D3", "D5"] }),
  ] };
}

export function v26() {
  const { w, ops } = small(["a", "b"]);
  for (const op of ops) { w.energy(op, JAN, { kWh: 1000 }); w.carbon(op, JAN, body(`RET-26-${op.slice(-9, -8).toUpperCase()}`, JAN)); }
  const ctx = ctxOf(w);
  const upd = "2026-02-10T09:00:00Z";
  const spec = { period: { start: JAN, end: FEB }, cutoff: upd, level: "operator", operator: ops[0], updated: upd, target: "node.op-a.example", hardware: false };
  const { obj } = primaryObject(ctx, spec);
  const noMember = JSON.parse(JSON.stringify(obj));
  delete noMember.extensions["https://andreibesleaga.com/sfc/extensions/network-topology"]["member-of-network"];
  return { id: "v26-operator-no-membership", scenarios: [
    scenario("no-member-of-network", w, { declarations: [signDeclaration(noMember)], pins: pubPins, select: ["C-SFC-5", "D2.network", "C-SFC-7", "S6.a"] }),
    scenario("claimed-network-without-a-pin", w, { declarations: [signDeclaration(obj)], pins: { operatorKeys: pubPins.operatorKeys, publisherKeys: pubPins.publisherKeys }, select: ["D2.network", "D2.entry", "C-SFC-7"] }),
    scenario("membership-pinned", w, { declarations: [signDeclaration(obj)], pins: pubPins, select: ["D2.network", "C-SFC-5", "C-SFC-7"] }),
  ] };
}

function checkpointWorld() {
  const { w, ops } = small(["a", "b", "c"]);
  for (const [j, op] of ops.entries()) for (const m of [DEC, JAN]) { w.energy(op, m, { kWh: 1000 + j }); w.carbon(op, m, body(`RET-27-${j}${m.slice(5, 7)}`, m)); }
  return { w, ops };
}
function withCheckpoint(w, edit, opts) {
  return w.excerpt({ checkpoint: (ex) => { const cp = makeCheckpoint(ex, KEY1, opts); if (!edit) return cp; const { sig, ...rest } = cp; return signObject(edit(rest), KEY1); } });
}
const SEL27 = ["D4.checkpoint", "D4.info", "D2.rollback", "D5"];

export function v27() {
  const { w, ops } = checkpointWorld();
  const A = (x) => ({ ...scenario("x", w), ...x });
  const withVoid = checkpointWorld();
  const target = withVoid.w.events.find((e) => e.event.type === "CarbonAttested").hash;
  withVoid.w.void(target, "2026-03-01T00:00:00Z");
  const exVoid = withVoid.w.excerpt({ checkpoint: (ex) => makeCheckpoint(ex) });
  const noVoids = { ...exVoid }; delete noVoids.voids;
  const dropChain = (() => { const ex = withCheckpoint(w, null, { digests: false }); const gone = `${ops[1]}|CarbonAttested`; return { ...ex, ledger: ex.ledger.filter((l) => `${l.event.subject}|${l.event.type}` !== gone) }; })();
  const params = { ...PARAMS, "registrar-keys": [{ jwk: jwkOf(KEY1), status: "current" }, { jwk: jwkOf(KEY2), status: "former", retired: "2025-12-31" }] };
  const sc = (name, excerpt, extra = {}) => ({ name, T: T0, excerpt, parameters: PARAMS, pins: PINS, select: SEL27, ...extra });
  return { id: "v27-rollback", scenarios: [
    sc("checkpoint-verified", withCheckpoint(w)),
    sc("lower-version-than-an-earlier-verified-entry", withCheckpoint(w), { prior: { versions: { [ops[0]]: 3 } } }),
    sc("verified-checkpoint-without-a-ledger-digest", withCheckpoint(w, ({ ["ledger-digest"]: _, ...rest }) => rest)),
    sc("registry-digest-mismatch", withCheckpoint(w, (cp) => ({ ...cp, "registry-digest": "0".repeat(64) }))),
    sc("ledger-digest-mismatch", withCheckpoint(w, (cp) => ({ ...cp, "ledger-digest": "0".repeat(64) }))),
    sc("voids-digest-over-an-excerpt-that-omits-a-void", noVoids),
    sc("void-acts-present-without-a-voids-digest", withVoid.w.excerpt({ checkpoint: (ex) => { const cp = makeCheckpoint(ex); const { sig, ["voids-digest"]: _, ...rest } = cp; return signObject(rest, KEY1); } })),
    sc("checkpoint-lists-a-chain-the-excerpt-omits", dropChain),
    sc("checkpoint-signed-under-a-former-key", w.excerpt({ checkpoint: (ex) => makeCheckpoint(ex, KEY2) }), { parameters: params }),
    sc("checkpoint-of-another-network", w.excerpt({ checkpoint: (ex) => makeCheckpoint(ex, KEY1, { network: "other-ledger.example" }) })),
  ] };
}

export function v28() {
  const { w, ops } = small(["a", "b", "c", "d", "e", "f"]);
  const [a, b, c, d, e, f] = ops;
  const t = (n) => `2026-01-05T${String(Math.floor(n / 3600)).padStart(2, "0")}:${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}Z`;
  // a, e, b: one tonne; the void of A frees it for B; E was skipped before the act and stays skipped
  const A = w.carbon(a, DEC, body("RET-28-1", DEC), { commit: t(36000) });
  w.carbon(e, DEC, body("RET-28-1", DEC), { commit: t(36100) });
  w.void(A, t(36200));
  w.carbon(b, DEC, body("RET-28-1", DEC), { commit: t(36300) });
  // c: a correction is voided; the month is silent, the original is not restored, the next attestation needs no supersedes
  const c1 = w.carbon(c, DEC, body("RET-28-C1", DEC), { commit: t(40000) });
  const c2 = w.carbon(c, DEC, body("RET-28-C2", DEC), { supersedes: c1, commit: t(40100) });
  w.void(c2, t(40200));
  w.carbon(c, DEC, body("RET-28-C3", DEC), { commit: t(40300) });
  // d: the voided event was already superseded: E does not change
  const d1 = w.carbon(d, DEC, body("RET-28-D1", DEC), { commit: t(44000) });
  w.carbon(d, DEC, body("RET-28-D2", DEC), { supersedes: d1, commit: t(44100) });
  w.void(d1, t(44200));
  // f: a void whose target is committed after it, one that targets an EnergyAttested event, and two voids at one instant
  const en = w.energy(f, DEC, { kWh: 1000 }, { commit: t(46000) });
  w.void(en, t(46100));
  w.void("1".repeat(64), t(46200));
  const late = w.carbon(f, DEC, body("RET-28-F1", DEC), { commit: t(50000) });
  w.void(late, t(46300));
  w.void(c1, t(46400)); w.void(d1, t(46400));
  // one void act, checked without a pinned key and under a former key
  const pair = (key) => {
    const x = small(["a"]);
    const e = x.w.carbon(x.ops[0], DEC, body("RET-28-P", DEC), { commit: t(36000) });
    x.w.void(e, t(36200), key);
    return x.w;
  };
  const former = { ...PARAMS, "registrar-keys": [{ jwk: jwkOf(KEY1), status: "current" }, { jwk: jwkOf(KEY2), status: "former", retired: "2025-12-31" }] };
  const SEL28 = ["D2.void", "D5"];
  return { id: "v28-citation-void", scenarios: [
    scenario("void-acts", w, { select: SEL28, effectiveAt: T0 }),
    // the read's own registrar copy is the only key: the void is not authenticated, is not applied, and D2.void is NOT-EVALUABLE
    scenario("void-act-with-no-pinned-key", pair(KEY1), { pins: { methodology: false }, parameters: { ...PARAMS, "registrar-keys": [] }, select: SEL28, effectiveAt: T0 }),
    scenario("void-act-under-a-current-key", pair(KEY1), { select: SEL28, effectiveAt: T0 }),
    scenario("void-act-under-a-former-key", pair(KEY2), { parameters: former, select: SEL28, effectiveAt: T0 }),
  ] };
}
