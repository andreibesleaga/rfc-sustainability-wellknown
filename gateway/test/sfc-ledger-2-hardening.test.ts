/**
 * The hardening of the gateway's SFC profile 2.0 checks against hostile input: a document or a read made to
 * crash, stall or mislead a verifier (spec section 10), and the signature, unit, host and retirement rules
 * that a hostile value could bend. Each test names the rule it holds.
 *
 * Deterministic: fixed instants, fixed keys (the RFC 8032 test key and one fixed P-256 key), a fake clock for
 * the time limit, no network, no wall clock.
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (sections 3.5, 5.5, 9.3, 9.4, 10)
 */
import { createPrivateKey, sign as nodeSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bridge2 } from "../src/adapters/sfc-ledger-2/bridge";
import { runChecks, runDeepChecks, runShallowChecks, recordRow, type RunInput } from "../src/adapters/sfc-ledger-2/check";
import { CheckLimit, startDeadline } from "../src/adapters/sfc-ledger-2/deadline";
import { stageRows } from "../src/adapters/sfc-ledger-2/deep";
import { Bridge2Error, readExcerptV2 } from "../src/adapters/sfc-ledger-2/excerpt";
import { MAX_READ_DEPTH, readIJson } from "../src/adapters/sfc-ledger-2/ijson";
import { replay } from "../src/adapters/sfc-ledger-2/ledger";
import { asciiLower, b64u, canonicalize, hashOf, sameHost, textHash, withoutSig, type Row } from "../src/adapters/sfc-ledger-2/primitives";
import { s3 } from "../src/adapters/sfc-ledger-2/signed";
import { deepCheck, shallowCheck } from "../src/adapters/sfc-ledger-bridge";
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../src/adapters/sfc-ledger-profile";
import { SFC_LEDGER_TEST_PRIVATE_JWK } from "../src/adapters/sfc-ledger-fixture";
import { signWithJwk } from "../src/adapters/sfc-ledger-2/ed25519";
import { NETWORK, PARAMETERS, PINS, REGISTRAR_X, REGISTRY, World, retirement, signObject } from "./sfc2-builder";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

