/**
 * Steps about the HTTP exchange: other methods and conditional requests, the body of a response and the periods it
 * lists, publishers that honour some of the query parameters, loopback servers with a body of the scenario's
 * choosing, the consumer's requests and what it records as covered, the reference gateway (its start, its data, its
 * public validator and badge, its pages), the static deployment kits, and the CSV adapter.
 *
 * The phrases of this file are exactly those assigned to the http step owner; the World (world.mjs) says what
 * every field means. The fields this file adds to the World (declared where they are first used):
 *   shapes            the consumer's reading of the same declaration as one object and as an array of one
 *   validatorState    the stand-ins of the gateway's public validator: { origin, addresses, deps, calls }
 *   gatewayStart      the outcome of the last "the gateway starts": { handle } or { error }
 *   kit               the static kit under test: { name, texts }
 *   indexEntry, pageCopy   what the index check and the accessibility run look at
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Given, Then, When } from "@cucumber/cucumber";
import { MEDIA_TYPE, ROOT, WELL_KNOWN, baseDeclaration, consumer, flatComparisons, getPath, periodFromText, startGateway } from "./world.mjs";

// ---- small helpers -----------------------------------------------------------------------------------------------

/** The body of the last response as JSON. */
const bodyJson = (world) => world.response.json();

/** The body as an array of objects. */
function bodyArray(world) {
  const body = bodyJson(world);
  assert.ok(Array.isArray(body), "the body is not a JSON array");
  return body;
}

/** The text of a data file of the repository. */
const repoFile = (relative) => readFileSync(join(ROOT, relative), "utf8");

/** The path of a request without its query. */
const pathOf = (url) => url.split("?")[0];

/** The last request a loopback server received. */
function lastRequest(world) {
  assert.ok(world.requests.length > 0, "no request reached a loopback server");
  return world.requests[world.requests.length - 1];
}

/** The fixed text of the labels a scenario writes: "2025-01, 2025" is two labels. */
const labelsOf = (text) => (text.trim() === "" ? [] : text.split(",").map((label) => label.trim()));

/** The labels of the objects of the body, in the order served. */
function servedLabels(world) {
  return bodyArray(world).map((object) => world.labelOf(object));
}

// ---- other methods and conditional requests --------------------------------------------------------------------------

// GET is the common owner's; every other method is sent the same way.
When(/^I send (?!GET )([A-Z]+) "([^"]*)"$/, async function (method, path) {
  await this.send(method, path);
});

When("I send GET {string} with If-None-Match {string}", async function (path, etag) {
  await this.send("GET", path, { "If-None-Match": etag });
});

When("I send GET {string} with the weak form of the ETag of GET {string}", async function (path, source) {
  const etag = (await this.send("GET", source)).headers.get("etag");
  assert.ok(etag, "the first response carried no ETag");
  await this.send("GET", path, { "If-None-Match": `W/${etag}` });
});

Given("{int} requests were sent to {string}", async function (count, path) {
  this.statuses = [];
  for (let i = 0; i < count; i++) this.statuses.push((await this.send("GET", path)).status);
});

Then("every status is {int}", function (status) {
  assert.ok(this.statuses.length > 0, "no request was counted");
  assert.deepEqual([...new Set(this.statuses)], [status]);
});

Then("the last response carries a {string} of a positive number of seconds", function (name) {
  const seconds = Number(this.response.headers.get(name));
  assert.ok(Number.isInteger(seconds) && seconds > 0, `${name}: ${this.response.headers.get(name)}`);
});

Then("the last response body is a JSON error", function () {
  assertJsonError(this.response.body);
});

Then("the headers equal the headers of GET {string}", async function (path) {
  const head = this.response;
  const get = await this.send("GET", path);
  this.response = head;
  const volatile = new Set(["date", "connection", "keep-alive", "transfer-encoding"]);
  const without = (headers) => Object.fromEntries([...headers].filter(([name]) => !volatile.has(name)));
  assert.deepEqual(without(head.headers), without(get.headers));
});

Then("the two bodies are identical", async function () {
  // The two requests of the scenario are the last two the server received.
  const [first, second] = this.requests.filter((r) => r.method === "GET").slice(-2);
  assert.ok(first && second, "fewer than two GET requests were made");
  const a = await fetch(`${this.base}${first.url}`);
  const b = await fetch(`${this.base}${second.url}`);
  assert.equal(await a.text(), await b.text());
});

Then("the body is identical to the body of GET {string}", async function (path) {
  const kept = this.response;
  const other = await this.send("GET", path);
  this.response = kept;
  this.lastSet = "response";
  assert.equal(kept.body, other.body);
});

// ---- the body of a response ----------------------------------------------------------------------------------------------

Then("the body is a JSON array", function () {
  bodyArray(this);
});

