/**
 * The ledger side of the profile: events, signatures, the acceptance rules L1
 * to L12 (5.5) and the replay that selects the effective attestations (5.6).
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md
 *
 * A check builds one `Ctx` from the read and the caller's inputs; every rule
 * reads the Ctx, never the clock.
 */
import { SFC_LEDGER_PROFILE_2_0 as PROFILE, type SfcLimits } from "../sfc-ledger-profile";
import { startDeadline, type Clock } from "./deadline";
import * as ed from "./ed25519";
import { indexAdd, indexRemove, newIndex, prepare, tonneReused, type IndexReader, type TonneIndex } from "./tonne-index";
import type { ElementIssues } from "./ijson";
import { event1xShape, eventShape, is1xEvent } from "./shape";
import { activeIn, firstActiveMonth, keysValidAt, normEntry, pubOf, type Entry, type NormKey } from "./registry";
import {
  add, addMonths, atOrBefore, before, canonicalize, cmp, cmpInstant, dec, dueOf, eq, figureOk, fromNumber, hashOf, instantKey, isFullDate, isHex64, isInstant, isInt, isNum, isObject, isUtcMonthPeriod,
  isWholeMonthDates, mulInt, sameHost, spanOfDates, tonnesOk, unb64u, withoutSig, ZERO, type Dec, type Json,
} from "./primitives";

/** A caller-pinned signing key: a public JWK (`kty`, `crv`, `x`, and `y` for an EC key), or `{ x }` for an Ed25519 key. */
export interface PinnedKey {
  kty?: string;
  crv?: string;
  x: string;
  y?: string;
}

/** Caller-pinned facts (out of band, 9.4 D2, 7.6): registrar keys per network host, the methodology document, signing keys, 1.x entry digests. */
export interface Pins {
  registrar?: Record<string, readonly string[]>;
  methodology?: boolean;
  networkHost?: string;
  publisherKeys?: PinnedKey[];
  operatorKeys?: PinnedKey[];
  entries1x?: string[];
}

/** The inputs of one check run. */
export interface CheckInput {
  excerpt: Json;
  /** The longest number literal of the excerpt's raw text, when it was read from text. */
  excerptMaxLiteral?: number;
  parameters?: Json;
  pins?: Pins;
  /** Earlier verified Registry versions per operator (D2 rollback). */
  prior?: { versions?: Record<string, number> };
  /** Reads of an old ledger after a takeover (D4). */
  oldLedgers?: { operator: string; type: string; chain: Json[] }[];
  limits?: Partial<SfcLimits>;
  /** An explicit T; else the checker's clock `now`; else `read-at`. */
  T?: string;
  now?: string;
  /** Milliseconds, in place of the monotonic clock that measures the time limit of one check (tests pass a fake). */
  clock?: Clock;
}

export interface LedgerEv {
  i: number;
  commit: string;
  hash: string;
  event: Json;
  computed: string | null;
  kind: "1x" | "2x";
}

export interface Ctx {
  sc: CheckInput;
  ex: Json;
  network: string;
  readAt: string;
  registry: Entry[];
  byOperator: Map<string, Entry>;
  events: LedgerEv[];
  voids: Json[];
  checkpoint: Json;
  params: Json;
  pins: Pins;
  limits: SfcLimits;
  cache: Map<string, unknown>;
  /** Throws CheckLimit once the time limit of one check has passed. */
  checkDeadline: () => void;
  /** Chains the checkpoint lists and the read omits (D4); L9 cannot be checked for any chain while one is missing. */
  missingChains?: string[];
  /** Chains whose first event links to an earlier ledger that no pinned methodology document vouches for (D4); D5 and C-SFC-7 read it. */
  unverifiedTakeovers?: string[];
  /** The objects as served (a mistyped member still present), for the `signed` member verified under Registry keys (D2.signed); the checks read the objects with such members read as absent. */
  served?: Json[];
  /** The duplicate and lone-surrogate findings of each served object's own text (D2.signed), aligned with `served`; null when the body came as objects. */
  objectIssues?: ElementIssues[] | null;
}

