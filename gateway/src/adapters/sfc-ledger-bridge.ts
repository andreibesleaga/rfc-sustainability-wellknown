/**
 * The SFC ledger bridge — EXPERIMENTAL gateway-local adapter.
 *
 * What it reads: a *ledger excerpt* — one operator's (or every operator's)
 * signed monthly `EnergyAttested` and `CarbonAttested` events as a ledger
 * committed them, the Registry's keys and activity intervals, and the signed
 * allocations of retired credits (SFC ledger profile 1.2: §A.1 hashing
 * and signatures, §A.3 the events, §A.4 the offset-coverage rule).
 *
 * What it writes: one draft -07 declaration. Energy and the two scopes are the
 * sums of the period's effective attestations; `carbon-footprint` is their
 * gross sum and is never reduced by credits (disclosure profile rule 1); the
 * credits allocated to the period go, in tonnes, into `carbon-neutrality`; the
 * chain heads, event counts, exact sums and the rule's result go into the
 * `ledger-evidence` extension (disclosure profile 1.1 §5.5; Supplement A §A.9), so that anyone with the excerpt
 * can recompute the declaration.
 *
 * It refuses rather than guesses. A hash that does not recompute, a signature
 * that does not verify under the key the Registry held at COMMIT time, a `prev`
 * that is not the head, a fork, a duplicate month without `supersedes`, an
 * attestation timestamped before its month ended or for a month in which the
 * operator was not active, an allocation that does not match the credits it
 * allocates, a negative gross, or a `netZero` flag that contradicts its own
 * figures stops publication with an error naming the rule
 * (`[E-…]`, listed with `BridgeCode`). A month that failed the rule with a
 * CORRECT flag, or a silent month, is published, with
 * `offset-coverage-every-period: false` and the unknown figures omitted.
 *
 * The other direction, two checks a reader can run on a served declaration:
 * `shallowCheck` (validate, verify `signed` with a pinned key, internal
 * coherence) and `deepCheck` (recompute everything from the excerpt). Neither
 * establishes that a reading was true; the words in their rows say exactly
 * what was established (§A.9.5).
 *
 * Every name, token and bound comes from the profile descriptor
 * (`sfc-ledger-profile.ts`), so a later profile version is a second descriptor,
 * not an edit here. Members the descriptor does not name are ignored
 * everywhere (they still enter every hash and signature, which are computed
 * over the whole object), so an excerpt that adds an optional field keeps
 * working. The excerpt FORMAT is versioned separately (`fixture-version`), with
 * one reader per version.
 *
 * Libraries are imported by package name only; `node:crypto` does the hashing
 * and Ed25519 verification.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";
import type { CarbonAccounting, RawMetrics, ServiceQuery, SourceAdapter, TargetType } from "sustainability-wellknown-publisher";
import {
  convertCarbon,
  convertEnergy,
  validateDocument,
  verifyEmbeddedSignature,
  type PublicJwk,
} from "sustainability-wellknown-consumer";
import {
  HASH_ALGORITHMS,
  SFC_LEDGER_DESCRIPTORS,
  SFC_LEDGER_PROFILE_1_2,
  SIGNATURE_ALGORITHMS,
  profileFor,
  supportedProfileVersions,
  type SfcLedgerProfile,
} from "./sfc-ledger-profile";

export const SFC_LEDGER_DEMO_DOMAIN = "sfc-ledger-demo.example";

// ---------------------------------------------------------------------------
// The excerpt: the adapter's input format (local to this gateway; the profile
// defines the events, not how a ledger exports them)
// ---------------------------------------------------------------------------

export interface PublicJwkOkp {
  kty: "OKP";
  crv: "Ed25519";
  x: string;
}

export interface RegistryKey {
  "public-jwk": PublicJwkOkp;
  /** RFC 3339 instants: the key verifies events committed in [from, to). `to` null = still valid. */
  "valid-from-commit": string;
  "valid-to-commit": string | null;
}

/** Registry `nodeProfile` (§A.5); members beyond the first two are read by nobody here. */
export interface NodeProfile {
  hardwareClass: string;
  asicForbidden: boolean;
  purchasedAt?: string;
  expectedRetireAt?: string;
  reusePolicy?: string;
}

export interface RegistryEntry {
  /** The operator's DID, as in every event's `subject`. */
  operator: string;
  /** The operator's origin host: the `target` of its operator-level declaration. */
  origin: string;
  /** Full dates, inclusive; `to` null = still active. */
  active: { from: string; to: string | null }[];
  keys: RegistryKey[];
  nodeProfile?: NodeProfile;
}

/** The signed allocation of a retirement to months (§A.1, §A.4; encoding local to this gateway). */
export interface RetirementAllocation {
  type: string;
  operator: string;
  "registry-uri": string;
  "retired-in": string;
  "tonnes-retired": number;
  beneficiary: string;
  parts: { period: string; kg: number }[];
  sig: { alg: string; value: string };
}

export interface AttestationEvent {
  type: string;
  subject: string;
  actor: string;
  prev: string | null;
  ts: string;
  payload: Record<string, unknown>;
  sig: { alg: string; value: string };
}

export interface LedgerEntry {
  /** RFC 3339: when the ledger committed the event. */
  commit: string;
  /** 64 lowercase hex: the hash of the canonical form of `event`, `sig` included. */
  hash: string;
  event: AttestationEvent;
}

export interface Publication {
  "reporting-period": string;
  "period-start": string;
  "period-end": string;
  updated: string;
  target: string;
  "target-type": TargetType;
}

export interface LedgerExcerpt {
  fixture: string;
  "fixture-version": number;
  notice: string;
  "profile-version": string;
  "hash-algorithm": string;
  "event-encoding": string;
  /** The network's `target`. */
  network: string;
  registry: RegistryEntry[];
  retirements: RetirementAllocation[];
  /** In commit order, `commit` strictly increasing. */
  ledger: LedgerEntry[];
  publication: Publication;
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** Every reason the bridge refuses to publish; tests and logs match on the bracketed code. */
export const BRIDGE_CODES = [
  "E-SHAPE", "E-ORDER", "E-PERIOD", "E-HASH", "E-TYPE", "E-ACTOR", "E-OPERATOR", "E-INACTIVE",
  "E-PAYLOAD", "E-NUMBER", "E-TS", "E-KEY", "E-SIG", "E-PREV", "E-FORK", "E-DUPLICATE",
  "E-SUPERSEDES", "E-FLAG", "E-METHOD", "E-NOHEAD", "E-EMPTY", "E-ALLOCATION", "E-DISCLOSURE", "E-CONFIG",
] as const;
export type BridgeCode = (typeof BRIDGE_CODES)[number];

export class BridgeError extends Error {
  constructor(readonly code: BridgeCode, what: string) {
    super(`sfc-ledger-bridge: [${code}] ${what}`);
    this.name = "BridgeError";
  }
}

function refuse(code: BridgeCode, what: string): never {
  throw new BridgeError(code, what);
}

// ---------------------------------------------------------------------------
// Canonical form, hashing, signatures (§A.1)
// ---------------------------------------------------------------------------

/**
 * RFC 8785 (JCS) for the I-JSON values used here: object members sorted by
 * UTF-16 code units, recursively; no whitespace; strings and numbers as
 * ECMAScript `JSON.stringify` writes them. Non-finite numbers have no JSON
 * form and are refused; so is anything that is not JSON (undefined, functions).
 */
export function jcs(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) refuse("E-NUMBER", `${value} has no JSON form`);
      return JSON.stringify(value);
    case "object":
      if (Array.isArray(value)) return "[" + value.map(jcs).join(",") + "]";
      return (
        "{" +
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + jcs((value as Record<string, unknown>)[k]))
          .join(",") +
        "}"
      );
    default:
      refuse("E-SHAPE", `a ${typeof value} is not JSON`);
  }
}

/** The hash of a whole event (`sig` included), as the profile names it. */
export function eventHash(event: unknown, profile: SfcLedgerProfile = SFC_LEDGER_PROFILE_1_2): string {
  return createHash(HASH_ALGORITHMS[profile.hashAlgorithm]).update(jcs(event), "utf8").digest("hex");
}

/** Imported public keys by their `x`, so a key tried many times is imported once (bounded). */
const PUBLIC_KEYS = new Map<string, ReturnType<typeof createPublicKey>>();

/** Ed25519 over the canonical form of the object WITHOUT `sig`; `value` is base64url. */
function signatureVerifies(signed: { sig: { alg: string; value: string } }, jwk: PublicJwkOkp): boolean {
  const { sig, ...unsigned } = signed;
  // base64url without padding, as §A.1 writes it: 64 bytes are exactly 86 characters.
  if (typeof sig.value !== "string" || !/^[A-Za-z0-9_-]{86}$/.test(sig.value)) return false;
  const signature = Buffer.from(sig.value, "base64url");
  try {
    let key = PUBLIC_KEYS.get(jwk.x);
    if (!key) {
      key = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, format: "jwk" });
      if (PUBLIC_KEYS.size >= 256) PUBLIC_KEYS.clear();
      PUBLIC_KEYS.set(jwk.x, key);
    }
    return cryptoVerify(null, Buffer.from(jcs(unsigned), "utf8"), key, signature);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Exact decimal arithmetic over the numbers as their canonical form writes them (§A.9.2)
// ---------------------------------------------------------------------------

/** A decimal: `n / 10^scale`. */
interface Dec {
  n: bigint;
  scale: number;
}

const DEC_ZERO: Dec = { n: 0n, scale: 0 };

function dec(x: number, what: string): Dec {
  if (typeof x !== "number" || !Number.isFinite(x)) refuse("E-NUMBER", `${what} is not a finite number`);
  const text = JSON.stringify(x);
  if (/e/i.test(text)) refuse("E-NUMBER", `${what} (${text}) is written with an exponent; exact arithmetic is not defined for it`);
  const negative = text.startsWith("-");
  const [intPart, frac = ""] = (negative ? text.slice(1) : text).split(".");
  const n = BigInt(intPart + frac);
  return { n: negative ? -n : n, scale: frac.length };
}

/**
 * The exact value of a number as JSON writes it, exponent form included: for
 * figures read from a declaration someone else published, where an exponent is
 * not a defect.
 */
function decOf(x: number): Dec {
  if (typeof x !== "number" || !Number.isFinite(x)) refuse("E-NUMBER", "not a finite number");
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(JSON.stringify(x)) as RegExpExecArray;
  const digits = BigInt(m[2] + (m[3] ?? ""));
  const scale = (m[3] ?? "").length - Number(m[4] ?? 0);
  const n = m[1] ? -digits : digits;
  return scale >= 0 ? { n, scale } : { n: n * 10n ** BigInt(-scale), scale: 0 };
}

