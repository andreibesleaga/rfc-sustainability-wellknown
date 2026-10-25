/**
 * Steps of the personas feature: the conformance battery, the gateway's own object and credential (Appendix A),
 * the create-sustainability-data tool's keys and outputs, the upgrade of a signed file, the one-click kit, the
 * scheduler and CSV adapters, and the few persona-specific checks on a declaration.
 *
 * The phrases of this file are exactly those assigned to the personas step owner. The state that only these steps
 * use is kept in `world.personas` (created on first use); everything else is the shared World (world.mjs).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import { BIN, MEDIA_TYPE, ROOT, WELL_KNOWN, consumer, getPath, jose, legacyDocument, publisher, rawMetrics, runNode, withoutSigned } from "./world.mjs";

/** The state of these steps, kept on the World. */
const mine = (world) => (world.personas ??= {});

/** The one object the subject holds. */
function oneObject(world) {
  const objects = world.subjectObjects();
  assert.equal(objects.length, 1, `the step is about one object, the subject holds ${objects.length}`);
  return objects[0];
}

/** The text of the tool's output, standard output and standard error together. */
const outputOf = (run) => `${run.stdout}\n${run.stderr}`;

/** Fetch the object (or array) the running gateway serves at the well-known path. */
async function gatewayObject(world) {
  const handle = await world.gateway();
  const res = await fetch(`${handle.base}${WELL_KNOWN}`);
  assert.equal(res.status, 200, "the gateway did not answer its own path");
  return res.json();
}

// ---- the conformance battery ----------------------------------------------------------------------------------------

When("the conformance battery runs against the local origin", async function () {
  mine(this).battery = undefined;
  await batteryReport(this);
});

/** The checks of a MUST that failed, as readable lines. */
const failedMusts = (report) => report.checks.filter((c) => c.outcome === "fail" && c.level === "MUST");

/** The battery's report: the run of an earlier step, or a run against the origin now. */
async function batteryReport(world) {
  const state = mine(world);
  state.battery ??= await consumer.runConformanceChecks(world.base, undefined, { allowInsecure: true, timeoutMs: 5_000, now: () => world.now });
  return state.battery;
}

Then("the origin passes every MUST of the conformance battery", async function () {
  const failed = failedMusts(await batteryReport(this)).map((c) => `${c.section}: ${c.name} (${c.detail ?? "no detail"})`);
  assert.deepEqual(failed, [], "MUST checks failed");
});

Then("the battery fails", async function () {
  assert.equal((await batteryReport(this)).allPassed, false, "every MUST of the battery passed");
});

Then("the battery failure names the section {string}", async function (section) {
  const sections = failedMusts(await batteryReport(this)).map((c) => c.section ?? "");
  assert.ok(sections.some((s) => s.includes(section)), `no failed MUST is in "${section}"; failed: ${JSON.stringify(sections)}`);
});

Then("the battery reports capabilities {string}", async function (capabilities) {
  assert.equal((await batteryReport(this)).capabilities, capabilities);
});

/** A parameter value the query ABNF of the draft allows. */
function matchesAbnf(name, text) {
  if (name === "start" || name === "end") return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(text) && !Number.isNaN(Date.parse(text));
  if (name === "granularity") return ["yearly", "monthly", "daily"].includes(text);
  return true;
}

Given("a local server that answers {int} to a query value that does not match the ABNF", async function (status) {
  const body = JSON.stringify(this.doc ?? legacyDocument("10"));
  const server = createServer((req, res) => {
    this.requests.push({ method: req.method, url: req.url, headers: req.headers });
    const url = new URL(req.url, "http://127.0.0.1");
    const refused = [...url.searchParams].some(([name, text]) => !matchesAbnf(name, text));
    const found = url.pathname === WELL_KNOWN;
    res.writeHead(found && !refused ? 200 : found ? status : 404, { "Content-Type": found && !refused ? MEDIA_TYPE : "application/json", "X-Content-Type-Options": "nosniff" });
    res.end(found && !refused ? body : "{}");
  });
  this.base = await this.listen(server);
});

// ---- the gateway: Appendix A -----------------------------------------------------------------------------------------------

/** What Appendix A says of the gateway's own object, as a list of what is missing or wrong. */
function appendixAProblems(object) {
  const problems = [];
  if (object["target-type"] !== "service") problems.push("target-type is not service");
  if (object.capabilities !== "extended") problems.push("capabilities is not extended");
  for (const member of ["disclosure-uri", "verifiable-attestation-uri"]) if (object[member] === undefined) problems.push(`${member} is missing`);
  if (object.upstream !== undefined) problems.push("the self report carries an upstream member; Appendix A gives it none");
  return problems;
}

