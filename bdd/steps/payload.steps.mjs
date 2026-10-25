/**
 * Steps of the payload features: periods and their arithmetic, the numbers and units of a declaration, targets, the
 * closed token sets, the compatibility reading of -08 and -09 documents, and the upgrade tool.
 *
 * The phrases of this file are exactly those assigned to the payload step owner; the World (world.mjs) says what
 * every field means. State that only these steps use is kept in `mine(world)`, so the World stays as it is.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Given, Then, When } from "@cucumber/cucumber";
import {
  BIN,
  MEDIA_TYPE,
  ROOT,
  baseDeclaration,
  cddlAccepts,
  consumer,
  flatComparisons,
  draftExample,
  getPath,
  jtdAccepts,
  legacyDocument,
  objectsFromTable,
  periodFromText,
  publisher,
  runNode,
  sameInstant,
  setPath,
  textOf,
} from "./world.mjs";

// ---- state and small helpers -----------------------------------------------------------------------------

const state = new WeakMap();

/** The state of these steps for one scenario. */
function mine(world) {
  if (!state.has(world)) state.set(world, {});
  return state.get(world);
}

/** The first object of the subject (the document, the body of the last response, or the last fetch). */
function theObject(world) {
  return world.subjectObjects()[0];
}

/** The first object the consumer read: from a reading in either mode, else from the last fetch. */
function fetchedObject(world) {
  const document = world.read?.document ?? world.fetchResult?.document;
  assert.ok(document !== undefined, "the consumer has read no document");
  return Array.isArray(document) ? document[0] : document;
}

/** Assert that some text of a list mentions a fragment. */
function assertMentions(list, text, what) {
  assert.ok(list.join("\n").includes(text), `no ${what} mentions "${text}"; ${what}s: ${JSON.stringify(list)}`);
}

const PROVIDER = baseDeclaration().provider;
const METHODOLOGY = baseDeclaration()["methodology-uri"];

/** The text of the draft under a heading: its first JSON example, byte for byte. */
function draftExampleText(heading) {
  const draft = readFileSync(resolve(ROOT, "internet-drafts", "draft-besleaga-sustainability-wellknown-10.md"), "utf8");
  const start = draft.search(new RegExp(`^#{1,2} ${heading}$`, "m"));
  assert.ok(start >= 0, `the draft has no section "${heading}"`);
  const open = draft.indexOf("~~~ json\n", start) + "~~~ json\n".length;
  return draft.slice(open, draft.indexOf("\n~~~", open) + 1);
}

/** The text of a file of the repository. */
const repositoryFile = (path) => readFileSync(resolve(ROOT, path), "utf8");

/** The members of the draft's CDDL alternatives for a rule (`name: "a" / "b"`), in the order written. */
function cddlAlternatives(member) {
  const cddl = repositoryFile("schemas-validators/response-schema.cddl");
  const rule = new RegExp(`\\b${member}:\\s*((?:"[^"]*"\\s*(?:;[^\\n]*)?\\s*/?\\s*)+)`).exec(cddl);
  assert.ok(rule, `the CDDL has no rule for ${member}`);
  return [...rule[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

/** The enum of a member in the publisher's JSON Type Definition. */
function jtdEnum(member) {
  const search = (node) => {
    if (typeof node !== "object" || node === null) return undefined;
    for (const group of ["properties", "optionalProperties"]) {
      const found = node[group]?.[member];
      if (found?.enum) return found.enum;
    }
    for (const child of Object.values(node)) {
      const found = search(child);
      if (found) return found;
    }
    return undefined;
  };
  const found = search(publisher.RESPONSE_JTD_SCHEMA);
  assert.ok(found, `the JTD schema has no enum for ${member}`);
  return found;
}

// ---- periods and their arithmetic ---------------------------------------------------------------------------

Given("the member {string} is the string {string}", function (name, text) {
  this.mutateDoc((d) => setPath(d, name, text));
});

/** The labels' periods as the document holds them: every label names a period of the subject, when the subject is an array. */
function periodsOfLabels(world, labels) {
  const periods = labels.map(periodFromText);
  const subject = world.read?.document ?? world.subject();
  const held = Array.isArray(subject) ? subject.map((o) => o.period) : [];
  if (held.length > 0) {
    for (const [i, p] of periods.entries()) {
      assert.ok(held.some((h) => sameInstant(h.start, p.start) && sameInstant(h.end, p.end)), `no object of the document has the period "${labels[i]}"`);
    }
  }
  return periods;
}

function assertOverlap(world, labels, overlapping) {
  const periods = periodsOfLabels(world, labels);
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      assert.equal(consumer.periodsOverlap(periods[i], periods[j]), overlapping, `"${labels[i]}" and "${labels[j]}"`);
    }
  }
}

Then("the periods {string} and {string} are reported as not overlapping", function (a, b) {
  assertOverlap(this, [a, b], false);
});

Then("the periods {string} and {string} and {string} are reported as not overlapping", function (a, b, c) {
  assertOverlap(this, [a, b, c], false);
});

Then("the periods {string} and {string} are reported as overlapping", function (a, b) {
  assertOverlap(this, [a, b], true);
});

Then("the period {string} contains {string} and does not contain {string}", function (label, inside, outside) {
  const { start, end } = periodFromText(label);
  const contains = (instant) => consumer.compareDateTimes(start, instant) <= 0 && consumer.compareDateTimes(instant, end) < 0;
  assert.equal(contains(inside), true, `${label} does not contain ${inside}`);
  assert.equal(contains(outside), false, `${label} contains ${outside}`);
});

Then(/^the period (\S+) and the period (\S+) (do not overlap|overlap)$/, function (a, b, verdict) {
  const [first, second] = [a, b].map((text) => periodFromText(text));
  assert.equal(consumer.periodsOverlap(first, second), verdict === "overlap", `${a} and ${b}`);
});

Given("a publisher given the calendar year {int}", function (year) {
  this.inputPatch({ period: publisher.yearPeriod(year) });
});

Given("a publisher given the calendar month {string}", function (label) {
  const [year, month] = label.split("-").map(Number);
  this.inputPatch({ period: publisher.monthPeriod(year, month) });
});

Then("the object is kept in the result", function () {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  assert.deepEqual(fetchedObject(this).period, this.doc.period, "the object in the result is not the object served");
});

// ---- totals ----------------------------------------------------------------------------------------------------

Then("the total {string} is {float} tCO2e", function (member, expected) {
  assert.ok(this.total, `no total: ${this.totalRefusal?.message}`);
  assert.equal(consumer.convertCarbon(this.total[member], this.total["carbon-unit"] ?? "gCO2e", "tCO2e"), expected);
});

Then(/^the total "([^"]*)" is (not added|-?\d+(?:\.\d+)?)$/, function (member, expected) {
  if (expected === "not added") {
    assert.ok(this.totalRefusal, `the objects were added: ${JSON.stringify(this.total)}`);
    return;
  }
  assert.ok(this.total, `no total: ${this.totalRefusal?.message}`);
  assert.equal(this.total[member], Number(expected));
});

Then("the total is refused", function () {
  assert.ok(this.totalRefusal, `the objects were added: ${JSON.stringify(this.total)}`);
});

Then(/^the warnings do not mention "([^"]*)"$/, function (text) {
  assert.ok(!this.result.warnings.join("\n").includes(text), `unexpected warning about "${text}": ${JSON.stringify(this.result.warnings)}`);
});

