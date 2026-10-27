/** Building signed events, Registry entries and excerpts from fixed values. No clock, no randomness. */
import { canonicalize, hashOf, withoutSig } from "../../lib/canonical.mjs";
import { signWithSeed } from "./signing.mjs";
import { KEY1, jwkOf, b64u } from "./keys.mjs";
import { addMonths, addSeconds, addDays } from "../../lib/time.mjs";
import { add, ZERO, fromNumber, toText } from "../../lib/decimal.mjs";

export const NETWORK = "ledger.example";
export const REGISTRY = "https://registry.example";
export const EXT_BASE = "https://andreibesleaga.com/sfc/extensions/";
export const STANDARD_PROFILE = { hardwareClass: "general-purpose-x86", asicForbidden: true, purchasedAt: "2024-03-01", expectedRetireAt: "2030-03-01", reusePolicy: "donate-to-education" };

export const signObject = (obj, key = KEY1) => {
  const bytes = signWithSeed(key.seed, Buffer.from(canonicalize(withoutSig(obj)), "utf8"));
  return { ...withoutSig(obj), sig: { alg: "Ed25519", value: b64u(bytes) } };
};

export class World {
  constructor({ network = NETWORK, registrar = KEY1, readAt } = {}) {
    this.network = network; this.registrar = registrar; this.readAt = readAt;
    this.entries = []; this.events = []; this.tips = new Map(); this.voids = []; this.opIndex = new Map();
  }
  /** Add a Registry entry (unsigned until `registry()`); returns its operator DID. */
  operator(name, { from = "2024-01-01T00:00:00Z", to = null, active, key = KEY1, keys, profile = STANDARD_PROFILE, version = 1, extra = {}, did, origin } = {}) {
    const op = did ?? `did:web:op-${name}.example`;
    this.opIndex.set(op, this.opIndex.size);
    this.entries.push({
      operator: op, origin: origin ?? `node.op-${name}.example`, network: this.network,
      active: active ?? [{ from, to }],
      keys: keys ?? [{ jwk: jwkOf(key), validFromCommit: "2024-01-01T00:00:00Z", validToCommit: null }],
      nodeProfile: profile, ...(version === null ? {} : { version }), ...extra,
    });
    (this.keyOf ??= new Map()).set(op, key);
    return op;
  }
  /** A 1.x-form Registry entry (inclusive full-date intervals, `public-jwk`, no `sig`). */
  entry1x(name, { active = [{ from: "2025-01-01", to: null }], key = KEY1, profile } = {}) {
    const op = `did:web:op-${name}.example`;
    this.opIndex.set(op, this.opIndex.size);
    (this.keyOf ??= new Map()).set(op, key);
    this.entries.push({
      operator: op, origin: `node.op-${name}.example`, active,
      keys: [{ "public-jwk": jwkOf(key), "valid-from-commit": "2024-01-01T00:00:00Z", "valid-to-commit": null }],
      ...(profile ? { nodeProfile: profile } : {}),
    });
    return op;
  }
  registry(signKey = this.registrar) { return this.entries.map((e) => (e.network === undefined ? e : signObject(e, signKey))); }

  /** A commit instant no other event or void holds: bumped by whole seconds until it is free. */
  freeCommit(commit) {
    const used = new Set([...this.events.map((e) => e.commit), ...this.voids.map((v) => v.commit)]);
    let c = commit;
    while (used.has(c)) c = addSeconds(c, 1);
    return c;
  }
  commitOf(op, type, start) {
    const base = addDays(addMonths(start, 1), 2); // two days after month end, inside the grace period
    return addSeconds(base, this.opIndex.get(op) * 120 + (type === "EnergyAttested" ? 0 : 60) + 12 * 3600);
  }
  tip(op, type) { return this.tips.get(`${op}|${type}`) ?? null; }

  /** Emit one 2.0 event. `o` overrides: commit, ts, prev, supersedes (false to omit), key, mutate(payload), event(extra members), network. */
  emit(op, type, start, payload, o = {}) {
    const end = addMonths(start, 1);
    const commit = this.freeCommit(o.commit ?? this.commitOf(op, type, start));
    const p = { period: { start, end }, ...payload };
    if (o.supersedes) p.supersedes = o.supersedes;
    if (o.mutate) o.mutate(p);
    const ev = {
      type, network: o.network ?? this.network, subject: op, actor: o.actor ?? op,
      prev: o.prev !== undefined ? o.prev : this.tip(op, type), ts: o.ts ?? addSeconds(end, 3600 * 8), payload: p, ...(o.event ?? {}),
    };
    const signed = signObject(ev, o.key ?? this.signerOf(op));
    let final = o.sigTransform ? { ...withoutSig(signed), sig: o.sigTransform(signed.sig) } : signed;
    if (o.rawSig) final = { ...withoutSig(signed), sig: { alg: "Ed25519", value: b64u(o.rawSig(Buffer.from(canonicalize(withoutSig(ev)), "utf8"))) } };
    const hash = hashOf(final);
    this.events.push({ commit, hash, event: final });
    if (!o.noTip) this.tips.set(`${op}|${type}`, hash);
    return hash;
  }
  signerOf(op) { return this.keyOf?.get(op) ?? KEY1; }

