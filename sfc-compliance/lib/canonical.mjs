/** RFC 8785 canonical text, SHA-256 hashes and base64url (profile 3.5 and 3.6). */
import { createHash } from "node:crypto";

/** RFC 8785 text of an I-JSON value. */
export function canonicalize(v) {
  if (v === null) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("non-finite number");
    return JSON.stringify(v); // ECMAScript Number::toString, as RFC 8785 requires
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v).sort(); // UTF-16 code unit order
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`).join(",")}}`;
  }
  throw new Error(`cannot canonicalise ${typeof v}`);
}

export const sha256hex = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const textHash = (text) => sha256hex(Buffer.from(text, "utf8"));
/** The `sha256` form of 3.5: SHA-256 over the RFC 8785 text of a value. */
export const hashOf = (value) => textHash(canonicalize(value));
export const withoutSig = (o) => { const { sig, ...rest } = o; return rest; };

/** Decode base64url; null unless `s` is the canonical encoding of the bytes it decodes to. */
export function unb64u(s) {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) return null;
  const bytes = Buffer.from(s, "base64url");
  return bytes.toString("base64url") === s ? bytes : null;
}
