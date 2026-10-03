/**
 * The public validator and badge: a statement about bytes, guarded like the
 * request-forgery surface it is, cached so a badge never hammers its target.
 */
import { describe, expect, it } from "vitest";
import { Validator, badgeSvg, checkHost, parseOrigin, type ValidationOutcome } from "../src/validate";
import { startGateway } from "./helpers";

const DOC = JSON.stringify({
  updated: "2026-02-01T00:00:00Z",
  capabilities: "basic",
  provider: "Good Example (https://good.example/contact)",
  "measurement-method": "hardware-metered",
  "methodology-uri": "https://good.example/methodology",
  "reporting-period": "2026-01",
  target: "good.example",
  "target-type": "origin",
  "energy-consumption": 12,
  "energy-unit": "kWh",
});
const MEDIA = "application/sustainability-data+json";
const publicLookup = async () => ["93.184.216.34"];

/** A fetch that serves a few named hosts and counts calls. */
function fakeFetch(calls: string[]) {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.host);
    switch (url.host) {
      case "good.example.com": return new Response(DOC, { status: 200, headers: { "Content-Type": MEDIA } });
      case "generic.example.com": return new Response(DOC, { status: 200, headers: { "Content-Type": "application/json" } });
      case "html.example.com": return new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } });
      case "broken.example.com": return new Response("{\"updated\": 1}", { status: 200, headers: { "Content-Type": MEDIA } });
      case "nothing.example.com": return new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } });
      default: throw new Error("ENOTFOUND");
    }
  }) as typeof fetch;
}

describe("host guards", () => {
  it("accepts only an https origin naming a public DNS name", () => {
    expect(parseOrigin("https://good.example.com")).toEqual({ host: "good.example.com" });
    expect(parseOrigin("good.example.com")).toEqual({ host: "good.example.com" });
    expect(parseOrigin("https://Good.Example.COM/")).toEqual({ host: "good.example.com" });
    for (const bad of ["http://good.example.com", "https://good.example.com/path", "https://good.example.com/?x=1", "https://user:pw@good.example.com", "not a url", undefined]) {
      expect("error" in parseOrigin(bad)).toBe(true);
    }
  });
  it("refuses IP literals, loopback, private names and single labels", () => {
    for (const bad of ["127.0.0.1", "10.0.0.1", "[::1]", "::1", "localhost", "intranet", "printer.local", "db.internal", "x.home", "foo.example", "bar.test", "x.onion", "-bad.example.com", "a..b.com"]) {
      const r = checkHost(bad);
      expect("error" in r, bad).toBe(true);
    }
    expect(checkHost("sustainability.up.railway.app")).toEqual({ host: "sustainability.up.railway.app" });
    expect(checkHost("xn--bcher-kva.example.net")).toEqual({ host: "xn--bcher-kva.example.net" });
  });
});