/** A gateway error is a JSON object with an `error` text and nothing of a declaration. */
function assertJsonError(body) {
  const json = JSON.parse(body);
  assert.equal(typeof json.error, "string", `not a JSON error: ${body.slice(0, 200)}`);
}

Then("the body is a JSON error", function () {
  assertJsonError(this.response.body);
});

Then("the body is not a declaration", function () {
  assert.equal(consumer.validateDocument(bodyJson(this)).valid, false, "the body is a declaration");
});

Then("the body has no byte order mark", function () {
  assert.notDeepEqual([...this.response.bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

Then("the body is encoded in UTF-{int}", function (bits) {
  assert.equal(bits, 8, "the suite checks UTF-8");
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(this.response.bytes);
  assert.deepEqual(Buffer.from(decoded, "utf8"), this.response.bytes);
});

// A gateway error states the HTTP status as a number; a `status` word would be an outcome about an origin.
Then("the body has no member {string}", function (member) {
  const body = bodyJson(this);
  assert.ok(!(member in body) || (member === "status" && typeof body.status === "number"), `the body has the member ${member}`);
});

Then("the body {string} is a number", function (member) {
  assert.equal(typeof getPath(bodyJson(this), member), "number");
});

Then("the body {string} is {string}", function (member, expected) {
  assert.equal(getPath(bodyJson(this), member), expected);
});

Then("the body has at most {int} objects", function (count) {
  assert.ok(bodyArray(this).length <= count, `the body holds ${bodyArray(this).length} objects`);
});

Then("the body equals the data file {string}", function (file) {
  assert.deepEqual(bodyJson(this), JSON.parse(repoFile(file)));
});

Then("the body is in ascending period order", function () {
  const objects = bodyArray(this);
  for (let i = 1; i < objects.length; i++) {
    assert.ok(consumer.comparePeriodStart(objects[i - 1].period, objects[i].period) <= 0, `object ${i} starts before object ${i - 1}`);
  }
});

Then("every object's {string} has date-time bounds", function (member) {
  for (const object of bodyArray(this)) {
    for (const bound of ["start", "end"]) {
      assert.equal(consumer.dateTimeError(object[member][bound]), undefined, `${member}.${bound}: ${object[member][bound]}`);
    }
  }
});

Then("every object's {string} is {string}", function (member, expected) {
  const objects = bodyArray(this);
  assert.ok(objects.length > 0, "the body holds no object");
  for (const object of objects) assert.equal(getPath(object, member), expected);
});

Then("the first object has period {string} to {string}", function (start, end) {
  assert.deepEqual(bodyArray(this)[0].period, { start, end });
});

Then("the second object has period {string} to {string}", function (start, end) {
  assert.deepEqual(bodyArray(this)[1].period, { start, end });
});

Then("the object has no gateway signature", function () {
  assert.ok(!("signed" in bodyJson(this)), "the object carries a signed member");
});

Then("the served signed member is the one held in the data file", function () {
  const held = JSON.parse(repoFile("example-responses/example-response-signed-array.json"));
  for (const served of bodyArray(this)) {
    const same = held.find((o) => consumer.deepEqual(o.period, served.period));
    assert.ok(same, `the data file holds no object for ${JSON.stringify(served.period)}`);
    assert.equal(served.signed, same.signed);
  }
});

// ---- the periods a body lists ------------------------------------------------------------------------------------------------

Then(/^the body lists the periods (.*)$/, function (labels) {
  assert.deepEqual(servedLabels(this), labelsOf(labels));
});

Then("the body lists no periods", function () {
  assert.deepEqual(servedLabels(this), []);
});

// An object served as the publisher holds it: the same bytes as the publisher's own build, signatures included.
async function heldObject(world, label) {
  const built = await world.publisher.build({});
  return [built].flat().find((object) => world.labelOf(object) === label);
}

Then("the object {string} is exactly the object the publisher holds", async function (label) {
  const served = bodyArray(this).find((object) => this.labelOf(object) === label);
  assert.ok(served, `the body lists no period ${label}`);
  assert.deepEqual(served, await heldObject(this, label));
});

Then("every object is identical to the held object of the same label", async function () {
  const objects = bodyArray(this);
  assert.ok(objects.length > 0, "the body holds no object");
  for (const served of objects) assert.deepEqual(served, await heldObject(this, this.labelOf(served)));
  // The signatures of the served bytes are checked here too, for the step that follows.
  if (objects.every((object) => typeof object.signed === "string")) await this.verifySubject();
});

Given("every held object is signed with Ed25519", async function () {
  await this.reholdWith({ signing: await this.namedKey("HELD") });
});

// ---- publishers with a shape of their own -----------------------------------------------------------------------------------

Given("a basic publisher with one entry for {string}", function (label) {
  this.inputPatch({ period: periodFromText(label) });
});

Given("a basic publisher with no entry", function () {
  this.adapter = { name: "empty", capabilities: "basic", fetch: async () => [] };
  this.publisher = undefined;
  this.invalidateBuild();
});

Given("an extended publisher holding no periods", async function () {
  await this.holdPeriods([]);
});

Given("an extended publisher holding these periods in this order:", async function (table) {
  await this.holdPeriods(table.hashes());
});

Given("an extended publisher that honours only {string}", async function (honoured) {
  await this.reholdWith({ honours: honoured.split(",").map((name) => name.trim()) });
});

Given("an extended publisher that ignores the target parameter and holds these periods:", async function (table) {
  await this.holdPeriods(table.hashes(), { honours: ["start", "end", "granularity"] });
});

// The publisher refuses an object with a member the draft does not define; the refusal is read by the steps that follow.
Given("a publisher is asked to build an object with the top-level member {string}", function (member) {
  this.inputPatch({ extra: { ...(this.input?.extra ?? {}), [member]: "x" } });
});

// ---- the CSV adapter -----------------------------------------------------------------------------------------------------------

Given("a CSV with monthly rows for {string}", function (labels) {
  const rows = labels === "" ? [] : labelsOf(labels).map((label) => `${label},100`);
  this.csvText = ["period,energy", ...rows].join("\n") + "\n";
});

Then("no object has the period {string} to {string}", function (start, end) {
  const match = this.adapterOutput.objects.find((o) => o.period?.start === start && o.period?.end === end);
  assert.equal(match, undefined, "the adapter yielded an object for that period");
});

Then("the written member {string} is present", function (member) {
  assert.notEqual(getPath(writtenObject(this), member), undefined, `the file has no ${member}`);
});

Then("the written member {string} is {string}", function (member, expected) {
  assert.equal(getPath(writtenObject(this), member), expected);
});

/** The declaration the create-sustainability-data tool wrote. */
function writtenObject(world) {
  assert.ok(world.written, "the tool wrote no declaration");
  const json = world.written.json;
  return Array.isArray(json) ? json[0] : json;
}

// ---- loopback servers with a body of the scenario's choosing --------------------------------------------------------

Given(/^a local server whose body is the raw text '(.*)'$/, async function (text) {
  this.base = await this.serveText(text);
});

Given("a local server whose body is the bytes {string}", async function (hex) {
  this.base = await this.serveText(Buffer.from(hex.replace(/\s+/g, ""), "hex"));
});

// ---- the header check ---------------------------------------------------------------------------------------------------------------

When("the header check runs on the local origin", async function () {
  const type = (await fetch(`${this.base}${WELL_KNOWN}`)).headers.get("content-type");
  const parameter = type !== null && type.includes(";");
  this.check = {
    passed: type === MEDIA_TYPE,
    message: parameter ? `the Content-Type "${type}" carries a media type parameter; the registered type has none` : `the Content-Type is "${type}", not ${MEDIA_TYPE}`,
  };
});

Then("the header check reports {string}", function (text) {
  assert.equal(this.check.passed, false, "the header check passed");
  assert.ok(this.check.message.includes(text), this.check.message);
});

// ---- the consumer's requests and what it records as covered -----------------------------------------------------------------

When("the consumer fetches the local origin asking for start {string} and end {string}", async function (start, end) {
  await this.fetchLocal({ start, end });
});

When("the consumer fetches the local origin asking for target {string}", async function (target) {
  await this.fetchLocal({ target });
});

When("the consumer fetches the local origin with the fragment {string} allowing insecure transport", async function (fragment) {
  const url = `${this.base}${WELL_KNOWN}#${fragment}`;
  this.lastOrigin = this.base;
  this.fetchResult = await consumer.fetchSustainability(url, { allowInsecure: true, timeoutMs: 5_000 });
  if (this.fetchResult.status === "ok") this.lastSet = "fetch";
});

// The request is built before any connection is made, so a bound that is not a date-time is refused on the spot.
When("the consumer builds a request asking for start {string}", async function (start) {
  this.requestError = undefined;
  try {
    await consumer.fetchSustainability("https://example.com", { start, fetchImpl: this.recorder });
  } catch (e) {
    this.requestError = e;
  }
});

Then("the consumer refuses with a message mentioning {string}", function (text) {
  assert.ok(this.requestError, "the consumer built the request");
  assert.ok(this.requestError.message.includes(text), this.requestError.message);
  assert.deepEqual(this.connections, [], "the consumer made a connection");
});

Then("the request carried {string}", function (pair) {
  const query = lastRequest(this).url.split("?")[1] ?? "";
  const decoded = query.split("&").map(decodeURIComponent);
  assert.ok(decoded.includes(pair), `the query was "${query}"`);
});

Then("the request carried no {string} character in its query", function (character) {
  const query = lastRequest(this).url.split("?")[1] ?? "";
  assert.ok(!query.includes(character), `the query was "${query}"`);
});

Then("the request target was {string}", function (target) {
  assert.equal(lastRequest(this).url, target);
});

Then("the consumer requested the path {string}", function (path) {
  assert.equal(pathOf(lastRequest(this).url), path);
});

Then("the fetched media type class is {string}", function (kind) {
  assert.equal(this.fetchResult.mediaType, kind);
});

Then("the fetch does not report an error", function () {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 400));
});

/** What the fetch flagged as not as requested, by the member the message starts with. */
const flagged = (world, member) => (world.fetchResult.notAsRequested ?? []).filter((message) => message.startsWith(`${member}:`));

Then("the fetch reports that the period was not as requested", function () {
  assert.ok(flagged(this, "period").length > 0, JSON.stringify(this.fetchResult.notAsRequested));
});

Then("the fetch reports that the target was not as requested", function () {
  assert.ok(flagged(this, "target").length > 0, JSON.stringify(this.fetchResult.notAsRequested));
});

// A response is recorded as covering what its objects name; "covered" here is what overlaps the range, or names the target, that was asked for.
Then("no period is recorded as covered", function () {
  const { start, end } = this.lastFetchParams;
  const overlapping = (this.fetchResult.covers ?? []).filter(
    ({ period }) => (start === undefined || consumer.compareDateTimes(period.end, start) > 0) && (end === undefined || consumer.compareDateTimes(period.start, end) < 0),
  );
  assert.deepEqual(overlapping, [], "the response is recorded as covering part of the range asked for");
});

Then("no target is recorded as covered", function () {
  const covered = (this.fetchResult.covers ?? []).filter(({ target }) => target === this.lastFetchParams.target);
  assert.deepEqual(covered, []);
});

/** The index of the object with this label in the fetched document. */
function indexOfLabel(world, label) {
  const index = world.fetchResult.document.findIndex((object) => world.labelOf(object) === label);
  assert.ok(index >= 0, `the response holds no object ${label}`);
  return index;
}

Then("the object {string} is reported as not the requested target", function (label) {
  const at = `object [${indexOfLabel(this, label)}]`;
  assert.ok(flagged(this, "target").some((message) => message.includes(at)), JSON.stringify(this.fetchResult.notAsRequested));
});

Then("the target {string} is recorded as covered by {string} only", function (target, label) {
  const { covers, document } = this.fetchResult;
  const labels = covers.flatMap((cover, i) => (cover.target === target ? [this.labelOf(document[i])] : []));
  assert.deepEqual(labels, [label]);
});

Then("the total is not presented as covering {string} to {string}", function (start, end) {
  assert.ok(this.total, `no total: ${this.totalRefusal?.message}`);
  const { period, coverage } = this.total;
  const spansRange = consumer.compareDateTimes(period.start, start) === 0 && consumer.compareDateTimes(period.end, end) === 0;
  assert.ok(!(spansRange && coverage === "contiguous"), "the total claims the whole range");
});

// ---- one object and an array of one -------------------------------------------------------------------------------------------

When("the consumer validates it as a single object", async function () {
  await readShape(this, "single", this.doc);
});

When("the consumer validates it as an array of one object", async function () {
  await readShape(this, "array", [this.doc]);
});

/** The declaration in one shape: validated, and fetched from a loopback server that serves it in that shape. */
async function readShape(world, name, document) {
  const validated = consumer.validateDocument(structuredClone(document));
  const base = await world.serveText(JSON.stringify(document));
  const fetched = await consumer.fetchSustainability(base, { allowInsecure: true, timeoutMs: 5_000 });
  (world.shapes ??= {})[name] = { validated, fetched };
}

Given("the array is empty", function () {
  this.setDoc([]);
});

Then("the consumer reads no declaration object from it", function () {
  assert.deepEqual(this.read.document, []);
});

Then("both are valid", function () {
  for (const { validated, fetched } of Object.values(this.shapes)) {
    assert.equal(validated.valid, true, JSON.stringify(validated.errors));
    assert.equal(fetched.status, "ok", JSON.stringify(fetched).slice(0, 400));
  }
});

Then("both yield the same declaration", function () {
  const objects = ({ fetched }) => [fetched.document].flat();
  assert.deepEqual(objects(this.shapes.single), objects(this.shapes.array));
  assert.deepEqual(this.shapes.single.fetched.covers, this.shapes.array.fetched.covers);
});

// ---- the upstream chain served by the gateway ------------------------------------------------------------------------------

// The upstream references of the served examples are relative, so they resolve onto the same loopback gateway.
When("the consumer walks the upstream chain from {string}", async function (path) {
  const uri = `${this.base}${path}`;
  const subject = (await this.send("GET", path)).json();
  this.upstream = { docs: new Map(), log: [] };
  const log = (input, init) => {
    this.upstream.log.push(typeof input === "string" ? input : input.url);
    return fetch(input, init);
  };
  this.walkError = undefined;
  try {
    this.comparisons = await consumer.compareUpstream(
      subject,
      { allowInsecure: true, timeoutMs: 5_000, maxBytes: 1_000_000, maxObjects: 50, fetchImpl: log, base: new URL(uri), ...this.walkOptions },
      new Set([uri]),
    );
  } catch (e) {
    this.walkError = e;
  }
});

Then("the walk reports a loop", function () {
  const details = flatComparisons(this.comparisons).map((c) => c.detail ?? "");
  assert.ok(details.some((detail) => detail.includes("loop")), JSON.stringify(details));
});

// ---- the reference gateway: its start and its data -------------------------------------------------------------------------

/** Every declaration data file of the gateway, the withheld ones included. */
function declarationDataFiles() {
  const names = [];
  for (const dir of ["gateway/data", "gateway/data/withheld"]) {
    for (const entry of readdirSync(join(ROOT, dir))) if (entry.endsWith(".json") && !entry.startsWith("_")) names.push(`${dir}/${entry}`);
  }
  return names;
}

Given(/^the (\d+) declaration data files of the gateway are in -(\d+) form$/, function (count, revision) {
  assert.equal(Number(revision), 10, "the suite checks the current revision");
  const files = declarationDataFiles();
  assert.equal(files.length, Number(count));
  for (const file of files) {
    const json = JSON.parse(repoFile(file));
    const checked = consumer.validateDocument(json);
    assert.equal(checked.valid, true, `${file}: ${JSON.stringify(checked.errors)}`);
    assert.ok(!JSON.stringify(json).includes('"reporting-period"'), `${file} is not in -10 form`);
  }
});

Given("the gateway data file {string} is not a declaration", function (file) {
  assert.equal(consumer.validateDocument(JSON.parse(repoFile(file))).valid, false, `${file} is a declaration`);
  this.gatewayDataFile = undefined;
});

// A gateway of its own on a copy of the data directory, with the scenario's data file added; it reads the whole directory at start.
When("the gateway starts", async function () {
  const extra = this.gatewayDataFile ? { [this.gatewayDataFile.name]: this.gatewayDataFile.json } : {};
  try {
    const handle = await startGateway({ dataDir: this.gatewayDataDir(extra), now: this.now });
    this.servers.push(handle.gw.server);
    this.gatewayStart = { handle };
  } catch (error) {
    this.gatewayStart = { error };
  }
});

Then("the gateway is running", async function () {
  const { handle, error } = this.gatewayStart ?? {};
  assert.ok(handle, `the gateway did not start: ${error?.message}`);
  assert.equal((await fetch(`${handle.base}/healthz`)).status, 200);
});

Then("the gateway refuses to start", function () {
  assert.ok(this.gatewayStart?.error, "the gateway started");
});

Then("the start message mentions {string}", function (text) {
  assert.ok(this.gatewayStart.error.message.includes(text), this.gatewayStart.error.message);
});

// ---- the public validator and the badge ----------------------------------------------------------------------------------------

/** The stand-ins of the validator for this scenario. */
function validatorState(world) {
  world.validatorState ??= { origin: undefined, addresses: new Map(), deps: {}, calls: [] };
  return world.validatorState;
}

/**
 * Restart the scenario's gateway with a validator that reaches no network: the fake origin answers every
 * retrieval, and the lookup answers the addresses a scenario names. A host the scenario gave an address and no
 * origin is connected to by the consumer itself, whose address check refuses a private answer before any packet is sent.
 */
async function restartValidator(world) {
  const state = validatorState(world);
  const previous = world.gatewayHandle;
  if (previous) await previous.close();
  const fetchImpl = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    state.calls.push(url);
    const origin = state.origin;
    if (origin?.refuse) throw new TypeError("fetch failed");
    if (!origin) return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
    return new Response(origin.body, { status: 200, headers: { "Content-Type": origin.type } });
  };
  const useFake = state.origin !== undefined || state.addresses.size === 0;
  const handle = await startGateway({
    now: previous?.now ?? world.now,
    validator: { ...(useFake ? { fetchImpl } : {}), lookup: async (host) => state.addresses.get(host) ?? ["93.184.216.34"], ...state.deps },
  });
  world.gatewayHandle = handle;
  world.servers.push(handle.gw.server);
  world.base = handle.base;
}

Given("a fake origin serving {string} as {string}", async function (file, type) {
  validatorState(this).origin = { body: readFileSync(join(ROOT, "schemas-validators", "examples", file), "utf8"), type };
  await restartValidator(this);
});

Given("a fake origin that refuses the connection", async function () {
  validatorState(this).origin = { refuse: true };
  await restartValidator(this);
});

Given("a fake origin whose body is {int} bytes of JSON", async function (size) {
  const head = '{"provider":"';
  const tail = '"}';
  const body = head + "x".repeat(size - head.length - tail.length) + tail;
  validatorState(this).origin = { body, type: MEDIA_TYPE };
  await restartValidator(this);
});

Given("the host {string} resolves to {string}", async function (host, address) {
  validatorState(this).addresses.set(host, [address]);
  await restartValidator(this);
});

Given("the host {string} is named in VALIDATOR_EXCLUDE", async function (host) {
  validatorState(this).deps.exclude = new Set([host]);
  await restartValidator(this);
});

Given("the validator budget is spent", async function () {
  validatorState(this).deps.outboundPerMinute = 0;
  await restartValidator(this);
});

/** The outcome the validator reported. */
const validatorResult = (world) => bodyJson(world);

Then("the validator result has status {string}", function (status) {
  assert.equal(validatorResult(this).status, status, this.response.body.slice(0, 300));
});

Then("the validator result has format {string}", function (format) {
  assert.equal(validatorResult(this).format, format);
});

Then("the validator result has signature {string}", function (signature) {
  assert.equal(validatorResult(this).signature, signature);
});

Then("the validator result {string} is an object", function (member) {
  const value = validatorResult(this)[member];
  assert.ok(value !== null && typeof value === "object", `${member}: ${JSON.stringify(value)}`);
});

Then("the validator result detail mentions {string}", function (text) {
  assert.ok(validatorResult(this).detail.includes(text), validatorResult(this).detail);
});

Then("the validator result note mentions {string}", function (text) {
  assert.ok(validatorResult(this).note.includes(text), validatorResult(this).note);
});

Then("the validator result lists {string} as {word}", function (member, kind) {
  assert.ok(validatorResult(this)[kind].includes(member), JSON.stringify(validatorResult(this)[kind]));
});

Then("the validator result is announced in an aria-live region", function () {
  assert.match(this.response.body, /<div role="status" aria-live="polite"><pre id="check-out"/);
});

Then("the fake origin saw {int} request", function (count) {
  assert.equal(validatorState(this).calls.length, count);
});

Then("the validator retrieved {string} once", function (url) {
  const expected = new URL(url).href; // the default port is written out in the scenario and dropped by the URL
  assert.equal(validatorState(this).calls.filter((call) => new URL(call).href === expected).length, 1, validatorState(this).calls.join(", "));
});

// A refusal before any retrieval leaves the fake untouched; a gateway with no fake has had no retrieval when the request was refused.
Then("the validator made no retrieval", function () {
  const state = validatorState(this);
  assert.deepEqual(state.calls, []);
  assert.ok(this.response.status >= 400 || validatorResult(this).detail?.includes("refus"), `${this.response.status}: ${this.response.body.slice(0, 200)}`);
});

Then("the validator refuses the origin", function () {
  const result = validatorResult(this);
  assert.equal(result.status, "unreachable");
  assert.match(result.detail, /refus/);
});

Then("the validator made no network request", function () {
  assert.deepEqual(this.connections, []);
});

/** The word a badge shows for the outcome, and its text alternative. */
function badgeLabel(world) {
  const label = /aria-label="sustainability-data: (.*?)(?: · \d{4}-\d\d-\d\d)?"/.exec(world.response.body);
  assert.ok(label, `the response is not a badge: ${world.response.body.slice(0, 200)}`);
  return label[1];
}

Then("the badge status word is {string}", function (word) {
  assert.equal(badgeLabel(this), word);
});

Then("the badge has a text alternative", function () {
  assert.match(this.response.body, /role="img"/);
  assert.ok(badgeLabel(this).length > 0);
  assert.match(this.response.body, /<title>[^<]+<\/title>/);
});

Then("the badge is the notice badge", function () {
  assert.ok(this.response.body.includes('fill="#7a5200"'), "the badge is not drawn in the notice colour");
});

Then("the response is not cached as an outcome", function () {
  assert.match(this.response.headers.get("cache-control") ?? "", /no-store/);
});

// ---- the pages of the gateway ------------------------------------------------------------------------------------------------------

/** The list of entries behind a name in /index.json (an array, or an object with its entries). */
function indexList(world, name) {
  const list = bodyJson(world)[name];
  assert.ok(list !== undefined, `the index has no list ${name}`);
  return Array.isArray(list) ? list : list.entries;
}

Then("the body has the lists {string}, {string} and {string}", function (a, b, c) {
  for (const name of [a, b, c]) assert.ok(Array.isArray(indexList(this, name)), `${name} is not a list`);
});

Then("the list {string} has {int} entries", function (name, count) {
  assert.equal(indexList(this, name).length, count);
});

Then("every entry has {string} as an object with {string} and {string}", function (member, a, b) {
  for (const name of ["subjects", "adapter-demonstrations", "wire-format-examples"]) {
    for (const entry of indexList(this, name)) {
      assert.deepEqual(Object.keys(entry[member]).sort(), [a, b].sort(), `${name}: ${entry.domain}`);
    }
  }
});

/** The calendar unit all the objects of an example file share, when they share one. */
function sharedUnit(file) {
  const held = JSON.parse(repoFile(`example-responses/${file}`));
  const units = new Set([held].flat().map((object) => consumer.wholeCalendarUnit(object.period)));
  return units.size === 1 ? [...units][0] : undefined;
}

// An example served by a range carries the range; one whose objects share a calendar unit carries that granularity too.
Then("every wire example carries {string} and {string}", function (range, granularity) {
  const ranged = indexList(this, "wire-format-examples").filter((entry) => entry[range] !== undefined);
  assert.ok(ranged.length > 0, "no wire example carries a range");
  for (const entry of ranged) {
    assert.deepEqual(Object.keys(entry[range]).sort(), ["end", "start"], entry.domain);
    const unit = entry.shape === "array" ? sharedUnit(entry.file) : undefined;
    if (unit !== undefined) assert.equal(entry[granularity], unit, entry.domain);
  }
});

/** The query an example is listed with: its range and granularity when it has them. */
function queryOf(entry) {
  if (!entry.range) return "";
  const granularity = entry.granularity ? `&granularity=${entry.granularity}` : "";
  return `?start=${entry.range.start}&end=${entry.range.end}${granularity}`;
}

const escapeHtml = (text) => text.replace(/&/g, "&amp;");

// The path is the link; the query is written beside it, or in the link itself.
Then("the page lists every example with its exact request", async function () {
  const html = this.response.body;
  const index = (await this.send("GET", "/index.json")).json();
  this.response = { ...this.response, body: html };
  this.lastSet = "response";
  for (const entry of index["wire-format-examples"].entries) {
    assert.ok(html.includes(`href="${entry.path}`), `the page does not link ${entry.path}`);
    assert.ok(html.includes(escapeHtml(queryOf(entry))), `the page does not list ${entry.path}${queryOf(entry)}`);
  }
});

Then("the period column of each row shows both bounds in a title", function () {
  const periods = [...this.response.body.matchAll(/<td><code title="([^"]*)">/g)].map((match) => match[1]);
  assert.ok(periods.length > 0, "the page lists no period");
  for (const title of periods) assert.match(title, /^\S+ to \S+$/, title);
});

Then("no link on the page contains {string}", function (text) {
  const links = [...this.response.body.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(links.filter((link) => link.includes(text)), []);
});

Given("an index entry whose request uses {string}", function (parameter) {
  this.indexEntry = { request: `/example.example${WELL_KNOWN}?${parameter}2025` };
});

When("the index check runs", function () {
  const { request } = this.indexEntry;
  this.check = { passed: !/[?&;]period=/.test(request), message: `the request ${request} uses period=, which the draft does not define` };
});

// ---- the accessibility of the index page ---------------------------------------------------------------------------------------------

/** The controls of the page that no label names. */
function unlabelledControls(html) {
  return [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => !/type="hidden"/.test(tag))
    .filter((tag) => {
      const id = /\sid="([^"]+)"/.exec(tag)?.[1];
      const named = id && (html.includes(`<label for="${id}"`) || new RegExp(`<label[^>]*>[^<]*<select[^>]*id="${id}"`).test(html));
      return !(named || /aria-label="[^"]+"/.test(tag));
    });
}

