/**
 * The building blocks of the checker: exact decimals, instants and the window, the tolerance rule,
 * strict Ed25519, the parameters reader, and a seeded mutation run that must never crash the checker.
 * Deterministic: no network, no clock, a fixed seed.
 */
import { describe, expect, it } from "vitest";
import { parseDec, roundHalfEven, divRound, toText, add, cmp, q, qDiv, qText, fromNumber, dec } from "../lib/decimal.mjs";
import { windowOf, dueOf, addCalendarMonths, parseInstant, cmpInstant, isMonthBound } from "../lib/time.mjs";
import { figureOk, isDid, isHost } from "../lib/forms.mjs";
import { tolerancePass } from "../lib/coherence.mjs";
import { verifyEd25519 } from "../lib/ed25519.mjs";
import { canonicalize, unb64u } from "../lib/canonical.mjs";
import { readIJson } from "../lib/ijson.mjs";
import { parametersFromText, excerptProblem } from "../lib/input.mjs";
import { runChecks } from "../lib/check.mjs";
import { vectorFiles, inputOf } from "./helpers.mjs";

describe("exact decimals", () => {
  it("add and compare without binary floating point", () => {
    expect(toText(add(parseDec("0.1"), parseDec("0.2")))).toBe("0.3");
    expect(cmp(add(parseDec("0.1"), parseDec("0.2")), parseDec("0.3"))).toBe(0);
    expect(toText(fromNumber(1e21))).toBe("1000000000000000000000");
  });

  it("round half to even at the seventh decimal, in both directions and for negatives", () => {
    const round = (v, places = 6) => toText(roundHalfEven(parseDec(v), places));
    expect(round("1.2345675")).toBe("1.234568");
    expect(round("1.2345665")).toBe("1.234566");
    expect(round("-1.2345675")).toBe("-1.234568");
    expect(round("2.5", 0)).toBe("2");
    expect(round("3.5", 0)).toBe("4");
  });

  it("divide as the intensity does: scope 2 in kg times 1 000 over kWh, rounded half to even to 6 decimals", () => {
    expect(toText(divRound(dec(1), dec(3), 6))).toBe("0.333333");
    expect(toText(divRound(dec(2), dec(3), 6))).toBe("0.666667");
  });

  it("keep rationals exact for the quotient form", () => {
    expect(qText(qDiv(q(1n), q(8n)))).toBe("0.125");
    expect(qText(qDiv(q(1n), q(3n)))).toBe("1/3");
  });
});

describe("instants and the window", () => {
  it("compare as the moments they denote, offsets and fractions included", () => {
    expect(cmpInstant("2026-01-01T02:00:00+02:00", "2026-01-01T00:00:00Z")).toBe(0);
    expect(cmpInstant("2026-01-01T00:00:00.5Z", "2026-01-01T00:00:00Z")).toBe(1);
    expect(parseInstant("2026-01-01T00:00:60Z")).toBeNull();
    expect(parseInstant("2026-01-01t00:00:00z")).toBeNull();
  });

  it("recognise month bounds only as the first instant of a month in Z", () => {
    expect(isMonthBound("2026-02-01T00:00:00Z")).toBe(true);
    for (const t of ["2026-02-01T00:00:00+00:00", "2026-02-02T00:00:00Z", "2026-02-01T00:00:00.0Z", "2026-02-01"]) expect(isMonthBound(t)).toBe(false);
  });

  it("add the grace period of five days to the end of the month", () => {
    expect(dueOf("2026-01-01T00:00:00Z")).toBe("2026-02-06T00:00:00Z");
  });

  it("take the twelve months that ended at least five days before T", () => {
    const window = windowOf("2026-05-02T00:10:00Z");
    expect([window[0], window[11]]).toEqual(["2025-04-01T00:00:00Z", "2026-03-01T00:00:00Z"]);
    expect(windowOf("2026-05-06T00:00:00Z").pop()).toBe("2026-04-01T00:00:00Z"); // April is due at 2026-05-06T00:00:00Z
    expect(windowOf("2026-05-05T23:59:59Z").pop()).toBe("2026-03-01T00:00:00Z");
  });

  it("add calendar months with the day clamped to the end of the month", () => {
    expect(addCalendarMonths("2025-08-31T00:00:00Z", 6)).toBe("2026-02-28T00:00:00Z");
  });
});

describe("value forms and figures", () => {
  it("limit a figure to a plain decimal of at most 15 digits and 6 decimals, not negative", () => {
    for (const ok of [0, 12.5, 999999999.999999, 999999999999999]) expect(figureOk(ok)).toBe(true);
    for (const bad of [-1, 1e21, 1000000000.000001, 0.1234567, Number.NaN, "1"]) expect(figureOk(bad)).toBe(false);
  });

  it("accept DID and host forms and reject others", () => {
    expect(isDid("did:web:op-a.example")).toBe(true);
    expect(isDid("web:op-a.example")).toBe(false);
    expect(isHost("node.op-a.example")).toBe(true);
    expect(isHost("https://node.op-a.example")).toBe(false);
  });

  it("read canonical base64url only", () => {
    expect(unb64u("AQID")).toEqual(Buffer.from([1, 2, 3]));
    expect(unb64u("AQI")).toEqual(Buffer.from([1, 2]));
    expect(unb64u("AQJ")).toBeNull(); // non-zero trailing bits
    expect(unb64u("AQID=")).toBeNull();
  });

  it("canonicalise as RFC 8785: member order by UTF-16 code units, no insignificant whitespace", () => {
    expect(canonicalize({ b: 2, a: [true, null, "x"], "é": 1 })).toBe('{"a":[true,null,"x"],"b":2,"é":1}');
  });
});

