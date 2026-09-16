/**
 * The upstream chain (draft -07 §Upstream Declarations): `followUpstream` /
 * `--upstream`.
 *
 * Every origin here is a local `node:http` fixture, so the walk is exercised
 * end to end with no live network and no clock. What is asserted is the
 * draft's bounded behaviour — depth at most three, an already-visited URI
 * refused, a bounded total number of retrievals, the Extended `?period=`
 * request when the upstream says it supports one — and the four verdicts,
 * which are EVIDENCE about consistency between two self-asserted claims and
 * never proof of either.
 *
 * The arithmetic comparison is defined ONLY where the upstream publishes a
 * tenant-scoped declaration about what it delivers to this subject, so the
 * fixtures below are `target-type: tenant` wherever a verdict is expected. Its
 * direction is the draft's: a subject cannot report less than a tenant-scoped
 * upstream states it delivered, so an upstream figure at or below the
 * subject's own total is `consistent` and one above it is `under-reported`.
 *
 * The compared members are `energy-consumption` and `carbon-footprint`, those
 * two only, and `carbon-footprint` "only where both objects declare the same
 * `carbon-accounting` value or neither declares one" — the accounting-basis
 * block at the end covers that. Nothing here combines two entries: each is
 * compared on its own, as the draft defines no relation over several.
 */
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { MEDIA_TYPE } from "../src/media-type";
import { compareUpstream } from "../src/upstream";
import { SustainabilityMetrics, UpstreamComparison } from "../src/types";
import { ALLOW_INSECURE } from "./helpers";

const BASE: SustainabilityMetrics = {
  updated: "2026-02-15T08:00:00Z",
  capabilities: "basic",
  provider: "Acme Retail plc (sustainability@acme.example)",
  "measurement-method": "third-party-modeled",
  "methodology-uri": "https://acme.example/methodology",
  "reporting-period": "2025",
  target: "acme.example",
  "energy-consumption": 100,
  "energy-unit": "kWh",
  "carbon-footprint": 50,
  "carbon-unit": "kgCO2e",
};

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((r) => s.close(() => r()));
  }
});

/** An origin whose well-known path answers with whatever `body(query)` returns. */
function serve(body: (query: URLSearchParams) => unknown, contentType = MEDIA_TYPE): Promise<string> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.endsWith(WELL_KNOWN_PATH)) {
      res.writeHead(404);
      return res.end();
    }
    const payload = body(url.searchParams);
    if (payload === undefined) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(JSON.stringify(payload));
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

const wellKnown = (origin: string) => `${origin}${WELL_KNOWN_PATH}`;

/** The members that make an upstream declaration one about what it delivers to this subject. */
const TENANT = { target: "tenant-acme", "target-type": "tenant" } as const;

/** Fetch `subject` from its own origin with the chain walked. */
async function walk(subject: unknown, maxDepth?: number, maxRetrievals?: number): Promise<UpstreamComparison[]> {
  const origin = await serve(() => subject);
  const r = await fetchSustainability(origin, {
    ...ALLOW_INSECURE,
    followUpstream: true,
    ...(maxDepth !== undefined ? { upstreamMaxDepth: maxDepth } : {}),
    ...(maxRetrievals !== undefined ? { upstreamMaxRetrievals: maxRetrievals } : {}),
  });
  expect(r.status).toBe("ok");
  return r.status === "ok" ? (r.upstream ?? []) : [];
}

