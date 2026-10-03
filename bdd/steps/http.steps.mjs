/**
 * Steps over HTTP: against the reference gateway (real server, fixed clock,
 * no network) and against a publisher served by the library's own server.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Given, Then, When } from "@cucumber/cucumber";
import { FIXED_NOW, MEDIA_TYPE, WELL_KNOWN, baseDeclaration, consumer, publisher, sharedGateway, startGateway } from "./world.mjs";

async function listen(world, server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  world.servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

Given("the reference gateway is running", async function () {
  this.base = (await sharedGateway()).base;
});

Given("a gateway with a rate limit of {int} requests per minute", async function (n) {
  const g = await startGateway({ rateLimitPerMinute: n });
  this.servers.push(g.gw.server);
  this.base = g.base;
});

/** Monthly entries for the periods named, served by the library's own HTTP server. */
function monthlyAdapter(periods, capabilities, extra = {}) {
  const entries = periods.map((p) => ({
    provider: "Example Org (https://example.com/contact)",
    measurementMethod: "hardware-metered",
    methodologyUri: "https://example.com/methodology",
    reportingPeriod: p,
    updated: "2026-02-01T00:00:00Z",
    capabilities,
    energy: { value: 100, unit: "kWh" },
    carbonIntensity: 245,
    ...extra,
  }));
  return {
    name: "bdd-fixture",
    capabilities,
    async fetch(query) {
      if (capabilities === "basic") return entries[entries.length - 1];
      const period = query.period;
      const inside = period ? entries.filter((e) => e.reportingPeriod.startsWith(period)) : entries;
      if (!inside.length) throw new publisher.NotFoundError();
      return query.granularity ? inside : inside;
    },
  };
}

Given("an extended publisher with monthly entries for {string}", async function (csv) {
  const periods = csv.split(",").map((s) => s.trim()).filter(Boolean);
  this.publisher = new publisher.Publisher(monthlyAdapter(periods, "extended"), {
    cacheTtlMs: 0,
    now: () => FIXED_NOW,
    normalize: { target: "example.com", targetType: "origin" },
  });
});

Given("a basic publisher with one entry for {string}", async function (period) {
  this.publisher = new publisher.Publisher(monthlyAdapter([period], "basic"), {
    cacheTtlMs: 0,
    now: () => FIXED_NOW,
    normalize: { target: "example.com", targetType: "origin" },
  });
});

Given("the publisher signs with an EdDSA key", async function () {
  this.key = await publisher.generateSigningKey("EdDSA");
  // Rebuild with signing: the Publisher takes the key at construction.
  const adapter = this.publisher.adapter ?? undefined;
  this.publisherSigning = { key: this.key };
});

Given("the publisher is served on a local port", async function () {
  const opts = this.publisherSigning ? { signing: { key: this.publisherSigning.key } } : {};
  const pub = this.publisherSigning
    ? new publisher.Publisher(this.publisher["adapter"], { cacheTtlMs: 0, now: () => FIXED_NOW, normalize: { target: "example.com", targetType: "origin" }, ...opts })
    : this.publisher;
  const server = publisher.createSustainabilityServer(pub, { onError: () => undefined });
  this.base = await listen(this, server);
});

Given("a local server that answers the well-known path with {string} and status {int}", async function (contentType, status) {
  const body = JSON.stringify(baseDeclaration());
  const server = createServer((req, res) => {
    if (req.url.startsWith(WELL_KNOWN)) {
      res.writeHead(status, { "Content-Type": contentType, "X-Content-Type-Options": "nosniff" });
      res.end(req.method === "HEAD" ? undefined : body);
    } else {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
    }
  });
  this.base = await listen(this, server);
});

Given("a local server that redirects the well-known path to another local origin", async function () {
  const body = JSON.stringify(baseDeclaration({ target: "second.example" }));
  const second = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": MEDIA_TYPE });
    res.end(body);
  });
  this.secondBase = await listen(this, second);
  const first = createServer((req, res) => {
    res.writeHead(302, { Location: `${this.secondBase}${WELL_KNOWN}` });
    res.end();
  });
  this.base = await listen(this, first);
});

Given("a local server that redirects the well-known path in a loop", async function () {
  const server = createServer((req, res) => {
    res.writeHead(302, { Location: `${this.base}${WELL_KNOWN}` });
    res.end();
  });
  this.base = await listen(this, server);
});

Given("a local server whose declaration body is {int} bytes of JSON", async function (n) {
  const d = baseDeclaration({ provider: "x".repeat(Math.max(0, n - 300)) });
  let body = JSON.stringify(d);
  while (body.length < n) body = JSON.stringify({ ...d, provider: d.provider + "x" });
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": MEDIA_TYPE });
    res.end(body);
  });
  this.base = await listen(this, server);
});

Given("a local server whose declaration is an array of {int} objects", async function (n) {
  const arr = Array.from({ length: n }, (_, i) =>
    baseDeclaration({ "reporting-period": `2025-${String((i % 12) + 1).padStart(2, "0")}`, capabilities: "extended" }),
  );
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": MEDIA_TYPE });
    res.end(JSON.stringify(arr));
  });
  this.base = await listen(this, server);
});