Then("there are no warnings", function () {
  assert.deepEqual(this.result.warnings, []);
});

// ---- how a reading is presented and kept -----------------------------------------------------------------------

Given("a local server whose declaration covers {string} to {string} with {string}", async function (start, end, header) {
  const [name, ...rest] = header.split(": ");
  this.setDoc(baseDeclaration({ period: { start, end } }));
  this.base = await this.serveText(JSON.stringify(this.doc), { headers: { [name]: rest.join(": ") } });
});

/** What the command-line consumer prints: the periods it shows and the words it says. */
async function presented(world) {
  const { stdout, stderr } = await world.presentation();
  const shown = JSON.parse(stdout);
  return { periods: (Array.isArray(shown) ? shown : [shown]).map((o) => o.period), words: `${stdout}\n${stderr}` };
}

Then("the presentation does not call the figures current", async function () {
  const { words } = await presented(this);
  assert.doesNotMatch(words, /\b(current|up to date|latest)\b/i);
});

Then("the presentation does not say the figures cover {string} to {string}", async function (start, end) {
  const { periods } = await presented(this);
  assert.ok(!periods.some((p) => sameInstant(p.start, start) && sameInstant(p.end, end)), `the output shows ${JSON.stringify(periods)}`);
});

Given("a local server whose declaration carries {string} and an entity tag", async function (header) {
  const m = mine(this);
  const [name, ...rest] = header.split(": ");
  const value = rest.join(": ");
  const body = JSON.stringify(baseDeclaration());
  const etag = `"${createHash("sha256").update(body).digest("hex").slice(0, 16)}"`;
  m.maxAge = Number(/max-age=(\d+)/.exec(value)?.[1]);
  m.etag = etag;
  m.answered = [];
  const server = createServer((req, res) => {
    this.requests.push({ method: req.method, url: req.url, headers: req.headers });
    const status = req.headers["if-none-match"] === etag ? 304 : 200;
    m.answered.push(status);
    res.writeHead(status, { "Content-Type": MEDIA_TYPE, ETag: etag, [name]: value, "X-Content-Type-Options": "nosniff" });
    res.end(status === 304 ? undefined : body);
  });
  this.base = await this.listen(server);
});

Given("the consumer fetched it at {string}", async function (time) {
  const m = mine(this);
  this.setClock(time);
  m.client = new consumer.SustainabilityClient({ allowInsecure: true, timeoutMs: 5_000 });
  m.held = await m.client.get(this.base);
  m.heldAt = this.now;
  assert.equal(m.held.status, "ok", JSON.stringify(m.held));
});

When("the consumer relies on the stored reading", async function () {
  const m = mine(this);
  const ageSeconds = (this.now.getTime() - m.heldAt.getTime()) / 1000;
  assert.ok(ageSeconds >= m.maxAge, `the reading is ${ageSeconds} s old and still fresh for ${m.maxAge} s: nothing to revalidate`);
  m.relied = await m.client.get(this.base);
});

Then("the consumer sent a conditional request with the entity tag", function () {
  const m = mine(this);
  const last = this.requests[this.requests.length - 1];
  assert.equal(last.headers["if-none-match"], m.etag, `the last request carried ${JSON.stringify(last.headers["if-none-match"])}`);
});

Then("the server answered {int}", function (status) {
  assert.equal(mine(this).answered.at(-1), status);
});

// ---- numbers, units and the publisher's refusals ------------------------------------------------------------------

/** Build with one change to a valid input; the build must be refused. */
async function assertRefused(world, patch) {
  world.input = undefined;
  world.adapter = undefined;
  world.inputPatch(patch);
  const { error, objects } = await world.built();
  assert.ok(error, `the publisher built ${objects.length} object(s) from ${JSON.stringify(patch)}`);
}

Then("a publisher given a negative gross figure refuses to build", async function () {
  await assertRefused(this, { carbon: { value: -5, unit: "kgCO2e" } });
});

Then("a publisher given a non-finite figure refuses to build", async function () {
  await assertRefused(this, { energy: { value: Number.POSITIVE_INFINITY, unit: "kWh" } });
  await assertRefused(this, { energy: { value: Number.NaN, unit: "kWh" } });
});

/** A publisher input file in the wire form with one member written as the raw JSON given. */
function useInputFile(world, member, raw) {
  const object = baseDeclaration();
  delete object[member];
  const file = world.writeFileIn(world.tempDir("input"), "input.json", `${JSON.stringify(object).slice(0, -1)},${JSON.stringify(member)}:${raw}}`);
  world.input = undefined;
  world.adapter = publisher.staticFileAdapter({ file, format: "wire" });
  world.invalidateBuild();
}

Then(/^a publisher given the number ([0-9]+(?:)) for "([^"]*)" refuses to build$/, async function (digits, member) {
  useInputFile(this, member, digits);
  const { error, objects } = await this.built();
  assert.ok(error, `the publisher built ${objects.length} object(s) from ${digits}`);
});

Given(/^a publisher input file whose "([^"]*)" is the raw value (.+)$/, function (member, raw) {
  useInputFile(this, member, raw);
});

Given("a publisher input file whose {string} is the sum {float} + {float}", function (member, a, b) {
  useInputFile(this, member, JSON.stringify(a + b));
});

Then("the published member {string} is the number {float}", async function (member, expected) {
  const { objects, error } = await this.built();
  if (error) throw error;
  assert.equal(getPath(objects[0], member), expected);
});

When("the consumer reads the figures in standard units", function () {
  this.readAs("strict");
  assert.equal(this.result.valid, true, JSON.stringify(this.result.errors));
});

Then("the object's {string} is not negative", function (member) {
  const number = theObject(this)[member];
  assert.equal(typeof number, "number", `${member} is ${JSON.stringify(number)}`);
  assert.ok(number >= 0, `${member} is ${number}`);
});

Then("the member {string} is not reported as missing", function (member) {
  const object = this.read?.document ?? theObject(this);
  const number = getPath(Array.isArray(object) ? object[0] : object, member);
  assert.equal(consumer.isNotReported(number, member), false, `${member}: ${number} is read as not reported`);
  const mentions = [...this.result.errors, ...this.result.warnings].filter((text) => text.includes(member) && /missing|not reported/.test(text));
  assert.deepEqual(mentions, []);
});

Then("the scope member {string} is read as {float} tCO2e", function (member, expected) {
  const object = theObject(this);
  assert.equal(consumer.convertCarbon(object[member], object["carbon-unit"] ?? "gCO2e", "tCO2e"), expected);
});

Then("the scope member {string} is read as {float} gCO2e", function (member, expected) {
  const object = theObject(this);
  assert.equal(consumer.convertCarbon(object[member], object["carbon-unit"] ?? "gCO2e", "gCO2e"), expected);
});

// A member given as raw JSON that is no string: a number, null, true or an array.
Given(/^the member "([^"]*)" is (-?\d+(?:\.\d+)?|null|true|false|\[.*\])$/, function (name, json) {
  this.mutateDoc((d) => setPath(d, name, JSON.parse(json)));
});

Given("a valid declaration object with {string} {float} and {string} {string}", function (numberMember, number, textMember, text) {
  this.setDoc(baseDeclaration({ [numberMember]: number, [textMember]: text }));
});

Given("a valid declaration object with {string} {string} and {string} {float}", function (textMember, text, numberMember, number) {
  this.setDoc(baseDeclaration({ [textMember]: text, [numberMember]: number }));
});