describe("followUpstream: the four verdicts", () => {
  it("consistent: the subject reports at least what the upstream says it delivered to the tenant", async () => {
    const up = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 40, "carbon-footprint": 20 }));
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up), role: "cloud" }] });
    expect(c).toMatchObject({
      verdict: "consistent",
      role: "cloud",
      depth: 1,
      reportingPeriod: "2025",
      upstreamTargetType: "tenant",
      upstreamTarget: "tenant-acme",
    });
    expect(c.subject).toEqual({ energyKWh: 100, carbonGCO2e: 50_000 });
    expect(c.upstreamFigures).toEqual({ energyKWh: 40, carbonGCO2e: 20_000 });
    expect(c.detail).toContain("never proof");
  });

  it("under-reported: the subject's total is less than what the upstream says it delivered to the tenant", async () => {
    const up = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 140 }));
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up) }] });
    expect(c.verdict).toBe("under-reported");
    expect(c.upstreamFigures?.energyKWh).toBe(140);
    expect(c.detail).toContain("less than");
    expect(c.detail).toContain("never proof");
  });

  it("not-comparable: an upstream that publishes only its own totals is fetched but not compared", async () => {
    // Draft -07 §Upstream Declarations: "Where the upstream publishes only its
    // own totals, this document defines no arithmetic relation between the two
    // declarations." The declaration is still reported, with its figures.
    const up = await serve(() => ({ ...BASE, target: "cloud.example", "target-type": "origin", "energy-consumption": 40 }));
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up) }] });
    expect(c.verdict).toBe("not-comparable");
    expect(c.upstreamTargetType).toBe("origin");
    expect(c.upstreamFigures?.energyKWh).toBe(40);
    expect(c.detail).toContain("not tenant-scoped");
    expect(c.detail).toContain("no arithmetic relation");

    // Nor is an upstream that classifies its subject not at all.
    const untyped = await serve(() => ({ ...BASE, target: "cloud.example", "energy-consumption": 40 }));
    const [u] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(untyped) }] });
    expect(u.verdict).toBe("not-comparable");
    expect(u.upstreamTargetType).toBeUndefined();
    expect(u.detail).toContain("target-type absent");
  });

  it("not-comparable: the upstream publishes nothing for that period, or no shared figure", async () => {
    const otherPeriod = await serve(() => ({ ...BASE, "reporting-period": "2024" }));
    const [noPeriod] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(otherPeriod) }] });
    expect(noPeriod.verdict).toBe("not-comparable");
    expect(noPeriod.detail).toContain("2025");

    // Same period, but the two share no metric: the upstream reports only an
    // evidence link (the at-least-one rule is satisfied without a figure).
    const noFigures = await serve(() => {
      const { "energy-consumption": _e, "carbon-footprint": _c, ...rest } = BASE;
      return { ...rest, ...TENANT, "disclosure-uri": "https://up.example/disclosures" };
    });
    const [noShared] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(noFigures) }] });
    expect(noShared.verdict).toBe("not-comparable");
  });

  it("unreachable: a 404, a non-declaration, and a non-https URI are all refused or reported, never thrown", async () => {
    const missing = await serve(() => undefined);
    const [gone] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(missing) }] });
    expect(gone).toMatchObject({ verdict: "unreachable" });
    expect(gone.detail).toContain("http-404");

    const html = await serve(() => BASE, "text/html");
    const [wrongType] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(html) }] });
    expect(wrongType.verdict).toBe("unreachable");
    expect(wrongType.detail).toContain("wrong-media-type");

    // A non-absolute or non-https URI is refused BEFORE any request is made.
    const [relative] = await walk({ ...BASE, upstream: [{ declaration: "/relative" }] });
    expect(relative).toMatchObject({ verdict: "unreachable" });
    expect(relative.detail).toContain("not an absolute URI");
  });

  it("refuses a non-https upstream URI without contacting it, unless allowInsecure is set", async () => {
    let hits = 0;
    const up = await serve(() => {
      hits++;
      return { ...BASE, ...TENANT, "energy-consumption": 20 };
    });
    const subject = { ...BASE, upstream: [{ declaration: wellKnown(up) }] };

    const refused = await compareUpstream(subject, { timeoutMs: 5_000, maxBytes: 10_000, maxObjects: 10 });
    expect(refused[0]).toMatchObject({ verdict: "unreachable" });
    expect(refused[0].detail).toContain("https");
    expect(hits).toBe(0);

    const allowed = await compareUpstream(subject, { timeoutMs: 5_000, maxBytes: 10_000, maxObjects: 10, allowInsecure: true });
    expect(allowed[0].verdict).toBe("consistent");
    expect(hits).toBe(1);
  });
});

