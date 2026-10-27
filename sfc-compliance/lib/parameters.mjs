/** The methodology parameters (7.6) and the keys a checker may use for the Registry (D2). */
import { canonicalize, withoutSig, unb64u } from "./canonical.mjs";
import { verifyEd25519 } from "./ed25519.mjs";
import { isObject, sameHost } from "./forms.mjs";

export const methodologyPinned = (ctx) => ctx.pins.methodology === true;
export const registryForms = (ctx) => ctx.params["retirement-registries"];
export const formRules = (ctx, registry) => (ctx.params["reference-forms"] ?? []).find((f) => f.registry === registry)?.rules ?? [];
export const takeoverOf = (ctx, operator, type) => (ctx.params.takeovers ?? []).find((x) => x.operator === operator && x.type === type);

const RANGE = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/, SINGLE = /^(0|[1-9]\d*)$/;

/** [first, last] of a serial reference, or null: a single serial is one value. */
export function serialRange(ref) {
  const range = RANGE.exec(ref);
  if (range) return [BigInt(range[1]), BigInt(range[2])];
  const single = SINGLE.exec(ref);
  return single ? [BigInt(single[1]), BigInt(single[1])] : null;
}

const RULES = {
  "upper-case": (r) => r === r.toUpperCase(),
  "lower-case": (r) => r === r.toLowerCase(),
  "no-leading-zeros": (r) => !/(^|[^0-9])0[0-9]/.test(r),
  "no-surrounding-space": (r) => r === r.trim(),
  "range-first-last": (r) => { const m = RANGE.exec(r); return m ? BigInt(m[1]) < BigInt(m[2]) : SINGLE.test(r); },
};
/** Does `reference` meet each canonical-form rule the methodology document names for its registry (L8b)? */
export const referenceCanonical = (reference, rules) => rules.every((rule) => !Object.hasOwn(RULES, rule) || RULES[rule](reference));

/**
 * The key of `pins.registrar` that applies to this read. With `pins.networkHost` (the network the caller pinned
 * for) the read must be of that network: a read that claims another one gets no pinned key. Without it, the
 * network the read claims.
 */
function pinKey(ctx) {
  const named = ctx.pins.networkHost;
  if (named === undefined) return ctx.network;
  return sameHost(named, ctx.network) ? named : undefined;
}

/** Registrar keys the checker may use: caller-pinned keys, and the keys of a pinned methodology document. */
export function registrarKeys(ctx) {
  const key = pinKey(ctx);
  const registrar = ctx.pins.registrar ?? {};
  const pinned = (key !== undefined && Object.hasOwn(registrar, key) ? registrar[key] : []).map((x) => ({ x, status: "current" }));
  const listed = methodologyPinned(ctx) ? (ctx.params["registrar-keys"] ?? []).map((k) => ({ x: k.jwk?.x, status: k.status })) : [];
  return [...pinned, ...listed];
}

/**
 * Verify a registrar-signed object (3.6 rule 2) under any of `keys`; returns { ok, status } or { ok: false, reason }.
 * `checkDeadline` is called before each key (the checker passes the context's; the default does nothing).
 */
export function verifyUnder(keys, obj, checkDeadline = () => {}) {
  const sig = obj?.sig;
  const bytes = isObject(sig) && sig.alg === "Ed25519" ? unb64u(sig.value) : null;
  if (!bytes || bytes.length !== 64) return { ok: false, reason: "encoding" };
  const message = Buffer.from(canonicalize(withoutSig(obj)), "utf8");
  let last = { ok: false, reason: "mismatch" };
  for (const k of keys) {
    checkDeadline();
    const pub = typeof k.x === "string" ? unb64u(k.x) : null;
    if (!pub) continue;
    const result = verifyEd25519(pub, message, bytes);
    if (result.ok) return { ok: true, status: k.status };
    last = result;
  }
  return { ok: false, reason: last.reason };
}
