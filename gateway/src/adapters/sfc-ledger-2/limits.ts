/**
 * The limits of section 10 and the scan that finds which of them a ledger read
 * hits. Exceeding a limit is never FAIL and never PASS: it is NOT-EVALUABLE with
 * the limit named, for the result that needs the unread data.
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (section 10, Limits)
 */
import { SFC_LEDGER_PROFILE_2_0 as PROFILE, type SfcLimits } from "../sfc-ledger-profile";
import type { Json } from "./primitives";

export const DEFAULT_LIMITS: SfcLimits = PROFILE.limits;
/** The defaults with the caller's overrides (a checker that raises or lowers a limit prints the value in D9). */
export const withLimits = (override?: Partial<SfcLimits>): SfcLimits => ({ ...DEFAULT_LIMITS, ...(override ?? {}) });

/** Limits on the size or count of the read itself: a read that hits one is not walked at all (D1 stops the deep check). */
const STOPPING_LIMITS = ["bytes per read", "events per chain", "entries in voids", "entries in the Registry"];
export const stopsDeepCheck = (hits: LimitHit[]): boolean => hits.some((h) => STOPPING_LIMITS.includes(h.limit));

export interface LimitHit {
  limit: string;
  /** An event index for event-scoped limits, else null. */
  event: number | null;
}

function depthOf(v: Json): number {
  if (v === null || typeof v !== "object") return 0;
  const kids: Json[] = Array.isArray(v) ? v : Object.values(v);
  return 1 + kids.reduce((deepest, kid) => Math.max(deepest, depthOf(kid)), 0); // no spread: a long array would overflow the argument stack
}
function strings(v: Json, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (v !== null && typeof v === "object") for (const k of Array.isArray(v) ? v : Object.values(v)) strings(k, out);
  return out;
}
function longestArray(v: Json, skipKeys: string[]): number {
  let max = 0;
  const walk = (x: Json, key: string | undefined): void => {
    if (Array.isArray(x)) {
      if (key === undefined || !skipKeys.includes(key)) max = Math.max(max, x.length);
      x.forEach((y) => walk(y, undefined));
    } else if (x !== null && typeof x === "object") for (const [k, y] of Object.entries(x)) walk(y, k);
  };
  walk(v, undefined);
  return max;
}
const ARRAYS_WITH_OWN_LIMITS = ["ledger", "registry", "operators", "chains", "voids"];

/** Event-scoped limits of one ledger entry. */
function scanEvent(e: Json, index: number, limits: SfcLimits, add: (limit: string, event?: number | null) => void): void {
  if (Buffer.byteLength(JSON.stringify(e)) > limits.eventBytes) add("bytes per event", index);
  if (Array.isArray(e?.payload?.retirements) && e.payload.retirements.length > limits.retirements) add("retirements per event", index);
  if (strings(e).some((s) => Buffer.byteLength(s) > limits.stringBytes)) add("bytes in a string value", index);
  if (depthOf(e) > limits.nesting) add("JSON nesting depth", index);
  if (longestArray(e, ["retirements"]) > limits.arrayItems) add("items in one array", index);
}

/** Which limits of section 10 the excerpt `ex` hits. `maxLiteral` is the longest number literal of its raw text, when known. */
export function scanLimits(ex: Json, limits: SfcLimits, maxLiteral: number | undefined, params: Json): LimitHit[] {
  const hits: LimitHit[] = [];
  const add = (limit: string, event: number | null = null): void => {
    hits.push({ limit, event });
  };
  const ledger: Json[] = ex.ledger ?? [];
  const registry: Json[] = ex.registry ?? [];
  if (Buffer.byteLength(JSON.stringify(ex)) > limits.readBytes) add("bytes per read");
  if (registry.length > limits.registryEntries) add("entries in the Registry");
  if ((ex.voids ?? []).length > limits.voids) add("entries in voids");
  if ((ex.checkpoint?.chains ?? []).length > limits.checkpointChains) add("entries in checkpoint.chains");
  if (new Set(ledger.map((l) => l.event?.subject)).size > limits.operators) add("operators in a read");
  const perChain = new Map<string, number>();
  ledger.forEach((l, i) => {
    const k = `${l.event?.subject}|${l.event?.type}`;
    perChain.set(k, (perChain.get(k) ?? 0) + 1);
    if (perChain.get(k) === limits.eventsPerChain + 1) add("events per chain");
    scanEvent(l.event, i, limits, add);
  });
  if (depthOf(ex) > limits.nesting && !hits.some((h) => h.limit === "JSON nesting depth")) add("JSON nesting depth");
  if (longestArray({ ...ex, ledger: [], registry: [], voids: [], checkpoint: undefined }, ARRAYS_WITH_OWN_LIMITS) > limits.arrayItems) add("items in one array");
  if (registry.some((en) => longestArray(en, []) > limits.arrayItems)) add("items in one array");
  if (maxLiteral !== undefined && maxLiteral > limits.literalChars) add("characters in a number literal");
  if (Object.values(params ?? {}).some((v) => Array.isArray(v) && v.length > limits.parameterArray)) add("entries in each parameters array");
  return hits;
}
