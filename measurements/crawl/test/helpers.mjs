import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConsumer } from "../src/config.mjs";

export const FIXED_NOW = "2026-12-01T00:00:00.000Z";

/** Dependencies of probeOrigin with no waiting and a fixed clock. */
export function probeDeps(get, overrides = {}) {
  const saved = [];
  return {
    get,
    consumer: loadConsumer(),
    wellKnownPath: "/.well-known/sustainability-data",
    sleep: async () => {},
    now: () => FIXED_NOW,
    gapMs: 0,
    scheme: "http",
    requests: { count: 0 },
    saveDocument: async (host, id, bytes) => (saved.push([host, id, bytes.length]), `documents/${host}__${id}.body`),
    saved,
    ...overrides,
  };
}

export function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "survey-test-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  return Promise.resolve(fn(dir)).finally(cleanup);
}

export const byProbe = (records) => Object.fromEntries(records.map((r) => [r.probe, r]));
