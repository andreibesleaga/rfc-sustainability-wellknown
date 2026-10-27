/**
 * S3: the `signed` member of a declaration (3.6 rule 4, 7.2 rule 2, 9.3 step 3).
 *
 * The payload comparison needs no key and always runs. A key counts only when the caller pinned it:
 * a key in the object's own header is trusted no further than the object. Ed25519 is verified as
 * section 10 requires (strict); ES256 (RFC 7518 3.4) under a pinned P-256 key.
 * Spec: https://github.com/andreibesleaga/awesome-blockchain-greentech/blob/main/Innovative%20Projects/SFC_COMPLIANCE.md (9.3 step 3, section 10)
 */
import { createPublicKey, verify as nodeVerify, type JsonWebKey } from "node:crypto";
import { SFC_LEDGER_PROFILE_2_0 as PROFILE } from "../sfc-ledger-profile";
import * as ed from "./ed25519";
import { readIJson, type ElementIssues, type IJsonIssues, type ReadError } from "./ijson";
import { labelOf } from "./decl";
import type { Pins, PinnedKey } from "./ledger";
import { canonicalize, FAIL, INFO, isObject, list, NE, PASS, row, unb64u, type Json, type Row } from "./primitives";

const MAC = /^HS\d+$/;
const NOT_PINNED = "signed, not verified against a pinned key";
const PAYLOAD_DIFFERS = "signed payload differs";
const ES256 = "ES256";

const deepEqual = (a: Json, b: Json): boolean => canonicalize(a) === canonicalize(b);

/** RFC 7515 requires UTF-8: invalid bytes throw, and a leading byte-order mark stays (it is not valid I-JSON text). */
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

// ---- pinned keys ---------------------------------------------------------------------------

/** A caller-pinned key as a JWK: a full JWK, or `{ x }` for an Ed25519 key. */
const toJwk = (pin: PinnedKey): PinnedKey => (pin.kty ? pin : { kty: "OKP", crv: "Ed25519", x: pin.x });

function verifyEs256(jwk: PinnedKey, signingInput: Buffer, signature: Buffer): boolean {
  try {
    const key = createPublicKey({ key: jwk as JsonWebKey, format: "jwk" });
    return nodeVerify("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" }, signature);
  } catch {
    return false;
  }
}

function verifyEd25519Pin(jwk: PinnedKey, signingInput: Buffer, signature: Buffer): boolean {
  const pub = jwk.kty === "OKP" && jwk.crv === "Ed25519" ? unb64u(jwk.x) : null;
  return !!pub && ed.verify(pub, signingInput, signature).ok;
}

/** Does the signature verify under this pinned key, for this algorithm? A key of another type never verifies. */
function verifyPinned(alg: string, jwk: PinnedKey, signingInput: Buffer, signature: Buffer): boolean {
  if (alg === PROFILE.signatureAlgorithm) return verifyEd25519Pin(jwk, signingInput, signature);
  return jwk.kty === "EC" && jwk.crv === "P-256" && verifyEs256(jwk, signingInput, signature);
}

// ---- reading the JWS -----------------------------------------------------------------------

interface Decoded {
  parts: string[];
  signature: Buffer;
  headerBytes: Buffer;
  payloadBytes: Buffer;
}

/** Split and decode a compact JWS into raw header and payload bytes; null when malformed. */
function decodeCompact(compact: string): Decoded | null {
  const parts = compact.split(".");
  if (parts.length !== 3) return null;
  const bytes = parts.map(unb64u);
  if (bytes.some((b) => !b)) return null;
  const [headerBytes, payloadBytes, signature] = bytes as Buffer[];
  return { parts, signature, headerBytes, payloadBytes };
}

type Part = { read: { value: Json; issues: IJsonIssues } } | { limit: string } | { error: string };

/** One JWS part as I-JSON: its value and issues, `{ limit }` for a document nested too deep, or `{ error }` naming the part. */
function readPart(bytes: Buffer, name: string): Part {
  try {
    return { read: readIJson(STRICT_UTF8.decode(bytes)) };
  } catch (e) {
    const limit = (e as ReadError).limit;
    return limit ? { limit } : { error: `malformed ${name}` };
  }
}

/** RFC 7515 section 4: header parameter names are unique, so a repeated name or an unpaired surrogate makes the header malformed. */
const headerIsClean = (issues: IJsonIssues): boolean => issues.duplicates.length === 0 && !issues.loneSurrogate;

type Parsed = { header: Json; payload: Json; payloadIssues: IJsonIssues } | { limit: string } | { error: string };

/** Header and payload as I-JSON, or the reason they cannot be read. */
function parseJws(decoded: Decoded): Parsed {
  const header = readPart(decoded.headerBytes, "header");
  if (!("read" in header)) return header;
  if (!headerIsClean(header.read.issues)) return { error: "malformed header" };
  const payload = readPart(decoded.payloadBytes, "payload");
  if (!("read" in payload)) return payload;
  return { header: header.read.value, payload: payload.read.value, payloadIssues: payload.read.issues };
}

