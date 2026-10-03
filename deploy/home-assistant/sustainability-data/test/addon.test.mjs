import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { Publisher } from "sustainability-wellknown-publisher";
import { makeAdapter, monthsFromSnapshots, readSensor, snapshotIfDue } from "../server.mjs";

const consumer = createRequire(import.meta.url)("sustainability-wellknown-consumer");
const cfg = { provider: "A household (role contact)", methodologyUri: "https://home.example/how", target: "home.example", gridIntensity: 245 };

/** A fake Core API: one total_increasing kWh sensor whose value we move. */
function fakeHa(values) {
  let i = 0;
  return async (url) => new Response(JSON.stringify({ state: String(values[Math.min(i++, values.length - 1)]), attributes: { unit_of_measurement: "kWh" }, last_updated: "2026-02-01T00:00:00Z" }), { status: 200 });
}

test("the sensor is read through the API and units are normalized to kWh", async () => {
  const r = await readSensor({ api: "http://supervisor/core/api", token: "t", sensor: "sensor.energy_total", fetchImpl: fakeHa([1234.5]) });
  assert.equal(r.kwh, 1234.5);
  const wh = await readSensor({ api: "x", token: "t", sensor: "s", fetchImpl: async () => new Response(JSON.stringify({ state: "5000", attributes: { unit_of_measurement: "Wh" } })) });
  assert.equal(wh.kwh, 5);
});

test("readings on the 1st bound a month; completed months become metered declarations", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ha-"));
  const reads = fakeHa([1000, 1120.25, 1250]);
  const reader = () => readSensor({ api: "x", token: "t", sensor: "s", fetchImpl: reads });
  assert.equal(await snapshotIfDue({ stateDir: dir, sensorReader: reader, now: new Date("2026-01-01T00:30:00Z") }), true);
  assert.equal(await snapshotIfDue({ stateDir: dir, sensorReader: reader, now: new Date("2026-01-15T00:30:00Z") }), false);
  assert.equal(await snapshotIfDue({ stateDir: dir, sensorReader: reader, now: new Date("2026-02-01T00:30:00Z") }), true);
  assert.equal(await snapshotIfDue({ stateDir: dir, sensorReader: reader, now: new Date("2026-03-01T00:30:00Z") }), true);
  const pub = new Publisher(makeAdapter(dir, cfg), { cacheTtlMs: 0, normalize: { target: cfg.target, targetType: "device" } });
  const months = await pub.build({ period: "2026", granularity: "monthly" });
  assert.deepEqual(months.map((m) => [m["reporting-period"], m["energy-consumption"], m["measurement-method"]]), [["2026-01", 120.25, "hardware-metered"], ["2026-02", 129.75, "hardware-metered"]]);
  for (const m of months) assert.equal(consumer.validateDocument(m).valid, true, JSON.stringify(consumer.validateDocument(m).errors));
  assert.equal(months[0]["carbon-footprint"], 120.25 * 245);
});

test("an install in the middle of a month publishes only the first full month after it", () => {
  const snaps = {
    "2026-10-01": { kwh: 100, at: "2026-10-20T09:00:00.000Z" }, // installed on the 20th
    "2026-11-01": { kwh: 150, at: "2026-11-01T00:05:00.000Z" },
    "2026-12-01": { kwh: 260, at: "2026-12-01T00:05:00.000Z" },
  };
  assert.deepEqual(monthsFromSnapshots(snaps, cfg).map((m) => [m.reportingPeriod, m.energy.value]), [["2026-11", 110]]);
});

test("a missed boundary leaves both adjoining months unreported, and a skipped month is never summed", () => {
  const late = { "2026-10-01": { kwh: 0, at: "2026-10-01T00:05:00.000Z" }, "2026-11-01": { kwh: 50, at: "2026-11-05T12:00:00.000Z" }, "2026-12-01": { kwh: 90, at: "2026-12-01T00:05:00.000Z" } };
  assert.deepEqual(monthsFromSnapshots(late, cfg), []);
  const gap = { "2026-10-01": { kwh: 0, at: "2026-10-01T00:05:00.000Z" }, "2026-12-01": { kwh: 90, at: "2026-12-01T00:05:00.000Z" } };
  assert.deepEqual(monthsFromSnapshots(gap, cfg), []);
});

test("a legacy reading without a time bounds nothing", () => {
  assert.deepEqual(monthsFromSnapshots({ "2026-10-01": 0, "2026-11-01": { kwh: 5, at: "2026-11-01T00:00:00.000Z" } }, cfg), []);
});

test("a meter reset leaves that month unreported rather than negative", () => {
  const months = monthsFromSnapshots({
    "2026-01-01": { kwh: 500, at: "2026-01-01T00:00:00.000Z" },
    "2026-02-01": { kwh: 20, at: "2026-02-01T00:00:00.000Z" },
    "2026-03-01": { kwh: 80, at: "2026-03-01T00:00:00.000Z" },
  }, cfg);
  assert.deepEqual(months.map((m) => m.reportingPeriod), ["2026-02"]);
});
