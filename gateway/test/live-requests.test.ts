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
    const section = html.slice(html.indexOf("<h2>Service level</h2>"), html.indexOf("<h2>Verify these documents yourself</h2>"));
    for (const r of liveRequests(srv.gw.index)) {
      expect(section).toContain(`<a href="${r.href.replace(/&/g, "&amp;")}"`);
    }
  });

  it("an unsigned deployment lists no signature, key or attestation links", () => {
    const hrefs = liveRequests(srv.gw.index).map((r) => r.href);
    expect(hrefs.some((h) => h.endsWith(".jws") && !h.includes("/", 1))).toBe(false);
    expect(hrefs.some((h) => /^https?:/.test(h))).toBe(false);
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

  it("adds the signature resource and the two hosted files, external ones opened safely", async () => {
    const rows = liveRequests(srv.gw.index);
    const hrefs = rows.map((r) => r.href);
    expect(hrefs).toContain("/.well-known/sustainability-data.jws");
    expect(hrefs).toContain(KEY_URL);
    expect(hrefs).toContain(VC_URL);
    const sig = await fetch(`${srv.base}/.well-known/sustainability-data.jws`);
    expect(sig.status).toBe(200);
    expect(sig.headers.get("content-type")).toBe("application/jose");
    const html = renderIndexHtml(srv.gw.index);
    expect(html).toContain(`<a href="${KEY_URL}" rel="noopener noreferrer">`);
    expect(html).toContain(`<a href="${VC_URL}" rel="noopener noreferrer">`);
  });
});
