/**
 * The gateway's own report as an Extended publisher (draft §Query Parameters):
 * the objects it holds, selected by the publisher. Fixed clock throughout:
 * 2026-10-17T12:00:00Z, with go-live on 2026-07-30.
 */
import { compareDateTimes, isOnDayBoundaries, monthPeriod, yearPeriod, type Period } from "sustainability-wellknown-publisher";
import { validateDocument } from "sustainability-wellknown-consumer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HELD_DAYS, HELD_MAX, epochMs, heldPeriods, liveHours, periodHours, startOfDay } from "../src/adapters/self-report";
import { FIXED_NOW, startGateway, type TestServer } from "./helpers";

const LIVE_SINCE = "2026-07-30T00:00:00Z";
const SELF = "/.well-known/sustainability-data";
const at = (s: string) => Date.parse(s);

interface Obj {
  period: Period;
  updated: string;
  target: string;
  "energy-consumption": number;
  "energy-unit": string;
  capabilities: string;
}

const label = (p: Period) => `${p.start}/${p.end}`;

describe("period arithmetic", () => {
  it("periodHours counts the hours between the bounds", () => {
    expect(periodHours(yearPeriod(2025))).toBe(8760);
    expect(periodHours(yearPeriod(2024))).toBe(8784); // leap year
    expect(periodHours(monthPeriod(2025, 2))).toBe(672);
    expect(periodHours(monthPeriod(2024, 2))).toBe(696); // leap February
    expect(periodHours({ start: "2025-04-01T00:00:00Z", end: "2025-04-02T00:00:00Z" })).toBe(24);
  });

  it("liveHours counts only the overlap with [liveSince, now)", () => {
    const live = at(LIVE_SINCE);
    const now = at("2026-09-14T00:00:00Z");
    expect(liveHours(monthPeriod(2026, 6), live, now)).toBe(0);
    expect(liveHours(monthPeriod(2026, 7), live, now)).toBe(48);
    expect(liveHours(monthPeriod(2026, 8), live, now)).toBe(744);
    expect(liveHours(monthPeriod(2026, 9), live, now)).toBe(13 * 24);
    expect(liveHours(monthPeriod(2026, 10), live, now)).toBe(0);
    expect(liveHours(yearPeriod(2026), live, now)).toBe(48 + 744 + 13 * 24);
  });

  it("the start of a day is its first instant, whatever the hour", () => {
    expect(startOfDay(at("2026-10-17T12:34:56Z"))).toBe(at("2026-10-17T00:00:00Z"));
    expect(startOfDay(at("2026-10-17T00:00:00Z"))).toBe(at("2026-10-17T00:00:00Z"));
  });
});