Then("the sci-score is read as {float} gCO2e per {string}", function (score, unit) {
  const object = theObject(this);
  assert.equal(object["sci-score"], score, "the score was rescaled");
  assert.equal(object["functional-unit"], unit);
});

Then("the carbon intensity is read as {float} gCO2e per kWh", function (expected) {
  assert.equal(theObject(this)["carbon-intensity-gCO2e-per-kWh"], expected);
});

Then("the ratio of the carbon to the energy equals the intensity within rounding", function () {
  const o = theObject(this);
  const grams = consumer.convertCarbon(o["carbon-footprint"], o["carbon-unit"] ?? "gCO2e", "gCO2e");
  const kilowattHours = consumer.convertEnergy(o["energy-consumption"], o["energy-unit"] ?? "kWh", "kWh");
  const ratio = grams / kilowattHours;
  const intensity = o["carbon-intensity-gCO2e-per-kWh"];
  assert.ok(Math.abs(ratio - intensity) <= intensity * 0.005, `the carbon is ${grams} g for ${kilowattHours} kWh, ${ratio} g per kWh, not ${intensity}`);
});

Then("the annualized emissions are read as {float} kgCO2e", function (expected) {
  assert.equal(theObject(this)["estimated-annual-emissions-kgCO2e"], expected);
});

Given("the publisher is given the number {float} for {string} and nothing for {string}", function (number, given, left) {
  const input = { carbon: { value: number, unit: "kgCO2e" }, energy: { value: number, unit: "kWh" } };
  const member = { "carbon-footprint": "carbon", "energy-consumption": "energy" };
  this.inputPatch({ [member[given]]: input[member[given]], [member[left]]: undefined });
});

// ---- links, language, the target ---------------------------------------------------------------------------------

Given("a local server that answers {string} with {string} and status {int}", function (path, mediaType, status) {
  (mine(this).answers ??= new Map()).set(path, { mediaType, status });
});

/** A fetch stand-in that answers the paths given by "a local server that answers" and nothing else. */
function answeringFetch(world) {
  const answers = mine(world).answers ?? new Map();
  return async (input) => {
    const answer = answers.get(new URL(typeof input === "string" ? input : input.url).pathname);
    if (!answer) return new Response("", { status: 404 });
    return new Response(answer.mediaType === "application/json" ? "{}" : "<html><body>index</body></html>", {
      status: answer.status,
      headers: { "Content-Type": answer.mediaType },
    });
  };
}

When("the consumer retrieves the disclosure index", async function () {
  const m = mine(this);
  m.disclosure = undefined;
  m.disclosureError = undefined;
  const uri = theObject(this)["disclosure-uri"];
  try {
    m.disclosure = await consumer.fetchDisclosure(uri, answeringFetch(this), {
      base: "https://example.com/.well-known/sustainability-data",
      lookup: async () => ["93.184.216.34"],
      timeoutMs: 2_000,
    });
  } catch (e) {
    m.disclosureError = e;
  }
});

Then("the disclosure index is returned with the media type {string}", function (mediaType) {
  const m = mine(this);
  assert.ok(m.disclosure, `the index was not retrieved: ${m.disclosureError?.message}`);
  assert.equal(m.disclosure.mediaType, mediaType);
});

Then("the disclosure index failure is status {int}", function (status) {
  const m = mine(this);
  assert.ok(m.disclosureError, "the index was retrieved");
  assert.equal(m.disclosureError.status, status);
});

Given("the publisher is configured with the language {string}", function (language) {
  this.serverOptions.contentLanguage = language;
});

Then("the object has no {string} member", function (member) {
  assert.equal(theObject(this)[member], undefined);
});

Given("an extended publisher holding the target {string}", async function (target) {
  await this.holdPeriods([{ label: "target", start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z", target }]);
});

When("the consumer reads them", async function () {
  await this.servePublisher();
  const fetched = await this.fetchLocal();
  assert.equal(fetched.status, "ok", JSON.stringify(fetched).slice(0, 300));
  this.read = { mode: "compatibility", document: fetched.document, converted: fetched.converted ?? [], disregarded: fetched.disregarded ?? [] };
});

Then("the target member is byte-identical to {string}", function (expected) {
  const { target } = fetchedObject(this);
  assert.equal(Buffer.compare(Buffer.from(target, "utf8"), Buffer.from(expected, "utf8")), 0, `the target is ${JSON.stringify(target)}`);
});

Then("the target member is not {string}", function (other) {
  assert.notEqual(fetchedObject(this).target, other);
});

Then("the publisher's options have no translate or transliterate member", function () {
  // The publisher has no hook that rewrites a member; its published option types must not offer one.
  const declarations = readdirSync(resolve(ROOT, "publisher", "dist")).filter((name) => name.endsWith(".d.ts"));
  assert.ok(declarations.length > 0, "the publisher is not built");
  for (const name of declarations) {
    const text = readFileSync(resolve(ROOT, "publisher", "dist", name), "utf8");
    assert.doesNotMatch(text, /translat|transliterat/i, `${name} declares a translation option`);
  }
});

Given("a publisher given the target {string} with the target-type {string}", function (target, targetType) {
  this.inputPatch({ target, targetType });
});

Given("a publisher for the origin {string} given no target", function (origin) {
  this.publisherConfig = { ...this.publisherConfig, normalize: { target: new URL(origin).host, targetType: "origin" } };
  this.inputPatch({ target: undefined, targetType: undefined });
});

Then("the draft CDDL accepts it", function () {
  assert.equal(cddlAccepts(this.docText ?? this.subject()), true, "the draft CDDL rejects it");
});

Then("the repository JTD accepts it", function () {
  assert.equal(jtdAccepts(publisher.RESPONSE_JTD_SCHEMA, this.subject()), true, "the repository JTD rejects it");
});

Given("the case file {string}", function (name) {
  const text = readFileSync(resolve(ROOT, "bdd", "fixtures", "ex", name), "utf8");
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // a negative case may not be JSON at all: the validators are given the text
  }
  this.setDoc(parsed);
  this.docText = text;
});

// ---- the document: arrays, I-JSON, unknown members, extensions ----------------------------------------------------

Given("the declaration is an array of a valid object and an object without the member {string}", function (member) {
  const second = baseDeclaration({ capabilities: "extended", period: periodFromText("2024") });
  delete second[member];
  this.setDoc([baseDeclaration({ capabilities: "extended" }), second]);
});

Then("the errors name the array element {int}", function (index) {
  assert.ok(this.result.errors.some((e) => new RegExp(`(\\[${index}\\]|/${index}\\b|\\b${index}\\b)`).test(e)), JSON.stringify(this.result.errors));
});

/** Three objects, as a table of periods and figures, or as one object per form of an older revision. */
Given("the declaration is an array of three objects:", function (table) {
  if (!table.raw()[0].includes("form")) {
    this.setDoc(objectsFromTable(table));
    return;
  }
  const form = {
    "-08": (text) => legacyDocument("08", { "reporting-period": text.replace("reporting-period ", "") }),
    "-09": (text) => {
      const [, start, end] = /^period (\S+) to (\S+)$/.exec(text);
      return legacyDocument("09", { period: { start, end } });
    },
    "-10": (text) => baseDeclaration({ period: periodFromText(text.replace("period ", "")) }),
  };
  this.setDoc(table.hashes().map((row) => ({ ...form[row.form](row.value), capabilities: "extended" })));
});

When("the publisher serialises the object", async function () {
  mine(this).serialised = (await this.currentPublisher().getSerialized()).body;
});

Then("the I-JSON gate accepts the text", function () {
  assert.doesNotThrow(() => consumer.parseStrict(mine(this).serialised));
});

Given("the upstream member names {string} without a role", function (declaration) {
  this.mutateDoc((d) => (d.upstream = [...(d.upstream ?? []), { declaration }]));
});

Given("the period and the upstream entry each carry an unknown member", function () {
  this.mutateDoc((d) => {
    d.period["period-note"] = "unknown";
    d.upstream[0]["entry-note"] = "unknown";
  });
});

When("the publisher gate checks it", function () {
  // The gate refuses a member the draft does not define, whatever an adapter handed over: the object's own extras go in as such.
  const defined = new Set(["updated", "capabilities", "provider", "measurement-method", "methodology-uri", "period", "target", "target-type", "energy-consumption", "energy-unit", "carbon-footprint", "carbon-unit", "carbon-accounting", "scope-1", "scope-2", "scope-3", "sci-score", "functional-unit", "carbon-intensity-gCO2e-per-kWh", "renewable-energy", "estimated-annual-emissions-kgCO2e", "disclosure-uri", "verifiable-attestation-uri", "upstream", "extensions", "signed"]);
  const object = theObject(this);
  const extra = Object.fromEntries(Object.entries(object).filter(([name]) => !defined.has(name)));
  this.input = { ...publisher.fromWire(object, { legacyCompat: false }), extra };
  this.adapter = undefined;
  this.invalidateBuild();
});

Given(/^the extension "([^"]*)" is '(\{"score": [\d.]+, "unit": "[^"]*"\})'$/, function (name, json) {
  this.addExtension(name, JSON.parse(json));
});