const safeHash = (e: Json): string | null => {
  try {
    return hashOf(e);
  } catch {
    return null;
  }
};

/** Build the context every check reads. */
export function buildContext(sc: CheckInput, limits: SfcLimits): Ctx {
  const ex = sc.excerpt;
  const registry = (ex.registry ?? []).map(normEntry);
  const byOperator = new Map<string, Entry>();
  for (const en of registry) if (!byOperator.has(en.operator)) byOperator.set(en.operator, en);
  const events: LedgerEv[] = (ex.ledger ?? []).map((l: Json, i: number) => ({
    i,
    commit: l.commit,
    hash: l.hash,
    event: l.event,
    computed: safeHash(l.event),
    kind: is1xEvent(l.event) ? "1x" : "2x",
  }));
  return {
    sc, ex, network: ex.network, readAt: ex["read-at"], registry, byOperator, events,
    voids: ex.voids ?? [], checkpoint: ex.checkpoint ?? null, params: sc.parameters ?? {}, pins: sc.pins ?? {}, limits, cache: new Map(),
    checkDeadline: startDeadline(limits.secondsPerCheck, sc.clock),
  };
}

export const eventShapeTokens = (ev: LedgerEv): string[] => (ev.kind === "1x" ? event1xShape(ev.event) : eventShape(ev.event));

/** Month (start instant) an event is about, or null: a 2.0 month-bound pair or 1.x dates of one whole UTC month (5.5 L2, 12.1 rule 1). */
export function monthOfEvent(ev: LedgerEv): string | null {
  const p = ev.event?.payload?.period;
  if (!isObject(p)) return null;
  if (ev.kind === "2x") return isUtcMonthPeriod(p as { start: string; end: string }) ? p.start : null;
  if (!isFullDate(p.from) || !isFullDate(p.to)) return null;
  return isWholeMonthDates(p.from, p.to) ? `${p.from.slice(0, 7)}-01T00:00:00Z` : null;
}

/** [start, end) of an event's period as instants, or null when invalid. 1.x: from 00:00Z to 00:00Z after `to` (12.1). */
export function spanOfEvent(ev: LedgerEv): [string, string] | null {
  const p = ev.event?.payload?.period;
  if (!isObject(p)) return null;
  if (ev.kind === "2x") return isInstant(p.start) && isInstant(p.end) && before(p.start, p.end) ? [p.start, p.end] : null;
  if (!isFullDate(p.from) || !isFullDate(p.to)) return null;
  return spanOfDates(p.from, p.to);
}

// ---- signatures (3.6, 10) ------------------------------------------------------------------

export interface SigInfo {
  alg: boolean;
  encoding: boolean;
  weak: boolean;
  verified: boolean;
  noKey: boolean;
  algName: string | undefined;
}

type Failure = "s-range" | "bad-R" | "bad-A" | "weak-A" | "weak-R" | "mismatch" | "encoding-length";

/**
 * Verify against every key valid at commit; returns whether one verifies, whether none can, and the failure reasons.
 * A failed attempt costs about 2 ms and an entry may hold many keys, so the time limit is tested before each key.
 */
function verifyUnderKeys(keys: NormKey[], msg: Buffer, bytes: Buffer, checkDeadline: () => void): { verified: boolean; reasons: Failure[] } {
  const reasons: Failure[] = [];
  for (const k of keys) {
    checkDeadline();
    const pub = pubOf(k);
    if (!pub) {
      reasons.push("bad-A");
      continue;
    }
    const r = ed.verify(pub, msg, bytes);
    if (r.ok) return { verified: true, reasons };
    reasons.push(r.reason);
  }
  return { verified: false, reasons };
}

