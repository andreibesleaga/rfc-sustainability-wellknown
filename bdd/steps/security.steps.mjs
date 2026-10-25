/**
 * Steps of the signing and the security and privacy features: what the publisher signs, how the consumer verifies it
 * and with which key it trusts it, the addresses, redirects, sizes and times the consumer bounds, the walk through
 * upstream declarations, attestations, extensions, and the privacy safeguards of the publisher.
 *
 * The phrases of this file are exactly those assigned to the security step owner. Where a phrase of the list is only
 * an outline row of another phrase (a key obtained "out of band", a header "with jku ..."), one step answers the
 * whole family, so that no phrase is defined twice. Everything runs against the built code and loopback servers;
 * the fixed clock is the one of the World.
 *
 * A step that needs a field the World does not have keeps it in `world.security` (see `state`).
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { After, Before, Given, Then, When } from "@cucumber/cucumber";
import {
  MEDIA_TYPE,
  ROOT,
  WELL_KNOWN,
  baseDeclaration,
  consumer,
  deletePath,
  decodeEscapes,
  flatComparisons,
  getPath,
  jose,
  periodFromText,
  publisher,
  rawJws,
  rawMetrics,
  sameInstant,
  setPath,
  coerce,
  withoutSigned,
} from "./world.mjs";
import { fixture, issueCertificate, x5cOf } from "./security.certificates.mjs";

const requireHere = createRequire(import.meta.url);

// ---- state and helpers ---------------------------------------------------------------------------------------------

/** The fields of these steps on the World, created on first use. */
function state(world) {
  world.security ??= { tls: undefined, dayFloor: undefined, heldPeriods: [], handlers: undefined, handlerCalls: [], resolver: undefined, redirect: undefined, expectSigned: undefined };
  return world.security;
}

/** The single object the next step is about. */
function oneObject(world) {
  const objects = world.subjectObjects();
  assert.equal(objects.length, 1, `the step is about one object, the subject holds ${objects.length}`);
  return objects[0];
}

const unquote = (text) => (/^".*"$/.test(text) ? JSON.parse(text) : text);

/** Make a server that closes its open connections when it is closed, so that a slow response never holds a scenario. */
function closing(server) {
  const close = server.close.bind(server);
  server.close = (done) => {
    server.closeAllConnections?.();
    return close(done);
  };
  return server;
}

/** A plain http server on a free loopback port; sets and returns the origin under test. */
async function listen(world, handler) {
  world.base = await world.listen(closing(createServer(handler)));
  return world.base;
}

const ok = (res, body, headers = {}) => {
  res.writeHead(200, { "Content-Type": MEDIA_TYPE, "X-Content-Type-Options": "nosniff", ...headers });
  res.end(body);
};

/** The result of a fetch that must not throw, as the World's fetchLocal does it. */
async function fetching(world, origin, options) {
  world.lastOrigin = origin;
  try {
    world.fetchResult = await consumer.fetchSustainability(origin, options);
  } catch (e) {
    world.fetchResult = { status: "threw", error: String(e.message ?? e) };
  }
  if (world.fetchResult.status === "ok") world.lastSet = "fetch";
  return world.fetchResult;
}

// ---- signing: keys and the signed member ------------------------------------------------------------------------------

/** The key of the World that made the signed member of `object`, found by the key in its header. */
function keyOfSigned(world, object) {
  const header = signedHeaderOf(object);
  const x = header.jwk?.x;
  for (const key of world.keys.values()) if (publisher.embeddedJwk(key).x === x) return key;
  throw new Error("the signed member was not made with a key of this scenario");
}

function signedHeaderOf(object) {
  return JSON.parse(Buffer.from(object.signed.split(".")[0], "base64url").toString("utf8"));
}

/** The payload text a signed member carries (the object as the publisher serialised it, without signed). */
const payloadTextOf = (object) => publisher.decodeSignedPayload(object.signed);

/**
 * A JWS Compact Serialization with a header of the caller's own, signed with the key as the key's own algorithm.
 * The header is not checked, so an algorithm that does not fit the key, a crit the signer does not know, or a
 * missing jwk can be made.
 */
async function manualJws(header, payloadText, key) {
  const part = (text) => Buffer.from(text).toString("base64url");
  const signingInput = `${part(JSON.stringify(header))}.${part(payloadText)}`;
  const algorithm = key.alg === "ES256" ? { name: "ECDSA", hash: "SHA-256" } : { name: "Ed25519" };
  const signature = await globalThis.crypto.subtle.sign(algorithm, key.privateKey, Buffer.from(signingInput));
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

/** Replace the signed member of the subject by one made with the header edited by `edit`, over the payload it already had. */
async function resign(world, edit, { key, payloadText } = {}) {
  const object = oneObject(world);
  const signer = key ?? keyOfSigned(world, object);
  const payload = payloadText ?? payloadTextOf(object);
  const header = { alg: signer.alg, cty: publisher.SIGNED_CTY, jwk: publisher.embeddedJwk(signer) };
  const signed = await manualJws(edit(header), payload, signer);
  world.mutateDoc((d) => (d.signed = signed));
}

/** Sign the subject with a key of a given type: OKP is Ed25519, EC is P-256. */
async function keyOfType(world, type, name) {
  const alg = { OKP: "Ed25519", EC: "ES256" }[type];
  assert.ok(alg, `no key of type ${type}`);
  return world.namedKey(name ?? `default-${alg}`, alg);
}

Given("the object is signed with Ed25519 by key {string}", async function (name) {
  this.ensureDoc();
  const key = await this.namedKey(name, "Ed25519");
  this.setDoc(await this.signObject(withoutSigned(oneObject(this)), key));
});

Given("the object is signed with EdDSA by key {string}", async function (name) {
  this.ensureDoc();
  const key = await this.namedKey(name, "Ed25519");
  this.setDoc(await this.signObject(withoutSigned(oneObject(this)), key, { alg: "EdDSA" }));
});

// The same object, signed again under the name the older revision gave the algorithm. The first signature is kept in state.
Given("the same object is signed with EdDSA by key {string}", async function (name) {
  const first = oneObject(this);
  const key = await this.namedKey(name, "Ed25519");
  const second = await this.signObject(withoutSigned(first), key, { alg: "EdDSA" });
  this.security = { ...state(this), pair: [first, second] };
});

Then("the two keys have the same thumbprint", async function () {
  const [a, b] = state(this).pair.map((o) => signedHeaderOf(o).jwk);
  assert.equal(await jose.calculateJwkThumbprint(a), await jose.calculateJwkThumbprint(b));
});

Then("both signatures verify", async function () {
  for (const object of state(this).pair) {
    const outcome = await consumer.verifyEmbeddedSignature(object);
    assert.equal(outcome.result.status, "verified", JSON.stringify(outcome.result));
  }
});

Given(/^the object is signed with (\S+) by a key of type "([^"]*)"$/, async function (alg, type) {
  this.ensureDoc();
  const key = await keyOfType(this, type);
  assert.equal(alg, key.alg, `a key of type ${type} signs with ${key.alg}, not ${alg}`);
  this.setDoc(await this.signObject(withoutSigned(oneObject(this)), key));
});

// The signature is made over a header that names another algorithm than the key takes.
Given("the header says alg {string}", async function (alg) {
  await resign(this, (header) => ({ ...header, alg }));
});

Given("the key {string} is pinned from an earlier retrieval", async function (name) {
  const key = await this.namedKey(name);
  this.policy.pinnedKeys = [...(this.policy.pinnedKeys ?? []), { ...publisher.embeddedJwk(key) }];
});

// Every way a key reaches the consumer (draft, Verifying a Signature): the strongest the caller can hold, or what travels in the object.
Given(/^the key was obtained (.+)$/, async function (how) {
  this.ensureDoc();
  const object = oneObject(this);
  const name = /^from an x5c chain/.test(how) ? undefined : keyNameOf(this, object);
  if (how === "out of band") {
    this.policy.trustedKeys = [{ ...publisher.embeddedJwk(await this.namedKey(name)) }];
  } else if (how === "pinned from an earlier retrieval") {
    this.policy.pinnedKeys = [{ ...publisher.embeddedJwk(await this.namedKey(name)) }];
  } else if (how === "from the header jwk") {
    // nothing is held: the key travels in the header
  } else if (/^from an x5c chain/.test(how)) {
    await obtainThroughChain(this, how);
  } else {
    assert.fail(`no way to obtain a key ${how}`);
  }
});

/** The name of the key that signed the subject: the one the World holds under the key in its header. */
function keyNameOf(world, object) {
  const x = object.signed ? signedHeaderOf(object).jwk?.x : undefined;
  for (const [name, key] of world.keys) if (publisher.embeddedJwk(key).x === x) return name;
  return "default-Ed25519";
}

Given("the key {string} was obtained out of band", async function (name) {
  const key = await this.namedKey(name);
  this.policy.trustedKeys = [...(this.policy.trustedKeys ?? []), { ...publisher.embeddedJwk(key), kid: name }];
});

/**
 * Sign the subject's own payload again with a certificate chain in the header, and set the policy the way the
 * phrase describes: the anchors the consumer trusts, and the host the declaration is said to be retrieved from.
 */