describe("the held set", () => {
  const live = at(LIVE_SINCE);

  it("holds 79 days, 2 whole months and 2 edge months at the fixed clock, and no year", () => {
    const held = heldPeriods(live, startOfDay(FIXED_NOW.getTime()));
    expect(held).toHaveLength(83);
    const labels = held.map(label);
    expect(labels).toContain("2026-07-30T00:00:00Z/2026-08-01T00:00:00Z"); // the go-live month, so far as it was live
    expect(labels).toContain("2026-10-01T00:00:00Z/2026-10-17T00:00:00Z"); // the month in progress
    expect(labels).toContain(label(monthPeriod(2026, 8)));
    expect(labels).toContain(label(monthPeriod(2026, 9)));
    expect(labels).not.toContain(label(yearPeriod(2026)));
    expect(held.filter((p) => compareDateTimes(p.end, p.start) > 0 && periodHours(p) === 24)).toHaveLength(79);
  });

  it("every bound is a day boundary, and the order is by start and then by end: the shorter first", () => {
    const held = heldPeriods(live, at("2028-01-01T00:00:00Z"));
    expect(held.every(isOnDayBoundaries)).toBe(true);
    expect(held.filter((p) => p.start === "2027-01-01T00:00:00Z").map(periodHours)).toEqual([744, 8760]); // January, then the year
    const near = heldPeriods(live, at("2026-10-17T00:00:00Z"));
    expect(near.filter((p) => p.start === "2026-09-01T00:00:00Z").map(periodHours)).toEqual([24, 720]); // 1 September, then September
    expect(held.map((p) => p.start)).toEqual([...held.map((p) => p.start)].sort());
  });

  it("starts the go-live month on the day the gateway went live, but counts its hours from the instant", () => {
    const midDay = at("2026-07-30T10:30:00Z");
    const held = heldPeriods(midDay, at("2026-10-17T00:00:00Z"));
    expect(held.map(label)).toContain("2026-07-30T00:00:00Z/2026-08-01T00:00:00Z");
    expect(liveHours({ start: "2026-07-30T00:00:00Z", end: "2026-08-01T00:00:00Z" }, midDay, at("2026-10-17T00:00:00Z"))).toBe(37.5);
  });

  it("holds the most recent 120 whole days, whatever the clock", () => {
    const now = at("2027-12-31T00:00:00Z");
    const days = heldPeriods(live, now).filter((p) => periodHours(p) === 24);
    expect(days).toHaveLength(HELD_DAYS);
    expect(days[days.length - 1].end).toBe("2027-12-31T00:00:00Z");
  });

  it("never holds more than 200 objects, and the newest are the ones that stay", () => {
    for (const clock of ["2026-08-02T00:00:00Z", "2027-12-31T00:00:00Z", "2031-06-15T00:00:00Z", "2040-01-01T00:00:00Z", "2075-03-01T00:00:00Z"]) {
      const held = heldPeriods(live, at(clock));
      expect(held.length, clock).toBeLessThanOrEqual(HELD_MAX);
      const months = held.filter((p) => p.start.endsWith("-01T00:00:00Z") && periodHours(p) >= 672 && periodHours(p) <= 744);
      if (months.length > 0) expect(months[months.length - 1].end <= clock).toBe(true);
    }
    // A decade on, the oldest months that a held year covers have gone first; the years and the newest months stay.
    const held = heldPeriods(live, at("2040-01-01T00:00:00Z")).map(label);
    expect(held).toContain(label(yearPeriod(2027)));
    expect(held).toContain(label(yearPeriod(2039)));
    expect(held).toContain(label(monthPeriod(2039, 12)));
    expect(held).toContain(label(monthPeriod(2026, 8))); // no year covers it
    expect(held).not.toContain(label(monthPeriod(2027, 3)));
  });

  it("holds nothing before the first whole day", () => {
    expect(heldPeriods(live, live)).toEqual([]);
    expect(heldPeriods(live, live - 86_400_000)).toEqual([]);
    expect(heldPeriods(live, live + 86_400_000).map(label)).toEqual(["2026-07-30T00:00:00Z/2026-07-31T00:00:00Z"]); // the day, once: the month so far is that day
  });
});

