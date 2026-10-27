/**
 * Building blocks of the SFC profile 2.0 checks: exact decimals and rationals
 * (section 3.3), the value forms of 3.5 (instants and months are in
 * `calendar.ts`, re-exported here), RFC 8785 canonical text and SHA-256 (3.6), and canonical
 * base64url. Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 *
 * No binary floating point is used for any figure: a number is read through its
 * RFC 8785 text and held as a BigInt over a power of ten.
 *
 * JSON read from an untrusted document is typed `Json` (any): every function
 * that takes one checks the shape before it reads a member.
 */
import { createHash } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export const isObject = (v: unknown): v is Record<string, Json> => v !== null && typeof v === "object" && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Exact decimals (3.3): value = n / 10^s
// ---------------------------------------------------------------------------

export interface Dec {
  n: bigint;
  s: number;
}

const TEN = 10n;
const pow10 = (k: number): bigint => TEN ** BigInt(k);

export const ZERO: Dec = { n: 0n, s: 0 };
export const dec = (n: number | bigint, s = 0): Dec => ({ n: BigInt(n), s });

/** Parse the text of a JSON number (an RFC 8785 text or a literal), exponent form included. */
export function parseDec(text: string): Dec {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) throw new Error(`not a decimal: ${text}`);
  const frac = m[3] ?? "";
  let n = BigInt(m[2] + frac);
  let s = frac.length;
  const e = m[4] ? parseInt(m[4], 10) : 0;
  if (e >= 0) n *= pow10(e);
  else s += -e;
  return { n: m[1] === "-" ? -n : n, s };
}

/** The exact value of a JS number read through its RFC 8785 text. */
export const fromNumber = (x: number): Dec => parseDec(JSON.stringify(x));

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}

