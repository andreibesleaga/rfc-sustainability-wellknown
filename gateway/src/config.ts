/**
 * Runtime configuration, entirely from the environment so the same image runs
 * unchanged on Railway, on a laptop, or in CI.
 *
 * Railway (like every other PaaS) injects `PORT`; nothing else is required.
 */
import { resolve } from "node:path";

/** Read an env var, falling back to a default. Empty string counts as unset. */
function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`config: ${name} must be a finite number (got ${JSON.stringify(v)})`);
  }
  return n;
}

export interface GatewayConfig {
  port: number;
  host: string;
  /** Directory holding one wire-format JSON document per reporting subject. */
  dataDir: string;
  /** Directory holding the canonical wire-format example documents. */
  examplesDir: string;
  /** Cache-Control max-age, seconds. Draft Operational Considerations RECOMMENDS 86400. */
  maxAge: number;
  /** Public base URL, used only for absolute links in the HTML/JSON index. */
  baseUrl: string;

  /** ---- the gateway's OWN report (target-type: "service") ---- */
  self: {
    /** The `target` member of the gateway's own document. */
    target: string;
    /** The `provider` member: who operates this gateway. */
    provider: string;
    /** Public methodology document for the gateway's own estimate. */
    methodologyUri: string;
    /** Public disclosure index for the gateway. */
    disclosureUri: string;
    /**
     * `reporting-period` for the gateway's own report. Default: the most
     * recently completed full calendar month (the draft's Basic default for a
     * publisher that reports more frequently than annually). Pinning this via
     * the environment makes the document byte-stable, which is what tests do.
     */
    period?: string;
    /** Modelled average power draw of the gateway container, in watts. */
    watts: number;
    /** Grid carbon intensity used for the estimate, gCO2e/kWh. */
    gridIntensity: number;
  };
}

/**
 * Response and document bounds (draft Security Considerations: Denial of
 * Service, Array Size Limits). These are enforced by the loader and asserted by
 * the test suite, and are documented in GUIDE.md.
 */
export const LIMITS = {
  /** Largest source document accepted from `data/`, and largest body served. */
  maxDocumentBytes: 256 * 1024,
  /**
   * Draft RECOMMENDED cap on array entries. The gateway serves the Basic
   * service, whose parameterless response MUST be a single JSON object, so
   * array documents are refused outright; the cap is kept as a second,
   * explicit bound.
   */
  maxArrayEntries: 366,
  /** Longest domain label path segment accepted on a request line. */
  maxDomainLength: 253,
} as const;

export function loadConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  const base: GatewayConfig = {
    port: envNum("PORT", 8080),
    // Railway (and every container platform) requires binding all interfaces,
    // not the loopback address.
    host: env("HOST", "0.0.0.0"),
    dataDir: resolve(env("DATA_DIR", resolve(__dirname, "..", "data"))),
    examplesDir: resolve(env("EXAMPLES_DIR", resolve(__dirname, "..", "examples"))),
    maxAge: envNum("MAX_AGE", 86_400),
    baseUrl: env("BASE_URL", "").replace(/\/+$/, ""),
    self: {
      target: env("SELF_TARGET", "sustainability-data-gateway"),
      provider: env(
        "SELF_PROVIDER",
        "Andrei Nicolae Besleaga (andrei.besleaga@ieee.org), operator of this reference gateway",
      ),
      methodologyUri: env(
        "SELF_METHODOLOGY_URI",
        "https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/gateway/METHODOLOGY.md",
      ),
      disclosureUri: env(
        "SELF_DISCLOSURE_URI",
        "https://github.com/andreibesleaga/rfc-sustainability-wellknown/tree/main/gateway",
      ),
      period: process.env.SELF_PERIOD || undefined,
      watts: envNum("SELF_WATTS", 3),
      gridIntensity: envNum("SELF_GRID_INTENSITY", 373),
    },
  };
  return { ...base, ...overrides, self: { ...base.self, ...overrides.self } };
}