/** Signature facts of event `ev` (independent of the replay). 1.x events read the signature as the 1.2 reference code does. */
export function sigInfo(ctx: Ctx, ev: LedgerEv): SigInfo {
  const cached = ctx.cache.get(`sig${ev.i}`) as SigInfo | undefined;
  if (cached) return cached;
  const e = ev.event;
  const out: SigInfo = { alg: true, encoding: true, weak: false, verified: false, noKey: false, algName: e?.sig?.alg };
  if (!isObject(e?.sig) || typeof e.sig.value !== "string") out.encoding = false;
  else {
    if (e.sig.alg !== PROFILE.signatureAlgorithm) out.alg = false;
    const strict = unb64u(e.sig.value);
    const bytes = strict ?? (ev.kind === "1x" ? Buffer.from(e.sig.value, "base64url") : null);
    if (strict === null && ev.kind === "2x") out.encoding = false;
    if (out.alg && bytes && bytes.length === 64) {
      const entry = ctx.byOperator.get(e.subject);
      const keys = entry ? keysValidAt(entry, ev.commit) : [];
      if (!keys.length) out.noKey = true;
      const { verified, reasons } = verifyUnderKeys(keys, Buffer.from(canonicalize(withoutSig(e)), "utf8"), bytes, ctx.checkDeadline);
      out.verified = verified;
      if (!verified && out.encoding) {
        if (reasons.some((r) => r === "s-range" || r === "bad-R" || r === "bad-A")) out.encoding = ev.kind === "1x";
        if (reasons.some((r) => r === "weak-A" || r === "weak-R")) out.weak = true;
      }
    } else if (out.alg && ev.kind === "2x") out.encoding = false;
  }
  ctx.cache.set(`sig${ev.i}`, out);
  return out;
}

// ---- figures (3.3, section 6) --------------------------------------------------------------

export const decOf = (x: number): Dec => fromNumber(x);
const sumKg = (retirements: Json[]): Dec => retirements.reduce((a, r) => add(a, decOf(r.kg)), ZERO);
const num = (p: Json, k: string): Dec => (p[k] === undefined ? ZERO : decOf(p[k]));

/** The offset-coverage comparison of section 6 for a carbon payload: S1 + S2 + S3 <= R, exact. */
export function coverageHolds(p: Json): boolean {
  const lhs = add(add(num(p, "scope1KgCO2e"), num(p, "scope2KgCO2e")), num(p, "scope3KgCO2e"));
  return cmp(lhs, num(p, "offsetsKgCO2e")) <= 0;
}

// ---- parameters (7.6) ----------------------------------------------------------------------

export const methodologyPinned = (ctx: Ctx): boolean => ctx.pins.methodology === true;
export const registryForms = (ctx: Ctx): string[] | undefined => ctx.params["retirement-registries"];
export const formRules = (ctx: Ctx, registry: string): string[] => (ctx.params["reference-forms"] ?? []).find((f: Json) => f.registry === registry)?.rules ?? [];
export function takeoverTip(ctx: Ctx, operator: string, type: string): string | undefined {
  const t = (ctx.params.takeovers ?? []).find((x: Json) => x.operator === operator && x.type === type);
  return t ? t.tip : undefined;
}

const RANGE = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/;
const SINGLE = /^(0|[1-9]\d*)$/;
function serialRange(ref: string): [bigint, bigint] | null {
  const m = RANGE.exec(ref);
  if (m) return [BigInt(m[1]), BigInt(m[2])];
  const s = SINGLE.exec(ref);
  return s ? [BigInt(s[1]), BigInt(s[1])] : null;
}

/** Does `reference` meet each canonical-form rule the methodology document names for its registry (L8b)? */
export function referenceCanonical(reference: string, rules: string[]): boolean {
  if (rules.includes("upper-case") && reference !== reference.toUpperCase()) return false;
  if (rules.includes("lower-case") && reference !== reference.toLowerCase()) return false;
  if (rules.includes("no-leading-zeros") && /(^|[^0-9])0[0-9]/.test(reference)) return false;
  if (rules.includes("no-surrounding-space") && reference !== reference.trim()) return false;
  if (rules.includes("range-first-last")) {
    const m = RANGE.exec(reference);
    if (m) {
      if (BigInt(m[1]) >= BigInt(m[2])) return false;
    } else if (!SINGLE.test(reference)) return false;
  }
  return true;
}

// ---- the acceptance rules (5.5) ------------------------------------------------------------