describe("the tolerance rule (3.3 rule 4)", () => {
  // |P - sum Ti| <= 1/2 10^-k(P) + sum 1/2 10^-k(Ti), in the unit of P
  const terms = [{ x: 4.5, k: 1, shift: 0 }, { x: 5.5, k: 1, shift: 0 }];
  it("passes a footprint within the sum of the half units and fails one outside", () => {
    expect(tolerancePass(10.1, 1, 0, terms).ok).toBe(true);   // difference 0.1, tolerance 0.15
    expect(tolerancePass(10.4, 1, 0, terms).ok).toBe(false);  // difference 0.4, tolerance 0.15
  });

  it("converts every term to the unit of P first", () => {
    expect(tolerancePass(0.01, 2, 3, [{ x: 10000, k: 0, shift: 0 }]).ok).toBe(false); // 10 000 kg is 10 t, not 0.01 t
    expect(tolerancePass(10, 0, 3, [{ x: 10000, k: 0, shift: 0 }]).ok).toBe(true);
  });
});

describe("Ed25519 as section 10 requires", () => {
  const hex = (h) => Buffer.from(h, "hex");
  // RFC 8032 section 7.1 test 1: empty message
  const pub = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
  const sig = hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b");
  it("verifies the RFC 8032 test vector and rejects a changed message", () => {
    expect(verifyEd25519(pub, Buffer.alloc(0), sig)).toEqual({ ok: true });
    expect(verifyEd25519(pub, Buffer.from("x"), sig)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects S not below the group order", () => {
    const bad = Buffer.from(sig);
    bad.fill(0xff, 32);
    expect(verifyEd25519(pub, Buffer.alloc(0), bad)).toEqual({ ok: false, reason: "s-range" });
  });

  it("rejects a small-order public key (the neutral element) and a small-order R", () => {
    const neutral = Buffer.alloc(32); neutral[0] = 1;
    expect(verifyEd25519(neutral, Buffer.alloc(0), sig)).toEqual({ ok: false, reason: "weak-A" });
    const weakR = Buffer.concat([neutral, sig.subarray(32)]);
    expect(verifyEd25519(pub, Buffer.alloc(0), weakR)).toEqual({ ok: false, reason: "weak-R" });
  });

  it("rejects a non-canonical encoding of A (y not below p)", () => {
    const nonCanonical = Buffer.alloc(32, 0xff); nonCanonical[31] = 0x7f;
    expect(verifyEd25519(nonCanonical, Buffer.alloc(0), sig).ok).toBe(false);
  });
});

describe("reading input", () => {
  it("reads I-JSON and reports what JSON.parse hides", () => {
    const { issues } = readIJson('{"a":1,"a":2,"s":"\\ud800","n":123456789012345678901234567890123}');
    expect(issues.duplicates).toEqual(["a"]);
    expect(issues.loneSurrogate).toBe(true);
    expect(issues.maxLiteral).toBe(33);
  });

  it("reads the parameters from JSON or from the block under `## SFC parameters`", () => {
    expect(parametersFromText('{"platform":{}}')).toEqual({ platform: {} });
    expect(parametersFromText('# Doc\n\ntext\n\n## SFC parameters\n\n```json\n{"scope2-basis-1x":"market-based"}\n```\n')).toEqual({ "scope2-basis-1x": "market-based" });
    expect(() => parametersFromText("# no block")).toThrow(/SFC parameters/);
  });

  it("names why a read cannot be an excerpt at all", () => {
    const ok = { network: "ledger.example", "read-at": "2026-01-01T00:00:00Z", registry: [], ledger: [] };
    expect(excerptProblem(ok)).toBeNull();
    expect(excerptProblem({ ...ok, ledger: [null] })).toMatch(/ledger is not an array/);
    expect(excerptProblem({ ...ok, "read-at": "yesterday" })).toMatch(/read-at/);
    expect(excerptProblem({ ...ok, ledger: [{ commit: "2026-01-01T00:00:00Z", hash: "x" }] })).toMatch(/ledger entry 0/);
  });
});

describe("a damaged read or declaration", () => {
  /** A small deterministic generator, so a failure repeats. */
  const generator = (seed) => () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

  it("never stops a stage: no mutation of the year-2025 case produces an ERROR row", async () => {
    const file = vectorFiles().find((f) => f.name === "v05-sums-year");
    const base = inputOf(file.inputs.scenarios.find((s) => s.name === "year-2025"), file);
    const random = generator(2026);
    const pick = (list) => list[Math.floor(random() * list.length)];
    const pathsOf = (v, prefix = []) => (v !== null && typeof v === "object" ? Object.keys(v).flatMap((k) => [[...prefix, k], ...pathsOf(v[k], [...prefix, k])]) : []);
    const damage = (value) => {
      const copy = JSON.parse(JSON.stringify(value));
      const path = pick(pathsOf(copy));
      const parent = path.slice(0, -1).reduce((t, k) => t[k], copy);
      const last = path[path.length - 1];
      const how = pick(["delete", "null", "string", "number", "object", "array", "negative", "boolean"]);
      if (how === "delete") { if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last]; }
      else parent[last] = { null: null, string: "x", number: 7, object: {}, array: [], negative: -1, boolean: true }[how];
      return copy;
    };
    for (let i = 0; i < 40; i++) {
      const input = { ...base, excerpt: damage(damage(base.excerpt)), declarations: damage(base.declarations) };
      const report = await runChecks(input);
      expect({ run: i, errors: report.rows.filter((r) => r.id === "ERROR") }).toEqual({ run: i, errors: [] });
    }
  }, 120000);
});
