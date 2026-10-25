/**
 * Steps shared by every feature: the clock, the declaration under test, validation and signatures, plain HTTP
 * requests and what they return, the consumer's fetch, totals and upstream walks, the publisher's build, the
 * attestation check, the presentation, and the programs (create-sustainability-data, upgrade).
 *
 * The phrases of this file are exactly those assigned to the common step owner; the World (world.mjs) says what
 * every field means.
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  BIN,
  baseDeclaration,
  cddlAccepts,
  coerce,
  consumer,
  deletePath,
  draftExample,
  flatComparisons,
  getPath,
  jtdAccepts,
  legacyDocument,
  mergeSpans,
  objectsFromTable,
  periodFromText,
  publisher,
  runNode,
  sameInstant,
  setPath,
  startGateway,
  textOf,
  value,
} from "./world.mjs";

// ---- small helpers -----------------------------------------------------------------------------------------

/** The document under test as one object. */
function oneObject(world) {
  const objects = world.subjectObjects();
  assert.equal(objects.length, 1, `the step is about one object, the subject holds ${objects.length}`);
  return objects[0];
}

/** Whether the subject is something obtained (a response, a fetch) and not the document being built. */
const afterResponse = (world) => world.lastSet !== "doc";

/** The text of a result, errors or warnings, searched for a fragment. */
function assertMentions(list, text, what) {
  const all = list.join("\n");
  assert.ok(all.includes(text), `no ${what} mentions "${text}"; ${what}s: ${JSON.stringify(list)}`);
}

/** The JSON text of a header of a JWS compact serialization. */
function signedHeader(object) {
  const [header] = object.signed.split(".");
  return JSON.parse(Buffer.from(header, "base64url").toString("utf8"));
}

// ---- the clock -----------------------------------------------------------------------------------------------

Given("the clock is fixed at {string}", function (text) {
  this.setClock(text);
});

When("the clock moves to {string}", function (text) {
  this.setClock(text);
});

// ---- building the declaration under test ------------------------------------------------------------------------

Given("a valid declaration object", function () {
  this.setDoc(baseDeclaration());
});

Given("a valid declaration object with target-type {string} and target {string}", function (type, target) {
  this.setDoc(baseDeclaration({ "target-type": type, target }));
});

Given("the draft's example {string}", function (title) {
  this.setDoc(draftExample(title));
});

Given("the declaration has period {string} to {string}", function (start, end) {
  this.mutateDoc((d) => (d.period = { start, end }));
});

Given("the member {string} is {string}", function (name, text) {
  this.mutateDoc((d) => setPath(d, name, value(text)));
});

Given("the member {string} is the JSON {string}", function (name, json) {
  this.mutateDoc((d) => setPath(d, name, JSON.parse(json)));
});

Given("the member {string} is the number {float}", function (name, number) {
  this.mutateDoc((d) => setPath(d, name, number));
});

Given("the member {string} is removed", function (name) {
  this.mutateDoc((d) => deletePath(d, name));
});

Given("every metric member and both evidence links are removed", function () {
  this.mutateDoc((d) => {
    for (const name of [...consumer.METRIC_MEMBERS, "disclosure-uri", "verifiable-attestation-uri"]) delete d[name];
  });
});

Given("the upstream member names {string} with role {string}", function (declaration, role) {
  this.mutateDoc((d) => (d.upstream = [...(d.upstream ?? []), { declaration, role }]));
});

// An extension whose members are numbers. The tool's answers take it when the tool is the subject.
Given(/^the extension "([^"]*)" is '(\{"[^"]*": -?\d+(?:\.\d+)?\})'$/, function (name, json) {
  this.addExtension(name, JSON.parse(json));
});

Given("the declaration is an array of objects with periods {string}, {string}", function (a, b) {
  this.setDoc([a, b].map((text) => baseDeclaration({ capabilities: "extended", period: periodFromText(text) })));
});

Given("the declaration is an array of objects with periods {string}, {string}, {string}", function (a, b, c) {
  this.setDoc([a, b, c].map((text) => baseDeclaration({ capabilities: "extended", period: periodFromText(text) })));
});

Given("the declaration is an array of two objects of one target and one period:", function (table) {
  this.setDoc(objectsFromTable(table));
});

Given("the declaration is an array of two objects:", function (table) {
  this.setDoc(objectsFromTable(table));
});

// In the Given position these edit the document; after a response they say what the answer lacks or covers.
Given("the object has no {string}", function (member) {
  if (afterResponse(this)) {
    assert.equal(getPath(oneObject(this), member), undefined, `the object has ${member}`);
    return;
  }
  this.mutateDoc((d) => deletePath(d, member));
});

Given("the object has no {string} and no {string}", function (a, b) {
  if (afterResponse(this)) {
    const object = oneObject(this);
    assert.equal(getPath(object, a), undefined, `the object has ${a}`);
    assert.equal(getPath(object, b), undefined, `the object has ${b}`);
    return;
  }
  this.mutateDoc((d) => {
    deletePath(d, a);
    deletePath(d, b);
  });
});

Given("the object has period {string} to {string}", function (start, end) {
  if (afterResponse(this)) {
    const { period } = oneObject(this);
    assert.ok(sameInstant(period.start, start) && sameInstant(period.end, end), `the period is ${period.start} to ${period.end}`);
    return;
  }
  this.mutateDoc((d) => (d.period = { start, end }));
});

Then("the object's period is {string} to {string}", function (start, end) {
  const { period } = oneObject(this);
  assert.equal(period.start, start);
  assert.equal(period.end, end);
});