Given("the gateway's self report with an upstream member added", async function () {
  const served = await gatewayObject(this);
  const object = Array.isArray(served) ? served[0] : served;
  this.setDoc({ ...object, upstream: [{ declaration: "https://upstream.example/.well-known/sustainability-data", role: "electricity" }] });
});

When("the Appendix A check runs", function () {
  const problems = appendixAProblems(oneObject(this));
  this.check = { passed: problems.length === 0, message: problems.join("; ") };
});

Then("the object has the member {string}", function (member) {
  assert.notEqual(getPath(oneObject(this), member), undefined, `the object has no member ${member}`);
});

// ---- the gateway's credential ---------------------------------------------------------------------------------------------

/** The attestation tool of the gateway, imported once. */
let attestationTool;
const gatewayTool = () => (attestationTool ??= import(pathToFileURL(join(ROOT, "gateway", "scripts", "issue-attestation.mjs")).href));

/** The monthly power the gateway's credential states, as the gateway loads it. */
async function enteredWatts() {
  const { readMeasured } = await gatewayTool();
  return readMeasured(join(ROOT, "gateway", "data", "_self-measured.json"));
}

/** Issue the gateway's credential for a declaration copy of its own object, over `period` when given; the attester's key is trusted. */
async function issueGatewayCredential(world, period) {
  const state = mine(world);
  const handle = await world.gateway();
  const object = await gatewayObject(world);
  const declaration = { ...(Array.isArray(object) ? object[0] : object), ...(period ? { period } : {}) };
  const attester = await world.namedKey("attester");
  const { issueCredential } = await gatewayTool();
  const issued = await issueCredential(JSON.stringify(await publisher.exportPrivateJwk(attester)), {
    now: handle.now.toISOString(),
    gateway: handle.base,
    declaration,
    wattsByMonth: await enteredWatts(),
  });
  world.credentials.set(issued.credential.id, { body: issued.jwt });
  world.attestationOptions.trustedIssuerKeys = [attester.publicJwk];
  state.credential = { uri: issued.credential.id, ...issued };
  return state.credential;
}

/** The attestation check for a declaration of the gateway over `period`, reading the credential from the World's credentials. */
async function checkGatewayAttestation(world, period) {
  const state = mine(world);
  state.credential ??= await issueGatewayCredential(world);
  const object = await gatewayObject(world);
  const declaration = { ...(Array.isArray(object) ? object[0] : object), ...(period ? { period } : {}) };
  world.attestationReads = [];
  const fetchImpl = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    world.attestationReads.push(url);
    const credential = world.credentials.get(url);
    if (!credential) return new Response("", { status: 404 });
    return new Response(credential.body, { status: 200, headers: { "Content-Type": "application/vc+jwt" } });
  };
  world.attestation = await consumer.verifyAttestation(state.credential.uri, {
    fetchImpl,
    now: world.now,
    timeoutMs: 5_000,
    declaration,
    ...world.attestationOptions,
  });
  state.attestedObject = declaration;
}

When("the consumer verifies the signature of the forwarded declaration", async function () {
  await this.verifySubject();
});

When("the consumer retrieves the gateway's credential", async function () {
  const object = await gatewayObject(this);
  await checkGatewayAttestation(this, undefined);
  assert.equal(this.attestation.valid, true, JSON.stringify(this.attestation).slice(0, 400));
  mine(this).payload = jose.decodeJwt(mine(this).credential.jwt);
  mine(this).attestedObject = Array.isArray(object) ? object[0] : object;
});

Then("the credential subject carries the derivation model, its constants and formulas, and the entered months", function () {
  const model = mine(this).payload.credentialSubject.model;
  for (const constant of ["constant-draw-watts", "grid-intensity-gCO2e-per-kWh"]) assert.equal(typeof model[constant], "number", `the model has no ${constant}`);
  for (const formula of ["energy-Wh", "carbon-gCO2e"]) assert.equal(typeof model[formula], "string", `the model has no formula ${formula}`);
  const months = model["entered-watts-by-month"];
  assert.ok(months && Object.keys(months).length > 0, "the credential states no entered month");
});

Then("the credential binds the target and the period of the object", function () {
  const { attestation } = this;
  assert.deepEqual(attestation.coverage, { status: "covers" }, JSON.stringify(attestation.coverage));
  assert.deepEqual(attestation.binding, { status: "match" }, JSON.stringify(attestation.binding));
});

