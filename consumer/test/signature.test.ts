/**
 * The OPTIONAL embedded signature (draft -07 §Signing) end to end: the `signed`
 * member verified by `verifyEmbeddedSignature`, by
 * `fetchSustainability({ verifySignature })`, and by the conformance battery.
 *
 * Declarations are signed here with `jose` directly — an independent producer,
 * no network, no clock — so what is under test is this package's verifier
 * policy and nothing else.
 */
import { createServer, Server } from "node:http";
import type { AddressInfo } from "node:net";
import * as jose from "jose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchSustainability, WELL_KNOWN_PATH } from "../src/fetch";
import { verifyEmbeddedSignature } from "../src/signature";
import { runConformanceChecks } from "../src/conformance";
import { DECLARATION_CTY, PublicJwk } from "../src/jws";
import { MEDIA_TYPE } from "../src/media-type";
import { SustainabilityMetrics } from "../src/types";
import { ALLOW_INSECURE } from "./helpers";

const DECLARATION: SustainabilityMetrics = {
  updated: "2026-03-01T12:00:00Z",
  capabilities: "basic",
  provider: "Example Corp (sustain@example.org)",
  "measurement-method": "cloud-billing",
  "methodology-uri": "https://example.com/methodology",
  "reporting-period": "2025",
  target: "example.com",
  "energy-consumption": 15000,
  "energy-unit": "kWh",
  "carbon-footprint": 4140,
  "carbon-unit": "kgCO2e",
};

let ed: jose.GenerateKeyPairResult;
let edPub: PublicJwk;

beforeAll(async () => {
  ed = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  edPub = { ...(await jose.exportJWK(ed.publicKey)), kid: "pub-1" };
});

/** Sign `object` the way a publisher does: the JWS payload is the object itself. */
async function signDeclaration(
  object: Record<string, unknown>,
  header: Partial<jose.CompactJWSHeaderParameters> = {},
  key: jose.CryptoKey = ed.privateKey,
): Promise<Record<string, unknown>> {
  const { signed: _drop, ...payload } = object;
  const jws = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
    .setProtectedHeader({ alg: "EdDSA", cty: DECLARATION_CTY, kid: "pub-1", jwk: edPub, ...header } as jose.CompactJWSHeaderParameters)
    .sign(key);
  return { ...object, signed: jws };
}

const servers: Server[] = [];
afterEach(async () => {
  while (servers.length) {
    const s = servers.pop()!;
    await new Promise<void>((r) => s.close(() => r()));
  }
});

/** A conformant origin serving `body` (and 405/304 as the battery expects). */
function serve(body: unknown): Promise<string> {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const ETAG = '"sig-fixture"';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (!url.pathname.startsWith(WELL_KNOWN_PATH)) {
      res.writeHead(404);
      return res.end();
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      return res.end();
    }
    if (req.headers["if-none-match"] === ETAG) {
      res.writeHead(304, { ETag: ETAG });
      return res.end();
    }
    res.writeHead(200, { "Content-Type": MEDIA_TYPE, ETag: ETAG, "Access-Control-Allow-Origin": "*" });
    res.end(req.method === "HEAD" ? undefined : text);
  });
  servers.push(server);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
  );
}