Given(/^the extension "([^"]*)" is '(\{"nested": \{"unknown": \[1, 2, 3\]\}\})'$/, function (name, json) {
  this.addExtension(name, JSON.parse(json));
});

Then("the fetched upstream entry has role {string}", function (role) {
  assert.equal(fetchedObject(this).upstream[0].role, role);
});

Then("the fetched upstream entry has no member {string}", function (member) {
  assert.equal(fetchedObject(this).upstream[0][member], undefined);
});

Then("the fetched object keeps the upstream entry {string}", function (declaration) {
  assert.ok((fetchedObject(this).upstream ?? []).some((entry) => entry.declaration === declaration), JSON.stringify(fetchedObject(this).upstream));
});

// ---- the repository: verbatim copies, wording, conversions ----------------------------------------------------------

Given("the repository copy of the draft's Introduction example with one byte changed", function () {
  const copy = readFileSync(resolve(ROOT, "schemas-validators", "examples", "valid", "draft-introduction.json"));
  copy[copy.length >> 1] ^= 1;
  mine(this).copy = copy;
});

When("the verbatim check runs", function () {
  const m = mine(this);
  const original = Buffer.from(draftExampleText("Introduction"), "utf8");
  const same = m.copy !== undefined && Buffer.compare(m.copy, original) === 0;
  this.check = { passed: m.copy === undefined || same, message: same ? "the copy is the draft's example" : "the copy differs from the example in the draft" };
});

/** The files of a folder of the repository, by name. */
const filesIn = (folder) => readdirSync(resolve(ROOT, folder)).filter((name) => !name.startsWith("."));

Then("every file of {string} is byte-identical to the file of the same name in {string}", function (copy, original) {
  const names = filesIn(copy);
  assert.ok(names.length > 0, `${copy} holds no file`);
  const different = names.filter((name) => Buffer.compare(readFileSync(resolve(ROOT, copy, name)), readFileSync(resolve(ROOT, original, name))) !== 0);
  assert.deepEqual(different, [], `these files of ${copy} differ from ${original}`);
});

Given("the draft's example {string} signed with Ed25519", async function (title) {
  const key = await this.namedKey("example-key");
  const example = draftExample(title);
  const signed = await Promise.all([example].flat().map((object) => this.signObject(object, key)));
  this.setDoc(Array.isArray(example) ? signed : signed[0]);
  // A publisher that serves the example signs it with the same key.
  this.publisherConfig = { ...this.publisherConfig, signing: { key }, capabilities: "extended" };
  this.invalidateBuild();
});

/** The rules of the legal wording: what a page may not say about whose figures they are. */
const WORDING_RULES = [
  { pattern: /published (these|the) figures (itself|themselves)|published them itself/i, message: "the figures of a third-party target are a claim of the gateway operator, not of the target" },
  { pattern: /measured on its own|its own measurement/i, message: "the figures of a path are the publisher's allocation, not a measurement of the path" },
];

const wordingCheck = (text) => {
  const broken = WORDING_RULES.find((rule) => rule.pattern.test(text));
  return broken ? { passed: false, message: broken.message } : { passed: true, message: "no wording rule is broken" };
};

When("the legal wording test runs", function () {
  this.check = wordingCheck(this.publishedText);
});

Then("the notice says the figures for a third-party target are claims of the gateway operator", function () {
  const text = this.response.body;
  assert.match(text, /claim/i, "the notice does not speak of claims");
  assert.match(text, /operator/i, "the notice does not name the gateway operator");
  assert.equal(wordingCheck(text).passed, true, wordingCheck(text).message);
});

Then("the index entry for {string} says the figures are the publisher's allocation by the method the methodology document describes", function (subject) {
  const index = this.response.json();
  const list = [...index.subjects, ...index["adapter-demonstrations"].entries, ...index["wire-format-examples"].entries];
  const entry = list.find((e) => e.domain === subject);
  assert.ok(entry, `the index has no entry for ${subject}`);
  const text = JSON.stringify(entry);
  assert.match(text, /allocation/i, `the entry says: ${text}`);
  assert.match(text, /methodology/i, `the entry says: ${text}`);
});

Then("no object is reported as modified", function () {
  const verified = mine(this).verified ?? this.verified;
  assert.ok(!(verified?.signatures ?? []).some((s) => s.modifiedAfterSigning), "an object is reported as modified");
  assert.ok(!(this.result?.warnings ?? []).some((w) => w.includes("modified-after-signing")), "a warning reports a modification");
});

// ---- adapters ------------------------------------------------------------------------------------------------------

const SALESFORCE_EXPORT = {
  totalSize: 1,
  done: true,
  records: [{ Year: "2025", TotalScope1Emissions: 90, TotalScope2MktEmissions: 220, TotalScope3Emissions: 300, TotalEmissions: 610, ActualEnergyConsumption: 4200 }],
};

Given("a Salesforce Net Zero Cloud export with scope {int}, scope {int} and scope {int} emissions", function (_scope1, _scope2, _scope3) {
  this.input = undefined;
  this.adapter = publisher.salesforceNzcAdapter({ provider: PROVIDER, methodologyUri: METHODOLOGY, fixture: SALESFORCE_EXPORT });
});

Given("a Salesforce Net Zero Cloud export without a carbon unit", function () {
  this.input = undefined;
  this.adapter = publisher.salesforceNzcAdapter({ provider: PROVIDER, methodologyUri: METHODOLOGY, fixture: SALESFORCE_EXPORT });
});

