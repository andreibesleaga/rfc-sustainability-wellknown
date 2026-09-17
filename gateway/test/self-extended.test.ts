/**
 * The gateway's own report as an Extended publisher (draft §Optional Extended
 * Query Parameters), clamped to the live window. Fixed clock throughout.
 */
import { validateDocument } from "sustainability-wellknown-consumer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveHours, periodBounds, slices } from "../src/adapters/self-report";
import { startGateway, type TestServer } from "./helpers";

const NOW = new Date("2026-09-14T12:00:00Z");
const LIVE_SINCE = "2026-07-30T00:00:00Z";
const SELF = "/.well-known/sustainability-data";

describe("period arithmetic", () => {
  it("periodBounds covers years, months and days in UTC", () => {
    expect(periodBounds("2026")).toEqual({ start: Date.UTC(2026, 0, 1), end: Date.UTC(2027, 0, 1) });
    expect(periodBounds("2026-02")).toEqual({ start: Date.UTC(2026, 1, 1), end: Date.UTC(2026, 2, 1) });
    expect(periodBounds("2026-02-28")).toEqual({ start: Date.UTC(2026, 1, 28), end: Date.UTC(2026, 2, 1) });
    expect(() => periodBounds("2026-2")).toThrow();
  });

  it("liveHours counts only the overlap with [liveSince, now)", () => {
    const live = Date.parse(LIVE_SINCE);
    const now = NOW.getTime();
    expect(liveHours("2026-06", live, now)).toBe(0);
    expect(liveHours("2026-07", live, now)).toBe(48);
    expect(liveHours("2026-08", live, now)).toBe(744);
    expect(liveHours("2026-09", live, now)).toBe(13 * 24 + 12);
    expect(liveHours("2026-09-14", live, now)).toBe(12);
    expect(liveHours("2026-10", live, now)).toBe(0);
    expect(liveHours("2026", live, now)).toBe(48 + 744 + 13 * 24 + 12);
  });

  it("slices only when the granularity is finer than the period", () => {
    expect(slices("2026", "monthly")).toHaveLength(12);
    expect(slices("2026", "daily")).toHaveLength(365);
    expect(slices("2026-02", "daily")).toHaveLength(28);
    expect(slices("2026-02", "monthly")).toEqual(["2026-02"]);
    expect(slices("2026-02-03", "daily")).toEqual(["2026-02-03"]);
    expect(slices("2026", undefined)).toEqual(["2026"]);
  });
});

