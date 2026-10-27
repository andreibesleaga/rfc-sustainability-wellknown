/** The ledger read as the checks hold it: events with their month, span and signature facts (5.2, 5.7, 5.8). */
import { canonicalize, hashOf, withoutSig, unb64u } from "./canonical.mjs";
import { verifyEd25519 } from "./ed25519.mjs";
import { isObject, isMonthBound } from "./forms.mjs";
import { eventShape } from "./shapes.mjs";
import { is1xEvent, event1xShape, month1x, span1x } from "./profile1x.mjs";
import { normEntry, keysValidAt, pubOf } from "./registry.mjs";
import { addMonths, before, isInstant } from "./time.mjs";
import { withLimits } from "./limits.mjs";
import { startDeadline } from "./deadline.mjs";

function safeHash(event) {
  try { return hashOf(event); } catch { return null; }
}

/**
 * Build the context every check reads from one input (see check.mjs for its members). Events keep the
 * `kind` ("2x" or "1x") that selects the rules they are judged by.
 */
export function buildContext(input) {
  const ex = input.excerpt;
  const registry = (ex.registry ?? []).map(normEntry);
  const byOperator = new Map();
  for (const entry of registry) if (!byOperator.has(entry.operator)) byOperator.set(entry.operator, entry);
  const events = (ex.ledger ?? []).map((l, i) => ({
    i, commit: l.commit, hash: l.hash, event: l.event, computed: safeHash(l.event), kind: is1xEvent(l.event) ? "1x" : "2x",
  }));
  const limits = withLimits(input.limits);
  return {
    input, ex, network: ex.network, readAt: ex["read-at"], registry, byOperator, events,
    voids: ex.voids ?? [], checkpoint: ex.checkpoint ?? null, params: input.parameters ?? {},
    pins: input.pins ?? {}, limits, cache: new Map(),
    // throws CheckLimit after `secondsPerCheck`; `input.clock` (milliseconds) replaces performance.now in tests
    checkDeadline: startDeadline(limits.secondsPerCheck, input.clock),
  };
}

export const eventShapeTokens = (ev) => (ev.kind === "1x" ? event1xShape(ev.event) : eventShape(ev.event));

/** The month (start instant) an event is about, or null: a 2.0 month-bound pair or 1.x dates of one UTC month. */
export function monthOfEvent(ev) {
  const p = ev.event?.payload?.period;
  if (!isObject(p)) return null;
  if (ev.kind === "1x") return month1x(p);
  return isMonthBound(p.start) && isMonthBound(p.end) && p.end === addMonths(p.start, 1) ? p.start : null;
}

/** [start, end) of an event's period as instants, or null when invalid. */
export function spanOfEvent(ev) {
  const p = ev.event?.payload?.period;
  if (!isObject(p)) return null;
  if (ev.kind === "1x") return span1x(p);
  return isInstant(p.start) && isInstant(p.end) && before(p.start, p.end) ? [p.start, p.end] : null;
}

// ---- signatures ---------------------------------------------------------------------------

/**
 * Verify the signature bytes under every key valid at the commit; returns the failure reasons seen.
 * A failed attempt costs about 2 ms, and an entry may hold many keys, so the time limit is checked per key.
 */
function verifyUnderKeys(keys, message, bytes, checkDeadline) {
  const reasons = [];
  for (const k of keys) {
    checkDeadline();
    const pub = pubOf(k);
    if (!pub) { reasons.push("bad-A"); continue; }
    const result = verifyEd25519(pub, message, bytes);
    if (result.ok) return { verified: true, reasons };
    reasons.push(result.reason);
  }
  return { verified: false, reasons };
}

/**
 * Signature facts of an event: { alg, encoding, weak, verified, noKey, algName }. A 1.x event is read as
 * the 1.2 reference code reads it (decoded 64 bytes against the key; encoding findings are not failures).
 */
export function sigInfo(ctx, ev) {
  const cached = ctx.cache.get(`sig${ev.i}`);
  if (cached) return cached;
  const sig = ev.event?.sig;
  const out = { alg: true, encoding: true, weak: false, verified: false, noKey: false, algName: sig?.alg };
  const oneX = ev.kind === "1x";
  if (!isObject(sig) || typeof sig.value !== "string") out.encoding = false;
  else {
    if (sig.alg !== "Ed25519") out.alg = false;
    const { strict, bytes } = signatureBytes(sig.value, oneX);
    if (!strict && !oneX) out.encoding = false;
    if (out.alg && bytes) checkSignature(ctx, ev, bytes, out);
    else if (out.alg && !oneX) out.encoding = false;
  }
  ctx.cache.set(`sig${ev.i}`, out);
  return out;
}

/** The 64 signature bytes of `value`: the canonical base64url, or for a 1.x event any base64url reading (12.1); `bytes` is null when neither gives 64 bytes. */
function signatureBytes(value, oneX) {
  const strict = unb64u(value);
  const bytes = strict ?? (oneX ? Buffer.from(value, "base64url") : null);
  return { strict: strict !== null, bytes: bytes && bytes.length === 64 ? bytes : null };
}

function checkSignature(ctx, ev, bytes, out) {
  const e = ev.event;
  const entry = ctx.byOperator.get(e.subject);
  const keys = entry ? keysValidAt(entry, ev.commit) : [];
  if (!keys.length) out.noKey = true;
  const message = Buffer.from(canonicalize(withoutSig(e)), "utf8");
  const { verified, reasons } = verifyUnderKeys(keys, message, bytes, ctx.checkDeadline);
  out.verified = verified;
  if (verified || !out.encoding) return;
  if (reasons.some((r) => r === "s-range" || r === "bad-R" || r === "bad-A")) out.encoding = ev.kind === "1x";
  if (reasons.some((r) => r === "weak-A" || r === "weak-R")) out.weak = true;
}