async function obtainThroughChain(world, how) {
  const publisherHost = "example.com";
  const existing = oneObject(world).signed ? signedHeaderOf(oneObject(world)) : undefined;
  let leaf = state(world).leaf;
  if (!existing?.x5c) {
    const naming = /another host/.test(how) ? "other.example" : publisherHost;
    const dir = world.tempDir("certificates");
    leaf = await issueCertificate(dir, naming, /self-signed/.test(how) ? "self" : "ca");
    world.keys.set(`certificate-${naming}`, leaf.key);
    state(world).leaf = leaf;
    await signWithChain(world, leaf);
  }
  world.policy.host = publisherHost;
  world.policy.now = world.now;
  world.policy.trustAnchors = /unknown anchor/.test(how) ? [fixture("other-ca.pem")] : [fixture("ca.pem")];
}

async function signWithChain(world, leaf) {
  const object = oneObject(world);
  const payloadText = object.signed ? payloadTextOf(object) : JSON.stringify(withoutSigned(object));
  const header = { alg: leaf.key.alg, cty: publisher.SIGNED_CTY, x5c: [x5cOf(leaf.certificate)] };
  const signed = await manualJws(header, payloadText, leaf.key);
  world.mutateDoc((d) => (d.signed = signed));
}

Given("the object is signed with Ed25519 and the certificate subject is {string}", async function (host) {
  this.ensureDoc();
  const dir = this.tempDir("certificates");
  const leaf = await issueCertificate(dir, host, "ca");
  this.keys.set(`certificate-${host}`, leaf.key);
  state(this).leaf = leaf;
  await signWithChain(this, leaf);
});

// A header that names the key by an identifier or a URL and carries no key: kid, jku, x5u.
Given(/^the object is signed with Ed25519 and a header with (\S+) "([^"]*)" and no jwk and no x5c$/, async function (parameter, value) {
  this.ensureDoc();
  const key = await this.namedKey(parameter === "kid" ? value : "default-Ed25519");
  const payloadText = JSON.stringify(withoutSigned(oneObject(this)));
  const signed = await manualJws({ alg: key.alg, cty: publisher.SIGNED_CTY, [parameter]: value }, payloadText, key);
  this.mutateDoc((d) => (d.signed = signed));
});

Given(/^the signed member's cty is (.+)$/, async function (text) {
  const cty = text === "absent" ? undefined : unquote(text);
  await resign(this, ({ cty: _cty, ...rest }) => ({ ...rest, ...(cty === undefined ? {} : { cty }) }));
});

Given(/^the signed member's header carries crit (.+)$/, async function (text) {
  await resign(this, (header) => ({ ...header, crit: JSON.parse(text) }));
});

Given("the signed member is {string}", function (text) {
  this.ensureDoc();
  this.mutateDoc((d) => (d.signed = decodeEscapes(text)));
});

// A JWS of a kind the publisher refuses to make: no signature at all, or a MAC.
Given("the signed member is a JWS with alg {string}", async function (alg) {
  this.ensureDoc();
  const key = await this.namedKey("default-Ed25519");
  const signed = await rawJws({ alg, payload: withoutSigned(oneObject(this)), key, secret: new TextEncoder().encode("a-shared-secret-of-thirty-two-bytes") });
  this.mutateDoc((d) => (d.signed = signed));
});

Given("the signed member is an HS256 JWS keyed with the bytes of the public key in its header jwk", async function () {
  this.ensureDoc();
  const key = await this.namedKey("default-Ed25519");
  const jwk = publisher.embeddedJwk(key);
  const signed = await rawJws({ alg: "HS256", payload: withoutSigned(oneObject(this)), secret: Buffer.from(jwk.x, "base64url"), header: { jwk } });
  this.mutateDoc((d) => (d.signed = signed));
});

Given(/^the signed member is a valid Ed25519 JWS whose payload is (.+)$/, async function (payload) {
  this.ensureDoc();
  const key = await this.namedKey("default-Ed25519");
  const text = payload === "the empty octets" ? "" : payload;
  const signed = await manualJws({ alg: "Ed25519", cty: publisher.SIGNED_CTY, jwk: publisher.embeddedJwk(key) }, text, key);
  this.mutateDoc((d) => (d.signed = signed));
});

Given("the signed member is removed", function () {
  this.ensureDoc();
  this.mutateDoc((d) => deletePath(d, "signed"));
});

Given("the signed member is removed from the second object", function () {
  const objects = this.subjectObjects();
  delete objects[1].signed;
});

Given("the signed member of the first object is copied to the second", function () {
  const objects = this.subjectObjects();
  objects[1].signed = objects[0].signed;
});

Given("the two objects are swapped in the array", function () {
  this.setDoc([...this.subjectObjects()].reverse());
});

Given("every object of the array is signed with Ed25519", async function () {
  const key = await this.namedKey("default-Ed25519");
  const signed = [];
  for (const object of this.subjectObjects()) signed.push(await this.signObject(withoutSigned(object), key));
  this.setDoc(signed);
});

Given("the last octet of the signature is flipped", function () {
  const [header, payload, signature] = oneObject(this).signed.split(".");
  const bytes = Buffer.from(signature, "base64url");
  bytes[bytes.length - 1] ^= 0x01;
  this.mutateDoc((d) => (d.signed = `${header}.${payload}.${bytes.toString("base64url")}`));
});

Given("after signing, the member {string} is added to the served object as {string}", function (member, text) {
  this.mutateDoc((d) => setPath(d, member, coerce(member, text)));
});

Given("the object's served {string} is rewritten to the same instant as {string}", function (member, spelling) {
  const before = getPath(oneObject(this), member);
  assert.ok(sameInstant(before, spelling), `${spelling} is not the instant ${before}`);
  this.mutateDoc((d) => setPath(d, member, spelling));
});

Given("the object has the member {string} {string}", function (member, text) {
  this.ensureDoc();
  this.mutateDoc((d) => setPath(d, member, coerce(member, text)));
});

When("the consumer decodes the signed member", function () {
  state(this).decoded = payloadTextOf(oneObject(this));
});

Then("the decoded payload is the JSON text of the object without the member {string}", function (member) {
  const object = oneObject(this);
  const { [member]: _removed, ...rest } = object;
  assert.equal(state(this).decoded, JSON.stringify(rest));
});

When("the consumer expects every object signed", async function () {
  const served = this.subject();
  const origin = await this.serveText(JSON.stringify(served));
  state(this).expectSigned = await fetching(this, origin, { allowInsecure: true, timeoutMs: 5_000, requireSigned: true });
});

Then("the policy passes", function () {
  assert.equal(state(this).expectSigned.status, "ok", JSON.stringify(state(this).expectSigned).slice(0, 400));
});

Then("the array is reported as having an unsigned object", function () {
  const outcome = state(this).expectSigned;
  assert.equal(outcome.status, "signature-required", JSON.stringify(outcome).slice(0, 400));
  assert.ok(outcome.failures.some((f) => f.status === "unsigned"), JSON.stringify(outcome.failures));
});

Then("the failure names the object {int}", function (n) {
  const outcome = state(this).expectSigned;
  assert.ok(outcome.failures.some((f) => f.object === n), JSON.stringify(outcome.failures));
});

Then("the first object's signature status is {string}", function (status) {
  assert.equal(this.sigs[0]?.status, status, JSON.stringify(this.sigs));
});

Then("the second object's signature status is {string}", function (status) {
  assert.equal(this.sigs[1]?.status, status, JSON.stringify(this.sigs));
});

Then("the reported algorithm is {string}", function (alg) {
  assert.equal(this.sig.alg, alg, JSON.stringify(this.sig));
});

Then("the key trust level is not {string}", function (level) {
  assert.notEqual(this.sig.keyTrust, level, JSON.stringify(this.sig));
});

Then("the signature note does not mention {string}", function (text) {
  assert.ok(!this.sigNotes.join("\n").includes(text), `a note mentions "${text}": ${JSON.stringify(this.sigNotes)}`);
});

/**
 * The signature of the first upstream declaration, checked as any retrieved declaration is: the declaration is served
 * from a loopback server and fetched with the signature verification on. (The walk compares figures; it reports no signature.)
 */
async function upstreamVerification(world) {
  const sec = state(world);
  if (!sec.upstreamVerified) {
    const origin = await world.serveText(JSON.stringify(world.upstream.docs.get(world.chainUri(1))));
    const result = await consumer.fetchSustainability(origin, { allowInsecure: true, timeoutMs: 5_000, verifySignature: true });
    assert.equal(result.status, "ok", JSON.stringify(result).slice(0, 300));
    sec.upstreamVerified = result;
  }
  return sec.upstreamVerified;
}

Then("the upstream signature status is {string}", async function (status) {
  const { signatures } = await upstreamVerification(this);
  assert.equal(signatures[0].status, status, JSON.stringify(signatures[0]));
});

Then("the upstream signature note mentions {string}", async function (text) {
  const { warnings = [] } = await upstreamVerification(this);
  assert.ok(warnings.join("\n").includes(text), JSON.stringify(warnings));
});

Given("the upstream declaration is signed with EdDSA", async function () {
  const uri = this.chainUri(1);
  const key = await this.namedKey("upstream", "Ed25519");
  this.upstream.docs.set(uri, await this.signObject(withoutSigned(this.upstream.docs.get(uri)), key, { alg: "EdDSA" }));
});

Then("the signature header carries the public key as jwk", function () {
  const { jwk } = signedHeaderOf(oneObject(this));
  assert.ok(jwk && jwk.kty && jwk.crv && jwk.x, `the header carries no public key: ${JSON.stringify(jwk)}`);
});