describe("followUpstream: the chain is bounded", () => {
  it("walks nested upstreams and stops at depth 3", async () => {
    // A ← B ← C ← D ← E. Three levels of upstream are retrieved (B, C, D); E
    // is named in D's declaration and is reported as beyond the limit rather
    // than fetched — "a depth of at most three".
    let eHits = 0;
    const e = await serve(() => {
      eHits++;
      return { ...BASE, ...TENANT, "energy-consumption": 60 };
    });
    const d = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 70, upstream: [{ declaration: wellKnown(e) }] }));
    const c = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 80, upstream: [{ declaration: wellKnown(d) }] }));
    const b = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 90, upstream: [{ declaration: wellKnown(c) }] }));
    const chain = await walk({ ...BASE, upstream: [{ declaration: wellKnown(b) }] });

    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ depth: 1, verdict: "consistent" });
    const second = chain[0].upstream ?? [];
    expect(second[0]).toMatchObject({ depth: 2, verdict: "consistent" });
    const third = second[0].upstream ?? [];
    expect(third[0]).toMatchObject({ depth: 3, verdict: "consistent" });
    const fourth = third[0].upstream ?? [];
    expect(fourth[0]).toMatchObject({ depth: 4, verdict: "unreachable" });
    expect(fourth[0].detail).toContain("depth");
    expect(fourth[0].upstream).toBeUndefined();
    // The fourth-level origin was never contacted.
    expect(eHits).toBe(0);
  });

  it("refuses a URI it has already retrieved in the chain (a loop is not followed twice)", async () => {
    // B names itself as its own upstream.
    let bUrl = "";
    const b = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 90, upstream: [{ declaration: bUrl }] }));
    bUrl = wellKnown(b);
    const chain = await walk({ ...BASE, upstream: [{ declaration: bUrl }] });
    expect(chain[0]).toMatchObject({ depth: 1, verdict: "consistent" });
    const loop = (chain[0].upstream ?? [])[0];
    expect(loop).toMatchObject({ depth: 2, verdict: "unreachable" });
    expect(loop.detail).toContain("loop");
  });

  it("a lower upstreamMaxDepth stops the walk earlier", async () => {
    const c = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 80 }));
    const b = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 90, upstream: [{ declaration: wellKnown(c) }] }));
    const chain = await walk({ ...BASE, upstream: [{ declaration: wellKnown(b) }] }, 1);
    expect(chain[0]).toMatchObject({ depth: 1, verdict: "consistent" });
    expect((chain[0].upstream ?? [])[0]).toMatchObject({ depth: 2, verdict: "unreachable" });
    expect((chain[0].upstream ?? [])[0].detail).toContain("depth");
  });

  it("asks an `extended` upstream for the subject's period, and takes a `basic` one at its Basic response", async () => {
    const asked: string[] = [];
    const extended = await serve((q) => {
      asked.push(q.get("period") ?? "(none)");
      if (q.get("period") === "2025") return { ...BASE, ...TENANT, "energy-consumption": 30, capabilities: "extended" };
      return { ...BASE, ...TENANT, "reporting-period": "2024", "energy-consumption": 999, capabilities: "extended" };
    });
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(extended) }] });
    expect(asked).toEqual(["(none)", "2025"]);
    expect(c).toMatchObject({ verdict: "consistent", reportingPeriod: "2025" });
    expect(c.upstreamFigures?.energyKWh).toBe(30);

    // A `basic` upstream is asked once and taken at its Basic response only.
    const basicAsked: string[] = [];
    const basic = await serve((q) => {
      basicAsked.push(q.get("period") ?? "(none)");
      return { ...BASE, ...TENANT, "reporting-period": "2024", "energy-consumption": 10 };
    });
    const [b] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(basic) }] });
    expect(basicAsked).toEqual(["(none)"]);
    expect(b.verdict).toBe("not-comparable");
  });

  it("bounds the TOTAL retrievals for one starting declaration, not just the depth", async () => {
    // Draft -07 §Upstream Declarations: a consumer walking the chain "MUST
    // bound the total number of retrievals it performs for one starting
    // declaration". `upstream` is an array, so depth alone would let a fan-out
    // of conforming documents turn the chain into an amplifier.
    let hits = 0;
    const leaf = () => {
      hits++;
      return { ...BASE, ...TENANT, "energy-consumption": 50 };
    };
    const a = await serve(leaf);
    const b = await serve(leaf);
    const c = await serve(leaf);
    const d = await serve(leaf);
    const chain = await walk(
      {
        ...BASE,
        upstream: [a, b, c, d].map((o) => ({ declaration: wellKnown(o) })),
      },
      undefined,
      2,
    );
    expect(chain).toHaveLength(4);
    expect(chain.slice(0, 2).map((x) => x.verdict)).toEqual(["consistent", "consistent"]);
    expect(chain.slice(2).map((x) => x.verdict)).toEqual(["unreachable", "unreachable"]);
    expect(chain[2].detail).toContain("budget of 2 retrievals");
    expect(hits).toBe(2);
  });

  it("the retrieval budget is shared by every level of one walk", async () => {
    // Two direct upstreams, each naming two of its own: with a budget of three
    // the walk stops mid-chain rather than fetching six documents.
    let hits = 0;
    const leaf = async () =>
      wellKnown(
        await serve(() => {
          hits++;
          return { ...BASE, ...TENANT, "energy-consumption": 50 };
        }),
      );
    const l1 = await leaf();
    const l2 = await leaf();
    const mid = async (energy: number) =>
      wellKnown(
        await serve(() => {
          hits++;
          return { ...BASE, ...TENANT, "energy-consumption": energy, upstream: [{ declaration: l1 }, { declaration: l2 }] };
        }),
      );
    const m1 = await mid(90);
    const m2 = await mid(80);
    const chain = await walk({ ...BASE, upstream: [{ declaration: m1 }, { declaration: m2 }] }, undefined, 3);
    expect(hits).toBe(3);
    const flat = (list: UpstreamComparison[]): UpstreamComparison[] => list.flatMap((x) => [x, ...flat(x.upstream ?? [])]);
    expect(flat(chain).filter((x) => x.detail.includes("budget of 3 retrievals")).length).toBeGreaterThan(0);
  });

  it("does not record an upstream response as covering a period the upstream did not name", async () => {
    // Draft -07 §Extended Query Parameters: a server ignores a parameter it
    // does not support, so a consumer compares what came back with what it
    // asked for. This upstream advertises `extended` and then answers the
    // period request with another period.
    const asked: string[] = [];
    const up = await serve((q) => {
      asked.push(q.get("period") ?? "(none)");
      return { ...BASE, ...TENANT, "reporting-period": "2024", "energy-consumption": 1, capabilities: "extended" };
    });
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up) }] });
    expect(asked).toEqual(["(none)", "2025"]);
    expect(c.verdict).toBe("not-comparable");
    expect(c.detail).toContain("answered the period request with another period");
    expect(c.upstreamFigures).toBeUndefined();
  });

  it("nothing is retrieved unless followUpstream is set", async () => {
    let hits = 0;
    const up = await serve(() => {
      hits++;
      return BASE;
    });
    const origin = await serve(() => ({ ...BASE, upstream: [{ declaration: wellKnown(up) }] }));
    const r = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(r.status === "ok" && r.upstream).toBeUndefined();
    expect(hits).toBe(0);
  });

  it("converts units before comparing, so kWh and MWh are never mixed", async () => {
    // The upstream reports 0.04 MWh = 40 kWh against the subject's 100 kWh, so
    // the subject reports no less than the upstream says it delivered.
    const up = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 0.04, "energy-unit": "MWh" }));
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up) }] });
    expect(c.upstreamFigures?.energyKWh).toBeCloseTo(40, 9);
    expect(c.verdict).toBe("consistent");

    // 0.14 MWh = 140 kWh is MORE than the subject's own total for the period,
    // so the subject reports less than its provider says it supplied.
    const more = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 0.14, "energy-unit": "MWh" }));
    const [g] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(more) }] });
    expect(g.upstreamFigures?.energyKWh).toBeCloseTo(140, 9);
    expect(g.verdict).toBe("under-reported");
  });
});

