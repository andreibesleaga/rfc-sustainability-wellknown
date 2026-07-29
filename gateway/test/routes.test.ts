/**
 * HTTP conformance battery. Every assertion here maps to a normative statement
 * in draft-besleaga-sustainability-wellknown, Mandatory Minimum Supported
 * Service / Operational Considerations, or to the gateway's own route contract.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway, type TestServer } from "./helpers";

let srv: TestServer;
const DOC = "/cloudflare.com/.well-known/sustainability-data";
const SELF = "/.well-known/sustainability-data";

beforeAll(async () => {
  srv = await startGateway();
});
afterAll(async () => {
  await srv.close();
});

const url = (p: string) => srv.base + p;

describe("GET /{domain}/.well-known/sustainability-data", () => {
  it("returns 200 application/json with the full required header set", async () => {
    const r = await fetch(url(DOC));
    expect(r.status).toBe(200);
    // MUST use the application/json media type.
    expect(r.headers.get("content-type")).toBe("application/json");
    // SHOULD include appropriate caching directives.
    expect(r.headers.get("cache-control")).toBe("public, max-age=86400");
    // SHOULD include Access-Control-Allow-Origin: * (browser clients).
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    // ETag + Last-Modified are RECOMMENDED (Operational Considerations).
    const etag = r.headers.get("etag");
    expect(etag).toBeTruthy();
    expect(etag!.startsWith("W/")).toBe(false); // strong validator
    expect(etag!).toMatch(/^"[0-9a-f]{40}"$/);
    expect(r.headers.get("last-modified")).toBe("Tue, 15 Jul 2025 00:00:00 GMT");
    // Human-readable `provider` text is language-tagged at the HTTP layer.
    expect(r.headers.get("content-language")).toBe("en");
  });

  it("returns a single JSON object carrying all 8 mandatory members", async () => {
    const body = await (await fetch(url(DOC))).json();
    expect(Array.isArray(body)).toBe(false);
    for (const m of [
      "version",
      "updated",
      "capabilities",
      "provider",
      "measurement-method",
      "methodology-uri",
      "reporting-period",
      "target",
    ]) {
      expect(body[m], `missing mandatory member ${m}`).toBeDefined();
    }
    expect(body.capabilities).toBe("basic");
    expect(body.target).toBe("Cloudflare, Inc.");
    expect(body["reporting-period"]).toBe("2024");
  });

  it("honours If-None-Match with a 304 that carries no body", async () => {
    const first = await fetch(url(DOC));
    const etag = first.headers.get("etag")!;
    const second = await fetch(url(DOC), { headers: { "If-None-Match": etag } });
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
    expect(await second.text()).toBe("");
  });

  it("honours If-None-Match: *", async () => {
    const r = await fetch(url(DOC), { headers: { "If-None-Match": "*" } });
    expect(r.status).toBe(304);
  });

  it("serves 200 for a stale If-None-Match", async () => {
    const r = await fetch(url(DOC), { headers: { "If-None-Match": '"stale"' } });
    expect(r.status).toBe(200);
  });

  it("HEAD returns the same status and headers with no body", async () => {
    const get = await fetch(url(DOC));
    const getBody = await get.text();
    const head = await fetch(url(DOC), { method: "HEAD" });
    expect(head.status).toBe(get.status);
    for (const h of [
      "content-type",
      "cache-control",
      "access-control-allow-origin",
      "etag",
      "last-modified",
      "content-language",
      "content-length",
    ]) {
      expect(head.headers.get(h), `HEAD header ${h}`).toBe(get.headers.get(h));
    }
    expect(head.headers.get("content-length")).toBe(String(Buffer.byteLength(getBody)));
    expect(await head.text()).toBe("");
  });

  it("returns 405 with Allow: GET, HEAD for any other method", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const r = await fetch(url(DOC), { method });
      expect(r.status, method).toBe(405);
      expect(r.headers.get("allow"), method).toBe("GET, HEAD");
      expect(r.headers.get("access-control-allow-origin"), method).toBe("*");
      await r.text();
    }
  });

  it("returns 404 with a JSON body and CORS for an unknown subject", async () => {
    const r = await fetch(url("/not-registered.example/.well-known/sustainability-data"));
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect((await r.json()).error).toMatch(/reporting subject/);
  });

  it("matches the subject domain case-insensitively", async () => {
    const r = await fetch(url("/CloudFlare.COM/.well-known/sustainability-data"));
    expect(r.status).toBe(200);
  });

  it("does not resolve a percent-encoded path separator", async () => {
    const r = await fetch(url("/cloudflare.com%2F.well-known/sustainability-data"));
    expect(r.status).toBe(404);
  });
});

describe("Basic service: query parameters are IGNORED, never an error", () => {
  const cases = [
    "?period=2023",
    "?period=not-a-date",
    "?granularity=monthly",
    "?granularity=hourly",
    "?target=/api/v1",
    "?period=2024&granularity=daily&target=/x",
    "?unknown=1&another=2",
    "?" + "a=1&".repeat(50),
  ];

  it("returns the byte-identical Basic response for every query string", async () => {
    const base = await fetch(url(DOC));
    const baseEtag = base.headers.get("etag");
    const baseBody = await base.text();
    for (const q of cases) {
      const r = await fetch(url(DOC + q));
      expect(r.status, q).toBe(200);
      expect(r.headers.get("content-type"), q).toBe("application/json");
      expect(r.headers.get("etag"), q).toBe(baseEtag);
      expect(await r.text(), q).toBe(baseBody);
    }
  });

  it("never returns an array, whatever the granularity asked for", async () => {
    const r = await fetch(url(DOC + "?period=2024&granularity=monthly"));
    expect(Array.isArray(await r.json())).toBe(false);
  });
});

describe("GET /.well-known/sustainability-data (the gateway's own report)", () => {
  it("reports on the gateway service itself", async () => {
    const r = await fetch(url(SELF));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("etag")).toBeTruthy();
    expect(r.headers.get("last-modified")).toBeTruthy();
    const body = await r.json();
    expect(body["target-type"]).toBe("service");
    expect(body.capabilities).toBe("basic");
    expect(body.target).toBe(srv.gw.config.self.target);
    // Modelled, not metered — see METHODOLOGY.md.
    expect(body["measurement-method"]).toBe("third-party-modeled");
  });

  it("supports HEAD, 304 and 405 identically to a subject document", async () => {
    const get = await fetch(url(SELF));
    const etag = get.headers.get("etag")!;
    await get.text();
    expect((await fetch(url(SELF), { method: "HEAD" })).status).toBe(200);
    expect((await fetch(url(SELF), { headers: { "If-None-Match": etag } })).status).toBe(304);
    const post = await fetch(url(SELF), { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    await post.text();
  });
});

describe("index routes", () => {
  it("GET / serves an HTML index naming every subject and the honesty notice", async () => {
    const r = await fetch(url("/"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const html = await r.text();
    for (const domain of srv.gw.subjects.keys()) {
      expect(html, domain).toContain(`/${domain}/.well-known/sustainability-data`);
    }
    expect(html).toContain("ILLUSTRATIVE MAPPINGS");
    expect(html).toContain("NOT");
    expect(html).toContain("endorsed by their reporting subjects");
    // The ISE reviewer asked that unregistered well-known paths not be advertised.
    expect(html).not.toContain("carbon.txt");
  });

  it("GET /index.json serves the same index, machine-readable", async () => {
    const r = await fetch(url("/index.json"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json");
    const idx = await r.json();
    expect(idx.capabilities).toBe("basic");
    expect(idx.count).toBe(srv.gw.subjects.size);
    expect(idx.subjects.map((s: { domain: string }) => s.domain).sort()).toEqual(
      [...srv.gw.subjects.keys()].sort(),
    );
    expect(idx.notice).toMatch(/not .*endorsed/i);
    for (const s of idx.subjects) {
      expect(s.path).toBe(`/${s.domain}/.well-known/sustainability-data`);
      expect(typeof s.synthetic).toBe("boolean");
      expect(s["methodology-uri"]).toMatch(/^https:\/\//);
    }
  });

  it("every advertised index path actually resolves to 200", async () => {
    const idx = await (await fetch(url("/index.json"))).json();
    for (const s of idx.subjects) {
      const r = await fetch(url(s.path));
      expect(r.status, s.path).toBe(200);
      expect(r.headers.get("content-type"), s.path).toBe("application/json");
      await r.text();
    }
  });

  it("GET /healthz reports liveness and is not cached", async () => {
    const r = await fetch(url("/healthz"));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ status: "ok", subjects: srv.gw.subjects.size });
  });

  it("405s a non-GET method on the index and health routes", async () => {
    for (const p of ["/", "/index.json", "/healthz"]) {
      const r = await fetch(url(p), { method: "POST" });
      expect(r.status, p).toBe(405);
      expect(r.headers.get("allow"), p).toBe("GET, HEAD");
      await r.text();
    }
  });
});

describe("unknown paths", () => {
  it("404s with a JSON body and CORS", async () => {
    for (const p of ["/nope", "/favicon.ico", "/cloudflare.com", "/a/b/c", "/carbon.txt"]) {
      const r = await fetch(url(p));
      expect(r.status, p).toBe(404);
      expect(r.headers.get("content-type"), p).toBe("application/json");
      expect(r.headers.get("access-control-allow-origin"), p).toBe("*");
      expect((await r.json()).error, p).toBeTruthy();
    }
  });

  it("does not serve any carbon.txt path", async () => {
    for (const p of ["/carbon.txt", "/.well-known/carbon.txt"]) {
      const r = await fetch(url(p));
      expect(r.status, p).toBe(404);
      await r.text();
    }
  });
});
