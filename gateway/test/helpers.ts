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

export async function startGateway(): Promise<TestServer> {
  const config = loadConfig({
    port: 0,
    host: "127.0.0.1",
    dataDir: DATA_DIR,
    maxAge: 86_400,
  });
  // Pin the self-report period so ETags and bodies are byte-stable.
  config.self.period = "2025";
  const gw = await createGateway({ config, log: () => undefined, now: FIXED_NOW });
  await new Promise<void>((r) => gw.server.listen(0, "127.0.0.1", r));
  const { port } = gw.server.address() as AddressInfo;
  return {
    gw,
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => gw.server.close(() => r())),
  };
}