describe("followUpstream: carbon is compared only on the same accounting basis", () => {
  // Draft -07 §Upstream Declarations, the fourth limit: "figures computed on
  // different bases are not comparable, so a consumer compares
  // `carbon-footprint` only where both objects declare the same
  // `carbon-accounting` value or neither declares one". The energy comparison
  // has no such basis and proceeds either way.

  it("compares carbon when both declare the same carbon-accounting value", async () => {
    // Same basis, and the upstream's carbon is ABOVE the subject's own total
    // while its energy is below: the carbon figures take part, so the verdict
    // is under-reported. (The subject reports 50 kgCO2e = 50,000 gCO2e.)
    const up = await serve(() => ({
      ...BASE,
      ...TENANT,
      "carbon-accounting": "market-based",
      "energy-consumption": 40,
      "carbon-footprint": 80,
    }));
    const [c] = await walk({
      ...BASE,
      "carbon-accounting": "market-based",
      upstream: [{ declaration: wellKnown(up) }],
    });
    expect(c.verdict).toBe("under-reported");
    expect(c.carbonComparison).toBe("compared");
    expect(c.detail).not.toContain("was not compared");
    expect(c.detail).toContain("investigate");
  });

  it("compares carbon when neither declares a carbon-accounting value", async () => {
    // Neither fixture carries the member, so the bases match by absence.
    const up = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 40, "carbon-footprint": 80 }));
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up) }] });
    expect(c.verdict).toBe("under-reported");
    expect(c.carbonComparison).toBe("compared");
    expect(c.detail).not.toContain("was not compared");
  });

  it("skips carbon when the two declare different bases, and still compares energy", async () => {
    // Market-based against location-based. On the carbon figures alone this
    // would read under-reported (80 kgCO2e delivered against the subject's
    // 50); they are not comparable, so only the energy figures decide, and
    // those are consistent. The reason is in the output, not dropped.
    const up = await serve(() => ({
      ...BASE,
      ...TENANT,
      "carbon-accounting": "location-based",
      "energy-consumption": 40,
      "carbon-footprint": 80,
    }));
    const [c] = await walk({
      ...BASE,
      "carbon-accounting": "market-based",
      upstream: [{ declaration: wellKnown(up) }],
    });
    expect(c.verdict).toBe("consistent");
    expect(c.carbonComparison).toBe("skipped-different-accounting-basis");
    expect(c.detail).toContain("`carbon-footprint` was not compared");
    expect(c.detail).toContain("declares carbon-accounting market-based");
    expect(c.detail).toContain("declares carbon-accounting location-based");
    expect(c.detail).toContain("different bases are not comparable");
    // Both figures are still reported; only the verdict leaves carbon out.
    expect(c.subject?.carbonGCO2e).toBe(50_000);
    expect(c.upstreamFigures?.carbonGCO2e).toBe(80_000);
  });

  it("skips carbon when one side declares a basis and the other does not", async () => {
    // Subject declares, upstream does not.
    const silent = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 40, "carbon-footprint": 80 }));
    const [c] = await walk({
      ...BASE,
      "carbon-accounting": "market-based",
      upstream: [{ declaration: wellKnown(silent) }],
    });
    expect(c.verdict).toBe("consistent");
    expect(c.carbonComparison).toBe("skipped-different-accounting-basis");
    expect(c.detail).toContain("declares carbon-accounting market-based");
    expect(c.detail).toContain("this upstream declares no carbon-accounting");

    // And the other way round: upstream declares, subject does not.
    const declaring = await serve(() => ({
      ...BASE,
      ...TENANT,
      "carbon-accounting": "location-based",
      "energy-consumption": 40,
      "carbon-footprint": 80,
    }));
    const [d] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(declaring) }] });
    expect(d.verdict).toBe("consistent");
    expect(d.carbonComparison).toBe("skipped-different-accounting-basis");
    expect(d.detail).toContain("the subject declares no carbon-accounting");
    expect(d.detail).toContain("this upstream declares carbon-accounting location-based");
  });

  it("not-comparable when skipping carbon leaves nothing to compare, and says why", async () => {
    // Neither object reports energy at all, so `carbon-footprint` was the only
    // shared figure — and the bases differ.
    const { "energy-consumption": _e, "energy-unit": _u, ...noEnergy } = BASE;
    const up = await serve(() => ({
      ...noEnergy,
      ...TENANT,
      "carbon-accounting": "location-based",
      "carbon-footprint": 20,
    }));
    const [c] = await walk({
      ...noEnergy,
      "carbon-accounting": "market-based",
      upstream: [{ declaration: wellKnown(up) }],
    });
    expect(c.verdict).toBe("not-comparable");
    expect(c.carbonComparison).toBe("skipped-different-accounting-basis");
    expect(c.detail).toContain("share no comparable figure");
    expect(c.detail).toContain("`carbon-footprint` was not compared");
    expect(c.detail).toContain("different bases are not comparable");
    expect(c.subject?.carbonGCO2e).toBe(50_000);
    expect(c.upstreamFigures?.carbonGCO2e).toBe(20_000);
  });

  it("an unrecognized carbon-accounting value is disregarded, so it reads as declaring none", async () => {
    // §Value Constraints and Omitted Metrics: an unrecognized value of
    // `carbon-accounting` "causes that member to be disregarded", so an object
    // carrying one is processed as though the member were absent and compares
    // equal to an object that declares no basis at all — rather than as a
    // third basis that matches nothing.
    const up = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 40, "carbon-footprint": 80 }));
    const [c] = await compareUpstream(
      { ...BASE, "carbon-accounting": "hybrid" as never, upstream: [{ declaration: wellKnown(up) }] },
      { timeoutMs: 5_000, maxBytes: 10_000, maxObjects: 10, allowInsecure: true },
    );
    expect(c.carbonComparison).toBe("compared");
    expect(c.verdict).toBe("under-reported");
  });

  it("carbonComparison is absent when there was no carbon comparison to make", async () => {
    // The upstream reports energy only: nothing was skipped and nothing was
    // compared, so the member says nothing rather than something misleading.
    const { "carbon-footprint": _c, "carbon-unit": _cu, ...noCarbon } = BASE;
    const up = await serve(() => ({ ...noCarbon, ...TENANT, "energy-consumption": 40 }));
    const [c] = await walk({
      ...BASE,
      "carbon-accounting": "market-based",
      upstream: [{ declaration: wellKnown(up) }],
    });
    expect(c.verdict).toBe("consistent");
    expect(c.carbonComparison).toBeUndefined();
    expect(c.detail).not.toContain("was not compared");

    // Nor for a declaration that was never compared at all.
    const own = await serve(() => ({ ...BASE, target: "cloud.example", "target-type": "origin" }));
    const [o] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(own) }] });
    expect(o.verdict).toBe("not-comparable");
    expect(o.carbonComparison).toBeUndefined();
  });
});