describe("GET /.well-known/sustainability-data with Extended parameters", () => {
  let srv: TestServer;
  let parameterless: string;
  beforeAll(async () => {
    srv = await startGateway({ now: NOW, unpinPeriod: true });
    srv.gw.config.self.liveSince = LIVE_SINCE; // display only; the adapter got its own copy below
    parameterless = await (await fetch(`${srv.base}${SELF}`)).text();
  });
  afterAll(async () => srv.close());

  const get = (qs = "") => fetch(`${srv.base}${SELF}${qs}`);

  it("the parameterless document is the most recently completed month, declared extended", async () => {
    const doc = JSON.parse(parameterless);
    expect(doc["reporting-period"]).toBe("2026-08");
    expect(doc.capabilities).toBe("extended");
    expect(doc.updated).toBe("2026-09-01T00:00:00Z");
  });

  it("ignores an unknown granularity value: bytes identical to the parameterless response", async () => {
    // Draft -07 step 3: a `granularity` that is neither monthly nor daily is
    // ignored, never an error.
    for (const qs of ["?granularity=weekly", "?granularity=hourly", "?utm_source=x"]) {
      const r = await get(qs);
      expect(r.status).toBe(200);
      expect(await r.text(), qs).toBe(parameterless);
    }
  });

  it("answers 404 for any `target`: the published prefix set is empty (step 4)", async () => {
    // One process has no path prefixes, so METHODOLOGY.md publishes an empty
    // set and every value matches nothing. The value is never echoed back, and
    // the answer is INDISTINGUISHABLE from the no-data 404 of a period the
    // server holds nothing for: draft §Privacy Considerations, "answers every
    // value outside that set with the same `404 Not Found` it returns when it
    // holds no data. A server SHOULD make those two responses indistinguishable
    // in body and in timing as well."
    const noData = await get("?period=2024-12");
    expect(noData.status).toBe(404);
    const noDataBody = await noData.text();
    for (const qs of ["?target=/x", "?target=/&granularity=daily", "?target=anything"]) {
      const r = await get(qs);
      expect(r.status, qs).toBe(404);
      expect(await r.text(), qs).toBe(noDataBody);
      for (const h of ["content-type", "cache-control", "access-control-allow-origin", "last-modified"]) {
        expect(r.headers.get(h), `${qs} ${h}`).toBe(noData.headers.get(h));
      }
    }
  });

  it("answers 400 for a repeated defined parameter or a malformed period (steps 1 and 2)", async () => {
    for (const qs of [
      "?period=2026&period=2025",
      "?granularity=daily&granularity=monthly",
      "?target=/a&target=/b",
      "?period=not-a-date",
      "?period=2026-13",
    ]) {
      const r = await get(qs);
      expect(r.status, qs).toBe(400);
      expect(r.headers.get("content-type")).toBe("application/json");
      expect(r.headers.get("cache-control")).toBe("no-store");
      expect((await r.json()).error, qs).toMatch(/^bad request: /);
    }
  });

  it("a period before go-live has no data (404); a period after now has none either", async () => {
    // The helper puts go-live at 2025-01-01; the month before it has no data.
    expect((await get("?period=2024-12")).status).toBe(404);
    expect((await get("?period=2027-01")).status).toBe(404);
  });

  it("a single-period request returns one object with the model evaluated on the live window", async () => {
    const r = await get("?period=2026-09-14");
    expect(r.status).toBe(200);
    const doc = await r.json();
    expect(Array.isArray(doc)).toBe(false);
    // 3 W × 12 h = 0.036 kWh (the day is in progress: hours to `now`).
    expect(doc["reporting-period"]).toBe("2026-09-14");
    expect(doc["energy-consumption"]).toBe(0.036);
    expect(doc.updated).toBe("2026-09-14T12:00:00Z");
    expect(r.headers.get("last-modified")).toBe("Mon, 14 Sep 2026 12:00:00 GMT");
    expect(r.headers.get("etag")).not.toBe((await get()).headers.get("etag"));
  });

  it("year + monthly returns the ascending, uniform array of months with data, the last one to date", async () => {
    const r = await get("?period=2026&granularity=monthly");
    expect(r.status).toBe(200);
    const arr = await r.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr.map((e: { "reporting-period": string }) => e["reporting-period"])).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09",
    ]);
    expect(new Set(arr.map((e: { target: string }) => e.target)).size).toBe(1);
    expect(new Set(arr.map((e: { "target-type": string }) => e["target-type"]))).toEqual(new Set(["service"]));
    expect(arr[arr.length - 1].updated).toBe("2026-09-14T12:00:00Z");
    expect(arr[0].updated).toBe("2026-02-01T00:00:00Z");
    expect(validateDocument(arr).valid).toBe(true);
    // A year without a finer granularity is a single object, never an array.
    const single = await (await get("?period=2026")).json();
    expect(Array.isArray(single)).toBe(false);
    expect(single["reporting-period"]).toBe("2026");
  });

  it("month + daily returns one entry per day, ≤ 366 entries always", async () => {
    const r = await get("?period=2026-08&granularity=daily");
    const arr = await r.json();
    expect(arr).toHaveLength(31);
    expect(arr[0]["energy-consumption"]).toBe(0.072); // 3 W × 24 h
    expect(validateDocument(arr).valid).toBe(true);
    const year = await (await get("?period=2026&granularity=daily")).json();
    expect(year.length).toBeLessThanOrEqual(366);
    expect(year.length).toBe(31 * 5 + 28 + 30 * 2 + 14); // Jan…Sep 14: 257 days
  });

  it("conditional requests work per variant", async () => {
    const first = await get("?period=2026-08");
    const etag = first.headers.get("etag")!;
    const second = await fetch(`${srv.base}${SELF}?period=2026-08`, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    const since = await fetch(`${srv.base}${SELF}?period=2026-08`, {
      headers: { "if-modified-since": first.headers.get("last-modified")! },
    });
    expect(since.status).toBe(304);
  });

  it("index.json describes the self report's Extended service and go-live", async () => {
    const idx = await (await fetch(`${srv.base}/index.json`)).json();
    expect(idx.capabilities).toBe("basic"); // the relayed subjects
    expect(idx.self.capabilities).toBe("extended");
    expect(idx.self["live-since"]).toBe("2025-01-01T00:00:00Z");
    expect(idx.self["extended-examples"]).toHaveLength(3);
    for (const p of idx.self["extended-examples"]) {
      expect((await fetch(`${srv.base}${p}`)).status, p).toBe(200);
    }
  });
});