export const add = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b);
  return { n: x + y, s };
};
export const sub = (a: Dec, b: Dec): Dec => {
  const [x, y, sc] = align(a, b);
  return { n: x - y, s: sc };
};
export const mulInt = (a: Dec, k: number | bigint): Dec => ({ n: a.n * BigInt(k), s: a.s });
export const cmp = (a: Dec, b: Dec): number => {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const eq = (a: Dec, b: Dec): boolean => cmp(a, b) === 0;
export const isZero = (a: Dec): boolean => a.n === 0n;
export const sumDec = (xs: Dec[]): Dec => xs.reduce(add, ZERO);

/** Divide integer n by integer d (> 0), rounding half to even. */
function divHalfEven(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const an = neg ? -n : n;
  let q = an / d;
  const r2 = (an % d) * 2n;
  if (r2 > d || (r2 === d && q % 2n === 1n)) q += 1n;
  return neg ? -q : q;
}

/** Round to `places` decimals, half to even (3.3 rule 3); the result has scale `places`. */
export function roundHalfEven(a: Dec, places: number): Dec {
  if (a.s <= places) return { n: a.n * pow10(places - a.s), s: places };
  return { n: divHalfEven(a.n, pow10(a.s - places)), s: places };
}

/** a / b rounded half to even to `places` decimals (b > 0). */
export function divRound(a: Dec, b: Dec, places: number): Dec {
  const num = a.n * pow10(places + b.s);
  const den = b.n * pow10(a.s);
  if (den < 0n) return { n: divHalfEven(-num, -den), s: places };
  return { n: divHalfEven(num, den), s: places };
}

/** a / 10^k exactly (unit conversion by a power of ten). */
export const shift = (a: Dec, k: number): Dec => ({ n: a.n, s: a.s + k });

/** A value in the base unit (kWh, kgCO2e) expressed in a unit whose `sh` is its power of ten over the base (MWh: 3, Wh: -3). */
export const toUnit = (a: Dec, sh: number): Dec => (sh >= 0 ? shift(a, sh) : mulInt(a, 10 ** -sh));
/** A value in a unit whose `sh` is its power of ten over the base, expressed in the base unit. */
export const fromUnit = (a: Dec, sh: number): Dec => (sh >= 0 ? mulInt(a, 10 ** sh) : shift(a, -sh));

/** Shortest plain-decimal text: trailing fractional zeros removed. */
export function toText(a: Dec): string {
  let { n } = a;
  const { s } = a;
  const neg = n < 0n;
  if (neg) n = -n;
  const str = n.toString().padStart(s + 1, "0");
  const i = str.length - s;
  let out = s === 0 ? str : `${str.slice(0, i)}.${str.slice(i)}`;
  if (s > 0) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return (neg && out !== "0" ? "-" : "") + out;
}

/** The JSON number published for an exact decimal; throws unless its RFC 8785 text equals the value. */
export function toPublished(a: Dec): number {
  const text = toText(a);
  const x = Number(text);
  if (!eq(fromNumber(x), a)) throw new Error(`value ${text} is not representable as an RFC 8785 number text`);
  return x;
}

/** The published form of an exact value: rounded half to even to 6 decimals (3.3 rule 3). */
export const round6 = (a: Dec): Dec => roundHalfEven(a, 6);
export const publish6 = (a: Dec): number => toPublished(round6(a));

// ---------------------------------------------------------------------------
// Exact rationals, for the quotient form of the tolerance rule (3.3 rule 4, S6 d)
// ---------------------------------------------------------------------------

export interface Rat {
  n: bigint;
  d: bigint;
}
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};
export function rat(n: bigint, d = 1n): Rat {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
export const ratFromDec = (x: Dec): Rat => rat(x.n, 10n ** BigInt(x.s));
export const ratAdd = (a: Rat, b: Rat): Rat => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const ratSub = (a: Rat, b: Rat): Rat => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const ratMul = (a: Rat, b: Rat): Rat => rat(a.n * b.n, a.d * b.d);
export const ratDiv = (a: Rat, b: Rat): Rat => rat(a.n * b.d, a.d * b.n);
export const ratCmp = (a: Rat, b: Rat): number => {
  const x = a.n * b.d;
  const y = b.n * a.d;
  return x < y ? -1 : x > y ? 1 : 0;
};
export const ratAbs = (a: Rat): Rat => rat(a.n < 0n ? -a.n : a.n, a.d);

/** Exact decimal text of a rational with a terminating expansion, else a fraction n/d. */
export function ratText(a: Rat): string {
  let d = a.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos++;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives++;
  }
  if (d !== 1n) return `${a.n}/${a.d}`;
  const s = Math.max(twos, fives);
  const scaled = (a.n * 10n ** BigInt(s)) / a.d;
  const neg = scaled < 0n;
  const str = (neg ? -scaled : scaled).toString().padStart(s + 1, "0");
  const out = s === 0 ? str : `${str.slice(0, str.length - s)}.${str.slice(str.length - s)}`.replace(/0+$/, "").replace(/\.$/, "");
  return (neg ? "-" : "") + out;
}

// ---------------------------------------------------------------------------
// base64url, RFC 8785, SHA-256 (3.5, 3.6)
// ---------------------------------------------------------------------------

export const b64u = (buf: Uint8Array): string => Buffer.from(buf).toString("base64url");

/** Decode, or null when `s` is not the canonical encoding of the bytes it decodes to. */
export function unb64u(s: unknown): Buffer | null {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const bytes = Buffer.from(s, "base64url");
  return b64u(bytes) === s ? bytes : null;
}

/** RFC 8785 canonical text for I-JSON values. */
export function canonicalize(v: Json): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return JSON.stringify(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).sort(); // UTF-16 code unit order
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
  }
  throw new Error(`cannot canonicalise ${typeof v}`);
}

export const textHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");
export const hashOf = (value: Json): string => textHash(canonicalize(value));
export const withoutSig = (o: Record<string, Json>): Record<string, Json> => {
  const { sig: _sig, ...rest } = o;
  return rest;
};

