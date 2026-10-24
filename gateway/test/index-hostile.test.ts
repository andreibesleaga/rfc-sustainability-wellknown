/**
 * Document-derived text on the front page and in the index is data: the test-only
 * case `hostile-strings.example` (bidirectional controls and markup in `provider`
 * and in an organization-name `target`) is registered beside the 42 served files,
 * and the page shows it as escaped text.
 */
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WIRE_CASES } from "../src/examples";
import { startGateway, type TestServer } from "./helpers";

const HOSTILE = "hostile-strings.example";
const SERVED = resolve(__dirname, "..", "examples");
const CORPUS_FILE = resolve(__dirname, "..", "..", "schemas-validators", "examples", "valid", "hostile-strings.json");

describe("hostile strings on the front page and in the index", () => {
  let srv: TestServer;
  let dir: string;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "gw-hostile-"));
    for (const f of readdirSync(SERVED)) copyFileSync(join(SERVED, f), join(dir, f));
    copyFileSync(CORPUS_FILE, join(dir, "hostile-strings.json"));
    WIRE_CASES.push({
      file: "hostile-strings.json",
      domain: HOSTILE,
      caseName: "Hostile strings <b>(test only)</b>",
      note: "Markup and bidirectional controls in provider and target.",
      serving: "all",
    });
    srv = await startGateway({ examplesDir: dir });
  });
  afterAll(async () => {
    WIRE_CASES.pop();
    await srv?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("lists the 42 served files and the test-only case, each with its period as an object", async () => {
    const idx = await (await fetch(`${srv.base}/index.json`)).json();
    const entries = idx["wire-format-examples"].entries as { domain: string; period: { start: string; end: string } }[];
    expect(entries).toHaveLength(43);
    expect(entries.filter((e) => e.domain !== HOSTILE)).toHaveLength(42);
    for (const e of entries) expect(Object.keys(e.period).sort(), e.domain).toEqual(["end", "start"]);
    expect(JSON.stringify(idx)).not.toMatch(/period=|"reporting-period":/);
  });

  it("shows target and case name as escaped text and interprets no markup", async () => {
    const html = await (await fetch(`${srv.base}/`)).text();
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<b>(test only)</b>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;b&gt;(test only)&lt;/b&gt;");
    // The provider is shown in an attribute: markup and the quotes of an attribute stay inert there too.
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    // The right-to-left override stays inside an isolating element.
    expect(html).toMatch(/<bdi>[^<]*‮Ltd<\/bdi>/);
    expect(html).not.toMatch(/[?&;]period=/);
  });

  it("serves the hostile document itself byte-for-byte as data", async () => {
    const r = await fetch(`${srv.base}/${HOSTILE}/.well-known/sustainability-data`);
    expect(r.status).toBe(200);
    const body = await r.json();
    const doc = Array.isArray(body) ? body[0] : body;
    expect(doc.provider).toContain("<script>alert(1)</script>");
    expect(doc.target).toContain("‮");
  });
});