describe("followUpstream: what the output says about the finding", () => {
  it("an under-reported detail calls itself something to investigate, not a failure to conform", async () => {
    // Draft -07 §Upstream Declarations, the first limit: "whether a subject's
    // declared scope covers a given upstream is not expressible in this
    // format, so a subject that legitimately excludes one will read as
    // inconsistent, and the finding is something to investigate rather than a
    // failure to conform". A reader of this output must not come away thinking
    // the subject has broken a rule.
    const up = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 140 }));
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up) }] });
    expect(c.verdict).toBe("under-reported");
    expect(c.detail).toContain("evidence about consistency between two self-asserted claims, never proof");
    expect(c.detail).toContain("declared scope covers what this upstream delivers cannot be expressed in this format");
    expect(c.detail).toContain("something to investigate, not a failure to conform");
  });

  it("each entry is compared on its own, and no verdict is drawn over several together", async () => {
    // Draft -07 §Upstream Declarations, the third limit: "each `upstream`
    // entry is compared on its own, and no relation is defined over several of
    // them together". Two upstreams, each below the subject's own total on its
    // own but together above it: both are `consistent`, and nothing sums them.
    const a = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 80, "carbon-footprint": 40 }));
    const b = await serve(() => ({ ...BASE, ...TENANT, "energy-consumption": 90, "carbon-footprint": 45 }));
    const chain = await walk({
      ...BASE,
      upstream: [{ declaration: wellKnown(a) }, { declaration: wellKnown(b) }],
    });
    expect(chain).toHaveLength(2);
    expect(chain.map((c) => c.verdict)).toEqual(["consistent", "consistent"]);
    // 80 + 90 = 170 kWh against the subject's 100, and 40 + 45 = 85 kgCO2e
    // against its 50: had the two been added the verdict would differ, and the
    // draft defines no such relation.
    expect(chain.map((c) => c.upstreamFigures?.energyKWh)).toEqual([80, 90]);
  });

  it("compares energy-consumption and carbon-footprint and no other member", async () => {
    // Draft -07 §Upstream Declarations names the two compared members. An
    // upstream whose OTHER numeric members all exceed the subject's own —
    // scopes, SCI score, intensity, annual estimate, renewable share — is
    // still consistent: none of them takes part in a verdict.
    const up = await serve(() => ({
      ...BASE,
      ...TENANT,
      "energy-consumption": 40,
      "carbon-footprint": 20,
      "scope-1": 9_000,
      "scope-2": 9_000,
      "scope-3": 9_000,
      "sci-score": 9_000,
      "functional-unit": "request",
      "carbon-intensity-gCO2e-per-kWh": 9_000,
      "estimated-annual-emissions-kgCO2e": 9_000,
      "renewable-energy": 100,
    }));
    const [c] = await walk({
      ...BASE,
      "scope-1": 1,
      "sci-score": 1,
      "functional-unit": "request",
      "carbon-intensity-gCO2e-per-kWh": 1,
      "renewable-energy": 0,
      upstream: [{ declaration: wellKnown(up) }],
    });
    expect(c.verdict).toBe("consistent");
    // Only the two compared members are carried in the figures at all.
    expect(Object.keys(c.subject ?? {}).sort()).toEqual(["carbonGCO2e", "energyKWh"]);
    expect(Object.keys(c.upstreamFigures ?? {}).sort()).toEqual(["carbonGCO2e", "energyKWh"]);
  });
});