describe("Validator", () => {
  it("reports valid, invalid and unreachable outcomes, and the generic media type as tolerated", async () => {
    const calls: string[] = [];
    const v = new Validator({ fetchImpl: fakeFetch(calls), lookup: publicLookup, clock: () => new Date("2026-03-10T12:00:00Z") });
    const good = (await v.check("good.example.com")) as ValidationOutcome;
    expect(good.status).toBe("valid");
    expect(good.mediaType).toBe("sustainability-data+json");
    expect(good.signature).toBe("unsigned");
    expect(good.reportingPeriod).toBe("2026-01");
    expect(good.checked).toBe("2026-03-10T12:00:00.000Z");
    expect(good.note).toMatch(/nothing about the accuracy/);
    expect(((await v.check("generic.example.com")) as ValidationOutcome).mediaType).toBe("json");
    expect(((await v.check("html.example.com")) as ValidationOutcome).status).toBe("invalid");
    expect(((await v.check("broken.example.com")) as ValidationOutcome).status).toBe("invalid");
    expect(((await v.check("nothing.example.com")) as ValidationOutcome).status).toBe("unreachable");
    expect(((await v.check("gone.example.com")) as ValidationOutcome).status).toBe("unreachable");
  });

  it("fetches a host at most once per hour, however often it is asked", async () => {
    const calls: string[] = [];
    let now = new Date("2026-03-10T12:00:00Z");
    const v = new Validator({ fetchImpl: fakeFetch(calls), lookup: publicLookup, clock: () => now });
    await Promise.all([v.check("good.example.com"), v.check("good.example.com"), v.check("good.example.com")]);
    await v.check("good.example.com");
    expect(calls.filter((h) => h === "good.example.com")).toHaveLength(1);
    now = new Date("2026-03-10T13:00:01Z");
    await v.check("good.example.com");
    expect(calls.filter((h) => h === "good.example.com")).toHaveLength(2);
  });

  it("never contacts an address the consumer's transport rules refuse", async () => {
    const calls: string[] = [];
    const v = new Validator({ fetchImpl: fakeFetch(calls), lookup: async () => ["10.0.0.7"], clock: () => new Date("2026-03-10T12:00:00Z") });
    const out = await v.check("good.example.com");
    expect(out.status).toBe("unreachable");
    expect(calls).toHaveLength(0);
  });

  it("draws a badge whose text is escaped and whose colour follows the outcome", () => {
    const svg = badgeSvg({ origin: "https://x.example.com", status: "valid", checked: "2026-03-10T12:00:00.000Z", detail: "<ok> & \"fine\"", note: "" });
    expect(svg).toContain('role="img"');
    expect(svg).toContain("valid · 2026-03-10");
    expect(svg).toContain("&lt;ok&gt; &amp; &quot;fine&quot;");
    expect(svg).toContain("#2e7d32");
    expect(badgeSvg({ origin: "https://x", status: "invalid", checked: "2026-03-10T12:00:00.000Z", detail: "", note: "" })).toContain("#c62828");
  });
});

