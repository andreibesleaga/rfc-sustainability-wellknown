/**
 * Runtime configuration, entirely from the environment so the same image runs
 * unchanged on Railway, on a laptop, or in CI.
 *
 * Railway (like every other PaaS) injects `PORT`; nothing else is required.
 */
import type { HandlerOptions } from "sustainability-wellknown-publisher";
import { resolve } from "node:path";

/** Read an env var, falling back to a default. Empty string counts as unset. */
function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

/**
 * The public origin of the reference deployment. It is the fallback for the
 * `{base}` token a data file uses to name a declaration this gateway itself
 * serves (registry.ts): with `BASE_URL` configured that value is used instead,
 * so the token always resolves to the origin the declaration is really served
 * from.
 */
export const PUBLIC_BASE_URL = "https://sustainability.up.railway.app";

/** A non-negative whole number, e.g. a count of proxies. */
function envCount(name: string, fallback: number): number {
  const n = envNum(name, fallback);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`config: ${name} must be a non-negative whole number (got ${n})`);
  }
  return n;
}

/** An absolute http(s) URL, or the fallback when unset. */
function envUrl(name: string, fallback: string): string {
  const v = (process.env[name] || fallback).replace(/\/+$/, "");
  if (v === "") return v;
  let url: URL | undefined;
  try {
    url = new URL(v);
  } catch {
    url = undefined;
  }
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) {
    throw new Error(`config: ${name} must be an absolute http(s) URL (got ${JSON.stringify(v)})`);
  }
  return v;
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

/** The two media types `handleRequest` can serve a 200 document response as: the publisher's own union. */
export type MediaTypeSetting = NonNullable<HandlerOptions["mediaType"]>;

export const MEDIA_TYPE_VALUES: readonly MediaTypeSetting[] = [
  "sustainability-data+json",
  "json",
];

/** An RFC 3339 instant from the environment, validated at load time. */
function envInstant(name: string, fallback: string): string {
  const v = env(name, fallback);
  if (Number.isNaN(Date.parse(v))) {
    throw new Error(`config: ${name} must be an RFC 3339 date-time (got ${JSON.stringify(v)})`);
  }
  return new Date(v).toISOString().replace(/\.\d{3}Z$/, "Z");
}

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
   * Whole-service default media type for a 200 declaration response.
   * `"sustainability-data+json"` (default) serves the dedicated
   * `application/sustainability-data+json` type, required by draft -07
   * §Mandatory Minimum Supported Service. `"json"` serves the generic
   * `application/json` type under which declarations published before the
   * registration exist, which a consumer MAY still process — NOT conformant
   * publishing. Set via `SUSTAINABILITY_MEDIA_TYPE`. A subject listed in
   * `data/_media-type.json` (see `media-type.ts`) overrides this default for
   * that one domain, so such a subject can coexist with conformant ones on the
   * same gateway. Both settings send `X-Content-Type-Options: nosniff`; error
   * responses (400/404/405/503) always use `application/json`, unaffected by
   * this setting.
   */
  mediaType: MediaTypeSetting;
  /**
   * Request rate limiting (draft Security Considerations §Denial of Service: servers SHOULD
   * rate-limit requests to the well-known URI). Applied per client, before
   * routing, to every path except `/healthz`. `perMinute: 0` disables it.
   * The client is identified by the last `X-Forwarded-For` entry when
   * `trustProxy` is 1 (the reference deployment sits behind Railway's proxy),
   * else by the socket address — set `TRUST_PROXY=0` when exposing the
   * process directly, or a client could rotate spoofed addresses.
   */
  rateLimit: { perMinute: number; trustProxy: number };
  /**
   * Private JWK (JSON text) of the key that signs the gateway's OWN report
   * (draft -07 §Signing). When set, every declaration object the self report
   * emits — the parameterless one and each object of an Extended trend —
   * carries a `signed` member, a JWS over that object. Unset, the gateway does
   * not sign and the member is simply absent, which the draft says means only
   * that the publisher did not sign. Set via `SUSTAINABILITY_SIGNING_KEY`;
   * imported and checked at boot.
   */
  signingKeyJwk?: string;

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
    /**
     * The instant this gateway went live (RFC 3339). The model counts only
     * hours inside `[liveSince, now)`: a period before it has no data (404),
     * a period in progress reports the completed portion to date.
     */
    liveSince: string;
    /** `verifiable-attestation-uri` of the self report: a third-party signed statement about the model. */
    verifiableAttestationUri?: string;
    /** Where the PUBLIC signing key is hosted, so a verifier can pin it and match it by `kid` (display and index only; the key itself travels in the JWS header as `jwk`). */
    signingKeyUrl?: string;
  };
}

/**
 * Response and document bounds (draft Security Considerations: Denial of
 * Service). These are enforced by the loader and asserted by
 * the test suite, and are documented in GUIDE.md.
 */
export const LIMITS = {
  /** Largest source document accepted from `data/` and from an adapter's parameterless build (Extended variants are bounded by the entry cap instead). */
  maxDocumentBytes: 256 * 1024,
  /**
   * Cap on array entries. -07 removes the server-side cap in favour of a
   * consumer-side bound, so this is a defensive default of this deployment,
   * not a requirement it has to meet; 366 is the calendar bound the draft
   * notes for daily granularity over a year. Relayed subjects are served at
   * the Basic service, whose parameterless response MUST be a single JSON
   * object, so array source documents are refused outright; the gateway's own
   * report is Extended (period/granularity honoured), and the cap is kept as
   * a second, explicit bound.
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
    baseUrl: envUrl("BASE_URL", ""),
    mediaType: envMediaType("SUSTAINABILITY_MEDIA_TYPE", "sustainability-data+json"),
    rateLimit: {
      perMinute: envNum("RATE_LIMIT_PER_MINUTE", 600),
      trustProxy: envCount("TRUST_PROXY", 1),
    },
    signingKeyJwk: process.env.SUSTAINABILITY_SIGNING_KEY || undefined,
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
      liveSince: envInstant("SELF_LIVE_SINCE", "2026-07-30T00:00:00Z"),
      verifiableAttestationUri: process.env.SELF_ATTESTATION_URI || undefined,
      signingKeyUrl: process.env.SELF_SIGNING_KEY_URL ? envUrl("SELF_SIGNING_KEY_URL", "") : undefined,
    },
  };
  return {
    ...base,
    ...overrides,
    rateLimit: { ...base.rateLimit, ...overrides.rateLimit },
    self: { ...base.self, ...overrides.self },
  };
}
