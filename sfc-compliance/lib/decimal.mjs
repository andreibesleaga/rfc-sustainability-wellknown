/**
 * Exact arithmetic without binary floating point (profile 3.3).
 *
 * `Dec` is a decimal { n: BigInt, s: number }: the value n / 10^s with s >= 0.
 * `Rat` is a rational { n: BigInt, d: BigInt } in lowest terms with d > 0; the quotient form of the
 * tolerance rule (S6 d) needs it.
 */
const TEN = 10n;
const pow10 = (k) => TEN ** BigInt(k);

export const ZERO = { n: 0n, s: 0 };
export const dec = (n, s = 0) => ({ n: BigInt(n), s });

/** Parse the text of a JSON number (an RFC 8785 text or a literal). */
export function parseDec(text) {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!m) throw new Error(`not a decimal: ${text}`);
  const frac = m[3] ?? "";
  const exponent = m[4] ? parseInt(m[4], 10) : 0;
  let n = BigInt(m[2] + frac);
  let s = frac.length;
  if (exponent >= 0) n *= pow10(exponent);
  else s -= exponent;
  return { n: m[1] === "-" ? -n : n, s };
}

/** The exact value of a JS number, read through its RFC 8785 text. */
export const fromNumber = (x) => parseDec(JSON.stringify(x));

function align(a, b) {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}
export const add = (a, b) => { const [x, y, s] = align(a, b); return { n: x + y, s }; };
export const sub = (a, b) => { const [x, y, s] = align(a, b); return { n: x - y, s }; };
export const abs = (a) => ({ n: a.n < 0n ? -a.n : a.n, s: a.s });
export const mulInt = (a, k) => ({ n: a.n * BigInt(k), s: a.s });
export const cmp = (a, b) => { const [x, y] = align(a, b); return x < y ? -1 : x > y ? 1 : 0; };
export const eq = (a, b) => cmp(a, b) === 0;
export const isZero = (a) => a.n === 0n;
/** a / 10^k, exactly. */
export const shift = (a, k) => ({ n: a.n, s: a.s + k });

/** Divide integer n by integer d > 0, rounding half to even. */
function divHalfEven(n, d) {
  const abs = n < 0n ? -n : n;
  let q = abs / d;
  const twice = (abs % d) * 2n;
  if (twice > d || (twice === d && q % 2n === 1n)) q += 1n;
  return n < 0n ? -q : q;
}

/** Round to `places` decimals, half to even; the result has scale `places`. */
export function roundHalfEven(a, places) {
  if (a.s <= places) return { n: a.n * pow10(places - a.s), s: places };
  return { n: divHalfEven(a.n, pow10(a.s - places)), s: places };
}

/** a / b rounded half to even to `places` decimals (b > 0). */
export function divRound(a, b, places) {
  const num = a.n * pow10(places + b.s);
  const den = b.n * pow10(a.s);
  return { n: divHalfEven(num, den), s: places };
}

/** The shortest plain-decimal text of a Dec. */
export function toText({ n, s }) {
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().padStart(s + 1, "0");
  const cut = digits.length - s;
  let out = s === 0 ? digits : `${digits.slice(0, cut)}.${digits.slice(cut)}`;
  if (s > 0) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return neg && out !== "0" ? `-${out}` : out;
}

// ---- rationals ----------------------------------------------------------------------------

const gcd = (a, b) => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
export function q(n, d = 1n) {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}
export const fromDec = (x) => q(x.n, 10n ** BigInt(x.s));
export const qAdd = (a, b) => q(a.n * b.d + b.n * a.d, a.d * b.d);
export const qSub = (a, b) => q(a.n * b.d - b.n * a.d, a.d * b.d);
export const qMul = (a, b) => q(a.n * b.n, a.d * b.d);
export const qDiv = (a, b) => q(a.n * b.d, a.d * b.n);
export const qCmp = (a, b) => { const x = a.n * b.d, y = b.n * a.d; return x < y ? -1 : x > y ? 1 : 0; };
export const qAbs = (a) => q(a.n < 0n ? -a.n : a.n, a.d);

/** Exact decimal text of a rational with a terminating expansion, else the fraction n/d. */
export function qText(a) {
  let d = a.d, twos = 0, fives = 0;
  while (d % 2n === 0n) { d /= 2n; twos++; }
  while (d % 5n === 0n) { d /= 5n; fives++; }
  if (d !== 1n) return `${a.n}/${a.d}`;
  const s = Math.max(twos, fives);
  const scaled = (a.n * 10n ** BigInt(s)) / a.d;
  const abs = scaled < 0n ? -scaled : scaled;
  const str = abs.toString().padStart(s + 1, "0");
  const cut = str.length - s;
  const out = s === 0 ? str : `${str.slice(0, cut)}.${str.slice(cut)}`.replace(/0+$/, "").replace(/\.$/, "");
  return scaled < 0n ? `-${out}` : out;
}
