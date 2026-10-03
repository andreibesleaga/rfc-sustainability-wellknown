/**
 * Steps about the declaration itself: building it, validating it with the
 * consumer, signing it with the publisher, and verifying the signature.
 */
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { baseDeclaration, consumer, jose, publisher, value } from "./world.mjs";

const asObject = (w) => {
  assert.ok(w.doc && typeof w.doc === "object" && !Array.isArray(w.doc), "the scenario needs one declaration object");
  return w.doc;
};

Given("a valid declaration object", function () {
  this.doc = baseDeclaration();
});

Given("a valid declaration object with target-type {string} and target {string}", function (type, target) {
  this.doc = baseDeclaration({ "target-type": type, target });
});

Given("the member {string} is {string}", function (name, text) {
  asObject(this)[name] = value(text);
});

Given("the member {string} is the number {float}", function (name, n) {
  asObject(this)[name] = n;
});

Given("the member {string} is removed", function (name) {
  delete asObject(this)[name];
});

Given("the extension {string} is {string}", function (name, text) {
  const d = asObject(this);
  d.extensions = { ...(d.extensions ?? {}), [name]: value(text) };
});

Given("the upstream member names {string} with role {string}", function (uri, role) {
  const d = asObject(this);
  d.upstream = [...(d.upstream ?? []), role ? { declaration: uri, role } : { declaration: uri }];
});

Given("the declaration is an array of objects with reporting-periods {string}", function (csv) {
  const periods = csv.split(",").map((s) => s.trim()).filter(Boolean);
  this.doc = periods.map((p) => baseDeclaration({ "reporting-period": p, capabilities: "extended" }));
});

Given("the array is empty", function () {
  this.doc = [];
});

Given(/^the body is the JSON text (.+)$/, function (text) {
  this.doc = JSON.parse(text);
});

Given("the array's objects are in reverse order", function () {
  assert.ok(Array.isArray(this.doc));
  this.doc.reverse();
});

When("the consumer validates it", function () {
  const original = globalThis.fetch;
  this.fetchCalls = 0;
  globalThis.fetch = () => {
    this.fetchCalls += 1;
    throw new Error("validation must not touch the network");
  };
  try {
    this.result = consumer.validateDocument(this.doc);
  } finally {
    globalThis.fetch = original;
  }
});

Then("it is valid", function () {
  assert.equal(this.result.valid, true, `expected valid; errors: ${JSON.stringify(this.result.errors)}`);
});

Then("it is not valid", function () {
  assert.equal(this.result.valid, false, "expected the validator to reject it");
});

Then("the errors mention {string}", function (text) {
  const all = this.result.errors.join("\n");
  assert.ok(all.includes(text), `no error mentions "${text}"; errors: ${JSON.stringify(this.result.errors)}`);
});

Then("the warnings mention {string}", function (text) {
  const all = (this.result.warnings ?? []).join("\n");
  assert.ok(all.includes(text), `no warning mentions "${text}"; warnings: ${JSON.stringify(this.result.warnings)}`);
});

Then("there is no warning mentioning {string}", function (text) {
  const all = (this.result.warnings ?? []).join("\n");
  assert.ok(!all.includes(text), `unexpected warning about "${text}"`);
});

Then("the validator made no network request", function () {
  assert.equal(this.fetchCalls, 0);
});

/**
 * The draft's tolerance rules live in the retrieval path: the consumer strips a
 * defective optional member before validating and reports it as disregarded.
 */
When("the consumer retrieves and validates it", async function () {
  const { createServer } = await import("node:http");
  const body = JSON.stringify(this.doc);
  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/sustainability-data+json" });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  this.servers.push(server);
  this.fetchResult = await consumer.fetchSustainability(`http://127.0.0.1:${server.address().port}`, { allowInsecure: true, timeoutMs: 3_000 });
});

Then("the member {string} is reported as not usable", function (name) {
  // A defective optional member is disregarded, not fatal: the document is
  // still accepted and the member is listed as disregarded.
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  const all = (this.fetchResult.disregarded ?? []).join("\n");
  assert.ok(all.includes(name), `"${name}" not disregarded; disregarded: ${JSON.stringify(this.fetchResult.disregarded)}`);
});

Then("the member {string} is read as not reported", function (name) {
  assert.equal(consumer.isNotReported(asObject(this)[name], name), true, `${name}=${asObject(this)[name]} should read as not reported`);
});

Then("a publisher given no energy figure emits no energy-unit", async function () {
  const raw = {
    provider: "Example Org (https://example.com/contact)",
    measurementMethod: "hardware-metered",
    methodologyUri: "https://example.com/methodology",
    reportingPeriod: "2026-01",
    updated: "2026-02-01T00:00:00Z",
    carbon: { value: 12, unit: "kgCO2e" },
  };
  const adapter = { name: "bdd-no-energy", capabilities: "basic", async fetch() { return raw; } };
  const pub = new publisher.Publisher(adapter, { cacheTtlMs: 0, normalize: { target: "example.com", targetType: "origin" } });
  const doc = await pub.build({});
  assert.equal(doc["energy-consumption"], undefined);
  assert.equal(doc["energy-unit"], undefined, "energy-unit emitted without energy-consumption");
});