Then("the signature header carries no private key member", function () {
  const { jwk } = signedHeaderOf(oneObject(this));
  for (const member of ["d", "p", "q", "dp", "dq", "qi", "oth", "k"]) assert.ok(!(member in jwk), `the header jwk has the member ${member}`);
});

Then("the verified payload carries no signed member", function () {
  assert.equal(this.sig.status, "verified", JSON.stringify(this.sig));
  const payload = JSON.parse(payloadTextOf(oneObject(this)));
  assert.ok(!("signed" in payload));
});

Then("the verified result does not claim the provider name belongs to the key holder", function () {
  assert.equal(this.sig.status, "verified", JSON.stringify(this.sig));
  const claimed = JSON.stringify(this.sig).toLowerCase();
  assert.ok(!claimed.includes(String(oneObject(this).provider).toLowerCase()), "the verification result names the provider");
  assert.ok(!("provider" in this.sig), "the verification result carries a provider");
});

Then("the signed object is not reported as false or forged", function () {
  for (const outcome of this.sigs.length > 0 ? this.sigs : [this.sig].filter(Boolean)) {
    assert.ok(["unsigned", "unverified", "verified"].includes(outcome.status), JSON.stringify(outcome));
    assert.doesNotMatch(JSON.stringify(outcome), /forged|fraud|tamper/i);
  }
});

Then("the object is not reported as {string}", function (code) {
  assert.equal(code, "replay-suspected");
  assert.equal(this.sig.replaySuspected, undefined, JSON.stringify(this.sig));
});

Then("the member {string} is reported as modified", function (member) {
  assert.ok((this.sig.modifiedMembers ?? []).includes(member), JSON.stringify(this.sig));
});

Then("the consumer does not claim the order of the array was signed", async function () {
  const { stderr } = await this.presentation();
  assert.match(stderr, /not the array around it/);
  assert.doesNotMatch(stderr, /array is signed|order of the array/i);
});

Then("the presentation says the signature protects the other members of its own object", async function () {
  const { stderr } = await this.presentation();
  assert.match(stderr, /signed the other members of this object only/);
});

Then("the presentation says the figures are claims of {string}", async function (label) {
  const { stderr } = await this.presentation();
  assert.ok(stderr.includes(`claim of ${claimantOf(this, label)}`), stderr);
});

Then("the presentation does not say the figures are claims of {string}", async function (label) {
  const { stderr } = await this.presentation();
  assert.ok(!stderr.includes(`claim of ${claimantOf(this, label)}`), stderr);
});

Then("the claimant is the requested origin", function () {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  assert.equal(new URL(this.fetchResult.url).origin, new URL(this.base).origin);
});

Then("the claimant is {string}", function (host) {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  assert.equal(new URL(this.fetchResult.url).host, host);
});

// ---- the publisher signs --------------------------------------------------------------------------------------------

When("the publisher is asked to generate a signing key for {string}", async function (alg) {
  let error;
  try {
    await publisher.generateSigningKey(alg);
  } catch (e) {
    error = e;
  }
  // The shared steps read the refusal from the build; this build is the refusal.
  this.buildPromise = Promise.resolve({ objects: [], warnings: [], error });
});

When("the publisher rebuilds the object with {string} {int}", async function (member, number) {
  const key = await this.namedKey("publisher");
  const raw = this.rawFromDocument();
  if (member === "energy-consumption") raw.energy = { ...raw.energy, value: number };
  else assert.fail(`no way to rebuild the object with ${member}`);
  this.input = raw;
  this.publisher = undefined;
  this.adapter = undefined;
  this.publisherConfig = { ...this.publisherConfig, signing: { key } };
  this.invalidateBuild();
  const { objects, error } = await this.built();
  if (error) throw error;
  state(this).rebuilt = objects[0];
});

Then("the rebuilt object's signed payload has {string} {int}", function (member, number) {
  const payload = JSON.parse(payloadTextOf(state(this).rebuilt));
  assert.equal(payload[member], number);
});

Then("the rebuilt object verifies", async function () {
  const outcome = await consumer.verifyEmbeddedSignature(state(this).rebuilt);
  assert.equal(outcome.result.status, "verified", JSON.stringify(outcome.result));
});

/** Every member name that appears in a value, at any depth. */
function memberNames(value, names = new Set()) {
  if (Array.isArray(value)) for (const v of value) memberNames(v, names);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) memberNames(v, names.add(k));
  return names;
}

/** Everything published about an object: its members, the header of its signed member and the payload it carries. */
function publishedMembers(world) {
  const object = oneObject(world);
  const names = memberNames(object);
  for (const name of memberNames(signedHeaderOf(object))) names.add(name);
  for (const name of memberNames(JSON.parse(payloadTextOf(object)))) names.add(name);
  for (const name of memberNames(signedHeaderOf(object).jwk ?? {})) names.add(name);
  return names;
}

Then("the published text contains no member {string}", function (member) {
  assert.ok(!publishedMembers(this).has(member), `the published text has a member ${member}`);
});

Then(/^the published text contains no member "([^"]*)", "([^"]*)", "([^"]*)", "([^"]*)" or "([^"]*)"$/, function (a, b, c, d, e) {
  const names = publishedMembers(this);
  for (const member of [a, b, c, d, e]) assert.ok(!names.has(member), `the published text has a member ${member}`);
});

// ---- the wording test ------------------------------------------------------------------------------------------------

/** What a signature covers (draft, The signed Member): the other members of its own object, and nothing around it. */
const NOT_COVERED = [
  { phrase: "HTTP header fields", pattern: /\b(http )?header fields?\b[^.]*\b(signed|covered|protected)\b|\b(signed|covered|protected)\b[^.]*\bheader fields?\b/i },
  { phrase: "retrieval URI", pattern: /\bretrieval uri\b[^.]*\b(signed|covered|protected)\b|\b(signed|covered|protected)\b[^.]*\bretrieval uri\b/i },
  { phrase: "array", pattern: /\b(whole|entire) array\b[^.]*\b(signed|covered|protected)\b|\barray\b[^.]*\bis (signed|covered|protected)\b/i },
];

When("the signature wording test runs", function () {
  const text = this.publishedText;
  const found = NOT_COVERED.filter(({ pattern }) => pattern.test(text));
  this.check = { passed: found.length === 0, message: found.map(({ phrase }) => `the text says a signature covers the ${phrase}`).join("; ") };
});

// ---- transport: addresses, redirects, bounds -----------------------------------------------------------------------

Then("the consumer refuses the address {string}", function (address) {
  assert.equal(consumer.isBlockedAddress(address), true, `${address} is not refused`);
});

Then("the consumer allows the address {string}", function (address) {
  assert.equal(consumer.isBlockedAddress(address), false, `${address} is refused`);
});

Then("no connection is made", function () {
  assert.deepEqual(this.connections, [], `connections: ${this.connections.join(", ")}`);
  const stray = this.requests.filter((r) => !r.url.startsWith(WELL_KNOWN));
  assert.deepEqual(stray, [], `the server was asked for ${stray.map((r) => r.url).join(", ")}`);
  assert.ok(this.requests.length <= 1, `the server received ${this.requests.length} requests`);
});

Then("no data was read from {string}", function (address) {
  const sec = state(this);
  assert.notEqual(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  assert.ok(!sec.readFrom.includes(address), `data was read from ${address}`);
  assert.ok(sec.refusals.length > 0, "the connection was not refused by the transport");
});

Then("the connection is to {string}", function (uri) {
  const asked = this.upstream.log.map((u) => new URL(u).toString());
  assert.ok(asked.includes(new URL(uri).toString()), `asked for: ${asked.join(", ")}`);
});

Given("the host {string} resolves to {string} when checked and to {string} when connected", function (host, _checked, connected) {
  routeThroughRealTransport(this, host, [connected]);
});

Given("the host {string} resolves to {string} and {string}", function (host, a, b) {
  routeThroughRealTransport(this, host, [a, b]);
});

/**
 * Make the fetch stand-in of the World a request through the consumer's own transport, with a resolver that gives
 * `addresses` for `host`. The consumer asks the resolver once per connection, at connect time, and uses what it was
 * told: the address checked is the address connected, so the first answer is the only one.
 */
function routeThroughRealTransport(world, host, addresses) {
  const sec = state(world);
  const lookup = async (name) => {
    sec.looked.push(name);
    assert.equal(name, host, `the resolver was asked about ${name}`);
    return addresses;
  };
  viaConsumerTransport(world, lookup, addresses);
}

/** The fetch stand-in of the World as a request through the consumer's own transport; `lookup` is its resolver (the system's when absent). */
function viaConsumerTransport(world, lookup, addresses = []) {
  const sec = state(world);
  sec.refusals = [];
  sec.looked = [];
  sec.readFrom = [];
  world.recorder = async (input) => {
    const got = await consumer.secureGet(new URL(typeof input === "string" ? input : input.url), { timeoutMs: 3_000, lookup });
    if (!got.ok) {
      sec.refusals.push(got.refusal);
      throw new Error(got.refusal.detail ?? got.refusal.reason);
    }
    sec.readFrom.push(...addresses);
    return got.res;
  };
}

// A host name is judged by the addresses it resolves to, which only the consumer's own transport does: in the
// scenarios about addresses the stand-in of the World is that transport, with the resolver of the system.
Before({ tags: "@REQ-SEC-12" }, function () {
  viaConsumerTransport(this, undefined);
});

When("the consumer fetches the origin", async function () {
  await fetching(this, "https://public.example", { timeoutMs: 3_000, fetchImpl: this.recorder });
});

// A "public" origin, reached through a stand-in that answers from two real loopback servers: the first redirects, the second serves.
Given(/^a public origin that redirects the well-known path with status (\d+) to "([^"]*)"$/, async function (status, target) {
  const sec = state(this);
  const second = closing(createServer((req, res) => ok(res, JSON.stringify(baseDeclaration()))));
  const secondOrigin = await this.listen(second);
  const redirecting = closing(
    createServer((req, res) => {
      res.writeHead(Number(status), { Location: `${secondOrigin}${WELL_KNOWN}` });
      res.end();
    }),
  );
  const firstOrigin = await this.listen(redirecting);
  const targetHost = new URL(target).host;
  sec.redirect = { aliases: { "first.example": firstOrigin, "public.example": firstOrigin, [targetHost]: secondOrigin }, target, secondOrigin };
  this.lastOrigin = firstOrigin;
  this.recorder = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    this.connections.push(url);
    const u = new URL(url);
    const real = sec.redirect.aliases[u.host];
    if (!real) return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
    const res = await fetch(`${real}${u.pathname}${u.search}`, { redirect: "manual" });
    const headers = new Headers(res.headers);
    if (headers.has("location")) headers.set("location", target);
    return new Response([301, 302, 303, 307, 308].includes(res.status) ? null : await res.arrayBuffer(), { status: res.status, headers });
  };
});

