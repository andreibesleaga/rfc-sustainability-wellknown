/**
 * Shared world for the BDD suite: the built publisher and consumer libraries,
 * the built reference gateway started on a loopback port with a fixed clock,
 * and fixture builders. Nothing here touches the network or the wall clock.
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { After, AfterAll, Before, BeforeAll, setDefaultTimeout, setWorldConstructor } from "@cucumber/cucumber";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", "..");

export const publisher = require(resolve(ROOT, "publisher", "dist", "index.js"));
export const consumer = require(resolve(ROOT, "consumer", "dist", "index.js"));
export const jose = createRequire(resolve(ROOT, "consumer", "package.json"))("jose");
const gatewayApp = require(resolve(ROOT, "gateway", "dist", "app.js"));
const gatewayConfig = require(resolve(ROOT, "gateway", "dist", "config.js"));

/** The suite's clock. Every scenario sees this instant; nothing reads Date.now(). */
export const FIXED_NOW = new Date("2026-03-10T00:00:00Z");
export const WELL_KNOWN = "/.well-known/sustainability-data";
export const MEDIA_TYPE = "application/sustainability-data+json";

setDefaultTimeout(20_000);

/** A conformant declaration object: the seven mandatory members plus energy and carbon. */
export function baseDeclaration(overrides = {}) {
  return {
    updated: "2026-02-01T00:00:00Z",
    capabilities: "basic",
    provider: "Example Org (https://example.com/contact)",
    "measurement-method": "hardware-metered",
    "methodology-uri": "https://example.com/methodology",
    "reporting-period": "2026-01",
    target: "example.com",
    "target-type": "origin",
    "energy-consumption": 120,
    "energy-unit": "kWh",
    "carbon-footprint": 29.4,
    "carbon-unit": "kgCO2e",
    ...overrides,
  };
}

/** Parse a step argument: JSON where it parses, the raw string otherwise. */
export function value(text) {
  if (/^[\[{]/.test(text) || ["true", "false", "null"].includes(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

const gateways = [];

/** Start the real gateway (built `gateway/dist`) exactly as its own tests do. */
export async function startGateway(opts = {}) {
  // The gateway signs its own report with a key generated for this run, as the
  // reference deployment does with the operator's key.
  const key = await publisher.generateSigningKey("EdDSA");
  const signingKeyJwk = JSON.stringify(await publisher.exportPrivateJwk(key));
  const config = gatewayConfig.loadConfig({
    signingKeyJwk,
    port: 0,
    host: "127.0.0.1",
    dataDir: resolve(ROOT, "gateway", "data"),
    maxAge: 86_400,
    rateLimit: { perMinute: opts.rateLimitPerMinute ?? 0, trustProxy: 1 },
  });
  config.self.period = "2025";
  config.self.liveSince = "2025-01-01T00:00:00Z";
  config.self.measured = false;
  config.self.verifiableAttestationUri = undefined;
  const gw = await gatewayApp.createGateway({
    config,
    log: () => undefined,
    now: FIXED_NOW,
    clock: () => FIXED_NOW,
    fetchImpl: null,
    env: {},
  });
  await new Promise((r) => gw.server.listen(0, "127.0.0.1", r));
  const { port } = gw.server.address();
  const handle = { gw, base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => gw.server.close(() => r())) };
  gateways.push(handle);
  return handle;
}

let shared;
export async function sharedGateway() {
  if (!shared) shared = await startGateway();
  return shared;
}

class World {
  constructor() {
    this.doc = undefined; // the declaration (object, array, or raw JSON text)
    this.result = undefined; // last validation result
    this.sig = undefined; // last signature outcome
    this.response = undefined; // last HTTP response { status, headers, body }
    this.statuses = []; // statuses of a burst
    this.base = undefined; // origin under test
    this.servers = []; // ad-hoc local servers to close
    this.fetchCalls = 0;
    this.key = undefined;
  }
}
setWorldConstructor(World);

BeforeAll(async () => {
  await sharedGateway();
});

Before(function () {
  this.servers = [];
});

After(async function () {
  for (const s of this.servers) await new Promise((r) => s.close(() => r()));
});

AfterAll(async () => {
  for (const g of gateways) await g.close();
});
