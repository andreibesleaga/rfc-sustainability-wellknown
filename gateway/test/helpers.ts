import type { AddressInfo } from "node:net";
import type { Period } from "sustainability-wellknown-publisher";
import { resolve } from "node:path";
import { createGateway, type Gateway } from "../src/app";
import { loadConfig } from "../src/config";

export const DATA_DIR = resolve(__dirname, "..", "data");

/** A fixed clock, so the gateway's own report never depends on the wall clock. */
export const FIXED_NOW = new Date("2026-10-17T12:00:00Z");

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
  /** Pin the period of the self report's parameterless answer (`SELF_PERIOD_START` and `SELF_PERIOD_END`); default: the last completed month. */
  selfPeriod?: Period;
  /**
   * Public base URL. It resolves the `{base}` token a data file uses to name a
   * declaration this gateway itself serves (the downstream demo's `upstream`),
   * so an upstream-chain test can rewrite that one origin onto the loopback
   * instance. Unset, the reference deployment's origin is used.
   */
  baseUrl?: string;
  /** Directory of the subject files; default is the gateway's own data directory. */
  dataDir?: string;
  /** Directory of the wire-format example files; default is the gateway's own examples directory. */
  examplesDir?: string;
  /** The validator's dependencies; unset disables it (tests never reach the network). */
  validator?: import("../src/validate").ValidatorDeps | null;
}

export async function startGateway(opts: StartOptions = {}): Promise<TestServer> {
  const config = loadConfig({
    port: 0,
    host: "127.0.0.1",
    dataDir: opts.dataDir ?? DATA_DIR,
    ...(opts.examplesDir !== undefined ? { examplesDir: opts.examplesDir } : {}),
    maxAge: 86_400,
    // The suites fire hundreds of requests at one server from one address;
    // the limiter has its own tests.
    rateLimit: { perMinute: opts.rateLimitPerMinute ?? 0, trustProxy: 1 },
    signingKeyJwk: opts.signingKeyJwk,
    ...(opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : {}),
  });
  // The fixed clock and the reference go-live (2026-07-30) make the self
  // report byte-stable without pinning anything.
  if (opts.selfPeriod) config.self.period = opts.selfPeriod;
  // The model tests must not depend on the operator's entered monthly figures
  // (data/_self-measured.json); those have their own tests.
  config.self.measured = false;
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
    validator: opts.validator ?? null,
  });
  await new Promise<void>((r) => gw.server.listen(0, "127.0.0.1", r));
  const { port } = gw.server.address() as AddressInfo;
  return {
    gw,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => gw.server.close(() => r())),
  };
}