describe("routes", () => {
  it("serves /validate as JSON and /badge as SVG, cached for an hour, and refuses bad targets", async () => {
    const calls: string[] = [];
    const t = await startGateway({ validator: { fetchImpl: fakeFetch(calls), lookup: publicLookup } });
    try {
      const r = await fetch(`${t.base}/validate?origin=https://good.example.com`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("application/json");
      expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
      expect(r.headers.get("x-robots-tag")).toBe("noindex");
      expect(r.headers.get("access-control-allow-origin")).toBe("*");
      const j = await r.json();
      expect(j.status).toBe("valid");

      const b = await fetch(`${t.base}/badge/good.example.com.svg`);
      expect(b.status).toBe(200);
      expect(b.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
      expect(await b.text()).toContain("valid ·");
      expect(calls.filter((h) => h === "good.example.com")).toHaveLength(1);

      const bad = await fetch(`${t.base}/validate?origin=http://good.example.com`);
      expect(bad.status).toBe(400);
      expect((await bad.json()).error).toMatch(/only https/);
      const ip = await fetch(`${t.base}/validate?origin=https://127.0.0.1`);
      expect(ip.status).toBe(400);
      const missing = await fetch(`${t.base}/validate`);
      expect(missing.status).toBe(400);

      const badBadge = await fetch(`${t.base}/badge/localhost.svg`);
      expect(badBadge.status).toBe(400);
      expect(badBadge.headers.get("content-type")).toContain("image/svg+xml");

      const post = await fetch(`${t.base}/validate?origin=https://good.example.com`, { method: "POST" });
      expect(post.status).toBe(405);
    } finally {
      await t.close();
    }
  });

  it("refuses an excluded host before any lookup, as JSON and as a badge", async () => {
    const calls: string[] = [];
    const t = await startGateway({ validator: { fetchImpl: fakeFetch(calls), lookup: publicLookup, exclude: new Set(["good.example.com"]) } });
    try {
      const r = await fetch(`${t.base}/validate?origin=https://good.example.com`);
      expect(r.status).toBe(400);
      expect((await r.json()).error).toMatch(/excluded/);
      const b = await fetch(`${t.base}/badge/good.example.com.svg`);
      expect(b.status).toBe(400);
      expect(b.headers.get("content-type")).toContain("image/svg+xml");
      expect(await b.text()).toContain("excluded");
      expect(calls).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it("counts the strict limit only when a retrieval is needed, and refuses a badge as an image", async () => {
    const calls: string[] = [];
    // The general limiter is off (the harness default of 0): the validator's own limit must still hold.
    const t = await startGateway({ validator: { fetchImpl: fakeFetch(calls), lookup: publicLookup, perMinute: 2 } });
    try {
      // Nine badge views of one host from one client: one retrieval, no refusal (cache hits bypass the strict limit).
      const statuses: number[] = [];
      for (let i = 0; i < 9; i++) statuses.push((await fetch(`${t.base}/badge/good.example.com.svg`)).status);
      expect(statuses.every((s) => s === 200)).toBe(true);
      expect(calls.filter((h) => h === "good.example.com")).toHaveLength(1);
      // New hosts each need a retrieval: the strict limit applies, and a refused badge is still an SVG.
      await fetch(`${t.base}/badge/generic.example.com.svg`);
      const refused = await fetch(`${t.base}/badge/html.example.com.svg`);
      expect(refused.status).toBe(429);
      expect(refused.headers.get("content-type")).toContain("image/svg+xml");
      expect(refused.headers.get("retry-after")).toBeTruthy();
    } finally {
      await t.close();
    }
  });

  it("the application log never carries the host a validator request names", async () => {
    const { loggedPath } = await import("../src/app");
    expect(loggedPath("/validate?origin=https://secret.example.com")).toBe("/validate?origin=<host>");
    expect(loggedPath("/badge/secret.example.com.svg")).toBe("/badge/<host>.svg");
    expect(loggedPath("/wikimedia.org/.well-known/sustainability-data?period=2025")).toBe("/wikimedia.org/.well-known/sustainability-data?period=2025");
  });

  it("when this service's own retrieval budget is spent it says so (503, no-store, Retry-After), never 'unreachable'", async () => {
    const calls: string[] = [];
    const t = await startGateway({ validator: { fetchImpl: fakeFetch(calls), lookup: publicLookup, perMinute: 1000, outboundPerMinute: 1 } });
    try {
      expect((await fetch(`${t.base}/validate?origin=https://good.example.com`)).status).toBe(200);
      const busy = await fetch(`${t.base}/validate?origin=https://generic.example.com`);
      expect(busy.status).toBe(503);
      expect(busy.headers.get("cache-control")).toBe("no-store");
      expect(Number(busy.headers.get("retry-after"))).toBeGreaterThan(0);
      const badge = await fetch(`${t.base}/badge/html.example.com.svg`);
      expect(badge.status).toBe(503);
      expect(badge.headers.get("content-type")).toContain("image/svg+xml");
      const text = await badge.text();
      expect(text).toContain("try later");
      expect(text).not.toContain("unreachable");
      // A host already checked is still answered from the cache.
      expect((await fetch(`${t.base}/validate?origin=https://good.example.com`)).status).toBe(200);
      expect(calls.filter((h) => h !== "good.example.com")).toHaveLength(0);
    } finally {
      await t.close();
    }
  });

  it("is absent when the deployment disables it", async () => {
    const t = await startGateway({ validator: null });
    try {
      const r = await fetch(`${t.base}/validate?origin=https://good.example.com`);
      expect(r.status).toBe(503);
    } finally {
      await t.close();
    }
  });

  it("has its own, stricter rate limit", async () => {
    const calls: string[] = [];
    const t = await startGateway({ validator: { fetchImpl: fakeFetch(calls), lookup: publicLookup, perMinute: 2 } });
    try {
      // Each host needs its own retrieval, so the strict limit (2 per minute) refuses the third.
      const statuses: number[] = [];
      for (const h of ["good.example.com", "generic.example.com", "html.example.com", "broken.example.com"]) {
        statuses.push((await fetch(`${t.base}/validate?origin=https://${h}`)).status);
      }
      expect(statuses).toContain(429);
      // The rest of the service keeps its own budget.
      expect((await fetch(`${t.base}/healthz`)).status).toBe(200);
    } finally {
      await t.close();
    }
  });
});