Then("the object's {string} is {string}", function (member, text) {
  const actual = getPath(oneObject(this), member);
  const expected = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  })();
  assert.ok(actual === text || JSON.stringify(actual) === JSON.stringify(expected), `${member} is ${JSON.stringify(actual)}, expected ${text}`);
});

// ---- validation -----------------------------------------------------------------------------------------------

When("the consumer validates it", function () {
  this.readAs("strict");
});

When("the consumer reads it in strict mode", function () {
  this.readAs("strict");
});

Then("it is valid", function () {
  assert.equal(this.result.valid, true, `expected valid; errors: ${JSON.stringify(this.result.errors)}`);
});

Then("it is not valid", function () {
  assert.equal(this.result.valid, false, "expected the validator to reject it");
});

Then("the object is still valid", function () {
  const checked = consumer.validateDocument(this.subject());
  assert.equal(checked.valid, true, `errors: ${JSON.stringify(checked.errors)}`);
});

Then("the errors mention {string}", function (text) {
  assertMentions(this.result.errors, text, "error");
});

Then("the warnings mention {string}", function (text) {
  assertMentions(this.result.warnings, text, "warning");
});

Then("there is no warning mentioning {string}", function (text) {
  assert.ok(!this.result.warnings.join("\n").includes(text), `unexpected warning about "${text}": ${JSON.stringify(this.result.warnings)}`);
});

Then("the member {string} is read back as {string}", function (member, text) {
  const object = Array.isArray(this.read?.document) ? this.read.document[0] : (this.read?.document ?? oneObject(this));
  assert.equal(getPath(object, member), text);
});

Then("the extension name {string} is accepted", function (name) {
  assert.equal(consumer.isExtensionName(name), true, consumer.extensionNameError(name));
});

Then("the extension {string} is accepted", function (name) {
  const extensions = oneObject(this).extensions ?? {};
  assert.ok(typeof extensions[name] === "object" && extensions[name] !== null, `the object carries no extension ${name}`);
  assert.equal(consumer.isExtensionName(name), true, consumer.extensionNameError(name));
});

// Retrieval through a loopback server: the path on which the draft's tolerance rules apply.
When("the consumer retrieves and validates it", async function () {
  this.base = await this.serveText(this.docText ?? JSON.stringify(this.subject()));
  const fetched = await this.fetchLocal();
  const ok = fetched.status === "ok";
  this.result = {
    valid: ok,
    errors: ok ? [] : (fetched.errors ?? [`the fetch ended with ${textOf(fetched)}`]),
    warnings: fetched.warnings ?? [],
  };
  if (ok) this.read = { mode: "compatibility", document: fetched.document, converted: fetched.converted ?? [], disregarded: fetched.disregarded ?? [] };
});

When("the consumer retrieves it from {string}", function (uri) {
  this.retrievedFrom = uri;
  this.readAs("strict");
});

Then("the resolved {string} is {string}", function (member, expected) {
  const base = this.forwarded?.retrievalUri ?? this.retrievedFrom;
  assert.equal(new URL(getPath(oneObject(this), member), base).toString(), expected);
});

// A relay is modelled as a record: the declaration as stored, and the URI it was retrieved from.
When("a relay stores the declaration retrieved from {string}", function (uri) {
  this.retrievedFrom = uri;
  this.relayed = { retrievalUri: uri, declaration: structuredClone(this.subject()) };
});

When("the relay forwards it", function () {
  this.forwarded = { retrievalUri: this.relayed.retrievalUri, declaration: JSON.parse(JSON.stringify(this.relayed.declaration)) };
  this.setDoc(this.forwarded.declaration);
});

Then("the forwarded record carries the retrieval URI {string}", function (uri) {
  assert.equal(this.forwarded.retrievalUri, uri);
});

// Every dereference goes through the one transport, with a stand-in that records what it is asked for.
When("the consumer follows the evidence links of the object", async function () {
  const object = oneObject(this);
  const base = this.retrievedFrom;
  for (const member of ["methodology-uri", "disclosure-uri", "verifiable-attestation-uri"]) {
    if (typeof object[member] !== "string") continue;
    await consumer.fetchDisclosure(object[member], this.recorder, { base, timeoutMs: 2_000 }).catch(() => undefined);
    if (member === "verifiable-attestation-uri") {
      await consumer.verifyAttestation(object[member], { fetchImpl: this.recorder, base, timeoutMs: 2_000, now: this.now });
    }
  }
});

Then("no connection is made for {string}", function (reference) {
  const forms = new Set([reference]);
  try {
    forms.add(new URL(reference).toString());
  } catch {
    // a reference that is no URL is never dereferenced, so there is no other form to look for
  }
  const made = this.connections.filter((c) => forms.has(c));
  assert.deepEqual(made, [], `a connection was made for ${reference}`);
});

Then("no connection is made to {string}", function (target) {
  const made = this.connections.filter((c) => c.includes(target));
  assert.deepEqual(made, [], `a connection was made to ${target}`);
});

// ---- signatures ------------------------------------------------------------------------------------------------

/** Sign the subject with a key of the given name; alg EdDSA is the identifier of the older revision. */
async function signSubject(world, alg, keyName) {
  world.ensureDoc();
  const keyAlg = alg === "ES256" ? "ES256" : "Ed25519";
  assert.ok(["Ed25519", "ES256", "EdDSA"].includes(alg), `no way to sign with ${alg}`);
  const key = await world.namedKey(keyName ?? `default-${keyAlg}`, keyAlg);
  world.setDoc(await world.signObject(oneObject(world), key, { alg }));
}

