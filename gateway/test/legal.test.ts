/**
 * The legal notice and the out-of-band markers on third-party documents.
 *
 * A document about a real organization is an unendorsed mapping. Besides the
 * in-band `provider` statement (enforced in data.test.ts), the gateway says so
 * at the HTTP layer and publishes the terms and the removal procedure.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isThirdPartyMapping } from "../src/app";
import { ISSUES_URL, LEGAL_PATH, LEGAL_TEXT, LEGAL_VERSION, OPERATOR_EMAIL, OPERATOR_NAME } from "../src/legal";
import { DATA_DIR, startGateway, type TestServer } from "./helpers";

let srv: TestServer;
beforeAll(async () => {
  srv = await startGateway();
});
afterAll(async () => {
  await srv.close();
});
const url = (p: string) => srv.base + p;
const WK = "/.well-known/sustainability-data";

describe("GET /legal", () => {
  it("serves the notice as text, cacheable, with CORS", async () => {
    const r = await fetch(url(LEGAL_PATH));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(await r.text()).toBe(LEGAL_TEXT);
  });

  it("405s a non-GET method", async () => {
    const r = await fetch(url(LEGAL_PATH), { method: "POST" });
    expect(r.status).toBe(405);
    await r.text();
  });

  it("says what a reporting subject needs to know", () => {
    expect(LEGAL_TEXT).toContain(LEGAL_VERSION);
    expect(LEGAL_TEXT).toContain(OPERATOR_NAME);
    expect(LEGAL_TEXT).toContain(OPERATOR_EMAIL);
    expect(LEGAL_TEXT).toContain(ISSUES_URL);
    expect(LEGAL_TEXT).toMatch(/NOT published, reviewed, authorized or endorsed/);
    expect(LEGAL_TEXT).toMatch(/removal requested by the organization[^.]*without the organization having to give a reason/);
    expect(LEGAL_TEXT).toMatch(/No text, table, chart, image, logo or layout/);
    expect(LEGAL_TEXT).toMatch(/trademarks, belong to their owners/);
    expect(LEGAL_TEXT).toMatch(/never cryptographically signed by the operator/);
    expect(LEGAL_TEXT).not.toContain("${");
  });

  it("is identical to gateway/LEGAL.md", () => {
    const file = resolve(DATA_DIR, "..", "LEGAL.md");
    if (!existsSync(file)) return; // packaged deployment: only dist/ and data/ are shipped
    expect(readFileSync(file, "utf8")).toBe(LEGAL_TEXT);
  });
});

describe("documents about real third parties", () => {
  it("carry noindex and a terms-of-service link, on 200 and on 304", async () => {
    const real = [...srv.gw.subjects.values()].filter(isThirdPartyMapping);
    expect(real.length).toBeGreaterThanOrEqual(9);
    for (const s of real) {
      const r = await fetch(url(`/${s.domain}${WK}`));
      expect(r.status, s.domain).toBe(200);
      expect(r.headers.get("x-robots-tag"), s.domain).toBe("noindex");
      expect(r.headers.get("link"), s.domain).toMatch(/^<https:\/\/[^>]+\/legal>; rel="terms-of-service"$/);
      const etag = r.headers.get("etag")!;
      await r.text();
      const again = await fetch(url(`/${s.domain}${WK}`), { headers: { "If-None-Match": etag } });
      expect(again.status, s.domain).toBe(304);
      expect(again.headers.get("x-robots-tag"), s.domain).toBe("noindex");
    }
  });

  it("are never signed by the gateway", () => {
    for (const s of [...srv.gw.subjects.values()].filter(isThirdPartyMapping)) {
      expect((s.document as Record<string, unknown>).signed, s.domain).toBeUndefined();
      const onDisk = JSON.parse(readFileSync(join(DATA_DIR, `${s.domain}.json`), "utf8"));
      expect(onDisk.signed, s.domain).toBeUndefined();
    }
  });

  it("are exactly the non-synthetic data files", () => {
    for (const s of srv.gw.subjects.values()) {
      const fileBacked = existsSync(join(DATA_DIR, `${s.domain}.json`));
      expect(isThirdPartyMapping(s), s.domain).toBe(fileBacked && !s.synthetic);
    }
  });
});

describe("synthetic subjects and the gateway's own report", () => {
  it("do not carry the third-party markers", async () => {
    for (const p of [`/retailer.example${WK}`, WK]) {
      const r = await fetch(url(p));
      expect(r.status, p).toBe(200);
      expect(r.headers.get("x-robots-tag"), p).toBeNull();
      expect(r.headers.get("link"), p).toBeNull();
      await r.text();
    }
  });
});

describe("index", () => {
  it("publishes the legal path and the contact in index.json and links the notice on the page", async () => {
    const idx = await (await fetch(url("/index.json"))).json();
    expect(idx.legal).toBe(LEGAL_PATH);
    expect(idx.contact).toEqual({ name: OPERATOR_NAME, email: OPERATOR_EMAIL, issues: ISSUES_URL });
    const html = await (await fetch(url("/"))).text();
    expect(html).toContain(`href="${LEGAL_PATH}"`);
    expect(html).toMatch(/trademarks belong to their\s+owners/);
    expect(html).toMatch(/without it having to give a reason/);
  });
});
