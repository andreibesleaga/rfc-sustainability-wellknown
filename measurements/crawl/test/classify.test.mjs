import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classify } from "../src/classify.mjs";
import { loadConsumer } from "../src/config.mjs";

const consumer = loadConsumer();
const enc = (s) => new TextEncoder().encode(s);
const reply = (status, contentType, text = "") => ({ status, contentType, body: enc(text), truncated: false });
const VALID = readFileSync(new URL("../fixtures/valid-declaration.json", import.meta.url), "utf8");
const verdict = (kind, r) => classify(consumer, kind, r).classification;

test("golden: a valid declaration is valid under either accepted media type", () => {
  assert.equal(verdict("declaration", reply(200, "application/sustainability-data+json", VALID)), "valid");
  assert.equal(verdict("declaration", reply(200, "application/json; charset=utf-8", VALID)), "valid");
});

test("a declaration with the wrong media type is not one", () => {
  assert.equal(verdict("declaration", reply(200, "text/plain", VALID)), "wrong-media-type");
  assert.equal(verdict("declaration", reply(200, null, VALID)), "wrong-media-type");
});

test("JSON that is not a declaration is invalid and kept; text that is not JSON is unparseable", () => {
  assert.equal(verdict("declaration", reply(200, "application/json", '{"a":1}')), "invalid");
  assert.equal(classify(consumer, "declaration", reply(200, "application/json", '{"a":1}')).store, true);
  assert.equal(verdict("declaration", reply(200, "application/json", "{nope")), "unparseable");
  assert.equal(verdict("declaration", reply(200, "application/json", '{"a":1,"a":1}')), "unparseable");
});

test("a web page at any path is a soft 404, even with a JSON-looking path", () => {
  assert.equal(verdict("declaration", reply(200, "text/html", "<p>hi</p>")), "html-soft-404");
  assert.equal(verdict("carbon-txt", reply(200, "text/plain", "<!DOCTYPE html><html>")), "html-soft-404");
  assert.equal(verdict("random", reply(200, "text/html; charset=utf-8", "x")), "html-soft-404");
});

test("the random probe answering 200 with something else is other-200", () => {
  assert.equal(verdict("random", reply(200, "application/json", "{}")), "other-200");
});

test("carbon.txt needs a table header; dist.json needs a JSON object", () => {
  assert.equal(verdict("carbon-txt", reply(200, "text/plain", 'version="0.4"\n[org]\n')), "parseable");
  assert.equal(verdict("carbon-txt", reply(200, "text/plain", "hello")), "unparseable");
  assert.equal(verdict("json-object", reply(200, "application/json", '{"a":1}')), "parseable");
  assert.equal(verdict("json-object", reply(200, "application/json", "[1]")), "unparseable");
});

test("statuses map to not-found, denied and error", () => {
  assert.equal(verdict("declaration", reply(404, "text/html")), "not-found");
  assert.equal(verdict("declaration", reply(410, "text/html")), "not-found");
  assert.equal(verdict("declaration", reply(403, "text/html")), "denied");
  assert.equal(verdict("declaration", reply(503, "text/html")), "error");
});

test("a body over the cap is never parsed", () => {
  const big = { ...reply(200, "application/json", VALID), truncated: true };
  assert.equal(verdict("declaration", big), "unparseable");
});