/** The origin a label of a redirect scenario stands for: the real server that plays the host. */
function claimantOf(world, label) {
  const origin = state(world).redirect?.aliases[label] ?? (label === "first.example" ? world.lastOrigin : undefined);
  assert.ok(origin, `no server plays ${label}`);
  return origin;
}

Given("a local server that redirects the well-known path in a loop", async function () {
  await listen(this, (req, res) => {
    res.writeHead(302, { Location: WELL_KNOWN });
    res.end();
  });
});

Given("a local server that redirects the well-known path through {int} distinct URLs", async function (count) {
  await listen(this, (req, res) => {
    const hop = Number(/^\/hop\/(\d+)$/.exec(req.url)?.[1] ?? 0);
    if (hop >= count) return ok(res, JSON.stringify(baseDeclaration()));
    res.writeHead(302, { Location: `/hop/${hop + 1}` });
    res.end();
  });
});

Given("a local server that sends one byte per second", async function () {
  await listen(this, (req, res) => {
    res.writeHead(200, { "Content-Type": MEDIA_TYPE });
    res.flushHeaders();
    const timer = setInterval(() => res.write(" "), 1_000);
    res.on("close", () => clearInterval(timer));
  });
});

// A gzip body that expands to `expanded` bytes: the zeros are compressed as the program receives them, in blocks.
Given("a local server that sends a gzip body of {int} bytes that expands to {int} bytes", async function (_compressed, expanded) {
  const block = Buffer.alloc(1_000_000);
  const { createGzip } = await import("node:zlib");
  const gzip = createGzip();
  const chunks = [];
  gzip.on("data", (chunk) => chunks.push(chunk));
  const done = new Promise((r) => gzip.on("end", r));
  for (let written = 0; written < expanded; written += block.length) gzip.write(block.subarray(0, Math.min(block.length, expanded - written)));
  gzip.end();
  await done;
  const body = Buffer.concat(chunks);
  state(this).rssBefore = process.memoryUsage().rss;
  await listen(this, (req, res) => {
    res.on("error", () => undefined);
    ok(res, body, { "Content-Encoding": "gzip" });
  });
});

Then("the process did not run out of memory", function () {
  const grown = process.memoryUsage().rss - state(this).rssBefore;
  assert.ok(grown < 300_000_000, `the process grew by ${grown} bytes`);
});

Given("a local server whose declaration body is {int} bytes of JSON", async function (size) {
  const object = baseDeclaration({ extensions: { "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": { padding: "" } } });
  const empty = JSON.stringify(object).length;
  object.extensions["urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845"].padding = "x".repeat(size - empty);
  const body = JSON.stringify(object);
  assert.equal(Buffer.byteLength(body), size);
  await listen(this, (req, res) => ok(res, body));
});

Given(/^a local server whose declaration is an array of (\d+) objects$/, async function (count) {
  const objects = Array.from({ length: Number(count) }, (_, i) =>
    baseDeclaration({ capabilities: "extended", period: periodFromText(`2025-${String(i + 1).padStart(2, "0")}`) }),
  );
  await listen(this, (req, res) => ok(res, JSON.stringify(objects)));
});

/** The generated bodies of the hostile-input scenarios, by the words the feature uses. */
const GENERATED = [
  [/^an array nested (\d+) levels deep$/, (n) => "[".repeat(n) + "]".repeat(n)],
  [/^an object nested (\d+) levels deep$/, (n) => '{"a":'.repeat(n) + "1" + "}".repeat(n)],
  [/^a string of (\d+) characters$/, (n) => `"${"a".repeat(n)}"`],
  [/^an object with (\d+) members$/, (n) => `{${Array.from({ length: n }, (_, i) => `"k${i}":0`).join(",")}}`],
  [/^a number with (\d+) digits$/, (n) => "1".repeat(n)],
];

Given("a local server whose body is the generated text {string}", async function (kind) {
  const [, generate] = GENERATED.find(([pattern]) => pattern.test(kind)) ?? assert.fail(`no generated text called "${kind}"`);
  const body = generate(Number(GENERATED.find(([pattern]) => pattern.test(kind))[0].exec(kind)[1]));
  await listen(this, (req, res) => {
    res.on("error", () => undefined);
    ok(res, body);
  });
});

Then("the consumer process is still running", function () {
  assert.ok(this.fetchResult, "the fetch gave no outcome");
  assert.notEqual(this.fetchResult.status, undefined);
});

When("the consumer fetches the local origin allowing insecure transport with a time limit of {int} seconds", async function (seconds) {
  await this.fetchLocal({}, { timeoutMs: seconds * 1_000 });
});

When("the consumer fetches the local origin allowing insecure transport with at most {int} bytes", async function (bytes) {
  await this.fetchLocal({}, { maxBytes: bytes });
});

When("the consumer fetches the local origin allowing insecure transport with at most {int} objects", async function (objects) {
  await this.fetchLocal({}, { maxObjects: objects });
});

// The consumer follows at most five redirects and has no option to change that: the bound is the one in the code.
When("the consumer fetches the local origin allowing insecure transport with at most {int} redirects", async function (redirects) {
  assert.equal(redirects, 5, "the consumer's bound on redirects is five");
  await this.fetchLocal();
});

// ---- TLS -----------------------------------------------------------------------------------------------------------

/** The test certificates name good.test; the server is reached under that name, resolved to loopback. */
const TLS_HOST = "good.test";

/** Which fixture certificate a phrase of the features asks for. */
function tlsFixtureFor(description) {
  if (/^an expired certificate/.test(description)) return "expired";
  if (/for the host name/.test(description)) return "wrong-host";
  if (/^a self-signed certificate/.test(description)) return "self-signed";
  if (/from an issuer that is not trusted/.test(description)) return "untrusted";
  if (/^a certificate for .* from the trusted test CA$/.test(description)) return "good";
  assert.fail(`no certificate called "${description}"`);
}