/** A citation the single-use and timing rules can read; a malformed one is reported by L8 and read by no other rule. */
const readableCitation = (r: Json): boolean =>
  isObject(r) && typeof r.kg === "number" && Number.isFinite(r.kg) && Number.isInteger(r.tonnesRetired) && typeof r.registry === "string" && typeof r.reference === "string" && typeof r.retiredAt === "string";

const citations = (ev: LedgerEv): Json[] => {
  const r = ev.event?.payload?.retirements;
  return ev.kind === "2x" && ev.event.type === PROFILE.eventTypes.carbon && Array.isArray(r) ? r.filter(readableCitation) : [];
};

export interface StaticVerdict {
  reasons: string[];
  ne: string[];
  shape: string[];
  month: string | null;
  span: [string, string] | null;
}

const figuresReadable = (e: Json): boolean => ["scope1KgCO2e", "scope2KgCO2e", "scope3KgCO2e", "offsetsKgCO2e"].every((k) => e.payload[k] === undefined || typeof e.payload[k] === "number");

function figuresOk(e: Json): boolean {
  const p = e.payload;
  const names = e.type === PROFILE.eventTypes.energy ? ["kWhConsumed"] : ["scope1KgCO2e", "scope2KgCO2e", "scope2LocationKgCO2e", "scope3KgCO2e", "offsetsKgCO2e"];
  if (!names.every((k) => p[k] === undefined || figureOk(p[k]))) return false;
  if (e.type === PROFILE.eventTypes.carbon && Array.isArray(p.retirements)) {
    for (const r of p.retirements) {
      if (!figureOk(r.kg) || !tonnesOk(r.tonnesRetired)) return false;
      if (cmp(decOf(r.kg), mulInt(dec(r.tonnesRetired), 1000)) > 0) return false;
    }
  }
  return true;
}

function offsetsMatch(e: Json): boolean {
  const p = e.payload;
  if (e.type !== PROFILE.eventTypes.carbon || !Array.isArray(p.retirements) || typeof p.offsetsKgCO2e !== "number") return true;
  return eq(sumKg(p.retirements.filter(isObject).filter((r: Json) => typeof r.kg === "number")), decOf(p.offsetsKgCO2e));
}

const isNumber = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);

/**
 * L8 for a 1.x event (12.1 rule 2): the 1.2 figure members are present with their types (`nodeCount` and
 * `kWhConsumed`; `scope2KgCO2e`, `scope3KgCO2e`, `offsetsKgCO2e`, `netZero`), and `kWhConsumed`, `nodeCount` and
 * `offsetsKgCO2e` are not negative. A negative Scope 2 or 3 is read as is; the digit limits of 3.3 do not apply.
 */
function figures1xOk(e: Json): boolean {
  const p = e.payload;
  if (e.type === PROFILE.eventTypes.energy) return isInt(p.nodeCount) && isNum(p.kWhConsumed);
  return isNumber(p.scope2KgCO2e) && isNumber(p.scope3KgCO2e) && isNum(p.offsetsKgCO2e) && typeof p.netZero === "boolean";
}

/** L1 (event and Registry only). */
function ruleL1(ctx: Ctx, ev: LedgerEv, month: string | null): boolean {
  const e = ev.event;
  const entry = isObject(e) ? ctx.byOperator.get(e.subject) : undefined;
  const typeOk = e?.type === PROFILE.eventTypes.energy || e?.type === PROFILE.eventTypes.carbon;
  const networkOk = ev.kind === "1x" || sameHost(e?.network, ctx.network);
  const activeOk = entry && (month === null || activeIn(entry, month));
  return !!typeOk && networkOk && e?.subject === e?.actor && !!entry && !!activeOk;
}

/** L3: `ts` and the commit instant are both at or after `period.end`. */
function ruleL3(ev: LedgerEv, month: string | null): boolean {
  const e = ev.event;
  if (ev.kind === "1x" && month === null) return true;
  const end = ev.kind === "2x" ? e?.payload?.period?.end : addMonths(month as string, 1);
  return isInstant(end) && isInstant(e?.ts) && atOrBefore(end, e.ts) && atOrBefore(end, ev.commit);
}