describe("go-live clamp with the real default (2026-07-30)", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway({ now: NOW, unpinPeriod: true });
  });
  afterAll(async () => srv.close());

  it("July 2026 reports 48 modelled hours and June has no data", async () => {
    // Rebuild the self subject with the production go-live instant.
    const { loadConfig } = await import("../src/config");
    const { createGateway, route } = await import("../src/app");
    const { DATA_DIR } = await import("./helpers");
    const config = loadConfig({ port: 0, host: "127.0.0.1", dataDir: DATA_DIR, maxAge: 86_400 });
    config.rateLimit.perMinute = 0;
    expect(config.self.liveSince).toBe("2026-07-30T00:00:00Z");
    const gw = await createGateway({ config, log: () => undefined, now: NOW, clock: () => NOW, fetchImpl: null, env: {} });
    const july = await route(gw, "GET", `${SELF}?period=2026-07`);
    expect(july.status).toBe(200);
    expect(JSON.parse(july.body)["energy-consumption"]).toBe(0.144); // 3 W × 48 h
    expect((await route(gw, "GET", `${SELF}?period=2026-06`)).status).toBe(404);
    const months = JSON.parse((await route(gw, "GET", `${SELF}?period=2026&granularity=monthly`)).body);
    expect(months.map((e: { "reporting-period": string }) => e["reporting-period"])).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(srv.gw.index.self["live-since"]).toBe("2025-01-01T00:00:00Z"); // the helper's own clamp
  });
});

describe("period tolerance and cache lifetime of the self report", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway({ now: NOW, unpinPeriod: true });
  });
  afterAll(async () => srv.close());

  it("a well-shaped but non-existent day is 400: it names no real calendar date", async () => {
    // Draft -07 step 2: a `period` that "does not name a real calendar date"
    // is 400 Bad Request, not a silent fall-back to the Basic response.
    const r = await fetch(`${srv.base}${SELF}?period=2026-02-31`);
    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain("2026-02-31");
    expect(() => periodBounds("2026-02-31")).toThrow(/calendar/);
  });

  it("every self-report response is cacheable for an hour, the model's own resolution", async () => {
    const inProgress = await fetch(`${srv.base}${SELF}?period=2026-09`);
    expect(inProgress.headers.get("cache-control")).toBe("public, max-age=3600");
    const complete = await fetch(`${srv.base}${SELF}?period=2026-08`);
    expect(complete.headers.get("cache-control")).toBe("public, max-age=3600");
    const basic = await fetch(`${srv.base}${SELF}`);
    expect(basic.headers.get("cache-control")).toBe("public, max-age=3600");
    const subject = await fetch(`${srv.base}/cloudflare.com${SELF}`);
    expect(subject.headers.get("cache-control")).toBe("public, max-age=86400");
    // A 304 freshens a cached copy with its own Cache-Control, so it carries the same hour.
    const revalidated = await fetch(`${srv.base}${SELF}`, { headers: { "if-none-match": basic.headers.get("etag")! } });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("cache-control")).toBe("public, max-age=3600");
    const page = await fetch(`${srv.base}/`);
    expect(page.headers.get("cache-control")).toBe("public, max-age=3600");
    await Promise.all([subject.text(), page.text()]);
    await Promise.all([inProgress.text(), complete.text(), basic.text()]);
  });
});
