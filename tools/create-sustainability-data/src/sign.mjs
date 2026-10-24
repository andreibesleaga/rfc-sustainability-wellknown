/**
 * Optional signing. The tool signs with Ed25519 only: a symmetric key (HS256) or any other
 * algorithm is refused before anything is written.
 */
import { readFileSync } from "node:fs";
import { assertSignedMatches, assertValid, importSigningKey, signDocument } from "sustainability-wellknown-publisher";

/** The private key in `file`, or an Error that names the algorithm when it is not Ed25519. */
export async function loadEd25519Key(file) {
  const text = readFileSync(file, "utf8");
  let jwk;
  try {
    jwk = JSON.parse(text);
  } catch {
    throw new Error(`signing key ${file}: not valid JSON (expected a private JWK from: sustainability-publisher keygen)`);
  }
  const named = jwk?.alg ?? (jwk?.kty === "oct" ? "HS256" : undefined);
  if (named !== undefined && named !== "Ed25519") {
    throw new Error(`signing key ${file}: the algorithm ${named} is not accepted; sign with Ed25519 (sustainability-publisher keygen --alg Ed25519)`);
  }
  const key = await importSigningKey(jwk);
  if (key.alg !== "Ed25519") throw new Error(`signing key ${file}: the algorithm ${key.alg} is not accepted; sign with Ed25519`);
  return key;
}

/** The document with a `signed` member, checked to match the object it accompanies and valid as it stands. */
export async function signed(doc, key) {
  const out = await signDocument(doc, key);
  assertSignedMatches(out);
  assertValid(out);
  return out;
}
