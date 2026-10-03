/**
 * Every adapter demonstration publishes the input its adapter transforms, so a
 * visitor can read the input and the declaration it becomes side by side; every
 * example and curated subject links the file it is served from.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway, type TestServer } from "./helpers";

let srv: TestServer;
const url = (p: string) => `${srv.base}${p}`;

beforeAll(async () => {
  srv = await startGateway();
});
afterAll(async () => {
  await srv.close();
});

describe("recorded inputs of the adapter demonstrations", () => {
  it("every demonstration publishes one, served verbatim as JSON", async () => {
    const demos = [...srv.gw.live.managed.values()];
    expect(demos.length).toBe(11);
    for (const m of demos) {
      const input = m.spec.input;
      expect(input, m.spec.domain).toBeDefined();
      const r = await fetch(url(`/${m.spec.domain}/input`));
      expect(r.status, m.spec.domain).toBe(200);
      expect(r.headers.get("content-type"), m.spec.domain).toBe("application/json");
      expect(r.headers.get("x-content-type-options"), m.spec.domain).toBe("nosniff");
      expect(r.headers.get("access-control-allow-origin"), m.spec.domain).toBe("*");
      expect(r.headers.get("x-robots-tag"), m.spec.domain).toBe("noindex");
      expect(await r.json(), m.spec.domain).toEqual(JSON.parse(JSON.stringify(input!.body)));
      if (input!.license) {
        expect(r.headers.get("link"), m.spec.domain).toBe(`<${input!.license.url}>; rel="license"`);
      }
    }
  });

  it("answers HEAD with the same headers, refuses other methods, and 404s an unknown subject", async () => {
    const head = await fetch(url("/dist-demo.example/input"), { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).not.toBeNull();
    expect((await fetch(url("/dist-demo.example/input"), { method: "POST" })).status).toBe(405);
    expect((await fetch(url("/nothing-here.example/input"))).status).toBe(404);
    // A curated subject or an example has no recorded input: its source is a file, linked instead.
    expect((await fetch(url("/wikimedia.org/input"))).status).toBe(404);
  });

  it("the index links input and declaration for every demonstration", async () => {
    const idx = await (await fetch(url("/index.json"))).json();
    const html = await (await fetch(url("/"))).text();
    for (const e of idx["adapter-demonstrations"].entries) {
      expect(e.input?.path, e.domain).toBe(`/${e.domain}/input`);
      expect(html, e.domain).toContain(`href="/${e.domain}/input"`);
    }
  });

  it("every example and every curated subject links the repository file it is served from", async () => {
    const idx = await (await fetch(url("/index.json"))).json();
    for (const e of idx["wire-format-examples"].entries) {
      expect(e["source-file"], e.domain).toBe(
        `https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/example-responses/${e.file}`,
      );
    }
    for (const s of idx.subjects) {
      if (s.source !== "curated data file") continue;
      expect(s["source-file"], s.domain).toBe(
        `https://github.com/andreibesleaga/rfc-sustainability-wellknown/blob/main/gateway/data/${s.domain}.json`,
      );
    }
  });
});
