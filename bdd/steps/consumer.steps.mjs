/**
 * Steps for the consumer's own rules: transport, redirects, bounds, upstream
 * walks, extensions, and internationalization.
 */
import assert from "node:assert/strict";
import { Given, Then, When } from "@cucumber/cucumber";
import { MEDIA_TYPE, WELL_KNOWN, baseDeclaration, consumer } from "./world.mjs";

const walkOptions = (extra = {}) => ({
  timeoutMs: 5_000,
  maxBytes: 1_000_000,
  maxObjects: 50,
  allowInsecure: true,
  allowPrivateAddresses: true,
  ...extra,
});

When("the consumer fetches the origin {string}", async function (origin) {
  try {
    this.fetchResult = await consumer.fetchSustainability(origin, { timeoutMs: 3_000 });
  } catch (e) {
    this.fetchResult = { status: "threw", error: String(e.message ?? e) };
  }
});

When("the consumer fetches the local origin allowing insecure transport", async function () {
  try {
    this.fetchResult = await consumer.fetchSustainability(this.base, { allowInsecure: true, timeoutMs: 3_000 });
  } catch (e) {
    this.fetchResult = { status: "threw", error: String(e.message ?? e) };
  }
});

When("the consumer fetches the local origin allowing insecure transport with at most {int} bytes", async function (n) {
  try {
    this.fetchResult = await consumer.fetchSustainability(this.base, { allowInsecure: true, timeoutMs: 3_000, maxBytes: n });
  } catch (e) {
    this.fetchResult = { status: "threw", error: String(e.message ?? e) };
  }
});

When("the consumer fetches the local origin allowing insecure transport with at most {int} objects", async function (n) {
  try {
    this.fetchResult = await consumer.fetchSustainability(this.base, { allowInsecure: true, timeoutMs: 3_000, maxObjects: n });
  } catch (e) {
    this.fetchResult = { status: "threw", error: String(e.message ?? e) };
  }
});

Then("the fetch status is {string}", function (status) {
  assert.equal(this.fetchResult.status, status, JSON.stringify(this.fetchResult).slice(0, 300));
});

Then("the fetch did not succeed", function () {
  assert.notEqual(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
});

Then("the fetch outcome mentions {string}", function (text) {
  const all = JSON.stringify(this.fetchResult);
  assert.ok(all.includes(text), `outcome ${all.slice(0, 300)} does not mention "${text}"`);
});

Then("the declaration is attributed to the second origin", function () {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  assert.ok(this.fetchResult.url.startsWith(this.secondBase), this.fetchResult.url);
});

Then("the fetched media type class is {string}", function (cls) {
  assert.equal(this.fetchResult.mediaType ?? this.fetchResult.mediaTypeClass, cls, JSON.stringify(this.fetchResult).slice(0, 300));
});

Then("the consumer refuses the address {string}", function (addr) {
  assert.equal(consumer.isBlockedAddress(addr), true, `${addr} not blocked`);
});

Then("the consumer allows the address {string}", function (addr) {
  assert.equal(consumer.isBlockedAddress(addr), false, `${addr} blocked`);
});

// ---- upstream chains, served from an in-memory map through fetchImpl ----------

function mapFetch(map, log) {
  return async (input) => {
    const url = typeof input === "string" ? input : input.url;
    log.push(url);
    const doc = map.get(url);
    if (!doc) return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify(doc), { status: 200, headers: { "Content-Type": MEDIA_TYPE } });
  };
}

Given("a subject declaration whose upstream chain is {int} declarations deep", function (depth) {
  this.map = new Map();
  this.log = [];
  const uri = (i) => `https://provider${i}.example${WELL_KNOWN}`;
  // Each upstream declaration is tenant-scoped: it states what that provider
  // delivers to the subject, which is the only shape the draft makes comparable.
  for (let i = depth; i >= 1; i--) {
    const d = baseDeclaration({ target: "tenant.example", "target-type": "tenant", "energy-consumption": 100 * i });
    if (i < depth) d.upstream = [{ declaration: uri(i + 1), role: "hosting" }];
    this.map.set(uri(i), d);
  }
  // The subject reports at least what its providers say they delivered: consistent.
  this.doc = baseDeclaration({ target: "tenant.example", "target-type": "tenant", "energy-consumption": 5000 });
  this.doc.upstream = [{ declaration: uri(1), role: "hosting" }];
});

Given("a subject declaration whose upstream chain loops back on itself", function () {
  this.map = new Map();
  this.log = [];
  const a = `https://a.example${WELL_KNOWN}`;
  const b = `https://b.example${WELL_KNOWN}`;
  this.map.set(a, { ...baseDeclaration({ target: "tenant.example", "target-type": "tenant" }), upstream: [{ declaration: b }] });
  this.map.set(b, { ...baseDeclaration({ target: "tenant.example", "target-type": "tenant" }), upstream: [{ declaration: a }] });
  this.doc = { ...baseDeclaration({ target: "tenant.example", "target-type": "tenant" }), upstream: [{ declaration: a }] };
});

