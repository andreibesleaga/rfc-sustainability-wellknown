import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { createSustainabilityServer } from "sustainability-wellknown-publisher";
import { makePublisher } from "../server.mjs";

const consumer = (() => { try { return createRequire(import.meta.url)("sustainability-wellknown-consumer"); } catch { return undefined; } })();

test("the environment becomes a signed, conformant declaration", async () => {
  Object.assign(process.env, {
    SD_TARGET: "node.example", SD_PROVIDER: "Node Example (https://node.example/contact)",
    SD_METHODOLOGY_URI: "https://node.example/methodology", SD_PERIOD: "2026-09",
    SD_ENERGY_KWH: "12.5", SD_CARBON_KGCO2E: "3.06", SD_UPDATED: "2026-10-01T00:00:00Z", SD_MEASUREMENT_METHOD: "third-party-modeled",
  });
  const pub = await makePublisher({ log: false });
  const server = createSustainabilityServer(pub, { onError: () => {} });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const r = await fetch(`${base}/.well-known/sustainability-data`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "application/sustainability-data+json");
    const doc = await r.json();
    assert.equal(doc.target, "node.example");
    assert.equal(doc["energy-consumption"], 12.5);
    assert.equal(typeof doc.signed, "string");
    if (consumer) {
      assert.equal(consumer.validateDocument(doc).valid, true);
      assert.equal((await consumer.verifyEmbeddedSignature(doc)).result.status, "verified");
    }
    assert.equal((await fetch(`${base}/.well-known/sustainability-data`, { method: "POST" })).status, 405);
  } finally {
    await new Promise((r) => server.close(() => r()));
  }
});

test("a node without any figure or evidence link refuses to start", async () => {
  for (const k of ["SD_ENERGY_KWH", "SD_CARBON_KGCO2E", "SD_DISCLOSURE_URI", "SD_SCOPE_1"]) delete process.env[k];
  await assert.rejects(() => makePublisher({ log: false }), /at least one of/);
});

test("scopes are kgCO2e whether or not a total is given", async () => {
  const base = { SD_TARGET: "node.example", SD_PROVIDER: "Node Example (https://node.example/contact)", SD_METHODOLOGY_URI: "https://node.example/methodology",
    SD_PERIOD: "2026-09", SD_UPDATED: "2026-10-01T00:00:00Z", SD_MEASUREMENT_METHOD: "third-party-modeled", SD_SCOPE_1: "1000" };
  for (const extra of [{ SD_CARBON_KGCO2E: "1000" }, { SD_DISCLOSURE_URI: "https://node.example/esg" }]) {
    for (const k of Object.keys(process.env)) if (k.startsWith("SD_")) delete process.env[k];
    Object.assign(process.env, base, extra);
    const doc = await (await makePublisher({ log: false })).build({});
    assert.equal(doc["carbon-unit"], "kgCO2e", JSON.stringify(extra));
    assert.equal(doc["scope-1"], 1000, JSON.stringify(extra));
  }
});

test("a missing or invalid measurement method stops the service at start", async () => {
  const base = { SD_TARGET: "node.example", SD_PROVIDER: "P (https://node.example/c)", SD_METHODOLOGY_URI: "https://node.example/m", SD_PERIOD: "2026-09", SD_ENERGY_KWH: "1" };
  for (const m of [undefined, "metered"]) {
    for (const k of Object.keys(process.env)) if (k.startsWith("SD_")) delete process.env[k];
    Object.assign(process.env, base, m ? { SD_MEASUREMENT_METHOD: m } : {});
    await assert.rejects(() => makePublisher({ log: false }), /SD_MEASUREMENT_METHOD is required/);
  }
});
