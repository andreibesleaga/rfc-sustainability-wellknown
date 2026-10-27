/**
 * Ed25519 as RFC 8032 section 5.1.7 (cofactorless), with the extra rejections of
 * SFC profile 2.0 section 10: S below the group order, canonical R and A, and A
 * and R not of small order. `node:crypto` does the signing (pure Ed25519 is
 * deterministic) and the final verification equation, which is the same
 * cofactorless one; this file adds the rejections, because `node:crypto` accepts
 * keys and signatures that the profile rejects.
 *
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (section 10, Signatures)
 */
import { createHash, createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from "node:crypto";

const P = 2n ** 255n - 19n;
const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const mod = (a: bigint, m: bigint = P): bigint => ((a % m) + m) % m;
function pow(b: bigint, e: bigint, m: bigint = P): bigint {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const inv = (a: bigint): bigint => pow(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const I = pow(2n, (P - 1n) / 4n);

/** Extended coordinates [X, Y, Z, T]. */
type Point = [bigint, bigint, bigint, bigint];
const IDENT: Point = [0n, 1n, 1n, 0n];

function add(p: Point, q: Point): Point {
  const [X1, Y1, Z1, T1] = p;
  const [X2, Y2, Z2, T2] = q;
  const A = mod((Y1 - X1) * (Y2 - X2));
  const B = mod((Y1 + X1) * (Y2 + X2));
  const C = mod(2n * T1 * T2 * D);
  const DD = mod(2n * Z1 * Z2);
  const E = B - A;
  const F = DD - C;
  const G = DD + C;
  const H = B + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function mul(p: Point, s: bigint): Point {
  let r = IDENT;
  let q = p;
  while (s > 0n) {
    if (s & 1n) r = add(r, q);
    q = add(q, q);
    s >>= 1n;
  }
  return r;
}
const eqPoint = (p: Point, q: Point): boolean => mod(p[0] * q[2]) === mod(q[0] * p[2]) && mod(p[1] * q[2]) === mod(q[1] * p[2]);

function recoverX(y: bigint, sign: number): bigint | null {
  const x2 = mod((y * y - 1n) * inv(D * y * y + 1n));
  let x = pow(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * I);
  if (mod(x * x - x2) !== 0n) return null;
  if (x === 0n && sign === 1) return null;
  return Number(x & 1n) !== sign ? P - x : x;
}
const leInt = (buf: Uint8Array): bigint => {
  let r = 0n;
  for (let i = buf.length - 1; i >= 0; i--) r = (r << 8n) | BigInt(buf[i]);
  return r;
};

/** Decode a canonical point encoding, or null. */
export function decodePoint(bytes: Uint8Array): Point | null {
  if (bytes.length !== 32) return null;
  const v = leInt(bytes);
  const sign = Number(v >> 255n);
  const y = v & ((1n << 255n) - 1n);
  if (y >= P) return null; // non-canonical y
  const x = recoverX(y, sign);
  if (x === null) return null;
  return [x, y, 1n, mod(x * y)];
}
export const isSmallOrder = (p: Point): boolean => eqPoint(mul(p, 8n), IDENT);

export type VerifyReason = "encoding-length" | "s-range" | "bad-R" | "bad-A" | "weak-A" | "weak-R" | "mismatch";
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyReason };

/** Verdicts by (key, signature, message), so a signature met again (another replay, another check of the same read) is not recomputed. Bounded. */
const VERDICTS = new Map<string, VerifyResult>();
const VERDICT_LIMIT = 8192;

/** Strict verification of one Ed25519 signature (section 10, Signatures). Pure: the same inputs give the same verdict. */
export function verify(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): VerifyResult {
  // Lengths first (cheap), so the cache key below hashes a fixed 32 + 64 bytes and then the message: no two splits share a key.
  if (sig.length !== 64 || pub.length !== 32) return { ok: false, reason: "encoding-length" };
  const key = createHash("sha256").update(pub).update(sig).update(msg).digest("hex");
  const known = VERDICTS.get(key);
  if (known) return known;
  const verdict = verifyUncached(pub, msg, sig);
  if (VERDICTS.size >= VERDICT_LIMIT) VERDICTS.clear();
  VERDICTS.set(key, verdict);
  return verdict;
}

/** RFC 8032 verification by `node:crypto`; false on any error. */
function nodeAccepts(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): boolean {
  try {
    const x = Buffer.from(pub).toString("base64url");
    return nodeVerify(null, msg, createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" }), sig);
  } catch {
    return false;
  }
}

function verifyUncached(pub: Uint8Array, msg: Uint8Array, sig: Uint8Array): VerifyResult {
  const A = decodePoint(pub);
  if (!A) return { ok: false, reason: "bad-A" };
  const R = decodePoint(sig.subarray(0, 32));
  if (!R) return { ok: false, reason: "bad-R" };
  const S = leInt(sig.subarray(32));
  if (S >= L) return { ok: false, reason: "s-range" };
  if (isSmallOrder(A)) return { ok: false, reason: "weak-A" };
  if (isSmallOrder(R)) return { ok: false, reason: "weak-R" };
  // Past the profile's extra rejections the equation is RFC 8032 as `node:crypto` checks it, so its verdict is the verdict:
  // a failure there is a "mismatch", with no slower arithmetic to repeat the same equation.
  return nodeAccepts(pub, msg, sig) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** Sign `msg` with a private OKP Ed25519 JWK (`node:crypto`; deterministic). */
export function signWithJwk(jwk: { kty: string; crv: string; x: string; d: string }, msg: Uint8Array): Buffer {
  return nodeSign(null, msg, createPrivateKey({ key: jwk, format: "jwk" }));
}
