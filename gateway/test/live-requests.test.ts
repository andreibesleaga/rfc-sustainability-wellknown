/**
 * The front page's "Service level" table lists every working GET on the
 * deployment as a hyperlink with its expected outcome. This suite clicks each
 * same-origin link and checks the status it promises, on an unsigned and on a
 * signed deployment.
 */
import { exportPrivateJwk, generateSigningKey } from "sustainability-wellknown-publisher";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { liveRequests, renderIndexHtml, type LiveRequest } from "../src/index-page";
import { startGateway, type TestServer } from "./helpers";

const KEY_URL = "https://keys.example/signing.jwk";
const VC_URL = "https://attester.example/gateway.vc.jwt";

/** The status a row promises: the leading number of its `expect` column. */
const promised = (r: LiveRequest): number => Number(r.expect.match(/^\d{3}/)?.[0]);

describe("front-page live requests", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startGateway();
  });
  afterAll(async () => srv.close());

  it("every same-origin link answers with the status its row promises", async () => {
    const rows = liveRequests(srv.gw.index);
    expect(rows.length).toBeGreaterThanOrEqual(12);
    for (const r of rows) {
      expect(promised(r), r.href).toBeGreaterThan(0);
      if (/^https?:/.test(r.href)) continue;
      const res = await fetch(`${srv.base}${r.href}`);
      expect(res.status, `${r.href} — ${r.what}`).toBe(promised(r));
    }
  });

  it("renders the table in the Service level section with one hyperlink per request", async () => {
    const html = await (await fetch(`${srv.base}/`)).text();
    const section = html.slice(html.indexOf("<h2>Service level</h2>"), html.indexOf("<h2>Verify these declarations yourself</h2>"));
    for (const r of liveRequests(srv.gw.index)) {
      expect(section).toContain(`<a href="${r.href.replace(/&/g, "&amp;")}"`);
    }
  });

  it("an unsigned deployment lists no signature, key or attestation links", () => {
    const rows = liveRequests(srv.gw.index);
    const hrefs = rows.map((r) => r.href);
    // -07 withdrew the signature resource: no row may name one, signed or not.
    expect(hrefs.some((h) => h.includes(".jws"))).toBe(false);
    expect(rows.some((r) => /signed/.test(r.what))).toBe(false);
    // The only absolute URL on an unsigned deployment is the upstream chain
    // row, which shows the `upstream[].declaration` value verbatim — the draft
    // requires that member to be an absolute "https" URI.
    const absolute = hrefs.filter((h) => /^https?:/.test(h));
    expect(absolute).toHaveLength(1);
    expect(absolute[0]).toContain("/cloud-demo.example/.well-known/sustainability-data");
  });

  it("lists the upstream chain: the declaration the downstream demo names, served here", async () => {
    const row = liveRequests(srv.gw.index).find((r) => r.what.startsWith("the upstream chain"));
    expect(row).toBeDefined();
    expect(row!.href).toContain("/cloud-demo.example/.well-known/sustainability-data");
    // It is an absolute URI (the draft requires https), so it is followed by
    // path here rather than by host: this instance is a loopback http server.
    const doc = await (await fetch(`${srv.base}${new URL(row!.href).pathname}`)).json();
    expect(doc["target-type"]).toBe("tenant");
  });
});

describe("front-page live requests, signed and attested", () => {
  let srv: TestServer;
  beforeAll(async () => {
    const key = await generateSigningKey();
    srv = await startGateway({ signingKeyJwk: JSON.stringify(await exportPrivateJwk(key)), attestationUri: VC_URL });
    srv.gw.index.self.signature!["public-key-url"] = KEY_URL;
  });
  afterAll(async () => srv.close());

  it("adds a row for the in-place signature and the two hosted files, external ones opened safely", async () => {
    const rows = liveRequests(srv.gw.index);
    const hrefs = rows.map((r) => r.href);
    expect(hrefs.some((h) => h.includes(".jws"))).toBe(false);
    const signedRow = rows.find((r) => r.what.includes("`signed` member"));
    expect(signedRow).toBeDefined();
    expect(signedRow!.href).toBe("/.well-known/sustainability-data");
    expect(signedRow!.expect).toContain("no separate signature resource");
    expect(hrefs).toContain(KEY_URL);
    expect(hrefs).toContain(VC_URL);
    // The row's promise holds: the served declaration really carries `signed`.
    const doc = await (await fetch(`${srv.base}${signedRow!.href}`)).json();
    expect(typeof doc.signed).toBe("string");
    const html = renderIndexHtml(srv.gw.index);
    expect(html).toContain(`<a href="${KEY_URL}" rel="noopener noreferrer">`);
    expect(html).toContain(`<a href="${VC_URL}" rel="noopener noreferrer">`);
  });
});
