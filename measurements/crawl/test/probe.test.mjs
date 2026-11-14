import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { probeOrigin, randomPath } from "../src/probe.mjs";
import { startFixtureServer } from "./fixture-server.mjs";
import { FIXED_NOW, byProbe, probeDeps } from "./helpers.mjs";

let server;
before(async () => (server = await startFixtureServer()));
after(() => server.close());

const run = async (host, options = {}, overrides = {}) => {
  const deps = probeDeps(server.portFor({ timeoutMs: 5000, ...options }), { maxRedirects: 3, ...overrides });
  return { records: byProbe(await probeOrigin(host, deps)), deps };
};

test("golden: an origin that publishes is recorded probe by probe, in fixed order", async () => {
  const { records, deps } = await run("good.test");
  assert.deepEqual(Object.keys(records), ["robots", "declaration", "carbon-txt", "carbon-txt-well-known", "dist-json", "random"]);
  const d = records.declaration;
  assert.equal(d.status, 200);
  assert.equal(d.classification, "valid");
  assert.equal(d.media_type, "application/sustainability-data+json");
  assert.equal(d.fetched_at, FIXED_NOW);
  assert.match(d.sha256_first_bytes, /^[0-9a-f]{64}$/);
  assert.equal(d.stored, "documents/good.test__declaration.body");
  assert.equal(records["carbon-txt"].classification, "parseable");
  assert.equal(records["carbon-txt-well-known"].classification, "not-found");
  assert.equal(records["dist-json"].classification, "parseable");
  assert.equal(records.random.classification, "not-found");
  assert.equal(deps.requests.count, 6);
});

test("only documents are stored; a 404 or a page never is", async () => {
  const { deps } = await run("good.test");
  assert.deepEqual(deps.saved.map(([, id]) => id), ["declaration", "carbon-txt", "dist-json"]);
  const spa = await run("spa.test");
  assert.deepEqual(spa.deps.saved, []);
});

test("the hash covers the first 2,048 bytes only", async () => {
  const { records } = await run("big.test");
  const body = new TextEncoder().encode("[org]\n" + "x".repeat(4096));
  assert.equal(records["carbon-txt"].sha256_first_bytes, createHash("sha256").update(body.subarray(0, 2048)).digest("hex"));
  assert.equal(records["carbon-txt"].bytes_read, body.length);
});

test("a body over the size cap is cut off, flagged and not judged", async () => {
  const { records } = await run("big.test", { maxBytes: 1000 });
  assert.equal(records["carbon-txt"].truncated, true);
  assert.equal(records["carbon-txt"].classification, "unparseable");
  assert.ok(records["carbon-txt"].bytes_read <= 1000);
});

test("invalid JSON, a file that is not a declaration, and a wrong media type", async () => {
  assert.equal((await run("badjson.test")).records.declaration.classification, "unparseable");
  const invalid = await run("invalid.test");
  assert.equal(invalid.records.declaration.classification, "invalid");
  assert.ok(invalid.records.declaration.validation_errors.length > 0);
  assert.equal(invalid.deps.saved.length, 1, "a parseable document is kept");
  assert.equal((await run("wrongtype.test")).records.declaration.classification, "wrong-media-type");
  assert.equal((await run("generic-json.test")).records.declaration.classification, "valid");
});

test("a single-page application answers 200 with a page everywhere, the random probe shows it", async () => {
  const { records } = await run("spa.test");
  for (const id of ["declaration", "carbon-txt", "carbon-txt-well-known", "dist-json", "random"]) {
    assert.equal(records[id].classification, "html-soft-404", id);
  }
});

test("robots.txt is honoured: a disallowed path is not requested at all", async () => {
  server.hits.delete("robots.test");
  const { records } = await run("robots.test");
  assert.equal(records.declaration.classification, "valid", "the named group replaces the wildcard group, which forbids everything");
  assert.equal(records["carbon-txt"].classification, "blocked-by-robots");
  assert.equal(records.random.classification, "blocked-by-robots");
  assert.equal(records["dist-json"].classification, "not-found", "allowed by the named group");
  assert.ok(!server.hits.get("robots.test").includes("/carbon.txt"));
  assert.ok(!server.hits.get("robots.test").some((p) => p.startsWith("/sustainability-survey-probe")));
});

