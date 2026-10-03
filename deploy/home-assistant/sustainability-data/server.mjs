// Home Assistant add-on: reads a total-increasing energy sensor (kWh) through the Core API,
// keeps one reading per month boundary in /data, and serves a signed declaration per completed
// month: energy = reading on the 1st of the next month minus reading on the 1st of the month (UTC).
// The first published month is the first full calendar month after installation. hardware-metered:
// the figure is the meter's own counter (a smart meter, a plug or a CT clamp integration).
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { NotFoundError, Publisher, createSustainabilityServer, exportPrivateJwk, generateSigningKey, importSigningKey } from "sustainability-wellknown-publisher";

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);

/** Reads the sensor's state (kWh, total_increasing) from the Core API. */
export async function readSensor({ api, token, sensor, fetchImpl = fetch }) {
  const r = await fetchImpl(`${api}/states/${sensor}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`Home Assistant answered ${r.status} for ${sensor}`);
  const s = await r.json();
  const unit = s.attributes?.unit_of_measurement;
  const value = Number(s.state);
  if (!Number.isFinite(value)) throw new Error(`sensor ${sensor} has no numeric state (${s.state})`);
  const kwh = unit === "Wh" ? value / 1000 : unit === "MWh" ? value * 1000 : value;
  return { kwh, unit: unit ?? "kWh", lastUpdated: s.last_updated };
}

/**
 * Snapshots: { "YYYY-MM-01": { kwh, at } }, one counter reading per month, taken on the first poll of
 * the month. A reading counts as the month's boundary only when it was taken on day 1 of that month
 * (UTC); a first start or a restart later in the month records a reading that bounds nothing, so a
 * partial month is never published as a whole one. A legacy bare number has no time and counts as
 * not taken on the boundary.
 */
export function loadSnapshots(dir) {
  const p = join(dir, "snapshots.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : {};
}
export function saveSnapshots(dir, snaps) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "snapshots.json"), JSON.stringify(snaps, null, 2));
}

/** True when the reading for month key "YYYY-MM-01" was taken on that day (UTC). */
function onBoundary(key, snap) {
  return typeof snap === "object" && snap !== null && typeof snap.at === "string" && snap.at.slice(0, 10) === key;
}

/** The "YYYY-MM-01" key of the month after the given key. */
function nextMonthKey(key) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

/** Completed calendar months whose start and end readings were both taken on their boundary day. */
export function monthsFromSnapshots(snaps, cfg) {
  const out = [];
  for (const start of Object.keys(snaps).sort()) {
    const end = nextMonthKey(start);
    if (!(end in snaps) || !onBoundary(start, snaps[start]) || !onBoundary(end, snaps[end])) continue;
    const kwh = snaps[end].kwh - snaps[start].kwh;
    if (!(kwh >= 0)) continue; // a meter replaced or reset: that month is not reported
    out.push({
      provider: cfg.provider,
      measurementMethod: "hardware-metered",
      methodologyUri: cfg.methodologyUri,
      reportingPeriod: start.slice(0, 7),
      capabilities: "extended",
      target: cfg.target,
      energy: { value: Math.round(kwh * 1000) / 1000, unit: "kWh" },
      ...(cfg.gridIntensity > 0 ? { carbonIntensity: cfg.gridIntensity } : {}),
    });
  }
  return out;
}

export function makeAdapter(stateDir, cfg) {
  return {
    name: "home-assistant-energy",
    capabilities: "extended",
    async fetch(query) {
      const months = monthsFromSnapshots(loadSnapshots(stateDir), cfg);
      if (months.length === 0) throw new NotFoundError();
      if (!query.period) return months[months.length - 1];
      const inside = months.filter((m) => m.reportingPeriod.startsWith(query.period));
      if (!inside.length) throw new NotFoundError();
      return inside;
    },
  };
}

/** Records this month's reading if it has none yet. Called at start and every ten minutes. */
export async function snapshotIfDue({ stateDir, sensorReader, now = new Date() }) {
  const key = `${now.toISOString().slice(0, 7)}-01`;
  const snaps = loadSnapshots(stateDir);
  if (snaps[key] !== undefined) return false;
  const { kwh } = await sensorReader();
  snaps[key] = { kwh, at: now.toISOString() };
  saveSnapshots(stateDir, snaps);
  return true;
}

/** True when this file is the program being run, also through an npm bin symlink or on Windows. */
function isMainModule() {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const cfg = {
    provider: env("SD_PROVIDER", "A household"),
    methodologyUri: env("SD_METHODOLOGY_URI", ""),
    target: env("SD_TARGET", "home.example"),
    targetType: env("SD_TARGET_TYPE", "device"),
    gridIntensity: Number(env("SD_GRID_INTENSITY", "0")),
  };
  const stateDir = env("SD_STATE_DIR", "./data");
  const sensorReader = () => readSensor({ api: env("HA_API"), token: env("HA_TOKEN"), sensor: env("HA_ENERGY_SENSOR") });
  const keyFile = join(stateDir, "signing-key.jwk");
  mkdirSync(stateDir, { recursive: true });
  const key = existsSync(keyFile) ? await importSigningKey(readFileSync(keyFile, "utf8")) : await generateSigningKey("EdDSA");
  if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify(await exportPrivateJwk(key)), { mode: 0o600 });
  const publisher = new Publisher(makeAdapter(stateDir, cfg), { normalize: { target: cfg.target, targetType: cfg.targetType }, signing: { key }, cacheTtlMs: 3_600_000 });
  await snapshotIfDue({ stateDir, sensorReader }).catch((e) => console.error(`snapshot: ${e.message}`));
  setInterval(() => snapshotIfDue({ stateDir, sensorReader }).catch((e) => console.error(`snapshot: ${e.message}`)), 600_000);
  createSustainabilityServer(publisher, { onError: (e) => console.error(e) }).listen(Number(env("PORT", "8099")), "0.0.0.0");
}