Given("the object is signed with {word}", async function (alg) {
  await signSubject(this, alg);
});

Given("the object is signed with Ed25519 by key {string} carried in its header", async function (name) {
  await signSubject(this, "Ed25519", name);
});

Given("the object is re-signed with Ed25519 by key {string} carried in its header", async function (name) {
  await signSubject(this, "Ed25519", name);
});

Given("the object has {string} {string} and is signed with Ed25519", async function (member, text) {
  this.ensureDoc();
  this.mutateDoc((d) => setPath(d, member, coerce(member, text)));
  await signSubject(this, "Ed25519");
});

Given("the object is signed by the publisher with its default key", async function () {
  this.setDoc(await publisher.signDeclaration(oneObject(this), await publisher.generateSigningKey()));
});

Given(/^a -(\d+) document signed with EdDSA$/, async function (revision) {
  this.setDoc(legacyDocument(revision));
  await signSubject(this, "EdDSA");
});

Given("after signing, the member {string} is changed to {string}", function (member, text) {
  this.mutateDoc((d) => setPath(d, member, coerce(member, text)));
});

Given("after signing, the object's {string} is changed to {string}", function (member, text) {
  this.mutateDoc((d) => setPath(d, member, coerce(member, text)));
});

Given("the consumer holds an object for the same target and period with {string} {string}", function (member, text) {
  const object = oneObject(this);
  const held = { target: object.target, period: object.period, updated: object.updated, [member]: text };
  for (const name of ["carbon-accounting", "functional-unit"]) if (object[name] !== undefined) held[name] = object[name];
  this.policy.held = [...(this.policy.held ?? []), held];
});

When("the owner signs the output with an Ed25519 key", async function () {
  const key = await publisher.generateSigningKey();
  this.setDoc(await publisher.signDeclaration(this.upgrade.output, key));
  await this.verifySubject();
});

When("the consumer verifies the signature", async function () {
  await this.verifySubject();
});

When("the consumer verifies the signature and pins the key", async function () {
  await this.verifySubject();
  assert.equal(this.sig.status, "verified", JSON.stringify(this.sig));
  this.policy.pinnedKeys = [this.sig.publicJwk];
});

When("the consumer verifies every signature of the array", async function () {
  await this.verifySubject();
});

Then("the signature status is {string}", function (status) {
  assert.equal(this.sig.status, status, `signature outcome: ${JSON.stringify(this.sig)}`);
});

Then("every signature status is {string}", function (status) {
  assert.ok(this.sigs.length > 0, "no signature was checked");
  for (const s of this.sigs) assert.equal(s.status, status, JSON.stringify(s));
});

Then("the signature reason mentions {string}", function (text) {
  assert.equal(this.sig.status, "unverified", `the signature is ${this.sig.status}`);
  const all = `${this.sig.reason ?? ""} ${this.sig.detail ?? ""}`;
  assert.ok(all.includes(text), `reason "${all}" does not mention "${text}"`);
});

Then("the signature note mentions {string}", function (text) {
  assertMentions(this.sigNotes, text, "note");
});

Then("the signature header {string} is {string}", function (name, expected) {
  assert.equal(signedHeader(oneObject(this))[name], expected);
});

Then("the key trust level is {string}", function (level) {
  assert.equal(this.sig.keyTrust, level, JSON.stringify(this.sig));
});

Then("the object is reported as modified after signing", function () {
  assert.equal(this.sig.modifiedAfterSigning, true, JSON.stringify(this.sig));
});

Then("the object is reported as {string}", function (code) {
  assert.equal(code, "replay-suspected", `no way to read the report "${code}" from a signature outcome`);
  assert.ok(this.sig.replaySuspected, `no replay was suspected: ${JSON.stringify(this.sig)}`);
});

Then("the members in use are the ones the origin served, not the payload", function () {
  assert.ok(consumer.deepEqual(this.verified.document, this.subject()), "the members in use differ from the members served");
  if (this.sig.status === "verified") assert.equal(this.sig.precedence, "origin");
});

Then("the data is not reported as true or verified-accurate", function () {
  for (const outcome of this.sigs.length > 0 ? this.sigs : [this.sig].filter(Boolean)) {
    assert.ok(["verified", "unverified", "unsigned"].includes(outcome.status), JSON.stringify(outcome));
    assert.equal(outcome.accurate, undefined);
  }
  const reported = textOf({ fetch: this.fetchResult, verified: this.verified, presented: this.presented });
  assert.doesNotMatch(reported.replace(/accuracy unknown/g, ""), /verified-accurate|"accurate"|"true"/);
});

Then("the two signed members differ", function () {
  const objects = this.subjectObjects();
  assert.ok(objects.length >= 2, "the subject holds fewer than two objects");
  assert.notEqual(objects[0].signed, objects[1].signed);
});

// ---- plain HTTP -------------------------------------------------------------------------------------------------

Given("the reference gateway is running", async function () {
  await this.gateway();
});

Given("a gateway with a rate limit of {int} requests per minute", async function (perMinute) {
  if (this.gatewayHandle) await this.gatewayHandle.close();
  this.gatewayHandle = await startGateway({ rateLimitPerMinute: perMinute });
  this.servers.push(this.gatewayHandle.gw.server);
  this.base = this.gatewayHandle.base;
});

Given("the publisher is served on a local port", async function () {
  await this.servePublisher();
});