Given(/^a local TLS server with (.+)$/, async function (description) {
  const name = tlsFixtureFor(description);
  const served = { count: 0 };
  const server = closing(
    createHttpsServer({ key: fixture(`${name}-key.pem`), cert: fixture(`${name}.pem`) }, (req, res) => {
      served.count++;
      ok(res, JSON.stringify(baseDeclaration()));
    }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  this.servers.push(server);
  state(this).tls = { served, origin: `https://${TLS_HOST}:${server.address().port}` };
});

async function fetchTls(world, extra) {
  const { origin } = state(world).tls;
  await fetching(world, origin, { timeoutMs: 5_000, lookup: async () => ["127.0.0.1"], ca: fixture("ca.pem"), ...extra });
}

When("the consumer fetches the local TLS origin", async function () {
  await fetchTls(this, { allowPrivateAddresses: true });
});

When("the consumer fetches the local TLS origin allowing insecure transport", async function () {
  await fetchTls(this, { allowInsecure: true });
});

Then("no body was read from the server", function () {
  assert.equal(state(this).tls.served.count, 0, "the server answered a request");
});

// The options of a fetch are the members of its option interface in the type declarations the package ships.
When("the options of the consumer's fetch are listed", function () {
  const declarations = ["fetch.d.ts", "types.d.ts"].map((file) => readFileSync(resolve(ROOT, "consumer", "dist", file), "utf8")).join("\n");
  const block = (name) => new RegExp(`interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(declarations)?.[1] ?? "";
  const members = [...(block("FetchOptions") + block("FetchParams")).matchAll(/^\s{4}(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(members.includes("allowInsecure") && members.includes("timeoutMs"), `the listing missed the options: ${members.join(", ")}`);
  state(this).options = members;
});

Then("the consumer options have no member named {string}", function (name) {
  assert.ok(!state(this).options.includes(name), `the options include ${name}`);
});

// ---- the upstream walk ----------------------------------------------------------------------------------------------

const tenant = { target: "tenant.example", "target-type": "tenant" };

/** A depth-1 chain, as the shared step makes it, when no step has made one. */
function ensureChain(world) {
  if (world.upstream.docs.has(world.chainUri(1))) return;
  world.upstream.docs.set(world.chainUri(1), baseDeclaration({ ...tenant, "energy-consumption": 100 }));
  world.setDoc(baseDeclaration({ ...tenant, "energy-consumption": 5000, upstream: [{ declaration: world.chainUri(1), role: "hosting" }] }));
}

const upstreamOf = (world, i = 1) => world.upstream.docs.get(world.chainUri(i));

async function walk(world) {
  world.walkError = undefined;
  try {
    world.comparisons = await consumer.compareUpstream(
      oneObject(world),
      {
        timeoutMs: 5_000,
        maxBytes: 1_000_000,
        maxObjects: 50,
        fetchImpl: world.upstreamFetch(),
        ...(world.retrievedFrom ? { base: new URL(world.retrievedFrom) } : {}),
        ...world.walkOptions,
      },
      world.walkVisited ?? new Set(),
    );
  } catch (e) {
    world.walkError = e;
  }
}

When("the consumer compares the subject with its upstream", async function () {
  await walk(this);
});

When("the consumer walks the upstream chain with at most {int} retrievals", async function (retrievals) {
  this.walkOptions = { ...this.walkOptions, maxRetrievals: retrievals };
  await walk(this);
});

Then(/^the deepest retrieved comparison has depth (\d+)( or less)?$/, function (depth, orLess) {
  const all = flatComparisons(this.comparisons);
  const retrieved = all.filter((c) => c.verdict !== "unreachable");
  const deepest = Math.max(0, ...retrieved.map((c) => c.depth));
  const detail = JSON.stringify(all.map((c) => [c.declaration, c.depth, c.verdict]));
  if (orLess) assert.ok(deepest <= Number(depth), detail);
  else assert.equal(deepest, Number(depth), detail);
});

/** The shapes of upstream chain that break the rule "no URI twice". */
const LOOPS = {
  "loops back on itself": (world) => {
    const [a, b] = [world.chainUri(1), world.chainUri(2)];
    world.upstream.docs.set(a, { ...baseDeclaration(tenant), upstream: [{ declaration: b }] });
    world.upstream.docs.set(b, { ...baseDeclaration(tenant), upstream: [{ declaration: a }] });
    return [a];
  },
  "names the subject itself as its own upstream": (world) => [world.chainUri(0)],
  "has two entries naming the same declaration": (world) => {
    world.upstream.docs.set(world.chainUri(1), baseDeclaration(tenant));
    return [world.chainUri(1), world.chainUri(1)];
  },
  // The subject is one of the three: it names the first, which names the second, which names the subject again.
  "loops through three declarations": (world) => {
    const [a, b] = [world.chainUri(1), world.chainUri(2)];
    world.upstream.docs.set(a, { ...baseDeclaration(tenant), upstream: [{ declaration: b }] });
    world.upstream.docs.set(b, { ...baseDeclaration(tenant), upstream: [{ declaration: world.chainUri(0) }] });
    return [a];
  },
};

Given(/^a subject declaration whose upstream chain (loops back on itself|names the subject itself as its own upstream|has two entries naming the same declaration|loops through three declarations)$/, function (shape) {
  this.upstream = { docs: new Map(), log: [] };
  const entries = LOOPS[shape](this);
  this.walkVisited = new Set([this.chainUri(0)]);
  this.setDoc({ ...baseDeclaration(tenant), upstream: entries.map((declaration) => ({ declaration })) });
});

Then("the members in use are the payload's", function () {
  assert.equal(this.sig.precedence, "payload", JSON.stringify(this.sig));
  const payload = JSON.parse(payloadTextOf(this.subject()));
  assert.ok(consumer.deepEqual(withoutSigned(this.verified.document), payload), "the members in use are not the signed payload's");
});

Then("the walk does not report a conformance failure", function () {
  assert.equal(this.walkError, undefined, String(this.walkError));
  for (const c of flatComparisons(this.comparisons)) assert.ok(["consistent", "under-reported", "not-comparable", "unreachable"].includes(c.verdict), JSON.stringify(c));
});

Then("the walk reports a duplicate", function () {
  const all = flatComparisons(this.comparisons);
  assert.ok(all.some((c) => /already retrieved/.test(c.detail)), JSON.stringify(all.map((c) => [c.declaration, c.detail])));
});

Given("a subject declaration whose second upstream names {string} after the first named {string}", function (second, first) {
  this.upstream = { docs: new Map(), log: [] };
  this.upstream.docs.set(new URL(first).toString(), baseDeclaration(tenant));
  this.setDoc({ ...baseDeclaration(tenant), upstream: [{ declaration: first }, { declaration: second }] });
});

Then("{string} is not retrieved a second time", function (second) {
  const [first] = this.subject().upstream.map((e) => new URL(e.declaration).toString().split("#")[0]);
  const times = this.upstream.log.filter((u) => u.split("#")[0] === first).length;
  assert.equal(times, 1, `${first} was retrieved ${times} times (the second spelling was ${second}): ${this.upstream.log.join(", ")}`);
});

Given("a subject declaration with {int} upstream entries, each a distinct declaration", function (count) {
  distinctEntries(this, count, "tenant");
});

Given("a subject declaration with {int} upstream entries, each a distinct declaration with target-type {string}", function (count, type) {
  distinctEntries(this, count, type);
});

function distinctEntries(world, count, type) {
  world.upstream = { docs: new Map(), log: [] };
  const entries = [];
  for (let i = 1; i <= count; i++) {
    world.upstream.docs.set(world.chainUri(i), baseDeclaration({ ...tenant, "target-type": type, "energy-consumption": 100 }));
    entries.push({ declaration: world.chainUri(i), role: "hosting" });
  }
  world.setDoc(baseDeclaration({ ...tenant, "energy-consumption": 5000, upstream: entries }));
}

Given("a subject declaration whose {int} upstream entries each have {int} upstream entries, to depth {int}", function (width, _inner, depth) {
  this.upstream = { docs: new Map(), log: [] };
  const uriAt = (path) => `https://tree-${path.join("-")}.example${WELL_KNOWN}`;
  const entriesAt = (path) => Array.from({ length: width }, (_, i) => ({ declaration: uriAt([...path, i + 1]), role: "hosting" }));
  const build = (path) => {
    if (path.length > depth) return;
    if (path.length > 0) {
      const declaration = baseDeclaration({ ...tenant, "energy-consumption": 100 });
      if (path.length < depth) declaration.upstream = entriesAt(path);
      this.upstream.docs.set(uriAt(path), declaration);
    }
    if (path.length < depth) for (let i = 1; i <= width; i++) build([...path, i]);
  };
  build([]);
  this.setDoc(baseDeclaration({ ...tenant, "energy-consumption": 5000, upstream: entriesAt([]) }));
});

Then("the walk reports that the bound was reached", function () {
  const all = flatComparisons(this.comparisons);
  assert.ok(all.some((c) => /budget/.test(c.detail)), JSON.stringify(all.slice(-3).map((c) => c.detail)));
});

Then("the walk reports the upstream {string} as refused", function (reference) {
  const entry = flatComparisons(this.comparisons).find((c) => c.declaration === reference);
  assert.ok(entry, `the walk reported nothing about ${reference}`);
  assert.equal(entry.verdict, "unreachable", JSON.stringify(entry));
  assert.match(entry.detail, /refus/, entry.detail);
  assert.ok(!this.upstream.log.includes(reference), `${reference} was requested`);
});

Given("a declaration retrieved from {string}", function (uri) {
  this.retrievedFrom = uri;
  this.upstream = { docs: new Map(), log: [] };
  this.setDoc(baseDeclaration(tenant));
});

Given("the upstream member names {string}", function (declaration) {
  this.mutateDoc((d) => (d.upstream = [...(d.upstream ?? []), { declaration }]));
});

Given("a subject declaration whose upstream answers {int}", function (status) {
  this.upstream = { docs: new Map(), log: [] };
  this.upstream.docs.set(this.chainUri(1), { status, body: "{}", contentType: "application/json" });
  this.setDoc(baseDeclaration({ ...tenant, upstream: [{ declaration: this.chainUri(1), role: "hosting" }] }));
});

Given("a subject declaration whose upstream declaration is an empty array", function () {
  this.upstream = { docs: new Map(), log: [] };
  this.upstream.docs.set(this.chainUri(1), []);
  this.setDoc(baseDeclaration({ ...tenant, upstream: [{ declaration: this.chainUri(1), role: "hosting" }] }));
});

Then("the upstream is reported as having no object", function () {
  const first = flatComparisons(this.comparisons)[0];
  assert.ok(first, "the walk reported nothing");
  assert.notEqual(first.verdict, "consistent", JSON.stringify(first));
  assert.ok(first.verdict === "not-comparable" || first.verdict === "unreachable", JSON.stringify(first));
});

Then("the subject declaration is still valid", function () {
  const checked = consumer.validateDocument(structuredClone(oneObject(this)));
  assert.equal(checked.valid, true, JSON.stringify(checked.errors));
});

Given("the upstream declaration says it delivered more energy than the subject reports", function () {
  ensureChain(this);
  upstreamOf(this)["energy-consumption"] = 999_999;
});

/** A figure written as "2400 MWh". */
function figure(text) {
  const [, number, unit] = /^(\S+) (\S+)$/.exec(text) ?? assert.fail(`not a figure: ${text}`);
  return { "energy-consumption": Number(number), "energy-unit": unit };
}

Given(/^the subject reports energy of (.+)$/, function (text) {
  ensureChain(this);
  this.mutateDoc((d) => Object.assign(d, figure(text)));
});

Given(/^the upstream reports energy of (.+)$/, function (text) {
  ensureChain(this);
  Object.assign(upstreamOf(this), figure(text));
});

Given("the subject period is {string}", function (text) {
  ensureChain(this);
  this.mutateDoc((d) => (d.period = periodFromText(text)));
});

Given("the upstream period is {string}", function (text) {
  ensureChain(this);
  upstreamOf(this).period = periodFromText(text);
});

Given("the upstream period is {string} to {string}", function (start, end) {
  ensureChain(this);
  upstreamOf(this).period = { start, end };
});

Given("the subject and the upstream both declare {string} {string}", function (member, text) {
  ensureChain(this);
  this.mutateDoc((d) => (d[member] = text));
  upstreamOf(this)[member] = text;
});

Given("the subject declares {string} {string} and the upstream declares {string} {string}", function (member, text, otherMember, otherText) {
  ensureChain(this);
  this.mutateDoc((d) => (d[member] = text));
  upstreamOf(this)[otherMember] = otherText;
});

/** How a "differ as" row of the features changes the subject (5000 kWh) and the upstream (100 kWh, a tenant declaration). */
const DIFFERENCES = {
  "the upstream reports less than the subject": () => undefined,
  "the upstream reports exactly what the subject reports": (s, u) => (u["energy-consumption"] = s["energy-consumption"]),
  "the upstream is in MWh and the subject in kWh, equal": (s, u) => Object.assign(u, { "energy-consumption": s["energy-consumption"] / 1000, "energy-unit": "MWh" }),
  // The energy figures are left out, so that the only figure the two share is the carbon one, which different bases make incomparable.
  "the carbon accounting methods differ": (s, u) => carbonOnly(s, u, "location-based", "market-based"),
  "one has carbon-accounting and the other has none": (s, u) => carbonOnly(s, u, "location-based", undefined),
  "the periods do not match": (s, u) => (u.period = { start: "2024-01-01T00:00:00Z", end: "2025-01-01T00:00:00Z" }),
  "the upstream target-type is not tenant": (s, u) => (u["target-type"] = "origin"),
};

function carbonOnly(subject, upstream, subjectBasis, upstreamBasis) {
  for (const object of [subject, upstream]) {
    delete object["energy-consumption"];
    delete object["energy-unit"];
  }
  subject["carbon-footprint"] = 50;
  upstream["carbon-footprint"] = 10;
  if (subjectBasis) subject["carbon-accounting"] = subjectBasis;
  if (upstreamBasis) upstream["carbon-accounting"] = upstreamBasis;
}

Given("the subject and the upstream differ as {string}", function (difference) {
  ensureChain(this);
  const change = DIFFERENCES[difference] ?? assert.fail(`no difference called "${difference}"`);
  this.mutateDoc((s) => change(s, upstreamOf(this)));
});

Then("no comparison is made", function () {
  const compared = flatComparisons(this.comparisons).filter((c) => c.verdict === "consistent" || c.verdict === "under-reported");
  assert.deepEqual(compared, [], "a comparison was made");
});

Then("the comparison covers {string} and {string}", function (energy, carbon) {
  const [first] = flatComparisons(this.comparisons);
  assert.equal(energy, "energy-consumption");
  assert.equal(carbon, "carbon-footprint");
  assert.equal(typeof first.upstreamFigures?.energyKWh, "number", JSON.stringify(first));
  assert.equal(first.carbonComparison, "compared", JSON.stringify(first));
});

Then("the comparison covers {string} only", function (energy) {
  const [first] = flatComparisons(this.comparisons);
  assert.equal(energy, "energy-consumption");
  assert.equal(typeof first.upstreamFigures?.energyKWh, "number", JSON.stringify(first));
  assert.equal(first.carbonComparison, "skipped-different-accounting-basis", JSON.stringify(first));
});

Then("the findings are worded as conditional on the target's scope covering what the upstream delivers", function () {
  const [first] = flatComparisons(this.comparisons);
  assert.match(first.detail, /if the target's (declared )?scope covers/i, first.detail);
});

Then("there are {int} comparisons", function (count) {
  assert.equal(this.comparisons.length, count);
});

Then("no comparison sums the upstreams", function () {
  const subjectEnergy = this.comparisons[0].subject.energyKWh;
  const each = this.comparisons.map((c) => c.upstreamFigures?.energyKWh);
  const sum = each.reduce((a, b) => a + b, 0);
  assert.ok(each.every((e) => e === each[0]), `the upstreams were compared as different figures: ${each}`);
  for (const c of this.comparisons) assert.notEqual(c.upstreamFigures.energyKWh, sum, "an upstream figure is the sum of the upstreams");
  assert.ok(subjectEnergy >= 0);
});

// ---- the evidence links ----------------------------------------------------------------------------------------------

const EVIDENCE = {
  "disclosure-uri": "https://evidence.example/esg/disclosures",
  "verifiable-attestation-uri": "https://evidence.example/esg/attestation.jwt",
  upstream: "https://evidence.example/tenants/provider.json",
};

Given("a valid declaration object with the evidence links {string}, {string} and an upstream entry", function (a, b) {
  this.setDoc(baseDeclaration({ [a]: EVIDENCE[a], [b]: EVIDENCE[b], upstream: [{ declaration: EVIDENCE.upstream, role: "hosting" }] }));
});

Given("the publisher is served on a local port with a recording log", async function () {
  await this.servePublisher();
});

Then(/^the recording log shows (\d+) requests?$/, function (count) {
  assert.equal(this.requests.length, Number(count), this.requests.map((r) => r.url).join(", "));
});

/** A stand-in for the network beyond the origin: it records every URL asked for, in the log of the server, and answers 404. */
function loggingFetch(world) {
  return async (input) => {
    const url = typeof input === "string" ? input : input.url;
    world.requests.push({ method: "GET", url, headers: {} });
    return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  };
}

When("the consumer fetches the local origin with the option {string} allowing insecure transport", async function (option) {
  const result = await this.fetchLocal();
  assert.equal(result.status, "ok", JSON.stringify(result).slice(0, 300));
  const object = [result.document].flat()[0];
  const fetchImpl = loggingFetch(this);
  if (option === "disclosure") {
    if (typeof object["disclosure-uri"] !== "string") {
      this.fetchResult = { ...result, note: "disclosure: the declaration carries no disclosure-uri, so no request was made" };
      return;
    }
    await consumer.fetchDisclosure(object["disclosure-uri"], fetchImpl, { base: result.url }).catch(() => undefined);
  } else if (option === "attestation") {
    await consumer.verifyAttestation(object["verifiable-attestation-uri"], { fetchImpl, base: result.url, now: this.now });
  } else if (option === "upstream") {
    await consumer.compareUpstream(object, { timeoutMs: 3_000, maxBytes: 1_000_000, maxObjects: 50, fetchImpl, base: new URL(result.url) });
  } else assert.fail(`no option called "${option}"`);
});

Then(/^the last request was for the (disclosure-uri|verifiable-attestation-uri|first upstream declaration)$/, function (link) {
  const wanted = link === "first upstream declaration" ? EVIDENCE.upstream : this.doc[link];
  assert.equal(this.requests[this.requests.length - 1].url, wanted);
});

// ---- extensions ------------------------------------------------------------------------------------------------------

// An extension whose value is an array: invalid, and the validator must say so. (An object value is read by the steps of the other owners.)
Given(/^the extension "([^"]*)" is '(\[[^']*\])'$/, function (name, json) {
  this.addExtension(name, JSON.parse(json));
});

Then("the two extensions are read as separate", function () {
  const extensions = oneObject(this).extensions ?? {};
  assert.deepEqual(extensions["https://acme.example/Ext"], { a: 1 });
  assert.deepEqual(extensions["https://acme.example/ext"], { a: 2 });
  const names = Object.keys(this.fetchResult?.document?.extensions ?? extensions);
  assert.equal(new Set(names).size, 2);
});

/**
 * Handlers are run on every document the consumer fetches, as an application that registers them would: after
 * the fetch, over the document it returned. A handler that throws becomes a warning of the fetch.
 */
function registerHandler(world, name, throws) {
  const sec = state(world);
  sec.handlers ??= new Map();
  sec.handlers.set(name, (value, object) => {
    sec.handlerCalls.push({ name, value: structuredClone(value), object: object.target });
    if (throws) throw new Error(`the handler of ${name} failed`);
  });
  if (sec.fetchWrapped) return;
  sec.fetchWrapped = true;
  const fetchLocal = world.fetchLocal.bind(world);
  world.fetchLocal = async (...args) => {
    const result = await fetchLocal(...args);
    if (result.status !== "ok") return result;
    const outcomes = await consumer.processExtensions(result.document, sec.handlers);
    for (const outcome of outcomes.filter((o) => !o.ok)) (result.warnings ??= []).push(`extension-handler: ${outcome.name}: ${outcome.error}`);
    return result;
  };
}

Given("a handler is registered for the extension name {string}", function (name) {
  registerHandler(this, name, false);
});

Given("a handler that throws is registered for the extension name {string}", function (name) {
  registerHandler(this, name, true);
});

Then("the handler received the object of {string}", function (name) {
  const received = state(this).handlerCalls.filter((c) => c.name === name);
  assert.ok(received.length > 0, `the handler of ${name} received nothing`);
  assert.deepEqual(received[received.length - 1].value, getPath(this.fetchResult.document, `extensions`)[name]);
});

Then("the handler received nothing of {string}", function (name) {
  assert.deepEqual(
    state(this).handlerCalls.filter((c) => c.name === name),
    [],
  );
});

Then("the handler received nothing", function () {
  assert.deepEqual(state(this).handlerCalls, []);
});

Then("the handler received the same object again", function () {
  const calls = state(this).handlerCalls;
  assert.ok(calls.length >= 2, `the handler was called ${calls.length} times`);
  assert.deepEqual(calls[calls.length - 1].value, calls[calls.length - 2].value);
});

Then("nothing in the extension was executed", function () {
  // The value is data: it comes back as it went in, and nothing it names was requested.
  const sent = oneObject(this).extensions;
  assert.deepEqual(this.fetchResult.document.extensions, sent);
  assert.equal(this.requests.filter((r) => !r.url.startsWith(WELL_KNOWN)).length, 0);
});

// The resolver of the system is watched for the names of an extension; nothing may ask about them.
function watchResolver(world) {
  const sec = state(world);
  if (sec.resolver) return sec.resolver;
  const resolver = { queries: [], unresolvable: new Set(), restore: [] };
  const record = (host) => {
    resolver.queries.push(host);
    if (resolver.unresolvable.has(host)) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  };
  const lookup = dns.lookup;
  const promised = dnsPromises.lookup;
  dns.lookup = (host, ...rest) => {
    try {
      record(host);
    } catch (e) {
      return (typeof rest[rest.length - 1] === "function" ? rest[rest.length - 1] : () => undefined)(e);
    }
    return lookup(host, ...rest);
  };
  dnsPromises.lookup = async (host, ...rest) => {
    record(host);
    return promised(host, ...rest);
  };
  resolver.restore = [() => (dns.lookup = lookup), () => (dnsPromises.lookup = promised)];
  sec.resolver = resolver;
  return resolver;
}

Given("a recording resolver", function () {
  watchResolver(this);
});

Then("the resolver saw no query for {string}", function (host) {
  assert.ok(!watchResolver(this).queries.includes(host), `the resolver was asked about ${host}`);
});

Given("the domain {string} does not resolve", function (host) {
  watchResolver(this).unresolvable.add(host);
});

// The ownership of a name changes; the consumer holds no record of it, so a name reads the same afterwards.
When("the domain {string} changes hands", function (host) {
  watchResolver(this).queries.push(`changed:${host}`);
});

After(function () {
  for (const restore of state(this).resolver?.restore ?? []) restore();
});

// ---- attestations ------------------------------------------------------------------------------------------------------

/** Issue a vc+jwt of the test's issuers: the key it is signed with, and the credential. */
async function issueCredential(world, uri, { trusted, issuer, target, period, validUntil }) {
  const key = await world.namedKey(trusted ? "trusted-issuer" : "other-issuer");
  const object = oneObject(world);
  const credential = {
    "@context": [consumer.VC_V2_CONTEXT],
    id: `${issuer}/credentials/1`,
    type: ["VerifiableCredential", "SustainabilityAttestation"],
    issuer,
    validFrom: "2025-01-01T00:00:00Z",
    ...(validUntil ? { validUntil } : { validUntil: "2030-01-01T00:00:00Z" }),
    credentialSubject: { id: uri, target: target ?? object.target, period: period ?? object.period },
  };
  const jwt = await manualJws({ alg: key.alg, typ: "vc+jwt", cty: "vc", jwk: publisher.embeddedJwk(key) }, JSON.stringify(credential), key);
  world.credentials.set(uri, { status: 200, contentType: "application/vc+jwt", body: jwt });
  if (trusted) world.attestationOptions.trustedIssuerKeys = [publisher.embeddedJwk(key)];
}

/** The features name the object under test "Example Corp"; its target is what the credential must name to cover it. */
const targetNamed = (world, name) => (name === "Example Corp" ? oneObject(world).target : name);

Given(/^the credential at "([^"]*)" (?!is \d+ bytes long)(.+)$/, async function (uri, description) {
  const auditor = "https://auditor.example";
  let match;
  if (description === "is issued by an issuer the consumer does not trust") {
    await issueCredential(this, uri, { trusted: false, issuer: auditor });
  } else if (description === "cannot be retrieved") {
    this.credentials.delete(uri);
  } else if ((match = /^is issued by a trusted issuer for the target "([^"]*)" and the period "([^"]*)" to "([^"]*)"$/.exec(description))) {
    await issueCredential(this, uri, { trusted: true, issuer: auditor, target: targetNamed(this, match[1]), period: { start: match[2], end: match[3] } });
  } else if ((match = /^is issued by a trusted issuer that is the publisher itself for the target "([^"]*)" and the period "([^"]*)" to "([^"]*)"$/.exec(description))) {
    await issueCredential(this, uri, { trusted: true, issuer: new URL(uri).origin, target: targetNamed(this, match[1]), period: { start: match[2], end: match[3] } });
  } else if ((match = /^is issued by a trusted issuer for the target "([^"]*)" and expired on "([^"]*)"$/.exec(description))) {
    await issueCredential(this, uri, { trusted: true, issuer: auditor, target: targetNamed(this, match[1]), validUntil: match[2] });
  } else if ((match = /^is issued by a trusted issuer for the target "([^"]*)"$/.exec(description))) {
    await issueCredential(this, uri, { trusted: true, issuer: auditor, target: targetNamed(this, match[1]) });
  } else if ((match = /^is issued by a trusted issuer for the period "([^"]*)" to "([^"]*)"$/.exec(description))) {
    await issueCredential(this, uri, { trusted: true, issuer: auditor, period: { start: match[1], end: match[2] } });
  } else assert.fail(`no credential ${description}`);
});

