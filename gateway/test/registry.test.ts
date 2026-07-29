/**
 * The loader is the gateway's safety gate: a non-conformant, oversized, or
 * silently-altered document must stop the process at startup rather than reach
 * a client. These tests prove each refusal.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/config";
import {
  isSyntheticDomain,
  lastModifiedFrom,
  loadRegistry,
  loadSubjectFile,
} from "../src/registry";
import { DATA_DIR } from "./helpers";

const VALID = {
  version: "2.0",
  updated: "2026-01-02T03:04:05Z",
  capabilities: "basic",
  provider: "Test",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "https://example.com/m",
  "reporting-period": "2025",
  target: "unit.example",
  "carbon-footprint": 10,
  "carbon-unit": "mtCO2e",
  "target-type": "organization",
};

function scratch(): string {
  return mkdtempSync(join(tmpdir(), "swk-gw-"));
}

function write(dir: string, name: string, value: unknown): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value, null, 2));
  return p;
}

describe("loadSubjectFile", () => {
  it("accepts a conformant document named after a domain", async () => {
    const dir = scratch();
    const s = await loadSubjectFile(write(dir, "unit.example.json", VALID));
    expect(s.domain).toBe("unit.example");
    expect(s.synthetic).toBe(true);
    expect(s.lastModified).toBe("Fri, 02 Jan 2026 03:04:05 GMT");
    expect(s.document).toEqual(VALID);
  });

  it("rejects a filename that is not a domain", async () => {
    const dir = scratch();
    await expect(loadSubjectFile(write(dir, "notadomain.json", VALID))).rejects.toThrow(
      /lowercase domain name/,
    );
  });

  it("rejects an array document (the Basic response is a single object)", async () => {
    const dir = scratch();
    await expect(loadSubjectFile(write(dir, "arr.example.json", [VALID, VALID]))).rejects.toThrow(
      /single JSON object/,
    );
  });

  it("rejects an array over the 366-object cap before anything else", async () => {
    const dir = scratch();
    const big = Array.from({ length: LIMITS.maxArrayEntries + 1 }, () => VALID);
    await expect(loadSubjectFile(write(dir, "big.example.json", big))).rejects.toThrow(
      /366-object cap/,
    );
  });

  it("rejects a document over the size bound", async () => {
    const dir = scratch();
    const fat = { ...VALID, "com.example.filler": "x".repeat(LIMITS.maxDocumentBytes) };
    await expect(loadSubjectFile(write(dir, "fat.example.json", fat))).rejects.toThrow(
      /document bound/,
    );
  });

  it("rejects a document missing a mandatory member", async () => {
    const dir = scratch();
    const { target, ...noTarget } = VALID;
    await expect(loadSubjectFile(write(dir, "bad.example.json", noTarget))).rejects.toThrow();
  });

  it("rejects a document with an out-of-range value", async () => {
    const dir = scratch();
    const bad = { ...VALID, "renewable-energy": 140 };
    await expect(loadSubjectFile(write(dir, "range.example.json", bad))).rejects.toThrow(
      /renewable-energy/,
    );
  });

  it("rejects sci-score without its mandatory functional-unit", async () => {
    const dir = scratch();
    const bad = { ...VALID, "sci-score": 1.5 };
    // The publisher's client-tolerance rule drops an sci-score that is missing
    // its required functional-unit. Dropping a curated metric silently is
    // exactly what the round-trip gate exists to prevent, so the load fails.
    await expect(loadSubjectFile(write(dir, "sci.example.json", bad))).rejects.toThrow(
      /round-trip/,
    );
  });

  it("rejects a document the pipeline would silently alter", async () => {
    const dir = scratch();
    // 5 decimal places: the normalizer rounds to 4, so what would be served
    // differs from the curated file. That must fail loudly, not ship.
    const drift = { ...VALID, "carbon-footprint": 10.123456 };
    await expect(loadSubjectFile(write(dir, "drift.example.json", drift))).rejects.toThrow(
      /round-trip/,
    );
  });
});

describe("loadRegistry", () => {
  it("loads every shipped data file", async () => {
    const reg = await loadRegistry(DATA_DIR);
    expect(reg.size).toBeGreaterThanOrEqual(3);
    expect(reg.has("cloudflare.com")).toBe(true);
    for (const s of reg.values()) expect(s.document.capabilities).toBe("basic");
  });

  it("skips underscore-prefixed files and fails on an empty directory", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "_notes.json"), JSON.stringify(VALID));
    await expect(loadRegistry(dir)).rejects.toThrow(/no subject documents/);
  });
});

describe("helpers", () => {
  it("treats reserved TLDs as synthetic", () => {
    expect(isSyntheticDomain("a.example")).toBe(true);
    expect(isSyntheticDomain("a.invalid")).toBe(true);
    expect(isSyntheticDomain("cloudflare.com")).toBe(false);
    expect(isSyntheticDomain("notexample.com")).toBe(false);
  });

  it("derives Last-Modified from the document's own `updated` member", () => {
    expect(lastModifiedFrom({ updated: "2024-06-01T00:00:00Z" } as never)).toBe(
      "Sat, 01 Jun 2024 00:00:00 GMT",
    );
  });
});