/** L5, with the `encoding` and `weak key` findings of section 10 reported on their own. */
function ruleL5(ctx: Ctx, ev: LedgerEv, reasons: string[], ne: string[]): void {
  const sig = sigInfo(ctx, ev);
  if (ev.kind === "1x" && !sig.alg) ne.push("L5:alg");
  else if (!sig.alg) reasons.push("L5");
  else if (!sig.encoding) reasons.push("encoding");
  else if (sig.weak) reasons.push("weak");
  else if (sig.noKey || !sig.verified) reasons.push("L5");
}

/** Rules that depend only on the event and the Registry: L1, L2, L3, L5, L7, L8. */
export function staticRules(ctx: Ctx, ev: LedgerEv): StaticVerdict {
  const e = ev.event;
  const reasons: string[] = [];
  const ne: string[] = [];
  const shape = eventShapeTokens(ev);
  const month = monthOfEvent(ev);
  if (!ruleL1(ctx, ev, month)) reasons.push("L1");
  if (ev.kind === "2x" && month === null) reasons.push("L2");
  if ((ev.kind === "2x" || month !== null) && !ruleL3(ev, month)) reasons.push("L3");
  ruleL5(ctx, ev, reasons, ne);
  if (ev.kind === "2x") {
    if (shape.length || !figuresOk(e) || !offsetsMatch(e)) reasons.push("L8");
  } else if (shape.length || !figures1xOk(e)) reasons.push("L8");
  if (e?.type === PROFILE.eventTypes.carbon && !shape.length && figuresReadable(e) && e.payload.netZero !== coverageHolds(e.payload)) reasons.push("L7");
  return { reasons, ne, shape, month, span: spanOfEvent(ev) };
}

/** The replay state (5.6): E holds the effective attestation per (subject, type, month). */
export interface EffectiveEntry {
  hash: string;
  ev: LedgerEv;
  month: string;
}
export interface ChainItem {
  hash: string | null;
  kind: "1x" | "2x";
  month: string | null;
  i: number;
}
export interface Verdict extends StaticVerdict {
  skipped: boolean;
}
export interface ReplayState {
  E: Map<string, EffectiveEntry>;
  chains: Map<string, ChainItem[]>;
  /** The 2.0 events seen per chain and month (L12), and the hashes seen per chain and month (L6 of a 1.x event). */
  monthCounts: Map<string, number>;
  monthHashes: Set<string>;
  twoXBySubject: Set<string>;
  /** The single-use index of L9 over the effective set. */
  L9: TonneIndex;
  verdicts: Map<number, Verdict>;
  voidApplied: { target: string | null; deleted: boolean }[];
}

const chainKey = (subject: string, type: string): string => `${subject}|${type}`;
export const eKey = (subject: string, type: string, month: string): string => `${subject}|${type}|${month}`;

/** L4: `prev` equals the tip; a takeover link is accepted as the methodology document records it. */
function ruleL4(ctx: Ctx, e: Json, chain: ChainItem[]): boolean {
  const tip = chain.length ? chain[chain.length - 1].hash : null;
  if (e.prev === tip) return true;
  if (tip !== null || !isHex64(e.prev)) return false;
  const listed = takeoverTip(ctx, e.subject, e.type);
  return methodologyPinned(ctx) ? listed === e.prev : listed === undefined ? true : listed === e.prev;
}

/** L6: `supersedes` is absent when no earlier effective attestation exists, else equal to its hash (1.x: any earlier event of the month). */
function ruleL6(st: ReplayState, ev: LedgerEv, month: string): boolean {
  const e = ev.event;
  const cur = st.E.get(eKey(e.subject, e.type, month));
  const sup = e.payload?.supersedes;
  if (ev.kind === "2x") return !(cur ? sup !== cur.hash : sup !== undefined);
  return !cur || st.monthHashes.has(`${chainKey(e.subject, e.type)}|${month}|${sup}`);
}

