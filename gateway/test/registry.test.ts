/**
 * The loader is the gateway's safety gate: a non-conformant, oversized, or
 * silently-altered document must stop the process at startup rather than reach
 * a client. These tests prove each refusal.
 */
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGateway } from "../src/app";
import { LIMITS, loadConfig } from "../src/config";
import {
  isSyntheticDomain,
  lastModifiedFrom,
  loadRegistry,
  loadSubjectFile,
  resolveBaseUrlToken,
} from "../src/registry";
import { DATA_DIR } from "./helpers";

const VALID = {
  updated: "2026-01-02T03:04:05Z",
  capabilities: "basic",
  provider: "Test",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "https://example.com/m",
  period: { start: "2025-01-01T00:00:00Z", end: "2026-01-01T00:00:00Z" },
  target: "unit.example",
  "carbon-footprint": 10,
  "carbon-unit": "tCO2e",
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
      /one declaration object/,
    );
  });

  it("rejects an array source file, however long, with one reason", async () => {
    const dir = scratch();
    const big = Array.from({ length: LIMITS.maxArrayEntries + 1 }, () => VALID);
    await expect(loadSubjectFile(write(dir, "big.example.json", big))).rejects.toThrow(
      /is an array/,
    );
  });

  it("rejects a document over the size bound", async () => {
    const dir = scratch();
    const fat = {
      ...VALID,
      extensions: {
        "urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845": {
          filler: "x".repeat(LIMITS.maxDocumentBytes),
        },
      },
    };
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
    // A score without the unit it is a score of states nothing. Dropping a
    // curated metric silently is what the load gate exists to prevent, so the
    // load fails and names the upgrade command.
    await expect(loadSubjectFile(write(dir, "sci.example.json", bad))).rejects.toThrow(
      /sustainability-publisher upgrade/,
    );
  });

  it("rejects a document the pipeline would silently alter", async () => {
    const dir = scratch();
    // A provider name in decomposed form: the publisher writes it in Normalization
    // Form C, so what would be served differs from the curated file. That must
    // fail loudly, not ship.
    const drift = { ...VALID, provider: "Cafe\u0301 Example (ops@example.com)" };
    await expect(loadSubjectFile(write(dir, "drift.example.json", drift))).rejects.toThrow(
      /would serve it differently/,
    );
  });

  it("stops on a file written for an earlier revision, and the message names the upgrade command", async () => {
    const dir = scratch();
    const { period, ...rest } = VALID;
    const forms: Record<string, unknown> = {
      "a -08 file (reporting-period)": { ...rest, "reporting-period": "2025" },
      "a -09 file (a period of two full dates)": { ...rest, period: { start: "2025-01-01", end: "2025-12-31" } },
      "a file with a retired unit": { ...VALID, "carbon-unit": "mtCO2e" },
      "a file whose updated is a date only": { ...VALID, updated: "2026-01-02" },
    };
    for (const [what, doc] of Object.entries(forms)) {
      const file = write(dir, "old.example.json", doc);
      await expect(loadSubjectFile(file), what).rejects.toThrow(/npx sustainability-publisher upgrade .*old\.example\.json/);
    }
  });
});

describe("loadRegistry", () => {
  it("loads every shipped data file, 20 of them, each equal to its served form", async () => {
    const reg = await loadRegistry(DATA_DIR);
    expect(reg.size).toBe(20);
    expect(reg.has("wikimedia.org")).toBe(true);
    for (const s of reg.values()) {
      expect(s.document.capabilities).toBe("basic");
      // The served bytes are the file's content in the publisher's own serialization.
      const { body } = await s.publisher.getSerialized({});
      expect(JSON.parse(body)).toEqual(s.document);
    }
  });

  it("does not gate _self-measured.json, which is not a declaration", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "_self-measured.json"), JSON.stringify({ months: { "2026-09": { watts: 2.4, source: "platform metrics" } } }));
    write(dir, "unit.example.json", VALID);
    const reg = await loadRegistry(dir);
    expect([...reg.keys()]).toEqual(["unit.example"]);
  });

  it("skips underscore-prefixed files and fails on an empty directory", async () => {
    const dir = scratch();
    writeFileSync(join(dir, "_notes.json"), JSON.stringify(VALID));
    await expect(loadRegistry(dir)).rejects.toThrow(/no subject documents/);
  });
});

