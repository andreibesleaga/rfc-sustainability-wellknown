/**
 * S3: the `signed` member of a declaration (3.6 rule 4, 7.2 rule 2, 9.3 step 3).
 *
 * The payload comparison needs no key and always runs. A key counts only when the caller pinned it:
 * a key in the object's own header is trusted no further than the object. Ed25519 is verified as
 * section 10 requires (strict); ES256 under a pinned P-256 key.
 */
import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { canonicalize, unb64u } from "./canonical.mjs";
import { verifyEd25519 } from "./ed25519.mjs";
import { readIJson } from "./ijson.mjs";
import { isObject } from "./forms.mjs";
import { row, PASS, FAIL, NE, INFO, list } from "./rows.mjs";
import { labelOf } from "./declaration.mjs";

const MAC = /^HS\d+$/;
const NOT_PINNED = "signed, not verified against a pinned key";

const deepEqual = (a, b) => canonicalize(a) === canonicalize(b);

/** A caller-pinned key as a JWK: a full JWK, or `{ x }` for an Ed25519 key. */
const toJwk = (pin) => (pin.kty ? pin : { kty: "OKP", crv: "Ed25519", x: pin.x });

function verifyEs256(jwk, signingInput, signature) {
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    return nodeVerify("sha256", signingInput, { key, dsaEncoding: "ieee-p1363" }, signature);
  } catch { return false; }
}
function verifyPinned(alg, jwk, signingInput, signature) {
  if (alg === "Ed25519") {
    const pub = jwk.kty === "OKP" && jwk.crv === "Ed25519" ? unb64u(jwk.x) : null;
    return Boolean(pub) && verifyEd25519(pub, signingInput, signature).ok;
  }
  return jwk.kty === "EC" && jwk.crv === "P-256" && verifyEs256(jwk, signingInput, signature);
}

/** RFC 7515 requires UTF-8: invalid bytes throw, and a leading byte-order mark stays (it is not valid I-JSON text). */
const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const strictText = (bytes) => strict.decode(bytes);

/** Split and decode a compact JWS into raw header and payload bytes; null when malformed. */
function decodeCompact(compact) {
  const parts = compact.split(".");
  if (parts.length !== 3) return null;
  const bytes = parts.map(unb64u);
  if (bytes.some((b) => !b)) return null;
  return { parts, signature: bytes[2], headerBytes: bytes[0], payloadBytes: bytes[1] };
}

/** One JWS part as I-JSON: { read }, { limit } for a document nested too deep, or { error } naming the part. */
function readPart(bytes, name) {
  try { return { read: readIJson(strictText(bytes)) }; } catch (e) { return e.limit ? { limit: e.limit } : { error: `malformed ${name}` }; }
}

/** RFC 7515 section 4: header parameter names are unique, so a repeated name or an unpaired surrogate makes the header malformed. */
const headerIsClean = ({ issues }) => issues.duplicates.length === 0 && !issues.loneSurrogate;

/** Header and payload as I-JSON, or the reason they cannot be read: { error } or { limit }. */
function parseJws(decoded) {
  const header = readPart(decoded.headerBytes, "header");
  if (!header.read) return header;
  if (!headerIsClean(header.read)) return { error: "malformed header" };
  const payload = readPart(decoded.payloadBytes, "payload");
  if (!payload.read) return payload;
  return { header: header.read.value, payload: payload.read.value, payloadIssues: payload.read.issues };
}

/** 7.2 rule 2: the signed payload equals the served object without `signed`; a duplicate member or lone surrogate fails it. */
function payloadProblem(obj, payload, payloadIssues, bodyIssues) {
  const { signed, ...served } = obj;
  const duplicates = (bodyIssues && (bodyIssues.duplicates.length || bodyIssues.loneSurrogate)) || payloadIssues.duplicates.length || payloadIssues.loneSurrogate;
  if (duplicates) return "duplicate member or lone surrogate";
  return deepEqual(payload, served) ? null : "signed payload differs";
}

/** Header rules of the draft -10: `alg` none or MAC, `cty`, and any `crit` reject (this profile understands no critical header). Returns { rejected }. */
function headerFinding(header) {
  if (!isObject(header) || typeof header.alg !== "string" || header.alg === "none" || MAC.test(header.alg)) return { rejected: true };
  return { rejected: header.cty !== "sustainability-data+json" || "crit" in header };
}

/**
 * Verify under the pinned keys. Returns { verified } or { failure } or { info }.
 * Operator declarations that claim SFC must use Ed25519 (7.2 rule 2).
 */
function keyStep(alg, level, claims, pins, decoded) {
  if (level === "operator" && claims && alg !== "Ed25519") return { failure: "operator declaration must use Ed25519" };
  if (alg !== "Ed25519" && alg !== "ES256") return { info: "algorithm not supported" };
  const pinned = ((level === "operator" ? pins.operatorKeys : pins.publisherKeys) ?? []).map(toJwk);
  const candidates = pinned.filter((k) => (alg === "Ed25519" ? k.kty === "OKP" : k.kty === "EC"));
  if (!candidates.length) return { info: NOT_PINNED };
  const input = Buffer.from(`${decoded.parts[0]}.${decoded.parts[1]}`, "ascii");
  return candidates.some((k) => verifyPinned(alg, k, input, decoded.signature)) ? { verified: true } : { rejected: true };
}

const PAYLOAD_DIFFERS = "signed payload differs";

/** Record the outcome of the key step in `fail` and `info`; true when the signature verified and nothing else was found. */
function applyKeyStep(step, { fail, info, bad }) {
  if (step.failure) fail.push(step.failure);
  else if (step.info) { if (!(step.info === NOT_PINNED && info.includes(PAYLOAD_DIFFERS))) info.push(step.info); }
  else if (step.rejected) bad("signature rejected");
  else return !fail.length && !info.includes(PAYLOAD_DIFFERS);
  return false;
}

/**
 * The S3 rows for one object. `claims` is whether it claims SFC; `bodyIssues` carries the duplicate and
 * surrogate findings of this object's own served text (a finding in a neighbouring object does not count).
 */
export function s3(obj, level, claims, pins, bodyIssues) {
  const label = labelOf(obj);
  if (typeof obj.signed !== "string") return [row("S3", INFO, "not signed", label)];
  const word = claims ? FAIL : INFO;
  const decoded = decodeCompact(obj.signed);
  if (!decoded) return [row("S3", word, "malformed JWS", label)];
  const jws = parseJws(decoded);
  if (jws.limit) return [row("S3", NE, `limit: ${jws.limit}`, label)];
  if (jws.error) return [row("S3", word, jws.error, label)];
  const fail = [], info = [];
  const bad = (msg) => (claims ? fail.push(msg) : info.push(msg));
  const problem = payloadProblem(obj, jws.payload, jws.payloadIssues, bodyIssues);
  if (problem) bad(claims ? problem : PAYLOAD_DIFFERS);
  const { rejected } = headerFinding(jws.header);
  if (rejected) bad("signature rejected");
  else if (applyKeyStep(keyStep(jws.header.alg, level, claims, pins, decoded), { fail, info, bad })) return [row("S3", PASS, "verified under a pinned key", label)];
  if (fail.length) return [row("S3", FAIL, list(fail), label)];
  return [row("S3", INFO, list(info), label)];
}