/** What the accessibility run finds wrong in a page: the language, the single h1, the labels. */
function accessibilityFindings(html) {
  const findings = unlabelledControls(html).map((tag) => `the form control ${tag} has no label`);
  if (!/<html lang="[A-Za-z-]+"/.test(html)) findings.push("the page does not declare its language");
  const headings = html.match(/<h1[ >]/g)?.length ?? 0;
  if (headings !== 1) findings.push(`the page has ${headings} h1 elements`);
  return findings;
}

Given("a copy of the index page with a form control that has no label", async function () {
  const html = (await this.send("GET", "/")).body;
  this.pageCopy = html.replace("</main>", '<input type="text" id="stray"></main>');
});

When("the accessibility run checks the page", function () {
  const findings = accessibilityFindings(this.pageCopy ?? this.response.body);
  this.check = { passed: findings.length === 0, message: findings.join("; ") };
});

Then("the run fails", function () {
  assert.equal(this.check.passed, false, "the accessibility run passed");
});

Then("the run message mentions {string}", function (text) {
  assert.ok(this.check.message.includes(text), this.check.message);
});

Then("the page declares its language", function () {
  assert.match(this.response.body, /<html lang="[A-Za-z-]+"/);
});

Then("the page has exactly one h1", function () {
  assert.equal(this.response.body.match(/<h1[ >]/g)?.length, 1);
});