describe("the {base} token", () => {
  // A data file that must name a declaration this gateway itself serves cannot
  // hard-code one deployment's host, and the draft requires an absolute https
  // URI. The token is resolved at load time against the serving origin.
  const doc = {
    ...VALID,
    upstream: [
      { declaration: "{base}/cloud-demo.example/.well-known/sustainability-data", role: "cloud" },
      { declaration: "https://elsewhere.example/.well-known/sustainability-data" },
    ],
  } as never;

  it("resolves only a leading token, and only in upstream declarations", () => {
    const r = resolveBaseUrlToken(doc, "https://gw.example/");
    expect(r.upstream![0].declaration).toBe(
      "https://gw.example/cloud-demo.example/.well-known/sustainability-data",
    );
    expect(r.upstream![0].role).toBe("cloud");
    expect(r.upstream![1].declaration).toBe("https://elsewhere.example/.well-known/sustainability-data");
    expect(resolveBaseUrlToken(VALID as never, "https://gw.example")).toEqual(VALID);
  });

  it("is resolved before the document is validated and served", async () => {
    const dir = scratch();
    const s = await loadSubjectFile(
      write(dir, "downstream.example.json", { ...doc, target: "downstream.example" }),
      "https://gw.example",
    );
    expect(s.document.upstream![0].declaration).toBe(
      "https://gw.example/cloud-demo.example/.well-known/sustainability-data",
    );
    // And it is what the publisher serves, not just what the loader holds.
    const { body } = await s.publisher.getSerialized({});
    expect(JSON.parse(body).upstream[0].declaration).toContain("https://gw.example/");
  });
});

describe("the gateway start", () => {
  const boot = (dir: string) =>
    createGateway({
      config: loadConfig({ port: 0, host: "127.0.0.1", dataDir: dir, maxAge: 86_400 }),
      now: new Date("2026-10-17T12:00:00Z"),
      log: () => undefined,
      fetchImpl: null,
      env: {},
      validator: null,
    });

  it("starts with the 20 declaration files of data/ and the 7 of data/withheld/ left alone", async () => {
    const gw = await boot(DATA_DIR);
    try {
      expect([...gw.subjects.keys()].filter((d) => gw.live.managed.has(d) === false && !gw.examples.has(d))).toHaveLength(20);
    } finally {
      gw.server.close();
    }
  });

  it("stops on a -09 data file, and the message names the upgrade command", async () => {
    const dir = scratch();
    cpSync(DATA_DIR, dir, { recursive: true });
    const { period, ...rest } = VALID;
    write(dir, "old.example.json", { ...rest, period: { start: "2025-01-01", end: "2025-12-31" } });
    await expect(boot(dir)).rejects.toThrow(/sustainability-publisher upgrade/);
  });

  it("stops on a -08 data file (reporting-period) as well", async () => {
    const dir = scratch();
    cpSync(DATA_DIR, dir, { recursive: true });
    const { period, ...rest } = VALID;
    write(dir, "older.example.json", { ...rest, "reporting-period": "2025" });
    await expect(boot(dir)).rejects.toThrow(/sustainability-publisher upgrade/);
  });
});

describe("helpers", () => {
  it("treats reserved TLDs as synthetic", () => {
    expect(isSyntheticDomain("a.example")).toBe(true);
    expect(isSyntheticDomain("a.invalid")).toBe(true);
    expect(isSyntheticDomain("wikimedia.org")).toBe(false);
    expect(isSyntheticDomain("notexample.com")).toBe(false);
  });

  it("derives Last-Modified from the document's own `updated` member, as the instant it names", () => {
    expect(lastModifiedFrom({ updated: "2024-06-01T00:00:00Z" } as never)).toBe(
      "Sat, 01 Jun 2024 00:00:00 GMT",
    );
    expect(lastModifiedFrom({ updated: "2024-06-01T02:00:00+02:00" } as never)).toBe(
      "Sat, 01 Jun 2024 00:00:00 GMT",
    );
  });

  it("refuses an `updated` that is not an RFC 3339 date-time with T and Z in upper case", () => {
    for (const updated of ["2024-06-01", "2024-06-01t00:00:00z", "2024-06-01T00:00:00", "2024-02-30T00:00:00Z"]) {
      expect(() => lastModifiedFrom({ updated } as never), updated).toThrow(/RFC 3339 date-time/);
    }
  });
});
