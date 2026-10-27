/**
 * Member tables of the 2.0 forms (sections 5.1 to 5.8): the shape of events, Registry entries, void acts
 * and checkpoints. Each function returns a sorted list of tokens `shape:<path>`; empty means the value
 * validates against the matching schema in ../schemas/. The 1.x forms are in profile1x.mjs.
 */
import { isObject, isHex64, isB64Url, isDid, isHost, isHttpsUri, isUriAbs, isInt, isNum, isInstant, isMonthBound, isFullDate } from "./forms.mjs";

export const METHODS = ["hardware-metered", "hardware-estimated", "cloud-billing", "third-party-modeled"];
export const HARDWARE = ["general-purpose-x86", "arm64-server", "rpi-cluster", "cloud-instance", "accelerator-server"];
export const REUSE = ["donate-to-education", "resell-refurbished", "recycle-WEEE-certified"];
export const MAX_FIGURE = 999999999999999;

const STRING_MAX = 4096;
const isStr = (v) => typeof v === "string" && Buffer.byteLength(v, "utf8") <= STRING_MAX;
const isFigure = (v) => isNum(v, 0) && v <= MAX_FIGURE;

export function collect() {
  const bad = new Set();
  return { need: (ok, path) => { if (!ok) bad.add(`shape:${path}`); }, done: () => [...bad].sort() };
}

export const isSig = (s) => isObject(s) && typeof s.alg === "string" && typeof s.value === "string";
const isJwk = (j) => isObject(j) && j.kty === "OKP" && j.crv === "Ed25519" && isB64Url(j.x, 32) && j.x.length === 43;
const isPeriod2 = (p) => isObject(p) && isMonthBound(p.start) && isMonthBound(p.end);

export function eventShape(e) {
  const c = collect();
  if (!isObject(e)) { c.need(false, "event"); return c.done(); }
  c.need(e.type === "EnergyAttested" || e.type === "CarbonAttested", "type");
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
  if (e.type === "EnergyAttested") {
    c.need(isInt(p.nodeCount, 0), "payload.nodeCount");
    c.need(isFigure(p.kWhConsumed), "payload.kWhConsumed");
    c.need(METHODS.includes(p.measurementMethod), "payload.measurementMethod");
  } else if (e.type === "CarbonAttested") {
    c.need(p.scope1KgCO2e === undefined || isFigure(p.scope1KgCO2e), "payload.scope1KgCO2e");
    c.need(isFigure(p.scope2KgCO2e), "payload.scope2KgCO2e");
    c.need(p.scope2LocationKgCO2e === undefined || isFigure(p.scope2LocationKgCO2e), "payload.scope2LocationKgCO2e");
    c.need(isFigure(p.scope3KgCO2e), "payload.scope3KgCO2e");
    c.need(isStr(p.gridIntensityRef), "payload.gridIntensityRef");
    c.need(isFigure(p.offsetsKgCO2e), "payload.offsetsKgCO2e");
    c.need(typeof p.netZero === "boolean", "payload.netZero");
    const r = p.retirements;
    c.need(Array.isArray(r) && r.length <= 100, "payload.retirements");
    if (Array.isArray(r)) r.forEach((x, i) => {
      const ok = isObject(x) && isHttpsUri(x.registry) && isStr(x.registry) && typeof x.reference === "string" && x.reference.length > 0 && isStr(x.reference)
        && Number.isInteger(x.tonnesRetired) && x.tonnesRetired >= 1 && x.tonnesRetired <= MAX_FIGURE && isInstant(x.retiredAt)
        && isFigure(x.kg) && (x.beneficiary === undefined || isStr(x.beneficiary));
      c.need(ok, `payload.retirements[${i}]`);
    });
  }
  return c.done();
}

export function nodeProfileShape(n, c, path = "nodeProfile") {
  const ok = isObject(n) && HARDWARE.includes(n.hardwareClass) && n.asicForbidden === true
    && isFullDate(n.purchasedAt) && isFullDate(n.expectedRetireAt)
    && REUSE.includes(n.reusePolicy) && (n.serviceLifeMonths === undefined || isInt(n.serviceLifeMonths, 1));
  c.need(ok, path);
}

const keyShape = (k) => isObject(k) && isJwk(k.jwk) && isInstant(k.validFromCommit) && (k.validToCommit === null || isInstant(k.validToCommit));
const intervalShape = (a) => isObject(a) && isMonthBound(a.from) && (a.to === null || isMonthBound(a.to));

export function entryShape(en) {
  const c = collect();
  if (!isObject(en)) { c.need(false, "entry"); return c.done(); }
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
