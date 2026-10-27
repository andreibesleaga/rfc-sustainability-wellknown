/**
 * Member-table checks (sections 5.1 to 5.8): the shape of events, Registry
 * entries, void acts and checkpoints. Each function returns a sorted list of
 * tokens `shape:<path>`; an empty list means the value validates against the
 * matching schema in
 * https://github.com/andreibesleaga/rfc-sustainability-wellknown/tree/main/sfc-compliance/schemas/
 * (the schemas are generated from the same member tables).
 */
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../sfc-ledger-profile";
import { isB64Url, isDid, isFullDate, isHex64, isHost, isHttpsUri, isInstant, isInt, isMonthBound, isNum, isObject, isUriAbs, type Json } from "./primitives";

export const METHODS = PROFILE.measurementMethods;
const HARDWARE = PROFILE.hardwareClasses;
const REUSE = PROFILE.reusePolicies;
/** 10^15 - 1: the largest figure 3.3 rule 2 admits. */
export const MAX_FIGURE = 999_999_999_999_999;

const STRING_MAX = PROFILE.limits.stringBytes;
const isStr = (v: unknown): boolean => typeof v === "string" && Buffer.byteLength(v, "utf8") <= STRING_MAX;
const isFigure = (v: unknown): boolean => isNum(v, 0) && v <= MAX_FIGURE;

interface Collector {
  need(ok: boolean, path: string): void;
  done(): string[];
}
function collect(): Collector {
  const bad = new Set<string>();
  return {
    need: (ok, path) => {
      if (!ok) bad.add(`shape:${path}`);
    },
    done: () => [...bad].sort(),
  };
}

export const isSig = (s: unknown): boolean => isObject(s) && typeof s.alg === "string" && typeof s.value === "string";
export const isJwk = (j: unknown): boolean => isObject(j) && j.kty === "OKP" && j.crv === "Ed25519" && isB64Url(j.x, 32) && (j.x as string).length === 43;
const isPeriod2 = (p: unknown): boolean => isObject(p) && isMonthBound(p.start) && isMonthBound(p.end);

/** True for a 1.x-form payload: a `period` with `from` and `to` (12.1 rule 1). */
export const is1xEvent = (e: unknown): boolean => isObject(e) && isObject(e.payload) && isObject(e.payload.period) && ("from" in e.payload.period || "to" in e.payload.period);

function retirementOk(x: Json): boolean {
  return (
    isObject(x) &&
    isHttpsUri(x.registry) &&
    isStr(x.registry) &&
    typeof x.reference === "string" &&
    x.reference.length > 0 &&
    isStr(x.reference) &&
    Number.isInteger(x.tonnesRetired) &&
    x.tonnesRetired >= 1 &&
    x.tonnesRetired <= MAX_FIGURE &&
    isInstant(x.retiredAt) &&
    isFigure(x.kg) &&
    (x.beneficiary === undefined || isStr(x.beneficiary))
  );
}

function energyPayloadShape(p: Json, c: Collector): void {
  c.need(isInt(p.nodeCount, 0), "payload.nodeCount");
  c.need(isFigure(p.kWhConsumed), "payload.kWhConsumed");
  c.need(METHODS.includes(p.measurementMethod), "payload.measurementMethod");
}

function carbonPayloadShape(p: Json, c: Collector): void {
  c.need(p.scope1KgCO2e === undefined || isFigure(p.scope1KgCO2e), "payload.scope1KgCO2e");
  c.need(isFigure(p.scope2KgCO2e), "payload.scope2KgCO2e");
  c.need(p.scope2LocationKgCO2e === undefined || isFigure(p.scope2LocationKgCO2e), "payload.scope2LocationKgCO2e");
  c.need(isFigure(p.scope3KgCO2e), "payload.scope3KgCO2e");
  c.need(isStr(p.gridIntensityRef), "payload.gridIntensityRef");
  c.need(isFigure(p.offsetsKgCO2e), "payload.offsetsKgCO2e");
  c.need(typeof p.netZero === "boolean", "payload.netZero");
  const r = p.retirements;
  c.need(Array.isArray(r) && r.length <= PROFILE.limits.retirements, "payload.retirements");
  if (Array.isArray(r)) r.forEach((x, i) => c.need(retirementOk(x), `payload.retirements[${i}]`));
}

/** Shape of a 2.0 event (5.2 to 5.4). */
export function eventShape(e: Json): string[] {
  const c = collect();
  if (!isObject(e)) {
    c.need(false, "event");
    return c.done();
  }
  c.need(e.type === PROFILE.eventTypes.energy || e.type === PROFILE.eventTypes.carbon, "type");
  c.need(isHost(e.network), "network");
  c.need(isDid(e.subject), "subject");
  c.need(isDid(e.actor), "actor");
  c.need(e.prev === null || isHex64(e.prev), "prev");
  c.need(isInstant(e.ts), "ts");
  c.need(isObject(e.payload), "payload");
  c.need(isSig(e.sig), "sig");
  if (!isObject(e.payload)) return c.done();
  const p = e.payload;
  c.need(isPeriod2(p.period), "payload.period");
  c.need(isUriAbs(p.evidence) && isStr(p.evidence), "payload.evidence");
  c.need(p.supersedes === undefined || isHex64(p.supersedes), "payload.supersedes");
  if (e.type === PROFILE.eventTypes.energy) energyPayloadShape(p, c);
  else if (e.type === PROFILE.eventTypes.carbon) carbonPayloadShape(p, c);
  return c.done();
}

