/** Steps used by a few scenarios only: recorded request headers, raw bodies, noise, methodology listing. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import { FIXED_NOW, MEDIA_TYPE, WELL_KNOWN, baseDeclaration, consumer, publisher } from "./world.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function listen(world, server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  world.servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

Given("a local server that records request headers", async function () {
  this.recorded = [];
  const body = JSON.stringify(baseDeclaration());
  const server = createServer((req, res) => {
    this.recorded.push(req.headers);
    res.writeHead(200, { "Content-Type": MEDIA_TYPE });
    res.end(body);
  });
  this.base = await listen(this, server);
});

Then("the recorded request header {string} contains {string}", function (name, text) {
  const last = this.recorded[this.recorded.length - 1];
  assert.ok(last, "no request recorded");
  assert.ok(String(last[name.toLowerCase()] ?? "").includes(text), `${name}: ${last[name.toLowerCase()]}`);
});

Given("a local server whose body is the raw text {string}", async function (raw) {
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": MEDIA_TYPE });
    res.end(raw);
  });
  this.base = await listen(this, server);
});

Then("the fetched document's {string} is {float}", function (member, n) {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  const d = this.fetchResult.document;
  assert.equal((Array.isArray(d) ? d[0] : d)[member], n);
});

Then("the object's {string} starts with {string}", function (member, prefix) {
  const v = JSON.parse(this.response.body);
  const o = Array.isArray(v) ? v[0] : v;
  assert.ok(typeof o[member] === "string" && o[member].startsWith(prefix), `${member}: ${o[member]}`);
});

Then("the body's signature verifies", async function () {
  const v = JSON.parse(this.response.body);
  const o = Array.isArray(v) ? v[0] : v;
  const out = await consumer.verifyEmbeddedSignature(o);
  assert.equal(out.result.status, "verified", JSON.stringify(out.result));
});

Then("the repository's gateway methodology lists every extension name of the served report", function () {
  const v = JSON.parse(this.response.body);
  const o = Array.isArray(v) ? v[0] : v;
  const names = Object.keys(o.extensions ?? {});
  assert.ok(names.length > 0, "the self report carries no extensions");
  const methodology = readFileSync(resolve(here, "..", "..", "gateway", "METHODOLOGY.md"), "utf8")
    + readFileSync(resolve(here, "..", "..", "gateway", "data", "README.md"), "utf8");
  for (const n of names) assert.ok(methodology.includes(n), `the gateway's methodology documents do not list ${n}`);
});

function monthly(periods, extra = {}) {
  return periods.map((p) => ({
    provider: "Example Org (https://example.com/contact)",
    measurementMethod: "hardware-metered",
    methodologyUri: "https://example.com/methodology",
    reportingPeriod: p,
    updated: "2026-02-01T00:00:00Z",
    capabilities: "extended",
    energy: { value: 100, unit: "kWh" },
    carbonIntensity: 245,
    ...extra,
  }));
}

Given("an extended publisher with monthly entries for {string} and noise enabled", function (csv) {
  const periods = csv.split(",").map((s) => s.trim()).filter(Boolean);
  const entries = monthly(periods);
  const adapter = {
    name: "bdd-noise",
    capabilities: "extended",
    async fetch(q) {
      const inside = q.period ? entries.filter((e) => e.reportingPeriod.startsWith(q.period)) : entries;
      if (!inside.length) throw new publisher.NotFoundError();
      return inside;
    },
  };
  const make = () => new publisher.Publisher(adapter, {
    cacheTtlMs: 0,
    now: () => FIXED_NOW,
    normalize: { target: "example.com", targetType: "origin" },
    security: { applyNoise: true },
  });
  this.publisher = make();
  this.publisherAgain = make();
});

Then("the published figures for {string} are within 1% of 100 kWh, consistent with the carbon figure, and identical across two builds", async function (period) {
  const a = await this.publisher.build({ period });
  const b = await this.publisherAgain.build({ period });
  const oa = Array.isArray(a) ? a[0] : a;
  const ob = Array.isArray(b) ? b[0] : b;
  assert.ok(Math.abs(oa["energy-consumption"] - 100) <= 1, `energy ${oa["energy-consumption"]}`);
  // Noise is applied consistently across arithmetically related members: carbon = energy × 245 g/kWh.
  const expectedCarbon = oa["energy-consumption"] * 245;
  const carbonG = oa["carbon-unit"] === "kgCO2e" ? oa["carbon-footprint"] * 1000 : oa["carbon-footprint"];
  assert.ok(Math.abs(carbonG - expectedCarbon) / expectedCarbon < 0.0005, `carbon ${carbonG} vs ${expectedCarbon}`);
  assert.deepEqual(oa, ob, "noise must be deterministic per period");
});

Given("a raw provider name in decomposed Unicode form", function () {
  this.rawProvider = "Café Org (https://example.com/contact)"; // "é" as e + combining acute
});

When("the publisher builds a declaration from it", async function () {
  const entries = monthly(["2026-01"], { provider: this.rawProvider });
  const adapter = { name: "bdd-nfc", capabilities: "basic", async fetch() { return entries[0]; } };
  const pub = new publisher.Publisher(adapter, { cacheTtlMs: 0, now: () => FIXED_NOW, normalize: { target: "example.com", targetType: "origin" } });
  this.doc = await pub.build({});
});

Then("the published provider is in Normalization Form C", function () {
  const p = this.doc.provider;
  assert.equal(p, p.normalize("NFC"), `provider is not NFC: ${JSON.stringify(p)}`);
});

Then("the consumer aggregates the array into totals without per-entry identities", async function () {
  const arr = Array.isArray(this.doc) ? this.doc : [this.doc];
  const summary = consumer.aggregate(arr, { by: "sum" });
  assert.ok(typeof summary === "object");
  // One summary for the whole range: totals, no per-entry objects, never signed.
  assert.match(String(summary["reporting-period"]), /^\S+\.\.\S+$/);
  assert.equal(summary.signed, undefined);
  assert.equal(summary["energy-consumption"], 120 * arr.length);
  assert.ok(!Array.isArray(summary));
});

Given("a signed object whose header carries x5c and no jwk", async function () {
  const { signed: _s, ...payload } = this.doc;
  const key = await publisher.generateSigningKey("EdDSA");
  const jose = (await import("./world.mjs")).jose;
  this.doc.signed = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "EdDSA", cty: "sustainability-data+json", x5c: ["MIIBfake"] })
    .sign(key.privateKey);
});

Then("the payload is never promoted over the served members", function () {
  assert.notEqual(this.sig.result.precedence, "payload", JSON.stringify(this.sig.result));
});

When("the consumer checks the attestation URI {string}", async function (uri) {
  this.attestation = await consumer.verifyAttestation(uri, { timeoutMs: 2_000 });
});

Then("the attestation is not valid and the reason is {string}", function (reason) {
  assert.equal(this.attestation.valid, false);
  assert.equal(this.attestation.reason, reason, JSON.stringify(this.attestation));
});


Then("the repository's gateway methodology publishes the set of target prefixes it honours", function () {
  const methodology = readFileSync(resolve(here, "..", "..", "gateway", "METHODOLOGY.md"), "utf8");
  assert.match(methodology, /set of path prefixes this publisher honours for the `target` parameter is\s+\*?\*?EMPTY/i);
});

Then("every served data file that carries scopes keeps them within its gross footprint", function () {
  const dir = resolve(here, "..", "..", "gateway", "data");
  const { readdirSync } = require("node:fs");
  let checked = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json") || name.startsWith("_")) continue;
    const raw = JSON.parse(readFileSync(resolve(dir, name), "utf8"));
    const d = raw.document ?? raw;
    const docs = Array.isArray(d) ? d : [d];
    for (const o of docs) {
      const scopes = ["scope-1", "scope-2", "scope-3"].map((k) => o[k]).filter((v) => typeof v === "number");
      if (typeof o["carbon-footprint"] !== "number" || scopes.length === 0) continue;
      const sum = scopes.reduce((a, b) => a + b, 0);
      assert.ok(sum <= o["carbon-footprint"] * 1.005 + 1e-9, `${name}: scopes ${sum} exceed footprint ${o["carbon-footprint"]}`);
      checked += 1;
    }
  }
  assert.ok(checked >= 5, `only ${checked} files carry scopes and a footprint`);
});

/** A publisher given figures it must not emit. */
async function buildFromRaw(raw) {
  const adapter = { name: "bdd-raw", capabilities: "basic", async fetch() { return raw; } };
  const pub = new publisher.Publisher(adapter, { cacheTtlMs: 0, normalize: { target: "example.com", targetType: "origin" } });
  return pub.build({});
}
const RAW = { provider: "Example Org (https://example.com/contact)", measurementMethod: "hardware-metered", methodologyUri: "https://example.com/methodology", reportingPeriod: "2026-01", updated: "2026-02-01T00:00:00Z" };

