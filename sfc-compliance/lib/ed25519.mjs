/**
 * Ed25519 verification as profile section 10 requires: RFC 8032 section 5.1.7 (cofactorless), S below
 * the group order, canonical encodings of R and A, and no small-order A or R.
 *
 * The checks that need point arithmetic (decoding, small order) are done here with BigInt. The group
 * equation itself is checked by node:crypto, after those rejections.
 */
import { createPublicKey, verify as nodeVerify } from "node:crypto";

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (a) => ((a % P) + P) % P;
function pow(base, exp) {
  let r = 1n, b = mod(base), e = exp;
  while (e > 0n) { if (e & 1n) r = (r * b) % P; b = (b * b) % P; e >>= 1n; }
  return r;
}
const inv = (a) => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

/** Extended coordinates [X, Y, Z, T]. */
function addPoints(p, q) {
  const [X1, Y1, Z1, T1] = p, [X2, Y2, Z2, T2] = q;
  const A = mod((Y1 - X1) * (Y2 - X2)), B = mod((Y1 + X1) * (Y2 + X2));
  const C = mod(2n * T1 * T2 * D), DD = mod(2n * Z1 * Z2);
  const E = B - A, F = DD - C, G = DD + C, H = B + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
const isNeutral = (p) => p[0] % P === 0n && mod(p[1] - p[2]) === 0n;

function recoverX(y, sign) {
  const x2 = mod((y * y - 1n) * inv(D * y * y + 1n));
  let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1);
  if (mod(x * x - x2) !== 0n) return null;
  if (x === 0n && sign === 1) return null;
  return Number(x & 1n) !== sign ? P - x : x;
}

const leInt = (buf) => buf.reduceRight((acc, byte) => (acc << 8n) | BigInt(byte), 0n);

/** A canonical point encoding as extended coordinates, or null. */
function decodePoint(bytes) {
  if (bytes.length !== 32) return null;
  const v = leInt(bytes), sign = Number(v >> 255n), y = v & ((1n << 255n) - 1n);
  if (y >= P) return null; // non-canonical y
  const x = recoverX(y, sign);
  return x === null ? null : [x, y, 1n, mod(x * y)];
}
/** Order divides 8: eight doublings-and-additions reach the neutral element. */
function isSmallOrder(p) {
  let r = p;
  for (let i = 0; i < 3; i++) r = addPoints(r, r);
  return isNeutral(r);
}

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const publicKeyObject = (pub) => createPublicKey({ key: Buffer.concat([SPKI_PREFIX, pub]), format: "der", type: "spki" });

/**
 * Verify. Returns { ok: true } or { ok: false, reason } with reason one of
 * encoding-length, s-range, bad-R, bad-A, weak-A, weak-R, mismatch.
 */
export function verifyEd25519(pub, msg, sig) {
  if (sig.length !== 64 || pub.length !== 32) return { ok: false, reason: "encoding-length" };
  const A = decodePoint(pub);
  if (!A) return { ok: false, reason: "bad-A" };
  const R = decodePoint(sig.subarray(0, 32));
  if (!R) return { ok: false, reason: "bad-R" };
  if (leInt(sig.subarray(32)) >= L) return { ok: false, reason: "s-range" };
  if (isSmallOrder(A)) return { ok: false, reason: "weak-A" };
  if (isSmallOrder(R)) return { ok: false, reason: "weak-R" };
  return nodeVerify(null, msg, publicKeyObject(pub), sig) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** "key encoding" for a key that does not decode, "weak key" for a small-order key, else null. */
export function keyFault(pub) {
  const A = pub ? decodePoint(pub) : null;
  if (!A) return "key encoding";
  return isSmallOrder(A) ? "weak key" : null;
}