/** Shape of a 1.x event: only what 12.1 needs to read it. */
export function event1xShape(e: Json): string[] {
  const c = collect();
  if (!isObject(e)) {
    c.need(false, "event");
    return c.done();
  }
  c.need(e.type === PROFILE.eventTypes.energy || e.type === PROFILE.eventTypes.carbon, "type");
  c.need(isDid(e.subject), "subject");
  c.need(isDid(e.actor), "actor");
  c.need(e.prev === null || isHex64(e.prev), "prev");
  c.need(isInstant(e.ts), "ts");
  c.need(isObject(e.payload), "payload");
  c.need(isSig(e.sig), "sig");
  if (isObject(e.payload)) {
    const p = e.payload;
    c.need(isObject(p.period) && typeof p.period.from === "string" && typeof p.period.to === "string", "payload.period"); // dates are read by 12.1 rule 1
    c.need(p.supersedes === undefined || isHex64(p.supersedes), "payload.supersedes");
  }
  return c.done();
}

/** `nodeProfile` (5.1): the hardware declaration of C2. */
export function nodeProfileShape(n: Json, c: Collector, path = "nodeProfile"): void {
  const ok =
    isObject(n) &&
    HARDWARE.includes(n.hardwareClass) &&
    n.asicForbidden === true &&
    isFullDate(n.purchasedAt) &&
    isFullDate(n.expectedRetireAt) &&
    REUSE.includes(n.reusePolicy) &&
    (n.serviceLifeMonths === undefined || isInt(n.serviceLifeMonths, 1));
  c.need(ok, path);
}

const keyShape = (k: Json): boolean => isObject(k) && isJwk(k.jwk) && isInstant(k.validFromCommit) && (k.validToCommit === null || isInstant(k.validToCommit));
const intervalShape = (a: Json): boolean => isObject(a) && isMonthBound(a.from) && (a.to === null || isMonthBound(a.to));

/** Shape of a 2.0 Registry entry (5.1). */
export function entryShape(en: Json): string[] {
  const c = collect();
  if (!isObject(en)) {
    c.need(false, "entry");
    return c.done();
  }
  c.need(isDid(en.operator), "operator");
  c.need(isHost(en.origin), "origin");
  c.need(isHost(en.network), "network");
  c.need(Array.isArray(en.active) && en.active.length >= 1 && en.active.length <= 100 && en.active.every(intervalShape), "active");
  c.need(Array.isArray(en.keys) && en.keys.length >= 1 && en.keys.length <= 100 && en.keys.every(keyShape), "keys");
  nodeProfileShape(en.nodeProfile, c);
  c.need(en.version === undefined || isInt(en.version, 1), "version");
  c.need(en.profile2From === undefined || isMonthBound(en.profile2From), "profile2From");
  c.need(isSig(en.sig), "sig");
  for (const k of ["commit", "target", "read-at", "chains"]) c.need(!(k in en), `forbidden:${k}`);
  return c.done();
}

/** A 1.x entry: `keys[].public-jwk` and no `sig` (12.1 rule 6). */
export const is1xEntry = (en: unknown): boolean => isObject(en) && !("sig" in en) && Array.isArray(en.keys) && en.keys.some((k: Json) => isObject(k) && "public-jwk" in k);

/** Shape of a void act (5.4): exactly `commit`, `target` and `sig`. */
export function voidShape(v: Json): string[] {
  const c = collect();
  c.need(isObject(v) && Object.keys(v).length === 3 && isInstant(v.commit) && isHex64(v.target) && isSig(v.sig), "void");
  return c.done();
}

const CHECKPOINT_MEMBERS = ["network", "read-at", "chains", "registry-digest", "ledger-digest", "voids-digest", "sig"];
const chainEntryOk = (x: Json): boolean =>
  isObject(x) && isDid(x.operator) && (x.type === PROFILE.eventTypes.energy || x.type === PROFILE.eventTypes.carbon) && (x.tip === null || isHex64(x.tip)) && isInt(x.count, 0);

/** Shape of a checkpoint (5.8): only the members listed there. */
export function checkpointShape(cp: Json): string[] {
  const c = collect();
  const ok =
    isObject(cp) &&
    Object.keys(cp).every((k) => CHECKPOINT_MEMBERS.includes(k)) &&
    isHost(cp.network) &&
    isInstant(cp["read-at"]) &&
    Array.isArray(cp.chains) &&
    cp.chains.length <= PROFILE.limits.checkpointChains &&
    cp.chains.every(chainEntryOk) &&
    ["registry-digest", "ledger-digest", "voids-digest"].every((k) => cp[k] === undefined || isHex64(cp[k])) &&
    isSig(cp.sig);
  c.need(ok, "checkpoint");
  return c.done();
}

/** Shape of a 1.x Registry entry (12.1 rule 6): full-date intervals, `public-jwk` keys, no `sig`. */
export function entry1xShape(en: Json): string[] {
  const c = collect();
  if (!isObject(en)) {
    c.need(false, "entry");
    return c.done();
  }
  c.need(isDid(en.operator), "operator");
  c.need(isHost(en.origin), "origin");
  c.need(Array.isArray(en.active) && en.active.length >= 1 && en.active.every((a: Json) => isObject(a) && isFullDate(a.from) && (a.to === null || isFullDate(a.to))), "active");
  c.need(
    Array.isArray(en.keys) &&
      en.keys.length >= 1 &&
      en.keys.every((k: Json) => isObject(k) && isJwk(k["public-jwk"]) && isInstant(k["valid-from-commit"]) && (k["valid-to-commit"] === null || isInstant(k["valid-to-commit"]))),
    "keys",
  );
  c.need(
    en.nodeProfile === undefined ||
      (() => {
        const cc = collect();
        nodeProfileShape(en.nodeProfile, cc);
        return cc.done().length === 0;
      })(),
    "nodeProfile",
  );
  return c.done();
}
