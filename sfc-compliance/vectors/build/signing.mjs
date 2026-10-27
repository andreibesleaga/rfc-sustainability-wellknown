/** Signing for the vector builders. The checker only verifies; signatures exist only while the vectors are made. */
import { createHash, createPrivateKey, sign as nodeSign } from "node:crypto";

const L = 2n ** 252n + 27742317777372353535851937790883648493n;
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");

const sha512 = (...parts) => createHash("sha512").update(Buffer.concat(parts)).digest();
const leInt = (bytes) => BigInt(`0x${Buffer.from(bytes).reverse().toString("hex")}`);
const leBytes = (n, len) => Buffer.from(n.toString(16).padStart(len * 2, "0"), "hex").reverse();

/** Ed25519 signature (RFC 8032) of `msg` under the private key given as a hex seed. */
export function signWithSeed(seedHex, msg) {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8, Buffer.from(seedHex, "hex")]), format: "der", type: "pkcs8" });
  return nodeSign(null, msg, key);
}

/** Signature with R = the neutral element and S = k*a mod L: passes the cofactorless equation under the real key A. */
export function forgeSmallOrderR(seedHex, pub, msg) {
  const h = sha512(Buffer.from(seedHex, "hex"));
  const a0 = Buffer.from(h.subarray(0, 32));
  a0[0] &= 248; a0[31] &= 127; a0[31] |= 64;
  const R = leBytes(1n, 32); // y = 1, x = 0
  const k = leInt(sha512(R, pub, msg)) % L;
  return Buffer.concat([R, leBytes((k * leInt(a0)) % L, 32)]);
}