/** L8b, L9, L10 for the citations of a 2.0 CarbonAttested. */
function retirementRules(ctx: Ctx, st: ReplayState, ev: LedgerEv, month: string | null, reasons: string[], ne: string[]): void {
  const r = citations(ev);
  const regs = registryForms(ctx);
  if (r.length && regs === undefined) ne.push("L8b:retirement-registries");
  else {
    for (const x of r) {
      if (!(regs as string[]).includes(x.registry) || (typeof x.reference === "string" && !referenceCanonical(x.reference, formRules(ctx, x.registry)))) {
        reasons.push("L8b");
        break;
      }
    }
  }
  if (month === null) return;
  if (l9Broken(ctx, st, ev, month)) reasons.push("L9");
  const due = dueOf(month);
  if (r.some((x) => !(isInstant(x.retiredAt) && atOrBefore(x.retiredAt, due) && atOrBefore(x.retiredAt, ev.commit)))) reasons.push("L10");
}

/** Rules that read the replay state: L4, L6, L8b, L9, L10, L11, L11b, L12. */
export function stateRules(ctx: Ctx, st: ReplayState, ev: LedgerEv, month: string | null): { reasons: string[]; ne: string[] } {
  const e = ev.event;
  const reasons: string[] = [];
  const ne: string[] = [];
  const chain = st.chains.get(chainKey(e.subject, e.type)) ?? [];
  if (!ruleL4(ctx, e, chain)) reasons.push("L4");
  if (month !== null && !ruleL6(st, ev, month)) reasons.push("L6");
  if (ev.kind === "2x") {
    if (e.type === PROFILE.eventTypes.carbon && Array.isArray(e.payload?.retirements)) retirementRules(ctx, st, ev, month, reasons, ne);
    if (month !== null) {
      const n = st.monthCounts.get(`${chainKey(e.subject, e.type)}|${month}`) ?? 0;
      if (n >= 20 || chain.length >= ctx.limits.eventsPerChain) reasons.push("L12");
    }
  } else {
    if (st.twoXBySubject.has(e.subject)) reasons.push("L11");
    const entry = ctx.byOperator.get(e.subject);
    if (month !== null && entry && entry.form === "2x") {
      const sw = entry.profile2From ?? firstActiveMonth(entry);
      if (sw && cmpInstant(month, sw) >= 0) reasons.push("L11b");
    }
  }
  return { reasons, ne };
}

/** What the single-use index needs to read a citation of this read. */
const indexReader = (ctx: Ctx): IndexReader => ({
  decOf,
  instantKey,
  ranged: (registry) => formRules(ctx, registry).includes("range-first-last"),
  serialRange,
});

/** The L9 index entry of an event that becomes effective (called where `st.E` gains it). */
function fileCitations(ctx: Ctx, st: ReplayState, owner: string, ev: LedgerEv): void {
  indexAdd(st.L9, owner, citations(ev).map((c) => prepare(c, indexReader(ctx))));
}

/** Remove the L9 index entry of an event that leaves the effective set (superseded or voided). */
const unfileCitations = (st: ReplayState, owner: string): void => indexRemove(st.L9, owner);

/** L9: single use of each tonne, judged over the effective set with this event in place of the one it supersedes. */
function l9Broken(ctx: Ctx, st: ReplayState, ev: LedgerEv, month: string): boolean {
  const mine = citations(ev).map((c) => prepare(c, indexReader(ctx)));
  return tonneReused(st.L9, eKey(ev.event.subject, ev.event.type, month), mine);
}

// ---- void acts and the registrar key (5.4, D2) ---------------------------------------------

export interface RegistrarKey {
  x: string | undefined;
  status: string;
}

/**
 * The key of `pins.registrar` that applies to this read. With `pins.networkHost` (the network the caller pinned
 * for) the read must be of that network: a read that claims another one gets no pinned key. Without it, the
 * network the read claims.
 */
function pinKey(ctx: Ctx): string | undefined {
  const named = ctx.pins.networkHost;
  if (named === undefined) return ctx.network;
  return sameHost(named, ctx.network) ? named : undefined;
}

