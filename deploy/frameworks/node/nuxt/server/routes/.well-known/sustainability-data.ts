// Nuxt 3/4 (Nitro): server/routes/.well-known/sustainability-data.ts (no method suffix: GET, HEAD and
// the 405 for everything else are handled here). The file is resolved from this module, not from the
// working directory, so it works after `nuxt build` too (keep data/ inside the server bundle: add it to
// nitro.serverAssets or import it).
import { readFile } from "node:fs/promises";

const FILE = new URL("../../../data/sustainability-data.json", import.meta.url);

export default defineEventHandler(async (event) => {
  if (event.method !== "GET" && event.method !== "HEAD") {
    setResponseHeader(event, "Allow", "GET, HEAD");
    setResponseStatus(event, 405);
    return { error: "method not allowed" };
  }
  setResponseHeaders(event, {
    "Content-Type": "application/sustainability-data+json",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=86400",
  });
  // Returned for HEAD as well: Node drops the body and keeps the headers (a null return would be a 204).
  return readFile(FILE);
});