Given("the publisher is served on a local port as a static file", async function () {
  await this.servePublisher({ staticFile: true });
});

Given("a local server that answers the well-known path with {string} and status {int}", async function (contentType, status) {
  this.base = await this.serveText(JSON.stringify(this.doc ?? baseDeclaration()), { status, contentType });
});

Given("a local server whose body is a declaration with the raw member {string}", async function (raw) {
  const object = baseDeclaration();
  const named = /^"([^"]+)"\s*:/.exec(raw);
  if (named) delete object[named[1]];
  this.base = await this.serveText(`${JSON.stringify(object).slice(0, -1)},${raw}}`);
});

When("I send GET {string}", async function (path) {
  await this.send("GET", path);
});

When("I send GET {string} with the ETag of GET {string}", async function (path, source) {
  const first = await this.send("GET", source);
  const etag = first.headers.get("etag");
  assert.ok(etag, "the first response carried no ETag");
  await this.send("GET", path, { "If-None-Match": etag });
});

When("I send {int} GET requests to {string}", async function (count, path) {
  this.statuses = [];
  for (let i = 0; i < count; i++) this.statuses.push((await this.send("GET", path)).status);
});

Then("the status is {int}", function (status) {
  assert.equal(this.response.status, status, `body: ${this.response.body.slice(0, 200)}`);
});

Then("one of the statuses is {int}", function (status) {
  assert.ok(this.statuses.includes(status), `statuses: ${this.statuses.join(",")}`);
});

Then("the header {string} is {string}", function (name, expected) {
  assert.equal(this.response.headers.get(name), expected);
});

Then("the header {string} contains {string}", function (name, text) {
  const got = this.response.headers.get(name) ?? "";
  assert.ok(got.includes(text), `${name}: ${got}`);
});

Then("the header {string} is present", function (name) {
  assert.notEqual(this.response.headers.get(name), null, `${name} is missing`);
});

Then("the header {string} is not present", function (name) {
  assert.equal(this.response.headers.get(name), null, `${name} is present: ${this.response.headers.get(name)}`);
});

Then("the entity tag equals the entity tag of GET {string}", async function (path) {
  const etag = this.response.headers.get("etag");
  assert.ok(etag, "the response carried no ETag");
  const kept = this.response;
  const other = await this.send("GET", path);
  this.response = kept;
  assert.equal(other.headers.get("etag"), etag);
});

Then("the body is empty", function () {
  assert.equal(this.response.body, "");
});

Then("the body is a JSON object", function () {
  const body = this.subject();
  assert.ok(body && typeof body === "object" && !Array.isArray(body), "the body is not a JSON object");
});

Then("the body is a JSON array of {int} objects", function (count) {
  const body = this.subject();
  assert.ok(Array.isArray(body), "the body is not a JSON array");
  assert.equal(body.length, count);
});

Then("the body validates as a declaration", function () {
  const checked = consumer.validateDocument(this.subject());
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
});

Then("the body is in ascending period order without overlap", function () {
  const objects = this.subject();
  assert.ok(Array.isArray(objects), "the body is not a JSON array");
  for (let i = 1; i < objects.length; i++) {
    const [before, after] = [objects[i - 1].period, objects[i].period];
    assert.ok(consumer.compareDateTimes(before.start, after.start) < 0, `${before.start} is not before ${after.start}`);
    assert.equal(consumer.periodsOverlap(before, after), false, `${before.start}/${before.end} overlaps ${after.start}/${after.end}`);
  }
});

Then("the body is the same as for GET {string}", async function (path) {
  const kept = this.response;
  const other = await this.send("GET", path);
  this.response = kept;
  this.lastSet = "response";
  assert.deepEqual(JSON.parse(kept.body), JSON.parse(other.body));
});

// ---- the consumer's fetch --------------------------------------------------------------------------------------------

When("the consumer fetches the local origin allowing insecure transport", async function () {
  await this.fetchLocal();
});

When("the consumer fetches the local origin asking for start {string} and end {string} at granularity {string}", async function (start, end, granularity) {
  await this.fetchLocal({ start, end, granularity });
});

// No connection leaves the process: the stand-in answers, and a refused URI never reaches it.
When("the consumer fetches the origin {string}", async function (origin) {
  try {
    this.fetchResult = await consumer.fetchSustainability(origin, { timeoutMs: 3_000, fetchImpl: this.recorder });
  } catch (e) {
    this.fetchResult = { status: "threw", error: String(e.message ?? e) };
  }
});

Then("the fetch status is {string}", function (status) {
  assert.equal(this.fetchResult.status, status, JSON.stringify(this.fetchResult).slice(0, 400));
});

Then("the fetch did not succeed", function () {
  assert.notEqual(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 400));
});

Then("the fetch outcome mentions {string}", function (text) {
  assert.ok(textOf(this.fetchResult).includes(text), `outcome ${JSON.stringify(this.fetchResult).slice(0, 400)} does not mention "${text}"`);
});

Then("the fetch reports nothing as not requested", function () {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 400));
  assert.deepEqual(this.fetchResult.notAsRequested ?? [], []);
});

/** The periods the response names, never the ones asked for. */
const coveredPeriods = (fetched) => (fetched.covers ?? []).map((c) => c.period);

