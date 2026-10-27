/**
 * The SFC profile 2.0 ledger bridge in the gateway: the excerpt reader, the objects the bridge writes
 * (spec 7.1 to 7.5, 8), the shallow and deep checks (9.3, 9.4) and the wiring of the three 2.0
 * demonstrations. One describe per part; the vectors of the profile are run in
 * `sfc-ledger-2-vectors.test.ts`.
 *
 * Deterministic: fixed instants, the public RFC 8032 test key, no network, no wall clock.
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 */
import { createHash, generateKeyPairSync } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { Publisher, importSigningKey, signDeclaration, type SustainabilityMetrics } from "sustainability-wellknown-publisher";
import { validateDocument } from "sustainability-wellknown-consumer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoSpecs } from "../src/adapters/demo-specs";
import { bridge2 } from "../src/adapters/sfc-ledger-2/bridge";
import * as ed from "../src/adapters/sfc-ledger-2/ed25519";
import { Bridge2Error, excerptFormatOf, readExcerptV2 } from "../src/adapters/sfc-ledger-2/excerpt";
import {
  SFC_LEDGER_DEMO_2_DOMAIN, SFC_NETWORK_2_DOMAIN, SFC_OPERATOR_2_DOMAIN, deepCheck, isReadUnderSfc2, ledgerAccessUriOf, readExcerpt, sfcLedgerBridgeAdapter, shallowCheck, type CheckReport,
} from "../src/adapters/sfc-ledger-bridge";
import { MECHANISMS } from "../src/adapters/sfc-ledger-2/window";
import {
  SFC_LEDGER_2_DISCLOSURE_URI, SFC_LEDGER_2_FIXTURE, SFC_LEDGER_2_METHODOLOGY_URI, SFC_LEDGER_2_PARAMETERS, SFC_LEDGER_2_PERIOD, SFC_LEDGER_2_PINS, SFC_LEDGER_2_PROVIDER, SFC_LEDGER_2_UPDATED,
  SFC_LEDGER_FIXTURE, SFC_LEDGER_TEST_PRIVATE_JWK, SFC_LEDGER_TEST_PUBLIC_JWK, SFC_NETWORK_2_EXAMPLE, SFC_NETWORK_2_EXAMPLE_LOCATION, SFC_OPERATOR_2_EXAMPLE,
} from "../src/adapters/sfc-ledger-fixture";
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../src/adapters/sfc-ledger-profile";
import { ADDRESS_RULE, fetchJson, parseArgs, runCheck } from "../scripts/sfc-ledger-check.mjs";
import { startGateway, type TestServer } from "./helpers";
import { PARAMETERS, PINS, REGISTRY, World, retirement } from "./sfc2-builder";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const EXT = PROFILE.namespace;
const EV2 = PROFILE.extensions.ledgerEvidence2;
const CN = PROFILE.extensions.carbonNeutrality;
const HW = PROFILE.extensions.hardwareLifecycle;
const NT = PROFILE.extensions.networkTopology;
const SFC_REPO = resolve(__dirname, "..", "..", "sfc-compliance");

const READ_AT = "2026-05-02T00:10:00Z";
const UPDATED = "2026-02-10T09:00:00Z";
const YEAR = { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };
const JAN = { start: "2025-01-01T00:00:00Z", end: "2025-02-01T00:00:00Z" };
const month = (m: number): string => `2025-${String(m).padStart(2, "0")}-01T00:00:00Z`;
const ACCESS = "https://ledger.example/sfc/read";
const DISCLOSURE = "https://ledger.example/sustainability/disclosures.json";

const clone = <T>(v: T): T => structuredClone(v);
const rows = (r: CheckReport, id: string) => r.rows.filter((x) => x.id === id);
const row = (r: CheckReport, id: string) => {
  const found = rows(r, id);
  expect(found, `row ${id}`).toHaveLength(1);
  return found[0];
};

/** FAIL rows that make a read faulty or a declaration inconsistent with it (D2 to D6, C-SFC-7); the window rows judge the network, not the read. */
const blocking = (r: CheckReport) => r.rows.filter((x) => x.status === "FAIL" && /^(D[2-6]|C-SFC-7)(\.|$)/.test(x.id));

// ---------------------------------------------------------------------------
// A small world: operators a and b of the network ledger.example, twelve months of 2025
// ---------------------------------------------------------------------------

interface YearOptions {
  /** `(operator index, month index, type)` of an event to leave out: a silent operator-month. */
  skip?: (j: number, i: number, type: "energy" | "carbon") => boolean;
  /** Scope 2 on the location basis, kg, for every month; absent: not attested. */
  loc?: number;
  /** Scope 1 of operator b in June. */
  scope1?: boolean;
  names?: string[];
}

/** Figures of operator j in month i (i = 0 is January). Every number is invented. */
const figs = (j: number, i: number) => ({ kWh: 1000 + 100 * j + i, s2: 100 + 10 * j + i / 4, s3: 50 + 5 * j, nodes: 3 + j });

function yearWorld(o: YearOptions = {}): { w: World; ops: string[]; energy: Map<string, string>; carbon: Map<string, string> } {
  const w = new World(READ_AT);
  const ops = (o.names ?? ["a", "b"]).map((n) => w.operator(n));
  const energy = new Map<string, string>();
  const carbon = new Map<string, string>();
  for (let i = 0; i < 12; i++) {
    const m = month(i + 1);
    const dayAfterEnd = `2025-${String(i + 2).padStart(2, "0")}-02T00:00:00Z`;
    ops.forEach((op, j) => {
      const f = figs(j, i);
      if (!o.skip?.(j, i, "energy")) energy.set(`${j}|${i}`, w.energy(op, m, { kWh: f.kWh, nodes: f.nodes, method: j === 1 ? "cloud-billing" : "hardware-metered" }));
      if (!o.skip?.(j, i, "carbon")) {
        const at = i === 11 ? "2026-01-02T00:00:00Z" : dayAfterEnd;
        carbon.set(`${j}|${i}`, w.carbon(op, m, { s1: o.scope1 && j === 1 && i === 5 ? 12.5 : undefined, s2: f.s2, s3: f.s3, loc: o.loc, retirements: [retirement(`RET-${"AB"[j]}-${i + 1}`, 1000, { at })] }));
      }
    });
  }
  return { w, ops, energy, carbon };
}

const OPTIONS = {
  mode: "network" as const, provider: "SYNTHETIC test provider", methodologyUri: SFC_LEDGER_2_METHODOLOGY_URI, ledgerAccessUri: ACCESS, disclosureUri: DISCLOSURE,
  period: YEAR, updated: UPDATED, target: "ledger.example", energyUnit: "kWh" as const, carbonUnit: "kgCO2e" as const, consensusMechanism: "proof-of-authority",
  parameters: PARAMETERS, pins: PINS,
};
const run = (excerpt: Json, o: Json = {}) => bridge2(readExcerptV2(excerpt), { ...OPTIONS, ...o });
const refusal = (f: () => unknown): Bridge2Error => {
  try {
    f();
  } catch (err) {
    expect(err).toBeInstanceOf(Bridge2Error);
    return err as Bridge2Error;
  }
  throw new Error("expected a refusal");
};

let key: Awaited<ReturnType<typeof importSigningKey>>;
beforeAll(async () => {
  key = await importSigningKey(SFC_LEDGER_TEST_PRIVATE_JWK);
});
/** A declaration as the gateway would serve it: signed by the publisher library with the test key. */
const signed = (doc: Json): Promise<Json> => signDeclaration(clone(doc) as SustainabilityMetrics, key);

// ---------------------------------------------------------------------------
// 1. The excerpt reader, format version 2
// ---------------------------------------------------------------------------

