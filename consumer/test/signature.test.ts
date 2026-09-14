/**
 * The signature resource end to end: fetchSustainability({ verifySignature }),
 * fetchSignature's redirect rules, and the conformance battery's new check.
 * The signing side is the REAL sibling publisher (its compiled dist), so this
 * is also the interop proof that publisher-signed ⇒ consumer-verified.
 */
import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as jose from "jose";
import { afterEach, describe, expect, it } from "vitest";
import { fetchSignature, fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { runConformanceChecks } from "../src/conformance";
import { ALLOW_INSECURE } from "./helpers";

const publisherDist = path.resolve(__dirname, "../../publisher/dist");
const hasPublisher = fs.existsSync(path.join(publisherDist, "jws.js"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pub = hasPublisher ? require(publisherDist) : undefined;

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((r) => s.close(() => r()));
  }
});

function listen(server: Server): Promise<string> {
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`));
  });
}

function publisherServer(signed: boolean) {
  const publisher = new pub.Publisher(
    pub.computedAdapter({
      provider: "Example Corp",
      methodologyUri: "https://example.com/m",
      reportingPeriod: "2026-02",
      energy: { value: 1250, unit: "kWh" },
      gridIntensity: 276,
    }),
    { cacheTtlMs: 60_000, normalize: { target: "example.com" } },
  );
  return (async () => {
    const signingKey = signed ? await pub.generateSigningKey() : undefined;
    return { server: pub.createSustainabilityServer(publisher, { signingKey }) as Server, signingKey };
  })();
}

/** A hand-rolled origin: serves `doc` and whatever `jws` handler says. */
function customServer(
  doc: string,
  jws: (req: IncomingMessage, res: ServerResponse) => void,
  contentType = "application/sustainability-data+json",
): Server {
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === WELL_KNOWN_PATH) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        return res.end();
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        ETag: '"abc"',
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      });
      if (req.headers["if-none-match"] === '"abc"') {
        res.statusCode = 304;
        return res.end();
      }
      return res.end(req.method === "HEAD" ? undefined : doc);
    }
    if (url.pathname === `${WELL_KNOWN_PATH}.jws`) return jws(req, res);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end("{}");
  });
}

const EXAMPLE = fs.readFileSync(path.resolve(__dirname, "../../example-responses/example-response.json"), "utf8");

describe.skipIf(!hasPublisher)("interop: publisher-signed ⇒ consumer-verified", () => {
  it("verifySignature reports `verified` over the served bytes; the document outcome is unchanged", async () => {
    const { server, signingKey } = await publisherServer(true);
    const base = await listen(server);
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signature).toMatchObject({
      status: "verified",
      alg: "EdDSA",
      kid: signingKey.kid,
      keySource: "header",
      mediaType: "application/jose",
      mediaTypeOk: true,
    });
    expect(r.mediaType).toBe("sustainability-data+json");
    // Without the option, nothing extra is fetched or reported.
    const plain = await fetchSustainability(base, ALLOW_INSECURE);
    expect(plain.status === "ok" && plain.signature).toBeUndefined();
  });

  it("a pinned key verifies with keySource=trusted; a different pinned key ⇒ unverified", async () => {
    const { server, signingKey } = await publisherServer(true);
    const base = await listen(server);
    const good = await fetchSustainability(base, {
      ...ALLOW_INSECURE,
      verifySignature: true,
      signaturePolicy: { trustedKeys: [signingKey.publicJwk] },
    });
    expect(good.status === "ok" && good.signature).toMatchObject({ status: "verified", keySource: "trusted" });
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const bad = await fetchSustainability(base, {
      ...ALLOW_INSECURE,
      verifySignature: true,
      signaturePolicy: { trustedKeys: [await jose.exportJWK(other.publicKey)] },
    });
    expect(bad.status === "ok" && bad.signature).toMatchObject({ status: "unverified", reason: "invalid-signature" });
  });

  it("an unsigned publisher ⇒ `absent`, and the battery passes with 'not published (optional)'", async () => {
    const { server } = await publisherServer(false);
    const base = await listen(server);
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status === "ok" && r.signature).toEqual({ status: "absent" });
    const report = await runConformanceChecks(base, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Detached signature resource"))!;
    expect(c).toMatchObject({ outcome: "pass", level: "MUST", detail: "not published (optional)" });
  });

  it("the battery verifies a signing publisher and names the algorithm", async () => {
    const { server, signingKey } = await publisherServer(true);
    const base = await listen(server);
    const report = await runConformanceChecks(base, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Detached signature resource"))!;
    expect(c.outcome).toBe("pass");
    expect(c.detail).toContain(`verified EdDSA kid=${signingKey.kid}`);
    expect(report.allPassed).toBe(true);
  });

  it("Extended parameters ⇒ not-applicable (the signature covers the parameterless document only)", async () => {
    const { server } = await publisherServer(true);
    const base = await listen(server);
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, verifySignature: true, period: "2026" });
    expect(r.status === "ok" && r.signature).toEqual({ status: "not-applicable", reason: "parameters-present" });
  });
});

describe.skipIf(!hasPublisher)("signature resource failure modes", () => {
  async function signedJws(bytes: string) {
    const key = await pub.generateSigningKey();
    return { key, jws: (await pub.signDetached(bytes, key)) as string };
  }

  it("a signature over different bytes ⇒ unverified/invalid-signature and status ok; battery FAILs", async () => {
    const { jws } = await signedJws(EXAMPLE + "\n");
    const base = await listen(
      customServer(EXAMPLE, (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/jose" });
        res.end(jws);
      }),
    );
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.signature).toMatchObject({ status: "unverified", reason: "invalid-signature" });
    const report = await runConformanceChecks(base, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Detached signature resource"))!;
    expect(c.outcome).toBe("fail");
    expect(c.detail).toContain("invalid-signature");
    expect(report.allPassed).toBe(false);
  });

  it("a valid signature served under the wrong media type ⇒ verified but mediaTypeOk=false; battery WARNs", async () => {
    const { jws } = await signedJws(EXAMPLE);
    const base = await listen(
      customServer(EXAMPLE, (_req, res) => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(jws);
      }),
    );
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status === "ok" && r.signature).toMatchObject({ status: "verified", mediaTypeOk: false, mediaType: "text/plain" });
    const report = await runConformanceChecks(base, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Detached signature resource"))!;
    expect(c.outcome).toBe("warn");
    expect(report.allPassed).toBe(true);
  });

  it("alg none at the signature path ⇒ unverified/alg-rejected; battery FAILs", async () => {
    const none = `${Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url")}..`;
    const base = await listen(
      customServer(EXAMPLE, (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/jose" });
        res.end(none);
      }),
    );
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status === "ok" && r.signature).toMatchObject({ status: "unverified", reason: "alg-rejected" });
    const report = await runConformanceChecks(base, undefined, ALLOW_INSECURE);
    expect(report.checks.find((x) => x.name.startsWith("Detached signature resource"))!.outcome).toBe("fail");
  });

  it("a redirect of the signature resource to another origin is refused", async () => {
    const { jws } = await signedJws(EXAMPLE);
    const other = await listen(
      customServer(EXAMPLE, (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/jose" });
        res.end(jws);
      }),
    );
    const base = await listen(
      customServer(EXAMPLE, (_req, res) => {
        res.writeHead(302, { Location: `${other}${WELL_KNOWN_PATH}.jws` });
        res.end();
      }),
    );
    const r = await fetchSustainability(base, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status === "ok" && r.signature).toMatchObject({ status: "unverified", reason: "cross-origin-redirect" });
    const direct = await fetchSignature(base, { ...ALLOW_INSECURE, documentOrigin: base });
    expect(direct).toMatchObject({ status: "error", reason: "cross-origin-redirect" });
  });

  it("non-200/404 answers and oversized bodies are `unverified` with the reason, never a throw", async () => {
    const base503 = await listen(
      customServer(EXAMPLE, (_req, res) => {
        res.writeHead(503);
        res.end();
      }),
    );
    expect(await fetchSignature(base503, ALLOW_INSECURE)).toEqual({ status: "error", reason: "http-503" });
    const big = await listen(
      customServer(EXAMPLE, (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/jose" });
        res.end("x".repeat(20_000));
      }),
    );
    expect(await fetchSignature(big, ALLOW_INSECURE)).toMatchObject({ status: "error", reason: "too-large" });
    const r = await fetchSustainability(big, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status === "ok" && r.signature).toMatchObject({ status: "unverified", reason: "too-large" });
  });

  it("refuses a non-HTTPS signature URL unless allowInsecure, like the document itself", async () => {
    const { jws } = await signedJws(EXAMPLE);
    const base = await listen(
      customServer(EXAMPLE, (_req, res) => {
        res.writeHead(200, { "Content-Type": "application/jose" });
        res.end(jws);
      }),
    );
    expect(await fetchSignature(base)).toMatchObject({ status: "error", reason: "insecure-transport" });
    expect(await fetchSignature(base, ALLOW_INSECURE)).toMatchObject({ status: "present", contentType: "application/jose" });
  });

  it("resolves the signature path under a gateway prefix", async () => {
    const seen: string[] = [];
    const server = createServer((req, res) => {
      seen.push(req.url ?? "");
      res.writeHead(404);
      res.end();
    });
    const base = await listen(server);
    await fetchSignature(`${base}/cloudflare.com`, ALLOW_INSECURE);
    expect(seen).toEqual(["/cloudflare.com/.well-known/sustainability-data.jws"]);
  });
});