export * from "./calendar";

// ---------------------------------------------------------------------------
// Value forms (3.5) and figure rules (3.3 rules 2 and 3)
// ---------------------------------------------------------------------------

export const isHex64 = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
export const isB64Url = (v: unknown, bytes?: number): boolean => {
  const b = unb64u(v);
  return b !== null && (bytes === undefined || b.length === bytes);
};
const IDCHAR = "(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})";
const DID_RE = new RegExp(`^did:[a-z0-9]+:(?:${IDCHAR}*:)*${IDCHAR}+$`);
export const isDid = (v: unknown): v is string => typeof v === "string" && DID_RE.test(v);
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?";
const HOST_RE = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`);
export const isHost = (v: unknown): v is string => typeof v === "string" && v.length <= 253 && HOST_RE.test(v);
export const isHttpsUri = (v: unknown): v is string => typeof v === "string" && /^https:\/\/[^\s]+$/.test(v);
export const isUriAbs = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]+$/.test(v);
/** ASCII-only lower-casing (3.5 host): `toLowerCase` also folds non-ASCII characters, such as the Kelvin sign U+212A to `k`, so a look-alike host would match. */
export const asciiLower = (s: unknown): string => String(s).replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
export const sameHost = (a: unknown, b: unknown): boolean => typeof a === "string" && typeof b === "string" && asciiLower(a) === asciiLower(b);
/** The same `target` (7.3, S4): host names are compared after ASCII lower-casing (3.5 `host`, Appendix D); any other target as an exact string. */
export const sameTarget = (a: unknown, b: unknown): boolean => a === b || (isHost(a) && isHost(b) && sameHost(a, b));
export const isInt = (v: unknown, min = 0): v is number => Number.isInteger(v) && (v as number) >= min;
export const isNum = (v: unknown, min = 0): v is number => typeof v === "number" && Number.isFinite(v) && v >= min;

/** 3.3 rule 2 on the RFC 8785 text of a figure: plain decimal, at most 15 digits, at most 6 after the point, not negative. */
export function figureOk(x: unknown): boolean {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) return false;
  const m = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(JSON.stringify(x));
  if (!m) return false;
  const frac = m[2] ?? "";
  if (frac.length > 6) return false;
  const digits = m[1] === "0" && frac === "" ? 0 : m[1].length + frac.length;
  return digits <= 15;
}
/** `tonnesRetired`: an integer of at least 1 and at most 15 digits. */
export const tonnesOk = (x: unknown): boolean => Number.isInteger(x) && (x as number) >= 1 && String(x).length <= 15;

// ---------------------------------------------------------------------------
// Result words and report rows (9.1)
// ---------------------------------------------------------------------------

export const PASS = "PASS";
export const FAIL = "FAIL";
export const NE = "NOT-EVALUABLE";
export const DECLARED = "DECLARED";
export const NOT_DECLARED = "NOT-DECLARED";
export const INFO = "INFO";

/** A result word of 9.1 or an object verdict (COMPLETE, INCOMPLETE, NOT-APPLICABLE). */
export type Result = string;

export interface Row {
  id: string;
  result: Result;
  scope?: string;
  detail?: string;
}

export function row(id: string, result: Result, detail?: string, scope?: string): Row {
  const r: Row = { id, result };
  if (scope !== undefined) r.scope = scope;
  if (detail !== undefined && detail !== "") r.detail = detail;
  return r;
}

const RANK: Record<string, number> = { [FAIL]: 3, [NE]: 2, [PASS]: 1 };
/** Worst of results: FAIL, then NOT-EVALUABLE, then PASS. */
export const worst = (...rs: Result[]): Result => rs.reduce((a, b) => ((RANK[b] ?? 0) > (RANK[a] ?? 0) ? b : a));
/** Sorted, de-duplicated tokens joined by `; `, so two implementations print the same detail. */
export const list = (xs: string[]): string => [...new Set(xs)].sort().join("; ");
