import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOriginList } from "../src/input.mjs";

test("golden: one host per line, in order, duplicates once, comments and blanks ignored", () => {
  const { hosts, rejected } = parseOriginList("# list of 2026-12-01\nExample.org\n\nb.example\nexample.org\n");
  assert.deepEqual(hosts, ["example.org", "b.example"]);
  assert.deepEqual(rejected, []);
});

test("the Tranco format rank,domain is read, with or without a header line", () => {
  assert.deepEqual(parseOriginList("1,google.com\n2,cloudflare.com\n").hosts, ["google.com", "cloudflare.com"]);
  assert.deepEqual(parseOriginList("rank,domain\n1,a.example\r\n2,b.example\r\n").hosts, ["a.example", "b.example"]);
});

test("a scheme, a path and a port are handled; garbage is reported, not crawled", () => {
  const { hosts, rejected } = parseOriginList("https://a.example/page\n127.0.0.1:8080\nnot a host\n/etc/passwd\n");
  assert.deepEqual(hosts, ["a.example", "127.0.0.1:8080"]);
  assert.equal(rejected.length, 2);
});

test("an empty list gives no hosts", () => {
  assert.deepEqual(parseOriginList("").hosts, []);
});

test("a port outside 1-65535, or written with leading zeros, is reported, not crawled", () => {
  const { hosts, rejected } = parseOriginList("127.0.0.1:99999\na.example:65536\nb.example:0\nc.example:00080\nd.example:65535\n");
  assert.deepEqual(hosts, ["d.example:65535"]);
  assert.equal(rejected.length, 4);
});

test("a host the URL parser refuses is reported, not crawled", () => {
  const { hosts, rejected } = parseOriginList("999.1.1.1\nok.example\n");
  assert.deepEqual(hosts, ["ok.example"]);
  assert.deepEqual(rejected, ["999.1.1.1"]);
});