Then("the recorded coverage is {string} to {string}", function (start, end) {
  const periods = coveredPeriods(this.fetchResult);
  assert.ok(periods.length > 0, "the response is recorded as covering no period");
  const first = periods.reduce((a, b) => (consumer.compareDateTimes(b.start, a.start) < 0 ? b : a));
  const last = periods.reduce((a, b) => (consumer.compareDateTimes(b.end, a.end) > 0 ? b : a));
  assert.ok(sameInstant(first.start, start), `the coverage starts at ${first.start}`);
  assert.ok(sameInstant(last.end, end), `the coverage ends at ${last.end}`);
});

Then("the fetch reports that the period was not fully covered", function () {
  const { start, end } = this.lastFetchParams;
  const spans = mergeSpans(coveredPeriods(this.fetchResult));
  const fully =
    spans.length === 1 &&
    (start === undefined || consumer.compareDateTimes(spans[0].start, start) <= 0) &&
    (end === undefined || consumer.compareDateTimes(spans[0].end, end) >= 0);
  assert.equal(fully, false, `the response covers ${JSON.stringify(spans)}, which includes everything asked for`);
});

// ---- totals --------------------------------------------------------------------------------------------------------

When("the consumer totals the array", function () {
  this.total = undefined;
  this.totalRefusal = undefined;
  try {
    this.total = consumer.total(this.subjectObjects());
  } catch (e) {
    if (!(e instanceof consumer.TotalPreconditionError)) throw e;
    this.totalRefusal = e;
  }
});

Then("the coverage is {string}", function (coverage) {
  assert.ok(this.total, `no total: ${this.totalRefusal?.message}`);
  assert.equal(this.total.coverage, coverage);
});

Then("the total covers {string} to {string}", function (start, end) {
  assert.ok(this.total, `no total: ${this.totalRefusal?.message}`);
  assert.ok(sameInstant(this.total.period.start, start) && sameInstant(this.total.period.end, end), JSON.stringify(this.total.period));
});

Then("the periods covered are {string} to {string} and {string} to {string}", function (s1, e1, s2, e2) {
  const spans = mergeSpans(this.subjectObjects().map((o) => o.period));
  assert.equal(spans.length, 2, JSON.stringify(spans));
  assert.ok(sameInstant(spans[0].start, s1) && sameInstant(spans[0].end, e1), JSON.stringify(spans[0]));
  assert.ok(sameInstant(spans[1].start, s2) && sameInstant(spans[1].end, e2), JSON.stringify(spans[1]));
});

Then("the energy is {float} kWh", function (expected) {
  const o = oneObject(this);
  assert.equal(consumer.convertEnergy(o["energy-consumption"], o["energy-unit"] ?? "kWh", "kWh"), expected);
});

Then("the carbon is {float} gCO2e", function (expected) {
  const o = oneObject(this);
  assert.equal(consumer.convertCarbon(o["carbon-footprint"], o["carbon-unit"] ?? "gCO2e", "gCO2e"), expected);
});

// A period just published is classified as published; otherwise the period of the document. Every object of an array must agree.
Then("the period is classified as {string}", async function (unit) {
  const objects = this.buildPromise ? (await this.built()).objects : this.subjectObjects();
  assert.ok(objects.length > 0, "there is no object to classify");
  for (const { period } of objects) assert.equal(consumer.wholeCalendarUnit(period) ?? "none", unit, `${period.start} to ${period.end}`);
});

// ---- the upstream chain ------------------------------------------------------------------------------------------------

/** A subject that depends on `depth` providers, each a tenant declaration naming the next. */
Given("a subject declaration whose upstream chain is {int} declarations deep", function (depth) {
  this.upstream = { docs: new Map(), log: [] };
  const tenant = { target: "tenant.example", "target-type": "tenant" };
  for (let i = depth; i >= 1; i--) {
    const declaration = baseDeclaration({ ...tenant, "energy-consumption": 100 * i });
    if (i < depth) declaration.upstream = [{ declaration: this.chainUri(i + 1), role: "hosting" }];
    this.upstream.docs.set(this.chainUri(i), declaration);
  }
  this.setDoc(baseDeclaration({ ...tenant, "energy-consumption": 5000, upstream: [{ declaration: this.chainUri(1), role: "hosting" }] }));
});

Given("the upstream declaration has target-type {string}", function (type) {
  this.upstream.docs.get(this.chainUri(1))["target-type"] = type;
});

When("the consumer walks the upstream chain", async function () {
  this.walkError = undefined;
  try {
    this.comparisons = await consumer.compareUpstream(
      oneObject(this),
      {
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        maxObjects: 50,
        fetchImpl: this.upstreamFetch(),
        ...(this.retrievedFrom ? { base: new URL(this.retrievedFrom) } : {}),
        ...this.walkOptions,
      },
      this.walkVisited ?? new Set(),
    );
  } catch (e) {
    this.walkError = e;
  }
});

/** The words of the features for a verdict, and the consumer's. */
const VERDICTS = { inconsistent: "under-reported", "not comparable": "not-comparable" };

Then("a comparison verdict is {string}", function (verdict) {
  const wanted = VERDICTS[verdict] ?? verdict;
  const all = flatComparisons(this.comparisons);
  assert.ok(all.some((c) => c.verdict === wanted), JSON.stringify(all.map((c) => [c.declaration, c.verdict, c.detail])));
});

Then("every comparison names the period it compared", function () {
  const compared = flatComparisons(this.comparisons).filter((c) => c.verdict !== "unreachable");
  assert.ok(compared.length > 0, "nothing was compared");
  for (const c of compared) assert.ok(c.period?.start && c.period?.end, JSON.stringify(c));
});

Then("the walk completes", function () {
  assert.equal(this.walkError, undefined, String(this.walkError));
  assert.ok(Array.isArray(this.comparisons), "the walk gave no result");
});

