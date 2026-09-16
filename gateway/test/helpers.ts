import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { createGateway, type Gateway } from "../src/app";
import { loadConfig } from "../src/config";

export const DATA_DIR = resolve(__dirname, "..", "data");

/** A fixed clock, so the gateway's own report never depends on the wall clock. */
export const FIXED_NOW = new Date("2026-03-10T00:00:00Z");

export interface TestServer {
  gw: Gateway;
  base: string;
  close: () => Promise<void>;
}

export interface StartOptions {
  /** Private JWK (JSON text) for the gateway's own signature; unset = the gateway does not sign. */
  signingKeyJwk?: string;
  /** Requests per client per minute; the default 0 disables the limiter for the suites. */
  rateLimitPerMinute?: number;
  /** `verifiable-attestation-uri` of the self report. */
  attestationUri?: string;
  /** Override the fixed clock (both `now` and the running clock). */
  now?: Date;
  /** Leave `SELF_PERIOD` unpinned (Extended self-report tests) . */
  unpinPeriod?: boolean;
  /**
   * Public base URL. It resolves the `{base}` token a data file uses to name a
   * declaration this gateway itself serves (the downstream demo's `upstream`),
   * so an upstream-chain test can rewrite that one origin onto the loopback
   * instance. Unset, the reference deployment's origin is used.
   */
  baseUrl?: string;
}

export async function startGateway(opts: StartOptions = {}): Promise<TestServer> {
  const config = loadConfig({
    port: 0,
    host: "127.0.0.1",
    dataDir: DATA_DIR,
    maxAge: 86_400,
    // The suites fire hundreds of requests at one server from one address;
    // the limiter has its own tests.
    rateLimit: { perMinute: opts.rateLimitPerMinute ?? 0, trustProxy: 1 },
    signingKeyJwk: opts.signingKeyJwk,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
  });
  // Pin the self-report period so ETags and bodies are byte-stable, and put
  // go-live before it so the pinned period has its full hours.
  if (!opts.unpinPeriod) config.self.period = "2025";
  config.self.liveSince = "2025-01-01T00:00:00Z";
  config.self.verifiableAttestationUri = opts.attestationUri;
  // fetchImpl: null — live upstreams are DISABLED in tests; every adapter
  // demonstration boots from its recorded fixture (deterministic, offline).
  const now = opts.now ?? FIXED_NOW;
  const gw = await createGateway({
    config,
    log: () => undefined,
    now,
    clock: () => now,
    fetchImpl: null,
    env: {},
  });
  await new Promise<void>((r) => gw.server.listen(0, "127.0.0.1", r));
  const { port } = gw.server.address() as AddressInfo;
  return {
    gw,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => gw.server.close(() => r())),
  };
}
