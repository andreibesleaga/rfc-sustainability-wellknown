/**
 * An in-process HTTP server that plays many origins. The request names its
 * origin in the `x-test-origin` header (see `portFor`), so one server on
 * 127.0.0.1 can behave as `good.test`, `spa.test`, and so on. No live network.
 */
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFetchPort } from "../src/http.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const VALID = readFileSync(join(here, "..", "fixtures", "valid-declaration.json"), "utf8");
const WELL_KNOWN = "/.well-known/sustainability-data";
const PAGE = "<!doctype html><html><body>Not the file you wanted</body></html>";

const send = (res, status, type, body = "", extra = {}) => {
  res.writeHead(status, { "content-type": type, ...extra });
  res.end(body);
};
const html = (res) => send(res, 200, "text/html; charset=utf-8", PAGE);
const missing = (res) => send(res, 404, "text/plain", "not found");

/** One handler per scenario; `hits` records every path requested, per origin. */
const SCENARIOS = {
  "good.test": (path, res) => {
    if (path === WELL_KNOWN) return send(res, 200, "application/sustainability-data+json", VALID);
    if (path === "/carbon.txt") return send(res, 200, "text/plain", 'version = "0.4"\n[org]\ndisclosures = []\n');
    if (path === "/.well-known/dist.json") return send(res, 200, "application/json", '{"version":"0.0.1"}');
    return missing(res);
  },
  "generic-json.test": (path, res) =>
    path === WELL_KNOWN ? send(res, 200, "application/json; charset=utf-8", VALID) : missing(res),
  "badjson.test": (path, res) => (path === WELL_KNOWN ? send(res, 200, "application/json", "{not json") : missing(res)),
  "invalid.test": (path, res) => (path === WELL_KNOWN ? send(res, 200, "application/json", '{"target":"x"}') : missing(res)),
  "wrongtype.test": (path, res) => (path === WELL_KNOWN ? send(res, 200, "text/plain", VALID) : missing(res)),
  "spa.test": (path, res) => (path === "/robots.txt" ? missing(res) : html(res)),
  "robots.test": (path, res) => {
    if (path === "/robots.txt") {
      return send(res, 200, "text/plain", "User-agent: *\nDisallow: /\n\nUser-agent: SustainabilityDataSurvey\nDisallow: /carbon.txt\nDisallow: /sustainability-survey-probe\n");
    }
    return path === WELL_KNOWN ? send(res, 200, "application/json", VALID) : missing(res);
  },
  "robots-flaky.test": (() => {
    let calls = 0; // the first robots.txt request fails, the second works
    return (path, res) => (path === "/robots.txt" ? (++calls === 1 ? send(res, 503, "text/plain", "busy") : send(res, 404, "text/plain", "")) : path === WELL_KNOWN ? send(res, 200, "application/json", VALID) : missing(res));
  })(),
  "robots-offsite.test": (path, res) =>
    path === "/robots.txt" ? send(res, 301, "text/plain", "", { location: "http://elsewhere.test/robots.txt" }) : missing(res),
  "robots-down.test": (path, res) => (path === "/robots.txt" ? send(res, 503, "text/plain", "down") : missing(res)),
  "loop.test": (path, res) =>
    path === WELL_KNOWN ? send(res, 302, "text/plain", "", { location: "http://loop.test/ping" }) : path === "/ping" ? send(res, 302, "text/plain", "", { location: "http://loop.test" + WELL_KNOWN }) : missing(res),
  "offsite.test": (path, res) =>
    path === WELL_KNOWN ? send(res, 302, "text/plain", "", { location: "http://elsewhere.test/x" }) : missing(res),
  "hops.test": (path, res) => {
    if (path === WELL_KNOWN) return send(res, 301, "text/plain", "", { location: "http://www.hops.test/a" });
    if (path === "/a") return send(res, 301, "text/plain", "", { location: "/b" });
    return path === "/b" ? send(res, 200, "application/json", VALID) : missing(res);
  },
  "chain.test": (path, res) => {
    const n = /^\/h(\d)$/.exec(path)?.[1];
    if (path === WELL_KNOWN) return send(res, 302, "text/plain", "", { location: "/h1" });
    return n ? send(res, 302, "text/plain", "", { location: `/h${Number(n) + 1}` }) : missing(res);
  },
  "slow.test": (path, res) => {
    if (path === WELL_KNOWN) return void setTimeout(() => res.destroy(), 2_000).unref();
    return missing(res);
  },
  "big.test": (path, res) => (path === "/carbon.txt" ? send(res, 200, "text/plain", "[org]\n" + "x".repeat(4096)) : missing(res)),
};

export async function startFixtureServer() {
  const hits = new Map();
  const server = createServer((req, res) => {
    const origin = req.headers["x-test-origin"];
    const path = req.url;
    hits.set(origin, [...(hits.get(origin) ?? []), path]);
    (SCENARIOS[origin] ?? ((_p, r) => missing(r)))(path, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  /** A fetch that sends every URL to the fixture server, naming the origin the URL asked for. */
  const fetchImpl = (url, init) => {
    const target = new URL(url);
    return fetch(`http://127.0.0.1:${port}${target.pathname}${target.search}`, {
      ...init,
      headers: { ...init.headers, "x-test-origin": target.host.replace(/^www\./, "") },
    });
  };
  return {
    hits,
    portFor: (options = {}) => createFetchPort({ ...options, fetchImpl }),
    close: () => new Promise((resolve) => (server.closeAllConnections(), server.close(resolve))),
  };
}
