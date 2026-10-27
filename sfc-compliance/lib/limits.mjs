/** Limits of section 10 and the scan that finds which of them an excerpt hits. */
export const DEFAULT_LIMITS = {
  declarationBytes: 1048576, readBytes: 67108864, nesting: 32, operators: 1000, registryEntries: 1000,
  eventsPerChain: 10000, retirements: 100, literalChars: 32, stringBytes: 4096, eventBytes: 65536,
  arrayItems: 100, checkpointChains: 2000, voids: 10000, parameterArray: 1000, declarationObjects: 16,
  maxReadAgeSeconds: 86400, skewSeconds: 300, secondsPerCheck: 600,
};

/** The reader stops at this nesting depth; 33 to 64 still reaches the limit scan of section 10, deeper is a limit at once. */
export const MAX_JSON_DEPTH = 64;
export const NESTING_LIMIT = "JSON nesting depth";

/** Limits on the size or count of the read itself: a read that hits one is not walked at all (D1 stops the deep check). */
const STOPPING_LIMITS = ["bytes per read", "events per chain", "entries in voids", "entries in the Registry"];
export const stopsDeepCheck = (hits) => hits.some((h) => STOPPING_LIMITS.includes(h.limit));

export const withLimits = (override) => ({ ...DEFAULT_LIMITS, ...(override ?? {}) });

function depthOf(v) {
  if (v === null || typeof v !== "object") return 0;
  const kids = Array.isArray(v) ? v : Object.values(v);
  return 1 + kids.reduce((deepest, kid) => Math.max(deepest, depthOf(kid)), 0); // no spread: a long array would overflow the argument stack
}
function strings(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (v !== null && typeof v === "object") for (const k of Array.isArray(v) ? v : Object.values(v)) strings(k, out);
  return out;
}
function longestArray(v, skipKeys) {
  let max = 0;
  const walk = (x, key) => {
    if (Array.isArray(x)) { if (!skipKeys.includes(key)) max = Math.max(max, x.length); x.forEach((y) => walk(y, undefined)); }
    else if (x !== null && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  walk(v, undefined);
  return max;
}
const ARRAYS_WITH_OWN_LIMITS = ["ledger", "registry", "operators", "chains", "voids"];

const lengthOf = (list) => (list ?? []).length;

/** Limits on the size of the read and the counts of its top-level lists. */
function readSizeHits(ex, limits, add) {
  if (Buffer.byteLength(JSON.stringify(ex)) > limits.readBytes) add("bytes per read");
  if (lengthOf(ex.registry) > limits.registryEntries) add("entries in the Registry");
  if (lengthOf(ex.voids) > limits.voids) add("entries in voids");
  if (lengthOf(ex.checkpoint?.chains) > limits.checkpointChains) add("entries in checkpoint.chains");
  const subjects = new Set((ex.ledger ?? []).map((l) => l.event?.subject));
  if (subjects.size > limits.operators) add("operators in a read");
}

/** Limits on one event: size, retirements, string bytes, nesting, array items. */
function eventHits(e, limits, add) {
  if (Buffer.byteLength(JSON.stringify(e)) > limits.eventBytes) add("bytes per event");
  if (Array.isArray(e?.payload?.retirements) && e.payload.retirements.length > limits.retirements) add("retirements per event");
  if (strings(e).some((s) => Buffer.byteLength(s) > limits.stringBytes)) add("bytes in a string value");
  if (depthOf(e) > limits.nesting) add("JSON nesting depth");
  if (longestArray(e, ["retirements"]) > limits.arrayItems) add("items in one array");
}

/** Limits on the ledger: events per chain, then each event's own limits (scoped to the event index). */
function ledgerHits(ex, limits, add) {
  const perChain = new Map();
  (ex.ledger ?? []).forEach((l, i) => {
    const k = `${l.event?.subject}|${l.event?.type}`;
    perChain.set(k, (perChain.get(k) ?? 0) + 1);
    if (perChain.get(k) === limits.eventsPerChain + 1) add("events per chain");
    eventHits(l.event, limits, (limit) => add(limit, i));
  });
}

/** Limits on the rest of the read: its own nesting, arrays outside the lists with their own limit, number literals, parameters. */
function restHits(ex, limits, rawIssues, params, hits, add) {
  if (depthOf(ex) > limits.nesting && !hits.some((h) => h.limit === "JSON nesting depth")) add("JSON nesting depth");
  if (longestArray({ ...ex, ledger: [], registry: [], voids: [], checkpoint: undefined }, ARRAYS_WITH_OWN_LIMITS) > limits.arrayItems) add("items in one array");
  if ((ex.registry ?? []).some((en) => longestArray(en, []) > limits.arrayItems)) add("items in one array");
  if (rawIssues && rawIssues.maxLiteral > limits.literalChars) add("characters in a number literal");
  if (Object.values(params ?? {}).some((v) => Array.isArray(v) && v.length > limits.parameterArray)) add("entries in each parameters array");
}

/** Returns [{ limit, event }] where `event` is an event index for event-scoped limits, else null. */
export function scanLimits(ex, limits, rawIssues, params) {
  const hits = [];
  const add = (limit, event = null) => hits.push({ limit, event });
  readSizeHits(ex, limits, add);
  ledgerHits(ex, limits, add);
  restHits(ex, limits, rawIssues, params, hits, add);
  return hits;
}
