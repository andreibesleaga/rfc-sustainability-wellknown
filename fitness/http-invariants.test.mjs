/**
 * Architecture fitness function: every response class of the reference gateway
 * carries the headers the draft and the project's own rules require, for every
 * subject it serves, not just the ones a feature test happens to visit.
 *
 * The gateway is started in-process from its build with a fixed clock, no
 * network and no wall clock, exactly as its own tests start it.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = require(resolve(ROOT, "gateway", "dist", "app.js"));
const cfg = require(resolve(ROOT, "gateway", "dist", "config.js"));
const publisher = require(resolve(ROOT, "publisher", "dist", "index.js"));

const MEDIA_TYPE = "application/sustainability-data+json";
const NOW = new Date("2026-10-17T12:00:00Z"); // the gateway's fixed clock
let gw;
let base;

before(async () => {
  const key = await publisher.generateSigningKey("Ed25519");
  const config = cfg.loadConfig({
    port: 0,
    host: "127.0.0.1",
    dataDir: resolve(ROOT, "gateway", "data"),
    maxAge: 86_400,
    rateLimit: { perMinute: 0, trustProxy: 1 },
    signingKeyJwk: JSON.stringify(await publisher.exportPrivateJwk(key)),
  });
  config.self.measured = false;
  gw = await app.createGateway({ config, log: () => undefined, now: NOW, clock: () => NOW, fetchImpl: null, env: {} });
  await new Promise((r) => gw.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${gw.server.address().port}`;
});

after(async () => {
  await new Promise((r) => gw.server.close(() => r()));
});

async function subjects() {
  const index = await (await fetch(`${base}/index.json`)).json();
  const paths = new Set(["/.well-known/sustainability-data"]);
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "path" && typeof x === "string" && x.endsWith("/.well-known/sustainability-data")) paths.add(x);
        walk(x);
      }
    }
  };
  walk(index);
  return [...paths];
}

const EVERY_200 = ["content-type", "x-content-type-options", "etag", "last-modified", "cache-control", "access-control-allow-origin", "access-control-expose-headers", "content-language"];

test("every served declaration carries the full header set, and HEAD matches GET", async () => {
  const paths = await subjects();
  assert.ok(paths.length > 20, `only ${paths.length} subjects found`);
  for (const path of paths) {
    const get = await fetch(`${base}${path}`);
    assert.equal(get.status, 200, path);
    assert.equal(get.headers.get("content-type"), MEDIA_TYPE, path);
    assert.equal(get.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(get.headers.get("access-control-allow-origin"), "*", path);
    assert.match(get.headers.get("cache-control") ?? "", /^public, max-age=\d+$/, path);
    assert.match(get.headers.get("etag") ?? "", /^"[^"]+"$/, `${path}: strong ETag`);
    for (const h of EVERY_200) assert.ok(get.headers.get(h), `${path} lacks ${h}`);
    const body = await get.text();
    assert.ok(body.endsWith("\n") || body.endsWith("}") || body.endsWith("]"), path);

    const head = await fetch(`${base}${path}`, { method: "HEAD" });
    assert.equal(head.status, 200, `${path} HEAD`);
    for (const h of EVERY_200) assert.equal(head.headers.get(h), get.headers.get(h), `${path}: HEAD ${h}`);
    assert.equal(await head.text(), "", `${path}: HEAD body`);

    const revalidate = await fetch(`${base}${path}`, { headers: { "If-None-Match": get.headers.get("etag") } });
    assert.equal(revalidate.status, 304, `${path}: 304`);
    assert.equal(revalidate.headers.get("content-length"), null, `${path}: a 304 carries no Content-Length`);
    assert.equal(await revalidate.text(), "", `${path}: 304 body`);
    assert.equal(revalidate.headers.get("etag"), get.headers.get("etag"), `${path}: 304 keeps the validator`);
  }
});

test("a query this gateway cannot read is ignored: 200 and the same body as without it, for every subject", async () => {
  const unreadable = "?granularity=weekly&start=2026-02-30T00:00:00Z&end=yesterday&granularity=daily";
  for (const path of await subjects()) {
    const plain = await fetch(`${base}${path}`);
    const ignored = await fetch(`${base}${path}${unreadable}`);
    assert.equal(ignored.status, 200, `${path}: a bad query is never a 400`);
    assert.equal(await ignored.text(), await plain.text(), `${path}: the bad parameters changed the answer`);
  }
});

test("a range or target that selects nothing is 200 with an empty array, never 404", async () => {
  for (const query of ["start=1999-01-01T00:00:00Z&end=2000-01-01T00:00:00Z", "target=/nothing-here"]) {
    const r = await fetch(`${base}/.well-known/sustainability-data?${query}`);
    assert.equal(r.status, 200, query);
    assert.equal(r.headers.get("content-type"), MEDIA_TYPE, query);
    assert.deepEqual(await r.json(), [], query);
  }
});

test("every error class is JSON, nosniff, CORS-readable and language-tagged", async () => {
  const cases = [
    ["/nobody.example/.well-known/sustainability-data", 404],
    ["/not-a-route", 404],
  ];
  for (const [path, status] of cases) {
    const r = await fetch(`${base}${path}`);
    assert.equal(r.status, status, path);
    assert.match(r.headers.get("content-type") ?? "", /^application\/json/, path);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", path);
    assert.equal(r.headers.get("access-control-allow-origin"), "*", path);
    assert.equal(r.headers.get("content-language"), "en", path);
    const body = await r.json();
    assert.equal(typeof body.error, "string", path);
  }
  for (const method of ["POST", "PUT", "DELETE"]) {
    const r = await fetch(`${base}/.well-known/sustainability-data`, { method });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get("allow"), "GET, HEAD", method);
    assert.equal(r.headers.get("x-content-type-options"), "nosniff", method);
  }
});

test("an unknown subject and a withheld one answer with byte-identical 404s", async () => {
  const withheld = readdirSync(resolve(ROOT, "gateway", "data", "withheld")).filter((f) => f.endsWith(".json")).map((f) => basename(f, ".json"));
  assert.ok(withheld.length > 0, "no withheld subject to compare");
  const unknown = await fetch(`${base}/never-heard-of-it.example/.well-known/sustainability-data`);
  const unknownBody = await unknown.text();
  assert.equal(unknown.status, 404);
  for (const domain of withheld) {
    const r = await fetch(`${base}/${domain}/.well-known/sustainability-data`);
    assert.equal(r.status, 404, domain);
    assert.equal(await r.text(), unknownBody, `${domain}: the 404 tells a withheld subject from an unknown one`);
  }
});