describe("followUpstream: a retrieved declaration is read with the same tolerance as any other", () => {
  // Draft -07 §Upstream Declarations: "It reads a retrieved declaration
  // exactly as it reads any other, applying the tolerance rules of Value
  // Constraints and Omitted Metrics rather than refusing one over a defective
  // value." A document the ordinary fetch path would read must therefore be
  // read here too — refusing it as unreachable would make the same bytes mean
  // two different things depending on which path found them.
  const { "carbon-footprint": _c, "carbon-unit": _cu, ...NO_CARBON } = BASE;

  it("retrieves an upstream carrying an unrecognized carbon-accounting value, disregards that member, and compares on energy", async () => {
    const up = await serve(() => ({
      ...NO_CARBON,
      ...TENANT,
      "energy-consumption": 140,
      "carbon-accounting": "hybrid",
    }));
    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up), role: "cloud" }] });

    // Retrieved, not refused: the defective member is disregarded and named.
    expect(c.verdict).toBe("under-reported");
    expect(c.detail).not.toContain("not retrieved");
    expect(c.upstreamDisregarded).toEqual(["carbon-accounting"]);
    expect(c.upstreamTargetType).toBe("tenant");

    // And the comparison proceeded on energy, which no accounting basis
    // parameterizes: 100 kWh declared against the 140 kWh the upstream says it
    // delivered to this tenant.
    expect(c.upstreamFigures?.energyKWh).toBe(140);
    expect(c.subject?.energyKWh).toBe(100);
    expect(c.carbonComparison).toBeUndefined();
  });

  it("disregards the same members in a retrieved upstream as in the same document fetched directly", async () => {
    const defective = {
      ...BASE,
      ...TENANT,
      "energy-consumption": 40,
      "carbon-accounting": "hybrid",
      "renewable-energy": "42",
    };
    const up = await serve(() => defective);

    const direct = await fetchSustainability(up, ALLOW_INSECURE);
    expect(direct.status).toBe("ok");
    const directlyDisregarded = direct.status === "ok" ? (direct.disregarded ?? []) : [];
    expect(directlyDisregarded).toEqual(["renewable-energy", "carbon-accounting"]);

    const [c] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(up) }] });
    expect(c.upstreamDisregarded).toEqual(directlyDisregarded);
    expect(c.verdict).toBe("consistent");
  });

  it("still reports an upstream that is not a declaration, or that omits a mandatory member, as not retrieved", async () => {
    // Tolerance disregards a defective value; it never manufactures a
    // readable declaration out of one that is not.
    const notADeclaration = await serve(() => 42);
    const [notOne] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(notADeclaration) }] });
    expect(notOne.verdict).toBe("unreachable");
    expect(notOne.detail).toContain("not retrieved");
    expect(notOne.upstreamDisregarded).toBeUndefined();

    const { provider: _p, ...noProvider } = BASE;
    const missingMandatory = await serve(() => ({ ...noProvider, ...TENANT, "energy-consumption": 40 }));
    const [missing] = await walk({ ...BASE, upstream: [{ declaration: wellKnown(missingMandatory) }] });
    expect(missing.verdict).toBe("unreachable");
    expect(missing.detail).toContain("not retrieved: invalid");
  });

  it("refuses the defective upstream in strict mode, exactly as strict mode refuses the same document fetched directly", async () => {
    const up = await serve(() => ({ ...NO_CARBON, ...TENANT, "energy-consumption": 140, "carbon-accounting": "hybrid" }));

    const direct = await fetchSustainability(up, { ...ALLOW_INSECURE, legacyCompat: false });
    expect(direct.status).toBe("invalid");

    const origin = await serve(() => ({ ...BASE, upstream: [{ declaration: wellKnown(up) }] }));
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, legacyCompat: false, followUpstream: true });
    expect(r.status).toBe("ok");
    const [c] = r.status === "ok" ? (r.upstream ?? []) : [];
    expect(c.verdict).toBe("unreachable");
    expect(c.detail).toContain("not retrieved: invalid");
  });
});

