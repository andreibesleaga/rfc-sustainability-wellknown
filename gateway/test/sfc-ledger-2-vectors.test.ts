/**
 * Fitness test: every case of the SFC profile 2.0 test vectors
 * (`sfc-compliance/vectors/`, Appendix B of the spec) runs through the gateway's
 * 2.0 checks and must reproduce the expected rows, summary, effective
 * attestations and derived figures of `expected/` exactly. The vectors are
 * deterministic (fixed clock, the RFC 8032 test key, no network), so is this test.
 *
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (Appendix B)
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { derivedFor, effectiveList, runChecks, type RunInput } from "../src/adapters/sfc-ledger-2/check";
import * as ed from "../src/adapters/sfc-ledger-2/ed25519";
import { readIJson } from "../src/adapters/sfc-ledger-2/ijson";
import { MECHANISMS, normaliseMechanism } from "../src/adapters/sfc-ledger-2/window";
import { convert1xEntry, activeIn, normEntry } from "../src/adapters/sfc-ledger-2/registry";
import { canonicalize, figureOk, parseDec, roundHalfEven, textHash, toText, unb64u, hex, fromHexString } from "./sfc2-helpers";

/** One scenario must finish well inside this; a regression that loops or crawls fails that case, not the whole run. */
const CASE_TIMEOUT_MS = 5_000;

const VECTORS = resolve(__dirname, "..", "..", "sfc-compliance", "vectors");

/* eslint-disable @typescript-eslint/no-explicit-any */
type Json = any;

function loadCases(): { id: string; input: Json; expected: Json }[] {
  const out: { id: string; input: Json; expected: Json }[] = [];
  for (const f of readdirSync(join(VECTORS, "inputs")).sort()) {
    out.push({ id: f.replace(/\.json$/, ""), input: read(join(VECTORS, "inputs", f)), expected: read(join(VECTORS, "expected", f)) });
  }
  out.push({ id: "worked", input: read(join(VECTORS, "worked", "input.json")), expected: read(join(VECTORS, "worked", "expected.json")) });
  return out;
}
const read = (p: string): Json => JSON.parse(readFileSync(p, "utf8"));

/** The pure functions of the vectors (`fn` scenarios), computed by the gateway's primitives. */
const FUNCS: Record<string, (sc: Json) => Json> = {
  canonical: ({ values }) => values.map((v: Json) => { const text = canonicalize(v); return { canonical: text, bytesHex: Buffer.from(text, "utf8").toString("hex"), sha256: textHash(text) }; }),
  ed25519: ({ cases }) => cases.map((c: Json) => { const r = ed.verify(fromHexString(c.pub), fromHexString(c.msg), fromHexString(c.sig)); return r.ok ? { ok: true } : { ok: false, reason: r.reason }; }),
  eventHash: ({ event, pub }) => {
    const { sig, ...rest } = event;
    const text = canonicalize(rest);
    const r = ed.verify(fromHexString(pub), Buffer.from(text, "utf8"), unb64u(sig.value) ?? Buffer.alloc(0));
    return { signingInput: text, signingInputHex: Buffer.from(text, "utf8").toString("hex"), hash: textHash(canonicalize(event)), verified: r.ok };
  },
  b64url: ({ values }) => values.map((s: string) => { const b = unb64u(s); return { bytesHex: b === null ? null : hex(b) }; }),
  figure: ({ texts }) => texts.map((t: string) => ({ ok: figureOk(readIJson(t).value) && /^(0|[1-9]\d*)(\.\d+)?$/.test(t) })),
  round: ({ cases }) => cases.map((c: Json) => ({ rounded: toText(roundHalfEven(parseDec(c.value), c.places)) })),
  // the port's own closed list (7.6), so a value the reference admits and the port omits fails here
  mechanism: ({ values }) => values.map((v: string) => {
    const n = normaliseMechanism(v);
    return { normalised: n, test1: n === "proof-of-work" ? "FAIL" : n !== null && MECHANISMS.includes(n) ? "PASS" : "NOT-EVALUABLE" };
  }),
  registry1xTo2x: ({ entry, months }) => {
    const conv = convert1xEntry(entry);
    const one = normEntry(entry);
    const two = normEntry({ ...entry, ...conv, network: "x", sig: {} });
    const m1 = months.filter((m: string) => activeIn(one, m));
    const m2 = months.filter((m: string) => activeIn(two, m));
    return { active: conv.active, keys: conv.keys, activeMonths1x: m1, activeMonths20: m2, same: JSON.stringify(m1) === JSON.stringify(m2) };
  },
};

/** A scenario of a vectors file as the checks' input: shared excerpts resolved. */
function toRunInput(sc: Json, excerpts: Json): RunInput {
  const { name: _name, excerptRef, derive: _derive, effectiveAt: _effectiveAt, ...rest } = sc;
  return { ...rest, ...(excerptRef ? { excerpt: excerpts[excerptRef] } : {}) } as RunInput;
}

describe("SFC 2.0 test vectors reproduced by the gateway checks", () => {
  for (const c of loadCases()) {
    describe(c.id, () => {
      for (const sc of c.input.scenarios) {
        it(sc.name, { timeout: CASE_TIMEOUT_MS }, () => {
          const want = c.expected.scenarios[sc.name];
          if (sc.fn) {
            expect(FUNCS[sc.fn](sc)).toEqual(want.result);
            return;
          }
          const run = runChecks(toRunInput(sc, c.input.excerpts ?? {}));
          expect(run.rows).toEqual(want.rows);
          expect(run.summary).toEqual(want.summary);
          if (want.effective) expect(effectiveList(run.ctx!, sc.effectiveAt)).toEqual(want.effective);
          if (want.derived) expect(sc.derive.map((spec: Json) => derivedFor(run.ctx!, spec))).toEqual(want.derived);
        });
      }
    });
  }
});