Then("at most {int} upstream declarations were retrieved", function (count) {
  assert.ok(this.upstream.log.length <= count, `retrieved ${this.upstream.log.length}: ${this.upstream.log.join(", ")}`);
});

Then("exactly {int} upstream declarations were retrieved", function (count) {
  assert.equal(this.upstream.log.length, count, this.upstream.log.join(", "));
});

Then("no upstream URI was retrieved twice", function () {
  assert.equal(new Set(this.upstream.log).size, this.upstream.log.length, this.upstream.log.join(", "));
});

Then("the fourth declaration below the subject was never requested", function () {
  assert.ok(!this.upstream.log.includes(this.chainUri(4)), `requested: ${this.upstream.log.join(", ")}`);
});

Then("the upstream is reported as not retrieved", function () {
  const first = flatComparisons(this.comparisons)[0];
  assert.ok(first, "the walk reported nothing");
  assert.equal(first.verdict, "unreachable", JSON.stringify(first));
});

// ---- the publisher builds ----------------------------------------------------------------------------------------------

/** Build the published period from a calendar month and the zone or offset it is kept in. */
function monthIn(label, zone) {
  const [year, month] = label.split("-").map(Number);
  return publisher.monthPeriod(year, month, zone);
}

Given("a publisher given the period {string} to {string}", function (start, end) {
  this.inputPatch({ period: { start, end } });
});

Given("a publisher given the calendar month {string} in the time zone {string}", function (month, zone) {
  this.inputPatch({ period: monthIn(month, zone) });
});

Given("a publisher given the calendar month {string} with the offset {string}", function (month, offset) {
  this.inputPatch({ period: monthIn(month, offset) });
});

// The text members the draft defines, as the publisher input names them.
const INPUT_NAMES = {
  provider: "provider",
  updated: "updated",
  target: "target",
  "target-type": "targetType",
  "measurement-method": "measurementMethod",
  "methodology-uri": "methodologyUri",
  "disclosure-uri": "disclosureUri",
  "verifiable-attestation-uri": "verifiableAttestationUri",
};

// A defined member is the input's; any other is a member the draft does not define, and the publisher builds no object with it.
Given("a publisher given the member {string} as the string {string}", function (member, text) {
  if (INPUT_NAMES[member]) this.inputPatch({ [INPUT_NAMES[member]]: text });
  else this.inputPatch({ extra: { ...(this.input?.extra ?? {}), [member]: text } });
});

When("the publisher builds it", async function () {
  await this.built();
});

When("the publisher builds the declarations", async function () {
  await this.built();
});

Then("the publisher refuses to build it", async function () {
  assert.ok((await this.built()).error, "the publisher built an object");
});

Then("the publisher refuses and names {string}", async function (text) {
  const { error, objects } = await this.built();
  assert.ok(error, `the publisher built ${objects.length} object(s)`);
  assert.ok(error.message.includes(text), `the refusal does not name "${text}": ${error.message}`);
});

Then("the refusal names {string}", async function (text) {
  const { error } = await this.built();
  assert.ok(error, "the publisher did not refuse");
  assert.ok(error.message.includes(text), `the refusal does not name "${text}": ${error.message}`);
});

/** The first object the publisher published; an error of the build is raised here. */
async function published(world) {
  const { objects, error } = await world.built();
  if (error) throw error;
  assert.ok(objects.length > 0, "the publisher published no object");
  return objects[0];
}

Then("the published period is {string} to {string}", async function (start, end) {
  const { period } = await published(this);
  assert.equal(period.start, start);
  assert.equal(period.end, end);
});

Then("the published period ends no later than {string}", async function (member) {
  const object = await published(this);
  const limit = typeof object[member] === "string" ? object[member] : member;
  assert.ok(consumer.compareDateTimes(object.period.end, limit) <= 0, `the period ends ${object.period.end}, after ${limit}`);
});

Then("the published member {string} is {string}", async function (member, expected) {
  assert.equal(getPath(await published(this), member), expected);
});

Then("the published object has no member {string}", async function (member) {
  assert.equal(getPath(await published(this), member), undefined);
});

Then("every published object validates as a declaration", async function () {
  const { objects, error } = await this.built();
  if (error) throw error;
  assert.ok(objects.length > 0, "the publisher published no object");
  for (const object of objects) {
    const checked = consumer.validateDocument(object);
    assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  }
});

Then("the operator was warned about {string}", async function (text) {
  const { warnings, error } = await this.built();
  assert.ok(warnings.some((w) => w.includes(text)), `the operator was not warned about "${text}": ${JSON.stringify(warnings)} (build error: ${error?.message})`);
});

Then("the operator was not warned about {string}", async function (text) {
  const { warnings, error } = await this.built();
  if (error) throw error;
  assert.ok(!warnings.some((w) => w.includes(text)), `the operator was warned about "${text}": ${JSON.stringify(warnings)}`);
});

Given("the published text {string}", function (text) {
  this.publishedText = text;
});

Given("an extended publisher holding these periods:", async function (table) {
  await this.holdPeriods(table.hashes());
});

Given("an extended publisher with monthly entries for {string}", async function (labels) {
  const rows = labels.split(",").map((label) => ({ label: label.trim(), ...periodRow(label.trim()), target: "example.com" }));
  await this.holdPeriods(rows);
});

function periodRow(label) {
  const { start, end } = periodFromText(label);
  return { start, end };
}

// ---- the schemas --------------------------------------------------------------------------------------------------------

