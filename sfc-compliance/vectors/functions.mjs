/**
 * Pure-function scenarios: the building blocks the other cases rest on, computed by the checker's own
 * modules (../lib). make-vectors.mjs records their results; the test suite recomputes them.
 */
import { canonicalize, textHash, hashOf, unb64u } from "../lib/canonical.mjs";
import { verifyEd25519 } from "../lib/ed25519.mjs";
import { parseDec, roundHalfEven, toText } from "../lib/decimal.mjs";
import { figureOk } from "../lib/forms.mjs";
import { readIJson } from "../lib/ijson.mjs";
import { normEntry, activeIn } from "../lib/registry.mjs";
import { addMonths, monthOf, before, cmpInstant } from "../lib/time.mjs";
import { normaliseMechanism, MECHANISMS } from "../lib/window.mjs";

const hex = (buf) => Buffer.from(buf).toString("hex");
const fromHex = (h) => Buffer.from(h, "hex");

/** 12.1 rule 6: the 2.0-form `active` intervals of a 1.x entry (month bounds, merged) and its renamed keys. */
export function convert1xEntry(entry) {
  const month = (date) => monthOf(`${date}T00:00:00Z`);
  const raw = entry.active.map((a) => ({ from: month(a.from), to: a.to === null ? null : addMonths(month(a.to), 1) }));
  raw.sort((x, y) => cmpInstant(x.from, y.from));
  const merged = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && (last.to === null || !before(last.to, iv.from))) {
      if (last.to !== null && (iv.to === null || before(last.to, iv.to))) last.to = iv.to;
    } else merged.push({ ...iv });
  }
  return { active: merged, keys: entry.keys.map((k) => ({ jwk: k["public-jwk"], validFromCommit: k["valid-from-commit"], validToCommit: k["valid-to-commit"] })) };
}

export const FUNCS = {
  /** 7.6 `mechanism` comparison and the verdict of test 1 of C-SFC-6. */
  mechanism: ({ values }) => values.map((v) => {
    const normalised = normaliseMechanism(v);
    return { normalised, test1: normalised === "proof-of-work" ? "FAIL" : MECHANISMS.includes(normalised) ? "PASS" : "NOT-EVALUABLE" };
  }),
  /** The 1.x entry converted to 2.0 form, and the active months under both readings (they must be equal). */
  registry1xTo2x: ({ entry, months }) => {
    const conv = convert1xEntry(entry);
    const one = normEntry(entry), two = normEntry({ ...entry, ...conv, keys: conv.keys, network: "x", sig: {}, active: conv.active });
    const m1 = months.filter((m) => activeIn(one, m)), m2 = months.filter((m) => activeIn(two, m));
    return { active: conv.active, keys: conv.keys, activeMonths1x: m1, activeMonths20: m2, same: JSON.stringify(m1) === JSON.stringify(m2) };
  },
  /** RFC 8785 text, its bytes in hex and its SHA-256 for each value. */
  canonical: ({ values }) => values.map((v) => {
    const text = canonicalize(v);
    return { canonical: text, bytesHex: hex(Buffer.from(text, "utf8")), sha256: textHash(text) };
  }),
  /** The strict Ed25519 verdict of section 10 for { pub, msg, sig } given in hex. */
  ed25519: ({ cases }) => cases.map((c) => {
    const r = verifyEd25519(fromHex(c.pub), fromHex(c.msg), fromHex(c.sig));
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  }),
  /** Signing input, hash and signature verdict of one event, given the signer's public key in hex. */
  eventHash: ({ event, pub }) => {
    const { sig, ...rest } = event;
    const text = canonicalize(rest);
    const r = verifyEd25519(fromHex(pub), Buffer.from(text, "utf8"), unb64u(sig.value) ?? Buffer.alloc(0));
    return { signingInput: text, signingInputHex: hex(Buffer.from(text, "utf8")), hash: hashOf(event), verified: r.ok };
  },
  /** Canonical base64url: the bytes in hex, or null when the string is not the canonical encoding. */
  b64url: ({ values }) => values.map((s) => { const b = unb64u(s); return { bytesHex: b === null ? null : hex(b) }; }),
  /** 3.3 rule 2 on number texts. */
  figure: ({ texts }) => texts.map((t) => ({ ok: figureOk(readIJson(t).value) && /^(0|[1-9]\d*)(\.\d+)?$/.test(t) })),
  /** Round half to even to `places` decimals. */
  round: ({ cases }) => cases.map((c) => ({ rounded: toText(roundHalfEven(parseDec(c.value), c.places)) })),
};