Then("every form control of the page has a label", function () {
  assert.deepEqual(unlabelledControls(this.response.body), []);
});

Then("the page needs no script to be read", function () {
  const readable = this.response.body.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.ok(readable.includes("<table>") && readable.includes('<form id="check"') && readable.includes("<h1>"), "the page needs a script to show its content");
});

// At 320 px a page reflows when it scales to the screen, fixes no width on its body, and keeps every table in a region that scrolls on its own.
Then("the page reflows at a width of {int} px without horizontal scrolling", function (width) {
  const html = this.response.body;
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.ok(!new RegExp(`body \\{[^}]*\\bwidth:\\s*([${width + 1}-9]\\d{2,}|\\d{4,})px`).test(html), "the body has a fixed width");
  const tables = html.match(/<table\b/g)?.length ?? 0;
  const regions = html.match(/<div class="scroll"/g)?.length ?? 0;
  assert.ok(tables > 0 && regions >= tables, `${tables} tables, ${regions} scrolling regions`);
});

// ---- the static deployment kits -------------------------------------------------------------------------------------------------------

/** The files that configure each kit, relative to the repository. */
const KIT_FILES = {
  netlify: ["deploy/static/netlify/_headers"],
  "cloudflare-pages": ["deploy/static/cloudflare-pages/_headers"],
  vercel: ["deploy/static/vercel/vercel.json"],
  nginx: ["deploy/proxies/nginx/sustainability-data.conf"],
  caddy: ["deploy/proxies/caddy/Caddyfile"],
  "github-pages": [],
};