Then("the publisher's schema agrees", function () {
  assert.equal(jtdAccepts(publisher.RESPONSE_JTD_SCHEMA, this.subject()), this.result.valid, "the publisher's schema and the consumer disagree");
});

Then("the CDDL agrees", function () {
  assert.equal(cddlAccepts(this.docText ?? this.subject()), this.result.valid, "the draft CDDL and the consumer disagree");
});

// ---- attestations -------------------------------------------------------------------------------------------------------

When("the consumer checks the attestation URI {string}", async function (uri) {
  this.attestationReads = [];
  const fetchImpl = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    this.attestationReads.push(url);
    const credential = this.credentials.get(url);
    if (!credential) return new Response("", { status: 404 });
    return new Response(credential.body, { status: credential.status ?? 200, headers: { "Content-Type": credential.contentType ?? "application/vc+jwt" } });
  };
  this.attestation = await consumer.verifyAttestation(uri, {
    fetchImpl,
    now: this.now,
    timeoutMs: 5_000,
    declaration: oneObject(this),
    ...(this.retrievedFrom ? { base: this.retrievedFrom } : {}),
    ...this.attestationOptions,
  });
});

/**
 * The reason the features give for a credential that does not attest the object, from what the consumer reports:
 * a failed check names its own reason; a credential that checks out but is not trusted or does not cover the object says why.
 */
function attestationReason(result) {
  if (!result.valid) {
    if (/^http-|network|not-found|refus/.test(result.reason)) return "not retrieved";
    return result.reason.replace(/-/g, " ");
  }
  if (result.assurance !== "issuer-key-pinned") return "no trusted issuer";
  if (result.coverage.status === "does-not-cover") return /about/.test(result.coverage.detail) ? "target not covered" : "period not covered";
  return undefined;
}

const attested = (result) => result.valid && result.attested;

Then("the attestation is valid", function () {
  assert.ok(attested(this.attestation), `not attested: ${JSON.stringify(this.attestation).slice(0, 400)}`);
});

Then("the attestation is not valid", function () {
  assert.ok(!attested(this.attestation), "the object is attested");
});

Then("the attestation reason is {string}", function (reason) {
  assert.equal(attestationReason(this.attestation), reason, JSON.stringify(this.attestation).slice(0, 400));
});

// The issuer is not independent of the publisher when both are the same host.
Then("the attestation notes that the issuer is not independent of the publisher", function () {
  const issuer = new URL(this.attestation.issuer).hostname;
  const publisherHost = new URL(this.attestation.url).hostname;
  assert.equal(issuer, publisherHost, `the issuer ${issuer} is not the publisher ${publisherHost}`);
});

Then("exactly one attestation URI is read", function () {
  if (this.attestationReads.length > 0) {
    assert.equal(this.attestationReads.length, 1, this.attestationReads.join(", "));
    return;
  }
  assert.equal(typeof oneObject(this)["verifiable-attestation-uri"], "string", "the object does not name exactly one attestation URI");
});

// ---- the presentation -------------------------------------------------------------------------------------------------------

Then("the presentation says the figures are claims of the origin that served them", async function () {
  const { origin, stderr } = await this.presentation();
  assert.ok(stderr.includes(`every figure above is a claim of ${new URL(origin).origin}`), stderr);
});

Then("the presentation says the figures cover {string} to {string}", async function (start, end) {
  const { stdout } = await this.presentation();
  const shown = JSON.parse(stdout);
  const periods = (Array.isArray(shown) ? shown : [shown]).map((o) => o.period);
  assert.ok(periods.some((p) => sameInstant(p.start, start) && sameInstant(p.end, end)), `the output shows ${JSON.stringify(periods)}`);
});

Then("the command-line consumer exits with status {int}", async function (status) {
  const { status: code, stderr } = await this.presentation();
  assert.equal(code, status, stderr);
});

Then("the presentation says the signature shows integrity and not accuracy", async function () {
  const { stderr } = await this.presentation();
  assert.match(stderr, /integrity verified/);
  assert.match(stderr, /accuracy unknown/);
});

Then("the badge does not contain the words {string} or {string}", function (a, b) {
  const text = this.response.body.toLowerCase();
  assert.ok(!text.includes(a.toLowerCase()) && !text.includes(b.toLowerCase()), `the badge says "${a}" or "${b}"`);
});

// ---- the legal wording and text checks ---------------------------------------------------------------------------------------

Then("the check fails", function () {
  assert.ok(this.check, "no check ran");
  assert.equal(this.check.passed, false, "the check passed");
});

Then("the check message mentions {string}", function (text) {
  assert.ok(this.check.message.includes(text), `the message does not mention "${text}": ${this.check.message}`);
});

Then("the test fails", function () {
  assert.ok(this.check, "no test ran");
  assert.equal(this.check.passed, false, "the test passed");
});

Then("the test message mentions {string}", function (text) {
  assert.ok(this.check.message.includes(text), `the message does not mention "${text}": ${this.check.message}`);
});

// ---- the CSV adapter ----------------------------------------------------------------------------------------------------------

When("the CSV adapter reads it", async function () {
  const skipped = [];
  const adapter = publisher.csvAdapter({
    provider: "Example Org (https://example.com/contact)",
    methodologyUri: "https://example.com/methodology",
    measurementMethod: "hardware-metered",
    target: "example.com",
    targetType: "origin",
    ...this.csvConfig,
    text: this.csvText,
    onSkip: (line, reason) => skipped.push({ line, reason }),
  });
  const objects = await adapter.fetch({});
  this.adapterOutput = { objects: [objects].flat(), skipped };
});

