/**
 * The experimental SFC ledger-bridge adapter: the recorded excerpt, the
 * publishing direction (every refusal, every published-not-refused case, a
 * correction, network mode), the consuming direction at both depths, and the
 * wiring of `sfc-ledger-demo.example`.
 *
 * Deterministic: a fixed fixture, the public RFC 8032 test key, no network, no
 * wall clock. Defect cases clone the fixture, change one thing, and re-sign and
 * re-hash where the case needs a valid signature.
 */
import { createHash, createPrivateKey, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import { Publisher, importSigningKey, signDeclaration, type SustainabilityMetrics } from "sustainability-wellknown-publisher";
import { validateDocument, verifyEmbeddedSignature, withoutSigned } from "sustainability-wellknown-consumer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isThirdPartyMapping } from "../src/app";
import { PUBLIC_BASE_URL } from "../src/config";
import { demoSpecs } from "../src/adapters/demo-specs";
import {
  BRIDGE_CODES,
  SFC_LEDGER_DEMO_DOMAIN,
  SUPPORTED_EXCERPT_VERSIONS,
  bridge,
  deepCheck,
  eventHash,
  jcs,
  ledgerAccessUriOf,
  readExcerpt,
  sfcLedgerBridgeAdapter,
  shallowCheck,
  verifyLedger,
  type AttestationEvent,
  type LedgerEntry,
  type LedgerExcerpt,
  type RetirementAllocation,
  type SfcLedgerBridgeConfig,
} from "../src/adapters/sfc-ledger-bridge";
import { SFC_LEDGER_FIXTURE, SFC_LEDGER_PROVIDER, SFC_LEDGER_TEST_PRIVATE_JWK, SFC_LEDGER_TEST_PUBLIC_JWK } from "../src/adapters/sfc-ledger-fixture";
import { SFC_LEDGER_DESCRIPTORS, SFC_LEDGER_PROFILE_1_2 as P, type SfcLedgerProfile } from "../src/adapters/sfc-ledger-profile";
import { subjectFromAdapter } from "../src/registry";
import { LiveRegistry, type LiveSpec } from "../src/live";
import { startGateway, type TestServer } from "./helpers";

const NS = P.namespace;
const LE = P.extensions.ledgerEvidence;
const CN = P.extensions.carbonNeutrality;
const METHODOLOGY = "https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/gateway/METHODOLOGY.md";
const ACCESS = `${PUBLIC_BASE_URL}/${SFC_LEDGER_DEMO_DOMAIN}/input`;
const DISCLOSURE = "https://ledger.example/disclosure";

/** The expected served document (without `signed`), the paper's worked example in this gateway's form. */
const EXPECTED: Record<string, unknown> = {
  updated: "2026-05-02T00:10:00Z",
  capabilities: "basic",
  provider: SFC_LEDGER_PROVIDER,
  "measurement-method": "hardware-metered",
  "methodology-uri": METHODOLOGY,
  "reporting-period": "2026-04",
  target: "validator.operator7.example",
  "energy-consumption": 412.5,
  "energy-unit": "kWh",
  "carbon-footprint": 216.75,
  "carbon-unit": "kgCO2e",
  "carbon-accounting": "location-based",
  "scope-2": 156.75,
  "scope-3": 60,
  "carbon-intensity-gCO2e-per-kWh": 380,
  "target-type": "origin",
  extensions: {
    [NS + "hardware-lifecycle"]: { "general-purpose-hardware": true, "single-use-asic-required": false },
    [NS + "carbon-neutrality"]: {
      "net-zero-status": "achieved",
      "offsets-retired-tCO2e": 0.25,
      "offset-registry-uri": "https://registry.example/retirements/operator7/2026-01",
    },
    [NS + "network-topology"]: { "member-of-network": "ledger.example" },
    [LE]: {
      "profile-version": "1.2",
      "ledger-access-uri": ACCESS,
      "hash-algorithm": "sha-256",
      "event-encoding": "rfc8785",
      "period-start": "2026-04-01",
      "period-end": "2026-04-30",
      operators: [
        {
          operator: "did:example:operator7",
          "energy-head": "a109985eef85105750328a8296b8d1038dc7ca530493fb9150e5e0a29066e761",
          "carbon-head": "78bd7dc7250feca3a7a93bf456d5df00e537ed59bd149c3c1eeda9ccbcc980ce",
          "energy-events": 1,
          "carbon-events": 1,
          kwh: 412.5,
          "scope2-kgco2e": 156.75,
          "scope3-kgco2e": 60,
          "offsets-kgco2e": 250,
          "offset-coverage-every-period": true,
        },
      ],
    },
  },
};

/** Supplementary File B of the paper (`worked-example/declaration.json`), without `signed`. */
const WORKED_EXAMPLE: Record<string, unknown> = {
  ...EXPECTED,
  provider: "Operator 7, ILLUSTRATIVE EXAMPLE: every figure is invented",
  "methodology-uri": "https://validator.operator7.example/methodology",
  extensions: {
    ...(EXPECTED.extensions as Record<string, unknown>),
    [LE]: {
      ...((EXPECTED.extensions as Record<string, Record<string, unknown>>)[LE]),
      "ledger-access-uri": "https://ledger.example/access",
      operators: [
        {
          ...((EXPECTED.extensions as Record<string, Record<string, unknown[]>>)[LE].operators[0] as Record<string, unknown>),
          "energy-head": "1111111111111111111111111111111111111111111111111111111111111111",
          "carbon-head": "2222222222222222222222222222222222222222222222222222222222222222",
        },
      ],
    },
  },
};

const canonical = (v: unknown): string => jcs(v);
const clone = <T>(v: T): T => structuredClone(v);
const privateKey = createPrivateKey({ key: SFC_LEDGER_TEST_PRIVATE_JWK, format: "jwk" });

/** Ed25519 over the canonical form without `sig` (the profile's rule), with the test key. */
function signObject<T extends { sig?: unknown }>(obj: T, signer: KeyObject = privateKey): T & { sig: { alg: "Ed25519"; value: string } } {
  const { sig: _sig, ...unsigned } = obj;
  const value = cryptoSign(null, Buffer.from(jcs(unsigned), "utf8"), signer).toString("base64url");
  return { ...obj, sig: { alg: "Ed25519", value } } as T & { sig: { alg: "Ed25519"; value: string } };
}

/** Re-sign an entry's event and recompute its stored hash. */
function reseal(entry: LedgerEntry): LedgerEntry {
  const event = signObject(entry.event) as AttestationEvent;
  return { ...entry, event, hash: eventHash(event) };
}

const APRIL_ENERGY = 6;
const APRIL_CARBON = 7;

/** A clone of the fixture with one entry's event changed, re-signed and re-hashed. */
function withEvent(index: number, change: (event: AttestationEvent) => void): LedgerExcerpt {
  const f = clone(SFC_LEDGER_FIXTURE);
  change(f.ledger[index].event);
  f.ledger[index] = reseal(f.ledger[index]);
  return f;
}

/** A new entry appended after the fixture's last one. */
function appended(f: LedgerExcerpt, commit: string, event: Omit<AttestationEvent, "sig">): LedgerExcerpt {
  const signed = signObject(event) as AttestationEvent;
  f.ledger.push({ commit, hash: eventHash(signed), event: signed });
  return f;
}

function withAllocation(f: LedgerExcerpt, change: (a: RetirementAllocation) => void): LedgerExcerpt {
  change(f.retirements[0]);
  f.retirements[0] = signObject(f.retirements[0]);
  return f;
}

let key: Awaited<ReturnType<typeof importSigningKey>>;
beforeAll(async () => {
  key = await importSigningKey(SFC_LEDGER_TEST_PRIVATE_JWK);
});

/** Build the served document exactly as the gateway does: adapter -> publisher -> signed. */
async function build(excerpt: unknown, over: Partial<SfcLedgerBridgeConfig> = {}, signed = true): Promise<SustainabilityMetrics> {
  const pub = (excerpt as LedgerExcerpt).publication;
  const adapter = sfcLedgerBridgeAdapter({ excerpt, mode: "operator", provider: SFC_LEDGER_PROVIDER, methodologyUri: METHODOLOGY, ledgerAccessUri: ACCESS, ...over });
  const publisher = new Publisher(adapter, {
    normalize: { target: pub.target, targetType: pub["target-type"] },
    ...(signed ? { signing: { key } } : {}),
  });
  return JSON.parse((await publisher.getSerialized({})).body) as SustainabilityMetrics;
}

/** The served document with members changed and a fresh signature over the result. */
async function resigned(doc: SustainabilityMetrics, change: (d: Record<string, unknown>) => void): Promise<SustainabilityMetrics> {
  const d = clone(withoutSigned(doc)) as Record<string, unknown>;
  change(d);
  return signDeclaration(d as unknown as SustainabilityMetrics, key);
}

const evidenceOf = (d: SustainabilityMetrics): Record<string, unknown> => d.extensions![LE];
const entryOf = (d: SustainabilityMetrics): Record<string, unknown> => (evidenceOf(d).operators as Record<string, unknown>[])[0];
const statusOf = (rows: { id: string; status: string }[], id: string): string | undefined => rows.find((r) => r.id === id)?.status;
const fails = (rows: { id: string; status: string }[]): string[] => rows.filter((r) => r.status === "FAIL").map((r) => r.id);

// ---------------------------------------------------------------------------

describe("the recorded excerpt", () => {
  it("is signed with RFC 8032 TEST 1 (public half, and the private half signs the empty message to the RFC's vector)", () => {
    expect(Buffer.from(SFC_LEDGER_TEST_PUBLIC_JWK.x, "base64url").toString("hex")).toBe("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
    expect(cryptoSign(null, Buffer.alloc(0), privateKey).toString("hex")).toBe(
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    );
    expect(SFC_LEDGER_FIXTURE.registry[0].keys[0]["public-jwk"].x).toBe(SFC_LEDGER_TEST_PUBLIC_JWK.x);
  });

  it("recomputes every hash and verifies every signature, chain link, flag and allocation", () => {
    const v = verifyLedger(readExcerpt(SFC_LEDGER_FIXTURE));
    expect(v.events).toHaveLength(8);
    // The flags and the allocation are checked by bridge(), which must accept the excerpt too.
    expect(() => bridge(v, { mode: "operator", provider: "p", methodologyUri: METHODOLOGY, ledgerAccessUri: ACCESS })).not.toThrow();
    for (const e of SFC_LEDGER_FIXTURE.ledger) expect(eventHash(e.event)).toBe(e.hash);
    expect(createHash("sha256").update(JSON.stringify(SFC_LEDGER_FIXTURE, null, 2) + "\n").digest("hex")).toBe("4472b215170c1a75e8705a5bb045d35e9fb3f547e2c1725f8d7f4adc2cad1317");
  });

  it("jcs: sorted members, no whitespace, ECMAScript numbers; exponents are refused by the exact arithmetic", () => {
    expect(jcs({ b: 1, a: [2, { d: null, c: "x" }] })).toBe('{"a":[2,{"c":"x","d":null}],"b":1}');
    expect(jcs(60.0)).toBe("60");
    expect(jcs(0.25)).toBe("0.25");
    expect(jcs(1e21)).toBe("1e+21");
    expect(() => jcs(Number.NaN)).toThrow("[E-NUMBER]");
    expect(() => verifyLedger(readExcerpt(withEvent(APRIL_ENERGY, (e) => { e.payload.kWhConsumed = 1e21; })))).toThrow("[E-NUMBER]");
  });

  it("reads only format version 1 and profile 1.2, and says what it supports", () => {
    expect(SUPPORTED_EXCERPT_VERSIONS).toEqual([1]);
    expect(() => readExcerpt({ ...clone(SFC_LEDGER_FIXTURE), "fixture-version": 2 })).toThrow("[E-SHAPE] excerpt.fixture-version: unsupported value 2 (supported: 1)");
    expect(() => readExcerpt({ ...clone(SFC_LEDGER_FIXTURE), "profile-version": "1.3" })).toThrow("[E-SHAPE] excerpt.profile-version: unsupported value \"1.3\"");
    expect(() => readExcerpt({ ...clone(SFC_LEDGER_FIXTURE), "hash-algorithm": "sha-512" })).toThrow("[E-SHAPE] excerpt.hash-algorithm");
    expect(() => readExcerpt("not an object")).toThrow("[E-SHAPE]");
  });

  it("ignores members it does not name: an extra payload member and an extra nodeProfile member publish unchanged", async () => {
    const extra = withEvent(APRIL_CARBON, (e) => { e.payload.foo = 1; });
    const doc = await build(extra);
    expect(validateDocument(doc).valid).toBe(true);
    expect(entryOf(doc)["carbon-head"]).toBe(extra.ledger[APRIL_CARBON].hash); // the extra member is under the hash
    const np = clone(SFC_LEDGER_FIXTURE);
    np.registry[0].nodeProfile!.reusePolicy = "https://operator7.example/reuse";
    (np.registry[0] as unknown as Record<string, unknown>).somethingNew = true;
    expect(canonical(withoutSigned(await build(np)))).toBe(canonical(EXPECTED));
  });
});

describe("publishing: events -> declaration", () => {
  let doc: SustainabilityMetrics;
  beforeAll(async () => {
    doc = await build(SFC_LEDGER_FIXTURE);
  });

  it("equals the expected document canonically, without `signed`", () => {
    expect(canonical(withoutSigned(doc))).toBe(canonical(EXPECTED));
  });

  it("validates, verifies with the pinned test key (precedence payload, no differences), carries no private member, and is byte-stable", async () => {
    expect(validateDocument(doc).valid).toBe(true);
    const o = await verifyEmbeddedSignature(doc, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] });
    expect(o.result.status).toBe("verified");
    expect(o.result.status === "verified" && o.result.precedence).toBe("payload");
    expect(o.differences ?? []).toEqual([]);
    const header = JSON.parse(Buffer.from(doc.signed!.split(".")[0], "base64url").toString("utf8"));
    expect(header.alg).toBe("EdDSA");
    expect(header.cty).toBe("sustainability-data+json");
    expect(header.jwk.x).toBe(SFC_LEDGER_TEST_PUBLIC_JWK.x);
    expect(header.jwk.d).toBeUndefined();
    expect(JSON.stringify(doc)).not.toContain(SFC_LEDGER_TEST_PRIVATE_JWK.d);
    expect(JSON.stringify(await build(SFC_LEDGER_FIXTURE))).toBe(JSON.stringify(doc));
  });

  it("equals the paper's worked example on every member but provider, methodology-uri, ledger-access-uri and the heads", () => {
    const d = clone(withoutSigned(doc)) as Record<string, unknown>;
    const w = clone(WORKED_EXAMPLE);
    for (const o of [d, w]) {
      delete o.provider;
      delete o["methodology-uri"];
      const le = (o.extensions as Record<string, Record<string, unknown>>)[LE];
      delete le["ledger-access-uri"];
      for (const op of le.operators as Record<string, unknown>[]) {
        delete op["energy-head"];
        delete op["carbon-head"];
      }
    }
    expect(canonical(d)).toBe(canonical(w));
  });

  it("keeps carbon-footprint gross, puts the credits in tonnes, and derives the intensity", () => {
    expect(doc["carbon-footprint"]).toBe(156.75 + 60);
    expect((doc.extensions![CN]["offsets-retired-tCO2e"] as number) * 1000).toBe(entryOf(doc)["offsets-kgco2e"]);
    expect(doc["carbon-intensity-gCO2e-per-kWh"]).toBe(380);
    expect(doc["verifiable-attestation-uri"]).toBeUndefined();
    expect(doc["disclosure-uri"]).toBeUndefined();
  });

  it("applies the configured Scope 2 method to a v1.1 event that carries none, and refuses without one", async () => {
    const v11 = withEvent(APRIL_CARBON, (e) => { delete e.payload.scope2Method; });
    await expect(build(v11)).rejects.toThrow("[E-METHOD]");
    const d = await build(v11, { scope2MethodDefault: "location-based" });
    expect(d["carbon-accounting"]).toBe("location-based");
    expect(d["carbon-intensity-gCO2e-per-kWh"]).toBe(380);
    const m = await build(v11, { scope2MethodDefault: "market-based" });
    expect(m["carbon-accounting"]).toBe("market-based");
    expect(m["carbon-intensity-gCO2e-per-kWh"]).toBeUndefined();
  });

  describe("refuses, naming the rule", () => {
    const cases: [string, () => unknown][] = [
      ["E-HASH", () => { const f = clone(SFC_LEDGER_FIXTURE); f.ledger[0].hash = "0".repeat(64); return f; }],
      ["E-SIG", () => { const f = clone(SFC_LEDGER_FIXTURE); const s = f.ledger[0].event.sig.value; f.ledger[0].event.sig.value = (s[0] === "A" ? "B" : "A") + s.slice(1); f.ledger[0].hash = eventHash(f.ledger[0].event); return f; }],
      ["E-KEY", () => { const f = clone(SFC_LEDGER_FIXTURE); f.registry[0].keys[0]["valid-from-commit"] = "2026-02-01T00:00:07Z"; return f; }],
      ["E-PREV", () => withEvent(APRIL_ENERGY, (e) => { e.prev = "f".repeat(64); })],
      ["E-PREV", () => withEvent(0, (e) => { e.prev = SFC_LEDGER_FIXTURE.ledger[1].hash; })],
      ["E-FORK", () => appended(clone(SFC_LEDGER_FIXTURE), "2026-06-01T00:00:06Z", {
        type: "EnergyAttested", subject: "did:example:operator7", actor: "did:example:operator7",
        prev: SFC_LEDGER_FIXTURE.ledger[APRIL_ENERGY].event.prev, ts: "2026-06-01T00:00:00Z",
        payload: { period: { from: "2026-05-01", to: "2026-05-31" }, nodeCount: 7, kWhConsumed: 400, measurementMethod: "hardware-metered", evidenceCid: "x" },
      })],
      ["E-TS", () => withEvent(APRIL_ENERGY, (e) => { e.ts = "2026-04-30T23:59:59Z"; })],
      ["E-ACTOR", () => withEvent(APRIL_ENERGY, (e) => { e.actor = "did:example:someone-else"; })],
      ["E-TYPE", () => withEvent(APRIL_ENERGY, (e) => { e.type = "WaterAttested"; })],
      ["E-OPERATOR", () => withEvent(APRIL_ENERGY, (e) => { e.subject = e.actor = "did:example:operator8"; })],
      ["E-OPERATOR", () => { const f = clone(SFC_LEDGER_FIXTURE); f.publication.target = "nobody.example"; return f; }],
      ["E-INACTIVE", () => { const f = clone(SFC_LEDGER_FIXTURE); f.registry[0].active = [{ from: "2026-05-01", to: null }]; return f; }],
      ["E-PAYLOAD", () => withEvent(APRIL_ENERGY, (e) => { (e.payload.period as Record<string, string>).to = "2026-04-15"; })],
      ["E-PAYLOAD", () => withEvent(APRIL_CARBON, (e) => { e.payload.offsetsKgCO2e = -1; })],
      ["E-NUMBER", () => withEvent(APRIL_CARBON, (e) => { e.payload.scope3KgCO2e = 1e21; })],
      ["E-ORDER", () => { const f = clone(SFC_LEDGER_FIXTURE); f.ledger[APRIL_CARBON].commit = "2026-05-01T00:00:06Z"; return f; }],
      ["E-DUPLICATE", () => appended(clone(SFC_LEDGER_FIXTURE), "2026-05-01T00:00:08Z", {
        ...clone(SFC_LEDGER_FIXTURE.ledger[APRIL_CARBON].event), prev: SFC_LEDGER_FIXTURE.ledger[APRIL_CARBON].hash, ts: "2026-05-01T00:00:01Z",
      })],
      ["E-SUPERSEDES", () => appended(clone(SFC_LEDGER_FIXTURE), "2026-05-01T00:00:08Z", {
        ...clone(SFC_LEDGER_FIXTURE.ledger[APRIL_CARBON].event), prev: SFC_LEDGER_FIXTURE.ledger[APRIL_CARBON].hash, ts: "2026-05-01T00:00:01Z",
        payload: { ...clone(SFC_LEDGER_FIXTURE.ledger[APRIL_CARBON].event.payload), supersedes: SFC_LEDGER_FIXTURE.ledger[5].hash },
      })],
      ["E-FLAG", () => withEvent(APRIL_CARBON, (e) => { e.payload.offsetsKgCO2e = 200; })],
      ["E-METHOD", () => withEvent(APRIL_CARBON, (e) => { delete e.payload.scope2Method; })],
      ["E-NOHEAD", () => { const f = clone(SFC_LEDGER_FIXTURE); f.ledger = f.ledger.filter((e) => e.event.type !== "CarbonAttested"); return f; }],
      ["E-EMPTY", () => { const f = clone(SFC_LEDGER_FIXTURE); f.ledger = f.ledger.slice(0, APRIL_ENERGY); return f; }],
      ["E-ALLOCATION", () => withAllocation(clone(SFC_LEDGER_FIXTURE), (a) => { a.parts.push({ period: "2026-05", kg: 250 }); })],
      ["E-ALLOCATION", () => withAllocation(clone(SFC_LEDGER_FIXTURE), (a) => { a.parts[3].kg = 200; })],
      ["E-ALLOCATION", () => withAllocation(clone(SFC_LEDGER_FIXTURE), (a) => { a.beneficiary = "did:example:operator8"; })],
      ["E-ALLOCATION", () => { const f = clone(SFC_LEDGER_FIXTURE); f.retirements[0].sig.value = "A".repeat(86); return f; }],
      ["E-PERIOD", () => { const f = clone(SFC_LEDGER_FIXTURE); f.publication["reporting-period"] = "2026"; return f; }],
      ["E-PERIOD", () => { const f = clone(SFC_LEDGER_FIXTURE); f.publication["period-end"] = "2026-04-29"; return f; }],
      ["E-SHAPE", () => ({ ...clone(SFC_LEDGER_FIXTURE), "fixture-version": 2 })],
      ["E-SHAPE", () => { const f = clone(SFC_LEDGER_FIXTURE); (f.ledger[0] as Record<string, unknown>).hash = "xyz"; return f; }],
      ["E-SHAPE", () => { const f = clone(SFC_LEDGER_FIXTURE); f.registry.push(clone(f.registry[0])); return f; }],
      ["E-SHAPE", () => { const f = clone(SFC_LEDGER_FIXTURE); f.registry.push({ ...clone(f.registry[0]), operator: "did:example:other" }); return f; }], // same origin twice
      ["E-SHAPE", () => { const f = clone(SFC_LEDGER_FIXTURE); f.ledger[0].commit = "2026-02-30T00:00:06Z"; return f; }], // no such day
      ["E-SIG", () => { const f = clone(SFC_LEDGER_FIXTURE); f.ledger[0].event.sig.value += "=="; f.ledger[0].hash = eventHash(f.ledger[0].event); return f; }], // padded base64url
      ["E-INACTIVE", () => { const f = clone(SFC_LEDGER_FIXTURE); f.registry[0].active = [{ from: "2026-02-01", to: null }]; return f; }], // a January attestation
      ["E-PAYLOAD", () => withEvent(APRIL_CARBON, (e) => { e.payload.scope2KgCO2e = -70; e.payload.netZero = true; })], // negative gross
    ];
    for (const [code, make] of cases) {
      it(`${code}: ${make.toString().slice(0, 70).replace(/\s+/g, " ")}…`, async () => {
        await expect(build(make())).rejects.toThrow(`[${code}]`);
      });
    }

    it("E-DISCLOSURE and E-CONFIG at construction; every code is listed", () => {
      const base = { excerpt: SFC_LEDGER_FIXTURE, provider: "p", methodologyUri: METHODOLOGY, ledgerAccessUri: ACCESS } as const;
      expect(() => sfcLedgerBridgeAdapter({ ...base, mode: "network" })).toThrow("[E-DISCLOSURE]");
      expect(() => sfcLedgerBridgeAdapter({ ...base, mode: "operator", ledgerAccessUri: "http://127.0.0.1:8080/x/input" })).toThrow("[E-CONFIG]");
      expect(() => sfcLedgerBridgeAdapter({ ...base, mode: "operator", disclosureUri: "ftp://x" })).toThrow("[E-CONFIG]");
      expect(() => sfcLedgerBridgeAdapter({ ...base, mode: "both" as "operator" })).toThrow("[E-CONFIG]");
      // Every code has at least one test that reaches it, and every tested code is listed.
      expect([...new Set([...cases.map((c) => c[0]), "E-DISCLOSURE", "E-CONFIG"])].sort()).toEqual([...BRIDGE_CODES].sort());
    });
  });

  describe("publishes, not refuses", () => {
    it("figures at the publisher's rounding boundary pass both checks (exact comparisons)", async () => {
      const cases: LedgerExcerpt[] = [
        withEvent(APRIL_ENERGY, (e) => { e.payload.kWhConsumed = 0.10035; }),
        withEvent(APRIL_CARBON, (e) => { e.payload.scope2KgCO2e = 156.75035; }),
        withAllocation(withEvent(APRIL_CARBON, (e) => { e.payload.offsetsKgCO2e = 0.15; e.payload.netZero = false; }), (a) => { a.parts[3].kg = 0.15; }),
      ];
      for (const f of cases) {
        const d = await build(f);
        expect(fails((await shallowCheck(d, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual([]);
        expect(fails(deepCheck(d, f).rows)).toEqual([]);
      }
      // Credits are published exactly in tonnes, however many places that takes.
      const d = await build(cases[2]);
      expect(d.extensions![CN]["offsets-retired-tCO2e"]).toBe(0.00015);
    });

    it("an allocation or a part carrying a member the bridge does not name (covered by the signature)", async () => {
      const f = withAllocation(clone(SFC_LEDGER_FIXTURE), (a) => {
        (a as unknown as Record<string, unknown>).note = "registry batch 7";
        (a.parts[3] as unknown as Record<string, unknown>).memo = "April";
      });
      const d = await build(f);
      expect(canonical(withoutSigned(d))).toBe(canonical(EXPECTED));
      expect(fails(deepCheck(d, f).rows)).toEqual([]);
    });

    it("two Registry keys valid at a commit: the one that verifies is accepted", async () => {
      const other = generateKeyPairSync("ed25519").publicKey.export({ format: "jwk" }).x as string;
      const f = clone(SFC_LEDGER_FIXTURE);
      f.registry[0].keys.unshift({ "public-jwk": { kty: "OKP", crv: "Ed25519", x: other }, "valid-from-commit": "2026-01-01T00:00:00Z", "valid-to-commit": null });
      expect(canonical(withoutSigned(await build(f)))).toBe(canonical(EXPECTED));
    });

    it("a negative Scope 2 (removals) with a non-negative gross: published without an intensity", async () => {
      const d = await build(withEvent(APRIL_CARBON, (e) => { e.payload.scope2KgCO2e = -10; }));
      expect(d["scope-2"]).toBe(-10);
      expect(d["carbon-footprint"]).toBe(50);
      expect(d["carbon-intensity-gCO2e-per-kWh"]).toBeUndefined();
    });

    it("an allocation signed by any key the Registry holds for the operator (allocations carry no commit time)", async () => {
      const second = generateKeyPairSync("ed25519");
      const f = clone(SFC_LEDGER_FIXTURE);
      const x = second.publicKey.export({ format: "jwk" }).x as string;
      // Valid at no event's commit: only the "any Registry key" rule can accept it.
      f.registry[0].keys.push({ "public-jwk": { kty: "OKP", crv: "Ed25519", x }, "valid-from-commit": "2020-01-01T00:00:00Z", "valid-to-commit": "2020-02-01T00:00:00Z" });
      f.retirements[0] = signObject(f.retirements[0], second.privateKey);
      const d = await build(f);
      expect(fails(deepCheck(d, f).rows)).toEqual([]);
      // The same allocation signed by a key the Registry does not hold is refused.
      const g = clone(SFC_LEDGER_FIXTURE);
      g.retirements[0] = signObject(g.retirements[0], second.privateKey);
      await expect(build(g)).rejects.toThrow("[E-ALLOCATION]");
    });

    it("a later profile version, as a second descriptor, round-trips through both checks; 1.2 documents still pass", async () => {
      const f = { ...clone(SFC_LEDGER_FIXTURE), "profile-version": "1.2.1" };
      await expect(build(f)).rejects.toThrow('[E-SHAPE] excerpt.profile-version: unsupported value "1.2.1" (supported: 1.2)');
      const descriptors = SFC_LEDGER_DESCRIPTORS as SfcLedgerProfile[];
      descriptors.push({ ...P, version: "1.2.1", supportedVersions: ["1.2.1"] });
      try {
        const d = await build(f);
        expect(evidenceOf(d)["profile-version"]).toBe("1.2.1");
        expect(fails(deepCheck(d, f).rows)).toEqual([]);
        expect(fails((await shallowCheck(d, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual([]);
        // The 1.2 document is still read by the 1.2 descriptor.
        const old = await build(SFC_LEDGER_FIXTURE);
        expect(fails(deepCheck(old, SFC_LEDGER_FIXTURE).rows)).toEqual([]);
        // A 1.2.1 declaration checked against the 1.2 excerpt is a different publication.
        expect(fails(deepCheck(d, SFC_LEDGER_FIXTURE).rows)).toEqual(["D1 ledger-access"]);
      } finally {
        descriptors.pop();
      }
    });

    it("a failed month with a correct flag: coverage false, status partial", async () => {
      let f = withEvent(APRIL_CARBON, (e) => { e.payload.offsetsKgCO2e = 200; e.payload.netZero = false; });
      f = withAllocation(f, (a) => { a.parts[3].kg = 200; });
      const d = await build(f);
      expect(entryOf(d)["offset-coverage-every-period"]).toBe(false);
      expect(d.extensions![CN]["net-zero-status"]).toBe("partial");
      expect(d.extensions![CN]["offsets-retired-tCO2e"]).toBe(0.2);
      expect(d["carbon-footprint"]).toBe(216.75);
    });

    it("nothing retired: status not-achieved, no registry pointer", async () => {
      let f = withEvent(APRIL_CARBON, (e) => { e.payload.offsetsKgCO2e = 0; e.payload.netZero = false; });
      f = withAllocation(f, (a) => { a.parts = a.parts.filter((p) => p.period !== "2026-04"); });
      const d = await build(f);
      expect(d.extensions![CN]).toEqual({ "net-zero-status": "not-achieved", "offsets-retired-tCO2e": 0 });
    });

    it("a silent carbon month: coverage false, carbon-events 0, the top-level carbon members omitted, energy present", async () => {
      const f = clone(SFC_LEDGER_FIXTURE);
      f.ledger.splice(APRIL_CARBON, 1);
      const d = await build(f);
      expect(d["energy-consumption"]).toBe(412.5);
      for (const k of ["carbon-footprint", "carbon-unit", "carbon-accounting", "scope-2", "scope-3", "carbon-intensity-gCO2e-per-kWh"] as const) expect(d[k], k).toBeUndefined();
      expect(entryOf(d)["carbon-events"]).toBe(0);
      expect(entryOf(d)["carbon-head"]).toBe(SFC_LEDGER_FIXTURE.ledger[5].hash);
      expect(entryOf(d)["offset-coverage-every-period"]).toBe(false);
      expect(d.extensions![CN]["net-zero-status"]).toBe("not-achieved");
      expect(validateDocument(d).valid).toBe(true);
    });

    it("a silent energy month: energy and the intensity omitted, the carbon figures present", async () => {
      const f = clone(SFC_LEDGER_FIXTURE);
      f.ledger.splice(APRIL_ENERGY, 1);
      const d = await build(f);
      expect(d["energy-consumption"]).toBeUndefined();
      expect(d["energy-unit"]).toBeUndefined();
      expect(d["carbon-intensity-gCO2e-per-kWh"]).toBeUndefined();
      expect(d["scope-2"]).toBe(156.75);
      expect(d["measurement-method"]).toMatch(/^not stated/);
      expect(entryOf(d)["energy-events"]).toBe(0);
    });

    it("a correction: two events counted, the correction's figures and hash used", async () => {
      const first = SFC_LEDGER_FIXTURE.ledger[APRIL_CARBON];
      const f = appended(clone(SFC_LEDGER_FIXTURE), "2026-05-03T00:00:00Z", {
        ...clone(first.event), prev: first.hash, ts: "2026-05-03T00:00:00Z",
        payload: { ...clone(first.event.payload), scope3KgCO2e: 70, supersedes: first.hash },
      });
      const d = await build(f);
      expect(entryOf(d)["carbon-events"]).toBe(2);
      expect(d["scope-3"]).toBe(70);
      expect(d["carbon-footprint"]).toBe(226.75);
      expect(entryOf(d)["carbon-head"]).toBe(f.ledger.at(-1)!.hash);
      expect(entryOf(d)["offset-coverage-every-period"]).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Network mode: two operators, one year, generated here with the test key.
// ---------------------------------------------------------------------------

interface MonthFigures {
  kwh: number;
  scope2: number;
  scope3: number;
  offsets: number;
  scope2Method?: string;
  /** Leave out the EnergyAttested of this month only. */
  skipEnergy?: boolean;
}

/** A whole-year excerpt for `operators`, each with twelve attested months of 2025. */
function networkExcerpt(operators: string[], figures: (operator: string, month: number) => MonthFigures | null): LedgerExcerpt {
  const key0 = SFC_LEDGER_FIXTURE.registry[0].keys[0];
  const registry = operators.map((did, i) => ({
    operator: did,
    origin: `node${i + 1}.example`,
    active: [{ from: "2025-01-01", to: null }],
    keys: [{ ...clone(key0), "valid-from-commit": "2025-01-01T00:00:00Z" }],
    nodeProfile: { hardwareClass: "arm64-server", asicForbidden: true },
  }));
  const ledger: LedgerEntry[] = [];
  const retirements: RetirementAllocation[] = [];
  const heads = new Map<string, string | null>();
  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, "0");
    const from = `2025-${mm}-01`;
    const to = `2025-${mm}-${new Date(Date.UTC(2025, month, 0)).getUTCDate()}`;
    const next = month === 12 ? "2026-01-01" : `2025-${String(month + 1).padStart(2, "0")}-01`;
    for (const [i, did] of operators.entries()) {
      const fig = figures(did, month);
      if (!fig) continue;
      const sec = 10 + i * 2;
      if (!fig.skipEnergy) {
      const energy = signObject({
        type: "EnergyAttested", subject: did, actor: did, prev: heads.get(`${did}|energy`) ?? null, ts: `${next}T00:00:00Z`,
        payload: { period: { from, to }, nodeCount: 3, kWhConsumed: fig.kwh, measurementMethod: "hardware-metered", evidenceCid: `cid:${did}/${mm}/e` },
      }) as AttestationEvent;
      ledger.push({ commit: `${next}T00:00:${String(sec).padStart(2, "0")}Z`, hash: eventHash(energy), event: energy });
      heads.set(`${did}|energy`, eventHash(energy));
      }
      const carbon = signObject({
        type: "CarbonAttested", subject: did, actor: did, prev: heads.get(`${did}|carbon`) ?? null, ts: `${next}T00:00:00Z`,
        payload: {
          period: { from, to }, scope2KgCO2e: fig.scope2, scope2Method: fig.scope2Method ?? "location-based", scope3KgCO2e: fig.scope3,
          gridIntensityRef: `grid.example:z:${mm}`, offsetsKgCO2e: fig.offsets, netZero: fig.scope2 + fig.scope3 <= fig.offsets, evidenceCid: `cid:${did}/${mm}/c`,
        },
      }) as AttestationEvent;
      ledger.push({ commit: `${next}T00:00:${String(sec + 1).padStart(2, "0")}Z`, hash: eventHash(carbon), event: carbon });
      heads.set(`${did}|carbon`, eventHash(carbon));
    }
  }
  for (const did of operators) {
    const parts = [];
    for (let month = 1; month <= 12; month++) {
      const fig = figures(did, month);
      if (fig && fig.offsets > 0) parts.push({ period: `2025-${String(month).padStart(2, "0")}`, kg: fig.offsets });
    }
    retirements.push(signObject({ type: "RetirementAllocation", operator: did, "registry-uri": `https://registry.example/${did}`, "retired-in": "2025-01", "tonnes-retired": 1, beneficiary: did, parts }));
  }
  return {
    fixture: "network-test.example", "fixture-version": 1, notice: "SYNTHETIC test excerpt", "profile-version": "1.2", "hash-algorithm": "sha-256", "event-encoding": "rfc8785",
    network: "ledger.example", registry, retirements, ledger,
    publication: { "reporting-period": "2025", "period-start": "2025-01-01", "period-end": "2025-12-31", updated: "2026-01-15T00:00:00Z", target: "ledger.example", "target-type": "service" },
  };
}

const OPS = ["did:example:a", "did:example:b"];
const steady: MonthFigures = { kwh: 100, scope2: 38, scope3: 10, offsets: 60 };
const networkConfig = { mode: "network" as const, disclosureUri: DISCLOSURE };

describe("network mode (one year, every active operator)", () => {
  it("publishes a service declaration with the network flag, the disclosure index, and no topology extension", async () => {
    const d = await build(networkExcerpt(OPS, () => steady), networkConfig);
    expect(d["target-type"]).toBe("service");
    expect(d["reporting-period"]).toBe("2025");
    expect(d["disclosure-uri"]).toBe(DISCLOSURE);
    expect(d["energy-consumption"]).toBe(2400);
    expect(d["scope-2"]).toBe(912);
    expect(d["carbon-footprint"]).toBe(1152);
    expect(d["carbon-intensity-gCO2e-per-kWh"]).toBe(380);
    expect(evidenceOf(d)["network-offset-coverage"]).toBe(true);
    expect((evidenceOf(d).operators as unknown[]).length).toBe(2);
    expect(d.extensions![CN]["net-zero-status"]).toBe("achieved");
    expect(d.extensions![CN]["offsets-retired-tCO2e"]).toBe(1.44);
    expect(d.extensions![CN]["offset-registry-uri"]).toBeUndefined(); // two allocations contribute
    expect(d.extensions![P.extensions.networkTopology]).toBeUndefined();
    expect(d.extensions![P.extensions.hardwareLifecycle]).toBeDefined();
    const s = await shallowCheck(d, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] });
    expect(fails(s.rows)).toEqual([]);
    expect(statusOf(s.rows, "S4a C-SFC-2-disclosure")).toBe("PASS");
    expect(statusOf(s.rows, "S4b C-SFC-5")).toBe("PASS");
    const deep = deepCheck(d, networkExcerpt(OPS, () => steady));
    expect(fails(deep.rows)).toEqual([]);
  });

  it("one operator failing one month: its coverage false, the network flag still true, status partial", async () => {
    const x = networkExcerpt(OPS, (op, m) => (op === OPS[1] && m === 6 ? { ...steady, offsets: 40 } : steady));
    const d = await build(x, networkConfig);
    const ops = evidenceOf(d).operators as Record<string, unknown>[];
    expect(ops.map((o) => o["offset-coverage-every-period"])).toEqual([true, false]);
    expect(evidenceOf(d)["network-offset-coverage"]).toBe(true);
    expect(d.extensions![CN]["net-zero-status"]).toBe("partial");
    expect(fails((await shallowCheck(d, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual([]);
    expect(fails(deepCheck(d, x).rows)).toEqual([]);
  });

  it("a silent energy month of one operator: energy-consumption AND the intensity omitted (the ratio would mix month sets)", async () => {
    const x = networkExcerpt(OPS, (op, m) => (op === OPS[0] && m === 3 ? { ...steady, skipEnergy: true } : steady));
    const d = await build(x, networkConfig);
    expect(d["energy-consumption"]).toBeUndefined();
    expect(d["energy-unit"]).toBeUndefined();
    expect(d["carbon-intensity-gCO2e-per-kWh"]).toBeUndefined();
    expect(d["scope-2"]).toBe(912); // every carbon month is attested, so the carbon figures stand
    expect(d["carbon-footprint"]).toBe(1152);
    expect((evidenceOf(d).operators as Record<string, unknown>[])[0]["energy-events"]).toBe(11);
    expect(fails(deepCheck(d, x).rows)).toEqual([]);
    expect(statusOf((await shallowCheck(d, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows, "S5b coherence-energy")).toBe("SKIPPED");
  });

  it("refuses when the operators' Scope 2 methods disagree", async () => {
    const x = networkExcerpt(OPS, (op, m) => (op === OPS[1] && m === 2 ? { ...steady, scope2Method: "market-based" } : steady));
    await expect(build(x, networkConfig)).rejects.toThrow("[E-METHOD]");
  });

  it("a network year must carry a disclosure index", async () => {
    await expect(build(networkExcerpt(OPS, () => steady), { mode: "network" })).rejects.toThrow("[E-DISCLOSURE]");
  });

  it("bridge() exposes the exact totals a reader recomputes", () => {
    const b = bridge(verifyLedger(readExcerpt(networkExcerpt(OPS, () => steady))), { mode: "network", provider: "p", methodologyUri: METHODOLOGY, ledgerAccessUri: ACCESS, disclosureUri: DISCLOSURE });
    expect(b.entries.map((e) => e.operator)).toEqual(OPS);
    expect(b.months).toHaveLength(12);
    expect(b.networkOffsetCoverage).toBe(true);
    expect(b.raw.energy).toEqual({ value: 2400, unit: "kWh" });
  });
});

// ---------------------------------------------------------------------------
// Consuming: the two checks
// ---------------------------------------------------------------------------

describe("the shallow check", () => {
  let doc: SustainabilityMetrics;
  beforeAll(async () => {
    doc = await build(SFC_LEDGER_FIXTURE);
  });

  it("passes on the served document; C1 and C-SFC-5 are refused for an operator month", async () => {
    const r = await shallowCheck(doc, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] });
    expect(r.ok).toBe(true);
    expect(fails(r.rows)).toEqual([]);
    expect(statusOf(r.rows, "S1 fetch")).toBe("SKIPPED");
    expect(statusOf(r.rows, "S3 signature")).toBe("PASS");
    expect(statusOf(r.rows, "S4a C-SFC-2-disclosure")).toBe("REFUSED");
    expect(statusOf(r.rows, "S4b C-SFC-5")).toBe("REFUSED");
    expect(r.rows.at(-1)).toEqual({ id: "S6 record", status: "INFO", detail: "attributed to the origin; integrity verified with the pinned key; figures self-asserted; accuracy unknown" });
    expect(JSON.stringify(r.rows)).not.toMatch(/\bverified\b(?! with the pinned key)/);
  });

  it("reports how the document was fetched when the caller says so (S1)", async () => {
    const ok = await shallowCheck(doc, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK], fetched: { url: "https://gw.example/x", contentType: "application/sustainability-data+json" } });
    expect(statusOf(ok.rows, "S1 fetch")).toBe("PASS");
    const plain = await shallowCheck(doc, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK], fetched: { url: "https://gw.example/x", contentType: "application/json; charset=utf-8" } });
    expect(fails(plain.rows)).toEqual(["S1 fetch"]);
    const http = await shallowCheck(doc, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK], fetched: { url: "http://127.0.0.1:8080/x", contentType: "application/sustainability-data+json" } });
    expect(fails(http.rows)).toEqual(["S1 fetch"]);
    const local = await shallowCheck(doc, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK], fetched: { url: "http://127.0.0.1:8080/x", contentType: "application/sustainability-data+json", httpAllowed: true } });
    expect(statusOf(local.rows, "S1 fetch")).toBe("PASS");
    expect(local.rows.find((x) => x.id === "S1 fetch")!.detail).toContain("allowed by the caller");
    expect(ledgerAccessUriOf(doc)).toBe(ACCESS);
    expect(ledgerAccessUriOf({})).toBeUndefined();
  });

  it("names the served member that differs from the signed payload", async () => {
    const tampered = clone(doc);
    (tampered.extensions![LE].operators as Record<string, unknown>[])[0].kwh = 41.25;
    const r = await shallowCheck(tampered, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] });
    expect(fails(r.rows)).toEqual(["S3 signature", "S5b coherence-energy"]);
    expect(r.rows.find((x) => x.id === "S3 signature")!.detail).toContain("extensions");
  });

  it("fails on a missing signature, a wrong pinned key, and a document that is not an object", async () => {
    const unsigned = withoutSigned(doc);
    expect(fails((await shallowCheck(unsigned, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual(["S3 signature"]);
    const other = { ...SFC_LEDGER_TEST_PUBLIC_JWK, x: "Iwh2utWtXerk9chIz_ZJpg6JjGzW6mY9FIMdtgc2wKE" };
    expect(fails((await shallowCheck(doc, { trustedKeys: [other] })).rows)).toEqual(["S3 signature"]);
    const r = await shallowCheck("nonsense", { trustedKeys: [] });
    expect(r.rows.filter((x) => x.status === "FAIL").map((x) => x.id)).toEqual(["S2 draft-conformance"]);
    expect(r.rows).toHaveLength(2);
  });

  it("finds incoherence in a correctly re-signed document", async () => {
    const energy = await resigned(doc, (d) => { ((d.extensions as Record<string, Record<string, unknown[]>>)[LE].operators[0] as Record<string, unknown>).kwh = 41.25; });
    expect(fails((await shallowCheck(energy, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual(["S5b coherence-energy"]);
    const status = await resigned(doc, (d) => { ((d.extensions as Record<string, Record<string, unknown>>)[CN])["net-zero-status"] = "partial"; });
    expect(fails((await shallowCheck(status, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual(["S5e coherence-status"]);
    const empty = await resigned(doc, (d) => { (d.extensions as Record<string, Record<string, unknown>>)[LE].operators = []; });
    expect(fails((await shallowCheck(empty, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual(["S5a ledger-evidence-shape"]);
    const http = await resigned(doc, (d) => { (d.extensions as Record<string, Record<string, unknown>>)[LE]["ledger-access-uri"] = "http://ledger.example/x"; });
    expect(fails((await shallowCheck(http, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual(["S5a ledger-evidence-shape"]);
    const none = await resigned(doc, (d) => { delete (d.extensions as Record<string, unknown>)[LE]; });
    expect(fails((await shallowCheck(none, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual(["S5a ledger-evidence-shape"]);
  });

  it("applies the draft's unit defaults when a unit member is absent", async () => {
    // energy-unit absent means kWh: 412.5 agrees. carbon-unit absent means gCO2e: 156.75 g is not 156.75 kg.
    const d = await resigned(doc, (x) => { delete x["energy-unit"]; delete x["carbon-unit"]; });
    const r = await shallowCheck(d, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] });
    expect(statusOf(r.rows, "S5b coherence-energy")).toBe("PASS");
    expect(statusOf(r.rows, "S5c coherence-scope-2")).toBe("FAIL");
    expect(statusOf(r.rows, "S5c coherence-scope-3")).toBe("FAIL");
  });
});

describe("the deep check", () => {
  let doc: SustainabilityMetrics;
  beforeAll(async () => {
    doc = await build(SFC_LEDGER_FIXTURE);
  });

  it("passes against the recorded excerpt; the anchor row is skipped; nothing is called verified but signatures", () => {
    const r = deepCheck(doc, SFC_LEDGER_FIXTURE);
    expect(r.ok).toBe(true);
    expect(fails(r.rows)).toEqual([]);
    expect(statusOf(r.rows, "D8 anchor")).toBe("SKIPPED");
    expect(statusOf(r.rows, "D7 C-SFC-3")).toBe("PASS");
    expect(r.rows.at(-1)!.detail).toBe("the declaration agrees with the signed ledger record at the stated heads; nothing shows that the readings were true");
  });

  it("fails the right row on a re-signed declaration that misstates the record", async () => {
    const le = (d: Record<string, unknown>): Record<string, unknown> => (d.extensions as Record<string, Record<string, unknown>>)[LE];
    const op = (d: Record<string, unknown>): Record<string, unknown> => (le(d).operators as Record<string, unknown>[])[0];
    const cases: [string | string[], (d: Record<string, unknown>) => void][] = [
      ["D4 chains", (d) => { op(d)["energy-head"] = "e".repeat(64); }],
      ["D4 chains", (d) => { op(d)["energy-head"] = SFC_LEDGER_FIXTURE.ledger[4].hash; }], // March's event: the walk misses April
      ["D4 chains", (d) => { op(d)["carbon-events"] = 2; }],
      [["D6 sums", "D6b declaration"], (d) => { op(d).kwh = 400; d["energy-consumption"] = 400; }],
      [["D5 C-SFC-4", "D6b declaration"], (d) => { op(d)["offset-coverage-every-period"] = false; (d.extensions as Record<string, Record<string, unknown>>)[CN]["net-zero-status"] = "partial"; }],
      ["D2 operator-set", (d) => { op(d).operator = "did:example:operator8"; }],
      ["D9 retirements", (d) => { (d.extensions as Record<string, Record<string, unknown>>)[CN]["offset-registry-uri"] = "https://registry.example/other"; }],
      ["D1 ledger-access", (d) => { le(d)["period-end"] = "2026-04-29"; }],
    ];
    for (const [rowIds, change] of cases) {
      const want = Array.isArray(rowIds) ? rowIds : [rowIds];
      const d = await resigned(doc, change);
      expect(fails((await shallowCheck(d, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows).filter((id) => id.startsWith("S3")), want.join()).toEqual([]);
      expect(fails(deepCheck(d, SFC_LEDGER_FIXTURE).rows), want.join()).toEqual(want);
    }
  });

  it("fails on an excerpt that does not support the declaration, and stops there", () => {
    const keyed = clone(SFC_LEDGER_FIXTURE);
    keyed.registry[0].keys[0]["public-jwk"].x = "Iwh2utWtXerk9chIz_ZJpg6JjGzW6mY9FIMdtgc2wKE";
    const r = deepCheck(doc, keyed);
    expect(fails(r.rows)).toEqual(["D3 signatures"]);
    expect(statusOf(r.rows, "D6 sums")).toBe("SKIPPED");

    const over = withAllocation(clone(SFC_LEDGER_FIXTURE), (a) => { a.parts.push({ period: "2026-05", kg: 250 }); });
    expect(fails(deepCheck(doc, over).rows)).toEqual(["D9 retirements"]);

    const sha512 = { ...clone(SFC_LEDGER_FIXTURE), "hash-algorithm": "sha-512" };
    expect(fails(deepCheck(doc, sha512).rows)).toEqual(["D1 ledger-access"]);

    const noProfile = clone(SFC_LEDGER_FIXTURE);
    delete noProfile.registry[0].nodeProfile;
    expect(fails(deepCheck(doc, noProfile).rows)).toEqual(["D7 C-SFC-3"]);
  });

  it("D7 is REFUSED, not failed, when the declaration makes no hardware claim", async () => {
    const np = clone(SFC_LEDGER_FIXTURE);
    delete np.registry[0].nodeProfile;
    const d = await build(np);
    expect(d.extensions![P.extensions.hardwareLifecycle]).toBeUndefined();
    const r = deepCheck(d, np);
    expect(fails(r.rows)).toEqual([]);
    expect(statusOf(r.rows, "D7 C-SFC-3")).toBe("REFUSED");
    expect(fails((await shallowCheck(d, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual([]);
  });

  it("takes the Scope 2 default a v1.1 excerpt needs, and reports its absence under the sums row", async () => {
    const v11 = withEvent(APRIL_CARBON, (e) => { delete e.payload.scope2Method; });
    const d = await build(v11, { scope2MethodDefault: "location-based" });
    expect(fails(deepCheck(d, v11, { scope2MethodDefault: "location-based" }).rows)).toEqual([]);
    const r = deepCheck(d, v11);
    expect(fails(r.rows)).toEqual(["D6 sums"]);
    expect(r.rows.find((x) => x.id === "D6 sums")!.detail).toContain("[E-METHOD]");
  });

  it("an explicit Scope 2 method that differs from the configured default is refused", async () => {
    const x = networkExcerpt(OPS, (op, m) => (op === OPS[1] && m === 2 ? { ...steady, scope2Method: "market-based" } : steady));
    for (const e of x.ledger) if (e.event.type === "CarbonAttested" && e.event.payload.scope2Method === "location-based") delete e.event.payload.scope2Method;
    x.ledger = x.ledger.map(reseal);
    // Re-sealing changes every hash: re-link the chains.
    const heads = new Map<string, string>();
    x.ledger = x.ledger.map((e) => {
      const k = `${e.event.subject}|${e.event.type}`;
      const sealed = reseal({ ...e, event: { ...e.event, prev: heads.get(k) ?? null } });
      heads.set(k, sealed.hash);
      return sealed;
    });
    await expect(build(x, { ...networkConfig, scope2MethodDefault: "location-based" })).rejects.toThrow("[E-METHOD]");
  });

  it("puts an event-rule refusal on the events row and keeps one row per id", async () => {
    const d = await build(SFC_LEDGER_FIXTURE);
    const early = withEvent(APRIL_ENERGY, (e) => { e.ts = "2026-04-30T23:59:59Z"; });
    const r = deepCheck(d, early);
    expect(fails(r.rows)).toEqual(["D3 signatures"]);
    expect(r.rows.find((x) => x.id === "D3 signatures")!.detail).toContain("[E-TS]");
    expect(statusOf(r.rows, "D1 ledger-access")).toBe("PASS");
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(r.rows.length);
  });

  it("catches a network declaration that lists every operator twice and doubles every figure", async () => {
    const x = networkExcerpt(OPS, () => steady);
    const d = await build(x, networkConfig);
    const doubled = await resigned(d, (m) => {
      const le = (m.extensions as Record<string, Record<string, unknown>>)[LE];
      le.operators = [...(le.operators as unknown[]), ...(le.operators as unknown[])];
      for (const k of ["energy-consumption", "scope-2", "scope-3", "carbon-footprint"]) m[k] = (m[k] as number) * 2;
      const cn = (m.extensions as Record<string, Record<string, unknown>>)[CN];
      cn["offsets-retired-tCO2e"] = (cn["offsets-retired-tCO2e"] as number) * 2;
    });
    expect(validateDocument(doubled).valid).toBe(true);
    expect(fails((await shallowCheck(doubled, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows)).toEqual(["S5a ledger-evidence-shape"]);
    expect(fails(deepCheck(doubled, x).rows)).toEqual(["S5a ledger-evidence-shape"]);
  });

  it("compares every top-level figure with the recomputation (D6b), which the shallow check cannot", async () => {
    const d = await build(SFC_LEDGER_FIXTURE);
    const changes: ((m: Record<string, unknown>) => void)[] = [
      (m) => { m["carbon-accounting"] = "market-based"; delete m["carbon-intensity-gCO2e-per-kWh"]; },
      (m) => { m["carbon-intensity-gCO2e-per-kWh"] = 300; },
      (m) => { m["measurement-method"] = "hardware-estimated"; },
      (m) => { m["carbon-footprint"] = 200; },
    ];
    for (const change of changes) {
      const t = await resigned(d, change);
      expect(fails((await shallowCheck(t, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] })).rows), change.toString()).toEqual([]);
      expect(fails(deepCheck(t, SFC_LEDGER_FIXTURE).rows), change.toString()).toEqual(["D6b declaration"]);
    }
    expect(statusOf(deepCheck(d, SFC_LEDGER_FIXTURE).rows, "D6b declaration")).toBe("PASS");
  });

  it("D1 compares the network membership and the update time with the excerpt; D7 checks the claimed values", async () => {
    const d = await build(SFC_LEDGER_FIXTURE);
    const elsewhere = await resigned(d, (m) => { (m.extensions as Record<string, Record<string, unknown>>)[P.extensions.networkTopology]["member-of-network"] = "evil.example"; });
    expect(fails(deepCheck(elsewhere, SFC_LEDGER_FIXTURE).rows)).toEqual(["D1 ledger-access"]);
    const later = await resigned(d, (m) => { m.updated = "2030-01-01T00:00:00Z"; });
    expect(fails(deepCheck(later, SFC_LEDGER_FIXTURE).rows)).toEqual(["D1 ledger-access"]);
    const asic = await resigned(d, (m) => {
      (m.extensions as Record<string, Record<string, unknown>>)[P.extensions.hardwareLifecycle] = { "general-purpose-hardware": false, "single-use-asic-required": true };
    });
    expect(fails(deepCheck(asic, SFC_LEDGER_FIXTURE).rows)).toEqual(["D7 C-SFC-3"]);
  });

  it("bounds the keys per operator and the allocations an excerpt may carry", async () => {
    const d = await build(SFC_LEDGER_FIXTURE);
    const keys = clone(SFC_LEDGER_FIXTURE);
    keys.registry[0].keys = Array.from({ length: P.bounds.maxKeysPerOperator + 1 }, () => clone(keys.registry[0].keys[0]));
    expect(fails(deepCheck(d, keys).rows)).toEqual(["D1 ledger-access"]);
    const allocations = clone(SFC_LEDGER_FIXTURE);
    allocations.retirements = Array.from({ length: P.bounds.maxAllocations + 1 }, () => clone(allocations.retirements[0]));
    expect(fails(deepCheck(d, allocations).rows)).toEqual(["D1 ledger-access"]);
  });

  it("never throws and is bounded on a hostile excerpt", () => {
    // Two entries pointing at each other through their stored hashes: the hashes do not recompute,
    // so the walk never starts; every row after is skipped.
    const cyc = clone(SFC_LEDGER_FIXTURE);
    cyc.ledger[0].event.prev = cyc.ledger[1].hash;
    expect(fails(deepCheck(doc, cyc).rows)).toEqual(["D3 signatures"]);
    // Far too many entries for a check to read.
    const huge = clone(SFC_LEDGER_FIXTURE);
    huge.ledger = Array.from({ length: P.bounds.maxLedgerEntries + 1 }, () => clone(huge.ledger[0]));
    expect(fails(deepCheck(doc, huge).rows)).toEqual(["D1 ledger-access"]);
    // Not an excerpt at all; a declaration without the extension; not a declaration.
    expect(fails(deepCheck(doc, 42).rows)).toEqual(["D1 ledger-access"]);
    expect(deepCheck(withoutSigned({ ...doc, extensions: {} }), SFC_LEDGER_FIXTURE).rows).toEqual([{ id: "S5a ledger-evidence-shape", status: "FAIL", detail: "the declaration carries no ledger-evidence extension this check reads" }]);
    expect(deepCheck(null, SFC_LEDGER_FIXTURE).rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Wiring: the subject in the running gateway
// ---------------------------------------------------------------------------

describe("the LiveSpec hooks in live mode", () => {
  const liveSpec = (over: Partial<LiveSpec>): LiveSpec => ({
    domain: "hook-test.example",
    target: SFC_LEDGER_FIXTURE.publication.target,
    targetType: "origin",
    live: () => sfcLedgerBridgeAdapter({ excerpt: SFC_LEDGER_FIXTURE, mode: "operator", provider: SFC_LEDGER_PROVIDER, methodologyUri: METHODOLOGY, ledgerAccessUri: ACCESS }),
    fixture: () => sfcLedgerBridgeAdapter({ excerpt: SFC_LEDGER_FIXTURE, mode: "operator", provider: SFC_LEDGER_PROVIDER, methodologyUri: METHODOLOGY, ledgerAccessUri: ACCESS }),
    labelLive: "adapter:sfc-ledger-bridge (live test)",
    labelFixture: "adapter:sfc-ledger-bridge (fixture test)",
    upstream: "test",
    attribution: "test",
    ...over,
  });
  const deps = { fetchImpl: (() => Promise.reject(new Error("no network"))) as unknown as typeof fetch, env: {}, now: () => new Date("2026-05-10T00:00:00Z") };

  it("a live build is signed with the spec's key", async () => {
    const reg = new LiveRegistry(deps);
    await reg.init([liveSpec({ signingJwk: SFC_LEDGER_TEST_PRIVATE_JWK })]);
    const m = reg.managed.get("hook-test.example")!;
    expect(m.mode).toBe("live");
    const o = await verifyEmbeddedSignature(m.subject.document, { trustedKeys: [SFC_LEDGER_TEST_PUBLIC_JWK] });
    expect(o.result.status).toBe("verified");
  });

  it("a live build its self-check refuses falls back to the fixture, with the error recorded", async () => {
    let calls = 0;
    const reg = new LiveRegistry(deps);
    await reg.init([liveSpec({ selfCheck: (s) => { calls += 1; if (s.source.includes("live test")) throw new Error("refused by self-check"); } })]);
    const m = reg.managed.get("hook-test.example")!;
    expect(m.mode).toBe("replay");
    expect(m.upstreamError).toContain("refused by self-check");
    expect(calls).toBe(2);
  });

  it("a fixture its self-check refuses stops the boot", async () => {
    const reg = new LiveRegistry({ ...deps, fetchImpl: null });
    await expect(reg.init([liveSpec({ selfCheck: () => { throw new Error("bad fixture"); } })])).rejects.toThrow("bad fixture");
  });
});

describe("sfc-ledger-demo.example in the gateway", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway({ baseUrl: "https://gw.example" });
  });
  afterAll(async () => {
    await srv.close();
  });
  const url = (p: string) => srv.base + p;

  it("serves the signed declaration, the excerpt at /input, and lists both on the index", async () => {
    const r = await fetch(url(`/${SFC_LEDGER_DEMO_DOMAIN}/.well-known/sustainability-data`));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/sustainability-data+json");
    expect(r.headers.get("etag")).not.toBeNull();
    expect(r.headers.get("last-modified")).toBe("Sat, 02 May 2026 00:10:00 GMT");
    const served = await r.text();
    const doc = JSON.parse(served) as SustainabilityMetrics;
    expect(typeof doc.signed).toBe("string");
    expect(served).not.toContain(SFC_LEDGER_TEST_PRIVATE_JWK.d);
    expect(JSON.parse(Buffer.from(doc.signed!.split(".")[0], "base64url").toString("utf8")).jwk.x).toBe(SFC_LEDGER_TEST_PUBLIC_JWK.x);
    expect(doc.provider).toMatch(/^SYNTHETIC EXAMPLE/);
    expect(doc.provider).toMatch(/EXPERIMENTAL/);
    // The pointer follows the configured https origin.
    expect(evidenceOf(doc)["ledger-access-uri"]).toBe(`https://gw.example/${SFC_LEDGER_DEMO_DOMAIN}/input`);
    const expectedHere = clone(EXPECTED);
    ((expectedHere.extensions as Record<string, Record<string, unknown>>)[LE])["ledger-access-uri"] = `https://gw.example/${SFC_LEDGER_DEMO_DOMAIN}/input`;
    expect(canonical(withoutSigned(doc))).toBe(canonical(expectedHere));

    const input = await fetch(url(`/${SFC_LEDGER_DEMO_DOMAIN}/input`));
    expect(input.status).toBe(200);
    const text = await input.text();
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(SFC_LEDGER_FIXTURE)));
    expect(createHash("sha256").update(text).digest("hex")).toBe("4472b215170c1a75e8705a5bb045d35e9fb3f547e2c1725f8d7f4adc2cad1317");

    const idx = await (await fetch(url("/index.json"))).json();
    const entry = idx["adapter-demonstrations"].entries.find((e: { domain: string }) => e.domain === SFC_LEDGER_DEMO_DOMAIN);
    expect(entry.input.path).toBe(`/${SFC_LEDGER_DEMO_DOMAIN}/input`);
    expect(entry.adapter).toContain("experimental");
    expect(entry.mode).toBe("replay");
    const html = await (await fetch(url("/"))).text();
    expect(html).toContain(`href="/${SFC_LEDGER_DEMO_DOMAIN}/input"`);
    expect(html).toContain("experimental");
    expect(isThirdPartyMapping(srv.gw.subjects.get(SFC_LEDGER_DEMO_DOMAIN)!)).toBe(false);
    expect(srv.gw.subjects.get(SFC_LEDGER_DEMO_DOMAIN)!.synthetic).toBe(true);
  });

  it("a non-https BASE_URL never reaches the document: the pointer falls back to the reference origin", async () => {
    const spec = demoSpecs({ config: { ...srv.gw.config, baseUrl: "http://127.0.0.1:1" }, crawlBytes: 1, wattsByMonth: {} }).find((s) => s.domain === SFC_LEDGER_DEMO_DOMAIN)!;
    const raw = await spec.fixture({ fetchImpl: null, env: {}, now: () => new Date(0) }).fetch({});
    expect((raw as { extensions: Record<string, Record<string, unknown>> }).extensions[LE]["ledger-access-uri"]).toBe(ACCESS);
  });

  it("the boot self-check refuses a tampered build", async () => {
    const spec = demoSpecs({ config: srv.gw.config, crawlBytes: 1, wattsByMonth: {} }).find((s) => s.domain === SFC_LEDGER_DEMO_DOMAIN)!;
    expect(spec.selfCheck).toBeDefined();
    await expect(spec.selfCheck!(srv.gw.subjects.get(SFC_LEDGER_DEMO_DOMAIN)!)).resolves.toBeUndefined();
    const tampered = await subjectFromAdapter({
      domain: SFC_LEDGER_DEMO_DOMAIN,
      adapter: sfcLedgerBridgeAdapter({ excerpt: withEvent(APRIL_ENERGY, (e) => { e.payload.kWhConsumed = 400; }), mode: "operator", provider: SFC_LEDGER_PROVIDER, methodologyUri: METHODOLOGY, ledgerAccessUri: ACCESS }),
      target: SFC_LEDGER_FIXTURE.publication.target,
      targetType: "origin",
      signing: { key },
    });
    await expect(spec.selfCheck!(tampered)).rejects.toThrow(/self-check failed[\s\S]*D4 chains/);
  });
});