/** Registrar keys the checker may use: pinned keys, and keys of a pinned methodology document (7.6). */
export function registrarKeys(ctx: Ctx): RegistrarKey[] {
  const host = pinKey(ctx);
  const registrar = ctx.pins.registrar ?? {};
  const pinned: RegistrarKey[] = (host !== undefined && Object.hasOwn(registrar, host) ? registrar[host] : []).map((x) => ({ x, status: "current" }));
  const listed: RegistrarKey[] = methodologyPinned(ctx) ? (ctx.params["registrar-keys"] ?? []).map((k: Json) => ({ x: k.jwk?.x, status: k.status })) : [];
  return [...pinned, ...listed];
}

export type SignedByRegistrar = { ok: true; status: string } | { ok: false; reason: string };

/**
 * Verify a registrar-signed object (Registry entry, void act, checkpoint) under any of `keys`. `checkDeadline` is
 * called before each key (the checks pass the context's; the default does nothing).
 */
export function verifyUnder(keys: RegistrarKey[], obj: Json, checkDeadline: () => void = () => undefined): SignedByRegistrar {
  const sig = obj?.sig;
  const bytes = isObject(sig) && sig.alg === PROFILE.signatureAlgorithm ? unb64u(sig.value) : null;
  if (!bytes || bytes.length !== 64) return { ok: false, reason: "encoding" };
  const msg = Buffer.from(canonicalize(withoutSig(obj)), "utf8");
  let last = "mismatch";
  for (const k of keys) {
    checkDeadline();
    const pub = typeof k.x === "string" ? unb64u(k.x) : null;
    if (!pub) continue;
    const r = ed.verify(pub, msg, bytes);
    if (r.ok) return { ok: true, status: k.status };
    last = r.reason;
  }
  return { ok: false, reason: last };
}

export interface VoidInfo {
  ok: boolean;
  fail?: boolean;
  /** No pinned or listed registrar key to verify under: NOT-EVALUABLE, and the void is ignored. */
  unpinned?: boolean;
  reason?: string;
  target?: LedgerEv;
  /** The status of the key the signature verified under (`current` or `former`). */
  status?: string;
}

const VOID_MEMBERS = ["commit", "target", "sig"];

/** How many ledger events and void acts carry each commit instant. */
function commitCounts(ctx: Ctx): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of [...ctx.events, ...ctx.voids]) counts.set(instantKey(e.commit), (counts.get(instantKey(e.commit)) ?? 0) + 1);
  return counts;
}

/**
 * The static judgement of one void act, in this order: closed shape, commit, pinned key, signature, target,
 * distinct commit. A void is verified under the pinned or methodology keys only, never under the read's own
 * registrar copy (that copy comes from the same untrusted document): with no such key it is NOT-EVALUABLE
 * and ignored. A void under a former key stands (void acts are permanent records).
 */
function judgeVoid(ctx: Ctx, v: Json, keys: RegistrarKey[], counts: Map<string, number>): VoidInfo {
  const closed = isObject(v) && Object.keys(v).length === VOID_MEMBERS.length && VOID_MEMBERS.every((k) => k in v);
  if (!closed) return { ok: false, fail: true, reason: "extra member" };
  if (!isInstant(v.commit)) return { ok: false, reason: "commit" };
  if (!keys.length) return { ok: false, unpinned: true, reason: "registrar key not pinned" };
  const verified = verifyUnder(keys, v, ctx.checkDeadline);
  if (!verified.ok) return { ok: false, reason: "signature" };
  const target = ctx.events.find((e) => e.computed === v.target);
  if (!target || target.event?.type !== PROFILE.eventTypes.carbon || !before(target.commit, v.commit)) return { ok: false, reason: "target" };
  if (counts.get(instantKey(v.commit)) !== 1) return { ok: false, reason: "commit" };
  return { ok: true, target, status: verified.status };
}