describe("verifyEmbeddedSignature (the `signed` member)", () => {
  it("verifies a signature over the object itself and reports the key source", async () => {
    const signed = await signDeclaration(DECLARATION);
    const outcome = await verifyEmbeddedSignature(signed);
    expect(outcome.result).toMatchObject({
      status: "verified",
      alg: "EdDSA",
      kid: "pub-1",
      keySource: "header",
      cty: DECLARATION_CTY,
      modifiedAfterSigning: false,
    });
    expect(outcome.payload).toEqual(DECLARATION);
  });

  it("an absent member is `unsigned` — never an error, and not evidence of anything", async () => {
    expect((await verifyEmbeddedSignature(DECLARATION)).result).toEqual({ status: "unsigned" });
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: undefined })).result).toEqual({ status: "unsigned" });
    // Draft -07 §Value Constraints and Omitted Metrics: a `signed` value of the
    // wrong JSON type "is disregarded and the object is processed as though the
    // member were absent" — so UNSIGNED, never "unverified": there is no
    // signature there to fail.
    for (const wrong of [42, null, true, {}, [], { jws: "x" }]) {
      expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: wrong })).result, JSON.stringify(wrong)).toEqual({
        status: "unsigned",
      });
    }
    // An empty STRING is the right type and a broken value: unverified.
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: "  " })).result).toMatchObject({
      status: "unverified",
      reason: "malformed",
    });
  });

  it("accepts either RFC 7515 §4.1.10 spelling of the declaration media type in cty", async () => {
    // The publisher writes the prefix-omitted form; a publisher that writes
    // the full `application/...` names the same media type and verifies.
    const full = await signDeclaration(DECLARATION, { cty: "application/sustainability-data+json" });
    expect((await verifyEmbeddedSignature(full)).result).toMatchObject({ status: "verified", alg: "EdDSA" });
    const short = await signDeclaration(DECLARATION, { cty: DECLARATION_CTY });
    expect((await verifyEmbeddedSignature(short)).result).toMatchObject({ status: "verified", alg: "EdDSA" });
  });

  it("rejects a signature whose cty is absent or names another payload type", async () => {
    for (const cty of [undefined, "vc", "application/vc+jwt", "application/json"]) {
      const signed = await signDeclaration(DECLARATION, { cty });
      expect((await verifyEmbeddedSignature(signed)).result, `cty ${String(cty)}`).toMatchObject({
        status: "unverified",
        reason: "cty-rejected",
      });
    }
  });

  it("rejects alg none and MAC algorithms — the key and this consumer's policy decide, not the header", async () => {
    const payload = jose.base64url.encode(new TextEncoder().encode(JSON.stringify(DECLARATION)));
    const noneHeader = jose.base64url.encode(new TextEncoder().encode(JSON.stringify({ alg: "none", cty: DECLARATION_CTY })));
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: `${noneHeader}.${payload}.` })).result).toMatchObject({
      status: "unverified",
      reason: "alg-rejected",
    });

    const hs = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(DECLARATION)))
      .setProtectedHeader({ alg: "HS256", cty: DECLARATION_CTY })
      .sign(new TextEncoder().encode("shared-secret-shared-secret-shared-secret"));
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: hs })).result).toMatchObject({
      status: "unverified",
      reason: "alg-rejected",
    });
  });

  it("reports modified-after-signing, and precedence follows how far the key is trusted", async () => {
    const signed = await signDeclaration(DECLARATION);
    const tampered = { ...signed, "carbon-footprint": 1 };

    // Key from the JOSE Header: trusted no further than the declaration
    // carrying it, so the members served by the origin remain the ones used.
    const fromHeader = await verifyEmbeddedSignature(tampered);
    expect(fromHeader.result).toMatchObject({
      status: "verified",
      keySource: "header",
      precedence: "origin",
      modifiedAfterSigning: true,
    });
    expect(fromHeader.differences).toEqual(["carbon-footprint"]);
    // The payload is still reported, for inspection — it just does not win.
    expect(fromHeader.payload?.["carbon-footprint"]).toBe(4140);

    // Key pinned by this consumer: the RFC 8414 `signed_metadata` precedence.
    const pinned = await verifyEmbeddedSignature(tampered, { trustedKeys: [edPub] });
    expect(pinned.result).toMatchObject({ status: "verified", keySource: "trusted", precedence: "payload" });
    expect(pinned.payload?.["carbon-footprint"]).toBe(4140);
  });

  it("a payload that describes another subject or period leaves the object unverified", async () => {
    // Draft -07 §Verification: "A consumer MUST also treat the object as
    // unverified when the payload's `target` or `reporting-period` differs
    // from the object's, since the two then describe different things."
    const otherSubject = await signDeclaration({ ...DECLARATION, target: "other.example" });
    const objectA = { ...DECLARATION, signed: otherSubject.signed };
    const a = await verifyEmbeddedSignature(objectA, { trustedKeys: [edPub] });
    expect(a.result).toMatchObject({ status: "unverified", reason: "payload-subject-mismatch" });
    expect(a.result.status === "unverified" && a.result.detail).toContain("target");
    expect(a.payload).toBeUndefined();

    const otherPeriod = await signDeclaration({ ...DECLARATION, "reporting-period": "2024" });
    const b = await verifyEmbeddedSignature({ ...DECLARATION, signed: otherPeriod.signed }, { trustedKeys: [edPub] });
    expect(b.result).toMatchObject({ status: "unverified", reason: "payload-subject-mismatch" });
    expect(b.result.status === "unverified" && b.result.detail).toContain("reporting-period");

    // The reason is distinct from the payload-not-a-declaration one.
    expect((a.result as { reason: string }).reason).not.toBe("payload-not-declaration");
  });

  it("a payload that itself carries `signed` is rejected", async () => {
    // Draft -07 §The signed Member: "The payload MUST NOT itself contain a
    // `signed` member."
    const inner = await signDeclaration(DECLARATION);
    const jws = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify(inner)))
      .setProtectedHeader({ alg: "EdDSA", cty: DECLARATION_CTY, kid: "pub-1", jwk: edPub })
      .sign(ed.privateKey);
    const outcome = await verifyEmbeddedSignature({ ...DECLARATION, signed: jws }, { trustedKeys: [edPub] });
    expect(outcome.result).toMatchObject({ status: "unverified", reason: "payload-carries-signed" });
    expect(outcome.payload).toBeUndefined();
  });

  it("a payload that is not a valid declaration object is unverified, not accepted", async () => {
    const jws = await new jose.CompactSign(new TextEncoder().encode(JSON.stringify({ not: "a declaration" })))
      .setProtectedHeader({ alg: "EdDSA", cty: DECLARATION_CTY, jwk: edPub })
      .sign(ed.privateKey);
    expect((await verifyEmbeddedSignature({ ...DECLARATION, signed: jws })).result).toMatchObject({
      status: "unverified",
      reason: "payload-not-declaration",
    });
  });

  it("a pinned key verifies with keySource=trusted; a different pinned key ⇒ unverified", async () => {
    const signed = await signDeclaration(DECLARATION);
    expect((await verifyEmbeddedSignature(signed, { trustedKeys: [edPub] })).result).toMatchObject({
      status: "verified",
      keySource: "trusted",
    });
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    expect(
      (await verifyEmbeddedSignature(signed, { trustedKeys: [await jose.exportJWK(other.publicKey)] })).result,
    ).toMatchObject({ status: "unverified", reason: "invalid-signature" });
  });
});