// ---- findings ------------------------------------------------------------------------------

/** 7.2 rule 2: the signed payload equals the served object without `signed`; a duplicate member or lone surrogate fails it. */
function payloadProblem(obj: Json, payload: Json, payloadIssues: IJsonIssues, bodyIssues: ElementIssues | null): string | null {
  const { signed: _signed, ...served } = obj;
  const duplicates = (bodyIssues && (bodyIssues.duplicates.length || bodyIssues.loneSurrogate)) || payloadIssues.duplicates.length || payloadIssues.loneSurrogate;
  if (duplicates) return "duplicate member or lone surrogate";
  return deepEqual(payload, served) ? null : PAYLOAD_DIFFERS;
}

/** Header rules of the draft -10: `alg` none or MAC, `cty`, and any `crit` reject (this profile understands no critical header). */
function headerRejected(header: Json): boolean {
  if (!isObject(header) || typeof header.alg !== "string" || header.alg === "none" || MAC.test(header.alg)) return true;
  return header.cty !== "sustainability-data+json" || "crit" in header;
}

type KeyStep = { verified: true } | { failure: string } | { info: string } | { rejected: true };

/** The pinned keys of the right kind for this algorithm: OKP keys for Ed25519, EC keys for ES256. */
function candidateKeys(alg: string, level: string, pins: Pins): PinnedKey[] {
  const pinned = ((level === "operator" ? pins.operatorKeys : pins.publisherKeys) ?? []).map(toJwk);
  return pinned.filter((k) => (alg === PROFILE.signatureAlgorithm ? k.kty === "OKP" : k.kty === "EC"));
}

/**
 * Verify under the pinned keys. An operator declaration that claims SFC must use Ed25519 (7.2 rule 2).
 * A pinned key of the other type is no candidate: it can neither verify nor reject.
 */
function keyStep(alg: string, level: string, claims: boolean, pins: Pins, decoded: Decoded): KeyStep {
  if (level === "operator" && claims && alg !== PROFILE.signatureAlgorithm) return { failure: "operator declaration must use Ed25519" };
  if (alg !== PROFILE.signatureAlgorithm && alg !== ES256) return { info: "algorithm not supported" };
  const candidates = candidateKeys(alg, level, pins);
  if (!candidates.length) return { info: NOT_PINNED };
  const input = Buffer.from(`${decoded.parts[0]}.${decoded.parts[1]}`, "ascii");
  return candidates.some((k) => verifyPinned(alg, k, input, decoded.signature)) ? { verified: true } : { rejected: true };
}

interface Findings {
  fail: string[];
  info: string[];
  bad: (msg: string) => void;
}

/** Record the outcome of the key step; true when the signature verified and nothing else was found. */
function applyKeyStep(step: KeyStep, { fail, info, bad }: Findings): boolean {
  if ("failure" in step) fail.push(step.failure);
  else if ("info" in step) {
    if (!(step.info === NOT_PINNED && info.includes(PAYLOAD_DIFFERS))) info.push(step.info);
  } else if ("rejected" in step) bad("signature rejected");
  else return !fail.length && !info.includes(PAYLOAD_DIFFERS);
  return false;
}

/**
 * The S3 rows for one object. `claims` is whether it claims SFC; `bodyIssues` carries the duplicate and surrogate
 * findings of this object's own served text (a finding in a neighbouring object does not count).
 */
export function s3(obj: Json, level: string, claims: boolean, pins: Pins, bodyIssues: ElementIssues | null): Row[] {
  const label = labelOf(obj);
  if (typeof obj.signed !== "string") return [row("S3", INFO, "not signed", label)];
  const word = claims ? FAIL : INFO;
  const decoded = decodeCompact(obj.signed);
  if (!decoded) return [row("S3", word, "malformed JWS", label)];
  const jws = parseJws(decoded);
  if ("limit" in jws) return [row("S3", NE, `limit: ${jws.limit}`, label)];
  if ("error" in jws) return [row("S3", word, jws.error, label)];
  const fail: string[] = [];
  const info: string[] = [];
  const bad = (msg: string): void => {
    (claims ? fail : info).push(msg);
  };
  const problem = payloadProblem(obj, jws.payload, jws.payloadIssues, bodyIssues);
  if (problem) bad(claims ? problem : PAYLOAD_DIFFERS);
  if (headerRejected(jws.header)) bad("signature rejected");
  else if (applyKeyStep(keyStep(jws.header.alg, level, claims, pins, decoded), { fail, info, bad })) return [row("S3", PASS, "verified under a pinned key", label)];
  if (fail.length) return [row("S3", FAIL, list(fail), label)];
  return [row("S3", INFO, list(info), label)];
}