  energy(op, start, { kWh, nodes = 3, method = "hardware-metered", evidence = "ipfs://bafy-energy-example" }, o) {
    return this.emit(op, "EnergyAttested", start, { nodeCount: nodes, kWhConsumed: kWh, measurementMethod: method, evidence }, o);
  }
  /** Carbon event; offsets and flag are computed from the figures unless given. */
  carbon(op, start, f, o) {
    const retirements = f.retirements ?? [];
    const kg = retirements.reduce((a, r) => add(a, fromNumber(r.kg)), ZERO);
    const offsets = f.offsets ?? Number(toText(kg));
    const lhs = add(add(fromNumber(f.s1 ?? 0), fromNumber(f.s2)), fromNumber(f.s3));
    const flag = f.netZero ?? covers(lhs, offsets);
    const payload = {
      ...(f.s1 !== undefined ? { scope1KgCO2e: f.s1 } : {}),
      scope2KgCO2e: f.s2, ...(f.loc !== undefined ? { scope2LocationKgCO2e: f.loc } : {}),
      scope3KgCO2e: f.s3, gridIntensityRef: f.grid ?? "Electricity Maps zone XX, 2025, annual average",
      retirements, offsetsKgCO2e: offsets, netZero: flag, evidence: f.evidence ?? "https://ledger.example/evidence/carbon-example",
    };
    return this.emit(op, "CarbonAttested", start, payload, o);
  }
  /** An event in the 1.x form: `period` is {from, to} full dates, no `network`. */
  emit1x(op, type, from, to, payload, o = {}) {
    const commit = this.freeCommit(o.commit);
    const ev = { type, subject: op, actor: op, prev: o.prev !== undefined ? o.prev : this.tip(op, type), ts: o.ts, payload: { period: { from, to }, ...payload } };
    if (o.supersedes) ev.payload.supersedes = o.supersedes;
    const signed = signObject(ev, o.key ?? KEY1);
    const final = o.sig ? { ...withoutSig(signed), sig: o.sig } : signed;
    const hash = hashOf(final);
    this.events.push({ commit, hash, event: final });
    this.tips.set(`${op}|${type}`, hash);
    return hash;
  }
  /** Edit an emitted event after signing (so its signature no longer verifies); returns the new hash. */
  tamper(hash, edit) {
    const rec = this.events.find((e) => e.hash === hash);
    const copy = JSON.parse(JSON.stringify(rec.event));
    edit(copy);
    const next = hashOf(copy);
    for (const [k, v] of this.tips) if (v === hash) this.tips.set(k, next);
    rec.event = copy; rec.hash = next;
    return next;
  }
  void(target, commit, key = this.registrar) { this.voids.push(signObject({ commit, target }, key)); }

  /** The excerpt object: ledger sorted by commit instant unless `keepOrder`. */
  excerpt({ readAt = this.readAt, registry = this.registry(), keepOrder = false, profileVersion = "2.0", extra = {}, checkpoint } = {}) {
    const ledger = keepOrder ? this.events : [...this.events].sort((a, b) => (a.commit < b.commit ? -1 : a.commit > b.commit ? 1 : 0));
    const ex = {
      "excerpt-version": 2, "profile-version": profileVersion, network: this.network, "read-at": readAt,
      registrar: { jwk: jwkOf(this.registrar) }, registry, ledger, ...(this.voids.length ? { voids: this.voids } : {}), ...extra,
    };
    if (checkpoint) ex.checkpoint = checkpoint(ex);
    return ex;
  }
}
const covers = (lhs, offsets) => {
  const o = fromNumber(offsets);
  const s = Math.max(lhs.s, o.s);
  return lhs.n * 10n ** BigInt(s - lhs.s) <= o.n * 10n ** BigInt(s - o.s);
};

export const retirement = (reference, kg, { tonnes = 1, at, registry = REGISTRY, beneficiary } = {}) =>
  ({ registry, reference, tonnesRetired: tonnes, retiredAt: at, kg, ...(beneficiary ? { beneficiary } : {}) });

/** The `chains` of a checkpoint: tip and count of each (operator, type) chain of the read, `omit` names chains to leave out. */
function checkpointChains(ex, omit) {
  const last = new Map();
  const count = new Map();
  for (const l of ex.ledger) {
    const k = `${l.event.subject}|${l.event.type}`;
    last.set(k, l.hash); count.set(k, (count.get(k) ?? 0) + 1);
  }
  const chains = [];
  for (const en of ex.registry) for (const type of ["EnergyAttested", "CarbonAttested"]) {
    const k = `${en.operator}|${type}`;
    if (omit.includes(k)) continue;
    chains.push({ operator: en.operator, type, tip: last.get(k) ?? null, count: count.get(k) ?? 0 });
  }
  return chains;
}

/** A checkpoint signed by the registrar over every chain of `ex` at its read-at. */
export function makeCheckpoint(ex, key = KEY1, { digests = true, voidsDigest = true, omit = [], network } = {}) {
  const sorted = [...ex.registry].sort((a, b) => (a.operator < b.operator ? -1 : 1));
  const cp = { network: network ?? ex.network, "read-at": ex["read-at"], chains: checkpointChains(ex, omit) };
  if (digests) {
    cp["registry-digest"] = hashOf(sorted);
    cp["ledger-digest"] = hashOf(ex.ledger);
    if (voidsDigest) cp["voids-digest"] = hashOf(ex.voids ?? []);
  }
  return signObject(cp, key);
}
