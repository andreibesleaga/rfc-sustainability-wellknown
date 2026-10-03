// A one-click publisher: every figure comes from the environment, the document is built and
// signed by the publisher library, and the library's own server answers the well-known URI
// (headers, HEAD, 405, ETag, 304, Extended query handling). No file system state.
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Publisher, createSustainabilityServer, generateSigningKey, importSigningKey } from "sustainability-wellknown-publisher";

const METHODS = ["hardware-metered", "hardware-estimated", "cloud-billing", "third-party-modeled"];
const TARGET_TYPES = ["origin", "path", "organization", "service", "product", "device", "tenant", "data-source"];

const env = (name, fallback) => {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
};
const num = (name) => {
  const v = env(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got ${JSON.stringify(v)}`);
  return n;
};

/** What this node declares, read once at start. Change a variable and redeploy to change the document. */
export function declarationFromEnv() {
  const target = env("SD_TARGET");
  const provider = env("SD_PROVIDER");
  const methodologyUri = env("SD_METHODOLOGY_URI");
  const reportingPeriod = env("SD_PERIOD");
  for (const [k, v] of Object.entries({ SD_TARGET: target, SD_PROVIDER: provider, SD_METHODOLOGY_URI: methodologyUri, SD_PERIOD: reportingPeriod })) {
    if (!v) throw new Error(`${k} is required`);
  }
  if (!/^https:\/\//.test(methodologyUri)) throw new Error("SD_METHODOLOGY_URI must be an https URI");
  if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(reportingPeriod)) throw new Error("SD_PERIOD must be YYYY, YYYY-MM or YYYY-MM-DD");
  const energyKwh = num("SD_ENERGY_KWH");
  const carbonKg = num("SD_CARBON_KGCO2E");
  const disclosureUri = env("SD_DISCLOSURE_URI");
  if (energyKwh === undefined && carbonKg === undefined && !disclosureUri) {
    throw new Error("give at least one of SD_ENERGY_KWH, SD_CARBON_KGCO2E or SD_DISCLOSURE_URI: a declaration carries a figure or an evidence link");
  }
  // How the figures were obtained is a claim the operator makes: never defaulted.
  const measurementMethod = env("SD_MEASUREMENT_METHOD");
  if (!METHODS.includes(measurementMethod)) {
    throw new Error(`SD_MEASUREMENT_METHOD is required: one of ${METHODS.join(", ")} (hardware-metered only for a meter reading)`);
  }
  const targetType = env("SD_TARGET_TYPE", "origin");
  if (!TARGET_TYPES.includes(targetType)) throw new Error(`SD_TARGET_TYPE must be one of ${TARGET_TYPES.join(", ")}`);
  const accounting = env("SD_CARBON_ACCOUNTING");
  if (accounting !== undefined && !["location-based", "market-based"].includes(accounting)) {
    throw new Error("SD_CARBON_ACCOUNTING must be location-based or market-based");
  }
  const renewable = num("SD_RENEWABLE_PERCENT");
  if (renewable !== undefined && (renewable < 0 || renewable > 100)) throw new Error("SD_RENEWABLE_PERCENT must be 0 to 100");
  for (const [k, v] of [["SD_ENERGY_KWH", energyKwh], ["SD_CARBON_KGCO2E", carbonKg]]) {
    if (v !== undefined && v < 0) throw new Error(`${k} must not be negative`);
  }
  // Scopes are kgCO2e, like SD_CARBON_KGCO2E, whether or not a total is given (negative only for removals).
  const scopes = { scope1: num("SD_SCOPE_1"), scope2: num("SD_SCOPE_2"), scope3: num("SD_SCOPE_3") };
  const anyScope = Object.values(scopes).some((v) => v !== undefined);
  const raw = {
    provider,
    measurementMethod,
    methodologyUri,
    reportingPeriod,
    updated: env("SD_UPDATED", new Date().toISOString().replace(/\.\d{3}Z$/, "Z")),
    capabilities: "basic",
    target,
    ...(energyKwh !== undefined ? { energy: { value: energyKwh, unit: "kWh" } } : {}),
    ...(carbonKg !== undefined ? { carbon: { value: carbonKg, unit: "kgCO2e" } } : {}),
    ...Object.fromEntries(Object.entries(scopes).filter(([, v]) => v !== undefined)),
    ...(anyScope && carbonKg === undefined ? { carbonUnitHint: "kgCO2e" } : {}),
    ...(renewable !== undefined ? { renewableEnergy: renewable } : {}),
    ...(disclosureUri ? { disclosureUri } : {}),
    ...(accounting ? { carbonAccounting: accounting } : {}),
  };
  return { raw, targetType };
}

export async function makePublisher(opts = {}) {
  const { raw, targetType } = declarationFromEnv();
  const adapter = { name: "environment", capabilities: "basic", async fetch() { return raw; } };
  const keyJwk = env("SD_SIGNING_KEY_JWK");
  const key = keyJwk ? await importSigningKey(keyJwk) : await generateSigningKey("EdDSA");
  if (!keyJwk && opts.log !== false) {
    // A key generated at start changes on every restart. The private half is never printed:
    // logs are kept longer and read more widely than secrets. Generate a persistent key
    // locally and set it as a secret.
    console.error(`No SD_SIGNING_KEY_JWK set; this run signs with an ephemeral key (kid ${key.kid}, public ${JSON.stringify(key.publicJwk)}).`);
    console.error("To keep one key across restarts: npx -y -p sustainability-wellknown-publisher sustainability-publisher keygen --out key.jwk, then set SD_SIGNING_KEY_JWK to that file's content as a secret.");
  }
  return new Publisher(adapter, {
    normalize: { target: raw.target, targetType },
    signing: { key },
    cacheTtlMs: 3_600_000,
  });
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
  const publisher = await makePublisher();
  const server = createSustainabilityServer(publisher, { onError: (e) => console.error(e) });
  const port = Number(env("PORT", "8080"));
  server.listen(port, "0.0.0.0", () => console.error(`serving /.well-known/sustainability-data on :${port}`));
}