Then("the attestation is reported as not checked", function () {
  assert.equal(this.fetchResult.status, "ok", JSON.stringify(this.fetchResult).slice(0, 300));
  assert.equal(this.attestation, undefined, "an attestation was checked");
  assert.deepEqual(this.attestationReads, []);
  assert.ok(!("attestation" in this.fetchResult));
});

// ---- strings are data ---------------------------------------------------------------------------------------------------

When("the consumer displays the provider", function () {
  state(this).displayed = consumer.isolate(oneObject(this).provider);
});

Then("the provider text is isolated for display", function () {
  const shown = state(this).displayed;
  assert.ok(shown.startsWith(consumer.FSI ?? "⁨") && shown.endsWith(consumer.PDI ?? "⁩"), JSON.stringify(shown));
  assert.ok(shown.includes(oneObject(this).provider));
});

Then("the member {string} is never interpreted as markup", function (member) {
  const served = getPath(oneObject(this), member);
  const read = getPath(this.read.document, member);
  assert.equal(typeof read, "string");
  assert.equal(read, served, "the consumer changed the text");
  assert.equal(consumer.isolate(read).slice(1, -1), served);
});

Given("the methodology document at the link states that the energy figure is wrong", function () {
  this.ensureDoc();
  this.mutateDoc((d) => (d["methodology-uri"] = "/methodology"));
  state(this).methodologyClaim = "the energy figure is wrong";
});

