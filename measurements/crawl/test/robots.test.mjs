import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowed, parseRobots } from "../src/robots.mjs";

const TOKEN = "SustainabilityDataSurvey";
const allowed = (text, path) => isAllowed(parseRobots(text), TOKEN, path);

test("no rules, or no matching group, allows everything", () => {
  assert.equal(allowed("", "/carbon.txt"), true);
  assert.equal(allowed("User-agent: otherbot\nDisallow: /\n", "/carbon.txt"), true);
});

test("the wildcard group applies when no group names the crawler", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /private\n", "/private/x"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /private\n", "/public"), true);
});

test("a group that names the crawler replaces the wildcard group", () => {
  const text = "User-agent: *\nDisallow: /\n\nUser-agent: sustainabilitydatasurvey\nDisallow: /carbon.txt\n";
  assert.equal(allowed(text, "/.well-known/sustainability-data"), true);
  assert.equal(allowed(text, "/carbon.txt"), false);
});

test("the longest rule wins and Allow wins a tie", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /.well-known/\nAllow: /.well-known/sustainability-data\n", "/.well-known/sustainability-data"), true);
  assert.equal(allowed("User-agent: *\nDisallow: /a\nAllow: /a\n", "/a"), true);
});

test("wildcards and the end anchor work; an empty Disallow allows", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /*.json$\n", "/.well-known/dist.json"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /*.json$\n", "/x.json?y=1"), true);
  assert.equal(allowed("User-agent: *\nDisallow:\n", "/anything"), true);
});

test("comments, several agents in one group and unknown fields are tolerated", () => {
  const text = "User-agent: a\nUser-agent: SustainabilityDataSurvey # us\nCrawl-delay: 5\nDisallow: /x # no\n";
  assert.equal(allowed(text, "/x"), false);
});

test("rule order does not matter: the longest match wins either way", () => {
  assert.equal(allowed("User-agent: *\nAllow: /a/b\nDisallow: /a\n", "/a/b/c"), true);
  assert.equal(allowed("User-agent: *\nAllow: /a\nDisallow: /a/b\n", "/a/b/c"), false);
});

test("a longer Disallow beats a shorter Allow", () => {
  assert.equal(allowed("User-agent: *\nAllow: /\nDisallow: /carbon.txt\n", "/carbon.txt"), false);
  assert.equal(allowed("User-agent: *\nAllow: /\nDisallow: /carbon.txt\n", "/other"), true);
});

test("Disallow: / forbids every path, an empty Disallow forbids none", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /\n", "/"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /\n", "/.well-known/dist.json"), false);
  assert.equal(allowed("User-agent: *\nDisallow:\n", "/"), true);
});

test("a pattern matches from the start of the path only", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /well-known\n", "/.well-known/dist.json"), true);
  assert.equal(allowed("User-agent: *\nDisallow: /.well-known\n", "/.well-known/dist.json"), false);
});

test("* matches any run of characters and $ anchors the end", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /.well-known/*\n", "/.well-known/carbon.txt"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /*carbon\n", "/.well-known/carbon.txt"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /carbon.txt$\n", "/carbon.txt"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /carbon.txt$\n", "/carbon.txt/x"), true);
});

test("field names and the product token are case-insensitive", () => {
  assert.equal(allowed("USER-AGENT: SUSTAINABILITYDATASURVEY\nDISALLOW: /x\n", "/x"), false);
});

test("a group naming the crawler wins even when the wildcard group allows more", () => {
  const text = "User-agent: *\nAllow: /\n\nUser-agent: SustainabilityDataSurvey\nDisallow: /\n";
  assert.equal(allowed(text, "/carbon.txt"), false);
});

test("a file with no usable line, or only blank lines and comments, allows everything", () => {
  assert.equal(allowed("\n\n# nothing here\n", "/carbon.txt"), true);
  assert.equal(allowed("this is not a robots file\n", "/carbon.txt"), true);
});

test("CRLF line endings and a byte order mark are tolerated", () => {
  assert.equal(allowed("﻿User-agent: *\r\nDisallow: /x\r\n", "/x"), false);
});

// Where the library differs from RFC 9309 (checked with robots-parser 3.0.1). The crawler asks for five fixed
// paths and one random hex path, none of which hits these cases; the tests document the library's behaviour so
// a change in a later version is noticed.
test("known difference: a Disallow of an unreserved character does not match its percent-encoded form", () => {
  assert.equal(allowed("User-agent: *\nDisallow: /~x\n", "/~x"), false);
  assert.equal(allowed("User-agent: *\nDisallow: /~x\n", "/%7Ex"), true); // RFC 9309 / RFC 3986 equivalence would say false
});

test("known difference: a User-agent value with a version suffix still names the crawler", () => {
  const text = "User-agent: SustainabilityDataSurvey/0.1.0\nDisallow: /\n";
  assert.equal(allowed(text, "/carbon.txt"), false); // the RFC 9309 grammar allows only the product token; the stricter result is safe
});