describe("fetchSustainability({ verifySignature })", () => {
  it("reports one outcome per object and leaves the declaration's own status alone", async () => {
    const origin = await serve(await signDeclaration(DECLARATION));
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures).toHaveLength(1);
    expect(r.signatures?.[0]).toMatchObject({ status: "verified", alg: "EdDSA", keySource: "header" });
    expect(r.warnings).toBeUndefined();
    // Without the option, nothing is verified or reported.
    const plain = await fetchSustainability(origin, ALLOW_INSECURE);
    expect(plain.status === "ok" && plain.signatures).toBeUndefined();
  });

  it("an unsigned publisher ⇒ `unsigned`, and the battery passes with 'not signed (optional)'", async () => {
    const origin = await serve(DECLARATION);
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status === "ok" && r.signatures).toEqual([{ status: "unsigned" }]);
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Embedded signature"))!;
    expect(c).toMatchObject({ outcome: "pass", level: "MUST", detail: "not signed (optional)" });
  });

  it("signs every object of an array separately, and each is reported in order", async () => {
    const a = { ...DECLARATION, "reporting-period": "2025-01" };
    const b = { ...DECLARATION, "reporting-period": "2025-02" };
    const body = [await signDeclaration(a), await signDeclaration(b)];
    const origin = await serve(body);
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures).toHaveLength(2);
    expect(r.signatures?.every((s) => s.status === "verified")).toBe(true);
    // The second object is unsigned: its own outcome says so, the first is untouched.
    const mixed = await serve([await signDeclaration(a), b]);
    const r2 = await fetchSustainability(mixed, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r2.status === "ok" && r2.signatures?.map((s) => s.status)).toEqual(["verified", "unsigned"]);
  });

  it("a header-key signature does NOT override the members served by the origin", async () => {
    // The security fix of -07: "letting a self-asserted payload override an
    // origin-authenticated one would let anyone able to add a member replace
    // every figure". The difference is still reported.
    const signed = await signDeclaration(DECLARATION);
    const origin = await serve({ ...signed, "carbon-footprint": 1, provider: "Someone Else" });
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures?.[0]).toMatchObject({
      status: "verified",
      keySource: "header",
      precedence: "origin",
      modifiedAfterSigning: true,
    });
    const doc = r.document as SustainabilityMetrics;
    expect(doc["carbon-footprint"]).toBe(1);
    expect(doc.provider).toBe("Someone Else");
    expect(typeof doc.signed).toBe("string");
    const warning = (r.warnings ?? []).find((w) => w.startsWith("modified-after-signing"));
    expect(warning).toBeDefined();
    expect(warning).toContain("served by the ORIGIN are the ones reported");
    // The battery reports the difference rather than failing the origin.
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Embedded signature"))!;
    expect(c.outcome).toBe("warn");
    expect(report.allPassed).toBe(true);
  });

  it("a pinned-key signature DOES override the members served by the origin", async () => {
    const signed = await signDeclaration(DECLARATION);
    const origin = await serve({ ...signed, "carbon-footprint": 1, provider: "Someone Else" });
    const r = await fetchSustainability(origin, {
      ...ALLOW_INSECURE,
      verifySignature: true,
      signaturePolicy: { trustedKeys: [edPub] },
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures?.[0]).toMatchObject({ status: "verified", keySource: "trusted", precedence: "payload" });
    const doc = r.document as SustainabilityMetrics;
    expect(doc["carbon-footprint"]).toBe(4140);
    expect(doc.provider).toBe(DECLARATION.provider);
    // The signature itself is kept alongside the payload it covers.
    expect(typeof doc.signed).toBe("string");
    const warning = (r.warnings ?? []).find((w) => w.startsWith("modified-after-signing"));
    expect(warning).toContain("payload's members are the ones reported");
  });

  it("a wrongly typed `signed` member reads as unsigned through the fetch path", async () => {
    const origin = await serve({ ...DECLARATION, signed: { jws: "not a string" } });
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures).toEqual([{ status: "unsigned" }]);
    expect(r.disregarded).toContain("signed");
  });

  it("a signature that does not verify ⇒ status ok with `unverified`; the battery FAILs", async () => {
    const signed = await signDeclaration(DECLARATION);
    const broken = (signed.signed as string).slice(0, -4) + "AAAA";
    const origin = await serve({ ...DECLARATION, signed: broken });
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    expect(r.status === "ok" && r.signatures?.[0]).toMatchObject({ status: "unverified" });
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Embedded signature"))!;
    expect(c.outcome).toBe("fail");
    expect(report.allPassed).toBe(false);
  });

  it("the battery verifies a signing publisher and names the algorithm", async () => {
    const origin = await serve(await signDeclaration(DECLARATION));
    const report = await runConformanceChecks(origin, undefined, ALLOW_INSECURE);
    const c = report.checks.find((x) => x.name.startsWith("Embedded signature"))!;
    expect(c.outcome).toBe("pass");
    expect(c.detail).toContain("verified EdDSA kid=pub-1");
    expect(report.allPassed).toBe(true);
  });

  it("Extended parameters change nothing: the signature covers the object it appears in", async () => {
    // The payload of the `signed` member is the object it appears in, so a
    // parameterized response is checked exactly like a Basic one.
    const origin = await serve(await signDeclaration({ ...DECLARATION, capabilities: "extended" }));
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true, period: "2025" });
    expect(r.status === "ok" && r.signatures?.[0]).toMatchObject({ status: "verified" });
  });

  it("a pinned key is honoured through the fetch path", async () => {
    const origin = await serve(await signDeclaration(DECLARATION));
    const good = await fetchSustainability(origin, {
      ...ALLOW_INSECURE,
      verifySignature: true,
      signaturePolicy: { trustedKeys: [edPub] },
    });
    expect(good.status === "ok" && good.signatures?.[0]).toMatchObject({ status: "verified", keySource: "trusted" });
    const other = await jose.generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
    const bad = await fetchSustainability(origin, {
      ...ALLOW_INSECURE,
      verifySignature: true,
      signaturePolicy: { trustedKeys: [await jose.exportJWK(other.publicKey)] },
    });
    expect(bad.status === "ok" && bad.signatures?.[0]).toMatchObject({ status: "unverified", reason: "invalid-signature" });
  });
});

