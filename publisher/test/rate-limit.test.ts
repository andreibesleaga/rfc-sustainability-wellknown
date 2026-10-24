import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { RateLimiter } from "../src/handler";
import { expressSustainability } from "../src/middleware/express";
import { fastifySustainability } from "../src/middleware/fastify";
import { Publisher } from "../src/publisher";
import { createSustainabilityServer, ServerOptions } from "../src/server";
import type { RawMetrics, SourceAdapter } from "../src/types";

const raw = (period: string): RawMetrics => ({
  provider: "Trend Corp",
  measurementMethod: "cloud-billing",
  methodologyUri: "https://trend.example/m",
  period,
  updated: "2026-04-01T12:00:00Z",
  energy: { value: 10, unit: "kWh" },
  carbon: { value: 100, unit: "gCO2e" },
  target: "trend.example",
});

// An Extended source that counts how often it is asked.
function countingAdapter(): SourceAdapter & { fetches: number } {
  const adapter = {
    capabilities: "extended" as const,
    fetches: 0,
    async fetch() {
      adapter.fetches += 1;
      return ["2026-01", "2026-02", "2026-03"].map(raw);
    },
  };
  return adapter as SourceAdapter & { fetches: number };
}

async function serve(publisher: Publisher, opts: ServerOptions) {
  const server = createSustainabilityServer(publisher, opts);
  await new Promise<void>((done) => server.listen(0, done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/.well-known/sustainability-data`,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

describe("RateLimiter", () => {
  it("allows the configured number of requests per client in a window, then names the wait", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter({ requests: 2, windowMs: 10_000, clock: () => now });
    expect(limiter.hit("a").allowed).toBe(true);
    now += 1_000;
    expect(limiter.hit("a").allowed).toBe(true);
    now += 1_500;
    expect(limiter.hit("a")).toEqual({ allowed: false, retryAfterSeconds: 8 }); // 10 s from the first, 2.5 s gone, 7.5 s up to 8
    expect(limiter.hit("b").allowed).toBe(true); // another client has its own count
    now += 7_500;
    expect(limiter.hit("a").allowed).toBe(true); // a new window
  });

  it("bounds the clients it tracks", () => {
    const limiter = new RateLimiter({ requests: 1, maxClients: 2, clock: () => 0 });
    limiter.hit("a");
    limiter.hit("b");
    limiter.hit("c"); // drops "a"
    expect(limiter.hit("b").allowed).toBe(false);
    expect(limiter.hit("a").allowed).toBe(true);
  });

  it("refuses a limit that is not a positive integer", () => {
    expect(() => new RateLimiter({ requests: 0 })).toThrow(/requests/);
    expect(() => new RateLimiter({ requests: 1.5 })).toThrow(/requests/);
    expect(() => new RateLimiter({ requests: 1, windowMs: 0 })).toThrow(/windowMs/);
  });
});

describe("rate limit on the well-known URI", () => {
  it("the standalone server answers 429 with Retry-After once a client is over the limit", async () => {
    let now = 5_000_000;
    const srv = await serve(new Publisher(countingAdapter(), { cacheTtlMs: 60_000 }), { rateLimit: { requests: 2, windowMs: 30_000, clock: () => now } });
    expect((await fetch(srv.url)).status).toBe(200);
    expect((await fetch(srv.url)).status).toBe(200);
    const limited = await fetch(srv.url);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("30");
    expect(limited.headers.get("cache-control")).toBe("no-store");
    expect(await limited.json()).toEqual({ error: "too many requests" });
    now += 30_000;
    expect((await fetch(srv.url)).status).toBe(200);
    await srv.close();
  });

  it("does not limit when the option is unset", async () => {
    const srv = await serve(new Publisher(countingAdapter(), { cacheTtlMs: 60_000 }), {});
    for (let i = 0; i < 5; i++) expect((await fetch(srv.url)).status).toBe(200);
    await srv.close();
  });

  it("the Express middleware answers 429 for the address the framework reports", async () => {
    const middleware = expressSustainability(new Publisher(countingAdapter()), { rateLimit: { requests: 1, clock: () => 0 } });
    const call = async (ip: string) => {
      const sent: { status?: number; headers?: Record<string, string> } = {};
      const res = {
        status(code: number) { sent.status = code; return res; },
        set(headers: Record<string, string>) { sent.headers = headers; return res; },
        send: () => undefined,
        end: () => undefined,
      };
      await middleware({ method: "GET", path: "/.well-known/sustainability-data", query: {}, headers: {}, ip }, res, () => undefined);
      return sent;
    };
    expect((await call("192.0.2.1")).status).toBe(200);
    const limited = await call("192.0.2.1");
    expect(limited.status).toBe(429);
    expect(limited.headers?.["Retry-After"]).toBe("60");
    expect((await call("192.0.2.2")).status).toBe(200);
  });
});

describe("rate limit in the Fastify plugin", () => {
  it("answers 429 with Retry-After for the address the framework reports, and counts each address on its own", async () => {
    let handler: ((req: any, reply: any) => Promise<unknown>) | undefined;
    await fastifySustainability(
      { get() {}, route: (o: { handler: any }) => { handler = o.handler; } } as any,
      { publisher: new Publisher(countingAdapter()), rateLimit: { requests: 1, clock: () => 0 } },
    );
    const call = async (ip: string) => {
      const sent: { status?: number; headers?: Record<string, string>; body?: string } = {};
      const reply: any = {
        code(status: number) { sent.status = status; return reply; },
        headers(headers: Record<string, string>) { sent.headers = headers; return reply; },
        send(body?: string) { sent.body = body; return reply; },
      };
      await handler!({ method: "GET", headers: {}, query: {}, ip }, reply);
      return sent;
    };
    expect((await call("192.0.2.1")).status).toBe(200);
    const limited = await call("192.0.2.1");
    expect(limited.status).toBe(429);
    expect(limited.headers?.["Retry-After"]).toBe("60");
    expect(limited.headers?.["Cache-Control"]).toBe("no-store");
    expect(JSON.parse(limited.body ?? "")).toEqual({ error: "too many requests" });
    expect((await call("192.0.2.2")).status).toBe(200);
  });
});

describe("computed query responses are cached under the canonical values", () => {
  it("`Z` and `.000Z` spellings of a bound share one entry, one build and one entity-tag", async () => {
    const adapter = countingAdapter();
    const srv = await serve(new Publisher(adapter, { cacheTtlMs: 60_000 }), {});
    const a = await fetch(`${srv.url}?start=2026-02-01T00:00:00Z&end=2026-03-01T00:00:00Z`);
    const b = await fetch(`${srv.url}?end=2026-03-01T00:00:00.000Z&start=2026-02-01T00:00:00.000Z`);
    expect(adapter.fetches).toBe(1);
    expect(b.headers.get("etag")).toBe(a.headers.get("etag"));
    await srv.close();
  });
});
