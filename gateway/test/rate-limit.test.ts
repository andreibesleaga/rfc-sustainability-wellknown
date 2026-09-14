/**
 * Per-client rate limiting (draft Operational Considerations: servers SHOULD
 * rate-limit requests to the well-known URI). The limiter is
 * `rate-limiter-flexible`; these tests cover the gateway's policy around it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clientKey, createRateLimiter } from "../src/rate-limit";
import { startGateway, type TestServer } from "./helpers";

describe("createRateLimiter", () => {
  it("allows `perMinute` requests per key, then refuses with a Retry-After in [1, 60]", async () => {
    const limiter = createRateLimiter({ perMinute: 3, trustProxy: 0 })!;
    for (let i = 0; i < 3; i++) expect(await limiter.check("a")).toEqual({ allowed: true });
    const refused = await limiter.check("a");
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterSec).toBeGreaterThanOrEqual(1);
      expect(refused.retryAfterSec).toBeLessThanOrEqual(60);
    }
    // Keys are independent.
    expect(await limiter.check("b")).toEqual({ allowed: true });
  });

  it("0 disables the limiter", () => {
    expect(createRateLimiter({ perMinute: 0, trustProxy: 1 })).toBeUndefined();
  });
});

describe("clientKey", () => {
  const req = (xff: string | string[] | undefined, remote = "10.0.0.9") =>
    ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote } }) as never;

  it("behind one trusted proxy, the LAST X-Forwarded-For entry identifies the client", () => {
    expect(clientKey(req("203.0.113.5"), 1)).toBe("203.0.113.5");
    // A client-supplied first entry cannot displace the proxy-appended one.
    expect(clientKey(req("1.1.1.1, 203.0.113.5"), 1)).toBe("203.0.113.5");
    expect(clientKey(req(["1.1.1.1", "203.0.113.5"]), 1)).toBe("203.0.113.5");
    expect(clientKey(req(undefined), 1)).toBe("10.0.0.9");
    expect(clientKey(req(""), 1)).toBe("10.0.0.9");
  });

  it("with fewer entries than trusted proxies, the first entry still keys per client", () => {
    expect(clientKey(req("203.0.113.5"), 2)).toBe("203.0.113.5");
    expect(clientKey(req("198.51.100.7, 203.0.113.5"), 2)).toBe("198.51.100.7");
    expect(clientKey(req(undefined), 2)).toBe("10.0.0.9");
  });

  it("exposed directly, the socket address is used and the header is ignored", () => {
    expect(clientKey(req("203.0.113.5"), 0)).toBe("10.0.0.9");
    expect(clientKey({ headers: {}, socket: {} } as never, 0)).toBe("unknown");
  });
});

describe("gateway wiring", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway({ rateLimitPerMinute: 5 });
  });
  afterAll(async () => srv.close());

  it("refuses the request over the limit with 429, Retry-After, CORS and no-store; HEAD counts; /healthz is exempt", async () => {
    const path = `${srv.base}/.well-known/sustainability-data`;
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await fetch(path, { method: i % 2 ? "HEAD" : "GET" })).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    const refused = await fetch(path);
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    expect(refused.headers.get("access-control-allow-origin")).toBe("*");
    expect(refused.headers.get("content-type")).toBe("application/json");
    expect(await refused.json()).toMatchObject({ status: 429 });
    // 404s count too (the limiter runs before routing) …
    expect((await fetch(`${srv.base}/nope`)).status).toBe(429);
    // … but the platform health check is never throttled.
    expect((await fetch(`${srv.base}/healthz`)).status).toBe(200);
    // A different client (proxy-appended address) has its own budget.
    const other = await fetch(path, { headers: { "x-forwarded-for": "203.0.113.77" } });
    expect(other.status).toBe(200);
  });
});