describe("GET /.well-known/sustainability-data (G01 to G09)", () => {
  let srv: TestServer;
  let parameterless: string;
  let parameterlessEtag: string;
  beforeAll(async () => {
    srv = await startGateway();
    const r = await fetch(`${srv.base}${SELF}`);
    parameterlessEtag = r.headers.get("etag")!;
    parameterless = await r.text();
  });
  afterAll(async () => srv.close());

  const get = (qs = "") => fetch(`${srv.base}${SELF}${qs}`);
  const objects = async (qs: string): Promise<Obj[]> => (await get(qs)).json();

  it("G01 the parameterless document is one object: September 2026, declared extended", () => {
    const doc = JSON.parse(parameterless) as Obj;
    expect(Array.isArray(doc)).toBe(false);
    expect(doc.period).toEqual({ start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" });
    expect(doc.capabilities).toBe("extended");
    expect(doc.updated).toBe("2026-10-02T00:00:00Z"); // the figures were restated on 2 October (the model change)
  });

  it("G02 September and its thirty days come back in ascending order, the shorter day first", async () => {
    const arr = await objects("?start=2026-09-01T00:00:00Z&end=2026-10-01T00:00:00Z");
    expect(arr).toHaveLength(31);
    expect(arr[0].period).toEqual({ start: "2026-09-01T00:00:00Z", end: "2026-09-02T00:00:00Z" });
    expect(arr[1].period).toEqual({ start: "2026-09-01T00:00:00Z", end: "2026-10-01T00:00:00Z" });
    const starts = arr.map((o) => o.period.start);
    expect(starts).toEqual([...starts].sort());
    expect(validateDocument(arr).valid).toBe(true);
  });

  it("G03 G04 G05 granularity and a range select whole units from the held set", async () => {
    expect(await objects("?granularity=monthly")).toHaveLength(2); // the two edge months are not whole
    expect(await objects("?granularity=daily")).toHaveLength(79);
    expect(await objects("?granularity=yearly")).toEqual([]);
    // The go-live month ends at the range start and the month in progress starts at the range end.
    expect(await objects("?start=2026-08-01T00:00:00Z&end=2026-10-01T00:00:00Z")).toHaveLength(63);
  });

  it("G06 a range before go-live is 200 and [], with the validators of any other answer", async () => {
    const r = await get("?start=2025-01-01T00:00:00Z&end=2026-01-01T00:00:00Z&granularity=monthly");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
    expect(r.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(r.headers.get("etag")).toBeTruthy();
    expect(r.headers.get("last-modified")).toBeTruthy();
  });

  it("G07 a value outside the profile, or a repeated parameter, is ignored: the answer is that of G01", async () => {
    for (const qs of [
      "?granularity=weekly",
      "?granularity=Monthly",
      "?start=2026-08-01",
      "?start=2026-08-01T00:00:00%2B01:00",
      "?start=2026-08-01T00:00:00+01:00",
      "?start=2026-08-01t00:00:00z",
      "?start=2026-02-30T00:00:00Z",
      "?start=2016-12-31T23:59:60Z",
      "?granularity=monthly&granularity=daily",
      "?start=2026-08-01T00:00:00Z&start=2026-09-01T00:00:00Z",
      "?utm_source=x",
    ]) {
      const r = await get(qs);
      expect(r.status, qs).toBe(200);
      expect(r.headers.get("etag"), qs).toBe(parameterlessEtag);
      expect(await r.text(), qs).toBe(parameterless);
    }
  });

  it("an ignored value does not stop a value that is honored", async () => {
    expect(await objects("?start=2026-08-01&granularity=monthly")).toHaveLength(2);
  });

  it("G08 the report's own target selects like no target at all", async () => {
    expect(await objects("?target=sustainability-data-gateway&granularity=monthly")).toHaveLength(2);
    expect(await objects("?target=sustainability-data-gateway")).toHaveLength(83);
  });

  it("G09 a target the gateway does not report is 200 and [], however it is written", async () => {
    for (const qs of ["?target=/other", "?target=Sustainability-Data-Gateway", "?target=%2F"]) {
      const r = await get(qs);
      expect(r.status, qs).toBe(200);
      expect(await r.json(), qs).toEqual([]);
    }
  });

  it("the half-open range: periods that meet do not overlap, start = end selects what strictly contains the instant", async () => {
    // August ends at the range start (excluded), September starts at the range end (excluded), and so do their days.
    const meeting = await objects("?start=2026-08-31T00:00:00Z&end=2026-09-01T00:00:00Z");
    expect(meeting.map((o) => label(o.period))).toEqual([
      "2026-08-31T00:00:00Z/2026-09-01T00:00:00Z",
      "2026-08-01T00:00:00Z/2026-09-01T00:00:00Z",
    ].sort());
    expect(await objects("?start=2026-09-01T00:00:00Z&end=2026-09-01T00:00:00Z&granularity=monthly")).toHaveLength(0);
    const inside = await objects("?start=2026-07-31T00:00:00Z&end=2026-07-31T00:00:00Z");
    expect(inside.map((o) => label(o.period))).toEqual(["2026-07-30T00:00:00Z/2026-08-01T00:00:00Z"]);
    expect(await objects("?start=2026-10-01T00:00:00Z&end=2026-08-01T00:00:00Z&granularity=monthly")).toHaveLength(0); // start after end
  });

  it("Z, .000Z and percent-encoded spellings of one value share a body and an ETag", async () => {
    const plain = await get("?start=2026-08-01T00:00:00Z&end=2026-09-01T00:00:00Z");
    const body = await plain.text();
    for (const qs of [
      "?start=2026-08-01T00:00:00.000Z&end=2026-09-01T00:00:00Z",
      "?start=2026-08-01T00%3A00%3A00Z&end=2026-09-01T00%3a00%3a00Z",
      "?end=2026-09-01T00:00:00Z&start=2026-08-01T00:00:00Z",
    ]) {
      const r = await get(qs);
      expect(r.headers.get("etag"), qs).toBe(plain.headers.get("etag"));
      expect(await r.text(), qs).toBe(body);
    }
  });

  it("each answer is stated in energy that adds up: a day is 72 Wh, the go-live month 144 Wh, the month in progress 1152 Wh", async () => {
    const all = await objects("?target=sustainability-data-gateway");
    const byPeriod = new Map(all.map((o) => [label(o.period), o]));
    expect(byPeriod.get("2026-09-01T00:00:00Z/2026-09-02T00:00:00Z")?.["energy-consumption"]).toBe(72);
    expect(byPeriod.get("2026-07-30T00:00:00Z/2026-08-01T00:00:00Z")?.["energy-consumption"]).toBe(144);
    const progress = byPeriod.get("2026-10-01T00:00:00Z/2026-10-17T00:00:00Z")!;
    expect(progress["energy-consumption"]).toBe(1152);
    expect(progress["energy-unit"]).toBe("Wh");
    // Each whole month is the sum of its days.
    for (const m of [8, 9]) {
      const month = byPeriod.get(label(monthPeriod(2026, m)))!;
      const days = all.filter((o) => o.period.start >= month.period.start && o.period.end <= month.period.end && periodHours(o.period) === 24);
      expect(days.reduce((s, d) => s + d["energy-consumption"], 0)).toBe(month["energy-consumption"]);
    }
  });

  it("every object of the held set states a close or a day: updated is not before period.end, and every bound is a day boundary", async () => {
    for (const o of await objects("?target=sustainability-data-gateway")) {
      expect(isOnDayBoundaries(o.period), label(o.period)).toBe(true);
      expect(compareDateTimes(o.updated, o.period.end), label(o.period)).toBeGreaterThanOrEqual(0);
      expect(compareDateTimes(o.updated, "2026-10-17T00:00:00Z")).toBeLessThanOrEqual(0);
    }
  });

  it("Last-Modified is the latest updated among the objects returned, and a 304 carries it", async () => {
    const first = await get("?start=2026-08-01T00:00:00Z&end=2026-09-01T00:00:00Z");
    expect(first.headers.get("last-modified")).toBe("Fri, 02 Oct 2026 00:00:00 GMT");
    const etag = first.headers.get("etag")!;
    const second = await fetch(`${srv.base}${SELF}?start=2026-08-01T00:00:00Z&end=2026-09-01T00:00:00Z`, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
    expect(second.headers.get("last-modified")).toBe("Fri, 02 Oct 2026 00:00:00 GMT");
    expect(second.headers.get("content-length")).toBeNull();
    const since = await fetch(`${srv.base}${SELF}?start=2026-08-01T00:00:00Z&end=2026-09-01T00:00:00Z`, {
      headers: { "if-modified-since": "Fri, 02 Oct 2026 00:00:00 GMT" },
    });
    expect(since.status).toBe(304);
  });

  it("HEAD has the headers of GET and no body, and any other method is 405 with Allow", async () => {
    const qs = "?granularity=monthly";
    const g = await get(qs);
    await g.text();
    const head = await fetch(`${srv.base}${SELF}${qs}`, { method: "HEAD" });
    expect(head.status).toBe(200);
    for (const h of ["content-type", "etag", "last-modified", "cache-control", "content-length"]) {
      expect(head.headers.get(h), h).toBe(g.headers.get(h));
    }
    expect(await head.text()).toBe("");
    const post = await fetch(`${srv.base}${SELF}${qs}`, { method: "POST" });
    expect(post.status).toBe(405);
    expect(post.headers.get("allow")).toBe("GET, HEAD");
    await post.text();
  });

  it("index.json describes the self report's Extended service, and its working requests answer", async () => {
    const idx = await (await fetch(`${srv.base}/index.json`)).json();
    expect(idx.capabilities).toBe("basic"); // the relayed subjects
    expect(idx.self.capabilities).toBe("extended");
    expect(idx.self["live-since"]).toBe(LIVE_SINCE);
    expect(idx.self["extended-examples"]).toHaveLength(3);
    for (const p of idx.self["extended-examples"]) {
      expect(p, p).not.toMatch(/period=/);
      expect((await fetch(`${srv.base}${p}`)).status, p).toBe(200);
    }
  });
});

describe("the same report with the clock moved", () => {
  it("a daily request returns the 120 most recent days at 2027-12-31, and the whole held set stays within 200", async () => {
    const srv = await startGateway({ now: new Date("2027-12-31T12:00:00Z") });
    try {
      const days = (await (await fetch(`${srv.base}${SELF}?granularity=daily`)).json()) as Obj[];
      expect(days).toHaveLength(120);
      const all = (await (await fetch(`${srv.base}${SELF}?target=sustainability-data-gateway`)).json()) as Obj[];
      expect(all.length).toBeLessThanOrEqual(200);
      expect(all.length).toBeGreaterThan(120);
      expect(await (await fetch(`${srv.base}${SELF}`)).json()).toMatchObject({ period: monthPeriod(2027, 11) });
      const years = (await (await fetch(`${srv.base}${SELF}?granularity=yearly`)).json()) as Obj[];
      expect(years).toHaveLength(0); // 2027 is not complete
    } finally {
      await srv.close();
    }
  });

  it("is cut by nothing: a response holds every object the held set has, under the publisher's bound", async () => {
    const srv = await startGateway({ now: new Date("2040-01-01T12:00:00Z") });
    try {
      const r = await fetch(`${srv.base}${SELF}?target=sustainability-data-gateway`);
      const all = (await r.json()) as Obj[];
      expect(all).toHaveLength(heldPeriods(epochMs(LIVE_SINCE), at("2040-01-01T00:00:00Z")).length);
      expect(all).toHaveLength(HELD_MAX);
      expect(Buffer.byteLength(JSON.stringify(all))).toBeLessThan(1024 * 1024);
    } finally {
      await srv.close();
    }
  });

  it("a gateway live for part of its first month holds that month so far, but answers the parameterless request with no data until a whole month is entered", async () => {
    const srv = await startGateway({ now: new Date("2026-08-05T12:00:00Z") });
    try {
      expect((await fetch(`${srv.base}${SELF}`)).status).toBe(404);
      // July is held for a query: the gateway was live for two days of it.
      const held = await (await fetch(`${srv.base}${SELF}?end=2026-08-01T00:00:00Z`)).json();
      const doc = held.find((o: { period: Period }) => o.period.start === "2026-07-30T00:00:00Z" && o.period.end === "2026-08-01T00:00:00Z");
      expect(doc.period).toEqual({ start: "2026-07-30T00:00:00Z", end: "2026-08-01T00:00:00Z" });
      expect(doc["energy-consumption"]).toBe(144);
    } finally {
      await srv.close();
    }
  });
});

describe("cache lifetime of the self report", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway();
  });
  afterAll(async () => srv.close());

  it("every self-report response is cacheable for an hour, the lifetime of this deployment's cache", async () => {
    const range = await fetch(`${srv.base}${SELF}?granularity=monthly`);
    expect(range.headers.get("cache-control")).toBe("public, max-age=3600");
    const basic = await fetch(`${srv.base}${SELF}`);
    expect(basic.headers.get("cache-control")).toBe("public, max-age=3600");
    const subject = await fetch(`${srv.base}/wikimedia.org${SELF}`);
    expect(subject.headers.get("cache-control")).toBe("public, max-age=86400");
    // A 304 freshens a cached copy with its own Cache-Control, so it carries the same hour.
    const revalidated = await fetch(`${srv.base}${SELF}`, { headers: { "if-none-match": basic.headers.get("etag")! } });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("cache-control")).toBe("public, max-age=3600");
    const page = await fetch(`${srv.base}/`);
    expect(page.headers.get("cache-control")).toBe("public, max-age=3600");
    await Promise.all([subject.text(), page.text(), range.text(), basic.text()]);
  });

  it("holds few cache entries however many spellings are asked for", async () => {
    const before = srv.gw.self.publisher.cacheSize;
    for (let i = 0; i < 40; i++) await (await fetch(`${srv.base}${SELF}?utm=${i}&granularity=weekly&start=bad${i}`)).text();
    expect(srv.gw.self.publisher.cacheSize).toBeLessThanOrEqual(before + 1);
  });
});