/**
 * An `extensions` value is unconstrained JSON, so an origin can nest one
 * thousands of levels deep, and the key in a JOSE Header is self-asserted — so
 * the same origin can sign its own hostile document and have it verify. That
 * combination reaches the structural comparison between the object and its own
 * signed payload, which a recursive implementation could not survive: it threw
 * `RangeError: Maximum call stack size exceeded` out of `fetchSustainability`,
 * which promises never to throw and to report every outcome as a status.
 */
describe("a deeply nested, correctly self-signed declaration is compared, not crashed on", () => {
  /** `{"n":{"n":…{"leaf":1}…}}` built as text: JSON.stringify cannot make this. */
  const nest = (depth: number) => '{"n":'.repeat(depth) + '{"leaf":1}' + "}".repeat(depth);

  async function serveNested(depth: number): Promise<string> {
    const payloadText =
      '{"updated":"2026-03-01T12:00:00Z","capabilities":"basic","provider":"p","measurement-method":"m",' +
      '"methodology-uri":"https://x.example/m","reporting-period":"2025","target":"example.com",' +
      '"carbon-footprint":1,"extensions":{"urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845":' +
      nest(depth) +
      "}}";
    const jws = await new jose.CompactSign(new TextEncoder().encode(payloadText))
      .setProtectedHeader({ alg: "EdDSA", cty: DECLARATION_CTY, jwk: edPub })
      .sign(ed.privateKey);
    return serve(payloadText.slice(0, -1) + ',"signed":"' + jws + '"}');
  }

  it("verifies it (25 000 levels deep) instead of throwing", async () => {
    const origin = await serveNested(25_000);
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.signatures?.[0]).toMatchObject({ status: "verified", keySource: "header", precedence: "origin" });
    // The object and the payload are identical, so nothing was modified after
    // signing — the comparison ran to completion rather than blowing the stack.
    expect(r.signatures?.[0]).toMatchObject({ modifiedAfterSigning: false });
  });

  it("still spots a modification at the bottom of the nest", async () => {
    const origin = await serveNested(25_000);
    const r = await fetchSustainability(origin, { ...ALLOW_INSECURE, verifySignature: true });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // Re-verify the same object with one leaf changed: the payload no longer
    // matches, and that is reported rather than thrown. (The object is mutated
    // in place — a structured clone of a nest this deep is itself recursive.)
    const object = r.document as Record<string, unknown>;
    let node: any = (object.extensions as any)["urn:uuid:16c36135-e6ae-40f9-a972-015eefc68845"];
    while (node.n) node = node.n;
    node.leaf = 2;
    const outcome = await verifyEmbeddedSignature(object);
    expect(outcome.result).toMatchObject({ status: "verified", modifiedAfterSigning: true });
  });
});