Then("the adapter yields {int} objects", function (count) {
  assert.equal(this.adapterOutput.objects.length, count);
});

Then("the adapter reports the skipped row with the reason mentioning {string}", function (text) {
  assert.ok(this.adapterOutput.skipped.some((s) => s.reason.includes(text)), JSON.stringify(this.adapterOutput.skipped));
});

// ---- the create-sustainability-data tool -------------------------------------------------------------------------------------------

/** The answers that give a conformant file; steps change them by name (an option of the tool, without the dashes). */
const DEFAULT_ANSWERS = {
  target: "Acme Retail plc",
  "target-type": "organization",
  provider: "Acme Retail plc (sustainability@acme.example)",
  "methodology-uri": "/esg/methodology",
  period: "2025",
  "measurement-method": "third-party-modeled",
  "carbon-footprint": "610",
  "carbon-unit": "tCO2e",
  "disclosure-uri": "https://acme.example/esg/disclosures",
  "verifiable-attestation-uri": "https://acme.example/esg/attestation.jwt",
  updated: "2026-10-24T12:00:00Z",
};

const SWITCHES = new Set(["yes", "methodology-stub"]);

/** The command line for the answers; a repeated answer (extension, upstream) is a list. */
function toolArguments(answers, out) {
  const args = ["--out", out, "--host", "file", "--yes"];
  for (const [name, answer] of Object.entries(answers)) {
    if (name === "period" && String(answer).includes("/")) {
      const [start, end] = answer.split("/");
      args.push("--period-start", start, "--period-end", end);
    } else if (SWITCHES.has(name)) {
      if (answer) args.push(`--${name}`);
    } else if (Array.isArray(answer)) {
      for (const each of answer) args.push(`--${name}`, each);
    } else args.push(`--${name}`, String(answer));
  }
  return args;
}

Given("the create-sustainability-data tool is given the default answers", function () {
  this.answers = { ...DEFAULT_ANSWERS };
});

Given("the answer {string} is {string}", function (name, text) {
  this.answers[name] = text;
});

Given("the answer {string} is removed", function (name) {
  delete this.answers[name];
});

When("the create-sustainability-data tool runs", async function () {
  const outDir = this.tempDir("tool");
  const r = await runNode([BIN.createData, ...toolArguments(this.answers, outDir)]);
  const files = this.filesUnder(outDir);
  this.run = { program: "create-sustainability-data", ...r, outDir, files };
  const declarationFile = Object.keys(files).find((name) => name.endsWith("sustainability-data"));
  this.written = declarationFile ? { path: declarationFile, json: JSON.parse(files[declarationFile]) } : undefined;
});

Then("the tool writes one file", function () {
  assert.equal(this.run.status, 0, this.run.stderr);
  assert.deepEqual(Object.keys(this.run.files).length, 1, `the tool wrote ${Object.keys(this.run.files).join(", ")}`);
});

Then("the tool refuses and names {string}", function (text) {
  assert.notEqual(this.run.status, 0, "the tool did not refuse");
  assert.ok(`${this.run.stderr}${this.run.stdout}`.includes(text), `the refusal does not name "${text}": ${this.run.stderr}`);
});

Then("no output file was written", function () {
  assert.deepEqual(Object.keys(this.run.files), [], "files were written");
});

Then("the written file validates as a declaration", function () {
  assert.ok(this.written, "the tool wrote no declaration");
  const checked = consumer.validateDocument(this.written.json);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
});

// ---- the upgrade tool ----------------------------------------------------------------------------------------------------------------

Given("a gateway data file whose declaration is in a {string} member", function (member) {
  const legacy = legacyDocument("08");
  const json = member === "document" ? { document: legacy } : legacy;
  this.setDoc(json);
  this.gatewayDataFile = { name: "legacy-subject.example.json", json };
});

/** Run `sustainability-publisher upgrade IN` on the document, with the flags given as one text: with IN alone the converted document goes to standard output. */
async function runUpgrade(world, flags) {
  const dir = world.tempDir("upgrade");
  const input = world.writeFileIn(dir, "in/document.json", world.docText ?? JSON.stringify(world.doc, null, 2));
  const outDir = join(dir, "out");
  const r = await runNode([BIN.publisher, "upgrade", input, ...flags]);
  const files = world.filesUnder(outDir);
  let output;
  try {
    output = JSON.parse(r.stdout);
  } catch {
    // a run that fails writes nothing to read
  }
  world.run = { program: "upgrade", ...r, outDir, files };
  world.upgrade = { ...r, outFile: input, output };
}

When("the upgrade tool runs on the document", async function () {
  await runUpgrade(this, []);
});

When("the upgrade tool runs on the document with {string}", async function (flags) {
  await runUpgrade(this, flags.split(/\s+/).filter(Boolean));
});

Then("the upgrade exits with status {int}", function (status) {
  assert.equal(this.upgrade.status, status, this.upgrade.stderr);
});

Then(/^the upgrade output is valid under the -(\d+) schema and the CDDL$/, function (revision) {
  assert.equal(Number(revision), 10, "the suite checks the current revision");
  assert.ok(this.upgrade.output, `the upgrade wrote no output: ${this.upgrade.stderr}`);
  const declaration = this.upgrade.output.document ?? this.upgrade.output;
  const checked = consumer.validateDocument(declaration);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(cddlAccepts(declaration), true, "the draft CDDL rejects the output");
});
