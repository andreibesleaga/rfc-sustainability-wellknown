/**
 * Builds signed SFC 2.0 events, Registry entries and ledger reads (excerpt format 2) from fixed
 * values, for the tests of the 2.0 bridge. No clock, no randomness: every instant is computed from
 * the month, every signature is made with the RFC 8032 test key (whose private half is public).
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (5.1 to 5.8)
 */
import { SFC_LEDGER_TEST_PRIVATE_JWK } from "../src/adapters/sfc-ledger-fixture";
import { signWithJwk } from "../src/adapters/sfc-ledger-2/ed25519";
import { addMonths, b64u, canonicalize, dayAfter, hashOf, withoutSig } from "../src/adapters/sfc-ledger-2/primitives";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

export const NETWORK = "ledger.example";
export const REGISTRY = "https://registry.example";
export const REGISTRAR_X = SFC_LEDGER_TEST_PRIVATE_JWK.x;
const JWK = { kty: "OKP", crv: "Ed25519", x: REGISTRAR_X };
export const STANDARD_PROFILE = { hardwareClass: "general-purpose-x86", asicForbidden: true, purchasedAt: "2024-03-01", expectedRetireAt: "2030-03-01", reusePolicy: "donate-to-education" };

/** The methodology parameters the bridge needs to judge retirements (7.6), and the pins that go with them. */
export const PARAMETERS = {
  "registrar-keys": [{ jwk: JWK, status: "current" }],
  "retirement-registries": [REGISTRY],
  "reference-forms": [{ registry: REGISTRY, rules: ["upper-case", "no-surrounding-space"] }],
};
export const PINS = { methodology: true, registrar: { [NETWORK]: [REGISTRAR_X] } };

/** Ed25519 over the RFC 8785 text without `sig`, with the test key (3.6 rule 2). */
export function signObject(obj: Json): Json {
  const bytes = signWithJwk(SFC_LEDGER_TEST_PRIVATE_JWK, Buffer.from(canonicalize(withoutSig(obj)), "utf8"));
  return { ...withoutSig(obj), sig: { alg: "Ed25519", value: b64u(bytes) } };
}

/** A retirement citation (5.4): one tonne by default, `kg` of it counted here. */
export const retirement = (reference: string, kg: number, o: { at: string; tonnes?: number; registry?: string }): Json => ({
  registry: o.registry ?? REGISTRY, reference, tonnesRetired: o.tonnes ?? 1, retiredAt: o.at, kg,
});

export interface EventOptions {
  commit?: string;
  supersedes?: string;
  prev?: string | null;
  /** Replace the signature algorithm name after signing (the signature stays Ed25519). */
  alg?: string;
}

/** The `second` day after a month's end, at noon, plus an offset in seconds: inside the grace period (3.2). */
function commitOf(month: string, seconds: number): string {
  const day2 = dayAfter(dayAfter(addMonths(month, 1).slice(0, 10)).slice(0, 10)).slice(0, 10);
  const s = 12 * 3600 + seconds;
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${day2}T${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}Z`;
}

export class World {
  entries: Json[] = [];
  events: { commit: string; hash: string; event: Json }[] = [];
  private tips = new Map<string, string>();
  private index = new Map<string, number>();
  constructor(readonly readAt: string, readonly network = NETWORK) {}

  /** A Registry entry (2.0 form, signed by the registrar); returns the operator's DID. */
  operator(name: string, o: { from?: string; to?: string | null; profile?: Json | null } = {}): string {
    const did = `did:web:op-${name}.example`;
    this.index.set(did, this.index.size);
    const profile = o.profile === undefined ? STANDARD_PROFILE : o.profile;
    this.entries.push({
      operator: did, origin: `node.op-${name}.example`, network: this.network,
      active: [{ from: o.from ?? "2024-12-01T00:00:00Z", to: o.to ?? null }],
      keys: [{ jwk: JWK, validFromCommit: "2024-01-01T00:00:00Z", validToCommit: null }],
      ...(profile ? { nodeProfile: profile } : {}), version: 1,
    });
    return did;
  }

  private emit(op: string, type: string, month: string, payload: Json, o: EventOptions): string {
    const end = addMonths(month, 1);
    const seconds = (this.index.get(op) ?? 0) * 120 + (type === "EnergyAttested" ? 0 : 60);
    const commit = o.commit ?? commitOf(month, seconds);
    const body = { period: { start: month, end }, ...payload, ...(o.supersedes ? { supersedes: o.supersedes } : {}) };
    const tip = this.tips.get(`${op}|${type}`) ?? null;
    const event = signObject({ type, network: this.network, subject: op, actor: op, prev: o.prev !== undefined ? o.prev : tip, ts: `${commit.slice(0, 11)}00:00:00Z`, payload: body });
    const final = o.alg ? { ...event, sig: { ...event.sig, alg: o.alg } } : event;
    const hash = hashOf(final);
    this.events.push({ commit, hash, event: final });
    this.tips.set(`${op}|${type}`, hash);
    return hash;
  }

  energy(op: string, month: string, f: { kWh: number; nodes?: number; method?: string }, o: EventOptions = {}): string {
    return this.emit(op, "EnergyAttested", month, { nodeCount: f.nodes ?? 3, kWhConsumed: f.kWh, measurementMethod: f.method ?? "hardware-metered", evidence: "ipfs://bafy-energy-example" }, o);
  }

  /** `offsetsKgCO2e` is the sum of the retirements' `kg`, `netZero` the section 6 comparison, unless given. */
  carbon(op: string, month: string, f: { s1?: number; s2: number; s3: number; loc?: number; retirements?: Json[]; netZero?: boolean }, o: EventOptions = {}): string {
    const retirements = f.retirements ?? [];
    const offsets = retirements.reduce((a: number, r: Json) => a + r.kg, 0);
    const gross = (f.s1 ?? 0) + f.s2 + f.s3;
    const payload = {
      ...(f.s1 !== undefined ? { scope1KgCO2e: f.s1 } : {}), scope2KgCO2e: f.s2, ...(f.loc !== undefined ? { scope2LocationKgCO2e: f.loc } : {}),
      scope3KgCO2e: f.s3, gridIntensityRef: "grid.example zone-a 2025 annual average", retirements, offsetsKgCO2e: offsets,
      netZero: f.netZero ?? gross <= offsets, evidence: "https://ledger.example/evidence/carbon",
    };
    return this.emit(op, "CarbonAttested", month, payload, o);
  }

  /** The read: events in commit order, entries signed by the registrar. */
  excerpt(o: { readAt?: string; mutateRegistry?: (entries: Json[]) => Json[] } = {}): Json {
    const registry = (o.mutateRegistry ?? ((e: Json[]) => e))(this.entries).map((e: Json) => signObject(e));
    const ledger = [...this.events].sort((a, b) => (a.commit < b.commit ? -1 : a.commit > b.commit ? 1 : 0));
    return { "excerpt-version": 2, "profile-version": "2.0", network: this.network, "read-at": o.readAt ?? this.readAt, registrar: { jwk: JWK }, registry, ledger };
  }
}
