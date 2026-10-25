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
    assert.equal(Array.isArray(doc), false, "the kit publishes one current report, not an array");
    assert.equal(doc.target, "node.example");
    assert.deepEqual(doc.period, { start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" });
    assert.equal(doc.signed.split(".").length, 3);
    assert.equal(doc["energy-consumption"], 12.5);
    assert.equal(typeof doc.signed, "string");
    if (consumer) {
      assert.equal(consumer.validateDocument(doc).valid, true);
      assert.equal((await consumer.verifyEmbeddedSignature(doc)).result.status, "verified");
    }
    // A basic publisher ignores every parameter: no 400, no 404, the same body.
    const withQuery = await fetch(`${base}/.well-known/sustainability-data?start=1999-01-01T00:00:00Z&target=other&granularity=daily&foo=%`);
    assert.equal(withQuery.status, 200);
    assert.equal((await withQuery.json()).target, "node.example");
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

function configure(extra) {
  for (const k of Object.keys(process.env)) if (k.startsWith("SD_")) delete process.env[k];
  Object.assign(process.env, {
    SD_TARGET: "node.example", SD_PROVIDER: "P (https://node.example/c)", SD_METHODOLOGY_URI: "https://node.example/m",
    SD_ENERGY_KWH: "1", SD_UPDATED: "2026-10-01T00:00:00Z", SD_MEASUREMENT_METHOD: "third-party-modeled",
  }, extra);
}

test("SD_START and SD_END give the period as two date-times, and win over SD_PERIOD", async () => {
  configure({ SD_START: "2026-03-01T00:00:00+08:00", SD_END: "2026-04-01T00:00:00+08:00", SD_PERIOD: "2025" });
  const doc = await (await makePublisher({ log: false })).build({});
  assert.deepEqual(doc.period, { start: "2026-03-01T00:00:00+08:00", end: "2026-04-01T00:00:00+08:00" });
});

test("SD_PERIOD is the whole year, month or day in UTC", async () => {
  for (const [label, end] of [["2025", "2026-01-01T00:00:00Z"], ["2026-02", "2026-03-01T00:00:00Z"], ["2026-02-28", "2026-03-01T00:00:00Z"]]) {
    configure({ SD_PERIOD: label });
    const doc = await (await makePublisher({ log: false })).build({});
    assert.equal(doc.period.start, `${label.length === 4 ? `${label}-01-01` : label.length === 7 ? `${label}-01` : label}T00:00:00Z`);
    assert.equal(doc.period.end, end);
  }
});

test("a bad period setting stops the service at start and names the variable", async () => {
  const cases = [
    [{ SD_START: "not-a-date", SD_END: "2026-10-01T00:00:00Z" }, /SD_START/],
    [{ SD_START: "2026-09-01T00:00:00Z" }, /SD_START and SD_END must be given together/],
    [{ SD_END: "2026-10-01T00:00:00Z" }, /SD_START and SD_END must be given together/],
    [{ SD_START: "2026-09-01t00:00:00z", SD_END: "2026-10-01T00:00:00Z" }, /SD_START/],
    [{ SD_START: "2026-10-01T00:00:00Z", SD_END: "2026-09-01T00:00:00Z" }, /SD_START and SD_END/],
    [{ SD_PERIOD: "2026-13" }, /SD_PERIOD/],
    [{}, /SD_START and SD_END, or SD_PERIOD, is required/],
  ];
  for (const [extra, message] of cases) {
    configure(extra);
    await assert.rejects(() => makePublisher({ log: false }), message, JSON.stringify(extra));
  }
});

test("the nine target types of the draft are accepted and no other", async () => {
  for (const type of ["origin", "path", "organization", "facility", "service", "product", "device", "tenant", "data-source"]) {
    configure({ SD_PERIOD: "2026-09", SD_TARGET_TYPE: type, SD_TARGET: type === "path" ? "/api" : "node.example" });
    assert.equal((await (await makePublisher({ log: false })).build({}))["target-type"], type);
  }
  configure({ SD_PERIOD: "2026-09", SD_TARGET_TYPE: "datacenter" });
  await assert.rejects(() => makePublisher({ log: false }), /SD_TARGET_TYPE/);
});