test("an unreachable robots.txt (5xx) blocks the whole origin, as RFC 9309 says", async () => {
  server.hits.delete("robots-down.test");
  const { records } = await run("robots-down.test");
  assert.equal(records.robots.classification, "error");
  assert.equal(records.robots.retried, true);
  assert.equal(records.declaration.classification, "robots-unreachable");
  assert.equal(records.random.classification, "robots-unreachable");
  assert.deepEqual(server.hits.get("robots-down.test"), ["/robots.txt", "/robots.txt"]);
});

test("a robots.txt that redirects off site is not asked for twice, and blocks the origin", async () => {
  server.hits.delete("robots-offsite.test");
  const { records } = await run("robots-offsite.test");
  assert.equal(records.robots.error, "redirect-off-site");
  assert.equal(records.robots.retried, undefined);
  assert.equal(records.declaration.classification, "robots-unreachable");
  assert.deepEqual(server.hits.get("robots-offsite.test"), ["/robots.txt"]);
});

test("robots.txt is retried once: a hiccup on the first request does not lose the origin", async () => {
  const { records } = await run("robots-flaky.test");
  assert.equal(records.robots.classification, "not-found");
  assert.equal(records.robots.retried, true);
  assert.equal(records.declaration.classification, "valid");
});

test("redirects: same site up to three hops are followed and the final URL recorded", async () => {
  const { records } = await run("hops.test");
  assert.equal(records.declaration.classification, "valid");
  assert.equal(records.declaration.redirects, 2);
  assert.equal(records.declaration.final_url, "http://www.hops.test/b");
});

test("redirects: a loop, an off-site target and a fourth hop are errors, never followed", async () => {
  const loop = (await run("loop.test")).records.declaration;
  assert.deepEqual([loop.classification, loop.error], ["error", "redirect-loop"]);
  const off = (await run("offsite.test")).records.declaration;
  assert.deepEqual([off.classification, off.error, off.error_detail], ["error", "redirect-off-site", "elsewhere.test"]);
  assert.ok(!(server.hits.get("elsewhere.test") ?? []).length);
  const chain = (await run("chain.test")).records.declaration;
  assert.deepEqual([chain.classification, chain.error], ["error", "too-many-redirects"]);
});

test("a server that never answers is a timeout error, and the origin still finishes", async () => {
  const { records } = await run("slow.test", { timeoutMs: 500 });
  assert.deepEqual([records.declaration.classification, records.declaration.error], ["error", "timeout"]);
  assert.equal(records.random.classification, "not-found");
});

test("politeness: the pause is taken before every request but the first, on the same origin", async () => {
  const sleeps = [];
  await run("good.test", {}, { gapMs: 1000, sleep: async (ms) => sleeps.push(ms) });
  assert.deepEqual(sleeps, [1000, 1000, 1000, 1000, 1000]);
});

test("the random path is seeded: same seed and host, same path; another host, another path", () => {
  assert.equal(randomPath("s", "a.test"), randomPath("s", "a.test"));
  assert.notEqual(randomPath("s", "a.test"), randomPath("s", "b.test"));
  assert.notEqual(randomPath("s", "a.test"), randomPath("t", "a.test"));
});

test("every request carries the identifying user agent, with the repository URL and no e-mail address", async () => {
  const seen = [];
  const get = server.portFor();
  const spy = async (url) => (seen.push(url), get(url));
  await probeOrigin("good.test", probeDeps(spy, { maxRedirects: 3 }));
  assert.equal(seen.length, 6);
  const { USER_AGENT } = await import("../src/config.mjs");
  assert.match(USER_AGENT, /^SustainabilityDataSurvey\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/andreibesleaga\/rfc-sustainability-wellknown/);
  assert.ok(!USER_AGENT.includes("@"));
});