Given("the credential of the gateway is for the period {string} to {string}", async function (start, end) {
  await issueGatewayCredential(this, { start, end });
});

When("the consumer checks the gateway's attestation for the object of {string} to {string}", async function (start, end) {
  await checkGatewayAttestation(this, { start, end });
});

// ---- credentials of an exact size --------------------------------------------------------------------------------------------

/**
 * A vc+jwt of exactly `size` bytes for `target` and `period`, signed by the attester: the description and the key id
 * are padded, because base64 lengths do not take every value from one padding alone.
 */
async function credentialOfSize(world, uri, size, target, period) {
  const attester = await world.namedKey("attester");
  const { buildCredential } = await gatewayTool();
  const make = (pad, kidPad) => {
    const credential = buildCredential({ now: world.now.toISOString(), credentialId: uri });
    credential.description += "x".repeat(pad);
    credential.credentialSubject = { ...credential.credentialSubject, target, period };
    return publisher.signAttached(credential, attester, { typ: "vc+jwt", cty: "vc", kid: `${"k".repeat(kidPad)}#${attester.kid}` });
  };
  for (let kidPad = 0; kidPad < 4; kidPad++) {
    const base = (await make(0, kidPad)).length;
    const estimate = Math.floor(((size - base) * 3) / 4);
    for (let pad = Math.max(0, estimate - 4); pad <= estimate + 4; pad++) {
      const jwt = await make(pad, kidPad);
      if (jwt.length === size) return { jwt, publicJwk: attester.publicJwk };
    }
  }
  throw new Error(`no credential of ${size} bytes could be made`);
}

Given("the credential at {string} is {int} bytes long", function (uri, size) {
  this.credentials.set(uri, { body: "x".repeat(size) });
});

Given(
  "the credential at {string} is {int} bytes long and issued by a trusted issuer for the target {string} and the period {string} to {string}",
  async function (uri, size, target, start, end) {
    const { jwt, publicJwk } = await credentialOfSize(this, uri, size, target, { start, end });
    this.credentials.set(uri, { body: jwt });
    this.attestationOptions.trustedIssuerKeys = [publicJwk];
    // The object checked is the one the credential is about.
    if (this.doc !== undefined) this.mutateDoc((d) => (d.target = target));
  },
);

// ---- the create-sustainability-data tool -----------------------------------------------------------------------------------------

Given("the create-sustainability-data tool is given the answers:", function (table) {
  this.answers = Object.fromEntries(table.hashes().map((row) => [row.answer, row.value]));
});

/** Write a key file in a fresh directory and give its path to the tool as the signing key. */
function giveKeyFile(world, jwk) {
  world.answers.key = world.writeFileIn(world.tempDir("key"), "private.jwk", JSON.stringify(jwk));
}

Given("the tool is given an Ed25519 signing key", async function () {
  giveKeyFile(this, await publisher.exportPrivateJwk(await publisher.generateSigningKey("Ed25519")));
});

Given("the tool is given an HS256 secret as the signing key", function () {
  giveKeyFile(this, { kty: "oct", alg: "HS256", k: Buffer.alloc(32, 7).toString("base64url") });
});

Then("the tool prints a line mentioning {string}", function (text) {
  assert.ok(outputOf(this.run).includes(text), `the tool printed no line mentioning "${text}": ${outputOf(this.run)}`);
});

Then("the written file has no member {string}", function (member) {
  assert.ok(this.written, "the tool wrote no declaration");
  assert.equal(this.written.json[member], undefined);
});

Then("the written file has period {string} to {string}", function (start, end) {
  assert.deepEqual(this.written.json.period, { start, end });
});

Then("the written file is signed with Ed25519", function () {
  assert.equal(typeof this.written.json.signed, "string", "the written file has no signed member");
  const header = JSON.parse(Buffer.from(this.written.json.signed.split(".")[0], "base64url").toString("utf8"));
  assert.equal(header.alg, "Ed25519");
});

Then("the written period is classified as {string}", function (unit) {
  assert.equal(consumer.wholeCalendarUnit(this.written.json.period) ?? "none", unit);
});

Given("the written file is served on a local port as a static file", async function () {
  this.setDoc(this.written.json);
  await this.servePublisher({ staticFile: true });
});

// ---- the upgrade of a file, and the reading modes -----------------------------------------------------------------------------------

