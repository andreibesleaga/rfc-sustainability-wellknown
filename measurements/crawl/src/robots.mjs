/**
 * robots.txt rules for the crawler, a thin adapter over the `robots-parser` package (RFC 9309 matching:
 * the group of the crawler's product token, else `*`; the longest matching rule wins; Allow wins a tie).
 * Fetching robots.txt and the 4xx / 5xx / redirect policy are not here: see probe.mjs.
 */
import robotsParser from "robots-parser";

// The library judges whole URLs. Only the path matters for one origin, so every path is placed on this
// reserved host name (RFC 2606) and never requested.
const BASE = "https://robots.invalid";

/** @returns the parsed rules of one robots.txt body */
export function parseRobots(text) {
  return robotsParser(`${BASE}/robots.txt`, text);
}

/** True when the path (with its query) may be fetched by the product token. */
export function isAllowed(rules, token, path) {
  return rules.isAllowed(`${BASE}${path}`, token) !== false;
}
