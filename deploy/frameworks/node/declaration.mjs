// Shared by the Node recipes: the document bytes and the four headers.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const PATH = "/.well-known/sustainability-data";
/** The document: data/sustainability-data.json beside the recipe, or the file SD_FILE names. */
const FILE = process.env.SD_FILE ?? resolve(here, "data", "sustainability-data.json");
function load(file) {
  try {
    return readFileSync(file);
  } catch (err) {
    throw new Error(`cannot read the declaration at ${file} (${err.code ?? err.message}); put it there or set SD_FILE`);
  }
}
export const BODY = load(FILE);
/** A strong validator over the bytes, and the file's own date, so caches can revalidate (draft, SHOULD). */
export const ETAG = `"${createHash("sha256").update(BODY).digest("hex").slice(0, 32)}"`;
export const LAST_MODIFIED = statSync(FILE).mtime.toUTCString();
/** True when the request's If-None-Match names the current entity (RFC 9110 §13.1.2). */
export const fresh = (ifNoneMatch) => Boolean(ifNoneMatch) && ifNoneMatch.split(",").map((t) => t.trim()).some((t) => t === "*" || t === ETAG || t === `W/${ETAG}`);
export const HEADERS = {
  "Content-Type": "application/sustainability-data+json",
  "X-Content-Type-Options": "nosniff",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=86400",
  get ETag() { return ETAG; },
  get "Last-Modified"() { return LAST_MODIFIED; },
};