/** Static validity of each void act (D2). */
export function voidInfos(ctx: Ctx): VoidInfo[] {
  const cached = ctx.cache.get("voidInfos") as VoidInfo[] | undefined;
  if (cached) return cached;
  const keys = registrarKeys(ctx);
  const counts = commitCounts(ctx);
  const out = ctx.voids.map((v): VoidInfo => {
    ctx.checkDeadline();
    return judgeVoid(ctx, v, keys, counts);
  });
  ctx.cache.set("voidInfos", out);
  return out;
}

// ---- replay (5.6) --------------------------------------------------------------------------

/** Replay the read in ledger order up to `cutoff` (5.6); two verifiers with the same read get the same effective set. */
export function replay(ctx: Ctx, cutoff: string): ReplayState {
  const id = `replay${cutoff}`;
  const cached = ctx.cache.get(id) as ReplayState | undefined;
  if (cached) return cached;
  const infos = voidInfos(ctx);
  const voids = ctx.voids
    .map((v, k) => ({ v, info: infos[k] }))
    .filter((x) => x.info.ok && atOrBefore(x.v.commit, cutoff))
    .sort((a, b) => cmpInstant(a.v.commit, b.v.commit));
  const st: ReplayState = { E: new Map(), chains: new Map(), monthCounts: new Map(), monthHashes: new Set(), twoXBySubject: new Set(), verdicts: new Map(), voidApplied: [], L9: newIndex() };
  const applyVoid = (x: { v: Json; info: VoidInfo }): void => {
    const t = x.info.target as LedgerEv;
    const m = monthOfEvent(t);
    const k = m === null ? null : eKey(t.event.subject, t.event.type, m);
    const hit = k !== null && st.E.get(k)?.hash === t.computed;
    if (hit) {
      st.E.delete(k as string);
      unfileCitations(st, k as string);
    }
    st.voidApplied.push({ target: t.computed, deleted: hit });
  };
  let vi = 0;
  for (const ev of ctx.events) {
    ctx.checkDeadline();
    if (!isInstant(ev.commit) || !atOrBefore(ev.commit, cutoff)) continue;
    while (vi < voids.length && before(voids[vi].v.commit, ev.commit)) applyVoid(voids[vi++]);
    replayEvent(ctx, st, ev);
  }
  while (vi < voids.length) applyVoid(voids[vi++]);
  ctx.cache.set(id, st);
  return st;
}

/** Per chain and month, the 2.0 events seen (for L12) and the hashes of the events seen (for L6 of a 1.x event). */
function countMonthEvent(st: ReplayState, ev: LedgerEv, chain: string, month: string): void {
  const key = `${chain}|${month}`;
  if (ev.kind === "2x") st.monthCounts.set(key, (st.monthCounts.get(key) ?? 0) + 1);
  st.monthHashes.add(`${key}|${ev.computed}`);
}

/** Judge one event against E and record it (5.6 steps 1 to 3). */
function replayEvent(ctx: Ctx, st: ReplayState, ev: LedgerEv): void {
  const s = staticRules(ctx, ev);
  const e = ev.event;
  const judged = isObject(e) && (e.type === PROFILE.eventTypes.energy || e.type === PROFILE.eventTypes.carbon) && typeof e.subject === "string";
  const dyn = judged ? stateRules(ctx, st, ev, s.month) : { reasons: [], ne: [] };
  const reasons = [...s.reasons, ...dyn.reasons];
  const skipped = reasons.length > 0 || !judged;
  st.verdicts.set(ev.i, { ...s, reasons, ne: [...s.ne, ...dyn.ne], skipped });
  if (!judged) return;
  const ck = chainKey(e.subject, e.type);
  if (!st.chains.has(ck)) st.chains.set(ck, []);
  (st.chains.get(ck) as ChainItem[]).push({ hash: ev.computed, kind: ev.kind, month: s.month, i: ev.i });
  if (s.month !== null) countMonthEvent(st, ev, ck, s.month);
  if (ev.kind === "2x") st.twoXBySubject.add(e.subject);
  if (skipped || s.month === null) return;
  const key = eKey(e.subject, e.type, s.month);
  unfileCitations(st, key);
  st.E.set(key, { hash: ev.computed as string, ev, month: s.month });
  fileCitations(ctx, st, key, ev);
}

