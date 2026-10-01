/**
 * Documents in data/withheld/ are kept for the record but never served: their
 * sources' published terms do not permit, or were not confirmed to permit, reuse
 * of their content (data/README.md, "Rights in the sources").
 */
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATA_DIR, startGateway, type TestServer } from "./helpers";

const WITHHELD = readdirSync(join(DATA_DIR, "withheld")).filter((f) => f.endsWith(".json")).map((f) => basename(f, ".json"));
let srv: TestServer;
beforeAll(async () => {
  srv = await startGateway();
});
afterAll(async () => {
  await srv.close();
});

describe("withheld documents", () => {
  it("exist and are recorded", () => {
    expect(WITHHELD.length).toBeGreaterThan(0);
    const readme = readFileSync(join(DATA_DIR, "README.md"), "utf8");
    for (const d of WITHHELD) expect(readme, d).toContain(`withheld/${d}.json`);
  });

  it.each(WITHHELD)("%s is not served and not listed", async (domain) => {
    expect(srv.gw.subjects.has(domain)).toBe(false);
    const r = await fetch(`${srv.base}/${domain}/.well-known/sustainability-data`);
    expect(r.status).toBe(404);
    await r.text();
    const idx = await (await fetch(`${srv.base}/index.json`)).text();
    expect(idx.includes(`"${domain}"`)).toBe(false);
    const html = await (await fetch(`${srv.base}/`)).text();
    expect(html.includes(`/${domain}/`)).toBe(false);
  });
});

describe("served documents about real organizations", () => {
  it("each has a row in the rights table", () => {
    const readme = readFileSync(join(DATA_DIR, "README.md"), "utf8");
    const rights = readme.slice(readme.indexOf("## Rights in the sources"));
    expect(rights.length).toBeGreaterThan(100);
    const real = readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_") && !f.includes(".example."));
    for (const f of real) expect(rights, f).toContain(`\`${f}\``);
  });
});