Then("the energy is the figure of the object", function () {
  const [served] = [this.fetchResult.document].flat();
  assert.equal(served["energy-consumption"], oneObject(this)["energy-consumption"]);
  assert.ok(!this.requests.some((r) => r.url.startsWith("/methodology")), "the methodology document was retrieved");
});

// ---- rate limit ---------------------------------------------------------------------------------------------------------

Then(/^the (\d+) response is not typed application\/sustainability-data\+json$/, function (status) {
  assert.equal(this.statuses.at(-1), Number(status), `statuses: ${this.statuses}`);
  assert.doesNotMatch(this.response.headers.get("content-type") ?? "", /sustainability-data\+json/);
});

Then("the {int} response carries no entity tag", function (status) {
  assert.equal(this.response.status, status);
  assert.equal(this.response.headers.get("etag"), null);
});

Then("the consumer treats the {int} as a failed fetch, not an empty declaration", async function (status) {
  const result = await this.fetchLocal();
  assert.equal(result.status, "http-error", JSON.stringify(result).slice(0, 300));
  assert.equal(result.httpStatus, status);
  assert.equal(result.document, undefined);
});

When("I send GET {string} accepting {string}", async function (path, coding) {
  await this.send("GET", path, { "Accept-Encoding": coding });
});

// ---- the publisher: compression, privacy --------------------------------------------------------------------------------

// A web server in front of the publisher that compresses what the publisher says, as a deployment's server does.
Given("the publisher is served on a local port behind a web server that compresses with {string}", async function (coding) {
  assert.equal(coding, "gzip");
  const inner = await this.servePublisher();
  const front = closing(
    createServer(async (req, res) => {
      const upstream = await fetch(`${inner}${req.url}`, { headers: { "Accept-Encoding": "identity" } });
      const body = Buffer.from(await upstream.arrayBuffer());
      const compressed = (req.headers["accept-encoding"] ?? "").includes(coding);
      res.writeHead(upstream.status, {
        "Content-Type": upstream.headers.get("content-type") ?? MEDIA_TYPE,
        ...(compressed ? { "Content-Encoding": coding } : {}),
      });
      res.end(compressed ? gzipSync(body) : body);
    }),
  );
  this.base = await this.listen(front);
});

Then("the decoded body is a JSON object", function () {
  const body = JSON.parse(this.response.body);
  assert.ok(body && typeof body === "object" && !Array.isArray(body), "the decoded body is not a JSON object");
});

