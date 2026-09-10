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

/**
 * The two media types `handleRequest` (from `sustainability-wellknown-publisher`
 * 0.6.0) can serve a 200 document response as. Mirrors its `HandlerOptions.mediaType`
 * union exactly, kept local so `config.ts` does not need a compile-time dependency
 * on the publisher package just for this literal type.
 */
export type MediaTypeSetting = "sustainability-data+json" | "json";

export const MEDIA_TYPE_VALUES: readonly MediaTypeSetting[] = [
  "sustainability-data+json",
  "json",
];

function envMediaType(name: string, fallback: MediaTypeSetting): MediaTypeSetting {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  if (!MEDIA_TYPE_VALUES.includes(v as MediaTypeSetting)) {
    throw new Error(
      `config: ${name} must be one of ${MEDIA_TYPE_VALUES.join(", ")} (got ${JSON.stringify(v)})`,
    );
  }
  return v as MediaTypeSetting;
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
  /**
   * Whole-service default media type for a 200 document response.
   * `"sustainability-data+json"` (default) serves the -06 dedicated
   * `application/sustainability-data+json` type, required by draft -06
   * §Mandatory Minimum Supported Service. `"json"` serves the legacy
   * `application/json` type that draft -05 and earlier used, for a
   * v05-compatible deployment — NOT -06 conformant. Set via
   * `SUSTAINABILITY_MEDIA_TYPE`. A subject listed in `data/_media-type.json`
   * (see `media-type.ts`) overrides this default for that one domain, so a
   * legacy subject can coexist with -06-default subjects on the same gateway.
   * Both settings send `X-Content-Type-Options: nosniff`; error responses
   * (404/405/503) always use `application/json`, unaffected by this setting.
   */
  mediaType: MediaTypeSetting;

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
    mediaType: envMediaType("SUSTAINABILITY_MEDIA_TYPE", "sustainability-data+json"),
    self: {
      target: env("SELF_TARGET", "sustainability-data-gateway"),
      provider: env(
        "SELF_PROVIDER",
        "Andrei Besleaga, operator of this reference gateway",
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
