/**
 * The HTTP port and its one adapter. The port is a function
 *   get(url) -> { status, location, contentType, contentLength, body, truncated }
 * that never follows a redirect and never throws for an HTTP status; a
 * transport failure is returned as `{ error }`. The core (probe.mjs) is tested
 * against an in-process server through this same adapter.
 */
import { DEFAULTS, USER_AGENT } from "./config.mjs";

async function readCapped(response, maxBytes) {
  const chunks = [];
  let total = 0;
  let truncated = false;
  if (response.body) {
    for await (const chunk of response.body) {
      total += chunk.length;
      chunks.push(chunk);
      if (total > maxBytes) { // leaving the loop cancels the stream
        truncated = true;
        break;
      }
    }
  }
  const joined = Buffer.concat(chunks);
  return { body: new Uint8Array(joined.subarray(0, maxBytes)), truncated };
}

const TIMEOUT_NAMES = new Set(["TimeoutError", "AbortError"]);

function describeError(err) {
  if (TIMEOUT_NAMES.has(err?.name)) return "timeout";
  return String([err?.cause?.code, err?.code, err?.name].find(Boolean) ?? "network-error");
}

export function createFetchPort({ timeoutMs = DEFAULTS.timeoutMs, maxBytes = DEFAULTS.maxBytes, fetchImpl = fetch } = {}) {
  return async function get(url) {
    try {
      const response = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": USER_AGENT, accept: "application/sustainability-data+json, application/json;q=0.9, */*;q=0.1" },
      });
      const { body, truncated } = await readCapped(response, maxBytes);
      return {
        status: response.status,
        location: response.headers.get("location"),
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
        body,
        truncated,
      };
    } catch (err) {
      return { error: describeError(err) };
    }
  };
}