Given("the dayFloor option is {string}", function (option) {
  state(this).dayFloor = option;
});

/** Hold the given periods, each "start/end", with the day floor of the scenario ("drop", the default, unless a step said otherwise). */
async function holdPeriodsOf(world, texts) {
  const sec = state(world);
  sec.heldPeriods = texts;
  const rows = texts.map((text, i) => {
    const { start, end } = periodFromText(text);
    return { label: `p${i + 1}`, start, end, target: "example.com" };
  });
  await world.holdPeriods(rows, { security: { dayFloor: sec.dayFloor ?? "drop" } });
}

Given("a publisher holding periods {string}", async function (period) {
  await holdPeriodsOf(this, [period]);
});

Given("a publisher holding periods {string} and {string}", async function (a, b) {
  await holdPeriodsOf(this, [a, b]);
});

/** The periods the response lists, as "start/end" texts. */
function listedPeriods(world) {
  const body = world.response.json();
  return [body].flat().map((o) => `${o.period.start}/${o.period.end}`);
}

const sameSpan = (a, b) => {
  const [as, ae] = a.split("/");
  const [bs, be] = b.split("/");
  return sameInstant(as, bs) && sameInstant(ae, be);
};

Then(/^the body lists (?:only )?(that period|the period "[^"]*")$/, function (what) {
  assert.equal(this.response.status, 200, this.response.body.slice(0, 200));
  const listed = listedPeriods(this);
  const wanted = [what === "that period" ? state(this).heldPeriods[0] : /"([^"]*)"/.exec(what)[1]];
  assert.equal(listed.length, wanted.length, JSON.stringify(listed));
  wanted.forEach((w, i) => assert.ok(sameSpan(listed[i], w), `${listed[i]} is not ${w}`));
});

Then(/^the operator was warned (yes|no)$/, async function (answer) {
  const { warnings } = await this.built();
  const warned = warnings.some((w) => /calendar day/.test(w));
  assert.equal(warned, answer === "yes", JSON.stringify(warnings));
});

Then("the operator log mentions {string}", function (text) {
  assert.ok(this.operatorWarnings.some((w) => w.includes(text)), `the operator log: ${JSON.stringify(this.operatorWarnings)}`);
});

Then("every bound of every period is at {int}:{int}:{int} of a day in its own offset", function (h, m, s) {
  const time = [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
  const periods = [this.response.json()].flat().map((o) => o.period);
  assert.ok(periods.length > 0, "the response lists no period");
  for (const { start, end } of periods) {
    for (const bound of [start, end]) assert.match(bound, new RegExp(`T${time}(\\.0+)?(Z|[+-]\\d\\d:\\d\\d)$`), bound);
  }
});

Then("no period is shorter than one calendar day", function () {
  for (const { period } of [this.response.json()].flat()) {
    const hours = (Date.parse(period.end) - Date.parse(period.start)) / 3_600_000;
    assert.ok(hours >= 23, `${period.start} to ${period.end} is ${hours} hours`);
  }
});

Given("an extended publisher with a maximum of {int} objects holding {int} periods", async function (maximum, count) {
  const rows = Array.from({ length: count }, (_, i) => {
    const { start, end } = periodFromText(`2024-${String(i + 1).padStart(2, "0")}`);
    return { label: `m${i + 1}`, start, end, target: "example.com" };
  });
  await this.holdPeriods(rows, { security: { maxObjects: maximum } });
});

// The cap bounds what is held; a publisher over it refuses to build and never cuts an answer.
Then("building the publisher is refused and the message names {string}", async function (name) {
  await assert.rejects(() => this.publisher.build({}), (error) => error.message.includes(name));
});

Then("the gateway holds at most {int} objects", function (maximum) {
  const { HELD_MAX } = requireHere(resolve(ROOT, "gateway", "dist", "adapters", "self-report.js"));
  assert.ok(HELD_MAX <= maximum, `the gateway holds up to ${HELD_MAX} objects`);
});

// Noise: a deterministic factor within 1% per period, applied once, to every related member alike.
const NOISE = { applyNoise: true, noiseDisclosed: true, dayFloor: "off" };

function noisyPublisher(raws) {
  return new publisher.Publisher(
    { name: "noise", capabilities: "extended", fetch: async () => raws },
    { cacheTtlMs: 0, normalize: { target: "example.com", targetType: "origin", clock: () => "2026-10-24T12:00:00Z" }, security: NOISE },
  );
}

const monthlyRaw = (label) => rawMetrics({ period: periodFromText(label), capabilities: "extended", energy: { value: 100, unit: "kWh" }, carbon: undefined, carbonIntensity: 245, estimatedAnnualEmissionsKg: 7300 });

Given("an extended publisher with monthly entries for {string} and noise enabled", function (labels) {
  const raws = labels.split(",").map((l) => monthlyRaw(l.trim()));
  state(this).noise = { raws, first: noisyPublisher(raws), second: noisyPublisher(raws) };
});

const first = (built) => [built].flat()[0];

Then("the published figures for {string} are within {int}% of {int} kWh, consistent with the carbon figure, and identical across two builds", async function (label, percent, kWh) {
  const { first: one, second: two } = state(this).noise;
  const start = periodFromText(label).start;
  const pick = (built) => [built].flat().find((o) => sameInstant(o.period.start, start));
  const [a, b] = [pick(await one.build({})), pick(await two.build({}))];
  assert.ok(a, `no object for ${label}`);
  assert.ok(Math.abs(a["energy-consumption"] - kWh) <= (kWh * percent) / 100, `energy ${a["energy-consumption"]}`);
  const grams = consumer.convertCarbon(a["carbon-footprint"], a["carbon-unit"] ?? "gCO2e", "gCO2e");
  assert.ok(Math.abs(grams - a["energy-consumption"] * 245) / grams < 0.0005, `carbon ${grams} for energy ${a["energy-consumption"]}`);
  assert.deepEqual(a, b, "two builds differ");
});

Then("the ratios between energy, carbon, intensity and the annualized figure equal the ratios before noise", async function () {
  const { raws } = state(this).noise;
  const plain = new publisher.Publisher(
    { name: "plain", capabilities: "extended", fetch: async () => raws },
    { cacheTtlMs: 0, normalize: { target: "example.com", targetType: "origin", clock: () => "2026-10-24T12:00:00Z" }, security: { dayFloor: "off" } },
  );
  const noisy = first(await state(this).noise.first.build({}));
  const exact = first(await plain.build({}));
  const members = ["energy-consumption", "carbon-footprint", "estimated-annual-emissions-kgCO2e"];
  assert.notEqual(noisy["energy-consumption"], exact["energy-consumption"], "the noise changed nothing");
  for (const a of members) {
    for (const b of members) {
      if (a >= b || noisy[a] === undefined || noisy[b] === undefined) continue;
      const [before, after] = [exact[a] / exact[b], noisy[a] / noisy[b]];
      assert.ok(Math.abs(after - before) / before < 1e-4, `${a}/${b} was ${before} and is ${after}`);
    }
  }
});

Given("a publisher with noise enabled and a figure of {int} kWh", function (kWh) {
  this.publisherConfig = { ...this.publisherConfig, security: NOISE };
  this.inputPatch({ energy: { value: kWh, unit: "kWh" }, carbon: undefined, carbonIntensity: 245 });
  state(this).published = [];
});

When("it publishes the period {string} and then the period {string}", async function (a, b) {
  for (const text of [a, b]) {
    this.inputPatch({ period: periodFromText(text) });
    const { objects, error } = await this.built();
    if (error) throw error;
    state(this).published.push(objects[0]);
  }
});

Then("the two published energy figures are identical", function () {
  const [a, b] = state(this).published.map((o) => o["energy-consumption"]);
  assert.equal(a, b);
});

// ---- the tool and the adapters ------------------------------------------------------------------------------------------

Then("the tool prints a warning about {string}", function (disclosure) {
  const out = `${this.run.stdout}\n${this.run.stderr}`;
  assert.ok(out.toLowerCase().includes(disclosure.toLowerCase()), `the tool did not warn about "${disclosure}": ${out.slice(0, 600)}`);
});

Then("the tool prints advice to aggregate or omit a metric that could be linked to individual users or small groups", function () {
  const out = `${this.run.stdout}\n${this.run.stderr}`;
  assert.match(out, /aggregat/i, out.slice(0, 600));
  assert.match(out, /omit/i, out.slice(0, 600));
  assert.match(out, /individual users|small groups/i, out.slice(0, 600));
});

/** The adapter of the CSV steps, made from the configuration and the text given so far. */
function csvAdapterOf(world) {
  if (world.csvText === undefined) return;
  world.adapter = publisher.csvAdapter({
    provider: "Example Org (https://example.com/contact)",
    methodologyUri: "https://example.com/methodology",
    measurementMethod: "hardware-metered",
    target: "example.com",
    targetType: "origin",
    ...world.csvConfig,
    text: world.csvText,
  });
  world.publisher = undefined;
  world.invalidateBuild();
}

// The adapter reads only the columns it documents; any other column is ignored (publisher/src/adapters/csv.ts).
Given("a CSV adapter with its documented columns", function () {
  this.csvConfig = { ...this.csvConfig };
  csvAdapterOf(this);
});

Given("a CSV with a column {string}", function (column) {
  this.csvText = `period,energy,${column}\n2025,100,5\n`;
  csvAdapterOf(this);
});