describe("a gateway less than one day past go-live", () => {
  it("starts; the parameterless request is no data, a query is the empty array, and the first whole day ends it", async () => {
    const nowMs = Date.parse("2026-07-30T12:00:00Z"); // go-live day: no whole day has elapsed
    const srv = await startGateway({ now: new Date(nowMs) });
    try {
      const none = await fetch(`${srv.base}${SELF}`);
      expect(none.status).toBe(404);
      await none.text();
      for (const q of ["?granularity=daily", "?start=2026-07-30T00:00:00Z&end=2026-08-01T00:00:00Z", "?target=sustainability-data-gateway"]) {
        const r = await fetch(`${srv.base}${SELF}${q}`);
        expect(r.status, q).toBe(200);
        expect(await r.json(), q).toEqual([]);
      }
      expect((await fetch(`${srv.base}/index.json`)).status).toBe(200);
      expect((await fetch(`${srv.base}/healthz`)).status).toBe(200);
    } finally {
      await srv.close();
    }
  });
});

describe("a month without an entered figure", () => {
  it("is not held: the parameterless answer is the latest entered whole month, and a range over it is []", async () => {
    // July and August entered, September and October not: at the fixed clock (17 Oct) the current report is August.
    const srv = await startGateway({ wattsByMonth: { "2026-07": 3, "2026-08": 3 } });
    try {
      const doc = await (await fetch(`${srv.base}${SELF}`)).json();
      expect(doc.period).toEqual({ start: "2026-08-01T00:00:00Z", end: "2026-09-01T00:00:00Z" });
      expect(doc.provider).toMatch(/a month without an entry is not reported/);
      expect(await (await fetch(`${srv.base}${SELF}?start=2026-09-01T00:00:00Z`)).json()).toEqual([]);
      const held = await (await fetch(`${srv.base}${SELF}?target=sustainability-data-gateway`)).json();
      expect(held.every((o: { period: Period }) => o.period.end <= "2026-09-01T00:00:00Z")).toBe(true);
    } finally {
      await srv.close();
    }
  });
});
