import { defineConfig } from "vitest/config";

// The suites start whole gateways and fire hundreds of loopback requests; with every file
// running in parallel a slow one can pass 5 s, so the limit is generous.
export default defineConfig({ test: { testTimeout: 30_000 } });