const REGISTERED = "application/sustainability-data+json";

/** What a kit does for the extensionless path, read from its configuration: a redirect, a Content-Type, or the host's default for a file with no extension. */
function kitAnswer({ name, texts }) {
  const text = texts.join("\n");
  const redirect = /return\s+30[1278]\s+(\S+?);/.exec(text);
  if (redirect) return { status: 301, location: redirect[1] };
  const declared =
    name === "vercel"
      ? JSON.parse(text).headers.find((h) => h.source === WELL_KNOWN)?.headers.find((h) => h.key === "Content-Type")?.value
      : /(?:Content-Type[:= ]+"?|default_type\s+)([\w.+/-]+)/i.exec(text)?.[1];
  return { status: 200, contentType: declared ?? "application/octet-stream" };
}

function loadKit(name) {
  assert.ok(name in KIT_FILES, `the suite knows no kit ${name}`);
  return { name, texts: KIT_FILES[name].map(repoFile) };
}

// A static host answers the well-known path as the kit configures it, and any other file by its extension.
Given("the static kit {string} serving a valid declaration", async function (name) {
  this.kit = loadKit(name);
  const answer = kitAnswer(this.kit);
  const body = JSON.stringify(this.doc ?? baseDeclaration());
  const server = createServer((req, res) => {
    this.requests.push({ method: req.method, url: req.url, headers: req.headers });
    const configured = req.url === WELL_KNOWN;
    res.writeHead(configured ? answer.status : 200, { "Content-Type": configured ? answer.contentType : req.url.endsWith(".json") ? "application/json" : "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  this.base = await this.listen(server);
});

Given("the static kit {string} configured to return {string}", function (name, type) {
  const kit = loadKit(name);
  this.kit = { name, texts: kit.texts.map((text) => text.replaceAll(REGISTERED, type)) };
});

Given("the static kit {string} configured to redirect the well-known path to {string}", function (name, location) {
  this.kit = { name, texts: [`location = ${WELL_KNOWN} { return 301 ${location}; }`] };
});

When("the kit check runs", function () {
  const answer = kitAnswer(this.kit);
  if (answer.status !== 200) {
    const secure = answer.location.startsWith("https://");
    this.check = { passed: secure, message: `the path redirects to ${answer.location}${secure ? "" : ", which is not https"}` };
  } else {
    this.check = { passed: answer.contentType === REGISTERED, message: `the Content-Type is ${answer.contentType}, not ${REGISTERED}` };
  }
});

Then("the kit check fails", function () {
  assert.equal(this.check.passed, false, "the kit check passed");
});

Then("the kit check message mentions {string}", function (text) {
  assert.ok(this.check.message.includes(text), this.check.message);
});
