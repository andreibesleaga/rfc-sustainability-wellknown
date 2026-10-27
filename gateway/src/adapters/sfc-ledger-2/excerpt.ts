/**
 * The ledger excerpt of format version 2 (5.8): the interchange document a
 * ledger read is carried in. This reader checks the structure the schema
 * `ledger-excerpt.json` states (member presence, types, forms, the limits of
 * section 10) and refuses a malformed excerpt with `[E-SHAPE]`. Rules that need
 * more than one member (L4 to L12, ledger order, Registry uniqueness) are the
 * checks' business, not the reader's.
 *
 * Format version 1 (the 1.x excerpt) is read by `readExcerpt` in
 * `../sfc-ledger-bridge.ts`; `excerptFormatOf` tells the two apart.
 *
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (5.8, Appendix A)
 * Schema: https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/sfc-compliance/schemas/ledger-excerpt.json
 */
import { SFC_LEDGER_PROFILE_2_0 as PROFILE, profile2For, type SfcLedger2Profile } from "../sfc-ledger-profile";
import { checkpointShape, entry1xShape, entryShape, is1xEntry, isJwk, voidShape } from "./shape";
import { isHex64, isHost, isInstant, isObject, type Json } from "./primitives";

/** A refusal of the 2.0 bridge or reader; tests and logs match on the bracketed code. */
export const BRIDGE_2_CODES = ["E-SHAPE", "E-PERIOD", "E-OPERATOR", "E-UPDATED", "E-LEDGER", "E-DISCLOSURE", "E-CONFIG"] as const;
export type Bridge2Code = (typeof BRIDGE_2_CODES)[number];

export class Bridge2Error extends Error {
  constructor(readonly code: Bridge2Code, what: string) {
    super(`sfc-ledger-bridge: [${code}] ${what}`);
    this.name = "BridgeError";
  }
}

export function refuse2(code: Bridge2Code, what: string): never {
  throw new Bridge2Error(code, what);
}

/** One entry of `ledger`: the commit instant, the hash of the event, and the event as received (3.6 rule 3: unknown members kept). */
export interface LedgerEntryV2 {
  commit: string;
  hash: string;
  event: Json;
}

/** An excerpt of format version 2, structurally read. Members the profile does not name are kept (they enter every hash). */
export interface LedgerExcerptV2 {
  "excerpt-version": 2;
  "profile-version": string;
  network: string;
  "read-at": string;
  registrar: { jwk: Json };
  registry: Json[];
  ledger: LedgerEntryV2[];
  voids?: Json[];
  checkpoint?: Json;
  notice?: string;
}

export interface ReadExcerptV2 {
  excerpt: LedgerExcerptV2;
  profile: SfcLedger2Profile;
}

/** Which excerpt format a raw document is: 2 (`excerpt-version`), 1 (`fixture-version`), or undefined. */
export function excerptFormatOf(raw: unknown): 1 | 2 | undefined {
  if (!isObject(raw)) return undefined;
  if (raw["excerpt-version"] !== undefined) return raw["excerpt-version"] === PROFILE.excerptVersion ? 2 : undefined;
  return raw["fixture-version"] === 1 ? 1 : undefined;
}

const need = (ok: boolean, path: string, what: string): void => {
  if (!ok) refuse2("E-SHAPE", `${path}: ${what}`);
};

function readRegistry(raw: Json): Json[] {
  need(Array.isArray(raw.registry), "excerpt.registry", "an array is required");
  need(raw.registry.length <= PROFILE.limits.registryEntries, "excerpt.registry", `${raw.registry.length} entries exceed the ${PROFILE.limits.registryEntries} this reader reads`);
  raw.registry.forEach((en: Json, i: number) => {
    const tokens = is1xEntry(en) ? entry1xShape(en) : entryShape(en);
    need(tokens.length === 0, `excerpt.registry[${i}]`, `not a Registry entry (${tokens.join(", ")})`);
  });
  return raw.registry;
}

function readLedger(raw: Json): LedgerEntryV2[] {
  need(Array.isArray(raw.ledger), "excerpt.ledger", "an array is required");
  const perChain = new Map<string, number>();
  return raw.ledger.map((l: Json, i: number): LedgerEntryV2 => {
    const p = `excerpt.ledger[${i}]`;
    need(isObject(l) && isInstant(l.commit) && isHex64(l.hash) && isObject(l.event), p, "{commit, hash, event} is required");
    need(isObject(l.event.payload) && typeof l.event.type === "string" && typeof l.event.subject === "string", `${p}.event`, "type, subject and payload are required");
    const k = `${l.event.subject}|${l.event.type}`;
    perChain.set(k, (perChain.get(k) ?? 0) + 1);
    need((perChain.get(k) as number) <= PROFILE.limits.eventsPerChain, `${p}.event`, `more than ${PROFILE.limits.eventsPerChain} events in one chain`);
    return { commit: l.commit, hash: l.hash, event: l.event };
  });
}

/** A received value for an error text: a string of at most 16 characters, a number, or its type. Never an unbounded echo of hostile input. */
export function shortValue(v: unknown): string {
  if (v === undefined) return "absent";
  if (typeof v === "number") return String(v);
  if (typeof v === "string" && v.length <= 16) return JSON.stringify(v);
  return `of type ${Array.isArray(v) ? "array" : typeof v}`;
}

/**
 * Read an excerpt of format version 2. Refuses `[E-SHAPE]` naming the member when
 * the document is not one, or `profile-version` is not `2.<digits>` (12.2 rule 3).
 */
export function readExcerptV2(raw: unknown): ReadExcerptV2 {
  need(isObject(raw), "excerpt", "an object is required");
  const o = raw as Json;
  need(o["excerpt-version"] === PROFILE.excerptVersion, "excerpt.excerpt-version", `${shortValue(o["excerpt-version"])} is not ${PROFILE.excerptVersion}`);
  const profile = profile2For(o["profile-version"]);
  need(profile !== undefined, "excerpt.profile-version", `unsupported value ${shortValue(o["profile-version"])} (this reader reads 2.<digits>)`);
  need(isHost(o.network), "excerpt.network", "a host is required");
  need(isInstant(o["read-at"]), "excerpt['read-at']", "an RFC 3339 instant is required");
  need(isObject(o.registrar) && isJwk(o.registrar.jwk), "excerpt.registrar", "{jwk} with an Ed25519 OKP key is required");
  const registry = readRegistry(o);
  const ledger = readLedger(o);
  if (o.voids !== undefined) {
    need(Array.isArray(o.voids) && o.voids.length <= PROFILE.limits.voids, "excerpt.voids", "an array of void acts is required");
    o.voids.forEach((v: Json, i: number) => need(voidShape(v).length === 0, `excerpt.voids[${i}]`, "a void act has exactly commit, target and sig"));
  }
  if (o.checkpoint !== undefined) need(checkpointShape(o.checkpoint).length === 0, "excerpt.checkpoint", "a checkpoint has only the members of 5.8");
  need(o.notice === undefined || typeof o.notice === "string", "excerpt.notice", "a string is required");
  const excerpt: LedgerExcerptV2 = { ...o, registry, ledger } as LedgerExcerptV2;
  return { excerpt, profile: profile as SfcLedger2Profile };
}
