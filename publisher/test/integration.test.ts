import { createServer as httpCreateServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { co2jsAdapter, computedAdapter } from "../src/adapters";
import { parseCarbonTxt } from "../src/carbontxt";
import { buildAdapter, buildPublisher, PublisherConfig, runCli } from "../src/cli";
import { expressSustainability } from "../src/middleware/express";
import { fastifySustainability } from "../src/middleware/fastify";
import { Publisher } from "../src/publisher";
import { createSustainabilityServer } from "../src/server";
import { RawMetrics, SourceAdapter } from "../src/types";
import { readJson } from "../src/util";
import { validateDocument } from "../src/validate";

const EX = (name: string) => resolve(process.cwd(), "examples", name);

function demoPublisher() {
  return new Publisher(
    computedAdapter({
      provider: "Example Corp",
      methodologyUri: "https://example.com/m",
      reportingPeriod: "2026-02",
      energy: { value: 1250, unit: "kWh" },
      gridIntensity: 276,
      capabilities: "extended",
    }),
    { cacheTtlMs: 60_000 },
  );
}

function listen(server: { listen: Function; address: Function; close: Function }) {
  return new Promise<{ base: string; close: () => Promise<void> }>((res) => {
    (server as any).listen(0, () => {
      const { port } = (server as any).address() as AddressInfo;
      res({
        base: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => (server as any).close(() => r())),
      });
    });
  });
}

describe("standalone server: bidirectional carbon.txt", () => {
  it("serves sustainability JSON and a carbon.txt pointing back to it", async () => {
    const server = createSustainabilityServer(demoPublisher(), {
      maxAge: 86400,
      carbonTxt: { upstreamServices: [{ domain: "aws.amazon.com" }] },
    });
    const { base, close } = await listen(server);
    try {
      const s = await fetch(`${base}/.well-known/sustainability`);
      expect(s.status).toBe(200);
      expect((await s.json())["carbon-footprint"]).toBe(345000);

      for (const path of ["/carbon.txt", "/.well-known/carbon.txt"]) {
        const c = await fetch(`${base}${path}`);
        expect(c.status).toBe(200);
        expect(c.headers.get("content-type")).toContain("text/plain");
        const doc = parseCarbonTxt(await c.text());
        expect(doc.org.disclosures[0].url).toContain("/.well-known/sustainability");
        expect(doc.upstream?.services?.[0].domain).toBe("aws.amazon.com");
      }

      expect((await fetch(`${base}/nope`)).status).toBe(404);
      expect((await fetch(`${base}/carbon.txt`, { method: "POST" })).status).toBe(405);
    } finally {
      await close();
    }
  });

  it("returns 503 when the adapter throws (never publishes unverified data)", async () => {
    const boom: SourceAdapter = {
      name: "boom",
      capabilities: "basic",
      fetch: async (): Promise<RawMetrics> => {
        throw new Error("upstream down");
      },
    };
    const server = createSustainabilityServer(new Publisher(boom, { cacheTtlMs: 0 }));
    const { base, close } = await listen(server);
    try {
      expect((await fetch(`${base}/.well-known/sustainability`)).status).toBe(503);
    } finally {
      await close();
    }
  });
});

describe("Express middleware", () => {
  it("serves sustainability and carbon.txt, passes through other routes", async () => {
    const app = express();
    app.use(
      expressSustainability(demoPublisher(), {
        carbonTxt: { sustainabilityUrl: "https://demo.example/.well-known/sustainability" },
      }),
    );
    app.get("/other", (_req, res) => res.send("ok"));
    const server = httpCreateServer(app);
    const { base, close } = await listen(server);
    try {
      const s = await fetch(`${base}/.well-known/sustainability`);
      expect(s.status).toBe(200);
      expect(validateDocument(await s.json()).valid).toBe(true);

      const c = await fetch(`${base}/carbon.txt`);
      expect(c.status).toBe(200);
      expect(parseCarbonTxt(await c.text()).org.disclosures[0].url).toBe(
        "https://demo.example/.well-known/sustainability",
      );

      expect(await (await fetch(`${base}/other`)).text()).toBe("ok");
    } finally {
      await close();
    }
  });
});