Then("a publisher given a negative gross figure refuses to build", async function () {
  await assert.rejects(() => buildFromRaw({ ...RAW, energy: { value: -5, unit: "kWh" } }), /negative|not conformant|invalid|range/i);
});

Then("a publisher given a non-finite figure refuses to build", async function () {
  await assert.rejects(() => buildFromRaw({ ...RAW, energy: { value: Number.POSITIVE_INFINITY, unit: "kWh" } }), /finite|not conformant|invalid|range|number/i);
});

Then("a publisher never emits a top-level member the draft does not define", async function () {
  // An input field the publisher does not know never reaches the wire: the document is built from the defined members only.
  const doc = await buildFromRaw({ ...RAW, energy: { value: 5, unit: "kWh" }, "x-extra": 1, vendorNote: "no" });
  const known = new Set(consumer.KNOWN_MEMBERS);
  for (const k of Object.keys(doc)) assert.ok(known.has(k), `unexpected top-level member ${k}`);
});

Given("a local server whose declaration's target is in decomposed Unicode form", async function () {
  const { createServer } = await import("node:http");
  const body = JSON.stringify({ ...baseDeclaration({ "target-type": "organization" }), target: "cafe\u0301.example" });
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": MEDIA_TYPE });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  this.servers.push(server);
  this.base = `http://127.0.0.1:${server.address().port}`;
});