/** Read the adapter of the scenario: what it yields, and the declaration the publisher makes of it. */
async function readAdapter(world) {
  assert.ok(world.adapter, "no adapter was given");
  const yielded = [await world.adapter.fetch({})].flat();
  world.adapterOutput = { objects: yielded, skipped: [] };
  world.invalidateBuild();
  const { objects, error } = await world.built();
  if (error) throw error;
  world.setDoc(objects.length === 1 ? objects[0] : objects);
}

When("the adapter reads it", async function () {
  await readAdapter(this);
});

Then("the adapter yields {int} object", function (count) {
  assert.equal(this.adapterOutput.objects.length, count);
});

Then("the object carries the members {string}, {string}, {string}, {string}", function (a, b, c, d) {
  for (const member of [a, b, c, d]) assert.notEqual(theObject(this)[member], undefined, `the object has no ${member}`);
});

Then("the object carries {string} {string}", function (member, text) {
  assert.equal(theObject(this)[member], text);
});

/** The token the draft's definitions give to each kind of source (Mandatory Members, measurement-method). */
const REVIEWED_TOKENS = {
  "utility bill": "hardware-metered",
  "Kepler energy counters": "hardware-estimated",
  "cloud provider invoice": "cloud-billing",
  "grid-factor model": "third-party-modeled",
  "hosting provider invoice estimated by the provider": "cloud-billing",
};

const keplerReading = { status: "success", data: { resultType: "vector", result: [{ metric: {}, value: [0, "3600000000"] }] } };
const invoice = { value: [{ totalEmissions: 12 }] };

/** The adapter of this library that reads each kind of source; one that takes the token from the operator gets the reviewed one. */
const SOURCE_ADAPTERS = {
  "utility bill": () => publisher.csvAdapter({ text: "period,energy\n2025,1200\n", provider: PROVIDER, methodologyUri: METHODOLOGY, measurementMethod: REVIEWED_TOKENS["utility bill"] }),
  "Kepler energy counters": () => publisher.keplerPrometheusAdapter({ provider: PROVIDER, methodologyUri: METHODOLOGY, period: "2025", gridIntensity: 400, fixture: keplerReading }),
  "cloud provider invoice": () => publisher.msSustainabilityAdapter({ provider: PROVIDER, methodologyUri: METHODOLOGY, period: "2025", fixturePages: [invoice] }),
  "grid-factor model": () => publisher.co2jsAdapter({ provider: PROVIDER, methodologyUri: METHODOLOGY, period: "2025", bytes: 1e9, gridIntensity: 400, green: false }),
  "hosting provider invoice estimated by the provider": () => publisher.msSustainabilityAdapter({ provider: PROVIDER, methodologyUri: METHODOLOGY, period: "2025", fixturePages: [invoice] }),
};

Given("an adapter input of kind {string}", function (kind) {
  assert.ok(SOURCE_ADAPTERS[kind], `no adapter of this library reads a source of kind "${kind}"`);
  this.input = undefined;
  this.adapter = SOURCE_ADAPTERS[kind]();
});

Given("an adapter that labels the input kind {string} as {string}", function (kind, token) {
  mine(this).labelled = { kind, token };
});

When("the reviewed token table check runs", function () {
  const { kind, token } = mine(this).labelled;
  const reviewed = REVIEWED_TOKENS[kind];
  this.check = { passed: reviewed === token, message: `the input kind "${kind}" is labelled ${token}; the draft's definitions give ${reviewed}` };
});

// ---- the closed sets ---------------------------------------------------------------------------------------------------

Then("combining the methods {string} gives {string}", function (methods, token) {
  assert.equal(publisher.leastDirect(methods.split(",").map((m) => m.trim()).filter(Boolean)), token);
});

When("the publisher builds a declaration with measurement-method {string}", async function (token) {
  this.inputPatch({ measurementMethod: token });
  const { error } = await this.built();
  if (error) throw error;
});

When("the publisher builds a declaration with functional-unit {string} and sci-score {float}", async function (unit, score) {
  this.inputPatch({ functionalUnit: unit, sciScore: score });
  const { error } = await this.built();
  if (error) throw error;
});

Given("a publisher given the measurement method {string}", function (token) {
  this.inputPatch({ measurementMethod: token });
});

Given("a publisher given metered energy of {float} kWh and the grid factor of {float} gCO2e per kWh", function (kwh, factor) {
  this.inputPatch({ measurementMethod: "hardware-metered", energy: { value: kwh, unit: "kWh" }, carbon: { value: publisher.carbonFromEnergy(kwh, factor), unit: "gCO2e" }, carbonIntensity: factor });
});

Given("the figures are allocated {int} percent to the path {string}", function (percent, path) {
  mine(this).allocation = { share: percent / 100, path };
});

When("the publisher builds the declaration for {string}", async function (path) {
  const { share, path: allocated } = mine(this).allocation;
  assert.equal(path, allocated, "the figures are allocated to another path");
  const input = this.input;
  this.inputPatch({
    target: path,
    targetType: "path",
    energy: { value: input.energy.value * share, unit: input.energy.unit },
    carbon: { value: input.carbon.value * share, unit: input.carbon.unit },
  });
  const { error } = await this.built();
  if (error) throw error;
});

When("the consumer reads it in compatibility mode", function () {
  this.readAs("compatibility");
});

Then("the fetched member {string} is {string}", function (member, expected) {
  assert.equal(getPath(fetchedObject(this), member), expected);
});

Then("the fetched member {string} is the number {float}", function (member, expected) {
  assert.equal(getPath(fetchedObject(this), member), expected);
});

Then("the fetched object has no member {string}", function (member) {
  assert.equal(getPath(fetchedObject(this), member), undefined);
});

/** Whether a report lists a member path; a path in an array is prefixed `[i].`. */
const lists = (paths, member) => paths.some((p) => p === member || p.endsWith(`].${member}`));

Then("the member {string} is reported as converted", function (member) {
  assert.ok(lists(this.read.converted, member), `converted: ${JSON.stringify(this.read.converted)}`);
});

Then("the member {string} is reported as disregarded", function (member) {
  assert.ok(lists(this.read.disregarded, member), `disregarded: ${JSON.stringify(this.read.disregarded)}`);
});

Then("the member {string} is not reported", function (member) {
  assert.ok(!lists(this.read.converted, member) && !lists(this.read.disregarded, member), `converted: ${JSON.stringify(this.read.converted)}, disregarded: ${JSON.stringify(this.read.disregarded)}`);
});

function assertNotUsable(world, members) {
  for (const member of members) assert.ok(lists(world.read.disregarded, member), `${member} is not reported as unusable; disregarded: ${JSON.stringify(world.read.disregarded)}`);
}

Then("the members {string}, {string} are reported as not usable", function (a, b) {
  assertNotUsable(this, [a, b]);
});

Then("the members {string}, {string}, {string}, {string} are reported as not usable", function (a, b, c, d) {
  assertNotUsable(this, [a, b, c, d]);
});

Then("the report lists exactly these paths as converted: {string}, {string}, {string}", function (a, b, c) {
  const paths = [a, b, c];
  assert.deepEqual([...this.read.converted].sort(), [...paths].sort());
});

Then("the report lists exactly these paths as disregarded: {string}, {string}", function (a, b) {
  const paths = [a, b];
  assert.deepEqual([...this.read.disregarded].sort(), [...paths].sort());
});

Then("the objects are reported as converted: {int}", function (count) {
  const objects = new Set(this.read.converted.map((path) => /^\[(\d+)\]/.exec(path)?.[1]));
  assert.equal(objects.size, count, JSON.stringify(this.read.converted));
});