// ---- signing -----------------------------------------------------------------

Given("the object is signed with {word}", async function (alg) {
  this.key = await publisher.generateSigningKey(alg);
  this.doc = await publisher.signDeclaration(asObject(this), this.key);
});

Given("every object of the array is signed with EdDSA", async function () {
  this.key = await publisher.generateSigningKey("EdDSA");
  this.doc = await publisher.signDocument(this.doc, this.key);
});

Given("after signing, the member {string} is changed to {string}", function (name, text) {
  asObject(this)[name] = value(text);
});

async function manualJws(world, { alg, cty = "sustainability-data+json", payload, secret }) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const header = cty === null ? { alg } : { alg, cty };
  if (alg === "none") {
    const b64 = (s) => Buffer.from(s).toString("base64url");
    return `${b64(JSON.stringify(header))}.${Buffer.from(bytes).toString("base64url")}.`;
  }
  if (alg === "HS256") {
    return new jose.CompactSign(bytes).setProtectedHeader(header).sign(secret);
  }
  const key = world.key ?? (world.key = await publisher.generateSigningKey("EdDSA"));
  return new jose.CompactSign(bytes).setProtectedHeader({ ...header, jwk: key.publicJwk }).sign(key.privateKey);
}

Given("the signed member is a JWS with alg {string}", async function (alg) {
  const d = asObject(this);
  const { signed: _s, ...payload } = d;
  const secret = new TextEncoder().encode("a-shared-secret-nobody-else-holds-either");
  d.signed = await manualJws(this, { alg, payload, secret });
});

Given("the signed member's cty is absent", async function () {
  const d = asObject(this);
  const { signed: _s, ...payload } = d;
  d.signed = await manualJws(this, { alg: "EdDSA", cty: null, payload });
});

Given("the signed member's cty is {string}", async function (cty) {
  const d = asObject(this);
  const { signed: _s, ...payload } = d;
  d.signed = await manualJws(this, { alg: "EdDSA", cty, payload });
});

Given("the signed member's payload has reporting-period {string}", async function (period) {
  const d = asObject(this);
  const { signed: _s, ...payload } = d;
  d.signed = await manualJws(this, { alg: "EdDSA", payload: { ...payload, "reporting-period": period } });
});

Given("the signed member's payload itself carries a signed member", async function () {
  const d = asObject(this);
  const { signed: _s, ...payload } = d;
  d.signed = await manualJws(this, { alg: "EdDSA", payload: { ...payload, signed: "eyJhbGciOiJub25lIn0..", } });
});

Given("the signed member's payload is not a declaration", async function () {
  const d = asObject(this);
  d.signed = await manualJws(this, { alg: "EdDSA", payload: { hello: "world" } });
});

When("the consumer verifies the signature", async function () {
  this.sig = await consumer.verifyEmbeddedSignature(asObject(this));
});

When("the consumer verifies every signature of the array", async function () {
  assert.ok(Array.isArray(this.doc));
  this.sigs = [];
  for (const o of this.doc) this.sigs.push(await consumer.verifyEmbeddedSignature(o));
});

Then("the signature status is {string}", function (status) {
  assert.equal(this.sig.result.status, status, `signature outcome: ${JSON.stringify(this.sig.result)}`);
});

Then("every signature status is {string}", function (status) {
  for (const s of this.sigs) assert.equal(s.result.status, status, JSON.stringify(s.result));
});

Then("the signature reason mentions {string}", function (text) {
  const r = this.sig.result;
  const all = `${r.reason ?? ""} ${r.detail ?? ""}`;
  assert.ok(all.includes(text), `reason "${all}" does not mention "${text}"`);
});

Then("the verified payload carries no signed member", function () {
  assert.equal(this.sig.result.status, "verified");
  assert.equal(this.sig.payload?.signed, undefined);
});

Then("the members in use are the ones the origin served, not the payload", function () {
  // With a key trusted no further than the declaration carrying it, the draft
  // keeps the served members in use and reports the payload for inspection.
  assert.equal(this.sig.result.status, "verified");
  assert.equal(this.sig.result.precedence, "origin");
});

Then("the signature header carries the public key as jwk", function () {
  const [h] = asObject(this).signed.split(".");
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
  assert.ok(header.jwk, "no jwk in the JOSE header");
  assert.equal(header.cty, "sustainability-data+json");
  assert.ok(["EdDSA", "ES256"].includes(header.alg));
});

Then("the data is not reported as true or verified-accurate", function () {
  // The library never has an "accurate" outcome: a signature verifies bytes and key continuity only.
  assert.ok(["verified", "unverified", "unsigned"].includes(this.sig.result.status));
  assert.equal(this.sig.result.accurate, undefined);
});

Then("the object is reported as modified after signing", function () {
  assert.equal(this.sig.result.modifiedAfterSigning, true, JSON.stringify(this.sig.result));
});