/** The file the owner serves after the upgrade: the signed output when the owner signed it, else the tool's output. */
function upgradedFile(world) {
  const signedOutput = world.doc !== undefined && consumer.deepEqual(withoutSigned(world.doc), withoutSigned(world.upgrade.output));
  return signedOutput ? world.doc : world.upgrade.output;
}

Given("the output is served on a local port as a static file", async function () {
  this.setDoc(upgradedFile(this));
  await this.servePublisher({ staticFile: true });
});

When("the upgrade tool runs on the output with {string}", async function (flags) {
  const dir = this.tempDir("upgrade");
  const input = this.writeFileIn(dir, "in/document.json", JSON.stringify(upgradedFile(this), null, 2));
  const outFile = join(dir, "out", "document.json");
  const r = await runNode([BIN.publisher, "upgrade", input, outFile, ...flags.split(/\s+/).filter(Boolean)]);
  this.upgrade = { ...r, outFile, output: undefined };
});

/** Fetch the local origin in one reading mode, with the signature checked; the signature fields of the World are set. */
async function fetchInMode(world, mode) {
  const result = await world.fetchLocal({ legacyCompat: mode !== "strict", verifySignature: true, signaturePolicy: { ...world.policy } });
  world.sigs = result.signatures ?? [];
  world.sig = world.sigs[0];
  world.sigNotes = result.warnings ?? [];
  world.verified = result;
}

When("the consumer fetches the local origin in strict mode allowing insecure transport", async function () {
  await fetchInMode(this, "strict");
});

When("the consumer fetches the local origin in compatibility mode allowing insecure transport", async function () {
  await fetchInMode(this, "compatibility");
});

Given(/^a local server that serves a -(\d+) document$/, async function (revision) {
  this.setDoc(legacyDocument(String(revision).padStart(2, "0")));
  this.base = await this.serveText(JSON.stringify(this.doc));
});

Then("the fetch reports the converted members", function () {
  assert.ok((this.fetchResult.converted ?? []).length > 0, `nothing was converted: ${JSON.stringify(this.fetchResult).slice(0, 300)}`);
});

// ---- the persona checks on a declaration -------------------------------------------------------------------------------------------

Given("the example file {string}", async function (name) {
  const { readFileSync } = await import("node:fs");
  const served = JSON.parse(readFileSync(join(ROOT, "example-responses", name), "utf8"));
  const objects = [served].flat().map((object) => publisher.fromWire(object, { legacyCompat: false }));
  this.setDoc(served);
  this.input = undefined;
  this.publisher = undefined;
  this.adapter = { name: "example-file", capabilities: "extended", fetch: async () => objects };
  this.invalidateBuild();
});

Then("the declared scopes account for the footprint", function () {
  const object = oneObject(this);
  const scopes = ["scope-1", "scope-2", "scope-3"].map((name) => object[name]);
  assert.ok(scopes.every((s) => typeof s === "number"), "the object does not declare all three scopes");
  const sum = scopes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - object["carbon-footprint"]) <= 1e-9 * Math.abs(object["carbon-footprint"]), `the scopes sum to ${sum}, the footprint is ${object["carbon-footprint"]}`);
});

Then("the consumer lists the two scores separately by functional unit", function () {
  const objects = this.subjectObjects();
  const byUnit = new Map(objects.map((o) => [`${o.target}|${o.period.start}|${o["functional-unit"]}`, o["sci-score"]]));
  assert.equal(byUnit.size, 2, "the two objects are not listed under two functional units");
  assert.ok([...byUnit.values()].every((score) => typeof score === "number"), JSON.stringify([...byUnit]));
});

When("the consumer retrieves it and follows every link it is allowed to follow", async function () {
  this.base = await this.serveText(JSON.stringify(this.doc));
  await this.fetchLocal();
  const object = this.fetchResult.status === "ok" ? this.fetchResult.document : this.doc;
  const options = { fetchImpl: this.recorder, timeoutMs: 2_000, base: new URL(this.base + WELL_KNOWN) };
  await consumer.compareUpstream(object, { maxBytes: 1_000_000, maxObjects: 50, ...options }, new Set()).catch(() => undefined);
  for (const member of ["methodology-uri", "disclosure-uri"]) {
    if (typeof object[member] === "string") await consumer.fetchDisclosure(object[member], this.recorder, options).catch(() => undefined);
  }
  if (typeof object["verifiable-attestation-uri"] === "string") {
    await consumer.verifyAttestation(object["verifiable-attestation-uri"], { ...options, now: this.now });
  }
});