async function send(world, method, path, headers = {}) {
  const res = await fetch(`${world.base}${path}`, { method, headers, redirect: "manual" });
  const body = await res.text();
  world.response = { status: res.status, headers: res.headers, body };
  return world.response;
}

When("I send {word} {string}", async function (method, path) {
  await send(this, method, path);
});

When("I send GET {string} with header {string} set to {string}", async function (path, h, v) {
  await send(this, "GET", path, { [h]: v });
});

When("I send GET {string} with the ETag of GET {string}", async function (path, source) {
  const first = await send(this, "GET", source);
  const etag = first.headers.get("etag");
  assert.ok(etag, "the source response carried no ETag");
  await send(this, "GET", path, { "If-None-Match": etag });
});

When("I send {int} GET requests to {string}", async function (n, path) {
  this.statuses = [];
  for (let i = 0; i < n; i++) this.statuses.push((await send(this, "GET", path)).status);
});

Then("the status is {int}", function (n) {
  assert.equal(this.response.status, n, `body: ${this.response.body.slice(0, 200)}`);
});

Then("one of the statuses is {int}", function (n) {
  assert.ok(this.statuses.includes(n), `statuses: ${this.statuses.join(",")}`);
});

Then("the header {string} is {string}", function (h, v) {
  assert.equal(this.response.headers.get(h), v);
});

Then("the header {string} contains {string}", function (h, v) {
  const got = this.response.headers.get(h) ?? "";
  assert.ok(got.includes(v), `${h}: ${got}`);
});

Then("the header {string} is present", function (h) {
  assert.ok(this.response.headers.get(h), `${h} missing`);
});

Then("the header {string} is absent", function (h) {
  assert.equal(this.response.headers.get(h), null, `${h} present: ${this.response.headers.get(h)}`);
});

Then("the body is empty", function () {
  assert.equal(this.response.body, "");
});

Then("the body is a JSON object", function () {
  const v = JSON.parse(this.response.body);
  assert.ok(v && typeof v === "object" && !Array.isArray(v));
});

Then("the body is a JSON array", function () {
  assert.ok(Array.isArray(JSON.parse(this.response.body)));
});

Then("the body is a JSON array of {int} objects", function (n) {
  const v = JSON.parse(this.response.body);
  assert.ok(Array.isArray(v));
  assert.equal(v.length, n);
});

Then("the body has at most {int} objects", function (n) {
  const v = JSON.parse(this.response.body);
  assert.ok(Array.isArray(v) && v.length <= n, `length ${v.length}`);
});

Then("the body is in ascending reporting-period order without overlap", function () {
  const v = JSON.parse(this.response.body);
  assert.ok(Array.isArray(v));
  for (let i = 1; i < v.length; i++) {
    assert.ok(v[i - 1]["reporting-period"] < v[i]["reporting-period"], `${v[i - 1]["reporting-period"]} before ${v[i]["reporting-period"]}`);
  }
  const precisions = new Set(v.map((o) => o["reporting-period"].length));
  assert.equal(precisions.size, 1, "mixed period precisions");
});

Then("every object's reporting-period starts with {string}", function (prefix) {
  const v = JSON.parse(this.response.body);
  for (const o of Array.isArray(v) ? v : [v]) assert.ok(o["reporting-period"].startsWith(prefix), o["reporting-period"]);
});

Then("the object's reporting-period is {string}", function (p) {
  const v = JSON.parse(this.response.body);
  assert.equal(v["reporting-period"], p);
});

Then("the object's {string} is {string}", function (member, text) {
  const v = JSON.parse(this.response.body);
  const expected = (() => { try { return JSON.parse(text); } catch { return text; } })();
  assert.deepEqual(v[member], expected);
});

Then("the object carries a signed member", function () {
  const v = JSON.parse(this.response.body);
  assert.equal(typeof v.signed, "string");
});

Then("the body validates as a declaration", function () {
  const r = consumer.validateDocument(JSON.parse(this.response.body));
  assert.equal(r.valid, true, JSON.stringify(r.errors));
});

Then("the body is identical to the body of GET {string}", async function (path) {
  const previous = this.response.body;
  await send(this, "GET", path);
  assert.equal(this.response.body, previous);
});

Then("the origin passes every MUST of the conformance battery", async function () {
  const report = await consumer.runConformanceChecks(this.base, fetch, { allowInsecure: true });
  const failed = report.checks.filter((c) => c.outcome === "fail").map((c) => c.name);
  assert.equal(report.allPassed, true, `failed: ${failed.join("; ")}`);
});

Then("the subject {string} is served with the same headers for GET and HEAD", async function (domain) {
  const path = `/${domain}${WELL_KNOWN}`;
  const g = await send(this, "GET", path);
  const h = await send(this, "HEAD", path);
  assert.equal(h.status, g.status);
  for (const name of ["content-type", "etag", "cache-control", "x-content-type-options", "access-control-allow-origin"]) {
    assert.equal(h.headers.get(name), g.headers.get(name), name);
  }
  assert.equal(h.body, "");
});