describe("Fastify plugin (mock runtime)", () => {
  it("registers routes for sustainability and carbon.txt", async () => {
    const routes = new Map<string, (req: any, reply: any) => Promise<unknown>>();
    const fakeFastify = {
      get(path: string, handler: any) {
        routes.set(path, handler);
      },
    };
    await fastifySustainability(fakeFastify as any, {
      publisher: demoPublisher(),
      carbonTxt: { sustainabilityUrl: "https://demo.example/.well-known/sustainability" },
    });
    expect([...routes.keys()]).toEqual(
      expect.arrayContaining(["/.well-known/sustainability", "/carbon.txt", "/.well-known/carbon.txt"]),
    );

    const makeReply = () => {
      const r: any = {
        statusCode: 0,
        sentBody: "",
        code(c: number) {
          r.statusCode = c;
          return r;
        },
        headers() {
          return r;
        },
        send(b: string) {
          r.sentBody = b;
          return r;
        },
      };
      return r;
    };

    const sReply = makeReply();
    await routes.get("/.well-known/sustainability")!({ headers: {}, query: {} }, sReply);
    expect(sReply.statusCode).toBe(200);
    expect(validateDocument(JSON.parse(sReply.sentBody)).valid).toBe(true);

    const cReply = makeReply();
    await routes.get("/carbon.txt")!({ headers: { host: "demo.example" } }, cReply);
    expect(cReply.statusCode).toBe(200);
    expect(parseCarbonTxt(cReply.sentBody).org.disclosures).toHaveLength(1);
  });

  // Fix 4 (MAJOR): a real Fastify instance exposes `route`, so the plugin
  // registers one handler for every method and answers non-GET/HEAD with
  // 405 + Allow: GET, HEAD (mirroring express.ts and server.ts). This seam
  // drives that path without the fastify package installed.
  it("answers non-GET/HEAD with 405 + Allow (route seam)", async () => {
    const routes = new Map<string, (req: any, reply: any) => Promise<unknown>>();
    const fakeFastify = {
      get(path: string, handler: any) {
        routes.set(path, handler);
      },
      route(opts: { method: string | string[]; url: string; handler: any }) {
        routes.set(opts.url, opts.handler);
      },
    };
    await fastifySustainability(fakeFastify as any, {
      publisher: demoPublisher(),
      carbonTxt: { sustainabilityUrl: "https://demo.example/.well-known/sustainability" },
    });

    const makeReply = () => {
      const r: any = {
        statusCode: 0,
        headerBag: {} as Record<string, string>,
        sentBody: "",
        code(c: number) {
          r.statusCode = c;
          return r;
        },
        headers(h: Record<string, string>) {
          Object.assign(r.headerBag, h);
          return r;
        },
        send(b: string) {
          r.sentBody = b ?? "";
          return r;
        },
      };
      return r;
    };

    for (const path of ["/.well-known/sustainability", "/carbon.txt", "/.well-known/carbon.txt"]) {
      const reply = makeReply();
      await routes.get(path)!({ method: "POST", headers: {}, query: {} }, reply);
      expect(reply.statusCode, path).toBe(405);
      expect(reply.headerBag.Allow, path).toBe("GET, HEAD");
    }

    // GET still works through the route seam.
    const okReply = makeReply();
    await routes.get("/.well-known/sustainability")!({ method: "GET", headers: {}, query: {} }, okReply);
    expect(okReply.statusCode).toBe(200);
    expect(validateDocument(JSON.parse(okReply.sentBody)).valid).toBe(true);
  });
});

describe("CLI / config loader", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds valid documents from every offline example config", async () => {
    for (const name of ["config.computed.json", "config.co2js.json", "config.carbontxt.json"]) {
      const config = readJson<PublisherConfig>(EX(name));
      const doc = await buildPublisher(config).getDocument();
      expect(validateDocument(doc).valid, name).toBe(true);
    }
  });

  it("rejects an unknown adapter type", () => {
    expect(() => buildAdapter("nope", {})).toThrow(/Unknown adapter type/);
  });

  it("--emit-carbon-txt prints a valid carbon.txt", async () => {
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s: any) => {
      out += s;
      return true;
    });
    await runCli(["--config", EX("config.co2js.json"), "--emit-carbon-txt"]);
    const doc = parseCarbonTxt(out);
    expect(doc.org.disclosures[0].url).toContain("/.well-known/sustainability");
  });

  it("--once prints a valid document", async () => {
    let out = "";
    vi.spyOn(process.stdout, "write").mockImplementation((s: any) => {
      out += s;
      return true;
    });
    await runCli(["--config", EX("config.co2js.json"), "--once"]);
    expect(validateDocument(JSON.parse(out)).valid).toBe(true);
  });
});

describe("Publisher caching", () => {
  it("serves a warm cache and clears on invalidate", async () => {
    let calls = 0;
    const counting: SourceAdapter = {
      name: "counting",
      capabilities: "basic",
      fetch: async (): Promise<RawMetrics> => {
        calls++;
        return {
          provider: "p",
          measurementMethod: "cloud-billing",
          methodologyUri: "https://x/y",
          reportingPeriod: "2026-01",
          energy: { value: 10, unit: "kWh" },
          carbon: { value: 2, unit: "kgCO2e" },
        };
      },
    };
    const pub = new Publisher(counting, { cacheTtlMs: 60_000 });
    const a = await pub.getSerialized();
    const b = await pub.getSerialized();
    expect(a.etag).toBe(b.etag);
    expect(calls).toBe(1); // second call served from cache
    pub.invalidate();
    await pub.getSerialized();
    expect(calls).toBe(2);
  });
});

describe("co2js adapter end-to-end through a server", () => {
  it("serves a schema-valid document from bytes", async () => {
    const pub = new Publisher(
      co2jsAdapter({
        provider: "Edge Co",
        methodologyUri: "https://edge.example/methods",
        reportingPeriod: "2026-02",
        bytes: 10_000_000_000,
        green: true,
        gridZone: "GBR",
        disclosureUri: "https://edge.example/.well-known/carbon.txt",
      }),
      { cacheTtlMs: 0 },
    );
    const server = createSustainabilityServer(pub);
    const { base, close } = await listen(server);
    try {
      const r = await fetch(`${base}/.well-known/sustainability`);
      const body = await r.json();
      expect(validateDocument(body).valid).toBe(true);
      expect(body["disclosure-uri"]).toBe("https://edge.example/.well-known/carbon.txt");
    } finally {
      await close();
    }
  });
});
