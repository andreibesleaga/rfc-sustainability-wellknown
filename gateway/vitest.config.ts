import { defineConfig } from "vitest/config";

// The suites start whole gateways and fire hundreds of loopback requests; with every file
// running in parallel a slow one can pass 5 s, so the limit is generous. Every suite boots a
// gateway in beforeAll (hookTimeout), and a boot that checks the SFC demos can pass 10 s under load.
export default defineConfig({ test: { testTimeout: 30_000, hookTimeout: 30_000 } });
