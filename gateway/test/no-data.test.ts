/**
 * The "publishes no machine-readable data" category: subjects the operator
 * looked for and could not honestly publish. They must be visible in the index
 * and must still answer 404 — the draft's no-data rule — with the finding.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadNoData } from "../src/no-data";
import { DATA_DIR, startGateway, type TestServer } from "./helpers";

let srv: TestServer;
beforeAll(async () => {
  srv = await startGateway();
});
afterAll(async () => {
  await srv.close();
});

const url = (p: string) => srv.base + p;

describe("loadNoData", () => {
  const entries = loadNoData(DATA_DIR);

  it("loads the shipped gap list", () => {
    expect(entries.size).toBeGreaterThan(0);
    expect(entries.has("digitalocean.com")).toBe(true);
    expect(entries.has("github.com")).toBe(true);
  });

  it("requires a substantive finding, evidence URLs and a checked date", () => {
    for (const e of entries.values()) {
      expect(e.finding.length).toBeGreaterThan(40);
      expect(e.evidence.length).toBeGreaterThan(0);
      for (const u of e.evidence) expect(u).toMatch(/^https?:\/\//);
      expect(e.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("rejects an entry with no evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "swk-nd-"));
    writeFileSync(
      join(dir, "_no-data.json"),
      JSON.stringify({
        subjects: [
          {
            domain: "x.example",
            entity: "X",
            status: "publishes-no-quantitative-data",
            finding: "a".repeat(50),
            evidence: [],
            checked: "2026-07-29",
          },
        ],
      }),
    );
    expect(() => loadNoData(dir)).toThrow(/evidence/);
  });

  it("returns an empty map when the file is absent", () => {
    expect(loadNoData(mkdtempSync(join(tmpdir(), "swk-nd-"))).size).toBe(0);
  });
});

describe("no-data subjects over HTTP", () => {
  it("answers 404 with the finding and its evidence", async () => {
    const r = await fetch(url("/digitalocean.com/.well-known/sustainability-data"));
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const body = await r.json();
    expect(body.reason).toBe("publishes-no-quantitative-data");
    expect(body.entity).toContain("DigitalOcean");
    expect(body.finding).toMatch(/10-K|baseline/);
    expect(body.evidence.length).toBeGreaterThan(0);
    expect(body.checked).toBe("2026-07-29");
  });

  it("points a consolidated subsidiary at the parent that does report", async () => {
    const r = await fetch(url("/github.com/.well-known/sustainability-data"));
    expect(r.status).toBe(404);
    const body = await r.json();
    expect(body.reason).toBe("consolidated-into-parent");
    expect(body.see).toBe("/microsoft.com/.well-known/sustainability-data");
    // …and that pointer must actually resolve.
    const parent = await fetch(url(body.see));
    expect(parent.status).toBe(200);
    await parent.text();
  });

  it("is listed in index.json under no-machine-readable-data", async () => {
    const idx = await (await fetch(url("/index.json"))).json();
    const gaps = idx["no-machine-readable-data"];
    expect(gaps.count).toBe(gaps.subjects.length);
    expect(gaps.count).toBeGreaterThan(0);
    expect(gaps.note).toMatch(/overstate|gap is the evidence/i);
    expect(gaps.subjects.map((s: { domain: string }) => s.domain)).toContain("digitalocean.com");
    // A gap subject must never also appear as a served subject.
    const served = new Set(idx.subjects.map((s: { domain: string }) => s.domain));
    for (const g of gaps.subjects) expect(served.has(g.domain)).toBe(false);
  });

  it("is shown on the HTML index with its evidence links", async () => {
    const html = await (await fetch(url("/"))).text();
    expect(html).toContain("Publishes no machine-readable data");
    for (const d of srv.gw.noData.keys()) expect(html, d).toContain(d);
  });
});