// ---- the publisher's sources --------------------------------------------------------------------------------------------------------

/** The figures of a month of scheduler accounting as two objects of one target and period, one per functional unit. */
Given("the scheduler accounting figures of {int} jobs and {int} vcpu-hours", function (jobs, vcpuHours) {
  const month = this.input ?? rawMetrics();
  const carbonGrams = 960_000;
  const score = (units, functionalUnit) => ({ ...month, measurementMethod: "hardware-estimated", capabilities: "basic", sciScore: carbonGrams / units, functionalUnit });
  this.input = [score(jobs, "per-job"), score(vcpuHours, "per-vcpu-hour")];
  this.publisher = undefined;
  this.adapter = undefined;
  this.invalidateBuild();
});

Then("the published objects use the functional units {string} and {string}", async function (first, second) {
  const { objects, error } = await this.built();
  if (error) throw error;
  assert.deepEqual(objects.map((o) => o["functional-unit"]), [first, second]);
});

Given("a CSV with one row whose energy cell is empty", function () {
  this.csvText = "period,energy,carbon\n2025,,120\n";
  this.adapter = publisher.csvAdapter({
    provider: "Example Org (https://example.com/contact)",
    methodologyUri: "https://example.com/methodology",
    measurementMethod: "hardware-metered",
    target: "example.com",
    targetType: "origin",
    text: this.csvText,
  });
  this.invalidateBuild();
});

Then("no zero was written for {string}", async function (member) {
  const { objects, error } = await this.built();
  if (error) throw error;
  for (const object of objects) assert.notEqual(object[member], 0, `${member} was written as 0`);
});

Given("a slurm accounting export with the utcOffset {string}", function (utcOffset) {
  mine(this).slurm = {
    utcOffset,
    text: "JobID|Start|End|ConsumedEnergyRaw\n101|2026-03-01T01:00:00|2026-03-01T02:00:00|3600000\n",
  };
});

/** The adapter refuses a bad offset when it is made; that refusal is what the operator reads, so it is recorded as a skip. */
When("the slurm adapter reads it", async function () {
  const { text, utcOffset } = mine(this).slurm;
  const skipped = [];
  let objects = [];
  try {
    const adapter = publisher.slurmSacctAdapter({ text, utcOffset, provider: "Example Org (https://example.com/contact)", methodologyUri: "https://example.com/methodology", target: "cluster.example" });
    objects = [await adapter.fetch({})].flat();
  } catch (error) {
    skipped.push({ line: 0, reason: error.message });
  }
  this.adapterOutput = { objects, skipped };
});

// ---- the one-click kit ----------------------------------------------------------------------------------------------------------------

const KIT_DIRECTORY = join(ROOT, "deploy", "one-click", "railway");

/** A configuration that is valid except for what a scenario changes. */
const KIT_SETTINGS = {
  SD_TARGET: "example.com",
  SD_PROVIDER: "Example Org (https://example.com/contact)",
  SD_METHODOLOGY_URI: "https://example.com/methodology",
  SD_PERIOD: "2025",
  SD_ENERGY_KWH: "120",
  SD_MEASUREMENT_METHOD: "hardware-metered",
  SD_UPDATED: "2026-02-15T08:00:00Z",
};

Given("the one-click kit is configured with {string} {string}", function (name, text) {
  mine(this).kit = { ...(mine(this).kit ?? KIT_SETTINGS), [name]: text };
});

/** Build the kit's publisher from its environment, as its server does at start, and exit; a bad setting ends the process with the message. */
When("the one-click kit starts", async function () {
  const server = pathToFileURL(join(KIT_DIRECTORY, "server.mjs")).href;
  const program = `const kit = await import(${JSON.stringify(server)}); await kit.makePublisher({ log: false });`;
  const env = mine(this).kit ?? KIT_SETTINGS;
  this.run = { program: "one-click kit", ...(await runNode(["--input-type=module", "-e", program], { cwd: KIT_DIRECTORY, env })) };
});

Then("the start fails with a message mentioning {string}", function (text) {
  assert.notEqual(this.run.status, 0, "the kit started");
  assert.ok(outputOf(this.run).includes(text), `the message does not mention "${text}": ${this.run.stderr}`);
});

// ---- the extension with a text value ------------------------------------------------------------------------------------------------------

// An extension whose members are texts; one with numbers is a step of the shared file.
Given(/^the extension "([^"]*)" is '(\{"[^"]*": "[^"]*"\})'$/, function (name, json) {
  this.addExtension(name, JSON.parse(json));
});