/** `d × 10^k`, exactly. */
function shift(d: Dec, k: number): Dec {
  return k >= 0 ? { n: d.n * 10n ** BigInt(k), scale: d.scale } : { n: d.n, scale: d.scale - k };
}

/** Whether |a − b| ≤ tolerance, exactly. */
function within(a: Dec, b: Dec, tolerance: Dec): boolean {
  const diff = decAdd(a, { n: -b.n, scale: b.scale });
  return decCmp({ n: diff.n < 0n ? -diff.n : diff.n, scale: diff.scale }, tolerance) <= 0;
}

/** Powers of ten from draft -07's energy units to kWh, and from its carbon units to kgCO2e. */
const KWH_EXPONENT: Record<string, number> = { Wh: -3, kWh: 0, MWh: 3, GWh: 6 };
const KG_EXPONENT: Record<string, number> = { gCO2e: -3, kgCO2e: 0, mtCO2e: 3 };

function pow10(k: number): bigint {
  return 10n ** BigInt(k);
}

function aligned(a: Dec, b: Dec): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [a.n * pow10(scale - a.scale), b.n * pow10(scale - b.scale), scale];
}

function decAdd(a: Dec, b: Dec): Dec {
  const [x, y, scale] = aligned(a, b);
  return { n: x + y, scale };
}

