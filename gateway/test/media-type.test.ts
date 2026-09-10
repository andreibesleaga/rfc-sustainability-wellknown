/**
 * Media-type mode (draft -06 alongside a -05-compatible mode): the dedicated
 * type by default, nosniff on every gateway response, a whole-service legacy
 * default via `SUSTAINABILITY_MEDIA_TYPE`, and a per-subject override via
 * `data/_media-type.json` — so a live v05 subject and a live v06 subject can
 * coexist on the same gateway.
 */
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LEGACY_MEDIA_TYPE, MEDIA_TYPE } from "sustainability-wellknown-publisher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGateway, route, type Gateway } from "../src/app";
import { loadConfig } from "../src/config";
import { loadMediaTypeOverrides } from "../src/media-type";
import { DATA_DIR, FIXED_NOW, startGateway, type TestServer } from "./helpers";

const DOC = "/cloudflare.com/.well-known/sustainability-data";
const SELF = "/.well-known/sustainability-data";

describe("dedicated media type (service default)", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway();
  });
  afterAll(async () => {
    await srv.close();
  });
  const url = (p: string) => srv.base + p;

  it("serves a subject document with the dedicated media type and nosniff", async () => {
    const r = await fetch(url(DOC));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe(MEDIA_TYPE);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    await r.text();
  });

  it("serves the gateway's own report with the dedicated media type and nosniff", async () => {
    const r = await fetch(url(SELF));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe(MEDIA_TYPE);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    await r.text();
  });

  it("sends nosniff on a 404", async () => {
    const r = await fetch(url("/not-registered.example/.well-known/sustainability-data"));
    expect(r.status).toBe(404);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    await r.text();
  });
});

describe("SUSTAINABILITY_MEDIA_TYPE env var (config.ts)", () => {
  const KEY = "SUSTAINABILITY_MEDIA_TYPE";
  const original = process.env[KEY];
  afterAll(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("defaults to the dedicated type when unset", () => {
    delete process.env[KEY];
    expect(loadConfig({ dataDir: DATA_DIR }).mediaType).toBe("sustainability-data+json");
  });

  it("selects the legacy type for the whole service when set to json", () => {
    process.env[KEY] = "json";
    expect(loadConfig({ dataDir: DATA_DIR }).mediaType).toBe("json");
  });

  it("accepts the dedicated type spelled out explicitly", () => {
    process.env[KEY] = "sustainability-data+json";
    expect(loadConfig({ dataDir: DATA_DIR }).mediaType).toBe("sustainability-data+json");
  });

  it("fails fast on an unrecognized value", () => {
    process.env[KEY] = "text/plain";
    expect(() => loadConfig({ dataDir: DATA_DIR })).toThrow(/SUSTAINABILITY_MEDIA_TYPE/);
  });
});

describe("service-wide legacy default actually served", () => {
  let legacyGw: Gateway;
  beforeAll(async () => {
    const config = loadConfig({
      port: 0,
      host: "127.0.0.1",
      dataDir: DATA_DIR,
      maxAge: 86_400,
      mediaType: "json",
    });
    config.self.period = "2025";
    legacyGw = await createGateway({
      config,
      log: () => undefined,
      now: FIXED_NOW,
      fetchImpl: null,
      env: {},
    });
  });

  it("serves a subject document with the legacy application/json type", async () => {
    const r = await route(legacyGw, "GET", DOC);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe(LEGACY_MEDIA_TYPE);
    // Both settings send nosniff — this is not -06 conformance, just a
    // different media type for the same document.
    expect(r.headers["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("serves the gateway's own report with the legacy type too (no per-subject override applies to it)", async () => {
    const r = await route(legacyGw, "GET", SELF);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe(LEGACY_MEDIA_TYPE);
  });
});

describe("loadMediaTypeOverrides (data/_media-type.json)", () => {
  it("returns an empty map when the file is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "swk-mt-"));
    expect(loadMediaTypeOverrides(dir).size).toBe(0);
  });

  it("loads a valid domain -> media-type mapping", () => {
    const dir = mkdtempSync(join(tmpdir(), "swk-mt-"));
    writeFileSync(
      join(dir, "_media-type.json"),
      JSON.stringify({ "legacy-demo.example": "json", "modern-demo.example": "sustainability-data+json" }),
    );
    const overrides = loadMediaTypeOverrides(dir);
    expect(overrides.get("legacy-demo.example")).toBe("json");
    expect(overrides.get("modern-demo.example")).toBe("sustainability-data+json");
  });

  it("rejects an unrecognized media-type value", () => {
    const dir = mkdtempSync(join(tmpdir(), "swk-mt-"));
    writeFileSync(join(dir, "_media-type.json"), JSON.stringify({ "x.example": "text/plain" }));
    expect(() => loadMediaTypeOverrides(dir)).toThrow(/x\.example/);
  });

  it("rejects an invalid domain key", () => {
    const dir = mkdtempSync(join(tmpdir(), "swk-mt-"));
    writeFileSync(join(dir, "_media-type.json"), JSON.stringify({ "not a domain": "json" }));
    expect(() => loadMediaTypeOverrides(dir)).toThrow(/invalid domain/);
  });

  it("rejects a non-object body (e.g. an array)", () => {
    const dir = mkdtempSync(join(tmpdir(), "swk-mt-"));
    writeFileSync(join(dir, "_media-type.json"), JSON.stringify(["json"]));
    expect(() => loadMediaTypeOverrides(dir)).toThrow(/JSON object/);
  });
});

describe("per-subject override served end to end", () => {
  let dir: string;
  let overrideGw: Gateway;

  beforeAll(async () => {
    // A private copy of the shipped data/ directory (never mutate the real
    // one — it is byte-compared against ../example-responses/ by data.test.ts),
    // plus the drop-in override file pinning one real subject to the legacy
    // type.
    dir = mkdtempSync(join(tmpdir(), "swk-mt-gw-"));
    cpSync(DATA_DIR, dir, { recursive: true });
    writeFileSync(join(dir, "_media-type.json"), JSON.stringify({ "cloudflare.com": "json" }));

    const config = loadConfig({ port: 0, host: "127.0.0.1", dataDir: dir, maxAge: 86_400 });
    config.self.period = "2025";
    overrideGw = await createGateway({
      config,
      log: () => undefined,
      now: FIXED_NOW,
      fetchImpl: null,
      env: {},
    });
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves the pinned subject with the legacy type", async () => {
    const r = await route(overrideGw, "GET", DOC);
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe(LEGACY_MEDIA_TYPE);
  });

  it("leaves every other subject on the service default (dedicated type)", async () => {
    const r = await route(overrideGw, "GET", "/akamai.com/.well-known/sustainability-data");
    expect(r.status).toBe(200);
    expect(r.headers["Content-Type"]).toBe(MEDIA_TYPE);
  });
});

describe("a _media-type.json entry for a domain that is not a served subject", () => {
  it("aborts startup, the same way a stray _no-data.json entry would", async () => {
    const dir = mkdtempSync(join(tmpdir(), "swk-mt-gw-"));
    cpSync(DATA_DIR, dir, { recursive: true });
    writeFileSync(join(dir, "_media-type.json"), JSON.stringify({ "nobody-serves-this.example": "json" }));

    const config = loadConfig({ port: 0, host: "127.0.0.1", dataDir: dir, maxAge: 86_400 });
    config.self.period = "2025";
    await expect(
      createGateway({ config, log: () => undefined, now: FIXED_NOW, fetchImpl: null, env: {} }),
    ).rejects.toThrow(/nobody-serves-this\.example.*not a served subject/);

    rmSync(dir, { recursive: true, force: true });
  });
});