Then("the first object is converted and the second is unchanged", function () {
  const [first, second] = upgradeOutput(this);
  const [original] = JSON.parse(upgradeInput(this));
  assert.equal(consumer.validateDocument(first).valid, true, JSON.stringify(consumer.validateDocument(first).errors));
  assert.notDeepEqual(first, original);
  assert.deepEqual(second, JSON.parse(upgradeInput(this))[1]);
});

Then("the energy and the carbon keep their own units", function () {
  const object = theObject(this);
  assert.equal(object["energy-consumption"], 12);
  assert.equal(object["carbon-footprint"], 5);
  assert.ok(["Wh", "kWh", "MWh", "GWh"].includes(object["energy-unit"]) && ["gCO2e", "kgCO2e", "tCO2e"].includes(object["carbon-unit"]));
});

Then("the three arrays of the publisher token module equal the JTD enums of the schemas", function () {
  assert.deepEqual([...publisher.MEASUREMENT_METHODS], jtdEnum("measurement-method"));
  assert.deepEqual([...publisher.FUNCTIONAL_UNITS], jtdEnum("functional-unit"));
  assert.deepEqual([...publisher.UPSTREAM_ROLES], jtdEnum("role"));
});

Then("they equal the alternatives of the CDDL rules for measurement-method, functional-unit and role", function () {
  assert.deepEqual([...publisher.MEASUREMENT_METHODS], cddlAlternatives("measurement-method"));
  assert.deepEqual([...publisher.FUNCTIONAL_UNITS], cddlAlternatives("functional-unit"));
  assert.deepEqual([...publisher.UPSTREAM_ROLES], cddlAlternatives("role"));
});

Then("the publisher and consumer token modules are byte-identical", function () {
  assert.equal(Buffer.compare(readFileSync(resolve(ROOT, "publisher", "src", "tokens.ts")), readFileSync(resolve(ROOT, "consumer", "src", "tokens.ts"))), 0);
});

Then("target-type has nine tokens, carbon-unit three, energy-unit four, carbon-accounting two", function () {
  const sizes = { "target-type": 9, "carbon-unit": 3, "energy-unit": 4, "carbon-accounting": 2 };
  const sets = { "target-type": publisher.TARGET_TYPES, "carbon-unit": publisher.CARBON_UNITS, "energy-unit": publisher.ENERGY_UNITS, "carbon-accounting": publisher.CARBON_ACCOUNTING };
  for (const [member, size] of Object.entries(sizes)) {
    assert.equal(sets[member].length, size, `${member} in the library`);
    assert.deepEqual([...sets[member]], jtdEnum(member), `${member} in the JTD`);
    assert.equal(cddlAlternatives(member).length, size, `${member} in the CDDL`);
  }
});

Then("functional-unit has twelve tokens", function () {
  assert.equal(publisher.FUNCTIONAL_UNITS.length, 12);
  assert.equal(consumer.FUNCTIONAL_UNITS.length, 12);
  assert.equal(jtdEnum("functional-unit").length, 12);
  assert.equal(cddlAlternatives("functional-unit").length, 12);
});

/** The members of a JavaScript or PHP array literal that follows `name` in a source file. */
function listedIn(path, name) {
  const source = repositoryFile(path);
  const literal = new RegExp(`${name}\\s*=\\s*(?:array\\(|\\[)([^\\]\\)]*)`).exec(source);
  assert.ok(literal, `${path} has no list ${name}`);
  return [...literal[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1]);
}