/** -1, 0 or 1. */
function decCmp(a: Dec, b: Dec): number {
  const [x, y] = aligned(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function decSum(values: Dec[]): Dec {
  return values.reduce(decAdd, DEC_ZERO);
}

/** `a / b` rounded half away from zero to `places` decimals. */
function decDiv(a: Dec, b: Dec, places: number): Dec {
  if (b.n === 0n) refuse("E-NUMBER", "division by zero");
  const num = a.n * pow10(b.scale + places);
  const den = b.n * pow10(a.scale);
  const sign = (num < 0n) !== (den < 0n) ? -1n : 1n;
  const an = num < 0n ? -num : num;
  const ad = den < 0n ? -den : den;
  const q = (2n * an + ad) / (2n * ad);
  return { n: sign * q, scale: places };
}

function decToNumber(d: Dec): number {
  const negative = d.n < 0n;
  const digits = (negative ? -d.n : d.n).toString().padStart(d.scale + 1, "0");
  const int = digits.slice(0, digits.length - d.scale);
  const frac = digits.slice(digits.length - d.scale).replace(/0+$/, "");
  return Number((negative ? "-" : "") + int + (frac ? "." + frac : ""));
}

// ---------------------------------------------------------------------------
// Dates: full dates, months, RFC 3339 instants (no wall clock anywhere)
// ---------------------------------------------------------------------------

const FULL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const YEAR_RE = /^\d{4}$/;
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const HEX64_RE = /^[0-9a-f]{64}$/;

function isFullDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = FULL_DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "YYYY-MM" of a full date. */
function monthOf(date: string): string {
  return date.slice(0, 7);
}

function firstDay(month: string): string {
  return month + "-01";
}

function lastDay(month: string): string {
  const m = MONTH_RE.exec(month) as RegExpExecArray;
  return `${month}-${String(daysInMonth(Number(m[1]), Number(m[2]))).padStart(2, "0")}`;
}

/** The calendar months of [start, end], both full dates, as "YYYY-MM". */
function monthsOf(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = [Number(start.slice(0, 4)), Number(start.slice(5, 7))];
  const last = monthOf(end);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    out.push(key);
    if (key === last || out.length > 12_000) break;
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

function instantMs(s: unknown): number | undefined {
  if (typeof s !== "string" || !INSTANT_RE.test(s) || !isFullDate(s.slice(0, 10))) return undefined;
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? undefined : ms;
}

/** 00:00:00Z on the day after a full date, in ms. */
function dayAfterMs(date: string): number {
  return Date.parse(date + "T00:00:00Z") + 86_400_000;
}

/** Whether an activity interval touches the month. */
function activeIn(active: RegistryEntry["active"], month: string): boolean {
  return active.some((a) => a.from <= lastDay(month) && (a.to === null || a.to >= firstDay(month)));
}

function isHttpsUri(s: unknown): s is string {
  if (typeof s !== "string") return false;
  try {
    return new URL(s).protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Reading an excerpt: the format version decides the reader (P1, E-SHAPE)
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function need<T>(ok: boolean, path: string, what: string, value: T): T {
  if (!ok) refuse("E-SHAPE", `${path}: ${what}`);
  return value;
}

function str(o: Record<string, unknown>, k: string, path: string): string {
  return need(typeof o[k] === "string" && (o[k] as string).length > 0, `${path}.${k}`, "a non-empty string is required", o[k] as string);
}

function arr(o: Record<string, unknown>, k: string, path: string): unknown[] {
  return need(Array.isArray(o[k]), `${path}.${k}`, "an array is required", o[k] as unknown[]);
}

function obj(v: unknown, path: string): Record<string, unknown> {
  return need(isObject(v), path, "an object is required", v as Record<string, unknown>);
}

/** Reader of excerpt format version 1. Unknown members are ignored. */
function readExcerptV1(raw: Record<string, unknown>, profile: SfcLedgerProfile): LedgerExcerpt {
  const p = "excerpt";
  need(raw["hash-algorithm"] === profile.hashAlgorithm, `${p}.hash-algorithm`, `unsupported value ${JSON.stringify(raw["hash-algorithm"])} (profile ${profile.version} uses ${profile.hashAlgorithm})`, 0);
  need(raw["event-encoding"] === profile.eventEncoding, `${p}.event-encoding`, `unsupported value ${JSON.stringify(raw["event-encoding"])}`, 0);

  const registry = arr(raw, "registry", p).map((e, i): RegistryEntry => {
    const r = obj(e, `${p}.registry[${i}]`);
    const rp = `${p}.registry[${i}]`;
    const active = arr(r, "active", rp).map((a, j) => {
      const ao = obj(a, `${rp}.active[${j}]`);
      need(isFullDate(ao.from), `${rp}.active[${j}].from`, "a full date is required", 0);
      need(ao.to === null || isFullDate(ao.to), `${rp}.active[${j}].to`, "a full date or null is required", 0);
      return { from: ao.from as string, to: ao.to as string | null };
    });
    const keys = arr(r, "keys", rp).map((k, j): RegistryKey => {
      const ko = obj(k, `${rp}.keys[${j}]`);
      const jwk = obj(ko["public-jwk"], `${rp}.keys[${j}].public-jwk`);
      need(jwk.kty === "OKP" && jwk.crv === "Ed25519" && typeof jwk.x === "string", `${rp}.keys[${j}].public-jwk`, "an Ed25519 OKP public JWK is required", 0);
      need(instantMs(ko["valid-from-commit"]) !== undefined, `${rp}.keys[${j}].valid-from-commit`, "an RFC 3339 instant is required", 0);
      need(ko["valid-to-commit"] === null || instantMs(ko["valid-to-commit"]) !== undefined, `${rp}.keys[${j}].valid-to-commit`, "an RFC 3339 instant or null is required", 0);
      return {
        "public-jwk": { kty: "OKP", crv: "Ed25519", x: jwk.x as string },
        "valid-from-commit": ko["valid-from-commit"] as string,
        "valid-to-commit": ko["valid-to-commit"] as string | null,
      };
    });
    let nodeProfile: NodeProfile | undefined;
    if (r.nodeProfile !== undefined) {
      const np = obj(r.nodeProfile, `${rp}.nodeProfile`);
      nodeProfile = {
        hardwareClass: str(np, "hardwareClass", `${rp}.nodeProfile`),
        asicForbidden: need(typeof np.asicForbidden === "boolean", `${rp}.nodeProfile.asicForbidden`, "a boolean is required", np.asicForbidden as boolean),
        ...(typeof np.purchasedAt === "string" ? { purchasedAt: np.purchasedAt } : {}),
        ...(typeof np.expectedRetireAt === "string" ? { expectedRetireAt: np.expectedRetireAt } : {}),
        ...(typeof np.reusePolicy === "string" ? { reusePolicy: np.reusePolicy } : {}),
      };
    }
    return { operator: str(r, "operator", rp), origin: str(r, "origin", rp), active, keys, ...(nodeProfile ? { nodeProfile } : {}) };
  });

  const seenOperators = new Set<string>();
  const seenOrigins = new Set<string>();
  for (const r of registry) {
    need(!seenOperators.has(r.operator), `${p}.registry`, `${r.operator} appears twice`, 0);
    need(!seenOrigins.has(r.origin), `${p}.registry`, `origin ${r.origin} belongs to two operators`, 0);
    seenOperators.add(r.operator);
    seenOrigins.add(r.origin);
  }

  const retirements = arr(raw, "retirements", p).map((a, i): RetirementAllocation => {
    const ap = `${p}.retirements[${i}]`;
    const ao = obj(a, ap);
    const sig = obj(ao.sig, `${ap}.sig`);
    need((SIGNATURE_ALGORITHMS as readonly unknown[]).includes(sig.alg) && typeof sig.value === "string", `${ap}.sig`, "an Ed25519 signature is required", 0);
    for (const [j, part] of arr(ao, "parts", ap).entries()) {
      const po = obj(part, `${ap}.parts[${j}]`);
      need(typeof po.period === "string" && MONTH_RE.test(po.period) && isFullDate(firstDay(po.period)), `${ap}.parts[${j}].period`, "a month YYYY-MM is required", 0);
      need(typeof po.kg === "number" && Number.isFinite(po.kg) && po.kg >= 0, `${ap}.parts[${j}].kg`, "a non-negative number is required", 0);
    }
    need(typeof ao["tonnes-retired"] === "number" && Number.isInteger(ao["tonnes-retired"]) && (ao["tonnes-retired"] as number) >= 1, `${ap}.tonnes-retired`, "a whole number of tonnes, at least 1, is required", 0);
    need(typeof ao["retired-in"] === "string" && MONTH_RE.test(ao["retired-in"]), `${ap}.retired-in`, "a month YYYY-MM is required", 0);
    need(isHttpsUri(ao["registry-uri"]), `${ap}.registry-uri`, "an absolute https URI is required", 0);
    str(ao, "type", ap);
    str(ao, "operator", ap);
    str(ao, "beneficiary", ap);
    // The object itself is kept, every member named here or not: the signature covers all of them.
    return ao as unknown as RetirementAllocation;
  });

  const ledger = arr(raw, "ledger", p).map((e, i): LedgerEntry => {
    const lp = `${p}.ledger[${i}]`;
    const lo = obj(e, lp);
    need(instantMs(lo.commit) !== undefined, `${lp}.commit`, "an RFC 3339 instant is required", 0);
    need(typeof lo.hash === "string" && HEX64_RE.test(lo.hash), `${lp}.hash`, "64 lowercase hex characters are required", 0);
    const ev = obj(lo.event, `${lp}.event`);
    const sig = obj(ev.sig, `${lp}.event.sig`);
    need((SIGNATURE_ALGORITHMS as readonly unknown[]).includes(sig.alg) && typeof sig.value === "string", `${lp}.event.sig`, "an Ed25519 signature is required", 0);
    need(ev.prev === null || (typeof ev.prev === "string" && HEX64_RE.test(ev.prev)), `${lp}.event.prev`, "64 lowercase hex characters or null are required", 0);
    need(instantMs(ev.ts) !== undefined, `${lp}.event.ts`, "an RFC 3339 instant is required", 0);
    return {
      commit: lo.commit as string,
      hash: lo.hash as string,
      // The whole event object is kept: every member, named here or not, is under the hash and the signature.
      event: ev as unknown as AttestationEvent,
    };
  });
  for (const [i, e] of ledger.entries()) {
    const ev = e.event as unknown as Record<string, unknown>;
    need(typeof ev.type === "string" && typeof ev.subject === "string" && typeof ev.actor === "string", `${p}.ledger[${i}].event`, "type, subject and actor strings are required", 0);
    need(isObject(ev.payload), `${p}.ledger[${i}].event.payload`, "an object is required", 0);
  }

  const pub = obj(raw.publication, `${p}.publication`);
  need(typeof pub["reporting-period"] === "string" && (MONTH_RE.test(pub["reporting-period"]) || YEAR_RE.test(pub["reporting-period"])), `${p}.publication.reporting-period`, "YYYY-MM or YYYY is required", 0);
  need(isFullDate(pub["period-start"]) && isFullDate(pub["period-end"]), `${p}.publication`, "period-start and period-end must be full dates", 0);
  need(instantMs(pub.updated) !== undefined, `${p}.publication.updated`, "an RFC 3339 instant is required", 0);
  need(pub["target-type"] === "origin" || pub["target-type"] === "service", `${p}.publication.target-type`, `"origin" or "service" is required`, 0);

  return {
    fixture: str(raw, "fixture", p),
    "fixture-version": raw["fixture-version"] as number,
    notice: str(raw, "notice", p),
    "profile-version": raw["profile-version"] as string,
    "hash-algorithm": raw["hash-algorithm"] as string,
    "event-encoding": raw["event-encoding"] as string,
    network: str(raw, "network", p),
    registry,
    retirements,
    ledger,
    publication: {
      "reporting-period": pub["reporting-period"] as string,
      "period-start": pub["period-start"] as string,
      "period-end": pub["period-end"] as string,
      updated: pub.updated as string,
      target: str(pub, "target", `${p}.publication`),
      "target-type": pub["target-type"] as TargetType,
    },
  };
}

/** One reader per excerpt format version. A v2 reader maps a changed shape onto the same `LedgerExcerpt`. */
const EXCERPT_READERS: Record<number, (raw: Record<string, unknown>, profile: SfcLedgerProfile) => LedgerExcerpt> = {
  1: readExcerptV1,
};
export const SUPPORTED_EXCERPT_VERSIONS = Object.keys(EXCERPT_READERS).map(Number);

export interface ReadExcerpt {
  excerpt: LedgerExcerpt;
  profile: SfcLedgerProfile;
}

/**
 * P1: the shape of an excerpt, whatever produced it. Chooses the profile
 * descriptor from `profile-version` and the reader from `fixture-version`;
 * refuses an unsupported version of either with [E-SHAPE] naming the value.
 */
export function readExcerpt(raw: unknown, opts: { bounds?: boolean } = {}): ReadExcerpt {
  const o = obj(raw, "excerpt");
  const profile = profileFor(o["profile-version"]);
  if (!profile) {
    refuse("E-SHAPE", `excerpt.profile-version: unsupported value ${JSON.stringify(o["profile-version"])} (supported: ${supportedProfileVersions().join(", ")})`);
  }
  const fv = o["fixture-version"];
  const reader = typeof fv === "number" ? EXCERPT_READERS[fv] : undefined;
  if (!reader) {
    refuse("E-SHAPE", `excerpt.fixture-version: unsupported value ${JSON.stringify(fv)} (supported: ${SUPPORTED_EXCERPT_VERSIONS.join(", ")})`);
  }
  if (opts.bounds) {
    const n = Array.isArray(o.ledger) ? o.ledger.length : 0;
    const r = Array.isArray(o.registry) ? o.registry.length : 0;
    if (n > profile.bounds.maxLedgerEntries) refuse("E-SHAPE", `excerpt.ledger: ${n} entries exceed the ${profile.bounds.maxLedgerEntries} this check reads`);
    if (r > profile.bounds.maxOperators) refuse("E-SHAPE", `excerpt.registry: ${r} entries exceed the ${profile.bounds.maxOperators} this check reads`);
    const a = Array.isArray(o.retirements) ? o.retirements.length : 0;
    if (a > profile.bounds.maxAllocations) refuse("E-SHAPE", `excerpt.retirements: ${a} entries exceed the ${profile.bounds.maxAllocations} this check reads`);
    for (const [i, e] of (Array.isArray(o.registry) ? o.registry : []).entries()) {
      const k = isObject(e) && Array.isArray(e.keys) ? e.keys.length : 0;
      if (k > profile.bounds.maxKeysPerOperator) refuse("E-SHAPE", `excerpt.registry[${i}].keys: ${k} keys exceed the ${profile.bounds.maxKeysPerOperator} this check reads`);
    }
  }
  return { excerpt: reader(o, profile), profile };
}

// ---------------------------------------------------------------------------
// P3–P4: hashes, signatures and the chain rules (§A.3.1)
// ---------------------------------------------------------------------------

export type EventKind = "energy" | "carbon";

export interface VerifiedEvent {
  entry: LedgerEntry;
  hash: string;
  kind: EventKind;
  operator: string;
  /** "YYYY-MM" of the attested month. */
  month: string;
  periodFrom: string;
  periodTo: string;
  commitMs: number;
  /** Position in commit order. */
  index: number;
  supersedes?: string;
}

export interface VerifiedLedger {
  profile: SfcLedgerProfile;
  excerpt: LedgerExcerpt;
  /** In commit order. */
  events: VerifiedEvent[];
  /** By recomputed hash (equal to the stored one once P3 passed). */
  byHash: Map<string, VerifiedEvent>;
  registry: Map<string, RegistryEntry>;
}

function keysValidAt(entry: RegistryEntry, atMs: number): RegistryKey[] {
  return entry.keys.filter((k) => {
    const from = instantMs(k["valid-from-commit"]) as number;
    const to = k["valid-to-commit"] === null ? undefined : (instantMs(k["valid-to-commit"]) as number);
    return from <= atMs && (to === undefined || atMs < to);
  });
}

function label(ev: { operator: string; kind: EventKind; month: string }, profile: SfcLedgerProfile): string {
  return `${ev.operator}, ${ev.kind === "energy" ? profile.eventTypes.energy : profile.eventTypes.carbon}, ${ev.month}`;
}

/** The payload members of one kind, checked for presence, type and range (E-PAYLOAD, E-NUMBER). */
function checkPayload(payload: Record<string, unknown>, kind: EventKind, who: string, profile: SfcLedgerProfile): { from: string; to: string } {
  const P = profile.payload;
  const fail = (what: string): never => refuse("E-PAYLOAD", `${what} (${who})`);
  const period = payload[P.period];
  if (!isObject(period) || !isFullDate(period.from) || !isFullDate(period.to)) fail(`${P.period} must be { from, to } full dates`);
  const { from, to } = period as { from: string; to: string };
  if (from !== firstDay(monthOf(from)) || to !== lastDay(monthOf(from))) fail(`${P.period} must be one whole calendar month, got ${from} to ${to}`);
  const num = (k: string, nonNegative: boolean): void => {
    const v = payload[k];
    if (typeof v !== "number") fail(`${k} must be a number`);
    dec(v as number, `${k} of ${who}`);
    if (nonNegative && (v as number) < 0) fail(`${k} must not be negative`);
  };
  const string = (k: string): void => {
    if (typeof payload[k] !== "string") fail(`${k} must be a string`);
  };
  if (kind === "energy") {
    const nc = payload[P.nodeCount];
    if (typeof nc !== "number" || !Number.isInteger(nc) || nc < 0) fail(`${P.nodeCount} must be a non-negative integer`);
    num(P.kwh, true);
    string(P.measurementMethod);
    string(P.evidenceCid);
  } else {
    num(P.scope2, false);
    num(P.scope3, false);
    num(P.offsets, true);
    string(P.gridIntensityRef);
    string(P.evidenceCid);
    if (typeof payload[P.coverageFlag] !== "boolean") fail(`${P.coverageFlag} must be a boolean`);
    const m = payload[P.scope2Method];
    if (m !== undefined && !profile.scope2Methods.includes(m as string)) fail(`${P.scope2Method} must be one of ${profile.scope2Methods.join(", ")}`);
  }
  const sup = payload[P.supersedes];
  if (sup !== undefined && (typeof sup !== "string" || !HEX64_RE.test(sup))) fail(`${P.supersedes} must be 64 lowercase hex characters`);
  return { from, to };
}

/**
 * P3–P4: recompute every hash, then walk the ledger in commit order enforcing
 * the seven rules of §A.3.1 and the key-at-commit rule of §A.1. Takes an
 * excerpt `readExcerpt` has read (P1). Throws the first refusal; an excerpt
 * that returns is internally consistent.
 */
export function verifyLedger(input: ReadExcerpt): VerifiedLedger {
  const { excerpt, profile } = input;
  const registry = new Map<string, RegistryEntry>();
  for (const r of excerpt.registry) registry.set(r.operator, r);

  // P3 before the walk, so the index below is built from hashes that recompute.
  for (const [i, e] of excerpt.ledger.entries()) {
    const h = eventHash(e.event, profile);
    if (h !== e.hash) refuse("E-HASH", `ledger[${i}]: stored hash ${e.hash.slice(0, 12)}… does not recompute (${h.slice(0, 12)}…)`);
  }

  const events: VerifiedEvent[] = [];
  const byHash = new Map<string, VerifiedEvent>();
  const heads = new Map<string, VerifiedEvent>(); // operator|kind -> head
  const byMonth = new Map<string, VerifiedEvent>(); // operator|kind|month -> latest
  const usedPrev = new Set<string>();
  let lastCommit = -Infinity;

  for (const [index, entry] of excerpt.ledger.entries()) {
    const ev = entry.event;
    const commitMs = instantMs(entry.commit) as number;
    if (!(commitMs > lastCommit)) refuse("E-ORDER", `ledger[${index}]: commit ${entry.commit} is not after the previous entry`);
    lastCommit = commitMs;

    const kind: EventKind | undefined =
      ev.type === profile.eventTypes.energy ? "energy" : ev.type === profile.eventTypes.carbon ? "carbon" : undefined;
    if (!kind) refuse("E-TYPE", `ledger[${index}]: type ${JSON.stringify(ev.type)} is neither ${profile.eventTypes.energy} nor ${profile.eventTypes.carbon}`);
    if (ev.subject !== ev.actor) refuse("E-ACTOR", `ledger[${index}]: subject ${ev.subject} differs from actor ${ev.actor}`);
    const operator = registry.get(ev.subject);
    if (!operator) refuse("E-OPERATOR", `ledger[${index}]: ${ev.subject} is not in the Registry`);

    const who = `${ev.subject}, ${ev.type}, entry ${index}`;
    const { from, to } = checkPayload(ev.payload, kind, who, profile);
    const month = monthOf(from);
    const me = { operator: ev.subject, kind, month };
    const tsMs = instantMs(ev.ts) as number;
    if (tsMs < dayAfterMs(to)) refuse("E-TS", `ts ${ev.ts} is before the day after the attested month ended (${label(me, profile)})`);

    if (!activeIn(operator.active, month)) refuse("E-INACTIVE", `an attestation for a month in which ${ev.subject} was not active (${label(me, profile)})`);
    const keys = keysValidAt(operator, commitMs);
    if (keys.length === 0) refuse("E-KEY", `no Registry key of ${ev.subject} is valid at commit ${entry.commit} (${label(me, profile)})`);
    if (!keys.some((k) => signatureVerifies(ev, k["public-jwk"]))) refuse("E-SIG", `signature does not verify under any key valid at commit (${label(me, profile)})`);

    const chain = `${ev.subject}|${kind}`;
    const head = heads.get(chain);
    if (ev.prev !== null && usedPrev.has(ev.prev)) refuse("E-FORK", `two events share prev ${ev.prev.slice(0, 12)}… (${label(me, profile)})`);
    if ((ev.prev ?? null) !== (head?.hash ?? null)) {
      refuse("E-PREV", head ? `prev ${ev.prev === null ? "null" : ev.prev.slice(0, 12) + "…"} is not the head ${head.hash.slice(0, 12)}… of the chain (${label(me, profile)})` : `first event of its chain carries a prev (${label(me, profile)})`);
    }

    const supersedes = ev.payload[profile.payload.supersedes] as string | undefined;
    const monthKey = `${chain}|${month}`;
    const earlier = byMonth.get(monthKey);
    if (supersedes !== undefined) {
      const target = byHash.get(supersedes);
      if (!target || target.operator !== ev.subject || target.kind !== kind || target.month !== month) {
        refuse("E-SUPERSEDES", `${profile.payload.supersedes} names no earlier attestation of the same operator, type and month (${label(me, profile)})`);
      }
    } else if (earlier) {
      refuse("E-DUPLICATE", `a second attestation of the month without ${profile.payload.supersedes} (${label(me, profile)})`);
    }

    const verified: VerifiedEvent = {
      entry,
      hash: entry.hash,
      kind,
      operator: ev.subject,
      month,
      periodFrom: from,
      periodTo: to,
      commitMs,
      index,
      ...(supersedes !== undefined ? { supersedes } : {}),
    };
    events.push(verified);
    byHash.set(entry.hash, verified);
    heads.set(chain, verified);
    byMonth.set(monthKey, verified);
    if (ev.prev !== null) usedPrev.add(ev.prev);
  }
  return { profile, excerpt, events, byHash, registry };
}

// ---------------------------------------------------------------------------
// P5–P10: from a verified ledger to one declaration
// ---------------------------------------------------------------------------

export type BridgeMode = "operator" | "network";

export interface BridgeOptions {
  mode: BridgeMode;
  provider: string;
  methodologyUri: string;
  /** Absolute https URI where the excerpt can be read (`ledger-access-uri`). */
  ledgerAccessUri: string;
  /** Absolute https URI of the disclosure index; required in network mode (C-SFC-5). */
  disclosureUri?: string;
  /**
   * The Scope 2 method "stated in the methodology document" (§A.3.3), applied to
   * an effective CarbonAttested that carries no `scope2Method` (a v1.1 event).
   */
  scope2MethodDefault?: CarbonAccounting;
}

/** One `operators[]` entry of `ledger-evidence`, with its exact sums. */
export interface OperatorEntry {
  operator: string;
  energyHead: string;
  carbonHead: string;
  energyEvents: number;
  carbonEvents: number;
  kwh: Dec;
  scope2: Dec;
  scope3: Dec;
  offsets: Dec;
  offsetCoverageEveryPeriod: boolean;
  silentEnergy: boolean;
  silentCarbon: boolean;
  /** The resolved Scope 2 methods of the effective CarbonAttesteds. */
  scope2Methods: Set<string>;
  measurementMethods: Set<string>;
  contributingAllocations: RetirementAllocation[];
  hardwareOk: boolean;
}

export interface BridgeResult {
  profile: SfcLedgerProfile;
  mode: BridgeMode;
  periodStart: string;
  periodEnd: string;
  months: string[];
  entries: OperatorEntry[];
  /** Σ over entries. */
  totals: { kwh: Dec; scope2: Dec; scope3: Dec; offsets: Dec };
  networkOffsetCoverage?: boolean;
  netZeroStatus: string;
  raw: RawMetrics;
}

/** P2: the publication describes one whole month (operator) or one whole year (network). */
function checkPeriod(pub: Publication, mode: BridgeMode): { start: string; end: string } {
  const rp = pub["reporting-period"];
  if (mode === "operator") {
    if (!MONTH_RE.test(rp) || !isFullDate(firstDay(rp))) refuse("E-PERIOD", `operator mode needs a reporting-period YYYY-MM, got ${rp}`);
    if (pub["period-start"] !== firstDay(rp) || pub["period-end"] !== lastDay(rp)) refuse("E-PERIOD", `period-start/period-end must be the first and last day of ${rp}`);
    if (pub["target-type"] !== "origin") refuse("E-PERIOD", `operator mode needs target-type "origin", got ${pub["target-type"]}`);
  } else {
    if (!YEAR_RE.test(rp)) refuse("E-PERIOD", `network mode needs a reporting-period YYYY, got ${rp}`);
    if (pub["period-start"] !== `${rp}-01-01` || pub["period-end"] !== `${rp}-12-31`) refuse("E-PERIOD", `period-start/period-end must be the first and last day of ${rp}`);
    if (pub["target-type"] !== "service") refuse("E-PERIOD", `network mode needs target-type "service", got ${pub["target-type"]}`);
  }
  return { start: pub["period-start"], end: pub["period-end"] };
}

/** P5: the operators the declaration counts. */
function countedOperators(v: VerifiedLedger, mode: BridgeMode, months: string[]): RegistryEntry[] {
  if (mode === "operator") {
    const target = v.excerpt.publication.target;
    const entry = v.excerpt.registry.find((r) => r.origin === target);
    if (!entry) refuse("E-OPERATOR", `no Registry entry has origin ${target}`);
    if (!months.some((m) => activeIn(entry.active, m))) refuse("E-INACTIVE", `${entry.operator} is not active in ${v.excerpt.publication["reporting-period"]}`);
    return [entry];
  }
  return v.excerpt.registry.filter((r) => months.some((m) => activeIn(r.active, m))).sort((a, b) => (a.operator < b.operator ? -1 : 1));
}

/** P7b: the allocations that contribute to the period, each checked (E-ALLOCATION). */
function checkAllocations(v: VerifiedLedger, operator: RegistryEntry, months: string[], effectiveCarbon: Map<string, VerifiedEvent>): RetirementAllocation[] {
  const P = v.profile.payload;
  const contributing = v.excerpt.retirements.filter((a) => a.operator === operator.operator && a.parts.some((p) => months.includes(p.period)));
  const partsByMonth = new Map<string, Dec>();
  for (const a of contributing) {
    const who = `${a["registry-uri"]} (${operator.operator})`;
    if (a.type !== v.profile.allocationType) refuse("E-ALLOCATION", `type ${JSON.stringify(a.type)} is not ${v.profile.allocationType}: ${who}`);
    if (a.beneficiary !== operator.operator) refuse("E-ALLOCATION", `beneficiary ${a.beneficiary} is not the operator: ${who}`);
    // An allocation carries no commit time, so the key rule of §A.1 cannot select one key: any
    // key the Registry holds for the operator may have signed it.
    if (!operator.keys.some((k) => signatureVerifies(a, k["public-jwk"]))) refuse("E-ALLOCATION", `signature verifies under no Registry key of the operator: ${who}`);
    const total = decSum(a.parts.map((p) => dec(p.kg, `part ${p.period} of ${who}`)));
    if (decCmp(total, dec(a["tonnes-retired"] * 1000, "tonnes")) > 0) refuse("E-ALLOCATION", `parts allocate ${decToNumber(total)} kg, more than the ${a["tonnes-retired"] * 1000} kg retired: ${who}`);
    for (const p of a.parts) {
      if (months.includes(p.period)) partsByMonth.set(p.period, decAdd(partsByMonth.get(p.period) ?? DEC_ZERO, dec(p.kg, `part ${p.period}`)));
    }
  }
  // Each attested month's credits must be exactly what the allocations give that month; a
  // silent month has nothing to compare.
  for (const m of months) {
    const c = effectiveCarbon.get(m);
    if (!c) continue;
    const declared = dec(c.entry.event.payload[P.offsets] as number, P.offsets);
    const allocated = partsByMonth.get(m);
    if (!allocated) {
      if (decCmp(declared, DEC_ZERO) !== 0) refuse("E-ALLOCATION", `${m}: ${P.offsets} is ${decToNumber(declared)} kg but no allocation gives that month a part (${operator.operator})`);
      continue;
    }
    if (decCmp(declared, allocated) !== 0) refuse("E-ALLOCATION", `${m}: ${P.offsets} ${decToNumber(declared)} kg differs from the allocated ${decToNumber(allocated)} kg (${operator.operator})`);
  }
  return contributing;
}

/** P6–P8 for one counted operator. */
function operatorEntry(v: VerifiedLedger, op: RegistryEntry, months: string[], start: string, end: string, opts: BridgeOptions): OperatorEntry {
  const P = v.profile.payload;
  const mine = v.events.filter((e) => e.operator === op.operator);
  const activeMonths = months.filter((m) => activeIn(op.active, m));

  // Heads (§A.9.2): the latest attestation of each kind, in chain order, whose period ends on or before period-end.
  const headOf = (kind: EventKind): string => {
    const h = mine.filter((e) => e.kind === kind && e.periodTo <= end).at(-1);
    if (!h) refuse("E-NOHEAD", `${op.operator} has no ${kind === "energy" ? v.profile.eventTypes.energy : v.profile.eventTypes.carbon} up to ${end}`);
    return h.hash;
  };
  const inPeriod = (e: VerifiedEvent): boolean => e.periodFrom >= start && e.periodTo <= end;
  const count = (kind: EventKind): number => mine.filter((e) => e.kind === kind && inPeriod(e)).length;

  // Effective attestation of each (kind, month): the latest in chain order (a later one must supersede).
  const effective = (kind: EventKind): Map<string, VerifiedEvent> => {
    const m = new Map<string, VerifiedEvent>();
    for (const e of mine) if (e.kind === kind && months.includes(e.month)) m.set(e.month, e);
    return m;
  };
  const energy = effective("energy");
  const carbon = effective("carbon");
  const silentEnergy = activeMonths.some((m) => !energy.has(m));
  const silentCarbon = activeMonths.some((m) => !carbon.has(m));

  // P7: the flag of every effective CarbonAttested must equal the recomputed comparison.
  let coverage = !silentCarbon;
  const scope2Methods = new Set<string>();
  const kwh: Dec[] = [];
  const s2: Dec[] = [];
  const s3: Dec[] = [];
  const off: Dec[] = [];
  for (const e of energy.values()) kwh.push(dec(e.entry.event.payload[P.kwh] as number, P.kwh));
  for (const [month, e] of carbon) {
    const pl = e.entry.event.payload;
    const a = dec(pl[P.scope2] as number, P.scope2);
    const b = dec(pl[P.scope3] as number, P.scope3);
    const r = dec(pl[P.offsets] as number, P.offsets);
    const covered = decCmp(decAdd(a, b), r) <= 0;
    if ((pl[P.coverageFlag] as boolean) !== covered) {
      refuse("E-FLAG", `${P.coverageFlag} is ${String(pl[P.coverageFlag])} but ${decToNumber(a)} + ${decToNumber(b)} ${covered ? "<=" : ">"} ${decToNumber(r)} (${op.operator}, ${month})`);
    }
    if (!covered) coverage = false;
    s2.push(a);
    s3.push(b);
    off.push(r);
    const method = (pl[P.scope2Method] as string | undefined) ?? opts.scope2MethodDefault;
    if (method === undefined) refuse("E-METHOD", `${P.scope2Method} is absent and no default is configured for the method stated in the methodology document (${op.operator}, ${month})`);
    scope2Methods.add(method);
  }
  const measurementMethods = new Set<string>([...energy.values()].map((e) => e.entry.event.payload[P.measurementMethod] as string));

  const contributingAllocations = checkAllocations(v, op, months, carbon);
  const np = op.nodeProfile;
  const hardwareOk = !!np && np.asicForbidden === true && v.profile.hardware.allowedClasses.includes(np.hardwareClass);

  return {
    operator: op.operator,
    energyHead: headOf("energy"),
    carbonHead: headOf("carbon"),
    energyEvents: count("energy"),
    carbonEvents: count("carbon"),
    kwh: decSum(kwh),
    scope2: decSum(s2),
    scope3: decSum(s3),
    offsets: decSum(off),
    offsetCoverageEveryPeriod: coverage,
    silentEnergy,
    silentCarbon,
    scope2Methods,
    measurementMethods,
    contributingAllocations,
    hardwareOk,
  };
}

/** `net-zero-status` precedence (§A.8): achieved, else not-achieved when nothing was retired, else partial. */
function netZeroStatus(entries: { offsetCoverageEveryPeriod: boolean; offsets: Dec }[], profile: SfcLedgerProfile): string {
  const T = profile.neutrality.tokens;
  if (entries.length > 0 && entries.every((e) => e.offsetCoverageEveryPeriod)) return T.achieved;
  if (decCmp(decSum(entries.map((e) => e.offsets)), DEC_ZERO) === 0) return T.notAchieved;
  return T.partial;
}

/**
 * P2, P5–P10: one declaration (as `RawMetrics` for the publisher library) from a
 * verified ledger. Throws a `BridgeError` on any refusal.
 */
export function bridge(v: VerifiedLedger, opts: BridgeOptions): BridgeResult {
  const profile = v.profile;
  const pub = v.excerpt.publication;
  const { start, end } = checkPeriod(pub, opts.mode);
  const months = monthsOf(start, end);
  const operators = countedOperators(v, opts.mode, months);
  const entries = operators.map((op) => operatorEntry(v, op, months, start, end, opts));

  const totals = {
    kwh: decSum(entries.map((e) => e.kwh)),
    scope2: decSum(entries.map((e) => e.scope2)),
    scope3: decSum(entries.map((e) => e.scope3)),
    offsets: decSum(entries.map((e) => e.offsets)),
  };
  const anySilentEnergy = entries.some((e) => e.silentEnergy);
  const anySilentCarbon = entries.some((e) => e.silentCarbon);
  // Every counted operator is active in at least one month, so an entry without a silent month has
  // an effective attestation of each kind; the period's figure is stated only when none is silent.
  const haveEnergy = entries.length > 0 && !anySilentEnergy;
  const haveCarbon = entries.length > 0 && !anySilentCarbon;

  // `carbon-accounting`: the one resolved Scope 2 method of every effective CarbonAttested.
  let accounting: CarbonAccounting | undefined;
  if (haveCarbon) {
    const methods = new Set(entries.flatMap((e) => [...e.scope2Methods]));
    if (methods.size !== 1) refuse("E-METHOD", `the effective ${profile.eventTypes.carbon} events use different Scope 2 methods: ${[...methods].sort().join(", ")}`);
    accounting = [...methods][0] as CarbonAccounting;
  }

  // `measurement-method`: the operators' token when they agree; a description otherwise.
  const methods = [...new Set(entries.flatMap((e) => [...e.measurementMethods]))].sort();
  const measurementMethod =
    methods.length === 1 ? methods[0] : methods.length > 1 ? `mixed (per operator; see methodology-uri): ${methods.join(", ")}` : "not stated (no energy attestation in the period; see methodology-uri)";

  if (!haveEnergy && !haveCarbon) refuse("E-EMPTY", "no energy and no carbon figure can be published for the period (every month is silent)");
  if (opts.mode === "network" && !opts.disclosureUri) refuse("E-DISCLOSURE", "a network declaration must carry disclosure-uri (C-SFC-5); configure disclosureUri");

  const networkOffsetCoverage = opts.mode === "network" ? decCmp(decAdd(totals.scope2, totals.scope3), totals.offsets) <= 0 : undefined;
  const status = netZeroStatus(entries, profile);

  // ---- Extensions (§4.5 of the bridge rules; names from the descriptor) ----
  const X = profile.extensions;
  const extensions: Record<string, Record<string, unknown>> = {};
  if (entries.every((e) => e.hardwareOk)) {
    extensions[X.hardwareLifecycle] = { [profile.hardware.generalPurpose]: true, [profile.hardware.singleUseAsicRequired]: false };
  }
  const allocations = entries.flatMap((e) => e.contributingAllocations);
  const neutrality: Record<string, unknown> = {
    [profile.neutrality.status]: status,
    // Exact: kilograms over a thousand need three more places than the kilograms carry.
    [profile.neutrality.offsetsRetiredT]: decToNumber(shift(totals.offsets, -3)),
  };
  if (allocations.length === 1) neutrality[profile.neutrality.registryUri] = allocations[0]["registry-uri"];
  extensions[X.carbonNeutrality] = neutrality;
  if (opts.mode === "operator") {
    extensions[X.networkTopology] = { [profile.topology.memberOfNetwork]: v.excerpt.network };
  }
  const E = profile.evidence;
  const O = profile.operatorEntry;
  const evidence: Record<string, unknown> = {
    // The version the excerpt was written under (one of the descriptor's supportedVersions).
    [E.profileVersion]: v.excerpt["profile-version"],
    [E.ledgerAccessUri]: opts.ledgerAccessUri,
    [E.hashAlgorithm]: profile.hashAlgorithm,
    [E.eventEncoding]: profile.eventEncoding,
    [E.periodStart]: start,
    [E.periodEnd]: end,
    [E.operators]: entries.map((e) => ({
      [O.operator]: e.operator,
      [O.energyHead]: e.energyHead,
      [O.carbonHead]: e.carbonHead,
      [O.energyEvents]: e.energyEvents,
      [O.carbonEvents]: e.carbonEvents,
      [O.kwh]: decToNumber(e.kwh),
      [O.scope2]: decToNumber(e.scope2),
      [O.scope3]: decToNumber(e.scope3),
      [O.offsets]: decToNumber(e.offsets),
      [O.offsetCoverageEveryPeriod]: e.offsetCoverageEveryPeriod,
    })),
  };
  if (networkOffsetCoverage !== undefined) evidence[E.networkOffsetCoverage] = networkOffsetCoverage;
  extensions[X.ledgerEvidence] = evidence;

  // ---- Top-level members (§A.8). A figure the period cannot state is omitted. ----
  const raw: RawMetrics = {
    provider: opts.provider,
    measurementMethod,
    methodologyUri: opts.methodologyUri,
    reportingPeriod: pub["reporting-period"],
    capabilities: "basic",
    updated: pub.updated,
    target: pub.target,
    targetType: pub["target-type"],
    extensions,
    ...(opts.disclosureUri ? { disclosureUri: opts.disclosureUri } : {}),
  };
  if (haveEnergy) raw.energy = { value: decToNumber(totals.kwh), unit: "kWh" };
  if (haveCarbon && accounting) {
    const gross = decAdd(totals.scope2, totals.scope3);
    if (decCmp(gross, DEC_ZERO) < 0) refuse("E-PAYLOAD", `the period's gross emissions (scope 2 + scope 3) are negative (${decToNumber(gross)} kgCO2e); carbon-footprint must not be`);
    raw.carbon = { value: decToNumber(decAdd(totals.scope2, totals.scope3)), unit: "kgCO2e" };
    raw.scope2 = decToNumber(totals.scope2);
    raw.scope3 = decToNumber(totals.scope3);
    raw.carbonAccounting = accounting;
    // The energy-weighted intensity of the period is exact only when every counted month of both
    // kinds is attested and Scope 2 is location-based.
    if (haveEnergy && accounting === "location-based" && decCmp(totals.kwh, DEC_ZERO) > 0 && decCmp(totals.scope2, DEC_ZERO) >= 0) {
      raw.carbonIntensity = decToNumber(decDiv({ n: totals.scope2.n * 1000n, scale: totals.scope2.scale }, totals.kwh, profile.derivedPlaces));
    }
  }
  return { profile, mode: opts.mode, periodStart: start, periodEnd: end, months, entries, totals, networkOffsetCoverage, netZeroStatus: status, raw };
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export interface SfcLedgerBridgeConfig extends BridgeOptions {
  /** The recorded excerpt, exactly as it is also served at `ledgerAccessUri`. */
  excerpt: unknown;
}

/**
 * The gateway's `SourceAdapter` for the bridge: `fetch()` verifies the excerpt
 * and builds the declaration; the publisher library then normalises, validates
 * and (when configured) signs it. Configuration errors are refused here, at
 * construction, with [E-CONFIG].
 */
export function sfcLedgerBridgeAdapter(config: SfcLedgerBridgeConfig): SourceAdapter {
  if (config.mode !== "operator" && config.mode !== "network") refuse("E-CONFIG", `mode must be "operator" or "network"`);
  if (!isHttpsUri(config.ledgerAccessUri)) refuse("E-CONFIG", `ledgerAccessUri must be an absolute https URI (got ${JSON.stringify(config.ledgerAccessUri)})`);
  if (config.disclosureUri !== undefined && !isHttpsUri(config.disclosureUri)) refuse("E-CONFIG", "disclosureUri must be an absolute https URI");
  if (config.mode === "network" && !config.disclosureUri) refuse("E-DISCLOSURE", "a network declaration must carry disclosure-uri (C-SFC-5); configure disclosureUri");
  const { excerpt: _excerpt, ...opts } = config;
  return {
    name: "sfc-ledger-bridge",
    capabilities: "basic",
    async fetch(_query: ServiceQuery): Promise<RawMetrics> {
      return bridge(verifyLedger(readExcerpt(config.excerpt)), opts).raw;
    },
  };
}

// ---------------------------------------------------------------------------
// The consuming direction: two checks, rows never exceptions
// ---------------------------------------------------------------------------

export type CheckStatus = "PASS" | "FAIL" | "REFUSED" | "SKIPPED" | "INFO";
export interface CheckRow {
  id: string;
  status: CheckStatus;
  detail: string;
}
export interface CheckReport {
  depth: "shallow" | "deep";
  /** No FAIL row. */
  ok: boolean;
  rows: CheckRow[];
}

type Doc = Record<string, unknown>;

/**
 * The declaration's `ledger-evidence` value and the descriptor that reads it:
 * the one whose extension name the declaration carries AND whose
 * `supportedVersions` lists the value's `profile-version`; failing that, the
 * first descriptor whose name is carried, so the shape row can say which
 * version it does not read.
 */
function evidenceOf(doc: Doc): { profile: SfcLedgerProfile; value: Doc } | undefined {
  const ext = doc.extensions;
  if (!isObject(ext)) return undefined;
  let carried: { profile: SfcLedgerProfile; value: Doc } | undefined;
  for (const profile of SFC_LEDGER_DESCRIPTORS) {
    const v = ext[profile.extensions.ledgerEvidence];
    if (!isObject(v)) continue;
    if (profile.supportedVersions.includes(v[profile.evidence.profileVersion] as string)) return { profile, value: v };
    carried ??= { profile, value: v };
  }
  return carried;
}

/** S5a: the shape of the extension value. Returns the first defect, or undefined. */
function evidenceShapeDefect(doc: Doc, profile: SfcLedgerProfile, le: Doc): string | undefined {
  const E = profile.evidence;
  const O = profile.operatorEntry;
  const version = le[E.profileVersion];
  if (!profile.supportedVersions.includes(version as string)) return `${E.profileVersion} ${JSON.stringify(version)} is not one this check reads (${profile.supportedVersions.join(", ")})`;
  if (!isHttpsUri(le[E.ledgerAccessUri])) return `${E.ledgerAccessUri} must be an absolute https URI`;
  if (le[E.hashAlgorithm] !== profile.hashAlgorithm) return `${E.hashAlgorithm} must be ${profile.hashAlgorithm}`;
  if (le[E.eventEncoding] !== profile.eventEncoding) return `${E.eventEncoding} must be ${profile.eventEncoding}`;
  const start = le[E.periodStart];
  const end = le[E.periodEnd];
  if (!isFullDate(start) || !isFullDate(end) || start > end) return `${E.periodStart} and ${E.periodEnd} must be full dates in order`;
  const rp = doc["reporting-period"];
  if (typeof rp !== "string" || !start.startsWith(rp) || !end.startsWith(rp)) return `${E.periodStart} and ${E.periodEnd} must lie inside reporting-period ${JSON.stringify(rp)}`;
  const ops = le[E.operators];
  if (!Array.isArray(ops) || ops.length === 0) return `${E.operators} must be a non-empty array`;
  if (doc["target-type"] === "origin" && ops.length !== 1) return `an operator declaration carries exactly one ${E.operators} entry, got ${ops.length}`;
  if (ops.length > profile.bounds.maxOperators) return `${E.operators} has ${ops.length} entries, more than the ${profile.bounds.maxOperators} this check reads`;
  const names = ops.map((o) => (isObject(o) ? o[O.operator] : undefined));
  if (new Set(names).size !== names.length) return `${E.operators} names an operator twice`;
  for (const [i, o] of ops.entries()) {
    if (!isObject(o)) return `${E.operators}[${i}] must be an object`;
    if (typeof o[O.operator] !== "string") return `${E.operators}[${i}].${O.operator} must be a string`;
    for (const k of [O.energyHead, O.carbonHead]) if (typeof o[k] !== "string" || !HEX64_RE.test(o[k] as string)) return `${E.operators}[${i}].${k} must be 64 lowercase hex characters`;
    for (const k of [O.energyEvents, O.carbonEvents]) if (!Number.isInteger(o[k]) || (o[k] as number) < 0) return `${E.operators}[${i}].${k} must be a non-negative integer`;
    for (const k of [O.kwh, O.scope2, O.scope3, O.offsets]) if (typeof o[k] !== "number" || !Number.isFinite(o[k] as number)) return `${E.operators}[${i}].${k} must be a number`;
    if (typeof o[O.offsetCoverageEveryPeriod] !== "boolean") return `${E.operators}[${i}].${O.offsetCoverageEveryPeriod} must be a boolean`;
  }
  if (doc["target-type"] === "service" && typeof le[E.networkOffsetCoverage] !== "boolean") return `${E.networkOffsetCoverage} must be a boolean at network level`;
  return undefined;
}

/** Σ of one member over the entries, exact. */
function sumMember(ops: Doc[], k: string): Dec {
  return decSum(ops.map((o) => decOf(o[k] as number)));
}

/**
 * Whether an exact profile-unit sum agrees with a declared figure in another
 * unit, allowing the publisher's rounding of the declared figure (at most
 * `tolerance` in the declared unit). Exact decimal arithmetic throughout.
 */
function agreesInUnit(sum: Dec, declared: number, exponent: number, tolerance: number): boolean {
  return within(sum, shift(decOf(declared), exponent), shift(decOf(tolerance), exponent));
}

export interface ShallowOptions {
  /** Public JWKs the signature must verify under (pinned out of band). */
  trustedKeys: object[];
  /**
   * When the caller fetched the document: where from and the media type it was
   * served as (row S1). `httpAllowed` records that the caller chose to accept
   * plain http (a local instance); the row then says so instead of failing.
   */
  fetched?: { url: string; contentType: string | null; httpAllowed?: boolean };
}

/** The `ledger-access-uri` a declaration names, under any extension name this gateway reads. */
export function ledgerAccessUriOf(doc: unknown): string | undefined {
  if (!isObject(doc)) return undefined;
  const ev = evidenceOf(doc);
  const uri = ev?.value[ev.profile.evidence.ledgerAccessUri];
  return typeof uri === "string" ? uri : undefined;
}

/**
 * The shallow check (§A.9.3): HTTPS only. In-process it takes the document a
 * caller already fetched, so S1 is SKIPPED. Never throws.
 */
export async function shallowCheck(doc: unknown, opts: ShallowOptions): Promise<CheckReport> {
  const rows: CheckRow[] = [];
  const row = (id: string, status: CheckStatus, detail: string): void => {
    rows.push({ id, status, detail });
  };
  try {
    if (opts.fetched) {
      const ct = (opts.fetched.contentType ?? "").split(";")[0].trim().toLowerCase();
      const https = opts.fetched.url.startsWith("https:");
      const transportOk = https || opts.fetched.httpAllowed === true;
      const typeOk = ct === "application/sustainability-data+json";
      const how = https ? "" : opts.fetched.httpAllowed ? " over plain http (allowed by the caller for a local instance)" : " over plain http";
      row("S1 fetch", transportOk && typeOk ? "PASS" : "FAIL", `${opts.fetched.url} answered ${ct || "no media type"}${how}`);
    } else {
      row("S1 fetch", "SKIPPED", "the document was supplied by the caller; a reader fetches it over HTTPS and requires application/sustainability-data+json");
    }
    const v = validateDocument(doc);
    if (!v.valid) {
      row("S2 draft-conformance", "FAIL", `not a draft -07 declaration: ${(v.errors ?? []).join("; ") || "not a JSON object"}`);
      return { depth: "shallow", ok: false, rows };
    }
    row("S2 draft-conformance", "PASS", "valid against draft -07 (consumer library)");
    const d = doc as Doc;

    const sig = await verifyEmbeddedSignature(doc, { trustedKeys: opts.trustedKeys as PublicJwk[] });
    if (sig.result.status === "unsigned") {
      row("S3 signature", "FAIL", "no usable signed member; the ledger profile requires one");
    } else if (sig.result.status !== "verified") {
      row("S3 signature", "FAIL", `signed does not verify with the pinned key: ${sig.result.reason}`);
    } else if ((sig.differences ?? []).length > 0) {
      row("S3 signature", "FAIL", `signature verified with the pinned key, but the served members ${sig.differences!.join(", ")} differ from the signed payload, so the served figures are not the signed ones`);
    } else {
      row("S3 signature", "PASS", `signed verified with the pinned key (${sig.result.alg}); precedence ${sig.result.precedence}; no member differs from the signed payload`);
    }

    const annualNetwork = typeof d["reporting-period"] === "string" && YEAR_RE.test(d["reporting-period"]) && d["target-type"] === "service";
    if (!annualNetwork) {
      row("S4a C-SFC-2-disclosure", "REFUSED", "C1 applies only to a network's whole year; this is an operator or sub-annual declaration");
      row("S4b C-SFC-5", "REFUSED", "applies at network level only");
    } else {
      const e = d["energy-consumption"];
      if (typeof e !== "number") row("S4a C-SFC-2-disclosure", "FAIL", "no energy-consumption at network level");
      else {
        const gwh = convertEnergy(e, (d["energy-unit"] as "kWh" | undefined) ?? "kWh", "GWh");
        row("S4a C-SFC-2-disclosure", gwh < 1 ? "PASS" : "FAIL", `${e} ${d["energy-unit"] ?? "kWh"} = ${gwh} GWh, ${gwh < 1 ? "below" : "at or above"} the 1 GWh cap`);
      }
      row("S4b C-SFC-5", typeof d["disclosure-uri"] === "string" ? "PASS" : "FAIL", typeof d["disclosure-uri"] === "string" ? "disclosure-uri present" : "disclosure-uri absent at network level");
    }

    const ev = evidenceOf(d);
    if (!ev) {
      row("S5a ledger-evidence-shape", "FAIL", "the declaration carries no ledger-evidence extension this check reads");
      return { depth: "shallow", ok: false, rows };
    }
    const { profile, value: le } = ev;
    const defect = evidenceShapeDefect(d, profile, le);
    if (defect) {
      row("S5a ledger-evidence-shape", "FAIL", defect);
      return { depth: "shallow", ok: false, rows };
    }
    row("S5a ledger-evidence-shape", "PASS", `every member present and well formed (profile ${le[profile.evidence.profileVersion]})`);
    const O = profile.operatorEntry;
    const ops = le[profile.evidence.operators] as Doc[];
    const tol = profile.tolerances.figure;

    // S5b: energy. The draft's default unit applies when the member is absent.
    if (typeof d["energy-consumption"] !== "number") {
      row("S5b coherence-energy", "SKIPPED", "no energy-consumption in the declaration");
    } else {
      const unit = (d["energy-unit"] as string | undefined) ?? "kWh";
      const sum = sumMember(ops, O.kwh);
      row("S5b coherence-energy", agreesInUnit(sum, d["energy-consumption"], KWH_EXPONENT[unit], tol) ? "PASS" : "FAIL", `Σ ${O.kwh} ${decToNumber(sum)} kWh against energy-consumption ${d["energy-consumption"]} ${unit}`);
    }
    // S5c: scopes.
    const cunit = (d["carbon-unit"] as string | undefined) ?? "gCO2e";
    for (const [member, k] of [["scope-2", O.scope2], ["scope-3", O.scope3]] as const) {
      if (typeof d[member] !== "number") {
        row(`S5c coherence-${member}`, "SKIPPED", `no ${member} in the declaration`);
        continue;
      }
      const sum = sumMember(ops, k);
      row(`S5c coherence-${member}`, agreesInUnit(sum, d[member] as number, KG_EXPONENT[cunit], tol) ? "PASS" : "FAIL", `Σ ${k} ${decToNumber(sum)} kgCO2e against ${member} ${d[member]} ${cunit}`);
    }
    // S5d: offsets against the tonnes in carbon-neutrality.
    const cn = isObject((d.extensions as Doc)[profile.extensions.carbonNeutrality]) ? ((d.extensions as Doc)[profile.extensions.carbonNeutrality] as Doc) : undefined;
    const sumOffsets = sumMember(ops, O.offsets);
    if (!cn || typeof cn[profile.neutrality.offsetsRetiredT] !== "number") {
      row("S5d coherence-offsets", "SKIPPED", `no ${profile.neutrality.offsetsRetiredT} in the declaration`);
    } else {
      const t = cn[profile.neutrality.offsetsRetiredT] as number;
      row("S5d coherence-offsets", within(sumOffsets, shift(decOf(t), 3), decOf(profile.tolerances.offsetsKg)) ? "PASS" : "FAIL", `Σ ${O.offsets} ${decToNumber(sumOffsets)} kg against ${t} tCO2e`);
    }
    // S5e: the status follows the precedence; the network flag recomputes from the totals.
    const expectedStatus = netZeroStatus(ops.map((o) => ({ offsetCoverageEveryPeriod: o[O.offsetCoverageEveryPeriod] as boolean, offsets: decOf(o[O.offsets] as number) })), profile);
    const problems: string[] = [];
    if (cn && cn[profile.neutrality.status] !== expectedStatus) problems.push(`${profile.neutrality.status} is ${JSON.stringify(cn[profile.neutrality.status])}, the entries give ${expectedStatus}`);
    if (d["target-type"] === "service") {
      const recomputed = decCmp(decAdd(sumMember(ops, O.scope2), sumMember(ops, O.scope3)), sumOffsets) <= 0;
      if (le[profile.evidence.networkOffsetCoverage] !== recomputed) problems.push(`${profile.evidence.networkOffsetCoverage} is ${String(le[profile.evidence.networkOffsetCoverage])}, the totals give ${recomputed}`);
    }
    row("S5e coherence-status", problems.length === 0 ? "PASS" : "FAIL", problems.length === 0 ? `status ${expectedStatus} follows from the entries` : problems.join("; "));

    const integrity = rows.find((r) => r.id === "S3 signature")?.status === "PASS" ? "integrity verified with the pinned key" : "integrity not verified";
    row("S6 record", "INFO", `attributed to the origin; ${integrity}; figures self-asserted; accuracy unknown`);
  } catch (err) {
    row("S0 internal", "FAIL", `the check could not be completed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { depth: "shallow", ok: rows.every((r) => r.status !== "FAIL"), rows };
}

/** D6b: the declaration's own figures against the recomputation. */
function declarationDefects(doc: Doc, b: BridgeResult): [CheckStatus, string] {
  const profile = b.profile;
  const tol = profile.tolerances.figure;
  const raw = b.raw;
  const out: string[] = [];
  const compare = (member: string, want: number | undefined, exponent: number | undefined): void => {
    const got = doc[member];
    if (want === undefined) {
      if (got !== undefined) out.push(`${member} ${String(got)} is declared but the ledger gives no figure for the whole period`);
      return;
    }
    if (typeof got !== "number") out.push(`${member} is absent but the ledger gives ${want}`);
    else if (exponent === undefined || !agreesInUnit(decOf(want), got, exponent, tol)) out.push(`${member} ${got} ≠ recomputed ${want}`);
  };
  compare("energy-consumption", raw.energy?.value, KWH_EXPONENT[(doc["energy-unit"] as string | undefined) ?? "kWh"]);
  const kg = KG_EXPONENT[(doc["carbon-unit"] as string | undefined) ?? "gCO2e"];
  compare("carbon-footprint", raw.carbon?.value, kg);
  compare("scope-2", raw.scope2, kg);
  compare("scope-3", raw.scope3, kg);
  compare("carbon-intensity-gCO2e-per-kWh", raw.carbonIntensity, 0);
  if ((doc["carbon-accounting"] ?? undefined) !== raw.carbonAccounting) out.push(`carbon-accounting ${JSON.stringify(doc["carbon-accounting"])} ≠ recomputed ${JSON.stringify(raw.carbonAccounting)}`);
  if (doc["measurement-method"] !== raw.measurementMethod) out.push(`measurement-method ${JSON.stringify(doc["measurement-method"])} ≠ recomputed ${JSON.stringify(raw.measurementMethod)}`);
  const cn = isObject(doc.extensions) ? (doc.extensions as Doc)[profile.extensions.carbonNeutrality] : undefined;
  const status = isObject(cn) ? cn[profile.neutrality.status] : undefined;
  if (status !== b.netZeroStatus) out.push(`${profile.neutrality.status} ${JSON.stringify(status)} ≠ recomputed ${b.netZeroStatus}`);
  const tonnes = isObject(cn) ? cn[profile.neutrality.offsetsRetiredT] : undefined;
  if (typeof tonnes !== "number" || !within(b.totals.offsets, shift(decOf(tonnes), 3), decOf(profile.tolerances.offsetsKg))) {
    out.push(`${profile.neutrality.offsetsRetiredT} ${String(tonnes)} ≠ recomputed ${decToNumber(shift(b.totals.offsets, -3))}`);
  }
  return out.length === 0
    ? ["PASS", "every top-level figure, the accounting basis, the measurement method and the neutrality members are the ones the ledger gives"]
    : ["FAIL", out.join("; ")];
}

/** Which deep row a publishing refusal belongs to. */
function rowForCode(code: BridgeCode): string {
  switch (code) {
    // The events themselves: hashes, signatures, keys, and the per-event rules of §A.3.1.
    case "E-HASH":
    case "E-SIG":
    case "E-KEY":
    case "E-TS":
    case "E-TYPE":
    case "E-ACTOR":
    case "E-PAYLOAD":
    case "E-NUMBER":
    case "E-ORDER":
      return "D3 signatures";
    case "E-PREV":
    case "E-FORK":
    case "E-DUPLICATE":
    case "E-SUPERSEDES":
    case "E-NOHEAD":
      return "D4 chains";
    case "E-FLAG":
      return "D5 C-SFC-4";
    // Figures that cannot be summed into one declaration.
    case "E-METHOD":
    case "E-EMPTY":
      return "D6 sums";
    case "E-ALLOCATION":
      return "D9 retirements";
    case "E-OPERATOR":
    case "E-INACTIVE":
    case "E-PERIOD":
      return "D2 operator-set";
    default:
      return "D1 ledger-access";
  }
}

/**
 * The deep check (§A.9.4): recompute the declaration from the excerpt and
 * compare, row by row. The excerpt is the caller's (fetched from
 * `ledger-access-uri` or given); it is bounded and never trusted. Never throws.
 */
export function deepCheck(doc: unknown, excerpt: unknown, opts: { scope2MethodDefault?: CarbonAccounting } = {}): CheckReport {
  const rows: CheckRow[] = [];
  // One row per id: a later verdict on the same row replaces the earlier one.
  const row = (id: string, status: CheckStatus, detail: string): void => {
    const i = rows.findIndex((r) => r.id === id);
    if (i >= 0) rows[i] = { id, status, detail };
    else rows.push({ id, status, detail });
  };
  const done = (): CheckReport => ({ depth: "deep", ok: rows.every((r) => r.status !== "FAIL"), rows });
  const skipRest = (from: string[], why: string): void => {
    for (const id of from) row(id, "SKIPPED", why);
  };
  const REST = ["D2 operator-set", "D3 signatures", "D4 chains", "D5 C-SFC-4", "D6 sums", "D6b declaration", "D7 C-SFC-3", "D8 anchor", "D9 retirements"];
  try {
    if (!isObject(doc)) {
      row("S5a ledger-evidence-shape", "FAIL", "the declaration is not a JSON object");
      return done();
    }
    const ev = evidenceOf(doc);
    if (!ev) {
      row("S5a ledger-evidence-shape", "FAIL", "the declaration carries no ledger-evidence extension this check reads");
      return done();
    }
    const { profile, value: le } = ev;
    const defect = evidenceShapeDefect(doc, profile, le);
    if (defect) {
      row("S5a ledger-evidence-shape", "FAIL", defect);
      return done();
    }
    const E = profile.evidence;
    const O = profile.operatorEntry;
    const ops = le[E.operators] as Doc[];
    const mode: BridgeMode = doc["target-type"] === "service" ? "network" : "operator";

    // D1: the excerpt is readable and describes the same publication.
    let read: ReadExcerpt;
    try {
      read = readExcerpt(excerpt, { bounds: true });
    } catch (err) {
      row("D1 ledger-access", "FAIL", `the excerpt cannot be read: ${err instanceof Error ? err.message : String(err)}`);
      skipRest(REST, "no usable excerpt");
      return done();
    }
    const x = read.excerpt;
    const mismatches: string[] = [];
    if (x["profile-version"] !== le[E.profileVersion]) mismatches.push(E.profileVersion);
    if (x["hash-algorithm"] !== le[E.hashAlgorithm]) mismatches.push(E.hashAlgorithm);
    if (x["event-encoding"] !== le[E.eventEncoding]) mismatches.push(E.eventEncoding);
    if (x.publication["period-start"] !== le[E.periodStart]) mismatches.push(E.periodStart);
    if (x.publication["period-end"] !== le[E.periodEnd]) mismatches.push(E.periodEnd);
    if (x.publication["reporting-period"] !== doc["reporting-period"]) mismatches.push("reporting-period");
    if (x.publication.target !== doc.target) mismatches.push("target");
    if (x.publication.updated !== doc.updated) mismatches.push("updated");
    const topology = (doc.extensions as Doc)[profile.extensions.networkTopology];
    if (isObject(topology) && topology[profile.topology.memberOfNetwork] !== undefined && topology[profile.topology.memberOfNetwork] !== x.network) mismatches.push(profile.topology.memberOfNetwork);
    if (mismatches.length > 0) {
      row("D1 ledger-access", "FAIL", `the excerpt and the declaration differ on ${mismatches.join(", ")}`);
      skipRest(REST, "the excerpt describes another publication");
      return done();
    }
    row("D1 ledger-access", "PASS", `excerpt obtained (${x.ledger.length} entries, ${x.registry.length} Registry entries); profile, hashing, encoding and period agree with the declaration`);

    // The recomputation, with every refusal mapped to its row.
    let v: VerifiedLedger;
    let b: BridgeResult;
    try {
      v = verifyLedger(read);
      b = bridge(v, {
        mode,
        provider: "recomputation",
        methodologyUri: "https://recomputation.invalid/",
        ledgerAccessUri: le[E.ledgerAccessUri] as string,
        ...(mode === "network" ? { disclosureUri: "https://recomputation.invalid/" } : {}),
        ...(opts.scope2MethodDefault ? { scope2MethodDefault: opts.scope2MethodDefault } : {}),
      });
    } catch (err) {
      const code = err instanceof BridgeError ? err.code : undefined;
      const id = code ? rowForCode(code) : "D1 ledger-access";
      row(id, "FAIL", err instanceof Error ? err.message : String(err));
      skipRest(REST.filter((r) => r !== id), "the recomputation stopped at the failed row");
      return done();
    }

    // D2: the operator set.
    const declared = ops.map((o) => o[O.operator] as string);
    const recomputed = b.entries.map((e) => e.operator);
    const missing = recomputed.filter((o) => !declared.includes(o));
    const extra = declared.filter((o) => !recomputed.includes(o));
    const repeated = declared.filter((o, i) => declared.indexOf(o) !== i);
    if (missing.length || extra.length || repeated.length) {
      const parts = [missing.length ? `missing ${missing.join(", ")}` : "", extra.length ? `extra ${extra.join(", ")}` : "", repeated.length ? `listed twice ${[...new Set(repeated)].join(", ")}` : ""];
      row("D2 operator-set", "FAIL", parts.filter(Boolean).join("; "));
    }
    else row("D2 operator-set", "PASS", mode === "network" ? `the ${recomputed.length} operators active in the period are exactly the ones declared` : `the one operator is active in the period and its Registry origin is the target`);

    // D3: every signature and hash the walk relies on verified inside verifyLedger.
    row("D3 signatures", "PASS", `every hash recomputes and every signature verifies under the key valid at its commit time (${v.events.length} events)`);

    // D4: walk prev back from each declared head, bounded by a visited set.
    const d4: string[] = [];
    for (const o of ops) {
      const entry = b.entries.find((e) => e.operator === o[O.operator]);
      if (!entry) continue;
      for (const [kind, headKey, countKey, want] of [["energy", O.energyHead, O.energyEvents, entry.energyHead], ["carbon", O.carbonHead, O.carbonEvents, entry.carbonHead]] as const) {
        const head = o[headKey] as string;
        if (head !== want) d4.push(`${o[O.operator]}: ${headKey} ${head.slice(0, 12)}… is not the recomputed head ${want.slice(0, 12)}…`);
        let cur = v.byHash.get(head);
        if (!cur) {
          d4.push(`${o[O.operator]}: ${headKey} not found in the excerpt`);
          continue;
        }
        const visited = new Set<string>();
        const inPeriod = new Set<string>();
        while (cur) {
          if (visited.has(cur.hash)) {
            d4.push(`${o[O.operator]}: cycle at ${cur.hash.slice(0, 12)}…`);
            break;
          }
          visited.add(cur.hash);
          if (cur.operator !== o[O.operator] || cur.kind !== kind) {
            d4.push(`${o[O.operator]}: the ${kind} chain passes through ${cur.hash.slice(0, 12)}… of ${cur.operator}, ${cur.kind}`);
            break;
          }
          if (cur.periodFrom >= b.periodStart && cur.periodTo <= b.periodEnd) inPeriod.add(cur.hash);
          const prev: string | null = cur.entry.event.prev;
          cur = prev === null ? undefined : v.byHash.get(prev);
          if (prev !== null && !cur) d4.push(`${o[O.operator]}: prev ${prev.slice(0, 12)}… does not resolve`);
        }
        const expected = v.events.filter((e) => e.operator === o[O.operator] && e.kind === kind && e.periodFrom >= b.periodStart && e.periodTo <= b.periodEnd);
        if (expected.some((e) => !inPeriod.has(e.hash))) d4.push(`${o[O.operator]}: the walk from ${headKey} misses an in-period ${kind} event`);
        if (o[countKey] !== expected.length) d4.push(`${o[O.operator]}: ${countKey} ${String(o[countKey])} ≠ ${expected.length}`);
      }
    }
    row("D4 chains", d4.length === 0 ? "PASS" : "FAIL", d4.length === 0 ? "every declared head is the recomputed head, every prev resolves back to the chain's first event, every in-period event is on the walk, counts match, no fork" : d4.join("; "));

    // D5: the rule, month by month, and the coverage member.
    const d5: string[] = [];
    for (const o of ops) {
      const entry = b.entries.find((e) => e.operator === o[O.operator]);
      if (entry && o[O.offsetCoverageEveryPeriod] !== entry.offsetCoverageEveryPeriod) d5.push(`${o[O.operator]}: ${O.offsetCoverageEveryPeriod} ${String(o[O.offsetCoverageEveryPeriod])} ≠ recomputed ${entry.offsetCoverageEveryPeriod}`);
    }
    row("D5 C-SFC-4", d5.length === 0 ? "PASS" : "FAIL", d5.length === 0 ? "every netZero flag equals the recomputed comparison; the coverage members equal the AND over the active months" : d5.join("; "));

    // D6: exact sums and the network flag.
    const d6: string[] = [];
    for (const o of ops) {
      const entry = b.entries.find((e) => e.operator === o[O.operator]);
      if (!entry) continue;
      for (const [k, want] of [[O.kwh, entry.kwh], [O.scope2, entry.scope2], [O.scope3, entry.scope3], [O.offsets, entry.offsets]] as const) {
        if (decCmp(decOf(o[k] as number), want) !== 0) d6.push(`${o[O.operator]}: ${k} ${String(o[k])} ≠ recomputed ${decToNumber(want)}`);
      }
    }
    if (mode === "network" && le[E.networkOffsetCoverage] !== b.networkOffsetCoverage) d6.push(`${E.networkOffsetCoverage} ${String(le[E.networkOffsetCoverage])} ≠ recomputed ${String(b.networkOffsetCoverage)}`);
    row("D6 sums", d6.length === 0 ? "PASS" : "FAIL", d6.length === 0 ? "every sum recomputes exactly from the effective attestations" : d6.join("; "));

    // D6b: every top-level figure and the neutrality members are the recomputed ones (the
    // declared figure may carry the publisher's four-place rounding; nothing else may differ).
    row("D6b declaration", ...declarationDefects(doc, b));

    // D7: hardware, only where the declaration claims it.
    const hw = (doc.extensions as Doc)[profile.extensions.hardwareLifecycle];
    if (!isObject(hw)) row("D7 C-SFC-3", "REFUSED", "the declaration makes no hardware-lifecycle claim");
    else if (hw[profile.hardware.generalPurpose] !== true || hw[profile.hardware.singleUseAsicRequired] !== false) {
      row("D7 C-SFC-3", "FAIL", `the claim is ${profile.hardware.generalPurpose}=${String(hw[profile.hardware.generalPurpose])}, ${profile.hardware.singleUseAsicRequired}=${String(hw[profile.hardware.singleUseAsicRequired])}; the Registry supports only true, false`);
    } else {
      const bad = b.entries.filter((e) => !e.hardwareOk).map((e) => e.operator);
      row("D7 C-SFC-3", bad.length === 0 ? "PASS" : "FAIL", bad.length === 0 ? "every counted operator's Registry nodeProfile forbids ASICs and names an allowed hardware class (declared, not established: no document shows what hardware exists)" : `no supporting nodeProfile for ${bad.join(", ")}`);
    }
    row("D8 anchor", "SKIPPED", "no anchor in this demonstration");

    // D9: the allocations verified inside bridge(); the registry pointer must name the one that contributed.
    const cn = (doc.extensions as Doc)[profile.extensions.carbonNeutrality];
    const allocations = b.entries.flatMap((e) => e.contributingAllocations);
    const uri = isObject(cn) ? cn[profile.neutrality.registryUri] : undefined;
    if (uri !== undefined && (allocations.length !== 1 || allocations[0]["registry-uri"] !== uri)) {
      row("D9 retirements", "FAIL", `${profile.neutrality.registryUri} ${JSON.stringify(uri)} is not the one contributing allocation's registry-uri`);
    } else {
      row("D9 retirements", "PASS", `${allocations.length} contributing allocation(s) verify under the operator's keys, allocate no more than the tonnes retired, and give each attested month exactly its ${profile.payload.offsets}`);
    }
    row("D10 record", "INFO", "the declaration agrees with the signed ledger record at the stated heads; nothing shows that the readings were true");
  } catch (err) {
    row("D0 internal", "FAIL", `the check could not be completed: ${err instanceof Error ? err.message : String(err)}`);
  }
  return done();
}