describe("followUpstream: the draft's rounding allowance", () => {
  // Draft -07 §Upstream Declarations: a consumer "disregards a shortfall no
  // larger than the rounding and unit conversion behind the two figures could
  // account for". 8.21 MWh converts to 8210.000000000002 kWh in binary
  // floating point, so a subject declaring exactly 8210 kWh would otherwise be
  // reported as under-reporting by two picowatt-hours.
  const { "carbon-footprint": _c, "carbon-unit": _cu, ...NO_CARBON } = BASE;

  it("disregards a shortfall no larger than the unit conversion could account for", async () => {
    const up = await serve(() => ({ ...NO_CARBON, ...TENANT, "energy-consumption": 8.21, "energy-unit": "MWh" }));
    const [c] = await walk({ ...NO_CARBON, "energy-consumption": 8210, upstream: [{ declaration: wellKnown(up) }] });
    expect(c.upstreamFigures?.energyKWh).toBeGreaterThan(8210); // the conversion residue is real
    expect(c.verdict).toBe("consistent");
  });

  it("reports a shortfall larger than that as under-reported", async () => {
    const up = await serve(() => ({ ...NO_CARBON, ...TENANT, "energy-consumption": 8.21, "energy-unit": "MWh" }));
    const [c] = await walk({ ...NO_CARBON, "energy-consumption": 8209.99, upstream: [{ declaration: wellKnown(up) }] });
    expect(c.verdict).toBe("under-reported");
  });
});

/**
 * Draft -07 §Upstream Declarations: a consumer walking the chain "MUST refuse
 * any URI it has already retrieved during the walk". The starting
 * declaration's own URL is one of those: an object naming itself in `upstream`
 * must not be fetched a second time.
 */
describe("a declaration that names its own URL as an upstream", () => {
  it("is refused as already retrieved, without a second request", async () => {
    let requests = 0;
    let selfUrl = "";
    const origin = await serve(() => {
      requests += 1;
      return { ...BASE, "target-type": "origin", upstream: [{ declaration: selfUrl, role: "hosting" }] };
    });
    selfUrl = wellKnown(origin);

    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, followUpstream: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.upstream).toHaveLength(1);
    expect(r.upstream?.[0]).toMatchObject({ declaration: selfUrl, role: "hosting", depth: 1, verdict: "unreachable" });
    expect(r.upstream?.[0].detail).toContain("already retrieved in this chain");
    // Exactly one retrieval: the declaration itself. The self-reference cost
    // no request at all.
    expect(requests).toBe(1);
  });
});