/** What a tool says when it is given a token outside a set: the tokens it names. */
async function offeredBy(world, option) {
  const outDir = world.tempDir("offer");
  const r = await runNode([BIN.createData, "--out", outDir, "--host", "file", "--yes", "--target", "Acme", "--provider", "Acme (a@acme.example)", "--methodology-uri", "/m", "--period", "2025", "--carbon-footprint", "1", "--carbon-unit", "tCO2e", "--updated", "2026-10-24T12:00:00Z", option, "nonsense"]);
  const named = /must be one of ([^(]+)\(/.exec(r.stderr);
  assert.ok(named, `the tool does not name its tokens: ${r.stderr}`);
  return named[1].split(",").map((t) => t.trim());
}

Then("the Railway one-click, the WordPress plugin and the create-sustainability-data tool list exactly the four measurement methods", async function () {
  const methods = [...publisher.MEASUREMENT_METHODS];
  assert.deepEqual(listedIn("deploy/one-click/railway/server.mjs", "METHODS"), methods);
  assert.deepEqual(listedIn("deploy/wordpress/sustainability-data-wellknown/includes/class-sustainability-data-wellknown.php", "METHODS"), methods);
  assert.deepEqual(await offeredBy(this, "--measurement-method"), methods);
});

Then("the report-to-declaration tool lists a subset of them", async function () {
  const { ALLOWED_METHODS } = await import(pathToFileURL(resolve(ROOT, "tools", "report-to-declaration", "tokens.mjs")).href);
  assert.ok(ALLOWED_METHODS.length > 0 && ALLOWED_METHODS.every((m) => publisher.MEASUREMENT_METHODS.includes(m)), JSON.stringify(ALLOWED_METHODS));
});

Then("the create-sustainability-data tool offers the target-type {string}", async function (type) {
  assert.ok((await offeredBy(this, "--target-type")).includes(type), `the tool does not offer ${type}`);
});

Then("the target-types the create-sustainability-data tool offers are exactly the nine of the draft", async function () {
  assert.deepEqual(await offeredBy(this, "--target-type"), cddlAlternatives("target-type"));
});

// ---- upstream declarations ---------------------------------------------------------------------------------------------

const TENANT = { target: "tenant.example", "target-type": "tenant" };

/** A subject that depends on one upstream declaration, answered as the entry says (a declaration, or { status, contentType, body }). */
function subjectWithUpstream(world, uri, entry) {
  world.upstream = { docs: new Map([[uri, entry]]), log: [] };
  world.setDoc(baseDeclaration({ ...TENANT, upstream: [{ declaration: uri, role: "hosting" }] }));
}

Given("a subject declaration whose upstream answers with the media type {string}", function (mediaType) {
  subjectWithUpstream(this, this.chainUri(1), { status: 200, contentType: mediaType, body: JSON.stringify(baseDeclaration(TENANT)) });
});

Given("a subject declaration whose upstream is served at {string}", function (path) {
  subjectWithUpstream(this, `https://provider1.example${path}`, baseDeclaration(TENANT));
});

Then("the upstream reason mentions {string}", function (text) {
  const [first] = flatComparisons(this.comparisons);
  assert.ok(first, "the walk reported nothing");
  assert.ok(textOf(first).includes(text), `the upstream was reported as ${JSON.stringify(first)}`);
});

Then("the upstream declaration was retrieved from {string}", function (path) {
  assert.ok(this.upstream.log.some((uri) => new URL(uri).pathname === path), `retrieved: ${this.upstream.log.join(", ")}`);
});

Given("the publisher is served on a local port at the path {string}", async function (path) {
  this.serverOptions.extraPaths = [path];
  await this.servePublisher();
});

// ---- bytes and functional units ------------------------------------------------------------------------------------------

/** The gigabytes of the draft are 10^9 bytes (Optional Members, functional-unit). */
const GIGABYTE = 1e9;

Given("a publisher given {int} bytes transferred", function (bytes) {
  mine(this).bytes = bytes;
});

When("the publisher derives the per-gigabyte quantity", function () {
  const m = mine(this);
  m.quantity = m.bytes / GIGABYTE;
});

Then("the derived quantity is {float}", function (expected) {
  assert.equal(mine(this).quantity, expected);
});

Given("a conversion that divides bytes by {int}^{int}", function (base, power) {
  mine(this).conversion = (bytes) => bytes / base ** power;
});

When("the unit-conversion test runs", function () {
  const bytes = 1_500_000_000;
  const got = mine(this).conversion(bytes);
  const passed = got === 1.5;
  this.check = { passed, message: `${bytes} bytes is 1.5 gigabytes (a gigabyte is 10^9 bytes); the conversion gives ${got}` };
});

// ---- the create-sustainability-data tool: the methodology stub ---------------------------------------------------------

Given("noise is enabled at {int} percent", function (percent) {
  this.answers.noise = String(percent);
  this.answers["methodology-stub"] = true;
});

/** The stub of the tool, written by a run that asks for one with the answers of the scenario. */
async function stubOfTheTool(world) {
  const answers = { ...world.answers, "methodology-stub": true };
  const outDir = world.tempDir("stub");
  const args = ["--out", outDir, "--host", "file", "--yes"];
  for (const [name, answer] of Object.entries(answers)) {
    if (name === "period" && String(answer).includes("/")) args.push("--period-start", ...String(answer).split("/").slice(0, 1), "--period-end", String(answer).split("/")[1]);
    else if (name === "yes" || name === "methodology-stub") args.push(`--${name}`);
    else if (Array.isArray(answer)) for (const each of answer) args.push(`--${name}`, each);
    else args.push(`--${name}`, String(answer));
  }
  const r = await runNode([BIN.createData, ...args]);
  assert.equal(r.status, 0, r.stderr);
  return world.filesUnder(outDir)["methodology.md"];
}

Then("the methodology stub has the five headings", async function () {
  const headings = [...(await stubOfTheTool(this)).matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.equal(headings.length, 5, JSON.stringify(headings));
});

Then("the methodology stub lists the extension name {string}", async function (name) {
  assert.ok((await stubOfTheTool(this)).includes(name));
});

Then("the methodology stub says that perturbation was applied within {int} percent", async function (percent) {
  assert.match(await stubOfTheTool(this), new RegExp(`Perturbation was applied .*within ${percent} percent`));
});

Then("the methodology stub has the heading {string}", async function (heading) {
  const headings = [...(await stubOfTheTool(this)).matchAll(/^## (.+)$/gm)].map((m) => m[1].toLowerCase());
  assert.ok(headings.includes(heading.toLowerCase()), JSON.stringify(headings));
});

// ---- the leap second ---------------------------------------------------------------------------------------------------

Then("the fetched period is {string} to {string}", function (start, end) {
  const { period } = fetchedObject(this);
  assert.ok(sameInstant(period.start, start) && sameInstant(period.end, end), `the period is ${period.start} to ${period.end}`);
});

Then("the notes mention {string}", function (text) {
  assertMentions(this.result.warnings, text, "note");
});

Then("the publisher never emits a second of {int}", async function (second) {
  const { period } = theObject(this);
  await assertSecond(this, period, second);
});

/** A publisher given the period either refuses it or writes bounds whose second is not `second`. */
async function assertSecond(world, period, second) {
  world.input = undefined;
  world.adapter = undefined;
  world.inputPatch({ period });
  const { objects } = await world.built();
  for (const object of objects) {
    for (const bound of [object.period.start, object.period.end]) assert.notEqual(bound.slice(17, 19), String(second), `the publisher wrote ${bound}`);
  }
}

// ---- older revisions: the documents --------------------------------------------------------------------------------------

/** The clauses of "a -09 document with ...": each sets one thing in the document. */
const CLAUSE = new RegExp(
  [
    'updated "([^"]*)"',
    'period "([^"]*)" to "([^"]*)"',
    'method "([^"]*)"',
    'unit "([^"]*)" score (-?[\\d.]+)',
    'role "([^"]*)"',
    'the upstream "([^"]*)"',
    'the extension "([^"]*)" with \'(.*)\'',
    'no "([^"]*)"',
    '"([^"]*)" in decomposed Unicode form',
    '"([^"]*)" (?:"([^"]*)"|(-?[\\d.]+))',
  ].join("|"),
  "g",
);

/** The document an older revision wrote, with what the clauses of its description say. */
function legacyFrom(revision, description) {
  const document = legacyDocument(revision);
  let upstream;
  for (const c of description.matchAll(CLAUSE)) {
    const [, updated, start, end, method, unit, score, role, uri, extension, extensionJson, absent, decomposed, member, text, number] = c;
    if (updated !== undefined) document.updated = updated;
    else if (start !== undefined) document.period = { start, end };
    else if (method !== undefined) document["measurement-method"] = method;
    else if (unit !== undefined) Object.assign(document, { "functional-unit": unit, "sci-score": Number(score) });
    else if (uri !== undefined) upstream = { declaration: uri };
    else if (role !== undefined) {
      upstream ??= { declaration: "https://provider.example/t.json" };
      upstream.role = role;
    } else if (extension !== undefined) document.extensions = { ...(document.extensions ?? {}), [extension]: JSON.parse(extensionJson) };
    else if (absent !== undefined) delete document[absent];
    else if (decomposed !== undefined) document[decomposed] = "Müller & Söhne (https://example.com/contact)".normalize("NFD");
    else document[member] = text !== undefined ? text : Number(number);
  }
  if (upstream) document.upstream = [upstream];
  return document;
}

Given(/^a -(\d+) document ((?:with|updated) .+)$/, function (revision, description) {
  this.setDoc(legacyFrom(revision, description));
});

Given(/^a (-0[89]) document$/, function (revision) {
  this.setDoc(legacyDocument(revision.slice(1)));
});

Given("the document is an array of a -08 object and a -10 object", function () {
  this.setDoc([legacyDocument("08"), baseDeclaration()]);
});

Given("the document is an array of a -08 object and an object with {string} {string}", function (member, text) {
  this.setDoc([legacyDocument("08"), legacyDocument("08", { [member]: text })]);
});

Given("the document is an empty array", function () {
  this.setDoc([]);
});

/** "the document with ..." is the older revision the member belongs to; "which is ..." is not a declaration at all. */
Given(/^the document ((?:with|which) .+)$/, function (description) {
  const text = /^which is not JSON$/.test(description)
    ? "{ this is not JSON"
    : /^which is the string "hello"$/.test(description)
      ? '"hello"'
      : undefined;
  if (text !== undefined) {
    this.setDoc(undefined);
    this.docText = text;
    return;
  }
  this.setDoc(legacyFrom(/reporting-period/.test(description) ? "08" : "09", description));
});

Given("the legacy file {string}", function (path) {
  const text = readFileSync(resolve(ROOT, path), "utf8");
  this.setDoc(JSON.parse(text));
  this.docText = text;
  if (!path.startsWith("bdd/fixtures/")) this.setDoc(inLegacyForm(this.doc));
});

/** A -10 data file as the -09 revision wrote it: inclusive dates and the tonne as mtCO2e. */
function inLegacyForm(document) {
  const copy = structuredClone(document);
  const dateOf = (instant) => instant.slice(0, 10);
  const lastDay = (instant) => new Date(Date.parse(`${dateOf(instant)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (copy.period) copy.period = { start: dateOf(copy.period.start), end: lastDay(copy.period.end) };
  if (copy["carbon-unit"] === "tCO2e") copy["carbon-unit"] = "mtCO2e";
  return copy;
}

Given("the gateway data file {string} with reporting-period {string} and basis {string}", function (path, label, basis) {
  const { period: _period, ...rest } = JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  const legacy = { ...inLegacyForm(rest), "reporting-period": label, extensions: { "urn:uuid:58f04ecf-c558-4674-8dc6-c8bdbb6a8041": { "reporting-period-basis": basis } } };
  this.setDoc(legacy);
});

// ---- the upgrade tool --------------------------------------------------------------------------------------------------------

/** The text the document was given to the tool as. */
const upgradeInput = (world) => world.docText ?? JSON.stringify(world.doc, null, 2);

/** What the tool wrote for the last run: standard output, else the output file. */
function upgradeText(world) {
  const { stdout, outFile } = world.upgrade;
  if (stdout.length > 0) return stdout;
  return readFileSync(outFile, "utf8");
}

/** The converted document of the last run. */
function upgradeOutput(world) {
  return JSON.parse(upgradeText(world));
}

/** Run the tool on a text, with the arguments the callers give after the input file; the output goes where they say. */
async function runUpgradeTool(world, { text, flags = [], output, inPlace = false }) {
  const m = mine(world);
  const dir = world.tempDir("upgrade");
  const input = world.writeFileIn(dir, "in/document.json", text);
  const outDir = join(dir, "out");
  const outFile = output === undefined ? undefined : join(outDir, output);
  const args = [BIN.publisher, "upgrade", input, ...(inPlace ? [input] : outFile ? [outFile] : []), ...flags];
  const r = await runNode(args);
  const files = world.filesUnder(outDir);
  m.input = input;
  m.outFile = outFile;
  m.inputText = text;
  world.run = { program: "upgrade", ...r, outDir, files };
  world.upgrade = { ...r, outFile: outFile ?? input, output: undefined };
  try {
    world.upgrade.output = JSON.parse(upgradeText(world));
  } catch {
    // a run that fails writes nothing to read
  }
}

When("the upgrade tool runs on the document with the output file {string}", async function (name) {
  await runUpgradeTool(this, { text: upgradeInput(this), output: name });
});

When("the upgrade tool runs on the document in place", async function () {
  await runUpgradeTool(this, { text: upgradeInput(this), inPlace: true });
});

When("the upgrade tool runs on its own output", async function () {
  const first = upgradeText(this);
  mine(this).first = first;
  await runUpgradeTool(this, { text: first, output: "second.json" });
});

Then("the second output is byte-identical to the first", function () {
  assert.equal(upgradeText(this), mine(this).first);
});

Then("the upgrade prints a line mentioning {string}", function (text) {
  const printed = `${this.upgrade.stderr}\n${this.upgrade.stdout}`;
  assert.ok(printed.toLowerCase().includes(text.toLowerCase()), `the tool printed: ${printed}`);
});

Then("the upgrade output has no member {string}", function (member) {
  assert.equal(getPath(this.upgrade.output, member), undefined);
});

Then("the upgrade output has period {string} to {string}", function (start, end) {
  const { period } = this.upgrade.output;
  assert.deepEqual(period, { start, end });
});

Then("the upgrade output has {string} {string}", function (member, text) {
  assert.equal(getPath(this.upgrade.output, member), text);
});

Then("the upgrade output does not keep the extension {string}", function (name) {
  assert.equal(this.upgrade.output.extensions?.[name], undefined, "the fiscal-year basis is spent once the exact period is written, and the upgrade removes it");
});

Then("the upgrade output keeps the {string} member", function (member) {
  assert.ok(this.upgrade.output[member] !== undefined, `the output holds ${Object.keys(this.upgrade.output)}`);
});

Then("the converted declaration inside it is valid under the -{int} schema", function (_revision) {
  const checked = consumer.validateDocument(this.upgrade.output.document);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
});

Then("the upgrade output is byte-identical to the input", function () {
  assert.equal(upgradeText(this), upgradeInput(this));
});

Then("every member other than {string} is deep-equal to the input", function (member) {
  const { [member]: _converted, ...output } = this.upgrade.output;
  const { [member]: _original, ...input } = JSON.parse(upgradeInput(this));
  assert.deepEqual(output, input);
});

Then("the upgrade output is an empty array", function () {
  assert.deepEqual(this.upgrade.output, []);
});

Then("the upgrade output {string} is in Normalization Form C", function (member) {
  const converted = this.upgrade.output[member];
  assert.equal(converted, converted.normalize("NFC"));
  assert.notEqual(converted, JSON.parse(upgradeInput(this))[member], "the member was not changed");
});

Then("the upgrade writes the converted document to standard output", function () {
  assert.notEqual(this.upgrade.stdout, "", "the tool wrote nothing to standard output");
  assert.equal(consumer.validateDocument(JSON.parse(this.upgrade.stdout)).valid, true);
});

/** A file of the last run valid under the current schema and the draft CDDL. */
function assertFileIsCurrent(path) {
  const document = JSON.parse(readFileSync(path, "utf8"));
  const checked = consumer.validateDocument(document);
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
  assert.equal(cddlAccepts(document), true, "the draft CDDL rejects the file");
}

Then("the output file is valid under the -{int} schema and the CDDL", function (_revision) {
  assertFileIsCurrent(mine(this).outFile);
});

Then("the input file is valid under the -{int} schema and the CDDL", function (_revision) {
  assertFileIsCurrent(mine(this).input);
});

Then("the output file holds the whole document", function () {
  const expected = publisher.upgradeText(mine(this).inputText);
  assert.equal(readFileSync(mine(this).outFile, "utf8"), expected.text);
});

Then("the input file is unchanged", function () {
  const m = mine(this);
  assert.equal(readFileSync(m.input, "utf8"), m.inputText);
});

// ---- a publisher given an older form ---------------------------------------------------------------------------------------------

Given("a publisher given the -{int} reporting-period {string}", function (_revision, label) {
  this.inputPatch({ period: label });
});

Given("a publisher given the -{int} reporting-period {string} with the offset {string}", function (_revision, label, offset) {
  this.inputPatch({ period: publisher.toPeriod(label, offset) });
});

Given("a publisher given the -{int} period {string} to {string}", function (_revision, start, end) {
  this.inputPatch({ period: publisher.periodFromFullDates({ start, end }) });
});

/** The change of the input that each description of an older token stands for. */
const OLDER_TOKENS = {
  "the functional unit": (v) => ({ functionalUnit: v, sciScore: 4.2 }),
  "the carbon unit": (v) => ({ carbon: { value: 610, unit: v } }),
  "the upstream role": (v) => ({ upstream: [{ declaration: "https://provider.example/t.json", role: v }] }),
  "the target type": (v) => ({ targetType: v }),
};

Given(/^a publisher given the (functional unit|carbon unit|upstream role|target type) "([^"]*)"$/, function (what, token) {
  this.inputPatch(OLDER_TOKENS[`the ${what}`](token));
});

Given("a CSV with one row whose measurement method is {string} and one whose method is {string}", function (first, second) {
  this.csvText = `period,energy,carbon,measurement_method\n2025-01,100,10,${first}\n2025-02,100,10,${second}\n`;
  this.csvConfig = {};
});
