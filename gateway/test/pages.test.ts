/**
 * The pages a visitor reads (/ and /legal) and the index a program reads (/index.json): periods as objects,
 * no period= parameter, strings shown as text, and the accessibility checks that need no browser.
 */
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DATA_DIR, startGateway, type TestServer } from "./helpers";

const HOSTILE = resolve(__dirname, "..", "..", "schemas-validators", "examples", "valid", "hostile-strings.json");

/** A date-time with a Z or a numeric offset, as the format allows. */
const INSTANT = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$/;

/** WCAG relative luminance contrast of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (short: string) => {
    const h = short.length === 4 ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : short;
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe("GET / (G12)", () => {
  let srv: TestServer;
  let html: string;
  beforeAll(async () => {
    srv = await startGateway();
    html = await (await fetch(`${srv.base}/`)).text();
  });
  afterAll(async () => srv.close());

  it("declares its language, has one h1, a viewport for narrow screens and no period= parameter", () => {
    expect(html).toMatch(/<html lang="en">/);
    expect(html.match(/<h1[ >]/g)).toHaveLength(1);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).not.toMatch(/[?&;]period=/);
  });

  it("labels every form control", () => {
    const controls = [...html.matchAll(/<(input|select|textarea)\b[^>]*>/g)];
    expect(controls.length).toBeGreaterThanOrEqual(2);
    for (const [tag] of controls) {
      const id = /\sid="([^"]+)"/.exec(tag)?.[1];
      const labelled = (id && html.includes(`<label for="${id}"`)) || /aria-label="[^"]+"/.test(tag) || (id && new RegExp(`<label[^>]*>[^<]*<select[^>]*id="${id}"`).test(html));
      expect(labelled, tag).toBeTruthy();
    }
    expect(html.match(/<button\b[^>]*>\s*\S/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("announces the validator result in a live region that is always in the page", () => {
    expect(html).toMatch(/<div role="status" aria-live="polite"><pre id="check-out"/);
  });

  it("can be read without script: tables, the figure description and the check form are in the markup", () => {
    const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(body).toContain("<table>");
    expect(body).toContain('<form id="check" class="check" action="/validate" method="get">');
    expect(body).toContain("<desc id=\"figdesc\">");
    // The only script that changes text is the three-line host swap, and the page says what it swaps.
    expect(body).toContain("&lt;this-gateway&gt;");
  });

  it("keeps a contrast of 4.5 or more for its text colours in light and dark", () => {
    const light = /:root \{[^}]*--fg:(#\w+); --dim:(#\w+); --bg:(#\w+);[^}]*--accent:(#\w+); --warn:(#\w+); --warnbg:(#\w+)/.exec(html)!;
    const dark = /:root\[data-theme="dark"\] \{[^}]*--fg:(#\w+); --dim:(#\w+); --bg:(#\w+);[^}]*--accent:(#\w+); --warn:(#\w+); --warnbg:(#\w+)/.exec(html)!;
    for (const m of [light, dark]) {
      const [, fg, dim, bg, accent, warn, warnbg] = m;
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(dim, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(accent, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(warn, warnbg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, warnbg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("shows no status by colour alone: every badge carries its word", () => {
    for (const [badge] of html.matchAll(/<span class="badge [a-z]+">[^<]*<\/span>/g)) {
      expect(badge.replace(/<[^>]+>/g, "").trim().length, badge).toBeGreaterThan(0);
    }
  });

  it("shows both bounds of every period in a title and links the range query of each array example", () => {
    const titles = [...html.matchAll(/<code title="(\d{4}-[^" ]+) to (\d{4}-[^" ]+)">/g)];
    expect(titles.length).toBeGreaterThanOrEqual(srv.gw.subjects.size);
    const index = srv.gw.index as unknown as { "wire-format-examples": { entries: Array<{ range?: { start: string; end: string }; granularity?: string }> } };
    const withRange = index["wire-format-examples"].entries.filter((e) => e.range);
    expect(withRange.length).toBeGreaterThan(0);
    for (const e of withRange) expect(html).toContain(`?start=${e.range!.start}&amp;end=${e.range!.end}`);
  });
});

describe("GET /index.json (G13)", () => {
  it("lists subjects, adapter demonstrations and the 42 wire examples, each with period as an object", async () => {
    const srv = await startGateway();
    try {
      const raw = await (await fetch(`${srv.base}/index.json`)).text();
      expect(raw).not.toMatch(/period=/);
      const idx = JSON.parse(raw);
      const wire = idx["wire-format-examples"].entries;
      expect(wire).toHaveLength(42);
      expect(idx["wire-format-examples"].count).toBe(42);
      const all = [...idx.subjects, ...idx["adapter-demonstrations"].entries, ...wire];
      for (const e of all) {
        expect(e.period, e.domain).toEqual({ start: expect.stringMatching(INSTANT), end: expect.stringMatching(INSTANT) });
        expect(Date.parse(e.period.start) < Date.parse(e.period.end), e.domain).toBe(true);
      }
      for (const e of wire.filter((x: { range?: unknown }) => x.range)) {
        expect(e.range).toEqual({ start: expect.any(String), end: expect.any(String) });
        expect(["yearly", "monthly", "daily", undefined]).toContain(e.granularity);
      }
    } finally {
      await srv.close();
    }
  });
});

describe("a document with hostile strings (G12)", () => {
  it("is shown as escaped text in / and as plain data in /index.json", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gw-data-"));
    try {
      for (const f of readdirSync(DATA_DIR)) if (f.endsWith(".json") && !f.startsWith("_")) cpSync(join(DATA_DIR, f), join(dir, f));
      const doc = (JSON.parse(readFileSync(HOSTILE, "utf8")) as Array<Record<string, unknown>>)[0];
      doc["methodology-uri"] = "https://hostile-strings.example/methodology";
      writeFileSync(join(dir, "hostile-strings.example.json"), JSON.stringify(doc, null, 2) + "\n");
      const srv = await startGateway({ dataDir: dir });
      try {
        const html = await (await fetch(`${srv.base}/`)).text();
        expect(html).not.toContain("<script>alert(1)</script>");
        expect(html).not.toContain("<img src=x");
        expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
        const idx = await (await fetch(`${srv.base}/index.json`)).json();
        const entry = idx.subjects.find((s: { domain: string }) => s.domain === "hostile-strings.example");
        expect(entry.target).toBe(doc.target);
      } finally {
        await srv.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("GET /legal and /healthz (G14)", () => {
  it("answers the notice as plain text in English and the health check with the subject count", async () => {
    const srv = await startGateway();
    try {
      const legal = await fetch(`${srv.base}/legal`);
      expect(legal.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(legal.headers.get("content-language")).toBe("en");
      expect(await legal.text()).toMatch(/^# /m);
      const health = await fetch(`${srv.base}/healthz`);
      expect(await health.json()).toEqual({ status: "ok", subjects: srv.gw.subjects.size });
      const post = await fetch(`${srv.base}/healthz`, { method: "POST" });
      expect(post.status).toBe(405);
      expect(post.headers.get("allow")).toBe("GET, HEAD");
    } finally {
      await srv.close();
    }
  });
});
