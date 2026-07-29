/**
 * The repository's OWN conformance battery (`consumer/src/conformance.ts`,
 * published as `sustainability-wellknown-consumer`) run against this gateway —
 * once for the gateway's own report at the root, and once for EVERY subject.
 *
 * The battery targets an origin and always requests `/.well-known/
 * sustainability-data` at that origin's root, which is correct for a normal
 * publisher. This gateway serves many subjects under a path prefix, so each
 * subject run passes a `fetchImpl` that rewrites the well-known path to that
 * subject's route. Nothing else about the battery changes: the same checks
 * (media type, ETag, conditional GET, 405 + Allow, Extended-parameter
 * tolerance) run against the same server.
 */
import { runConformanceChecks } from "sustainability-wellknown-consumer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startGateway, type TestServer } from "./helpers";

const WELL_KNOWN = "/.well-known/sustainability-data";

let srv: TestServer;
beforeAll(async () => {
  srv = await startGateway();
});
afterAll(async () => {
  await srv.close();
});

/** A fetch that re-points the battery's root well-known path at one subject. */
function prefixed(domain: string): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(typeof input === "string" ? input : input.toString());
    if (u.pathname === WELL_KNOWN) u.pathname = `/${domain}${WELL_KNOWN}`;
    return fetch(u, init);
  }) as typeof fetch;
}

describe("repository conformance battery", () => {
  it("passes for the gateway's own report at the root", async () => {
    const report = await runConformanceChecks(srv.base);
    const failed = report.checks.filter((c) => !c.pass);
    expect(failed.map((c) => `${c.name}: ${c.detail ?? ""}`)).toEqual([]);
    expect(report.allPassed).toBe(true);
  });

  it("passes for every registered subject", async () => {
    for (const domain of srv.gw.subjects.keys()) {
      const report = await runConformanceChecks(srv.base, prefixed(domain));
      const failed = report.checks.filter((c) => !c.pass);
      expect(failed.map((c) => `${domain} — ${c.name}: ${c.detail ?? ""}`)).toEqual([]);
    }
  });
});