describe("Ed25519 verdicts", () => {
  const triple = () => {
    const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; d: string };
    const msg = Buffer.from("a message", "utf8");
    return { pub: Buffer.from(jwk.x, "base64url"), msg, sig: ed.signWithJwk(jwk, msg) };
  };

  it("a valid signature verifies, and a wrong message is a mismatch", () => {
    const { pub, msg, sig } = triple();
    expect(ed.verify(pub, msg, sig)).toEqual({ ok: true });
    expect(ed.verify(pub, Buffer.from("another message"), sig)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("a different split of the same bytes is never answered from the cached verdict of the valid triple", () => {
    const { pub, msg, sig } = triple();
    expect(ed.verify(pub, msg, sig)).toEqual({ ok: true });
    const shortPub = pub.subarray(0, 31);
    const longSig = Buffer.concat([pub.subarray(31), sig]);
    expect(ed.verify(shortPub, msg, longSig)).toEqual({ ok: false, reason: "encoding-length" });
  });
});

describe("excerpt format 2 reader", () => {
  it("reads the recorded three-operator network and keeps every member as received", () => {
    const read = readExcerptV2(SFC_LEDGER_2_FIXTURE);
    expect(read.profile).toBe(PROFILE);
    expect(read.excerpt["read-at"]).toBe(READ_AT);
    expect(read.excerpt.registry).toHaveLength(3);
    expect(read.excerpt.ledger).toHaveLength(90);
    expect(read.excerpt.ledger[0].event.payload.period).toEqual({ start: "2025-01-01T00:00:00Z", end: "2025-02-01T00:00:00Z" });
    expect(read.excerpt.registry[0].origin).toBe("node.op-a.example");
    expect(read.excerpt.registry[0].keys[0].jwk.x).toBe(SFC_LEDGER_TEST_PUBLIC_JWK.x);
    expect(read.excerpt.registry[0].nodeProfile.hardwareClass).toBe("general-purpose-x86");
    expect(read.excerpt.ledger[1].event.payload.retirements[0].registry).toBe(REGISTRY);
  });

  it("tells the two formats apart, and reads both: format 1 stays on its own reader", () => {
    expect(excerptFormatOf(SFC_LEDGER_2_FIXTURE)).toBe(2);
    expect(excerptFormatOf(SFC_LEDGER_FIXTURE)).toBe(1);
    expect(excerptFormatOf({ "excerpt-version": 3 })).toBeUndefined();
    expect(excerptFormatOf("text")).toBeUndefined();
    expect(readExcerpt(SFC_LEDGER_FIXTURE).profile.version).toBe("1.2");
    expect(() => readExcerptV2(SFC_LEDGER_FIXTURE)).toThrow("[E-SHAPE] excerpt.excerpt-version");
  });

  it("accepts a later minor version (12.2 rule 3) and a 1.x Registry entry beside 2.0 entries (12.1 rule 6)", () => {
    const later = { ...clone(SFC_LEDGER_2_FIXTURE), "profile-version": "2.7" } as Json;
    expect(readExcerptV2(later).excerpt["profile-version"]).toBe("2.7");
    const w = new World(READ_AT);
    w.operator("a");
    const withOld = w.excerpt();
    withOld.registry.push({ operator: "did:web:op-old.example", origin: "node.op-old.example", active: [{ from: "2024-12-01", to: null }], keys: [{ "public-jwk": { kty: "OKP", crv: "Ed25519", x: SFC_LEDGER_TEST_PUBLIC_JWK.x }, "valid-from-commit": "2024-01-01T00:00:00Z", "valid-to-commit": null }] });
    expect(readExcerptV2(withOld).excerpt.registry).toHaveLength(2);
  });

  const x = () => clone(SFC_LEDGER_2_FIXTURE) as Json;
  const defects: [string, (e: Json) => void, string][] = [
    ["a profile that is not 2.<digits>", (e) => { e["profile-version"] = "1.2"; }, "excerpt.profile-version"],
    ["profile 3.0", (e) => { e["profile-version"] = "3.0"; }, "excerpt.profile-version"],
    ["a network that is not a host", (e) => { e.network = "https://ledger.example"; }, "excerpt.network"],
    ["a read-at that is not an instant", (e) => { e["read-at"] = "2026-05-02"; }, "excerpt['read-at']"],
    ["a lower-case t in read-at", (e) => { e["read-at"] = "2026-05-02t00:10:00Z"; }, "excerpt['read-at']"],
    ["a missing registrar", (e) => { delete e.registrar; }, "excerpt.registrar"],
    ["a registrar key of another curve", (e) => { e.registrar.jwk.crv = "P-256"; }, "excerpt.registrar"],
    ["a Registry that is not an array", (e) => { e.registry = {}; }, "excerpt.registry"],
    ["a Registry entry without origin", (e) => { delete e.registry[1].origin; }, "excerpt.registry[1]"],
    ["a Registry entry with a mid-month interval", (e) => { e.registry[0].active[0].from = "2024-12-15T00:00:00Z"; }, "excerpt.registry[0]"],
    ["a Registry entry that forbids a member", (e) => { e.registry[2].commit = "x"; }, "excerpt.registry[2]"],
    ["a ledger that is not an array", (e) => { e.ledger = null; }, "excerpt.ledger"],
    ["a ledger entry without a hash", (e) => { delete e.ledger[3].hash; }, "excerpt.ledger[3]"],
    ["a ledger entry with a short hash", (e) => { e.ledger[3].hash = "ab"; }, "excerpt.ledger[3]"],
    ["a ledger entry whose event has no payload", (e) => { delete e.ledger[4].event.payload; }, "excerpt.ledger[4].event"],
    ["voids that are not void acts", (e) => { e.voids = [{ commit: "2026-03-01T00:00:00Z", target: "ab", sig: { alg: "Ed25519", value: "x" } }]; }, "excerpt.voids[0]"],
    ["a void act with an extra member", (e) => { e.voids = [{ commit: "2026-03-01T00:00:00Z", target: "0".repeat(64), sig: { alg: "Ed25519", value: "x" }, why: "no" }]; }, "excerpt.voids[0]"],
    ["a checkpoint with an extra member", (e) => { e.checkpoint = { network: "ledger.example", "read-at": READ_AT, chains: [], sig: { alg: "Ed25519", value: "x" }, extra: 1 }; }, "excerpt.checkpoint"],
    ["a notice that is not text", (e) => { e.notice = 5; }, "excerpt.notice"],
  ];
  for (const [name, edit, path] of defects) {
    it(`refuses ${name} with [E-SHAPE] naming ${path}`, () => {
      const e = x();
      edit(e);
      const err = refusal(() => readExcerptV2(e));
      expect(err.code).toBe("E-SHAPE");
      expect(err.message).toContain(path);
    });
  }

  it("refuses an excerpt that is not an object", () => {
    for (const v of [null, [], "x", 3]) expect(refusal(() => readExcerptV2(v)).code).toBe("E-SHAPE");
  });

  it("reads or refuses [E-SHAPE] every excerpt of the test vectors, never anything else", () => {
    let read = 0;
    let refused = 0;
    const dir = join(SFC_REPO, "vectors", "inputs");
    for (const f of readdirSync(dir)) {
      const file = JSON.parse(readFileSync(join(dir, f), "utf8")) as Json;
      for (const e of Object.values(file.excerpts ?? {}) as Json[]) {
        try {
          readExcerptV2(e);
          read++;
        } catch (err) {
          expect((err as Bridge2Error).code).toBe("E-SHAPE");
          refused++;
        }
      }
    }
    expect(read).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. What the bridge writes
// ---------------------------------------------------------------------------

describe("bridge output, SFC profile 2.0", () => {
  const year = yearWorld({ scope1: true, loc: 90 });
  const excerpt = year.w.excerpt();
  const out = run(excerpt, { renewableEnergy: 80, pairedLocation: true });

  it("writes the market-based primary object with the seven mandatory members and the 7.4 figures", () => {
    const p = out.primary;
    for (const m of ["updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target"]) expect(p[m], m).toBeDefined();
    expect(p["target-type"]).toBe("service");
    expect(p["carbon-accounting"]).toBe("market-based");
    expect(p["energy-unit"]).toBe("kWh");
    expect(p["carbon-unit"]).toBe("kgCO2e");
    // sum of kWh: operator a 12 x 1000 + (0..11), operator b 12 x 1100 + (0..11)
    expect(p["energy-consumption"]).toBe(12_000 + 66 + 13_200 + 66);
    expect(p["scope-1"]).toBe(12.5);
    expect(p["scope-2"]).toBe(1200 + 16.5 + 1320 + 16.5);
    expect(p["scope-3"]).toBe(50 * 12 + 55 * 12);
    expect(p["carbon-footprint"]).toBe(12.5 + p["scope-2"] + p["scope-3"]);
    expect(p["renewable-energy"]).toBe(80);
    expect(p["disclosure-uri"]).toBe(DISCLOSURE);
    expect(p.period).toEqual(YEAR);
    expect(p.updated).toBe(UPDATED);
  });

  it("carries the extensions of section 8 and the members of ledger-evidence-2 exactly as the spec lists them", () => {
    const ext = out.primary.extensions;
    expect(Object.keys(ext).sort()).toEqual([CN, EV2, HW, NT].sort());
    expect(ext[HW]).toEqual({ "general-purpose-hardware": true, "single-use-asic-required": false });
    expect(ext[NT]).toEqual({ "consensus-mechanism": "proof-of-authority", "validated-node-count": 3 + 4, "node-count-validation-method": expect.stringContaining("maximum over the months") });
    expect(Object.keys(ext[CN]).sort()).toEqual(["net-zero-status", "offsets-retired-tCO2e"]);
    const ev = ext[EV2];
    expect(Object.keys(ev)).toEqual(["profile-version", "ledger-access-uri", "operators", "network-offset-coverage"]);
    expect(ev["profile-version"]).toBe("2.0");
    expect(ev["ledger-access-uri"]).toBe(ACCESS);
    expect(Object.keys(ev.operators[0])).toEqual([
      "operator", "origin", "energy-head", "carbon-head", "energy-events", "carbon-events", "kwh", "scope1-kgco2e", "scope2-kgco2e", "scope3-kgco2e", "offsets-kgco2e", "offset-coverage-every-period",
    ]);
    expect(ev.operators.map((o: Json) => o.operator)).toEqual(["did:web:op-a.example", "did:web:op-b.example"]);
    expect(ev.operators[1]["scope1-kgco2e"]).toBe(12.5);
    expect(ev.operators[0]["scope1-kgco2e"]).toBe(0);
    expect(ev.operators[0]["energy-events"]).toBe(12);
    expect(ev["network-offset-coverage"]).toBe(true);
    expect(ext[CN]["net-zero-status"]).toBe("achieved");
    expect(ext[CN]["offsets-retired-tCO2e"]).toBe(24);
  });

  it("the cut-off is the object's updated: a correction committed after it is not counted", () => {
    const w = yearWorld().w;
    const before = run(w.excerpt()).primary;
    const first = w.events.find((e) => e.event.type === "EnergyAttested" && e.event.subject === "did:web:op-a.example")!;
    w.energy("did:web:op-a.example", month(1), { kWh: 5000 }, { supersedes: first.hash, commit: "2026-03-01T00:00:00Z" });
    const x2 = w.excerpt();
    const same = run(x2).primary;
    expect(same["energy-consumption"]).toBe(before["energy-consumption"]);
    expect(same.extensions[EV2].operators[0]["energy-head"]).toBe(before.extensions[EV2].operators[0]["energy-head"]);
    const later = run(x2, { updated: "2026-04-01T00:00:00Z" }).primary;
    expect(later["energy-consumption"]).toBe(before["energy-consumption"] - 1000 + 5000);
    expect(later.extensions[EV2].operators[0]["energy-events"]).toBe(13);
    // a correction is a correction: the earlier effective attestation stays in the chain and the head moves
    expect(later.extensions[EV2].operators[0]["energy-head"]).not.toBe(before.extensions[EV2].operators[0]["energy-head"]);
  });

  it("an operator with no event in the period has null heads and zero counts, and the object is INCOMPLETE, not refused", () => {
    const w = new World(READ_AT);
    const a = w.operator("a");
    w.operator("b");
    for (let i = 0; i < 12; i++) {
      w.energy(a, month(i + 1), { kWh: 100 });
      w.carbon(a, month(i + 1), { s2: 10, s3: 5, retirements: [retirement(`RET-A-${i + 1}`, 1000, { at: `2025-${String(i + 2).padStart(2, "0")}-02T00:00:00Z`.replace("2025-13", "2026-01") })] });
    }
    const p = run(w.excerpt()).primary;
    const b = p.extensions[EV2].operators[1];
    expect(b["energy-head"]).toBeNull();
    expect(b["carbon-head"]).toBeNull();
    expect(b["energy-events"]).toBe(0);
    expect(b["kwh"]).toBe(0);
    expect(p["energy-consumption"]).toBeUndefined();
    expect(p["scope-2"]).toBeUndefined();
    expect(p.extensions[EV2]["network-offset-coverage"]).toBe(false);
    expect(p.extensions[CN]["net-zero-status"]).toBe("partial");
  });

  it("a silent operator-month gives an INCOMPLETE object that omits what the silent type feeds (7.5)", () => {
    const energySilent = run(yearWorld({ skip: (j, i, t) => j === 0 && i === 3 && t === "energy" }).w.excerpt()).primary;
    for (const m of ["energy-consumption", "energy-unit", "carbon-intensity-gCO2e-per-kWh"]) expect(energySilent[m], m).toBeUndefined();
    expect(energySilent.extensions[NT]["validated-node-count"]).toBeUndefined();
    expect(energySilent.extensions[NT]["node-count-validation-method"]).toBeUndefined();
    expect(energySilent["scope-2"]).toBeDefined(); // an energy-silent month leaves the carbon members and the flags to the carbon attestations
    expect(energySilent.extensions[EV2]["network-offset-coverage"]).toBe(true);
    expect(energySilent.extensions[EV2].operators[0]["energy-events"]).toBe(11);

    const carbonSilent = run(yearWorld({ skip: (j, i, t) => j === 1 && i === 7 && t === "carbon" }).w.excerpt()).primary;
    for (const m of ["scope-1", "scope-2", "scope-3", "carbon-footprint", "carbon-accounting", "carbon-unit", "carbon-intensity-gCO2e-per-kWh"]) expect(carbonSilent[m], m).toBeUndefined();
    expect(carbonSilent.extensions[CN]["offsets-retired-tCO2e"]).toBeUndefined();
    expect(carbonSilent["energy-consumption"]).toBeDefined();
    expect(carbonSilent.extensions[EV2]["network-offset-coverage"]).toBe(false);
    expect(carbonSilent.extensions[EV2].operators[1]["offset-coverage-every-period"]).toBe(false);
    expect(carbonSilent.extensions[EV2].operators[0]["offset-coverage-every-period"]).toBe(true);
    expect(carbonSilent.extensions[EV2].operators[1]["carbon-events"]).toBe(11);
    expect(carbonSilent.extensions[CN]["net-zero-status"]).toBe("partial");
  });

  it("the INCOMPLETE object still passes the deep check, and its verdict names the silent month", () => {
    const x = yearWorld({ skip: (j, i, t) => j === 1 && i === 7 && t === "carbon" }).w.excerpt();
    const o = run(x);
    const report = deepCheck(o.primary, x, { parameters: PARAMETERS, pins: PINS });
    expect(blocking(report)).toEqual([]);
    expect(row(report, "C-SFC-7").status).toBe("PASS");
    expect(rows(report, "C-SFC-4").find((x) => x.scope?.startsWith("period"))!.status).toBe("FAIL");
  });

  it("a period with no active operator in a month is INCOMPLETE as well", () => {
    const w = new World(READ_AT);
    const a = w.operator("a", { from: "2025-04-01T00:00:00Z" });
    for (let i = 3; i < 12; i++) {
      w.energy(a, month(i + 1), { kWh: 10 });
      w.carbon(a, month(i + 1), { s2: 1, s3: 1, retirements: [retirement(`RET-X-${i}`, 1000, { at: `2025-${String(i + 2).padStart(2, "0")}-02T00:00:00Z`.replace("2025-13", "2026-01") })] });
    }
    const p = run(w.excerpt()).primary;
    expect(p["energy-consumption"]).toBeUndefined();
    expect(p.extensions[EV2]["network-offset-coverage"]).toBe(false);
    expect(p.extensions[CN]["net-zero-status"]).not.toBe("achieved");
  });

  it("the optional location object follows 7.3: same energy, own Scope 2, own footprint and own intensity", () => {
    const loc = out.location!;
    const p = out.primary;
    expect(loc["carbon-accounting"]).toBe("location-based");
    expect(loc.extensions).toBeUndefined();
    for (const m of ["target", "target-type", "period", "energy-consumption", "energy-unit", "carbon-unit", "disclosure-uri"]) expect(loc[m], m).toEqual(p[m]);
    expect(loc["scope-2"]).toBe(90 * 24);
    expect(loc["carbon-footprint"]).toBe(12.5 + 90 * 24 + p["scope-3"]);
    expect(loc["scope-1"]).toBeUndefined();
    expect(loc["scope-3"]).toBeUndefined();
    // each object's intensity is its own Scope 2 per kWh (7.4): 1000 x kg / kWh, six places, half to even
    expect(p["carbon-intensity-gCO2e-per-kWh"]).toBe(Math.round((p["scope-2"] * 1000 * 1e6) / p["energy-consumption"]) / 1e6);
    expect(loc["carbon-intensity-gCO2e-per-kWh"]).toBe(Math.round((loc["scope-2"] * 1000 * 1e6) / p["energy-consumption"]) / 1e6);
    expect(loc["carbon-intensity-gCO2e-per-kWh"]).not.toBe(p["carbon-intensity-gCO2e-per-kWh"]);
    expect(out.rawLocation!.carbonAccounting).toBe("location-based");
  });

  it("writes no location object when a counted carbon attestation lacks scope2LocationKgCO2e, or when none is asked for", () => {
    expect(run(yearWorld({ loc: undefined }).w.excerpt(), { pairedLocation: true }).location).toBeUndefined();
    expect(run(excerpt).location).toBeUndefined();
    const carbonSilent = run(yearWorld({ loc: 90, skip: (j, i, t) => j === 1 && i === 7 && t === "carbon" }).w.excerpt(), { pairedLocation: true });
    expect(carbonSilent.location).toBeUndefined();
  });

  it("Scope 1 goes into scope-1 and into the gross footprint, and is absent when no attestation carries it", () => {
    const none = run(yearWorld().w.excerpt()).primary;
    expect(none["scope-1"]).toBeUndefined();
    expect(none["carbon-footprint"]).toBe(none["scope-2"] + none["scope-3"]);
    expect(none.extensions[EV2].operators.every((o: Json) => o["scope1-kgco2e"] === 0)).toBe(true);
    expect(out.primary["carbon-footprint"]).toBe(out.primary["scope-1"] + out.primary["scope-2"] + out.primary["scope-3"]);
    expect(out.primary["carbon-footprint"]).toBeGreaterThan(out.primary["scope-2"] + out.primary["scope-3"]);
  });

  it("measurement-method is the least direct among counted events", () => {
    expect(out.primary["measurement-method"]).toBe("cloud-billing");
    expect(run(yearWorld({ names: ["a"] }).w.excerpt()).primary["measurement-method"]).toBe("hardware-metered");
  });

  it("figures are the exact sums rounded half to even to six places, in the chosen unit", () => {
    const w = new World(READ_AT);
    const a = w.operator("a");
    for (let i = 0; i < 12; i++) {
      w.energy(a, month(i + 1), { kWh: i === 0 ? 1.2345 : 1 });
      w.carbon(a, month(i + 1), { s2: 0.1, s3: 0.2, retirements: [retirement(`RET-A-${i + 1}`, 1000, { at: `2025-${String(i + 2).padStart(2, "0")}-02T00:00:00Z`.replace("2025-13", "2026-01") })] });
    }
    expect(run(w.excerpt()).primary["energy-consumption"]).toBe(12.2345);
    // 12.2345 kWh is 0.0122345 MWh: a tie at the sixth place, and half to even gives ...234
    const mwh = run(w.excerpt(), { energyUnit: "MWh", carbonUnit: "tCO2e" }).primary;
    expect(mwh["energy-consumption"]).toBe(0.012234);
    expect(mwh["scope-2"]).toBe(0.0012);
    expect(mwh["scope-3"]).toBe(0.0024);
  });

  it("the signature algorithm is Ed25519 only: an event under another name is skipped and the bridge refuses the faulty read", () => {
    const y = yearWorld({ names: ["a"] });
    const first = y.w.events[0];
    first.event = { ...first.event, sig: { ...first.event.sig, alg: "ES256" } };
    const err = refusal(() => run(y.w.excerpt()));
    expect(err.code).toBe("E-LEDGER");
    expect(err.message).toContain("D3");
  });

  it("single use of each tonne (L9): two operators citing one retirement is refused as a faulty read", () => {
    const w = new World(READ_AT);
    const a = w.operator("a");
    const b = w.operator("b");
    for (let i = 0; i < 12; i++) {
      const at = `2025-${String(i + 2).padStart(2, "0")}-02T00:00:00Z`.replace("2025-13", "2026-01");
      for (const [op, n] of [[a, "A"], [b, "B"]] as const) {
        w.energy(op, month(i + 1), { kWh: 10 });
        // operator b cites operator a's retirement in March: the same (registry, reference) twice in one tonne
        const ref = op === b && i === 2 ? "RET-A-3" : `RET-${n}-${i + 1}`;
        w.carbon(op, month(i + 1), { s2: 1, s3: 1, retirements: [retirement(ref, 1000, { at })] });
      }
    }
    const err = refusal(() => run(w.excerpt()));
    expect(err.code).toBe("E-LEDGER");
    expect(err.message).toContain("L9");
  });

  it("no late credits (L10): a retirement dated after the due instant is refused; one dated at the due instant is accepted", () => {
    const build = (retiredAt: string) => {
      const w = new World(READ_AT);
      const a = w.operator("a");
      for (let i = 0; i < 12; i++) {
        w.energy(a, month(i + 1), { kWh: 10 });
        const at = i === 0 ? retiredAt : `2025-${String(i + 2).padStart(2, "0")}-02T00:00:00Z`.replace("2025-13", "2026-01");
        // January's carbon event is committed on 6 February at noon, so the retirement may be dated up to the due instant
        w.carbon(a, month(i + 1), { s2: 1, s3: 1, retirements: [retirement(`RET-A-${i + 1}`, 1000, { at })] }, i === 0 ? { commit: "2025-02-06T12:00:00Z" } : {});
      }
      return w.excerpt();
    };
    // January 2025 ends at 2025-02-01T00:00:00Z; the due instant is five days later (3.2)
    expect(run(build("2025-02-06T00:00:00Z")).primary.extensions[EV2].operators[0]["offset-coverage-every-period"]).toBe(true);
    const late = refusal(() => run(build("2025-02-06T00:00:01Z")));
    expect(late.code).toBe("E-LEDGER");
    expect(late.message).toContain("L10");
  });

  it("a retirement dated after the commit instant is refused too (L10)", () => {
    const w = new World(READ_AT);
    const a = w.operator("a");
    for (let i = 0; i < 12; i++) {
      w.energy(a, month(i + 1), { kWh: 10 });
      const at = i === 0 ? "2025-02-05T00:00:00Z" : `2025-${String(i + 2).padStart(2, "0")}-02T00:00:00Z`.replace("2025-13", "2026-01");
      w.carbon(a, month(i + 1), { s2: 1, s3: 1, retirements: [retirement(`RET-A-${i + 1}`, 1000, { at })] });
    }
    // January's default commit is 3 February: the retirement of 5 February is within the grace period but not yet made
    expect(refusal(() => run(w.excerpt())).message).toContain("L10");
  });

  it("an operator declaration for a year is accepted, and an operator declaration for a month too", () => {
    const x = yearWorld().w.excerpt();
    const annual = run(x, { mode: "operator", target: "node.op-a.example", consensusMechanism: undefined, networkDeclarationUri: "https://ledger.example/.well-known/sustainability-data" });
    expect(annual.primary["target-type"]).toBe("origin");
    expect(annual.primary.extensions[EV2]["network-offset-coverage"]).toBeUndefined();
    expect(annual.primary.extensions[EV2].operators).toHaveLength(1);
    expect(annual.primary.extensions[NT]).toEqual({ "member-of-network": "ledger.example", "network-declaration": "https://ledger.example/.well-known/sustainability-data" });
    expect(annual.primary["energy-consumption"]).toBe(12_000 + 66);
    const monthly = run(x, { mode: "operator", target: "node.op-b.example", period: JAN, consensusMechanism: undefined });
    expect(monthly.primary["energy-consumption"]).toBe(1100);
    expect(monthly.primary.extensions[NT]["validated-node-count"]).toBeUndefined();
    expect(blocking(deepCheck(monthly.primary, x, { parameters: PARAMETERS, pins: PINS }))).toEqual([]);
  });

  const refusals: [string, Json, string][] = [
    ["a network period that is not a year", { period: JAN }, "E-PERIOD"],
    ["a period that is not month-bound", { period: { start: "2025-01-01T00:00:00+02:00", end: "2026-01-01T00:00:00+02:00" } }, "E-PERIOD"],
    ["an operator period of three months", { mode: "operator", target: "node.op-a.example", period: { start: month(1), end: month(4) } }, "E-PERIOD"],
    ["a network declaration without disclosure-uri", { disclosureUri: undefined }, "E-DISCLOSURE"],
    ["a network declaration without consensus-mechanism", { consensusMechanism: undefined }, "E-CONFIG"],
    ["a ledger-access-uri that is not https", { ledgerAccessUri: "http://ledger.example/read" }, "E-CONFIG"],
    ["an updated later than the read", { updated: "2026-05-02T00:10:01Z" }, "E-UPDATED"],
    ["a target that is not the network", { target: "other.example" }, "E-OPERATOR"],
    ["an operator target that is no Registry origin", { mode: "operator", target: "node.nobody.example", consensusMechanism: undefined }, "E-OPERATOR"],
    ["a renewable share above 100", { renewableEnergy: 101 }, "E-CONFIG"],
    ["an updated that is not an instant", { updated: "yesterday" }, "E-CONFIG"],
    ["a missing updated", { updated: undefined }, "E-CONFIG"],
    ["a methodologyUri that is not a URI reference", { methodologyUri: "" }, "E-CONFIG"],
    ["an empty provider", { provider: "" }, "E-CONFIG"],
  ];
  for (const [name, o, code] of refusals) {
    it(`refuses ${name} with [${code}]`, () => {
      expect(refusal(() => run(yearWorld().w.excerpt(), o)).code).toBe(code);
    });
  }

  it("publishes the configured renewable share beside the energy figure only: an energy-incomplete object omits it, a carbon-incomplete one carries it (reading choice, 7.4)", () => {
    const energySilent = yearWorld({ names: ["a"], skip: (_j, i, type) => type === "energy" && i === 3 }).w.excerpt();
    const carbonSilent = yearWorld({ names: ["a"], skip: (_j, i, type) => type === "carbon" && i === 3 }).w.excerpt();
    expect(run(energySilent, { renewableEnergy: 50 }).primary["renewable-energy"]).toBeUndefined();
    expect(run(carbonSilent, { renewableEnergy: 50 }).primary["renewable-energy"]).toBe(50);
  });

  it("refuses a read whose deep check fails (a forged hash), naming the row", () => {
    const x = yearWorld({ names: ["a"] }).w.excerpt();
    x.ledger[5].hash = "0".repeat(64);
    const err = refusal(() => run(x));
    expect(err.code).toBe("E-LEDGER");
    expect(err.message).toMatch(/D3/);
  });
});

// ---------------------------------------------------------------------------
// The adapter and the served document
// ---------------------------------------------------------------------------

describe("the 2.0 adapter through the publisher library", () => {
  const config = () => ({ excerpt: SFC_LEDGER_2_FIXTURE, ...OPTIONS, provider: SFC_LEDGER_2_PROVIDER, methodologyUri: SFC_LEDGER_2_METHODOLOGY_URI, disclosureUri: SFC_LEDGER_2_DISCLOSURE_URI, period: SFC_LEDGER_2_PERIOD, updated: SFC_LEDGER_2_UPDATED, energyUnit: "MWh" as const, carbonUnit: "tCO2e" as const, renewableEnergy: 82, parameters: SFC_LEDGER_2_PARAMETERS, pins: SFC_LEDGER_2_PINS });

  it("serves a document that equals the bridge's object plus signed, validates against the draft, and carries the recorded figures", async () => {
    const adapter = sfcLedgerBridgeAdapter(config());
    const publisher = new Publisher(adapter, { cacheTtlMs: 1000, signing: { key } });
    const { body } = await publisher.getSerialized({});
    const served = JSON.parse(body) as Json;
    expect(validateDocument(served).valid).toBe(true);
    const direct = bridge2(readExcerptV2(SFC_LEDGER_2_FIXTURE), config()).primary;
    const { signed: s, ...unsigned } = served;
    expect(typeof s).toBe("string");
    expect(unsigned).toEqual(direct);
    // the recorded year-2025 figures of the test vectors
    expect(served["energy-consumption"]).toBe(709.3755);
    expect(served["carbon-footprint"]).toBe(20.64075);
    expect(served["scope-1"]).toBe(0.01275);
    expect(served["carbon-intensity-gCO2e-per-kWh"]).toBe(17.914349);
  });

  it("returns the primary object and, when asked and allowed, its location-based pair", async () => {
    const one = await sfcLedgerBridgeAdapter(config()).fetch({});
    expect(Array.isArray(one)).toBe(false);
    const two = (await sfcLedgerBridgeAdapter({ ...config(), pairedLocation: true }).fetch({})) as Json[];
    expect(two).toHaveLength(2);
    expect(two[1].carbonAccounting).toBe("location-based");
    expect(two[1].scope2).toBe(SFC_NETWORK_2_EXAMPLE_LOCATION["scope-2"]);
    expect(two[1].carbon.value).toBe(SFC_NETWORK_2_EXAMPLE_LOCATION["carbon-footprint"]);
    expect(two[1].carbonIntensity).toBe(SFC_NETWORK_2_EXAMPLE_LOCATION["carbon-intensity-gCO2e-per-kWh"]);
  });

  it("refuses configuration errors at construction with a [E-...] code", () => {
    expect(() => sfcLedgerBridgeAdapter({ ...config(), mode: "service" as never })).toThrow("[E-CONFIG] mode");
    expect(() => sfcLedgerBridgeAdapter({ ...config(), disclosureUri: undefined })).toThrow("[E-DISCLOSURE]");
    expect(() => sfcLedgerBridgeAdapter({ ...config(), ledgerAccessUri: "ftp://x" })).toThrow("[E-CONFIG] ledgerAccessUri");
    expect(() => sfcLedgerBridgeAdapter({ ...config(), updated: "yesterday" })).toThrow("[E-CONFIG] updated");
    expect(() => sfcLedgerBridgeAdapter({ ...config(), methodologyUri: "" })).toThrow("[E-CONFIG] methodologyUri");
  });

  it("a malformed excerpt is refused when the adapter reads it, not silently published", async () => {
    const bad = { ...clone(SFC_LEDGER_2_FIXTURE), network: 5 } as Json;
    await expect(sfcLedgerBridgeAdapter({ ...config(), excerpt: bad }).fetch({})).rejects.toThrow("[E-SHAPE]");
  });
});

// ---------------------------------------------------------------------------
// 3. The two checks, rows of the spec
// ---------------------------------------------------------------------------

describe("shallowCheck and deepCheck read the rows of SFC profile 2.0", () => {
  const build = () => bridge2(readExcerptV2(SFC_LEDGER_2_FIXTURE), {
    ...OPTIONS, provider: SFC_LEDGER_2_PROVIDER, methodologyUri: SFC_LEDGER_2_METHODOLOGY_URI, disclosureUri: SFC_LEDGER_2_DISCLOSURE_URI, period: SFC_LEDGER_2_PERIOD, updated: SFC_LEDGER_2_UPDATED,
    energyUnit: "MWh", carbonUnit: "tCO2e", renewableEnergy: 82, parameters: SFC_LEDGER_2_PARAMETERS, pins: SFC_LEDGER_2_PINS, pairedLocation: true,
  });
  const keys = [SFC_LEDGER_TEST_PUBLIC_JWK];

  it("the shallow check of a served network declaration passes every applicable row", async () => {
    const out = build();
    const doc = await signed(out.primary);
    const r = await shallowCheck(doc, { trustedKeys: keys, T: READ_AT });
    expect(r.depth).toBe("shallow");
    expect(r.ok).toBe(true);
    expect(row(r, "S1").status).toBe("NOT-EVALUABLE");
    expect(row(r, "S2").status).toBe("PASS");
    expect(row(r, "S3").status).toBe("PASS");
    expect(row(r, "S4").status).toBe("PASS");
    expect(row(r, "S4").detail).toBe("2025-01-01T00:00:00Z to 2026-01-01T00:00:00Z");
    expect(row(r, "C-SFC-2").status).toBe("PASS");
    expect(row(r, "C-SFC-5").status).toBe("PASS");
    expect(rows(r, "S6.a")[0].status).toBe("PASS");
    for (const id of ["S6.b", "S6.c", "S6.d", "S6.e", "S6.f"]) expect(row(r, id).status, id).toBe("PASS");
    expect(rows(r, "S6.g").map((x) => x.detail).sort()).toEqual(["hardware-lifecycle", "net-zero-status", "renewable-energy", "validated-node-count"]);
    expect(row(r, "VERDICT").status).toBe("COMPLETE");
    expect(row(r, "S7").status).toBe("INFO");
    expect(row(r, "S7").detail).toContain("figures self-asserted");
    expect(row(r, "S7").detail).toContain("sustainability-wellknown-consumer");
    expect(r.summary!.FAIL).toBe(0);
    expect(r.summary!.PASS).toBeGreaterThan(10);
  });

  it("reads an object that carries only a 1.0 extension name under SFC 2.0 (9.3, 12.1 rule 3d)", async () => {
    const doc = clone(build().primary);
    delete doc.extensions[EV2];
    const r = await shallowCheck(doc, { trustedKeys: keys, T: READ_AT });
    expect(rows(r, "S2")).toHaveLength(1);
    expect(rows(r, "C-SFC-5")).toHaveLength(1);
    expect(rows(r, "S3")).toHaveLength(1);
  });

  it("one 1.x-evidence object does not move the other objects of the body to the 1.x checks (12.1 rule 3)", async () => {
    const primary = build().primary;
    const legacy = clone(primary);
    legacy.target = "legacy.example";
    legacy.extensions[`${EXT}ledger-evidence`] = legacy.extensions[EV2];
    delete legacy.extensions[EV2];
    const r = await shallowCheck([await signed(primary), await signed(legacy)], { trustedKeys: keys, T: READ_AT });
    expect(r.summary).toBeDefined(); // only the 2.0 checks write a summary
    expect(rows(r, "LEGACY")).toHaveLength(1);
    expect(rows(r, "LEGACY")[0].detail).toContain("not an SFC 2.0 declaration");
    expect(r.rows.find((x) => x.id === "VERDICT" && x.scope?.startsWith("legacy.example"))?.status).toBe("NOT-APPLICABLE");
    expect(r.rows.find((x) => x.id === "VERDICT" && x.scope?.startsWith(primary.target))?.status).toBe("COMPLETE");
    expect(rows(r, "S3").some((x) => x.status === "PASS" && x.scope?.startsWith(primary.target))).toBe(true);
  });

  it("S1 reports the media type the document was served as", async () => {
    const doc = await signed(build().primary);
    const s1 = async (f: Json) => row(await shallowCheck(doc, { trustedKeys: keys, T: READ_AT, fetched: f }), "S1");
    expect((await s1({ url: "https://g.example/.well-known/sustainability-data", contentType: "application/sustainability-data+json" })).status).toBe("PASS");
    expect((await s1({ url: "https://g.example/x", contentType: "application/json; charset=utf-8" })).detail).toContain("generic media type");
    expect((await s1({ url: "https://g.example/x", contentType: "text/html" })).status).toBe("FAIL");
    expect((await s1({ url: "http://g.example/x", contentType: "application/sustainability-data+json" })).status).toBe("NOT-EVALUABLE");
    expect((await s1({ url: "http://127.0.0.1:1/x", contentType: "application/sustainability-data+json", httpAllowed: true })).detail).toContain("allowed by the caller");
  });

  it("the pair is checked too: the location object gets S6 i, and an unpaired location object gets S2 only (7.3)", async () => {
    const out = build();
    const r = await shallowCheck([await signed(out.primary), await signed(out.location!)], { trustedKeys: keys, T: READ_AT });
    expect(row(r, "S6.i").status).toBe("PASS");
    expect(r.rows.filter((x) => x.id === "PAIR")).toEqual([]);
    // a location object of another target pairs with no primary: INFO "unpaired object", and S2 is all it gets
    const stray = await shallowCheck([await signed(out.primary), await signed({ ...out.location!, target: "other.example" })], { trustedKeys: keys, T: READ_AT });
    const unpaired = stray.rows.find((x) => x.id === "PAIR")!;
    expect(unpaired.detail).toBe("unpaired object");
    expect(unpaired.status).toBe("INFO");
    expect(stray.rows.filter((x) => x.scope?.startsWith("other.example"))).toEqual([expect.objectContaining({ id: "S2" }), unpaired]);
  });

  const shallowDefects: [string, (d: Json) => void, string, string][] = [
    ["a changed figure after signing", (d) => { d["energy-consumption"] += 1; }, "S3", "FAIL"],
    ["an operator entry that no longer sums", (d) => { d.extensions[EV2].operators[0].kwh += 1; }, "S6.b", "FAIL"],
    ["a footprint that is not the sum of the scopes", (d) => { d["carbon-footprint"] += 1; }, "S6.c", "FAIL"],
    ["a grid-weighted intensity", (d) => { d["carbon-intensity-gCO2e-per-kWh"] = 380; }, "S6.d", "FAIL"],
    ["a network flag that is not the conjunction", (d) => { d.extensions[EV2].operators[0]["offset-coverage-every-period"] = false; }, "S6.e", "FAIL"],
    ["a status that does not follow the flag", (d) => { d.extensions[CN]["net-zero-status"] = "partial"; }, "S6.f", "FAIL"],
    ["a missing disclosure-uri", (d) => { delete d["disclosure-uri"]; }, "C-SFC-5", "FAIL"],
    ["a perturbed (coarsely rounded) figure", (d) => { d["carbon-footprint"] = 20.64; }, "S6.c", "FAIL"],
  ];
  for (const [name, edit, id, status] of shallowDefects) {
    it(`flags ${name} on ${id}`, async () => {
      const doc = build().primary;
      edit(doc);
      const served = id === "S3" ? { ...(await signed(build().primary)), "energy-consumption": doc["energy-consumption"] } : await signed(doc);
      const r = await shallowCheck(served, { trustedKeys: keys, T: READ_AT });
      expect(r.ok).toBe(false);
      expect(rows(r, id).some((x) => x.status === status), `${id} ${JSON.stringify(rows(r, id))}`).toBe(true);
    });
  }

  it("C-SFC-5 carries the S2 token when the object fails the consumer library's strict reading and no verdict was supplied (9.2)", async () => {
    const doc = { ...(await signed(build().primary)), capabilities: "nonsense" };
    const r = await shallowCheck(doc, { trustedKeys: keys, T: READ_AT });
    expect(row(r, "S2").status).toBe("FAIL");
    expect(row(r, "C-SFC-5").status).toBe("FAIL");
    expect(row(r, "C-SFC-5").detail!.split("; ")).toContain("S2");
    // a legacy object (the superseded name only) beside the primary that fails the strict reading is named a pre-10 wire
    const legacy = clone(build().primary);
    legacy.target = "legacy.example";
    legacy.extensions[`${EXT}ledger-evidence`] = legacy.extensions[EV2];
    delete legacy.extensions[EV2];
    const l = await shallowCheck([await signed(build().primary), { ...legacy, capabilities: "nonsense" }], { trustedKeys: keys, T: READ_AT });
    expect(row(l, "LEGACY").detail).toBe("profile 1.1 evidence, pre-10 wire");
  });

  it("a served text with a duplicated figure member fails S3 and C-SFC-5 on the claiming object; the same body as an object alone cannot show it", async () => {
    const text = JSON.stringify(await signed(build().primary)).replace('"energy-consumption":', '"energy-consumption":999,"energy-consumption":');
    expect((text.match(/"energy-consumption":/g) ?? []).length).toBe(2);
    const withText = await shallowCheck(JSON.parse(text), { trustedKeys: keys, T: READ_AT, declarationText: text });
    expect(row(withText, "S3")).toMatchObject({ status: "FAIL", detail: "duplicate member or lone surrogate" });
    expect(row(withText, "C-SFC-5").status).toBe("FAIL");
    expect(withText.ok).toBe(false);
    const objectOnly = await shallowCheck(JSON.parse(text), { trustedKeys: keys, T: READ_AT });
    expect(row(objectOnly, "S3").status).toBe("PASS");
  });

  it("without a pinned key the signature is INFO, never PASS; without T, S4 and C-SFC-5 are not run", async () => {
    const doc = await signed(build().primary);
    const r = await shallowCheck(doc, { trustedKeys: [] });
    expect(row(r, "S3").status).toBe("INFO");
    expect(row(r, "S3").detail).toBe("signed, not verified against a pinned key");
    expect(rows(r, "S4")).toEqual([]);
    expect(rows(r, "C-SFC-5")).toEqual([]);
  });

  it("the deep check of the served declaration against the read passes C-SFC-7 and reports each row with its scope", () => {
    const out = build();
    const r = deepCheck(out.primary, SFC_LEDGER_2_FIXTURE, { parameters: SFC_LEDGER_2_PARAMETERS, pins: SFC_LEDGER_2_PINS, T: READ_AT });
    expect(r.depth).toBe("deep");
    expect(r.ok).toBe(true);
    expect(row(r, "D1").status).toBe("PASS");
    expect(row(r, "D2.operator-set").status).toBe("PASS");
    expect(rows(r, "D2.entry").map((x) => x.status)).toEqual(["PASS", "PASS", "PASS"]);
    expect(rows(r, "D3")).toHaveLength(6);
    expect(rows(r, "D3")[0].scope).toBe("did:web:op-a.example Energy");
    expect(rows(r, "D4.chain").every((x) => x.status === "PASS")).toBe(true);
    expect(row(r, "D4.declared").status).toBe("PASS");
    expect(rows(r, "D5").every((x) => x.status === "PASS")).toBe(true);
    expect(row(r, "C-SFC-3").status).toBe("DECLARED");
    expect(row(r, "C-SFC-6").status).toBe("PASS");
    expect(row(r, "D8").status).toBe("NOT-EVALUABLE");
    expect(row(r, "C-SFC-7").status).toBe("PASS");
    expect(r.summary!.FAIL).toBe(0);
  });

  it("C-SFC-6 test 1 admits crash-fault-tolerant (7.6: Raft, notary clusters), with the mechanism list of the profile descriptor", () => {
    expect([...MECHANISMS]).toEqual(["proof-of-work", "proof-of-stake", "proof-of-authority", "dag", "hybrid", "bft", "crash-fault-tolerant"]);
    const platform = { "hot-path": "Raft", access: "permissioned", mechanism: "crash-fault-tolerant", n: 10, "p-watts": 100, o: 1 };
    const doc = clone(build().primary);
    doc.extensions[NT]["consensus-mechanism"] = "Crash Fault Tolerant";
    const r = deepCheck(doc, SFC_LEDGER_2_FIXTURE, { parameters: { ...SFC_LEDGER_2_PARAMETERS, platform }, pins: SFC_LEDGER_2_PINS, T: READ_AT });
    expect(row(r, "C-SFC-6").status).toBe("PASS");
    expect(rows(r, "C-SFC-6.info")).toEqual([]);
    // a consensus-mechanism text in the list that differs from the platform's is not noted either
    doc.extensions[NT]["consensus-mechanism"] = "crash-fault-tolerant";
    const bft = deepCheck(doc, SFC_LEDGER_2_FIXTURE, { parameters: { ...SFC_LEDGER_2_PARAMETERS, platform: { ...platform, mechanism: "bft" } }, pins: SFC_LEDGER_2_PINS, T: READ_AT });
    expect(row(bft, "C-SFC-6").status).toBe("PASS");
    expect(rows(bft, "C-SFC-6.info")).toEqual([]);
  });

  it("without a pinned registrar key the deep check is consistent but not authenticated (NOT-EVALUABLE, never PASS)", () => {
    const r = deepCheck(build().primary, SFC_LEDGER_2_FIXTURE, { T: READ_AT, parameters: SFC_LEDGER_2_PARAMETERS });
    expect(rows(r, "D2.entry").every((x) => x.status === "NOT-EVALUABLE" && x.detail === "registrar key not pinned")).toBe(true);
    expect(row(r, "C-SFC-7").status).toBe("NOT-EVALUABLE");
    expect(row(r, "C-SFC-7").detail).toBe("consistent but not authenticated");
    expect(r.ok).toBe(true);
  });

  const deepDefects: [string, (d: Json) => void, RegExp][] = [
    ["a kwh that does not recompute", (d) => { d.extensions[EV2].operators[1].kwh += 0.000001; }, /did:web:op-b.example:kwh/],
    ["a head that is not the head", (d) => { d.extensions[EV2].operators[0]["carbon-head"] = "1".repeat(64); }, /carbon-head/],
    ["a count that is not the count", (d) => { d.extensions[EV2].operators[2]["energy-events"] = 11; }, /energy-events/],
    ["a flag the ledger does not give", (d) => { d.extensions[EV2].operators[0]["offset-coverage-every-period"] = false; }, /offset-coverage-every-period/],
    ["a scope-2 that is not the sum", (d) => { d["scope-2"] += 0.001; }, /top:scope-2/],
    ["an unrounded figure", (d) => { d["carbon-footprint"] = 20.640751; }, /top:carbon-footprint/],
    ["a validated-node-count that is not the maximum", (d) => { d.extensions[NT]["validated-node-count"] = 13; }, /top:validated-node-count/],
    ["an operator set that omits an operator", (d) => { d.extensions[EV2].operators.pop(); }, /D2.operator-set/],
  ];
  for (const [name, edit, token] of deepDefects) {
    it(`C-SFC-7 FAILs on ${name}`, () => {
      const d = build().primary;
      edit(d);
      const r = deepCheck(d, SFC_LEDGER_2_FIXTURE, { parameters: SFC_LEDGER_2_PARAMETERS, pins: SFC_LEDGER_2_PINS, T: READ_AT });
      expect(row(r, "C-SFC-7").status).toBe("FAIL");
      expect(row(r, "C-SFC-7").detail).toMatch(token);
      expect(r.ok).toBe(false);
    });
  }

  it("a later correction is INFO, never FAIL, and both cut-offs are stated (D7)", () => {
    const y = yearWorld({ names: ["a"] });
    const o = run(y.w.excerpt());
    const jan = y.w.events.find((e) => e.event.type === "CarbonAttested")!;
    y.w.carbon("did:web:op-a.example", month(1), { s2: 10_000, s3: 5, retirements: [retirement("RET-A-1", 1000, { at: "2025-02-02T00:00:00Z" })], netZero: false }, { supersedes: jan.hash, commit: "2026-03-05T00:00:00Z" });
    const later = deepCheck(o.primary, y.w.excerpt(), { parameters: PARAMETERS, pins: PINS });
    expect(blocking(later)).toEqual([]);
    expect(rows(later, "D7").map((x) => x.status)).toEqual(["INFO"]);
    expect(rows(later, "D7")[0].detail).toBe("superseded since publication");
    expect(row(later, "D7.C-SFC-4").detail).toBe("as of updated: PASS; as of read-at: FAIL");
    expect(row(later, "C-SFC-7").status).toBe("PASS");
  });

  it("a read in excerpt format 1 is NOT-EVALUABLE in D1 (12.1 rule 1), never FAIL", () => {
    const r = deepCheck(build().primary, SFC_LEDGER_FIXTURE);
    expect(row(r, "D1").status).toBe("NOT-EVALUABLE");
    expect(row(r, "D1").detail).toBe("excerpt version absent");
    expect(row(r, "C-SFC-7").status).toBe("NOT-EVALUABLE");
    expect(r.ok).toBe(true);
  });

  it("an excerpt that names version 1 is NOT-EVALUABLE in D1 with the version quoted, a string version quoted, any other kind by kind", () => {
    const detail = (version: unknown) => row(deepCheck(build().primary, { ...SFC_LEDGER_2_FIXTURE, "excerpt-version": version } as Json, { parameters: PARAMETERS, pins: PINS }), "D1").detail;
    expect(detail(1)).toBe("excerpt version 1");
    expect(detail("2")).toBe('excerpt version "2"');
    expect(detail({ v: 2 })).toBe("excerpt version of type object");
  });

  it("a read that is not a well-formed excerpt is NOT-EVALUABLE in D1 with the first violation, never D0 FAIL", () => {
    const r = deepCheck(build().primary, { ...clone(SFC_LEDGER_2_FIXTURE), "read-at": "yesterday" });
    expect(row(r, "D1").status).toBe("NOT-EVALUABLE");
    expect(row(r, "D1").detail).toBe("read is not a well-formed excerpt: read-at is not an instant");
    expect(row(r, "C-SFC-7").status).toBe("NOT-EVALUABLE");
    expect(rows(r, "D0")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("a stale read (the checker's clock more than 24 hours after read-at) is NOT-EVALUABLE", () => {
    const r = deepCheck(build().primary, SFC_LEDGER_2_FIXTURE, { now: "2026-05-04T00:10:00Z", parameters: SFC_LEDGER_2_PARAMETERS, pins: SFC_LEDGER_2_PINS });
    expect(row(r, "D1").detail).toBe("stale read");
    expect(row(r, "C-SFC-7").status).toBe("NOT-EVALUABLE");
  });

  it("never throws on a document or excerpt it cannot read: a row says so", () => {
    expect(deepCheck({ extensions: { [EV2]: {} } }, null).rows[0]).toMatchObject({ id: "D1", status: "NOT-EVALUABLE", detail: "read is not a well-formed excerpt: not an object" });
    expect(deepCheck({ extensions: { [EV2]: {} } }, { "excerpt-version": 2 }).ok).toBeDefined();
  });

  it("ledgerAccessUriOf names the pointer of a 2.0 declaration", () => {
    expect(ledgerAccessUriOf(build().primary)).toBe(ACCESS.replace(ACCESS, `https://${"ledger.example"}/sfc/read`));
    expect(ledgerAccessUriOf([build().primary])).toBe(ACCESS);
  });
});

// ---------------------------------------------------------------------------
// 4. The demonstrations in the gateway
// ---------------------------------------------------------------------------

/**
 * SHA-256 of the frozen demonstration files as recorded at the last release (external material cites the
 * ledger demo, so its bytes never change). They change only on an owner decision. The served bytes are those of a gateway whose
 * base URL is https://gw.example.
 */
const FROZEN = {
  networkFile: "f624931a5727e7d27cb208d96c2182655fb2d081889ca37d1483b92e8cecb80c",
  operatorFile: "cd5b61ef2bd9b5ea27150092ecc7b16ece6114c9bec41d27059e1c945b115ef5",
  ledgerDemoDocument: "5d482ea7c2c0a1ca3eff29a50167423e14fa04feeb6d22a54de8124f12866520",
  ledgerDemoInput: "9c1d93785cb6fd1987a5d51240e6d333bd3a3f0a6c3833fa7ead0624cd740c1b",
} as const;

describe("the SFC 2.0 demonstrations in the gateway", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway({ baseUrl: "https://gw.example" });
  });
  afterAll(async () => {
    await srv.close();
  });
  const url = (p: string) => srv.base + p;
  const served = async (domain: string): Promise<Json> => JSON.parse(await (await fetch(url(`/${domain}/.well-known/sustainability-data`))).text());

  it("sfc-ledger-demo-2.example is the bridge's signed network declaration, with the pointer on the configured https origin", async () => {
    const r = await fetch(url(`/${SFC_LEDGER_DEMO_2_DOMAIN}/.well-known/sustainability-data`));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/sustainability-data+json");
    expect(r.headers.get("last-modified")).toBe("Tue, 10 Feb 2026 09:00:00 GMT");
    const doc = JSON.parse(await r.text()) as Json;
    expect(doc.target).toBe("ledger.example");
    expect(doc["target-type"]).toBe("service");
    expect(doc.provider).toMatch(/^SYNTHETIC EXAMPLE/);
    expect(doc["methodology-uri"]).toBe("https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/sfc-compliance/examples/METHODOLOGY.md");
    expect(doc["disclosure-uri"]).toBe(SFC_LEDGER_2_DISCLOSURE_URI);
    expect(doc.extensions[EV2]["ledger-access-uri"]).toBe(`https://gw.example/${SFC_LEDGER_DEMO_2_DOMAIN}/input`);
    // figures are the vectors' year 2025
    expect(doc["energy-consumption"]).toBe(SFC_NETWORK_2_EXAMPLE["energy-consumption"]);
    expect(doc["carbon-footprint"]).toBe(SFC_NETWORK_2_EXAMPLE["carbon-footprint"]);
    expect(doc.extensions[EV2].operators).toEqual(SFC_NETWORK_2_EXAMPLE.extensions[EV2].operators);
    // the checks of the spec, run on what was served
    expect((await shallowCheck(doc, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK], T: READ_AT })).ok).toBe(true);
    const input = await (await fetch(url(`/${SFC_LEDGER_DEMO_2_DOMAIN}/input`))).json();
    expect(input).toEqual(JSON.parse(JSON.stringify(SFC_LEDGER_2_FIXTURE)));
    const deep = deepCheck(doc, input, { parameters: SFC_LEDGER_2_PARAMETERS, pins: SFC_LEDGER_2_PINS, T: READ_AT });
    expect(row(deep, "C-SFC-7").status).toBe("PASS");
  });

  it("sfc-network-2.example and sfc-operator-2.example serve the reference declarations, signed with the same test key, equal to the examples", async () => {
    // Equal in every member but `signed`: the publisher library signs a document again with its own JWS
    // header (it embeds the public key) and its own member order, so the compact string differs while
    // its payload is the same object, which the shallow check verifies under the pinned test key.
    for (const [domain, example, T] of [[SFC_NETWORK_2_DOMAIN, SFC_NETWORK_2_EXAMPLE, READ_AT], [SFC_OPERATOR_2_DOMAIN, SFC_OPERATOR_2_EXAMPLE, READ_AT]] as const) {
      const doc = await served(domain);
      const { signed: s, ...members } = doc;
      const { signed: _original, ...expected } = example as Json;
      expect(members).toEqual(expected);
      expect(JSON.parse(Buffer.from(s.split(".")[1], "base64url").toString("utf8"))).toEqual(expected);
      expect(validateDocument(doc).valid).toBe(true);
      const r = await shallowCheck(doc, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK], T });
      expect(row(r, "S3").status).toBe("PASS");
    }
  });

  it("the copies of the examples and of the vectors' read in the fixture equal the files of sfc-compliance", () => {
    const read = (p: string): Json => JSON.parse(readFileSync(join(SFC_REPO, p), "utf8"));
    const net = read("examples/sfc-network.example.json");
    expect(SFC_NETWORK_2_EXAMPLE).toEqual(net[0]);
    expect(SFC_NETWORK_2_EXAMPLE_LOCATION).toEqual(net[1]);
    expect(SFC_OPERATOR_2_EXAMPLE).toEqual(read("examples/sfc-operator.example.json"));
    const v5 = read("vectors/inputs/v05-sums-year.json");
    const sc = v5.scenarios.find((s: Json) => s.name === "year-2025");
    expect(JSON.parse(JSON.stringify(SFC_LEDGER_2_FIXTURE))).toEqual(v5.excerpts[sc.excerptRef]);
    const params = read("examples/sfc-parameters.example.json");
    for (const k of Object.keys(SFC_LEDGER_2_PARAMETERS)) expect((SFC_LEDGER_2_PARAMETERS as Json)[k], k).toEqual(params[k]);
  });

  it("sfc-network.example and sfc-operator.example stay as they were, and the frozen sfc-ledger-demo.example is untouched", async () => {
    const net = await served("sfc-network.example");
    expect(net["energy-consumption"]).toBeDefined();
    expect(JSON.stringify(net)).not.toContain("ledger-evidence-2");
    const frozen = await served("sfc-ledger-demo.example");
    expect(frozen.extensions[`${EXT}ledger-evidence`]["profile-version"]).toBe("1.2");
    expect(frozen["carbon-accounting"]).toBe("location-based");
  });

  it("the frozen demo files are byte-identical to their recorded hashes", async () => {
    const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
    const rawBody = async (path: string): Promise<Buffer> => Buffer.from(await (await fetch(url(path))).arrayBuffer());
    expect(sha256(readFileSync(join(__dirname, "..", "data", "sfc-network.example.json")))).toBe(FROZEN.networkFile);
    expect(sha256(readFileSync(join(__dirname, "..", "data", "sfc-operator.example.json")))).toBe(FROZEN.operatorFile);
    expect(sha256(await rawBody("/sfc-ledger-demo.example/.well-known/sustainability-data"))).toBe(FROZEN.ledgerDemoDocument);
    expect(sha256(await rawBody("/sfc-ledger-demo.example/input"))).toBe(FROZEN.ledgerDemoInput);
  });

  it("the index lists the three demonstrations as replays; each has its recorded input", async () => {
    const idx = await (await fetch(url("/index.json"))).json();
    for (const d of [SFC_LEDGER_DEMO_2_DOMAIN, SFC_NETWORK_2_DOMAIN, SFC_OPERATOR_2_DOMAIN]) {
      const entry = idx["adapter-demonstrations"].entries.find((e: { domain: string }) => e.domain === d);
      expect(entry, d).toBeDefined();
      expect(entry.mode).toBe("replay");
      expect(entry.input.path).toBe(`/${d}/input`);
      expect(srv.gw.subjects.get(d)!.synthetic).toBe(true);
    }
  });

  it("the boot self-check refuses a tampered 2.0 build", async () => {
    const spec = demoSpecs({ config: srv.gw.config, crawlBytes: 1, wattsByMonth: {} }).find((s) => s.domain === SFC_LEDGER_DEMO_2_DOMAIN)!;
    await expect(spec.selfCheck!(srv.gw.subjects.get(SFC_LEDGER_DEMO_2_DOMAIN)!)).resolves.toBeUndefined();
    const subject = srv.gw.subjects.get(SFC_LEDGER_DEMO_2_DOMAIN)!;
    const tampered = { ...subject, document: { ...subject.document, "energy-consumption": (subject.document["energy-consumption"] as number) + 1 } } as typeof subject;
    await expect(spec.selfCheck!(tampered)).rejects.toThrow(/profile 2\.0\) self-check failed/);
  });
});

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

describe("scripts/sfc-ledger-check.mjs runs the 2.0 checks", () => {
  const lib = { deepCheck, isReadUnderSfc2, ledgerAccessUriOf, shallowCheck, testKey: SFC_LEDGER_TEST_PUBLIC_JWK };
  const bridged = (excerpt: Json, o: Json = {}) => bridge2(readExcerptV2(excerpt), { ...OPTIONS, ...o }).primary;
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway({ baseUrl: "https://gw.example" });
  });
  afterAll(async () => {
    await srv.close();
  });

  /** A file or a served document of the harness: an object, or its exact text (to serve a duplicate member name). */
  const textOf = (v: Json): string => (typeof v === "string" ? v : JSON.stringify(v));

  /** Run the script on in-memory files and served documents; returns the exit code and the printed lines. `check` replaces the checks (a stub). */
  async function cli(argv: string[], files: Record<string, Json>, served: Record<string, Json> = {}, clock = "2026-05-02T12:00:00Z", check = lib) {
    const lines: string[] = [];
    const errors: string[] = [];
    const io = {
      out: (l: string) => lines.push(l),
      err: (l: string) => errors.push(l),
      readJson: (p: string) => {
        if (!(p in files)) throw new Error(`no such file ${p}`);
        return JSON.parse(textOf(files[p]));
      },
      readText: (p: string) => {
        if (!(p in files)) throw new Error(`no such file ${p}`);
        return textOf(files[p]);
      },
      fetchJson: async (u: string, allowHttp: boolean) => {
        if (!u.startsWith("https:") && !allowHttp) throw new Error(`${u}: only https is fetched`);
        if (!(u in served)) throw new Error(`${u}: HTTP 404`);
        const text = textOf(served[u]);
        return { body: JSON.parse(text), text, contentType: "application/sustainability-data+json" };
      },
      clock: () => clock,
    };
    const code = await runCheck(argv, check, io);
    return { code, text: lines.join("\n"), errors };
  }

  const demo = () => bridged(SFC_LEDGER_2_FIXTURE, {
    provider: SFC_LEDGER_2_PROVIDER, methodologyUri: SFC_LEDGER_2_METHODOLOGY_URI, disclosureUri: SFC_LEDGER_2_DISCLOSURE_URI, period: SFC_LEDGER_2_PERIOD, updated: SFC_LEDGER_2_UPDATED,
    energyUnit: "MWh", carbonUnit: "tCO2e", parameters: SFC_LEDGER_2_PARAMETERS, pins: SFC_LEDGER_2_PINS,
  });
  const files = async (): Promise<Record<string, Json>> => ({ "decl.json": await signed(demo()), "read.json": SFC_LEDGER_2_FIXTURE, "params.json": SFC_LEDGER_2_PARAMETERS });
  const PIN = ["--registrar-key", SFC_LEDGER_TEST_PUBLIC_JWK.x, "--network", "ledger.example", "--parameters", "params.json", "--excerpt", "read.json", "--at", READ_AT];

  it("parses its arguments strictly: a flag without a value, an unknown flag, no source, a non-instant --at or a registrar key without --network is a usage error", () => {
    expect(parseArgs(["a.json"])).toEqual({ source: "a.json", flags: {}, allowHttp: false });
    expect(parseArgs(["a.json", "--at", "2026-05-02T00:10:00Z", "--allow-http"])).toEqual({ source: "a.json", flags: { "--at": "2026-05-02T00:10:00Z" }, allowHttp: true });
    const bad = [[], ["a", "b"], ["a", "--at"], ["a", "--at", "--allow-http"], ["a", "--nope"], ["a", "--scope2-method", "x"], ["a", "--at", "yesterday"], ["a", "--at", "2026-12-31T23:59:60Z"], ["a", "--registrar-key", "x"]];
    for (const argv of bad) expect(parseArgs(argv), argv.join(" ")).toBeUndefined();
  });

  it("exits 2 with the usage line when --at is not an RFC 3339 instant, before any check runs", async () => {
    const r = await cli(["decl.json", "--at", "yesterday"], await files());
    expect(r.code).toBe(2);
    expect(r.errors[0]).toContain("usage: node scripts/sfc-ledger-check.mjs");
    expect(r.text).toBe("");
  });

  /** The numbers METHODOLOGY.md section 4 prints for the three 2.0 demos; this test keeps them true. */
  const DOCUMENTED_COUNTS: Record<string, Record<string, number>> = {
    "sfc-ledger-demo-2.example": { PASS: 44, INFO: 6, DECLARED: 5, COMPLETE: 1, "NOT-EVALUABLE": 2 },
    "sfc-network-2.example": { PASS: 44, INFO: 6, DECLARED: 5, COMPLETE: 1, "NOT-EVALUABLE": 2 },
    "sfc-operator-2.example": { PASS: 43, INFO: 4, DECLARED: 4, COMPLETE: 1, "NOT-EVALUABLE": 2 },
  };
  const countsOf = (text: string): Record<string, number> => {
    const line = text.split("\n").find((l) => l.startsWith("rows: ")) ?? "";
    return Object.fromEntries(line.slice(6).split(", ").map((c) => [c.slice(0, c.lastIndexOf(" ")), Number(c.slice(c.lastIndexOf(" ") + 1))]));
  };

  for (const [domain, counts] of Object.entries(DOCUMENTED_COUNTS)) {
    it(`${domain}: the run documented in METHODOLOGY.md exits 0 with exactly the documented counts`, async () => {
      const served = async (path: string) => (await fetch(srv.base + path)).json();
      const r = await cli(
        [`${srv.base}/${domain}/.well-known/sustainability-data`, "--allow-http", "--excerpt", "read.json", "--parameters", "params.json", "--registrar-key", "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo", "--network", "ledger.example", "--at", READ_AT],
        { "read.json": await served(`/${domain}/input`), "params.json": JSON.parse(readFileSync(resolve(SFC_REPO, "examples", "sfc-parameters.example.json"), "utf8")) },
        { [`${srv.base}/${domain}/.well-known/sustainability-data`]: await served(`/${domain}/.well-known/sustainability-data`) },
      );
      expect(r.errors).toEqual([]);
      expect(r.code).toBe(0);
      expect(countsOf(r.text)).toEqual(counts);
    });
  }

  it("exits 2 with the usage line on a usage error", async () => {
    const r = await cli(["--at"], {});
    expect(r.code).toBe(2);
    expect(r.errors[0]).toContain("usage: node scripts/sfc-ledger-check.mjs");
  });

  it("with the registrar key and the parameters pinned and T given, a consistent declaration passes: no FAIL, counted by word", async () => {
    const r = await cli(["decl.json", ...PIN], await files());
    expect(r.text).not.toMatch(/\sFAIL\s/);
    expect(r.code).toBe(0);
    expect(r.text).toContain("profile 2.0 (spec sections 9.3, 9.4); T 2026-05-02T00:10:00Z (--at)");
    expect(r.text).toMatch(/PASS\s+C-SFC-7/);
    expect(r.text).toMatch(/NOT-EVALUABLE\s+S1 /);
    expect(r.text).toMatch(/\nrows: .*PASS \d+/);
    expect(r.text).toContain("No row failed. This shows what the rows say and nothing more");
  });

  it("without a pin the criteria are NOT-EVALUABLE and the closing line says it is not a pass", async () => {
    const r = await cli(["decl.json", "--excerpt", "read.json", "--at", READ_AT], await files());
    expect(r.code).toBe(0);
    expect(r.text).toMatch(/NOT-EVALUABLE\s+C-SFC-7\s+.*(consistent but not authenticated|L9 not evaluable)/);
    expect(r.text).toContain("No row failed, and this is not a pass: ");
    expect(r.text).toContain("C-SFC-7");
  });

  it("with the checker's clock as T a read more than 24 hours old is stale, never FAIL", async () => {
    const r = await cli(["decl.json", "--excerpt", "read.json"], await files(), {}, "2026-05-04T00:10:00Z");
    expect(r.text).toContain("T 2026-05-04T00:10:00Z (this machine's clock)");
    expect(r.text).toMatch(/NOT-EVALUABLE\s+D1\s+.*stale read/);
    expect(r.text).not.toMatch(/\sFAIL\s/);
    expect(r.code).toBe(0);
  });

  it("fetches the declaration and the read named by ledger-access-uri, and reports the media type (S1)", async () => {
    const decl = (await files())["decl.json"];
    const served = { "https://gw.example/d": decl, [decl.extensions[EV2]["ledger-access-uri"]]: SFC_LEDGER_2_FIXTURE };
    const r = await cli(["https://gw.example/d", "--at", READ_AT], { "params.json": SFC_LEDGER_2_PARAMETERS }, served);
    expect(r.text).toMatch(/PASS\s+S1 .*application\/sustainability-data\+json/);
    expect(r.text).toContain(`deep check (read from ${decl.extensions[EV2]["ledger-access-uri"]})`);
    expect(r.text).toMatch(/\sD1 /);
    const refused = await cli(["http://gw.example/d", "--at", READ_AT], {}, {});
    expect(refused.code).toBe(1);
    expect(refused.errors[0]).toContain("only https is fetched");
  });

  it("reports a later correction as INFO and counts it, and the exit code stays 0", async () => {
    const y = yearWorld({ names: ["a"] });
    const decl = await signed(bridged(y.w.excerpt()));
    const first = y.w.events.find((e) => e.event.type === "EnergyAttested")!;
    y.w.energy("did:web:op-a.example", month(1), { kWh: 5000 }, { supersedes: first.hash, commit: "2026-03-01T00:00:00Z" });
    const f = { "decl.json": decl, "read.json": y.w.excerpt(), "params.json": PARAMETERS };
    const r = await cli(["decl.json", "--excerpt", "read.json", "--parameters", "params.json", "--registrar-key", SFC_LEDGER_TEST_PUBLIC_JWK.x, "--network", "ledger.example", "--at", READ_AT], f);
    expect(r.text).toMatch(/INFO\s+D7\s+\[did:web:op-a.example Energy 2026-03-01T00:00:00Z\] superseded since publication/);
    expect(r.text).toMatch(/INFO\s+D7.C-SFC-2\s/);
    expect(r.text).toContain("INFO later corrections since the declaration's updated (spec D7): 1; they do not make the declaration wrong");
    expect(r.text).toMatch(/PASS\s+C-SFC-7/);
    expect(r.text).not.toMatch(/FAIL\s+(C-SFC-7|D[2-6])/);
  });

  it("exits 1 when a row FAILs, and escapes control characters in a printed detail", async () => {
    const decl = { ...(await files())["decl.json"], "energy-consumption": 1 };
    const f = { ...(await files()), "decl.json": decl };
    const r = await cli(["decl.json", ...PIN], f);
    expect(r.code).toBe(1);
    expect(r.text).toMatch(/FAIL\s+C-SFC-7/);
    expect(r.text).toContain("At least one row failed.");
    const hostile = await cli(["decl.json", ...PIN], { ...f, "decl.json": { ...decl, provider: "bad\u001b[31m" } });
    expect(hostile.text).not.toContain("\u001b");
  });

  it("still runs a 1.x declaration through the frozen 1.x checks", async () => {
    const frozen = srv.gw.subjects.get("sfc-ledger-demo.example")!.document;
    const r = await cli(["decl.json", "--excerpt", "read.json"], { "decl.json": frozen, "read.json": SFC_LEDGER_FIXTURE });
    expect(r.text).toContain("profile 1.x (frozen)");
    expect(r.text).toMatch(/PASS\s+D1 ledger-access/);
    expect(r.text).not.toContain("rows:");
    expect(r.code).toBe(0);
  });

  it("fetchJson refuses plain http, follows no redirect, reads no more than 2 MB and returns the served text with the object", async () => {
    const reply = (status: number, body: string, headers: Record<string, string> = {}) => async () => new Response(body, { status, headers });
    const publicName = async () => ["93.184.216.34"];
    await expect(fetchJson("http://x.example/d", false, reply(200, "{}"), publicName)).rejects.toThrow("only https is fetched");
    await expect(fetchJson("https://x.example/d", false, reply(302, "", { location: "https://y.example" }), publicName)).rejects.toThrow("redirect");
    await expect(fetchJson("https://x.example/d", false, reply(503, ""), publicName)).rejects.toThrow("HTTP 503");
    await expect(fetchJson("https://x.example/d", false, reply(200, "x".repeat(2 * 1024 * 1024 + 1)), publicName)).rejects.toThrow("larger than");
    const got = await fetchJson("https://x.example/d", false, reply(200, '{"a": 1}', { "content-type": "application/json" }), publicName);
    expect(got).toEqual({ body: { a: 1 }, text: '{"a": 1}', contentType: "application/json" });
    expect((await fetchJson("http://127.0.0.1:1/d", true, reply(200, "[]"), publicName)).body).toEqual([]);
  });

  it("fetchJson refuses a literal address that is not globally reachable before any request, with or without a stand-in transport", async () => {
    let requests = 0;
    const reply = async () => {
      requests++;
      return new Response("{}", { status: 200 });
    };
    const publicName = async () => ["93.184.216.34"];
    await expect(fetchJson("https://10.0.0.5/read", false, reply, publicName)).rejects.toThrow("not a public unicast address");
    await expect(fetchJson("https://[::1]/read", false, reply, publicName)).rejects.toThrow("not a public unicast address");
    await expect(fetchJson("https://169.254.169.254/read", false, reply, publicName)).rejects.toThrow("not a public unicast address");
    expect(requests).toBe(0);
  });

  describe("fetchJson binds the address rule to the connection: the resolver of the socket is the check", () => {
    let server: Server;
    let port = 0;
    let requests = 0;
    beforeAll(async () => {
      server = createServer((_req, res) => {
        requests++;
        res.setHeader("content-type", "application/json");
        res.end("{}");
      });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      port = (server.address() as { port: number }).port;
    });
    afterAll(async () => {
      await new Promise<void>((done) => server.close(() => done()));
    });
    const resolvesTo = (...addresses: string[]) => async () => addresses;

    it("a name that resolves to loopback is admitted for a local instance (--allow-http) and the request is made", async () => {
      const got = await fetchJson(`http://ledger.test:${port}/read`, true, undefined, resolvesTo("127.0.0.1"));
      expect(got.body).toEqual({});
      expect(requests).toBe(1);
    });

    it("a name that resolves to a private address, alone or among public ones, is refused and no request is made", async () => {
      const before = requests;
      await expect(fetchJson(`http://ledger.test:${port}/read`, true, undefined, resolvesTo("10.0.0.5"))).rejects.toThrow("not a public unicast address");
      await expect(fetchJson(`http://ledger.test:${port}/read`, true, undefined, resolvesTo("93.184.216.34", "10.0.0.5"))).rejects.toThrow("not a public unicast address");
      expect(requests).toBe(before);
      expect(ADDRESS_RULE).toContain("the socket connects only to an address that passed the check");
    });
  });

  it("prints the D9 record after the closing sentence: pins (and the network the key is bound to), D8, the address rule, what is not established", async () => {
    const pinned = await cli(["decl.json", ...PIN], await files());
    const tail = pinned.text.slice(pinned.text.indexOf("No row failed."));
    expect(tail).toContain("registrar key pinned for ledger.example: yes; methodology document pinned: yes; Registry records (D8) not checked");
    expect(tail).toContain(`address rule: ${ADDRESS_RULE}`);
    expect(tail).toContain("completeness against the real network and the readings are not established");
    const unpinned = await cli(["decl.json", "--excerpt", "read.json", "--at", READ_AT], await files());
    expect(unpinned.text).toContain("registrar key pinned: no; methodology document pinned: no");
  });

  it("binds the registrar key to --network, not to the network the read claims: a read of another network gets no key, and the record says so", async () => {
    const f = await files();
    const r = await cli(["decl.json", "--registrar-key", SFC_LEDGER_TEST_PUBLIC_JWK.x, "--network", "other.example", "--excerpt", "read.json", "--at", READ_AT], f);
    expect(r.text).toMatch(/NOT-EVALUABLE\s+D2.entry\s+.*registrar key not pinned/);
    expect(r.text).toContain("registrar key pinned for other.example: no; methodology document pinned: no");
    expect(r.code).toBe(0);
  });

  it("exits 2, not 0, when a stage stopped (an ERROR row) and nothing FAILs, and the closing line says the run is incomplete", async () => {
    const stub = {
      ...lib,
      shallowCheck: async () => ({ depth: "shallow" as const, ok: false, rows: [{ id: "ERROR", status: "NOT-EVALUABLE" as const, detail: "shallow check stopped" }] }),
    };
    const r = await cli(["decl.json", ...PIN], await files(), {}, "2026-05-02T12:00:00Z", stub);
    expect(r.code).toBe(2);
    expect(r.text).toContain("A stage did not complete (ERROR row); this is not a pass: NOT-EVALUABLE.");
    expect(r.text).not.toContain("No row failed");
  });

  it("decides the profile with the bridge's own predicate: an extension name under another host is not SFC, so the frozen 1.x checks read it", async () => {
    const decl = { ...(await files())["decl.json"], extensions: { "https://other.example/sfc/extensions/hardware-lifecycle": { "general-purpose-hardware": true } } };
    const r = await cli(["decl.json", "--at", READ_AT], { "decl.json": decl });
    expect(r.text).toContain("profile 1.x (frozen)");
    expect(r.text).toMatch(/REFUSED\s+D1 /);
    expect(r.text).not.toContain("rows:");
  });

  it("checks the served declaration as text: a duplicated figure member fails S3 and C-SFC-5 and exits 1", async () => {
    const decl = (await files())["decl.json"];
    const text = JSON.stringify(decl).replace('"energy-consumption":', '"energy-consumption":999,"energy-consumption":');
    const served = { "https://gw.example/dup": text, [decl.extensions[EV2]["ledger-access-uri"]]: SFC_LEDGER_2_FIXTURE };
    const r = await cli(["https://gw.example/dup", "--at", READ_AT], {}, served);
    expect(r.text).toMatch(/FAIL\s+S3\s+.*duplicate member or lone surrogate/);
    expect(r.text).toMatch(/FAIL\s+C-SFC-5/);
    expect(r.code).toBe(1);
  });
});