Given("the upstream declaration says it delivered more energy than the subject reports", function () {
  const first = `https://provider1.example${WELL_KNOWN}`;
  this.map.get(first)["energy-consumption"] = 999_999;
});

/** Nested comparisons hang off `upstream`; flatten the tree for the assertions. */
function flat(list, out = []) {
  for (const c of list ?? []) {
    out.push(c);
    flat(c.upstream, out);
  }
  return out;
}

When("the consumer walks the upstream chain", async function () {
  this.comparisons = await consumer.compareUpstream(this.doc, walkOptions({ fetchImpl: mapFetch(this.map, this.log) }));
});

Then("at most {int} upstream declarations were retrieved", function (n) {
  assert.ok(this.log.length <= n, `retrieved ${this.log.length}: ${this.log.join(", ")}`);
});

Then("no upstream URI was retrieved twice", function () {
  assert.equal(new Set(this.log).size, this.log.length, this.log.join(", "));
});

Then("the deepest retrieved comparison has depth {int}", function (n) {
  // Entries below the limit are listed from the last retrieved declaration's
  // upstream member, never fetched: they carry no verdict about figures.
  const all = flat(this.comparisons);
  const retrieved = all.filter((c) => c.verdict !== "unreachable");
  const max = Math.max(...retrieved.map((c) => c.depth));
  assert.equal(max, n, JSON.stringify(all.map((c) => [c.declaration, c.depth, c.verdict])));
  for (const c of all.filter((c) => c.depth > n)) assert.equal(c.verdict, "unreachable", JSON.stringify(c));
});

Then("a comparison verdict is {string}", function (v) {
  const all = flat(this.comparisons);
  assert.ok(all.some((c) => c.verdict === v), JSON.stringify(all.map((c) => [c.declaration, c.verdict, c.detail])));
});

Then("every comparison names the reporting-period it compared", function () {
  for (const c of flat(this.comparisons).filter((c) => c.verdict !== "unreachable" && c.verdict !== undefined)) assert.ok(c.reportingPeriod, JSON.stringify(c));
});

// ---- extensions and names ------------------------------------------------------

Then("the extension name {string} is accepted", function (name) {
  assert.equal(consumer.isExtensionName(name), true, consumer.extensionNameError?.(name));
});

Then("the extension name {string} is rejected", function (name) {
  assert.equal(consumer.isExtensionName(name), false);
});

// ---- internationalization ------------------------------------------------------

Then("the provider text is isolated for display", function () {
  const shown = consumer.isolate(this.doc.provider);
  assert.ok(shown.startsWith("⁨") && shown.endsWith("⁩"), JSON.stringify(shown));
  assert.ok(shown.includes(this.doc.provider));
});

Then("the target compares octet-for-octet", function () {
  // Two targets that differ only in Unicode normalization are different subjects.
  const nfc = "café.example";
  const nfd = "café.example";
  assert.notEqual(nfc, nfd);
  const a = consumer.validateDocument(baseDeclaration({ target: nfc, "target-type": "organization" }));
  const b = consumer.validateDocument(baseDeclaration({ target: nfd, "target-type": "organization" }));
  assert.equal(a.valid && b.valid, true);
});


// ---- what the consumer asked for versus what it received (draft: compare and never record what was not named) ----

When("the consumer fetches the local origin asking for period {string} at granularity {string}", async function (period, granularity) {
  this.fetchResult = await consumer.fetchSustainability(this.base, { allowInsecure: true, timeoutMs: 3_000, period, granularity });
});

When("the consumer fetches the local origin asking for target {string}", async function (target) {
  this.fetchResult = await consumer.fetchSustainability(this.base, { allowInsecure: true, timeoutMs: 3_000, target });
});

Then("the fetch reports that the {word} was not as requested", function (what) {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  const notes = this.fetchResult.notAsRequested ?? [];
  assert.ok(notes.some((n) => String(n).startsWith(`${what}:`)), `notAsRequested: ${JSON.stringify(notes)}`);
});

Then("the fetch reports nothing as not requested", function () {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  assert.deepEqual(this.fetchResult.notAsRequested ?? [], []);
});

Then("the fetched target is byte-identical to the served text and differs from its normalized form", function () {
  assert.equal(this.fetchResult.status, "ok");
  const d = this.fetchResult.document;
  const target = (Array.isArray(d) ? d[0] : d).target;
  assert.equal(target, "cafe\u0301.example", "the consumer must not normalize target");
  assert.notEqual(target, target.normalize("NFC"));
  const nfc = { ...(Array.isArray(d) ? d[0] : d), target: target.normalize("NFC") };
  assert.ok(consumer.differingMembers(Array.isArray(d) ? d[0] : d, nfc).includes("target"));
});