const READ_AT = "2026-05-02T00:10:00Z";
const UPDATED = "2026-02-10T09:00:00Z";
const YEAR = { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" };
const MARCH = "2025-03-01T00:00:00Z";
const CN = PROFILE.extensions.carbonNeutrality;

const row = (rows: Row[], id: string): Row => {
  const found = rows.filter((r) => r.id === id);
  expect(found, `row ${id}`).toHaveLength(1);
  return found[0];
};
const text = (rows: Row[]): string => JSON.stringify(rows);

/** One operator with one energy and one carbon event in March 2025, the carbon one citing `retirements`. */
function marchWorld(retirements: Json[] = [retirement("REF-1", 1000, { at: "2025-04-02T00:00:00Z" })]): { w: World; op: string; carbonHash: string; energyHash: string } {
  const w = new World(READ_AT);
  const op = w.operator("a");
  const energyHash = w.energy(op, MARCH, { kWh: 1000 });
  const carbonHash = w.carbon(op, MARCH, { s2: 100, s3: 50, retirements });
  return { w, op, carbonHash, energyHash };
}

const deep = (excerpt: Json, extra: Partial<RunInput> = {}) => runDeepChecks({ excerpt, parameters: PARAMETERS, pins: PINS, T: READ_AT, ...extra });

// ---------------------------------------------------------------------------
// Reading text (section 10, Parsing): I-JSON, literals, depth
// ---------------------------------------------------------------------------

describe("the reader refuses what no binary64 value holds, and does not overflow", () => {
  it("a number out of binary64 range is a syntax error with the literal length attached, never Infinity", () => {
    for (const literal of ["1e999", "-1e999"]) {
      let err: Json;
      try {
        readIJson(`{"a": ${literal}}`);
      } catch (e) {
        err = e;
      }
      expect(err?.message, literal).toMatch(/^JSON syntax: number out of I-JSON range at \d+$/);
      expect(err.literalLength).toBe(literal.length);
    }
  });

  it("a declaration with such a number is an S2 FAIL, and one whose literal is over the limit is NOT-EVALUABLE, never FAIL", () => {
    const short = runChecks({ declarationText: '{"energy-consumption": 1e999}' });
    expect(row(short.rows, "S2")).toMatchObject({ result: "FAIL", detail: expect.stringContaining("number out of I-JSON range") });
    const long = runChecks({ declarationText: `{"energy-consumption": 1${"0".repeat(500)}}` });
    expect(row(long.rows, "S2")).toMatchObject({ result: "NOT-EVALUABLE", detail: "limit: characters in a number literal" });
  });

  it("a read with such a number is NOT-EVALUABLE in D1 for each object that points to ledger evidence", () => {
    const decl = { updated: UPDATED, target: "ledger.example", "target-type": "service", period: YEAR, extensions: { [PROFILE.extensions.ledgerEvidence2]: { "profile-version": "2.0" } } };
    const run = runChecks({ declarations: decl, excerptText: '{"excerpt-version": 2, "x": 1e999}', T: READ_AT });
    expect(row(run.rows, "D1").detail).toContain("read is not valid JSON: JSON syntax: number out of I-JSON range");
    expect(row(run.rows, "C-SFC-7").result).toBe("NOT-EVALUABLE");
  });

  it("nesting past the reader's bound stops the reading with a limit, at once and without a stack overflow", () => {
    const nested = "[".repeat(100_000) + "]".repeat(100_000);
    let err: Json;
    try {
      readIJson(nested);
    } catch (e) {
      err = e;
    }
    expect(err.limit).toBe("JSON nesting depth");
    expect(MAX_READ_DEPTH).toBeGreaterThan(PROFILE.limits.nesting);
    expect(row(runChecks({ declarationText: nested }).rows, "S2")).toMatchObject({ result: "NOT-EVALUABLE", detail: "limit: JSON nesting depth" });
  });
});

// ---------------------------------------------------------------------------
// runChecks never throws, and never echoes what a hostile document made it throw
// ---------------------------------------------------------------------------

describe("runChecks turns every failure into a row", () => {
  const evidence = { updated: UPDATED, target: "ledger.example", "target-type": "service", period: YEAR, extensions: { [PROFILE.extensions.ledgerEvidence2]: { "profile-version": "2.0" } } };

  it("text that is not JSON is an S2 FAIL (declaration) or D1 and C-SFC-7 NOT-EVALUABLE (read), not an exception", () => {
    expect(row(runChecks({ declarationText: "{not json" }).rows, "S2").result).toBe("FAIL");
    const run = runChecks({ declarations: evidence, excerptText: "{not json", T: READ_AT });
    expect(row(run.rows, "D1")).toMatchObject({ result: "NOT-EVALUABLE", detail: expect.stringContaining("read is not valid JSON") });
    expect(row(run.rows, "C-SFC-7").result).toBe("NOT-EVALUABLE");
  });

  it("a text over the byte limit is NOT-EVALUABLE and is not read", () => {
    const run = runChecks({ declarationText: "{}", limits: { declarationBytes: 1 } });
    expect(row(run.rows, "S2")).toMatchObject({ result: "NOT-EVALUABLE", detail: "limit: bytes per declaration" });
  });

  it("a malformed read of another version, with null or non-object members, is a D1 row, not a TypeError", () => {
    for (const excerpt of [
      { "excerpt-version": 1, ledger: [null], registry: "x", network: NETWORK, "read-at": READ_AT },
      { "excerpt-version": 1, ledger: "not a list", registry: [null], voids: [1], network: NETWORK, "read-at": READ_AT },
    ]) {
      const run = runChecks({ declarations: evidence, excerpt, T: READ_AT });
      expect(row(run.rows, "D1").result).toBe("NOT-EVALUABLE");
    }
  });

  it("a malformed read of version 2 names the first violation, for a null entry as for a non-array", () => {
    for (const bad of [{ ledger: [null] }, { ledger: ["x"] }, { registry: [null] }, { voids: [null] }, { checkpoint: [] }]) {
      const w = marchWorld().w;
      const run = runChecks({ declarations: evidence, excerpt: { ...w.excerpt(), ...bad }, T: READ_AT });
      expect(row(run.rows, "D1").detail, JSON.stringify(bad)).toContain("read is not a well-formed excerpt");
    }
  });

  it("a value that throws while the input is read is one NOT-EVALUABLE ERROR row with fixed words: the exception text never reaches the report", () => {
    const hostile = { ...evidence, get period(): never { throw new Error("SECRET-HOSTILE-TEXT"); } };
    const run = runChecks({ declarations: hostile as Json });
    expect(row(run.rows, "ERROR")).toMatchObject({ result: "NOT-EVALUABLE", detail: "input reading stopped" });
    expect(text(run.rows)).not.toContain("SECRET-HOSTILE-TEXT");
    expect(run.summary["NOT-EVALUABLE"]).toBeGreaterThan(0);
  });

  it("a stage that throws is one fixed ERROR row that names the stage, not the exception text, and rethrows the time limit", () => {
    expect(stageRows("D4", () => { throw new TypeError("SECRET-HOSTILE-TEXT is not iterable"); })).toEqual([{ id: "ERROR", result: "NOT-EVALUABLE", detail: "D4 stopped" }]);
    expect(() => stageRows("D4", () => { throw new CheckLimit("seconds per check"); })).toThrow(CheckLimit);
  });

  it("the bridge's shallow check answers an unexpected failure with a fixed ERROR row (NOT-EVALUABLE, ok false), not the exception text", async () => {
    const hostileKeys = new Proxy([], { get(): never { throw new Error("SECRET-HOSTILE-TEXT"); } });
    const report = await shallowCheck({ ...evidence, extensions: { [CN]: { "net-zero-status": "achieved" } } }, { trustedKeys: hostileKeys as Json });
    expect(report.rows.find((r) => r.id === "ERROR")).toMatchObject({ status: "NOT-EVALUABLE", detail: "shallow check stopped" });
    expect(report.ok).toBe(false);
    expect(JSON.stringify(report)).not.toContain("SECRET-HOSTILE-TEXT");
  });

  it("the bridge's deep check without a read reports D1 and C-SFC-7 NOT-EVALUABLE 'no ledger read given', no D0 or ERROR row", () => {
    const report = deepCheck({ ...evidence, extensions: { [PROFILE.extensions.ledgerEvidence2]: { "profile-version": "2.0" } } }, undefined, { T: READ_AT });
    expect(report.rows.map((r) => [r.id, r.status, r.detail])).toEqual([["D1", "NOT-EVALUABLE", "no ledger read given"], ["C-SFC-7", "NOT-EVALUABLE", "no ledger read given"]]);
    expect(report.ok).toBe(true);
  });

  it("a shallow-only run over an object with ledger evidence prints no deep row; the full run without a read prints D1 and C-SFC-7 'no ledger read given'", () => {
    const decl = { ...evidence, extensions: { [PROFILE.extensions.ledgerEvidence2]: { "profile-version": "2.0" } } };
    expect(runShallowChecks({ declarations: decl, T: READ_AT }).rows.some((r) => r.id === "D1" || r.id === "C-SFC-7")).toBe(false);
    const full = runChecks({ declarations: decl, T: READ_AT });
    expect(row(full.rows, "D1")).toMatchObject({ result: "NOT-EVALUABLE", detail: "no ledger read given" });
    expect(row(full.rows, "C-SFC-7")).toMatchObject({ result: "NOT-EVALUABLE", detail: "no ledger read given" });
  });
});

// ---------------------------------------------------------------------------
// The period guard and the time limit: a hostile declaration cannot make a check walk without end
// ---------------------------------------------------------------------------

describe("limits that protect the verifier", () => {
  it("a period of 8000 years with ledger evidence returns C-SFC-4 and C-SFC-7 NOT-EVALUABLE at once, with the spec's wording", () => {
    const w = marchWorld().w;
    const decl = { updated: UPDATED, target: "ledger.example", "target-type": "service", "carbon-accounting": "market-based", period: { start: "0001-01-01T00:00:00Z", end: "9999-01-01T00:00:00Z" }, extensions: { [PROFILE.extensions.ledgerEvidence2]: { "profile-version": "2.0", operators: [] } } };
    const run = runChecks({ declarations: decl, excerpt: w.excerpt(), parameters: PARAMETERS, pins: PINS, T: READ_AT });
    expect(row(run.rows, "C-SFC-4")).toMatchObject({ result: "NOT-EVALUABLE", detail: "period not one month or one calendar year" });
    expect(row(run.rows, "C-SFC-7").result).toBe("NOT-EVALUABLE");
    expect(row(run.rows, "C-SFC-7").detail).toContain("period not one month or one calendar year");
  });

  it("the time limit of one check turns a stage into NOT-EVALUABLE with the limit named; a fake clock decides, not the wall clock", () => {
    let now = 0;
    const clock = (): number => (now += 400_000); // 400 s per reading of the clock
    const { w } = marchWorld();
    const run = deep(w.excerpt(), { clock });
    expect(row(run.rows, "D1")).toMatchObject({ result: "NOT-EVALUABLE", detail: "limit: seconds per check" });
  });

  it("startDeadline throws CheckLimit only after the seconds have passed on the given clock", () => {
    let now = 1000;
    const check = startDeadline(10, () => now);
    now += 10_000;
    expect(check).not.toThrow();
    now += 1;
    expect(check).toThrow(CheckLimit);
    expect(check).toThrow("limit: seconds per check");
  });

  it("the bridge refuses a read whose checks run past the time limit, in fixed words, as E-LEDGER", () => {
    let now = 0;
    const { w } = marchWorld();
    const opts = { mode: "operator" as const, provider: "SYNTHETIC", methodologyUri: "https://ledger.example/m.md", ledgerAccessUri: "https://ledger.example/read", period: { start: MARCH, end: "2025-04-01T00:00:00Z" }, updated: "2025-04-10T00:00:00Z", target: "node.op-a.example", parameters: PARAMETERS, pins: PINS };
    expect(bridge2(readExcerptV2(w.excerpt()), opts).primary.target).toBe("node.op-a.example");
    let err: unknown;
    try {
      bridge2(readExcerptV2(w.excerpt()), { ...opts, clock: () => (now += 400_000) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Bridge2Error);
    expect((err as Bridge2Error).code).toBe("E-LEDGER");
    expect((err as Bridge2Error).message).toContain("limit: seconds per check");
  });
});

// ---------------------------------------------------------------------------
// Bridge configuration: the units
// ---------------------------------------------------------------------------

describe("the bridge refuses a unit it cannot compute with, at construction, naming the member", () => {
  const { w } = marchWorld();
  const read = readExcerptV2(w.excerpt());
  const base = { mode: "operator" as const, provider: "SYNTHETIC", methodologyUri: "https://ledger.example/m.md", ledgerAccessUri: "https://ledger.example/read", period: { start: MARCH, end: "2025-04-01T00:00:00Z" }, updated: "2025-04-10T00:00:00Z", target: "node.op-a.example", parameters: PARAMETERS, pins: PINS };
  const code = (o: Json): { code: string; message: string } => {
    try {
      bridge2(read, { ...base, ...o });
    } catch (e) {
      expect(e).toBeInstanceOf(Bridge2Error);
      return { code: (e as Bridge2Error).code, message: (e as Bridge2Error).message };
    }
    throw new Error("expected a refusal");
  };

  it("an energy unit that is not Wh, kWh, MWh or GWh is E-CONFIG naming energyUnit and the allowed names", () => {
    for (const unit of ["TWh", "constructor", "__proto__", "toString"]) {
      const r = code({ energyUnit: unit });
      expect(r.code, unit).toBe("E-CONFIG");
      expect(r.message).toContain("energyUnit must be one of Wh, kWh, MWh, GWh");
    }
  });

  it("a carbon unit that is not gCO2e, kgCO2e or tCO2e is E-CONFIG naming carbonUnit", () => {
    for (const unit of ["MtCO2e", "constructor", "hasOwnProperty"]) {
      const r = code({ carbonUnit: unit });
      expect(r.code, unit).toBe("E-CONFIG");
      expect(r.message).toContain("carbonUnit must be one of gCO2e, kgCO2e, tCO2e");
    }
  });

  it("the units of the tables are accepted", () => {
    expect(() => bridge2(read, { ...base, energyUnit: "MWh", carbonUnit: "tCO2e" })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Hosts: ASCII-only case folding (3.5)
// ---------------------------------------------------------------------------

describe("host comparison folds ASCII case only", () => {
  it("a Kelvin sign is not a k, and an upper-case ASCII letter is its lower-case", () => {
    expect(sameHost("Kledger.example", "kledger.example")).toBe(false);
    expect(sameHost("Kledger.example", "kledger.example")).toBe(true);
    expect(sameHost("LEDGER.example", "ledger.example")).toBe(true);
    expect(sameHost(undefined, "ledger.example")).toBe(false);
    expect(asciiLower("KELVIN")).toBe("Kelvin");
  });

  it("an event whose `network` is a look-alike of the read's network breaks L1; the same name in capitals does not", () => {
    const w = new World(READ_AT, "kledger.example");
    const op = w.operator("a");
    w.energy(op, MARCH, { kWh: 1000 });
    const excerpt = w.excerpt();
    const resign = (network: string): Json => {
      const entry = excerpt.ledger[0];
      const event = signObject({ ...withoutSig(entry.event), network });
      return { ...excerpt, ledger: [{ commit: entry.commit, hash: hashOf(event), event }] };
    };
    const verdict = (ex: Json): string[] => {
      const run = deep(ex, { pins: { ...PINS, registrar: { "kledger.example": [REGISTRAR_X] } } });
      return [...(replay(run.ctx!, READ_AT).verdicts.get(0)?.reasons ?? [])];
    };
    expect(verdict(resign("Kledger.example"))).toContain("L1");
    expect(verdict(resign("KLEDGER.example"))).not.toContain("L1");
  });
});

// ---------------------------------------------------------------------------
// Retirements: only a citation every rule can read is judged by L9 and L10
// ---------------------------------------------------------------------------

describe("a retirement that cannot be read is an L8 failure, never an exception", () => {
  const good = retirement("REF-1", 1000, { at: "2025-04-02T00:00:00Z" });
  const without = (member: string): Json => Object.fromEntries(Object.entries(good).filter(([k]) => k !== member));
  const cases: [string, Json][] = [
    ["kg is text", { ...good, kg: "x" }],
    ["kg is missing", without("kg")],
    ["tonnesRetired is missing", without("tonnesRetired")],
  ];

  /** The March read with the carbon event's citations replaced by `bad`, the event signed again (the builder cannot write a citation without kg). */
  function readWith(bad: Json): Json {
    const excerpt = marchWorld().w.excerpt();
    const ledger = excerpt.ledger.map((entry: Json) => {
      if (entry.event.type !== "CarbonAttested") return entry;
      const event = signObject({ ...withoutSig(entry.event), payload: { ...entry.event.payload, retirements: [bad], offsetsKgCO2e: 1000 } });
      return { commit: entry.commit, hash: hashOf(event), event };
    });
    return { ...excerpt, ledger };
  }
  const operatorOptions = { mode: "operator" as const, provider: "SYNTHETIC", methodologyUri: "https://ledger.example/m.md", ledgerAccessUri: "https://ledger.example/read", period: { start: MARCH, end: "2025-04-01T00:00:00Z" }, updated: "2025-04-10T00:00:00Z", target: "node.op-a.example", parameters: PARAMETERS, pins: PINS };

  for (const [name, bad] of cases) {
    it(`${name}: the deep check fails L8 on the event and goes on`, () => {
      const run = deep(readWith(bad));
      expect(run.rows.some((r) => r.id === "D5.event" && r.result === "FAIL" && String(r.detail).includes("L8"))).toBe(true);
      expect(run.rows.some((r) => r.id === "ERROR")).toBe(false);
    });

    it(`${name}: the bridge refuses with a Bridge2Error, not a TypeError`, () => {
      let err: unknown;
      try {
        bridge2(readExcerptV2(readWith(bad)), operatorOptions);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Bridge2Error);
    });
  }
});

describe("the single-use index keeps rule L9 fast on a large read", () => {
  it("480 effective carbon events, each with a citation, raise no D* FAIL row (correctness with many events; speed is not asserted here)", () => {
    const w = new World(READ_AT);
    for (let j = 0; j < 40; j++) {
      const op = w.operator(`n${j}`);
      for (let i = 1; i <= 12; i++) {
        const m = `2025-${String(i).padStart(2, "0")}-01T00:00:00Z`;
        w.energy(op, m, { kWh: 100 });
        w.carbon(op, m, { s2: 10, s3: 5, retirements: [retirement(`N${j}-${i}`, 1000, { at: i === 12 ? "2026-01-02T00:00:00Z" : `2025-${String(i + 1).padStart(2, "0")}-02T00:00:00Z` })] });
      }
    }
    const run = deep(w.excerpt());
    expect(run.rows.filter((r) => r.result === "FAIL" && /^D/.test(r.id))).toEqual([]);
  });

  it("a tonne cited twice over is still refused (L9), and by the index, as before", () => {
    const w = new World(READ_AT);
    const a = w.operator("a");
    const b = w.operator("b");
    const cite = retirement("SAME", 1000, { at: "2025-04-02T00:00:00Z" });
    w.energy(a, MARCH, { kWh: 1 });
    w.carbon(a, MARCH, { s2: 1, s3: 1, retirements: [cite] });
    w.energy(b, MARCH, { kWh: 1 });
    w.carbon(b, MARCH, { s2: 1, s3: 1, retirements: [cite] }, { commit: "2025-04-03T00:00:00Z" });
    const run = deep(w.excerpt());
    expect(run.rows.filter((r) => r.id === "D5.event" && r.result === "FAIL" && String(r.detail).includes("L9"))).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Void acts: verified under a pinned or listed key only
// ---------------------------------------------------------------------------

describe("a void act is verified under a pinned registrar key, never under the read's own copy", () => {
  function withVoid(): { excerpt: Json; carbonHash: string; month: string } {
    const { w, carbonHash } = marchWorld();
    const excerpt = w.excerpt();
    const aVoid = signObject({ commit: "2025-05-01T00:00:00Z", target: carbonHash });
    return { excerpt: { ...excerpt, voids: [aVoid] }, carbonHash, month: MARCH };
  }
  const effective = (run: ReturnType<typeof deep>): string[] => [...replay(run.ctx!, READ_AT).E.keys()];

  it("with no pinned or listed key the void is NOT-EVALUABLE 'registrar key not pinned' and ignored: the carbon event stays effective", () => {
    const { excerpt } = withVoid();
    const run = runDeepChecks({ excerpt, T: READ_AT });
    expect(row(run.rows, "D2.void")).toMatchObject({ result: "NOT-EVALUABLE", detail: "registrar key not pinned" });
    expect(effective(run).some((k) => k.includes("CarbonAttested"))).toBe(true);
  });

  it("signed by the excerpt's own registrar key and with no pin it still changes nothing (the copy is the same untrusted document)", () => {
    const { excerpt } = withVoid();
    expect(excerpt.registrar.jwk.x).toBe(REGISTRAR_X);
    const run = runDeepChecks({ excerpt, parameters: PARAMETERS, T: READ_AT }); // parameters given, methodology not pinned
    expect(row(run.rows, "D2.void").result).toBe("NOT-EVALUABLE");
    expect(effective(run).some((k) => k.includes("CarbonAttested"))).toBe(true);
  });

  it("under a pinned key the void passes and deletes the effective carbon event", () => {
    const { excerpt } = withVoid();
    const run = deep(excerpt);
    expect(row(run.rows, "D2.void").result).toBe("PASS");
    expect(effective(run).some((k) => k.includes("CarbonAttested"))).toBe(false);
  });

  it("a registrar pin that is a name of Object.prototype pins nothing", () => {
    const { excerpt } = withVoid();
    const run = runDeepChecks({ excerpt, T: READ_AT, pins: { registrar: Object.create({ [NETWORK]: [REGISTRAR_X] }) } });
    expect(row(run.rows, "D2.void").detail).toBe("registrar key not pinned");
  });
});

// ---------------------------------------------------------------------------
// Checkpoints: a verified checkpoint without ledger-digest does not authenticate commit instants (D4)
// ---------------------------------------------------------------------------

describe("a verified checkpoint without ledger-digest says so", () => {
  function checkpointed(extra: Json = {}): Json {
    const { w, op, energyHash, carbonHash } = marchWorld();
    const excerpt = w.excerpt();
    const checkpoint = signObject({
      network: NETWORK, "read-at": READ_AT,
      chains: [{ operator: op, type: "EnergyAttested", tip: energyHash, count: 1 }, { operator: op, type: "CarbonAttested", tip: carbonHash, count: 1 }],
      ...extra,
    });
    return { ...excerpt, checkpoint };
  }
  const infos = (run: ReturnType<typeof deep>): string[] => run.rows.filter((r) => r.id === "D4.info").map((r) => String(r.detail));

  it("without ledger-digest: D4.checkpoint verified plus INFO 'commit instants not authenticated: no ledger-digest'", () => {
    const run = deep(checkpointed());
    expect(row(run.rows, "D4.checkpoint")).toMatchObject({ result: "PASS", detail: "verified" });
    expect(infos(run)).toContain("commit instants not authenticated: no ledger-digest");
  });

  it("with the right ledger-digest the INFO is not printed", () => {
    const ex = checkpointed();
    const withDigest = { ...ex, checkpoint: signObject({ ...withoutSig(ex.checkpoint), "ledger-digest": textHash(canonicalize(ex.ledger)) }) };
    const run = deep(withDigest);
    expect(row(run.rows, "D4.checkpoint").detail).toBe("verified");
    expect(infos(run)).not.toContain("commit instants not authenticated: no ledger-digest");
  });
});

// ---------------------------------------------------------------------------
// S3: ES256 under a pinned P-256 key, Ed25519 under an Ed25519 pin, strict UTF-8
// ---------------------------------------------------------------------------

/** A fixed P-256 key pair (generated once; the private half is public, for tests only). */
const P256_PRIVATE = { kty: "EC", crv: "P-256", x: "ccjMzgBUdZ7d3JXVlQg8vmp9ZeH3Hi_VNtGGInCDnMk", y: "SLtoAZ5MOdhzgJWqXJGpj4h1jRBXG-GxRUeBW1ATlJA", d: "T_MP23ZC0nKTgNxRqZp9q6Un10eXs6ZnocYQ5YwWVEo" };
const P256_PUBLIC = { kty: "EC", crv: "P-256", x: P256_PRIVATE.x, y: P256_PRIVATE.y };
const OTHER_P256_PUBLIC = { kty: "EC", crv: "P-256", x: "9sUc0q-bKZ3WOMwBqXzogTYGzirT7siJVn7Eas0feHI", y: "kaUeYgxo9p-GzAQnJ320sxDhL4fVHWw07s_krxgfwwY" };
const ED_PUBLIC = { kty: "OKP", crv: "Ed25519", x: SFC_LEDGER_TEST_PRIVATE_JWK.x };

const NETWORK_OBJECT = { updated: UPDATED, target: "ledger.example", "target-type": "service", period: YEAR, extensions: { [CN]: { "net-zero-status": "achieved" } } };
const header = (alg: string): Json => ({ alg, cty: "sustainability-data+json" });
const part = (v: Json): string => b64u(Buffer.from(JSON.stringify(v), "utf8"));

/** A compact JWS over `payload` with the given algorithm; the header and payload bytes can be replaced to make them malformed. */
function jws(alg: "ES256" | "Ed25519", payload: Json, o: { headerBytes?: Buffer; payloadBytes?: Buffer } = {}): string {
  const h = o.headerBytes ? b64u(o.headerBytes) : part(header(alg));
  const p = o.payloadBytes ? b64u(o.payloadBytes) : part(payload);
  const input = Buffer.from(`${h}.${p}`, "ascii");
  const sig = alg === "ES256" ? nodeSign("sha256", input, { key: createPrivateKey({ key: P256_PRIVATE, format: "jwk" }), dsaEncoding: "ieee-p1363" }) : signWithJwk(SFC_LEDGER_TEST_PRIVATE_JWK, input);
  return `${h}.${p}.${b64u(sig)}`;
}
const withSigned = (signed: string, extra: Json = {}): Json => ({ ...NETWORK_OBJECT, ...extra, signed });
const verdict = (obj: Json, pins: Json): Row => s3(obj, "network", true, pins, null)[0];

describe("S3 verifies ES256 under a pinned P-256 key", () => {
  it("a good ES256 signature under the pinned key is PASS", () => {
    expect(verdict(withSigned(jws("ES256", NETWORK_OBJECT)), { publisherKeys: [P256_PUBLIC] })).toMatchObject({ result: "PASS", detail: "verified under a pinned key" });
  });

  it("a tampered served object, or a signature under another pinned key, is FAIL", () => {
    const good = jws("ES256", NETWORK_OBJECT);
    expect(verdict(withSigned(good, { "carbon-footprint": 1 }), { publisherKeys: [P256_PUBLIC] }).result).toBe("FAIL");
    expect(verdict(withSigned(good), { publisherKeys: [OTHER_P256_PUBLIC] })).toMatchObject({ result: "FAIL", detail: "signature rejected" });
  });

  it("with no pinned key it is INFO 'not pinned', never PASS or FAIL", () => {
    expect(verdict(withSigned(jws("ES256", NETWORK_OBJECT)), {})).toMatchObject({ result: "INFO", detail: "signed, not verified against a pinned key" });
  });

  it("an Ed25519 signature is not rejected for a pinned P-256 key: that key is no candidate, so the result is INFO, not FAIL", () => {
    const edSigned = withSigned(jws("Ed25519", NETWORK_OBJECT));
    expect(verdict(edSigned, { publisherKeys: [P256_PUBLIC] })).toMatchObject({ result: "INFO", detail: "signed, not verified against a pinned key" });
    expect(verdict(edSigned, { publisherKeys: [P256_PUBLIC, ED_PUBLIC] }).result).toBe("PASS");
    expect(verdict(edSigned, { publisherKeys: [{ x: SFC_LEDGER_TEST_PRIVATE_JWK.x }] }).result).toBe("PASS");
  });

  it("an ES256 signature is not tried under an Ed25519 pin, and an operator declaration must still use Ed25519", () => {
    expect(verdict(withSigned(jws("ES256", NETWORK_OBJECT)), { publisherKeys: [ED_PUBLIC] }).result).toBe("INFO");
    const operator = s3(withSigned(jws("ES256", NETWORK_OBJECT), { "target-type": "origin" }), "operator", true, { operatorKeys: [P256_PUBLIC] }, null)[0];
    expect(operator).toMatchObject({ result: "FAIL", detail: expect.stringContaining("operator declaration must use Ed25519") });
  });
});

describe("S3 reads the signed header and payload as UTF-8, strictly", () => {
  const withBytes = (o: { headerBytes?: Buffer; payloadBytes?: Buffer }): Row => verdict(withSigned(jws("Ed25519", NETWORK_OBJECT, o)), { publisherKeys: [ED_PUBLIC] });

  it("a payload with the invalid byte 0xFF is 'malformed payload', not a payload equal to one that holds U+FFFD", () => {
    const lenient = Buffer.from(JSON.stringify({ ...NETWORK_OBJECT, provider: "x�" }), "utf8");
    const invalid = Buffer.concat([Buffer.from(JSON.stringify({ ...NETWORK_OBJECT, provider: "x" }).replace('"x"', '"x'), "utf8"), Buffer.from([0xff]), Buffer.from('"}', "utf8")]);
    expect(lenient.includes(0xff)).toBe(false);
    expect(withBytes({ payloadBytes: invalid })).toMatchObject({ result: "FAIL", detail: "malformed payload" });
    // served object holding a literal U+FFFD does not match the invalid bytes
    expect(verdict(withSigned(jws("Ed25519", NETWORK_OBJECT, { payloadBytes: invalid }), { provider: "x�" }), { publisherKeys: [ED_PUBLIC] }).detail).toBe("malformed payload");
  });

  it("a header with the invalid byte 0xFF is 'malformed header'", () => {
    const headerBytes = Buffer.concat([Buffer.from('{"alg":"Ed25519","cty":"sustainability-data+json","x":"', "utf8"), Buffer.from([0xff]), Buffer.from('"}', "utf8")]);
    expect(withBytes({ headerBytes })).toMatchObject({ result: "FAIL", detail: "malformed header" });
  });

  it("a repeated header parameter name is 'malformed header' (RFC 7515 section 4)", () => {
    const headerBytes = Buffer.from('{"alg":"Ed25519","alg":"Ed25519","cty":"sustainability-data+json"}', "utf8");
    expect(withBytes({ headerBytes })).toMatchObject({ result: "FAIL", detail: "malformed header" });
  });

  it("a payload nested past the reader's bound is NOT-EVALUABLE with the limit named", () => {
    const payloadBytes = Buffer.from("[".repeat(MAX_READ_DEPTH + 5) + "]".repeat(MAX_READ_DEPTH + 5), "utf8");
    expect(withBytes({ payloadBytes })).toMatchObject({ result: "NOT-EVALUABLE", detail: "limit: JSON nesting depth" });
  });
});

// ---------------------------------------------------------------------------
// S7: whole seconds, no floating-point noise
// ---------------------------------------------------------------------------

describe("the S7 record prints the age of `updated` in whole seconds", () => {
  it("reads 'age of updated at T <n> s' with an integer n", () => {
    const r = recordRow([{ updated: "2026-02-10T09:00:00Z", target: "ledger.example" }], [], "2026-04-30T12:10:00Z", undefined);
    expect(r.detail).toContain("age of updated at T 6837000 s");
    expect(r.detail).not.toMatch(/\d\.\d+ /);
  });
});

// ---------------------------------------------------------------------------
// A member of the wrong JSON type is read as absent (8.1): reported, never a stopped stage
// ---------------------------------------------------------------------------

describe("a mistyped member of a served declaration is reported, and no stage stops", () => {
  const evidenceObject = (extra: Json): Json => {
    const { w } = marchWorld();
    const declared = bridge2(readExcerptV2(w.excerpt()), { mode: "operator", provider: "SYNTHETIC", methodologyUri: "https://ledger.example/m.md", ledgerAccessUri: "https://ledger.example/read", period: { start: MARCH, end: "2025-04-01T00:00:00Z" }, updated: "2025-04-10T00:00:00Z", target: "node.op-a.example", parameters: PARAMETERS, pins: PINS }).primary;
    return { excerpt: w.excerpt(), decl: { ...declared, ...extra } };
  };

  it("a string energy-consumption on a claiming object: C-SFC-5 FAIL with the S2 token, the S6 rows present, no ERROR row", () => {
    const { decl } = evidenceObject({ "energy-consumption": "12" });
    const run = runChecks({ declarations: decl, T: READ_AT });
    expect(row(run.rows, "C-SFC-5").result).toBe("FAIL");
    expect(String(row(run.rows, "C-SFC-5").detail).split("; ")).toContain("S2");
    expect(run.rows.some((r) => r.id === "S6.a")).toBe(true);
    expect(run.rows.some((r) => r.id === "ERROR")).toBe(false);
  });

  it("a number energy-unit is read as absent: S6.a FAIL names it missing", () => {
    const { decl } = evidenceObject({ "energy-unit": 5 });
    const run = runChecks({ declarations: { ...decl, "target-type": "service", extensions: { ...decl.extensions, [PROFILE.extensions.networkTopology]: { "consensus-mechanism": "proof-of-authority" } } }, T: READ_AT });
    expect(String(row(run.rows, "S6.a").detail)).toContain("missing:energy-unit");
    expect(run.rows.some((r) => r.id === "ERROR")).toBe(false);
  });

  it("a string carbon intensity on an evidence object checked against a read: the deep rows are present, no ERROR row", () => {
    const { excerpt, decl } = evidenceObject({ "carbon-intensity-gCO2e-per-kWh": "17.9" });
    const run = runChecks({ declarations: decl, excerpt, parameters: PARAMETERS, pins: PINS, T: READ_AT });
    expect(run.rows.some((r) => r.id === "D3")).toBe(true);
    // the mistyped member is read as absent by the figure checks (8.1): S2 and C-SFC-5 report it, C-SFC-7 compares the rest
    expect(String(row(run.rows, "C-SFC-5").detail).split("; ")).toContain("S2");
    expect(["PASS", "FAIL", "NOT-EVALUABLE"]).toContain(row(run.rows, "C-SFC-7").result);
    expect(run.rows.some((r) => r.id === "ERROR")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A hostile read never collapses the check into one ERROR row: the Registry and the checkpoint
// ---------------------------------------------------------------------------

describe("a Registry entry whose instants do not parse is reported on the entry; the other rows stay", () => {
  const goodRows = (rows: Row[]): void => {
    expect(rows.filter((r) => r.scope?.startsWith("did:web:op-a.example") && r.result === "PASS").map((r) => r.id)).toEqual(expect.arrayContaining(["D2.entry", "D3", "D4.chain", "D5"]));
    expect(rows.some((r) => r.id === "ERROR")).toBe(false);
  };
  const oneX = (active: Json[]): Json => ({ operator: "did:web:op-x.example", origin: "node.op-x.example", active, keys: [{ "public-jwk": { kty: "OKP", crv: "Ed25519", x: REGISTRAR_X }, "valid-from-commit": "2024-01-01T00:00:00Z", "valid-to-commit": null }] });
  const entry2x = (edit: Json): Json => ({ operator: "did:web:op-z.example", origin: "node.op-z.example", network: NETWORK, active: [{ from: "2024-12-01T00:00:00Z", to: null }], keys: [{ jwk: { kty: "OKP", crv: "Ed25519", x: REGISTRAR_X }, validFromCommit: "2024-01-01T00:00:00Z", validToCommit: null }], version: 1, ...edit });

  it("an unsigned 1.x entry with a date that is not a day, or a from that is not a date, is 'not authenticated', not a stopped read", () => {
    for (const active of [[{ from: "2025-01-01", to: "2025-02-30" }], [{ from: "garbage", to: null }]]) {
      const excerpt = marchWorld().w.excerpt();
      excerpt.registry.push(oneX(active));
      const run = deep(excerpt);
      expect(run.rows.find((r) => r.id === "D2.entry" && r.scope === "did:web:op-x.example")).toMatchObject({ result: "NOT-EVALUABLE", detail: "unsigned Registry entry not authenticated" });
      goodRows(run.rows);
    }
  });

  it("a signed 2.0 entry with a key or interval that does not parse, or a null item, is D2.entry FAIL 'shape'; its event FAILs L5", () => {
    const edits: Json[] = [
      { keys: [{ jwk: { kty: "OKP", crv: "Ed25519", x: REGISTRAR_X }, validFromCommit: "soon", validToCommit: null }] },
      { active: [{ from: "2024-13-01T00:00:00Z", to: null }] },
      { active: [null, { from: "2024-12-01T00:00:00Z", to: null }] },
      { keys: [null, { jwk: { kty: "OKP", crv: "Ed25519", x: REGISTRAR_X }, validFromCommit: "2024-01-01T00:00:00Z", validToCommit: null }] },
    ];
    for (const edit of edits) {
      const { w } = marchWorld();
      const z = w.operator("z");
      w.energy(z, MARCH, { kWh: 10 });
      const excerpt = w.excerpt({ mutateRegistry: (entries) => entries.map((e: Json) => (e.operator === z ? entry2x(edit) : e)) });
      const run = deep(excerpt);
      expect(String(run.rows.find((r) => r.id === "D2.entry" && r.scope === z)?.detail), JSON.stringify(edit)).toContain("shape");
      expect(run.rows.find((r) => r.id === "D2.entry" && r.scope === z)?.result).toBe("FAIL");
      goodRows(run.rows);
    }
    const { w } = marchWorld();
    const z = w.operator("z");
    w.energy(z, MARCH, { kWh: 10 });
    const noKey = deep(w.excerpt({ mutateRegistry: (entries) => entries.map((e: Json) => (e.operator === z ? entry2x(edits[0]) : e)) }));
    expect(noKey.rows.some((r) => r.id === "D3.event" && r.scope?.startsWith(z) && r.result === "FAIL" && String(r.detail).includes("L5"))).toBe(true);
  });
});

describe("a checkpoint with members of the wrong type FAILs on its own row and hides no other FAIL", () => {
  /** Two operators, one event altered after signing (D3 FAIL), and a registrar-signed checkpoint edited by `edit`. */
  function readWith(edit: (cp: Json) => Json): Json {
    const w = new World(READ_AT);
    const [a, b] = ["a", "b"].map((n) => w.operator(n));
    const altered = w.energy(a, MARCH, { kWh: 1000 });
    w.energy(b, MARCH, { kWh: 1100 });
    const excerpt = w.excerpt();
    const entry = excerpt.ledger.find((l: Json) => l.hash === altered);
    entry.event.payload.kWhConsumed = 99999;
    entry.hash = hashOf(entry.event);
    const chains = [a, b].map((op) => {
      const chain = excerpt.ledger.filter((l: Json) => l.event.subject === op);
      return { operator: op, type: "EnergyAttested", tip: chain[chain.length - 1].hash, count: chain.length };
    });
    return { ...excerpt, checkpoint: signObject(edit({ network: NETWORK, "read-at": READ_AT, chains })) };
  }
  const results = (rows: Row[], id: string): string[] => rows.filter((r) => r.id === id).map((r) => r.result);
  const MUTATIONS: [string, (cp: Json) => Json][] = [
    ["chains is a number", (cp) => ({ ...cp, chains: 5 })],
    ["chains is an empty object", (cp) => ({ ...cp, chains: {} })],
    ["chains is true", (cp) => ({ ...cp, chains: true })],
    ["chains holds null", (cp) => ({ ...cp, chains: [null] })],
    ["a chain has no count", (cp) => ({ ...cp, chains: [{ operator: "x", type: "EnergyAttested", tip: null }] })],
    ["read-at is null", (cp) => ({ ...cp, "read-at": null })],
    ["read-at is not an instant", (cp) => ({ ...cp, "read-at": "yesterday" })],
    ["a digest is a number", (cp) => ({ ...cp, "registry-digest": 7 })],
  ];

  it("keeps the baseline FAIL of the altered event with the checkpoint intact", () => {
    const run = deep(readWith((cp) => cp));
    expect(results(run.rows, "D3.event")).toContain("FAIL");
    expect(results(run.rows, "D4.checkpoint")).toEqual(["PASS"]);
  });

  for (const [name, edit] of MUTATIONS) {
    it(`${name}: D4.checkpoint FAIL 'mismatch: shape', the D3 FAIL survives, no ERROR row, C-SFC-7 FAIL`, () => {
      const run = runChecks({ declarations: { updated: UPDATED, target: NETWORK, "target-type": "service", period: YEAR, extensions: { [PROFILE.extensions.ledgerEvidence2]: { "profile-version": "2.0", operators: [] } } }, excerpt: readWith(edit), parameters: PARAMETERS, pins: PINS, T: READ_AT });
      expect(run.rows.filter((r) => r.id === "D4.checkpoint")).toEqual([{ id: "D4.checkpoint", result: "FAIL", detail: "mismatch: shape", scope: "checkpoint" }]);
      expect(results(run.rows, "D3.event")).toContain("FAIL");
      expect(results(run.rows, "ERROR")).toEqual([]);
      expect(row(run.rows, "C-SFC-7").result).toBe("FAIL");
    });
  }
});

describe("a public assessment whose unit is a name of Object.prototype is malformed, not a stopped stage", () => {
  for (const unit of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
    it(`unit ${unit}: C-SFC-6 NOT-EVALUABLE 'test 2: missing or malformed: unit', no ERROR row`, () => {
      const { w } = marchWorld();
      const platform = { "hot-path": "x", access: "public", mechanism: "proof-of-stake", assessment: { period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" }, figure: 500, unit } };
      const run = deep(w.excerpt(), { parameters: { ...PARAMETERS, platform } });
      expect(row(run.rows, "C-SFC-6")).toMatchObject({ result: "NOT-EVALUABLE", detail: "test 2: missing or malformed: unit" });
      expect(run.rows.some((r) => r.id === "ERROR")).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// 1.x events: a missing 1.2 figure member is L8, never arithmetic on undefined
// ---------------------------------------------------------------------------

describe("a 1.x event without a 1.2 figure member is skipped under L8 (12.1), and the bridge refuses the read as E-LEDGER", () => {
  const VECTORS = resolve(__dirname, "..", "..", "sfc-compliance", "vectors", "inputs", "v15-profile-1x.json");
  const vector = JSON.parse(readFileSync(VECTORS, "utf8"));
  const scenario = vector.scenarios.find((s: Json) => s.name === "without-scope2-basis-1x");
  const OP = "did:web:op-x1.example";
  const DEC = "2025-12-01T00:00:00Z";

  /** The x1 read with one December 1.x event of op-x1 re-signed by `edit` (the vectors' events are signed with the RFC 8032 test key). */
  function readWith(type: string, edit: (payload: Json) => void): Json {
    const excerpt = structuredClone(vector.excerpts[scenario.excerptRef]);
    const entry = excerpt.ledger.find((l: Json) => l.event.subject === OP && l.event.type === type && l.event.payload.period.from === "2025-12-01");
    edit(entry.event.payload);
    entry.event = signObject(withoutSig(entry.event));
    entry.hash = hashOf(entry.event);
    return excerpt;
  }
  const cases: [string, string, (p: Json) => void][] = [
    ["energy without kWhConsumed", "EnergyAttested", (p) => { delete p.kWhConsumed; }],
    ["energy without nodeCount", "EnergyAttested", (p) => { delete p.nodeCount; }],
    ["carbon without offsetsKgCO2e", "CarbonAttested", (p) => { delete p.offsetsKgCO2e; p.netZero = false; }],
  ];
  const input = (excerpt: Json): RunInput => ({ excerpt, parameters: scenario.parameters, pins: scenario.pins, T: scenario.T });

  for (const [name, type, edit] of cases) {
    it(`${name}: D5.event FAIL L8, no ERROR row, no NaN in the derived node count`, () => {
      const run = runDeepChecks(input(readWith(type, edit)));
      expect(run.rows.some((r) => r.id === "D5.event" && r.scope?.startsWith(`${OP} `) && r.result === "FAIL" && String(r.detail).includes("L8"))).toBe(true);
      expect(run.rows.some((r) => r.id === "ERROR")).toBe(false);
      expect(JSON.stringify(run.rows)).not.toContain("NaN");
    });

    it(`${name}: the bridge refuses with a Bridge2Error E-LEDGER, not a bare Error`, () => {
      let err: unknown;
      try {
        bridge2(readExcerptV2(readWith(type, edit)), { mode: "operator", provider: "SYNTHETIC", methodologyUri: "https://ledger.example/m.md", ledgerAccessUri: "https://ledger.example/read", period: { start: DEC, end: "2026-01-01T00:00:00Z" }, updated: scenario.T, target: "node.op-x1.example", disclosureUri: "https://ledger.example/d.json", parameters: scenario.parameters, pins: scenario.pins });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Bridge2Error);
      expect((err as Bridge2Error).code).toBe("E-LEDGER");
    });
  }
});

// ---------------------------------------------------------------------------
// The time limit is tested per key: an entry with many keys cannot outrun it inside one event
// ---------------------------------------------------------------------------

describe("a Registry entry with many keys is bounded by the time limit", () => {
  /** The RFC 8032 test 2 public key: a valid Ed25519 key that signed nothing here. */
  const WRONG_X = Buffer.from("3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c", "hex").toString("base64url");
  const keyOf = (x: string): Json => ({ jwk: { kty: "OKP", crv: "Ed25519", x }, validFromCommit: "2024-01-01T00:00:00Z", validToCommit: null });

  /** One operator whose entry lists `count` keys; the key that signed its event comes last, so the event tries all the others first. */
  function manyKeysRead(count: number): Json {
    const w = new World(READ_AT);
    const op = w.operator("a");
    w.energy(op, MARCH, { kWh: 1000 });
    return w.excerpt({ mutateRegistry: (entries) => entries.map((e: Json) => ({ ...e, keys: [...Array.from({ length: count - 1 }, () => keyOf(WRONG_X)), keyOf(REGISTRAR_X)] })) });
  }
  const readingsFor = (count: number): number => {
    let readings = 0;
    runChecks({ excerpt: manyKeysRead(count), parameters: PARAMETERS, pins: PINS, T: READ_AT, clock: () => { readings++; return 0; } });
    return readings;
  };

  it("reads the clock at least once per extra key, so one event cannot outrun the limit", () => {
    expect(readingsFor(105) - readingsFor(5)).toBeGreaterThanOrEqual(2 * 100);
  });

  it("stops with the limit named once the time is used up, not after every key", () => {
    let calls = 0;
    const run = runChecks({ excerpt: manyKeysRead(400), parameters: PARAMETERS, pins: PINS, T: READ_AT, clock: () => 1000 * calls++, limits: { secondsPerCheck: 50 } });
    expect(calls).toBeLessThan(200);
    expect(run.rows.some((r) => r.result === "NOT-EVALUABLE" && String(r.detail).includes("seconds per check"))).toBe(true);
  });
});

void REGISTRY;
